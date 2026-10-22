// Notifications for this device. They're worked out on the client by comparing
// each poll (and the first load after a visit) with the last snapshot, and
// "per user" means per device: your teams are the ones whose edit token this
// device holds. Saved in localStorage; nothing is stored on the server.
import { MAX_TEAMS, teamName } from './bracket.js'
import { formatEventDate } from './teams.js'

const KEY = 'pb_notify'
const MAX_ITEMS = 40
const COLLAPSE_OVER = 3
const FIELDS = ['player_name', 'partner_name', 'skill_level', 'color']

export function emptyNotify() {
  return { entries: null, settings: null, wallInit: false, lastMessageAt: null, items: [], readAt: null, chatReadAt: null, alerts: false }
}

export function loadNotify() {
  try {
    return { ...emptyNotify(), ...(JSON.parse(localStorage.getItem(KEY)) || {}) }
  } catch {
    return emptyNotify()
  }
}

export function saveNotify(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* private mode */ }
}

export function snapshotEntries(entries) {
  return Object.fromEntries((entries || []).map(e => [e.id, {
    slot: e.slot, player_name: e.player_name, partner_name: e.partner_name, skill_level: e.skill_level, color: e.color,
  }]))
}

const stamp = (events, at) => events.map((e, i) => ({ at, ...e, id: `${e.kind}-${e.entryId || e.messageId || ''}-${e.at || at}-${i}` }))

/**
 * What changed in the bracket between two snapshots ({ entries, settings }).
 * `tokens`: this device's edit tokens by entry id. `ignore`: entry ids this
 * device just changed itself (no notification for your own edits).
 */
export function bracketEvents(prev, next, { tokens = {}, ignore = new Set(), now = new Date().toISOString() } = {}) {
  if (!prev?.entries) return []
  const events = []
  const joined = []
  for (const [id, e] of Object.entries(next.entries)) {
    const before = prev.entries[id]
    if (!before) {
      if (!tokens[id] && !ignore.has(id)) joined.push({ kind: 'joined', entryId: id, slot: e.slot, text: `${teamName(e)} joined · Slot ${e.slot}` })
    } else if (tokens[id] && !ignore.has(id) && FIELDS.some(f => before[f] !== e[f])) {
      events.push({ kind: 'edited', entryId: id, slot: e.slot, personal: true, text: 'The organizer updated your team' })
    }
  }
  events.push(...(joined.length > COLLAPSE_OVER
    ? [{ kind: 'joined', text: `${joined.length} new teams joined` }]
    : joined))

  for (const [id, e] of Object.entries(prev.entries)) {
    if (next.entries[id] || ignore.has(id)) continue
    if (tokens[id]) events.push({ kind: 'removed', entryId: id, personal: true, text: `The organizer removed your team, ${teamName(e)}` })
    else events.push({ kind: 'left', entryId: id, slot: e.slot, text: `${teamName(e)} left · Slot ${e.slot} is open` })
  }

  const before = Object.keys(prev.entries).length, after = Object.keys(next.entries).length
  if (before < MAX_TEAMS && after >= MAX_TEAMS) events.push({ kind: 'full', text: `All ${MAX_TEAMS} teams are in. The bracket is full!` })

  if (prev.settings && next.settings) {
    if (prev.settings.event_name !== next.settings.event_name) {
      events.push({ kind: 'event', text: `Event renamed to ${next.settings.event_name}` })
    }
    if (prev.settings.event_date !== next.settings.event_date) {
      events.push({ kind: 'event', text: next.settings.event_date ? `Event date set: ${formatEventDate(next.settings.event_date)}` : 'Event date cleared' })
    }
  }
  return stamp(events, now)
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** True when `body` names one of the team's players as a whole word (optionally with @). */
export function mentions(body, entry) {
  return [entry.player_name, entry.partner_name].some(name =>
    new RegExp(`(^|[^\\p{L}\\p{N}])@?${escapeRe(name)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(body))
}

const snippet = text => (text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text)

/**
 * Notifications for wall messages newer than `lastAt`. Mentions of your names
 * are always listed one by one; other messages collapse when there are many.
 * `skipPlain`: the chat is open, so plain messages are already being read.
 */
export function messageEvents(lastAt, rows, { owned = [], byId = {}, skipPlain = false } = {}) {
  if (!lastAt) return []
  const since = Date.parse(lastAt)
  const ownedIds = new Set(owned.map(e => e.id))
  const fresh = rows.filter(m => Date.parse(m.created_at) > since && !ownedIds.has(m.entry_id))
  const events = []
  const plain = []
  for (const m of fresh) {
    const team = byId[m.entry_id]
    const who = team ? teamName(team) : 'A team'
    if (owned.some(e => mentions(m.body, e))) {
      events.push({ kind: 'mention', messageId: m.id, at: m.created_at, personal: true, text: `${who} mentioned you: “${snippet(m.body)}”` })
    } else {
      plain.push({ kind: 'message', messageId: m.id, at: m.created_at, text: `${who}: ${snippet(m.body)}` })
    }
  }
  if (!skipPlain) {
    events.push(...(plain.length > COLLAPSE_OVER
      ? [{ kind: 'message', at: plain[plain.length - 1].at, text: `${plain.length} new chat messages` }]
      : plain))
  }
  return stamp(events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), new Date().toISOString())
}

/** Newest first, capped. */
export function addItems(items, events) {
  return [...events].reverse().concat(items).slice(0, MAX_ITEMS)
}

export function unreadCount(items, readAt) {
  const since = readAt ? Date.parse(readAt) : 0
  return items.filter(i => Date.parse(i.at) > since).length
}

export const ICONS = {
  joined: '👋', left: '🚪', edited: '✏️', removed: '⚠️', message: '💬', mention: '📣', full: '🏆', event: '📅',
}
