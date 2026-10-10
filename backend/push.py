"""Standards-based Web Push delivery with VAPID authentication for AquaWise.

Integrates with AquaWise's existing notification records and database storage.
Handles VAPID key management, subscription registration/unregistration,
push dispatch, error handling, expired subscription cleanup, and graceful fallbacks.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Mapping

try:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid
    import pywebpush
    from pywebpush import WebPushException, webpush
except ImportError:
    Vapid = None  # type: ignore[assignment, misc]
    pywebpush = None  # type: ignore[assignment]
    webpush = None  # type: ignore[assignment]
    WebPushException = Exception  # type: ignore[assignment, misc]

logger = logging.getLogger("aquawise.push")

DEFAULT_CLAIMS_SUB = "mailto:farmer@aquawise.farm"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    return (value or now_utc()).isoformat(timespec="seconds").replace("+00:00", "Z")


def generate_vapid_keypair() -> tuple[str, str]:
    """Generate a fresh P-256 VAPID keypair.
    
    Returns:
        (public_key_b64url, private_key_pem)
    """
    if Vapid is None:
        raise RuntimeError("py_vapid / cryptography library is required to generate VAPID keys")
    v = Vapid()
    v.generate_keys()
    raw_pub = v.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    pub_b64 = base64.urlsafe_b64encode(raw_pub).decode("utf-8").rstrip("=")
    priv_pem = v.private_pem().decode("utf-8")
    return pub_b64, priv_pem


def load_vapid() -> tuple[Any | None, str | None, str]:
    """Load VAPID instance, public key string, and subject claim from environment variables.
    
    Returns:
        (vapid_instance, public_key_b64url, subject_claim) or (None, None, subject_claim) if unconfigured.
    """
    if Vapid is None:
        return None, None, DEFAULT_CLAIMS_SUB

    pub_key_raw = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
    priv_key_raw = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    sub_claim = os.environ.get("VAPID_CLAIMS_SUB", DEFAULT_CLAIMS_SUB).strip()

    if not priv_key_raw:
        return None, None, sub_claim

    try:
        # 1. Check if private key is PEM format
        if "BEGIN " in priv_key_raw:
            vapid = Vapid.from_pem(priv_key_raw.encode("utf-8"))
        # 2. Check if private key is a file path
        elif os.path.isfile(priv_key_raw):
            vapid = Vapid.from_file(priv_key_raw)
        # 3. Check if base64/raw
        else:
            try:
                vapid = Vapid.from_string(priv_key_raw)
            except Exception:
                vapid = Vapid.from_raw(priv_key_raw.encode("utf-8"))

        # Derive or verify public key
        if pub_key_raw:
            pub_key_b64 = pub_key_raw
        else:
            raw_pub = vapid.public_key.public_bytes(
                serialization.Encoding.X962,
                serialization.PublicFormat.UncompressedPoint,
            )
            pub_key_b64 = base64.urlsafe_b64encode(raw_pub).decode("utf-8").rstrip("=")

        return vapid, pub_key_b64, sub_claim
    except Exception as exc:
        logger.warning("Failed to load VAPID keys: %s", exc)
        return None, None, sub_claim


def is_push_configured() -> bool:
    """Check if Web Push VAPID keys are properly configured in environment."""
    vapid, pub, _ = load_vapid()
    return vapid is not None and pub is not None


def get_vapid_public_key() -> str | None:
    """Get the base64url-encoded VAPID public key for frontend push subscription."""
    _, pub, _ = load_vapid()
    return pub


def init_push_db(db: sqlite3.Connection) -> None:
    """Ensure push subscriptions table exists."""
    db.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            user_agent TEXT,
            device_token TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT
        );
    """)


def register_subscription(
    db: sqlite3.Connection,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None = None,
    device_token: str | None = None,
) -> dict[str, str]:
    """Register or update a push subscription scoped to a device token.
    
    Prevents unauthorized devices from hijacking or modifying other devices' subscriptions.
    """
    init_push_db(db)
    
    token = device_token or uuid.uuid4().hex
    now_str = iso()

    existing = db.execute(
        "SELECT id, device_token FROM push_subscriptions WHERE endpoint = ?",
        (endpoint,),
    ).fetchone()

    if existing:
        # Enforce device-scoped ownership: if deviceToken was passed and doesn't match
        if device_token and existing["device_token"] != device_token:
            raise PermissionError("Subscription endpoint belongs to another device.")
        
        token = existing["device_token"]
        db.execute(
            "UPDATE push_subscriptions SET p256dh = ?, auth = ?, user_agent = ?, last_used_at = ? WHERE id = ?",
            (p256dh, auth, user_agent, now_str, existing["id"]),
        )
    else:
        db.execute(
            "INSERT INTO push_subscriptions(endpoint, p256dh, auth, user_agent, device_token, created_at, last_used_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (endpoint, p256dh, auth, user_agent, token, now_str, now_str),
        )

    db.commit()
    return {
        "status": "subscribed",
        "endpoint": endpoint,
        "deviceToken": token,
    }


