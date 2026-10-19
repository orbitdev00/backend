// Data access for chore mode. Reads go straight to the Supabase REST API with
// the anon key (read-only by RLS). Every write goes through the backend, which
// queues it in pending_changes until a reviewer approves it.

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

/** Everything needed to render [from, to] plus `today` (for the stats). */
export async function loadAll(from, to, today) {
  const range = `or=(and(date.gte.${from},date.lte.${to}),date.eq.${today})`
  const [members, chores, assignments, completions, settings, pending] = await Promise.all([
    rest('chore_members?select=id,name,color,active,created_at&order=created_at.asc'),
    rest('chores?select=id,title,frequency,zone,minutes,preferred_weekday,month_day,active,created_at&order=created_at.asc'),
    rest(`chore_assignments?select=chore_id,date,member_id&${range}`),
    rest(`chore_completions?select=chore_id,date&${range}`),
    rest('chore_settings?select=rotation_enabled&id=eq.1'),
    rest('pending_changes?select=id,change_type,target_id,payload,summary,submitted_at&status=eq.pending&order=submitted_at.asc'),
  ])
  return { members, chores, assignments, completions, settings: settings[0] || null, pending }
}

async function post(path, body) {
  const r = await fetch(`${BACKEND}${path}`, {
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

/** Queue a change. Returns the new pending_changes row. */
export async function submitChange(change_type, { target_id = null, payload = {}, summary }) {
  const { change } = await post('/chores/submit', { change_type, target_id, payload, summary })
  return change
}

export function reviewChanges(pin, action, ids) {
  return post('/chores/review', { pin, action, ids })
}
