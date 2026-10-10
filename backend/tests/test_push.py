"""Automated unit and integration tests for AquaWise Web Push delivery and notification integration."""

import json
import sqlite3
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

import main
from main import app, connect_db, DB_LOCK, add_notification, read_settings, set_value
import push
from push import (
    generate_vapid_keypair,
    is_push_configured,
    get_vapid_public_key,
    register_subscription,
    unregister_subscription,
    send_web_push,
    init_push_db,
)


@pytest.fixture
def mock_vapid_keys(monkeypatch):
    pub, priv = generate_vapid_keypair()
    monkeypatch.setenv("VAPID_PUBLIC_KEY", pub)
    monkeypatch.setenv("VAPID_PRIVATE_KEY", priv)
    monkeypatch.setenv("VAPID_CLAIMS_SUB", "mailto:test@aquawise.farm")
    return pub, priv


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_push_and_notifications():
    with DB_LOCK, connect_db() as db:
        init_push_db(db)
        db.execute("DELETE FROM push_subscriptions")
        db.execute("DELETE FROM notifications")
        db.commit()
    yield
    with DB_LOCK, connect_db() as db:
        db.execute("DELETE FROM push_subscriptions")
        db.commit()


# 1. Missing VAPID configuration handled gracefully
def test_missing_vapid_configuration_handled_gracefully(monkeypatch, client):
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    
    assert is_push_configured() is False
    assert get_vapid_public_key() is None
    
    resp = client.get("/api/push/vapid-public-key")
    assert resp.status_code == 200
    data = resp.json()
    assert data["publicKey"] is None
    assert data["enabled"] is False

    # Dispatching push when not configured should not crash or raise
    with DB_LOCK, connect_db() as db:
        result = send_web_push(db, {"id": 1, "title": "Test", "detail": "Test"})
        assert result["configured"] is False
        assert result["sent"] == 0


# 2. VAPID public key endpoint when configured
def test_vapid_endpoint_when_configured(mock_vapid_keys, client):
    pub, _ = mock_vapid_keys
    resp = client.get("/api/push/vapid-public-key")
    assert resp.status_code == 200
    data = resp.json()
    assert data["publicKey"] == pub
    assert data["enabled"] is True


# 3. User & device subscription management and isolation
def test_subscription_registration_and_device_isolation(client):
    sub1_payload = {
        "endpoint": "https://fcm.googleapis.com/fcm/send/device-1",
        "keys": {"p256dh": "key1", "auth": "auth1"},
        "userAgent": "Mozilla/5.0 Device1",
        "deviceToken": "token-device-1",
    }
    sub2_payload = {
        "endpoint": "https://fcm.googleapis.com/fcm/send/device-2",
        "keys": {"p256dh": "key2", "auth": "auth2"},
        "userAgent": "Mozilla/5.0 Device2",
        "deviceToken": "token-device-2",
    }

    # Register device 1
    resp1 = client.post("/api/push/subscribe", json=sub1_payload)
    assert resp1.status_code == 200
    assert resp1.json()["status"] == "subscribed"
    assert resp1.json()["deviceToken"] == "token-device-1"

    # Register device 2
    resp2 = client.post("/api/push/subscribe", json=sub2_payload)
    assert resp2.status_code == 200
    assert resp2.json()["deviceToken"] == "token-device-2"

    # Device 2 cannot unsubscribe Device 1's endpoint
    unsub_unauthorized = client.post(
        "/api/push/unsubscribe",
        json={"endpoint": sub1_payload["endpoint"], "deviceToken": "token-device-2"},
    )
    assert unsub_unauthorized.status_code == 403

    # Device 1 can unsubscribe its own endpoint
    unsub_authorized = client.post(
        "/api/push/unsubscribe",
        json={"endpoint": sub1_payload["endpoint"], "deviceToken": "token-device-1"},
    )
    assert unsub_authorized.status_code == 200
    assert unsub_authorized.json()["status"] == "unsubscribed"


