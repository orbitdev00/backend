# Pre-Launch Checklist for Orbit

## Issues to Fix Before Launch

### 1. ✅ Owner Permissions & Username
**Problem**: Your account (orbitdev00@gmail.com) needs proper owner permissions and the username "Orbit_Dev"

**Fix**: Run the SQL script `fix_owner_permissions.sql` in your Supabase SQL Editor

**How to verify**:
- After running the script, reload your app
- Your username should show as "Orbit_Dev" instead of a random placeholder
- You should see the "Grant Badge to Self" section in NavBar account settings
- You should have access to Owner Controls on user profiles

---

### 2. ✅ Tracker Counter Display
**Status**: Working as designed

The tracker shows:
- "Alerts" tab with a badge showing count when > 0
- "Watchlist" tab with a badge showing count when > 0
- "Free plan · 0/1 alert used" message when on free tier

If you're seeing "0/0" somewhere specific, please clarify where exactly you're seeing it.

---

### 3. ✅ Omega Tier Permissions
**Problem**: Your account needs Omega tier to access all features

**Fix**: The SQL script sets your tier to 'omega' automatically

**Verify**:
- Check NavBar dropdown - should show "OMEGA" badge
- Unlimited alerts in Tracker (no 1 alert limit)
- Full access to all premium features

---

## How to Apply Fixes

1. **Open Supabase Dashboard**
   - Go to your project at https://supabase.com/dashboard
   - Navigate to SQL Editor

2. **Run the Fix Script**
   - Copy the contents of `fix_owner_permissions.sql`
   - Paste into a new query
   - Click "Run"

3. **Verify Changes**
   - Check the output of the SELECT query at the end
   - Should show:
     ```
     username: Orbit_Dev
     role: owner
     tier: omega
     email: orbitdev00@gmail.com
     ```

4. **Reload Your App**
   - Clear browser cache (Ctrl+Shift+R)
   - Sign out and sign back in
   - Check that your username is "Orbit_Dev"
   - Verify owner permissions work

---

## Environment Variables Check

Your `.env` file is missing critical variables. You need:

```bash
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key

# Helius (for Solana data)
HELIUS_API_KEY=your_helius_key

# Anthropic (for AI analysis)
ANTHROPIC_API_KEY=your_anthropic_key

# Stripe (for payments)
STRIPE_SECRET_KEY=your_stripe_secret
STRIPE_WEBHOOK_SECRET=your_webhook_secret
STRIPE_DEGEN_PRICE_ID=price_xxx
STRIPE_OMEGA_PRICE_ID=price_xxx

# Admin
VITE_ADMIN_SECRET=your_admin_secret

# Frontend env (in .env.local or .env)
VITE_BACKEND_URL=https://backend-production-a427a.up.railway.app
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## Launch Readiness

- [ ] Owner permissions configured (run SQL script)
- [ ] Environment variables set
- [ ] Test signup flow
- [ ] Test analyzer with real token
- [ ] Test forum posting
- [ ] Test tracker alerts
- [ ] Test Stripe payments (use test mode first)
- [ ] Verify leaderboard data
- [ ] Check Discord bot integration
- [ ] Review error logging

---

## Common Issues

### "Username shows random name like 'swift1234'"
→ Run the SQL fix script to set username to 'Orbit_Dev'

### "Can't see Owner Controls"
→ Ensure `role = 'owner'` in user_reputation table

### "Tracker shows 0/1 alerts"
→ This is correct for free tier. Upgrade to omega for unlimited.

### "No Omega badge showing"
→ Run SQL script to set tier to 'omega'
