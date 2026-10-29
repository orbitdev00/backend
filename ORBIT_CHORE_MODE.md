# Orbit ⇄ Chore mode

orbit-app.xyz currently serves the **Matos Dashboard** chores app instead of Orbit.
Nothing Orbit-related was deleted. It is hidden behind two env vars.

| Where   | Variable        | Chore mode (default) | Orbit   |
|---------|-----------------|----------------------|---------|
| Vercel  | `VITE_APP_MODE` | `chores`             | `orbit` |
| Railway | `APP_MODE`      | `chores`             | `orbit` |

Both default to `chores` when unset.

## Flip back to Orbit

1. **Vercel** → Project → Settings → Environment Variables: set `VITE_APP_MODE=orbit` (Production), then **Redeploy**.
   Vite reads it at build time, so changing the variable only takes effect after a rebuild.
2. **Railway** → backend service → Variables: set `APP_MODE=orbit`. Railway restarts the service.

The chore tables stay in Supabase and don't affect Orbit.

## What each mode does

**Frontend** (`frontend/src/main.jsx`, `frontend/vite.config.js`)
- `orbit`: bundles `src/OrbitMain.jsx`, the original router and app, unchanged.
- `chores`: bundles only `src/chores/`. There is no router, auth, WebSocket, RPC or Stripe code in the build.
  Every path redirects to `/`. Title, favicon and meta tags are swapped in `index.html` at build time.

**Backend** (`backend/main.py`, `backend/chore_routes.py`)
- `orbit`: every endpoint works as before. The `/chores/*` endpoints also exist but nothing calls them.
- `chores`: only `/health` and `/chores/*` respond. All other HTTP routes return 404 and WebSockets are refused,
  before any handler runs. The nightly PnL sync is skipped.

## Chore mode env vars

| Where   | Variable                 | Notes |
|---------|--------------------------|-------|
| Vercel  | `VITE_SUPABASE_URL`      | already set for Orbit |
| Vercel  | `VITE_SUPABASE_ANON_KEY` | already set for Orbit |
| Vercel  | `VITE_BACKEND_URL`       | already set for Orbit (Railway URL) |
| Railway | `SUPABASE_URL`           | already set |
| Railway | `SUPABASE_SERVICE_KEY`   | already set. The service role key the backend uses to write chore data |

`CHORE_APPROVAL_PIN` is no longer used and can be deleted from Railway. There is no login or passcode:
anyone with the link can use the app, and each visitor picks their name (saved in the `chore_user` cookie for a year).

## Data, points and streaks

- `supabase/migrations/20261019000000_chore_mode.sql` creates `chore_members`, `chores`, `chore_assignments`,
  `chore_completions`, `chore_settings` and `pending_changes` (still there, no longer used).
- `supabase/migrations/20261020000000_chore_points.sql` adds difficulty, description, time of day, allowed members
  and a validity window (`starts_on`/`retired_on`) to chores, `completed_by`/`points_awarded` to completions,
  `chore_rotation_log`, the internal `chore_schedule` view and the public `chore_leaderboard` view, and replaces
  `chore_reset_defaults()` (members Misael, Penelope, Alex, Nathan and the new chore list).
- The public (anon) role can only read. Every edit goes to `POST /chores/submit` (rate limited per IP), which
  validates it and applies it right away with the service role key.
- Points = minutes × difficulty (easy 1x, medium 1.5x, hard 2x), rounded, unless the chore has `points_override`
  (every "extreme" chore gets 75). They are stamped on the completion row
  when it is inserted (a trigger recomputes them, whatever was sent) and rows can't be edited. Unchecking deletes the row.
  Chores aren't assigned: anyone can claim an open chore by checking it off, for today or yesterday
  (America/New_York), and only whoever claimed it can uncheck it. Each chore shows its points and coins.
- `supabase/migrations/20261025000000_open_chores.sql` clears `allowed_member_ids`, drops the bathroom limits from
  `chore_reset_defaults()` and changes the streak to consecutive days on which you claimed at least one chore.
  `chore_assignments`, `chore_settings` and `chore_rotation_log` stay but nothing reads them any more.
- Leaderboard and streaks are computed by the `chore_leaderboard` view from `chore_completions`. Nothing stores or
  sets a score. Deleting a chore is a soft delete, and Reset Default Data never touches completions.
- So past days never change, schedule edits (frequency, day) take effect tomorrow. Minutes/difficulty edits apply in place but only affect future completions.

## Chat, coins and the shop

- `supabase/migrations/20261021000000_matos_shop_chat.sql` adds the extreme tier and `points_override`, the new
  member colors and chore list, `chat_messages`, `chore_purchases`, `chore_member_cosmetics`, the `chore_wallet`
  view and `chore_buy()`. Anon can only read all of them.
- Chat: `POST /chores/chat` (trimmed, 1–500 characters, 10 messages/minute per IP). Messages are stored as typed
  and rendered as plain text.
- Coins: 1 coin per 10 points earned, minus what was spent (`chore_wallet`, never stored). `POST /chores/shop` buys
  (price from `SHOP_ITEMS` in `backend/chore_routes.py`, checked atomically by `chore_buy()`) or equips cosmetics:
  themes, profile pictures, colors, name fonts, name colors and animated banners. The catalog for the UI is
  `frontend/src/chores/shop.js`; a backend test keeps the two in sync.
- Tests: `cd backend && python -m pytest tests/test_chore_routes.py` and `cd frontend && npm test`.

## Pickleball tournament (`/pickleball`)

- A standalone page (own header and look, no chore code or data). The chore header links to it.
- `supabase/migrations/20261022000000_pickleball.sql` adds `pickleball_entries` (backend only), `pickleball_settings`,
  `pickleball_messages`, the `pickleball_bracket` view (no token hashes) and `pickleball_join()`/`pickleball_update()`,
  which lock the table so simultaneous joins can't share a slot or a name. Anon can only read the view, settings and messages.
- 12 singles players (one per slot; switched from doubles by `20261023000000_pickleball_singles.sql`,
  which also cleared all signups), double elimination (winners' and losers' brackets, grand final). The bracket is display only: no scores
  or advancing. Slots come only from the random draw and a trigger stops them from ever changing.
- `20261024000000_pickleball_professional.sql` adds a reserved `professional` skill (black badge, white text) that
  nobody can pick; only Marlito and Kyomo have it. It also made the only slot move ever: Marlito went from 11 to 8 or 9
  so the two can't meet before the winners' final.
- Joining returns an edit token once (only its SHA-256 is stored). The device keeps it in localStorage and a cookie
  and needs it to edit, leave or post on the wall.
- Organizer tools need `PICKLEBALL_ADMIN_PIN` on Railway (503 when unset; 5 wrong tries per 5 minutes per IP, then 429).
- Chat (the message wall) opens from the nav bar. Notifications are per device (the players whose tokens it holds):
  joins, leaves, chat mentions of your name, organizer edits/removals of your entry, a full bracket and event changes.
  They're worked out in the browser from each poll and kept in localStorage; nothing new is stored server side.
- Team colors are `PICKLEBALL_COLORS` in `backend/pickleball_routes.py`; the page reads them from `GET /pickleball/config`.
- Tests: `cd backend && python -m pytest tests/test_pickleball_routes.py` and `cd frontend && npm test`.