# 4. Existing notification record triggers a push attempt when push is enabled and valid subscription exists
def test_notification_record_triggers_push_attempt(mock_vapid_keys, monkeypatch):
    mock_webpush = MagicMock()
    monkeypatch.setattr(push, "webpush", mock_webpush)

    with DB_LOCK, connect_db() as db:
        # Enable notifications in settings
        set_value(db, "setting:notificationsEnabled", True)
        
        # Register a subscription
        register_subscription(
            db,
            endpoint="https://fcm.googleapis.com/fcm/send/sub-trigger-test",
            p256dh="test_p256dh",
            auth="test_auth",
            device_token="dev-tok-123",
        )

        # Create notification record
        record = add_notification(
            db,
            title="Soil Alert",
            detail="Soil moisture dropped below threshold",
        )

        assert record is not None
        assert record["id"] > 0
        assert record["title"] == "Soil Alert"

        # Verify webpush was called
        assert mock_webpush.called
        call_args = mock_webpush.call_args
        sub_info = call_args.kwargs.get("subscription_info")
        data_str = call_args.kwargs.get("data")
        
        assert sub_info["endpoint"] == "https://fcm.googleapis.com/fcm/send/sub-trigger-test"
        
        payload = json.loads(data_str)
        # Verify notification ID and metadata are preserved in push payload
        assert payload["id"] == record["id"]
        assert payload["title"] == "Soil Alert"
        assert payload["detail"] == "Soil moisture dropped below threshold"
        assert payload["data"]["notificationId"] == record["id"]
        assert payload["data"]["url"] == f"/?notificationId={record['id']}"


# 5. Duplicate event does not create duplicate records or repeatedly send duplicate pushes
def test_duplicate_event_does_not_create_duplicates(mock_vapid_keys, monkeypatch):
    mock_webpush = MagicMock()
    monkeypatch.setattr(push, "webpush", mock_webpush)

    with DB_LOCK, connect_db() as db:
        set_value(db, "setting:notificationsEnabled", True)
        
        register_subscription(
            db,
            endpoint="https://fcm.googleapis.com/fcm/send/sub-dedup-test",
            p256dh="p256dh",
            auth="auth",
            device_token="dev-dedup",
        )

        title = "Unique Event Title"
        detail = "Unique Event Detail"

        # First call: creates record and sends push
        r1 = add_notification(db, title, detail)
        assert r1 is not None
        calls_after_first = mock_webpush.call_count
        assert calls_after_first > 0

        # Second call with same event within cooldown window
        r2 = add_notification(db, title, detail)
        assert r2 is None  # deduplicated!
        assert mock_webpush.call_count == calls_after_first  # No duplicate push sent!


# 6. In-app notifications continue to work when push is disabled
def test_in_app_notifications_work_when_push_disabled(mock_vapid_keys, monkeypatch):
    mock_webpush = MagicMock()
    monkeypatch.setattr(push, "webpush", mock_webpush)

    with DB_LOCK, connect_db() as db:
        # Disable notifications in settings
        set_value(db, "setting:notificationsEnabled", False)

        register_subscription(
            db,
            endpoint="https://fcm.googleapis.com/fcm/send/sub-disabled-test",
            p256dh="p256dh",
            auth="auth",
            device_token="dev-disabled",
        )

        record = add_notification(db, "Disabled Push Title", "In-app record only")
        assert record is not None
        assert record["title"] == "Disabled Push Title"

        # In-app notification record exists in SQLite
        row = db.execute("SELECT id, title, detail FROM notifications WHERE id = ?", (record["id"],)).fetchone()
        assert row is not None
        assert row["title"] == "Disabled Push Title"

        # Web push was NOT attempted
        assert not mock_webpush.called


