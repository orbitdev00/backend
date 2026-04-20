import { supabase } from './supabase'

const API = import.meta.env.PROD
  ? 'https://backend-production-a427a.up.railway.app'
  : ''

export async function getUserTier() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) return { tier: 'free', limits: {} }
  try {
    const r = await fetch(`${API}/tier?user_id=${session.user.id}`)
    return await r.json()
  } catch { return { tier: 'free', limits: {} } }
}

export async function startCheckout(tier) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return null
  const r = await fetch(`${API}/stripe/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id:     session.user.id,
      email:       session.user.email,
      tier,
      success_url: window.location.origin,
      cancel_url:  window.location.origin,
    }),
  })
  const data = await r.json()
  if (data.url) window.location.href = data.url
  return data
}

export async function openBillingPortal() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return null
  const r = await fetch(`${API}/stripe/billing-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id:    session.user.id,
      return_url: window.location.origin,
    }),
  })
  const data = await r.json()
  if (data.url) window.location.href = data.url
  return data
}
