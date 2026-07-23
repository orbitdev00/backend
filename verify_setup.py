#!/usr/bin/env python3
"""
Orbit Setup Verification Script
Checks that all required environment variables and configurations are in place
"""

import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def check_env_var(name, required=True):
    """Check if an environment variable is set"""
    value = os.getenv(name)
    if value and value != "your_api_key_here" and not value.startswith("your_"):
        print(f"✅ {name}: Set")
        return True
    elif required:
        print(f"❌ {name}: MISSING or not configured")
        return False
    else:
        print(f"⚠️  {name}: Optional - not set")
        return True

def main():
    print("=" * 60)
    print("ORBIT SETUP VERIFICATION")
    print("=" * 60)

    all_good = True

    print("\n📦 REQUIRED BACKEND VARIABLES:")
    all_good &= check_env_var("SUPABASE_URL")
    all_good &= check_env_var("SUPABASE_ANON_KEY")
    all_good &= check_env_var("HELIUS_API_KEY")
    all_good &= check_env_var("ANTHROPIC_API_KEY")

    print("\n💳 STRIPE PAYMENT VARIABLES:")
    all_good &= check_env_var("STRIPE_SECRET_KEY")
    all_good &= check_env_var("STRIPE_WEBHOOK_SECRET")
    all_good &= check_env_var("STRIPE_DEGEN_PRICE_ID")
    all_good &= check_env_var("STRIPE_OMEGA_PRICE_ID")

    print("\n🔧 OPTIONAL VARIABLES:")
    check_env_var("SUPABASE_SERVICE_KEY", required=False)
    check_env_var("MORALIS_API_KEY", required=False)
    check_env_var("PORT", required=False)

    print("\n" + "=" * 60)

    if all_good:
        print("✅ ALL REQUIRED VARIABLES ARE SET!")
        print("\nNext steps:")
        print("1. Run fix_owner_permissions.sql in Supabase SQL Editor")
        print("2. Start the backend: cd backend && python main.py")
        print("3. Start the frontend: cd frontend && npm run dev")
        print("4. Sign in with orbitdev00@gmail.com")
        print("5. Verify you see 'Orbit_Dev' username and owner controls")
    else:
        print("❌ CONFIGURATION INCOMPLETE!")
        print("\nMissing variables found. Please:")
        print("1. Copy .env.complete.example to .env")
        print("2. Fill in all required API keys")
        print("3. Run this script again to verify")
        sys.exit(1)

    print("=" * 60)

if __name__ == "__main__":
    main()
