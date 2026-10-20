// Data access for chore mode. Reads go straight to the Supabase REST API with
// the anon key (read-only by RLS). Every write goes through the backend, which
// applies it right away with the service role key.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-3pyp.onrender.com'

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON)

async function rest(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  })
  if (!r.ok) throw new Error(`Supabase ${r.status}`)
  return r.json()
}

const CHORE_FIELDS = 'id,title,frequency,zone,minutes,difficulty,points_override,description,time_of_day,allowed_member_ids,' +
  'preferred_weekday,month_day,starts_on,retired_on,active,created_at'

/**
 * Everything needed to render [from, to] plus yesterday and today (My Day).
 * Chores include retired versions so past days show what was scheduled then.
 */
export async function loadAll(from, to, yesterday, today) {
  const range = `or=(and(date.gte.${from},date.lte.${to}),date.in.(${yesterday},${today}))`
  const [members, chores, assignments, completions, settings, rotationLog, leaderboard, cosmetics, purchases, wallet] = await Promise.all([
    rest('chore_members?select=id,name,color,active,created_at&order=created_at.asc'),
    rest(`chores?select=${CHORE_FIELDS}&order=created_at.asc`),
    rest(`chore_assignments?select=chore_id,date,member_id&${range}`),
    rest(`chore_completions?select=chore_id,date,completed_by,points_awarded&${range}`),
    rest('chore_settings?select=rotation_enabled&id=eq.1'),
    rest('chore_rotation_log?select=effective_on,enabled'),
    rest('chore_leaderboard?select=member_id,name,color,points_today,points_week,points_all,streak'),
    rest('chore_member_cosmetics?select=member_id,theme,avatar,color,name_font,name_color,banner'),
    rest('chore_purchases?select=member_id,item_id'),
    rest('chore_wallet?select=member_id,coins,coins_earned,coins_spent'),
  ])
  return {
    members, chores, assignments, completions, settings: settings[0] || null, rotationLog, leaderboard,
    cosmetics, purchases, wallet,
  }
}

const CHAT_FIELDS = 'id,member_id,body,created_at'

/** The newest `limit` messages, oldest first. */
export async function loadMessages(limit = 100) {
  const rows = await rest(`chat_messages?select=${CHAT_FIELDS}&order=created_at.desc&limit=${limit}`)
  return rows.reverse()
}

/** Messages created after `iso`, oldest first. */
export function messagesAfter(iso, fields = CHAT_FIELDS) {
  return rest(`chat_messages?select=${fields}&created_at=gt.${encodeURIComponent(iso)}&order=created_at.asc&limit=100`)
}

export function sendChat(member_id, body) {
  return post('chat', { member_id, body })
}

/** { action: 'buy' | 'equip', member_id, item_id, slot? } */
export function shopAction(body) {
  return post('shop', body)
}

/** Apply a change. Resolves with the backend's result, throws with its error message. */
export function submitChange(change_type, { target_id = null, payload = {} } = {}) {
  return post('submit', { change_type, target_id, payload })
}

async function post(path, body) {
  const r = await fetch(`${BACKEND}/chores/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(data.error || `Request failed (${r.status})`)
    err.status = r.status
    throw err
  }
  return data
}

// ── "Who are you?" cookie ────────────────────────────────────────────────────

const USER_COOKIE = 'chore_user'
const ONE_YEAR = 60 * 60 * 24 * 365

export function readUserCookie() {
  const m = document.cookie.match(new RegExp(`(?:^|; )${USER_COOKIE}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : ''
}

export function writeUserCookie(memberId) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${USER_COOKIE}=${encodeURIComponent(memberId)}; Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax${secure}`
}
