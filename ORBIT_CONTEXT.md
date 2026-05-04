# ORBIT — Project Context File
# Paste this at the start of every new Claude chat to resume work instantly.
# Keep this file updated after every session.

---

## Identity & Live URLs
- **Project:** Orbit — Solana memecoin analysis + community platform
- **Frontend:** https://orbit-app.xyz (Vercel, auto-deploys on push to main)
- **Backend:** https://backend-production-a427a.up.railway.app (Railway, Python 3.11, port 8080)
- **Repo:** https://github.com/orbitdev00/backend
- **Local path:** C:\Users\Alexander\KKBOT\

---

## Stack
- **Frontend:** React + Vite, React Router v6, Supabase JS client
- **Backend:** FastAPI + uvicorn, httpx, stripe, numpy, xgboost, scikit-learn, anthropic
- **Database:** Supabase (Postgres + Auth + Storage)
- **RPC:** QuickNode (Solana)
- **Payments:** Stripe (live mode)
- **Deployment:** Vercel (frontend, root dir = frontend/) · Railway (backend)

---

## Repo Structure
```
KKBOT/
├── backend/
│   ├── main.py                  # FastAPI app, all routes
│   ├── config.py                # env var loading
│   ├── stripe_handler.py        # Stripe checkout, billing portal, webhooks
│   ├── tier_check.py            # tier cache (5min TTL), TIER_LIMITS dict
│   ├── rate_limiter.py          # 3/day free, unlimited paid
│   ├── supabase_logger.py       # log_prediction, record_outcome
│   ├── trial_gate.py            # fingerprint-based 1-time trial
│   ├── requirements.txt         # fastapi, uvicorn, httpx, stripe, numpy, xgboost, scikit-learn, anthropic, groq
│   ├── engine/
│   │   ├── claude.py            # Claude Haiku analysis (primary)
│   │   └── snapshot.py          # build_snapshot() - aggregates all data
│   ├── aggregator/
│   │   ├── dexscreener.py
│   │   ├── pumpfun.py
│   │   ├── helius.py
│   │   ├── goplus.py
│   │   ├── wallet_history.py
│   │   ├── devhistory.py
│   │   └── pnl.py
│   └── ml/
│       ├── predictor.py         # XGBoost inference (peak MC + rug score)
│       ├── train.py
│       ├── accuracy_test.py
│       └── record_outcomes.py
└── frontend/
    └── src/
        ├── main.jsx             # Router, ProtectedRoute, PageTransition
        ├── App.jsx              # Analyzer page (main app)
        ├── index.css            # global CSS vars, page-locked utility
        ├── orbitPfp.js          # logo import
        ├── context/
        │   └── AuthContext.jsx  # useAuth(), supabase auth
        ├── lib/
        │   ├── supabase.js
        │   └── stripe.js        # getUserTier(), startCheckout(), openBillingPortal()
        ├── hooks/
        │   └── useStreamAnalysis.js  # WS streaming analysis hook
        ├── components/
        │   ├── NavBar.jsx/css        # sticky nav, tier badge, DM badge, upgrade btn
        │   ├── StarField.jsx         # 400 stars, flicker, slow drift
        │   ├── PageTransition.jsx/css # fade-up on route change
        │   ├── CoinInput.jsx
        │   ├── PricingPanel.jsx/css  # embedded in account settings
        │   └── BlackHole.jsx         # transition between BH and app
        └── pages/
            ├── Landing.jsx/css       # public landing, black hole CTA transition
            ├── Home.jsx/css          # 4 colored cards (analyze/forum/tracker/lb)
            ├── App.jsx               # (same as src/App.jsx - the analyzer)
            ├── Forum.jsx/css         # community forum index
            ├── ForumCategory.jsx
            ├── ForumThread.jsx       # mod controls (delete thread/reply, ban)
            ├── ForumNew.jsx
            ├── Tracker.jsx/css       # price tracker + alerts
            ├── Leaderboard.jsx/css   # on-chain PnL rankings
            ├── History.jsx/css       # analysis history
            ├── Profile.jsx/css       # user profile + OwnerPanel
            ├── Pricing.jsx/css       # /pricing full page
            ├── Inbox.jsx/css         # DMs
            ├── EditProfile.jsx
            ├── Login.jsx
            ├── SignUp.jsx
            ├── ForgotPassword.jsx
            └── AuthCallback.jsx
```

---

## Backend Routes
```
GET  /analyze/{mint}          # single analysis (HTTP)
WS   /stream/{mint}           # streaming analysis (WebSocket)
GET  /tier?user_id=           # get user tier + limits
GET  /usage?user_id=          # rate limit usage
POST /stripe/webhook          # Stripe event handler
POST /stripe/create-checkout  # create checkout session
POST /stripe/billing-portal   # open billing portal
GET  /outcome                 # record analysis outcome
POST /outcome/{mint}          # submit actual peak MC
GET  /pnl/{wallet}            # fetch monthly PnL
GET  /debug/{mint}            # raw snapshot debug
```

---

## Supabase Tables (key columns)
```
user_reputation:
  user_id, username, email, avatar_url, bio, wallet_address
  role          -- 'member' | 'mod' | 'banned' | 'owner'
  tier          -- 'free' | 'degen' | 'omega'
  score, total_pnl_pct, show_pnl
  stripe_customer_id, stripe_subscription_id, subscription_expires_at

predictions:
  id, mint, name, symbol, user_id
  market_cap_at_analysis, estimated_peak_mc, peak_mc_low, peak_mc_high
  rug_probability, risk_score, momentum, stage
  prob_100k, prob_250k, prob_500k, prob_1m, prob_5m, prob_10m
  actual_peak_mc, prediction_accurate, outcome_recorded_at
  snapshot_timestamp, reasoning, flags, bullish_flags

forum_threads:
  id, title, body, category_id, author_id, author_email
  reply_count, last_reply_at, created_at

forum_posts:
  id, thread_id, author_id, author_email, body, created_at
  upvotes, downvotes

forum_categories:
  id, name, slug, description, icon, threadCount

direct_messages:
  id, sender_id, receiver_id, body, created_at, read

user_badges, forum_badges:
  badge system (not fully built yet)

tracker_items:
  user_id, mint, name, symbol, target_mc, direction, triggered
```

