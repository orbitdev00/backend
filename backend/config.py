import os
from dotenv import load_dotenv

load_dotenv()

HELIUS_API_KEY = os.getenv("HELIUS_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", os.getenv("SUPABASE_ANON_KEY"))
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
PORT = int(os.getenv("PORT", 8000))

HELIUS_RPC_URL  = f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"  # kept as fallback
QUICKNODE_URL   = "https://quaint-distinguished-river.solana-mainnet.quiknode.pro/ade127a9ec8c5b4e18b10e86063121332ad61284/"
PRIMARY_RPC_URL = QUICKNODE_URL  # QuickNode is primary
HELIUS_API_URL = f"https://api.helius.xyz/v0"

DEXSCREENER_API = "https://api.dexscreener.com/latest/dex"
SOLSCAN_API = "https://pro-api.solscan.io/v2.0"
PUMPFUN_API = "https://frontend-api.pump.fun"

# How often (seconds) to re-pull data and re-analyze while watching a coin
REFRESH_INTERVAL = 180      # Re-analyze every 3 minutes
MAX_AUTO_REFRESHES = 20     # Stop auto-refreshing after 20 cycles (~1 hour)

# Stripe
STRIPE_SECRET_KEY      = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET  = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_DEGEN_PRICE_ID  = os.getenv("STRIPE_DEGEN_PRICE_ID", "")
STRIPE_OMEGA_PRICE_ID  = os.getenv("STRIPE_OMEGA_PRICE_ID", "")
