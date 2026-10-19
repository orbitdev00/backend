# Orbit ⇄ Chore mode

orbit-app.xyz currently serves the **Household Chore Dashboard** instead of Orbit.
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
| Railway | `SUPABASE_SERVICE_KEY`   | already set. This is the service role key the backend uses to apply approved changes |
| Railway | `CHORE_APPROVAL_PIN`     | **new**: shared PIN for the Review Changes modal |

## Data and change review

- The migration `supabase/migrations/20261019000000_chore_mode.sql` creates `chore_members`, `chores`,
  `chore_assignments`, `chore_completions`, `chore_settings` and `pending_changes`.
- The public (anon) role can only read them. Only the backend (service role key) writes.
- Every edit in the UI goes to `POST /chores/submit`, which is rate limited per IP and queued as pending.
  Edits show with a dashed "pending" style until someone with the PIN approves them in **Review Changes**
  (`POST /chores/review`). The backend then applies them with the service role key.
