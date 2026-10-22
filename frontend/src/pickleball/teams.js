// Team helpers shared by the page, the canvas export and the tests.
// The 8 team colors come from the backend (GET /pickleball/config), the one
// place they're defined.

export const SKILLS = [
  { id: 'beginner', label: 'Beginner', short: 'BEG' },
  { id: 'intermediate', label: 'Intermediate', short: 'INT' },
  { id: 'advanced', label: 'Advanced', short: 'ADV' },
]
export const skillOf = id => SKILLS.find(x => x.id === id) || SKILLS[0]

export const NAME_MIN = 2
export const NAME_MAX = 30
export const MESSAGE_MAX = 200

export const cleanName = value => String(value || '').split(/\s+/).filter(Boolean).join(' ')

/**
 * Client-side check before sending (the backend checks again).
 * `entries` are the teams already in, `selfId` the team being edited.
 * Returns { player_name?, partner_name? } error messages, empty when valid.
 */
export function teamErrors({ player_name, partner_name }, entries = [], selfId = null) {
  const errors = {}
  const player = cleanName(player_name), partner = cleanName(partner_name)
  for (const [key, value, label] of [['player_name', player, 'Your name'], ['partner_name', partner, 'Partner name']]) {
    if (value.length < NAME_MIN || value.length > NAME_MAX) errors[key] = `${label} must be ${NAME_MIN} to ${NAME_MAX} characters`
  }
  if (!errors.partner_name && player && player.toLowerCase() === partner.toLowerCase()) {
    errors.partner_name = 'You and your partner need different names'
  }
  const taken = new Set(entries.filter(e => e.id !== selfId)
    .flatMap(e => [e.player_name.toLowerCase(), e.partner_name.toLowerCase()]))
  if (!errors.player_name && taken.has(player.toLowerCase())) errors.player_name = `${player} is already in the tournament`
  if (!errors.partner_name && taken.has(partner.toLowerCase())) errors.partner_name = `${partner} is already in the tournament`
  return errors
}

export function relativeTime(iso, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "2026-11-14" → "Saturday, November 14, 2026" (no timezone shift). */
export function formatEventDate(value) {
  if (!value) return ''
  const [y, mo, d] = value.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Edit tokens ──────────────────────────────────────────────────────────────
// Kept in localStorage and in a 1-year cookie per entry, so either one can
// restore ownership if the other is cleared.

const STORE_KEY = 'pb_tokens'
const COOKIE_PREFIX = 'pb_t_'
const ONE_YEAR = 60 * 60 * 24 * 365

function readLocal() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {} } catch { return {} }
}

function writeLocal(map) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(map)) } catch { /* private mode */ }
}

export function readTokens() {
  const tokens = readLocal()
  for (const part of document.cookie.split('; ')) {
    if (!part.startsWith(COOKIE_PREFIX)) continue
    const [key, value] = part.split('=')
    const id = key.slice(COOKIE_PREFIX.length)
    if (id && value && !tokens[id]) tokens[id] = decodeURIComponent(value)
  }
  return tokens
}

export function saveToken(id, token) {
  writeLocal({ ...readLocal(), [id]: token })
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_PREFIX}${id}=${encodeURIComponent(token)}; Max-Age=${ONE_YEAR}; Path=/pickleball; SameSite=Strict${secure}`
}

export function forgetToken(id) {
  const map = readLocal()
  delete map[id]
  writeLocal(map)
  document.cookie = `${COOKIE_PREFIX}${id}=; Max-Age=0; Path=/pickleball; SameSite=Strict`
}

// Organizer PIN: this tab only.
const PIN_KEY = 'pb_pin'
export function readPin() {
  try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' }
}
export function savePin(pin) {
  try { pin ? sessionStorage.setItem(PIN_KEY, pin) : sessionStorage.removeItem(PIN_KEY) } catch { /* ignore */ }
}