---

## Environment Variables

### Railway (backend)
```
ANTHROPIC_API_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
HELIUS_API_KEY
QUICKNODE_RPC_URL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_DEGEN_PRICE_ID       # price_1TOGerF1y7J52ni6oRMRvoKk
STRIPE_OMEGA_PRICE_ID       # price_1TOGfeF1y7J52ni6zIMj0xgs
```

### Vercel (frontend)
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

---

## Tier System
| Tier | Price | Analyses | History | Tracker | Forum |
|------|-------|----------|---------|---------|-------|
| Guest | free | 1 (trial) | none | none | read-only |
| Free | free | 3/day | none | 3 coins | full (no images) |
| Degen | $14.99/mo | unlimited | unlimited | unlimited | + images |
| Omega | $49.99/mo ($24.99 launch) | unlimited | unlimited | unlimited | + Omega-only chat |

**Omega extras:** Maximum analysis depth · Omega-only Forum Chat · Omega badge + profile border · up to 5 wallets · early beta · direct dev channel

---

## Access Control
- **Owner email:** orbitdev00@gmail.com
- **Owner powers:** change tier, add/remove mod, ban, unban, delete account (via OwnerPanel on profile page)
- **Mod powers:** delete threads, delete replies, ban users (via ForumThread.jsx)
- **Mod role:** set via owner panel → `role = 'mod'` in user_reputation

---

## Stripe Setup
- Webhook endpoint: `https://backend-production-a427a.up.railway.app/stripe/webhook`
- Events: `checkout.session.completed` · `customer.subscription.updated` · `customer.subscription.deleted`
- Omega launch discount: 7-day coupon via Stripe promo code at checkout (`allow_promotion_codes: true`)

---

## Key Design Decisions
- **No em dashes** anywhere — use `·` or reword
- **No separate BH canvas** — black hole draws on star canvas (already z-index 0, behind page)
- **XGBoost rug classifier skipped** — rule-based flags used instead (F1 was 0% due to actual_peak_mc storing current MC not peak)
- **Peak MC model: GOOD** — 41.7% MAPE, 67% within predicted range
- **Rate limiting is in-memory** — resets on Railway restart (soft limit, not hard paywall)
- **Tier cache: 5 min TTL** — avoids Supabase hit on every analysis request
- **Google OAuth redirect** — Supabase URL config must include `https://orbit-app.xyz/auth/callback`

---

## Current Version
- **v0.5** — shown in NavBar and Landing page

---

## What's Built (v0.4 complete)
- [x] Full analyzer with streaming WebSocket
- [x] Landing page with black hole CTA transition
- [x] Home screen (4 colored cards)
- [x] Forum (categories, threads, replies, search, DMs, notifications)
- [x] Tracker (watchlist + alerts)
- [x] Leaderboard (PnL + rep rankings)
- [x] Analysis history
- [x] User profiles + follow + DM
- [x] Stripe subscription system (Degen + Omega)
- [x] Pricing page (/pricing)
- [x] Rate limiting (3/day free, unlimited paid)
- [x] Owner admin panel (tier, mod, ban, delete)
- [x] Mod controls in forum
- [x] Unread DM badge in NavBar
- [x] Page transitions (fade-up on route change)
- [x] StarField on all pages (flicker, slow, small)
- [x] Page scroll locking (content scrolls inside blocks)
- [x] Badge system — 36 badges, award engine, equip controls, popup notifications
- [x] Badges page (/badges) with NavBar, category filters, locked/unlocked grid
- [x] Google signup onboarding — forces username set on first login
- [x] NavBar overhaul — profile routing fix, badges in nav, subscription in account settings, portal modals

---

## Pending / To Build (v0.5+)
- [ ] Onboarding flow — run first analysis after username set
- [ ] Share analysis — public shareable link per result
- [ ] Nightly PnL sync — Railway cron job
- [ ] Discord bot — update to Railway URL
- [ ] Omega: batch scan (5 CAs ranked by purity)
- [ ] Omega: custom alert conditions
- [ ] Omega: whale alert feed
- [ ] Coin launch on Pump.fun (TBD)

---

## Devlog

---

### v0.5 — Badge System, NavBar Overhaul, Auth Fix
Badge system shipped. 36 badges, equip system, locked/unlocked UI. NavBar overhauled — profile routing fixed, badges in nav, subscription moved into account settings, modals portal to body so they center correctly on all pages. Google signup now forces username set on first login.

---

### v0.4 — Subscription System, UI Polish, Admin Controls
- Created Stripe account · products: Degen $14.99/mo · Omega $49.99/mo (launch price $24.99 for 7 days via coupon)
- New `/pricing` route · full tier comparison page · 3 cards with feature lists
- Upgrade button in NavBar dropdown (purple for free · gold for degen) navigates to /pricing

---

## Claude Preferences (always follow these)
- Always include the full `git add ... && git commit -m "..." && git push` command at the end
- Never use em dashes (—) anywhere in UI text · use `·` or reword
- Direct, no fluff, max technical depth
- When making file changes, output the files and use present_files tool
- Don't create a devlog unless explicitly asked
- The user's name is Kyomo
