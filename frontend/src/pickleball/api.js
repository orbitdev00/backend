// Data access for /pickleball. Reads go straight to Supabase with the anon key
// (only pickleball_bracket, pickleball_settings and pickleball_messages are
// readable). Every write goes through the backend.

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

export async function loadBracket() {
  const [entries, settings] = await Promise.all([
    rest('pickleball_bracket?select=id,player_name,skill_level,color,slot,created_at&order=slot.asc'),
    rest('pickleball_settings?select=event_name,event_date&id=eq.1'),
  ])
  return { entries, settings: settings[0] || null }
}

/** The newest 100 messages, oldest first. */
export async function loadMessages() {
  const rows = await rest('pickleball_messages?select=id,entry_id,body,created_at&order=created_at.desc&limit=100')
  return rows.reverse()
}

async function call(method, path, body, headers = {}) {
  const r = await fetch(`${BACKEND}/pickleball/${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(data.error || `Request failed (${r.status})`)
    err.status = r.status
    throw err
  }
  return data
}

const tokenHeader = token => ({ 'X-Entry-Token': token || '' })
const pinHeader = pin => ({ 'X-Organizer-Pin': pin || '' })

export const getConfig = () => call('GET', 'config')
export const joinTournament = team => call('POST', 'join', team)
export const editEntry = (id, token, team) => call('PATCH', `entry/${id}`, team, tokenHeader(token))
export const leaveEntry = (id, token) => call('DELETE', `entry/${id}`, null, tokenHeader(token))
export const postMessage = (entryId, token, body) => call('POST', 'messages', { entry_id: entryId, body }, tokenHeader(token))

export const verifyPin = pin => call('POST', 'admin/verify', null, pinHeader(pin))
export const adminEditEntry = (pin, id, team) => call('PATCH', `admin/entry/${id}`, team, pinHeader(pin))
export const adminRemoveEntry = (pin, id) => call('DELETE', `admin/entry/${id}`, null, pinHeader(pin))
export const adminDeleteMessage = (pin, id) => call('DELETE', `admin/messages/${id}`, null, pinHeader(pin))
export const adminSaveSettings = (pin, settings) => call('PATCH', 'admin/settings', settings, pinHeader(pin))
