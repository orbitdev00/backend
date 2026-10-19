// Pure scheduling helpers: dates, occurrences, rotation and pending-change overlay.
// Everything here is deterministic so every visitor sees the same calendar.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']
export const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }
export const MEMBER_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#64748b']

const pad = n => String(n).padStart(2, '0')

export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey() {
  return dateKey(new Date())
}

export function shortDate(key) {
  const d = parseKey(key)
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

export function longDate(key) {
  const d = parseKey(key)
  return `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`
}

// Whole days since 1970-01-01, independent of the viewer's time zone.
function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

/** The 35–42 cells (Sunday-start weeks) covering a month. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7)
  const cells = []
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    cells.push({ key: dateKey(d), day: d.getDate(), inMonth: d.getMonth() === month })
  }
  return cells
}

export function occursOn(chore, key) {
  const d = parseKey(key)
  if (chore.frequency === 'daily') return true
  if (chore.frequency === 'weekly') return d.getDay() === chore.preferred_weekday
  if (chore.frequency === 'monthly') {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    return d.getDate() === Math.min(chore.month_day || 1, last)
  }
  return false
}

export function scheduleLabel(chore) {
  if (chore.frequency === 'weekly') return `Every ${WEEKDAYS_LONG[chore.preferred_weekday] ?? '—'}`
  if (chore.frequency === 'monthly') return `Day ${chore.month_day} of month`
  return 'Every day'
}

const byCreated = (a, b) =>
  (a.created_at || '').localeCompare(b.created_at || '') || String(a.id).localeCompare(String(b.id))

/**
 * Rotation: chores are dealt across live active members by their position in
 * the chore list. With rotation on, daily chores shift by one member each day
 * and weekly chores each week. Monthly chores (and everything when rotation is
 * off) keep a fixed owner. Removing a member re-deals everything across the rest.
 */
export function makeAssigner(liveChores, liveMembers, rotationEnabled) {
  const members = liveMembers.filter(m => m.active).sort(byCreated)
  const order = new Map(liveChores.filter(c => c.active).sort(byCreated).map((c, i) => [c.id, i]))
  return (chore, key) => {
    if (!members.length) return null
    const i = order.has(chore.id) ? order.get(chore.id) : order.size
    let shift = 0
    if (rotationEnabled && chore.frequency === 'daily') shift = dayNumber(key)
    // 1970-01-01 was a Thursday; +4 aligns week numbers to Sunday-start weeks.
    if (rotationEnabled && chore.frequency === 'weekly') shift = Math.floor((dayNumber(key) + 4) / 7)
    return members[(i + shift) % members.length]
  }
}

const occKey = (choreId, key) => `${choreId}|${key}`

/**
 * Merge pending (unapproved) changes over the live data so the submitter sees
 * them right away. Anything only pending carries a `pending` marker.
 */
export function buildView(live) {
  const members = live.members.map(m => ({ ...m }))
  const chores = live.chores.filter(c => c.active).map(c => ({ ...c }))
  const overrides = new Map()
  const completions = new Map()
  for (const a of live.assignments) overrides.set(occKey(a.chore_id, a.date), { member_id: a.member_id })
  for (const c of live.completions) completions.set(occKey(c.chore_id, c.date), { done: true })

  let rotationEnabled = live.settings?.rotation_enabled ?? true
  let rotationPending = false
  let resetPending = false

  const pending = [...live.pending].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
  for (const pc of pending) {
    const p = pc.payload || {}
    switch (pc.change_type) {
      case 'chore_add':
        chores.push({ ...p, id: `pending:${pc.id}`, active: true, created_at: pc.submitted_at, pending: 'add' })
        break
      case 'chore_edit': {
        const c = chores.find(x => x.id === pc.target_id)
        if (c) Object.assign(c, p, { pending: c.pending || 'edit' })
        break
      }
      case 'chore_delete': {
        const c = chores.find(x => x.id === pc.target_id)
        if (c) c.pending = 'delete'
        break
      }
      case 'member_add':
        members.push({ ...p, id: `pending:${pc.id}`, active: true, created_at: pc.submitted_at, pending: 'add' })
        break
      case 'member_edit': {
        const m = members.find(x => x.id === pc.target_id)
        if (m) Object.assign(m, p, { pending: m.pending || 'edit' })
        break
      }
      case 'member_remove': {
        const m = members.find(x => x.id === pc.target_id)
        if (m) m.pending = 'remove'
        break
      }
      case 'assignment_set':
        overrides.set(occKey(p.chore_id, p.date), { member_id: p.member_id, pending: true })
        break
      case 'completion_set':
        completions.set(occKey(p.chore_id, p.date), { done: !!p.done, pending: true })
        break
      case 'rotation_toggle':
        rotationEnabled = !!p.rotation_enabled
        rotationPending = true
        break
      case 'reset_defaults':
        resetPending = true
        break
    }
  }

  const liveRotation = live.settings?.rotation_enabled ?? true
  const assign = makeAssigner(live.chores, live.members, liveRotation)
  const memberById = new Map(members.map(m => [m.id, m]))

  /** All chore occurrences on a date with their resolved assignee and status. */
  function tasksFor(key) {
    return chores
      .filter(c => occursOn(c, key))
      .map(chore => {
        const k = occKey(chore.id, key)
        const ov = overrides.get(k)
        const ovMember = ov && memberById.get(ov.member_id)
        const assignee = (ovMember && ovMember.active) ? ovMember
          : chore.pending === 'add' ? null
          : assign(chore, key)
        const comp = completions.get(k)
        return {
          key: k,
          date: key,
          chore,
          assignee: assignee ? memberById.get(assignee.id) || assignee : null,
          assigneePending: !!ov?.pending,
          done: !!comp?.done,
          donePending: !!comp?.pending,
          liveDone: live.completions.some(c => c.chore_id === chore.id && c.date === key),
        }
      })
  }

  return {
    members,
    activeMembers: members.filter(m => m.active),
    chores,
    rotationEnabled,
    rotationPending,
    resetPending,
    pending,
    tasksFor,
  }
}

export function pct(done, total) {
  return total ? Math.round((done / total) * 100) : 0
}