# 7. Push delivery failure does not affect notification persistence
def test_push_failure_does_not_affect_notification_persistence(mock_vapid_keys, monkeypatch):
    class FailingWebPushException(push.WebPushException):
        pass

    def fail_webpush(*args, **kwargs):
        raise FailingWebPushException("Push service 500 error")

    monkeypatch.setattr(push, "webpush", fail_webpush)

    with DB_LOCK, connect_db() as db:
        set_value(db, "setting:notificationsEnabled", True)

        register_subscription(
            db,
            endpoint="https://fcm.googleapis.com/fcm/send/sub-fail-test",
            p256dh="p256dh",
            auth="auth",
            device_token="dev-fail",
        )

        record = add_notification(db, "Failed Push Title", "Record must persist")
        assert record is not None

        # Verify notification record is still in database and not corrupted/deleted
        row = db.execute("SELECT id, title, detail FROM notifications WHERE id = ?", (record["id"],)).fetchone()
        assert row is not None
        assert row["title"] == "Failed Push Title"


# 8. Expired subscriptions (404/410) are cleaned up correctly
def test_expired_subscription_cleanup(mock_vapid_keys, monkeypatch):
    class MockResponse:
        def __init__(self, status_code):
            self.status_code = status_code
            self.reason = "Gone"
            self.text = "Subscription expired"

    class ExpiredException(push.WebPushException):
        def __init__(self):
            super().__init__("410 Gone", response=MockResponse(410))

    def expired_webpush(*args, **kwargs):
        raise ExpiredException()

    monkeypatch.setattr(push, "webpush", expired_webpush)

    with DB_LOCK, connect_db() as db:
        set_value(db, "setting:notificationsEnabled", True)

        endpoint = "https://fcm.googleapis.com/fcm/send/sub-expired-test"
        register_subscription(
            db,
            endpoint=endpoint,
            p256dh="p256dh",
            auth="auth",
            device_token="dev-expired",
        )

        # Verify subscription exists in DB
        sub_row = db.execute("SELECT endpoint FROM push_subscriptions WHERE endpoint = ?", (endpoint,)).fetchone()
        assert sub_row is not None

        # Trigger notification dispatch
        record = add_notification(db, "Expired Test", "Checking cleanup")
        assert record is not None

        # Verify subscription was removed from DB
        sub_row_after = db.execute("SELECT endpoint FROM push_subscriptions WHERE endpoint = ?", (endpoint,)).fetchone()
        assert sub_row_after is None


# 9. Existing notification listing and acknowledgement continue to work
def test_existing_notification_routes_and_acknowledgement(client):
    import time
    title = f"Ack Test Title {time.time()}"
    with DB_LOCK, connect_db() as db:
        record = add_notification(db, title, "Ack Test Detail")
        assert record is not None
        notif_id = record["id"]

    # List notifications
    get_res = client.get("/api/notifications")
    assert get_res.status_code == 200
    items = get_res.json()
    matching = [item for item in items if item["id"] == notif_id]
    assert len(matching) == 1
    assert matching[0]["acknowledged"] is False

    # Acknowledge notification
    ack_res = client.post(f"/api/notifications/{notif_id}/acknowledge")
    assert ack_res.status_code == 200
    assert ack_res.json()["acknowledged"] is True

    # Check listing reflects acknowledgement
    get_res2 = client.get("/api/notifications")
    matching2 = [item for item in get_res2.json() if item["id"] == notif_id]
    assert matching2[0]["acknowledged"] is True


# 10. Farmer alerts: test low soil moisture and recommendation state changes
def test_farmer_alerts_integration(client, monkeypatch):
    mock_webpush = MagicMock()
    monkeypatch.setattr(push, "webpush", mock_webpush)

    # Apply test scenario with critically dry soil moisture
    scenario_resp = client.post("/api/test-scenario", json={
        "soilMoisture": 15.0,  # Below refill threshold
        "rainingNow": False,
        "rainProbability6h": 0.0,
        "precipitationMm6h": 0.0,
        "sensorFault": False,
    })
    assert scenario_resp.status_code == 200

    # Fetch field state which evaluates recommendations and alert triggers
    field_resp = client.get("/api/field")
    assert field_resp.status_code == 200

    notifs = client.get("/api/notifications").json()
    titles = [n["title"] for n in notifs]
    # Verify low soil moisture or watering recommended alerts are present
    assert any("Soil moisture" in t or "Watering recommended" in t or "Low soil moisture" in t for t in titles)
