#!/usr/bin/env python3
"""CLI utility to generate VAPID keys for AquaWise Web Push notifications."""

import sys
from pathlib import Path

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from push import generate_vapid_keypair


def main():
    print("=" * 60)
    print("AquaWise VAPID Keypair Generator")
    print("=" * 60)
    
    pub, priv = generate_vapid_keypair()
    
    print("\nGenerated VAPID Keys for Web Push Notifications:\n")
    print(f"VAPID_PUBLIC_KEY={pub}")
    print("\n# Add the following private key to your environment / .env file:")
    print("VAPID_PRIVATE_KEY=\"\"\"" + priv.strip() + "\"\"\"")
    print("\nVAPID_CLAIMS_SUB=mailto:farmer@aquawise.farm")
    print("\n" + "=" * 60)
    print("Copy these values into your environment before starting AquaWise.")
    print("=" * 60)


if __name__ == "__main__":
    main()
