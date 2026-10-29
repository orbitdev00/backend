// Pure scheduling helpers: dates, occurrences and points.
// Everything here is deterministic so every visitor sees the same calendar.
// Chores aren't assigned: anyone can claim an open one by checking it off.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']
export const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }
export const DIFFICULTY = {
  easy: { label: 'Easy', multiplier: 1 },
  medium: { label: 'Medium', multiplier: 1.5 },
  hard: { label: 'Hard', multiplier: 2 },
  extreme: { label: 'EXTREME', multiplier: 2.5, fixed: 75 },
}
export const TIME_ZONE = 'America/New_York'
const OVERDUE_AFTER_MIN = 60

const pad = n => String(n).padStart(2, '0')

export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

const nyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** Current date key and minutes since midnight in America/New_York. */
export function nyNow(at = new Date()) {
  const p = Object.fromEntries(nyFormat.formatToParts(at).map(x => [x.type, x.value]))
  return { key: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

export function todayKey() {
  return nyNow().key
}

/** Sunday that starts the week containing `key`. */
export function weekStart(key) {
  return addDays(key, -parseKey(key).getDay())
}

export function shortDate(key) {
  const d = parseKey(key)
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

export function longDate(key) {
  const d = parseKey(key)
  return `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`
}

/** "12:00:00" → "12:00 PM" */
export function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

function timeMinutes(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** points_override (set on every extreme chore) wins over minutes × multiplier. */
export function pointsFor(chore) {
  if (chore.points_override != null) return chore.points_override
  if (DIFFICULTY[chore.difficulty]?.fixed) return DIFFICULTY[chore.difficulty].fixed
  return Math.round(chore.minutes * (DIFFICULTY[chore.difficulty]?.multiplier ?? 1))
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

/** Whether a chore version applies on `key`: inside [starts_on, retired_on) and on its schedule. */
export function occursOn(chore, key) {
  if (chore.starts_on && key < chore.starts_on) return false
  if (chore.retired_on && key >= chore.retired_on) return false
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

const byCreated = (a, b) => {
  const x = a.created_at || '', y = b.created_at || ''
  if (x !== y) return x < y ? -1 : 1
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0
}

const occKey = (choreId, key) => `${choreId}|${key}`

export function buildView(live, now = nyNow()) {
  const members = live.members.filter(m => m.active).sort(byCreated)
  const memberById = new Map(live.members.map(m => [m.id, m]))
  const completions = new Map(live.completions.map(c => [occKey(c.chore_id, c.date), c]))
  const today = now.key
  const yesterday = addDays(today, -1)

  /** All chore occurrences on a date with who claimed them, if anyone. */
  function tasksFor(key) {
    return live.chores
      .filter(c => occursOn(c, key))
      .sort((a, b) => (a.time_of_day || '99').localeCompare(b.time_of_day || '99') || byCreated(a, b))
      .map(chore => {
        const k = occKey(chore.id, key)
        const comp = completions.get(k)
        const done = Boolean(comp)
        const overdue = !done && Boolean(chore.time_of_day) && (
          key < today || (key === today && now.minutes >= timeMinutes(chore.time_of_day) + OVERDUE_AFTER_MIN))
        return {
          key: k,
          date: key,
          chore,
          done,
          completedBy: comp ? memberById.get(comp.completed_by) || null : null,
          points: done ? comp.points_awarded : pointsFor(chore),
          overdue,
          checkable: key === today || key === yesterday,
        }
      })
  }

  return {
    members,
    chores: live.chores.filter(c => c.active).sort(byCreated),
    today,
    yesterday,
    tasksFor,
  }
}

export function pct(done, total) {
  return total ? Math.round((done / total) * 100) : 0
}