def unregister_subscription(
    db: sqlite3.Connection,
    endpoint: str,
    device_token: str | None = None,
) -> bool:
    """Remove a push subscription verifying the device token for user/device isolation."""
    init_push_db(db)
    row = db.execute(
        "SELECT id, device_token FROM push_subscriptions WHERE endpoint = ?",
        (endpoint,),
    ).fetchone()

    if not row:
        return False

    if device_token and row["device_token"] != device_token:
        raise PermissionError("Device token does not match subscription ownership.")

    db.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
    db.commit()
    return True


def remove_expired_subscription(db: sqlite3.Connection, endpoint: str) -> None:
    """Remove an expired or unsubscribed endpoint reported by push service (HTTP 404/410)."""
    try:
        db.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
        db.commit()
        logger.info("Removed expired Web Push subscription: %s", endpoint)
    except Exception as exc:
        logger.warning("Error removing expired subscription: %s", exc)


def send_web_push(
    db: sqlite3.Connection,
    notification_record: Mapping[str, Any],
) -> dict[str, Any]:
    """Deliver a Web Push notification to all active subscriptions using VAPID.
    
    Preserves existing notification ID, title, detail, and timestamp.
    Does NOT modify or invalidate the original notification record upon failure.
    Cleans up expired subscriptions on HTTP 404/410 Gone.
    """
    init_push_db(db)

    vapid, pub, sub = load_vapid()
    if not vapid:
        logger.debug("Web Push not sent: VAPID keys not configured.")
        return {"sent": 0, "failed": 0, "expired": 0, "configured": False}

    rows = db.execute(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions"
    ).fetchall()

    if not rows:
        return {"sent": 0, "failed": 0, "expired": 0, "configured": True}

    notif_id = notification_record.get("id")
    title = str(notification_record.get("title", "AquaWise Alert"))
    detail = str(notification_record.get("detail", ""))
    at_str = str(notification_record.get("at") or notification_record.get("created_at") or iso())

    payload = {
        "id": notif_id,
        "title": title,
        "body": detail,
        "detail": detail,
        "at": at_str,
        "tag": f"aquawise-notification-{notif_id}" if notif_id else "aquawise-alert",
        "url": f"/?notificationId={notif_id}" if notif_id else "/",
        "data": {
            "notificationId": notif_id,
            "url": f"/?notificationId={notif_id}" if notif_id else "/",
            "title": title,
            "detail": detail,
            "at": at_str,
        },
    }
    payload_str = json.dumps(payload)

    sent = 0
    failed = 0
    expired = 0

    for row in rows:
        endpoint = row["endpoint"]
        sub_info = {
            "endpoint": endpoint,
            "keys": {
                "p256dh": row["p256dh"],
                "auth": row["auth"],
            },
        }

        try:
            if webpush is None:
                raise RuntimeError("pywebpush is not installed")

            webpush(
                subscription_info=sub_info,
                data=payload_str,
                vapid_private_key=vapid,
                vapid_claims={"sub": sub},
                ttl=3600,
            )
            sent += 1
            db.execute(
                "UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?",
                (iso(), row["id"]),
            )
        except WebPushException as exc:
            # Check if subscription is expired or gone (404 Not Found, 410 Gone)
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in (404, 410) or "unregistered" in str(exc).lower() or "expired" in str(exc).lower():
                expired += 1
                remove_expired_subscription(db, endpoint)
            else:
                failed += 1
                logger.warning("Web Push delivery failed for %s: %s", endpoint, exc)
        except Exception as exc:
            failed += 1
            logger.warning("Unexpected error during Web Push delivery: %s", exc)

    try:
        db.commit()
    except Exception:
        pass

    return {
        "sent": sent,
        "failed": failed,
        "expired": expired,
        "configured": True,
    }
