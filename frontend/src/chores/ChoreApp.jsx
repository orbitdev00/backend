import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { configured, loadAll, submitChange } from './api.js'
import {
  WEEKDAYS, MONTHS, FREQ_LABEL, monthGrid, todayKey, buildView, pct,
} from './schedule.js'
import {
  DayModal, LibraryModal, ChoreFormModal, FamilyModal, ReviewModal,
} from './ChoreModals.jsx'
import './chores.css'

const POLL_MS = 15000
const MAX_PILLS = 4

export default function ChoreApp() {
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [live, setLive] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [freqFilter, setFreqFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const today = todayKey()
  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])

  const reload = useCallback(async () => {
    if (!configured) return
    try {
      const data = await loadAll(cells[0].key, cells[cells.length - 1].key, todayKey())
      setLive(data)
      setLoadError('')
    } catch (e) {
      setLoadError('Could not load the chore schedule. Retrying…')
    }
  }, [cells])

  useEffect(() => {
    reload()
    const id = setInterval(reload, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [reload])

  const notify = useCallback((message, kind = 'info') => {
    clearTimeout(toastTimer.current)
    setToast({ message, kind })
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  /** Queue a change for review and show it immediately as pending. */
  const submit = useCallback(async (changeType, opts) => {
    try {
      const row = await submitChange(changeType, opts)
      setLive(l => (l ? { ...l, pending: [...l.pending, row] } : l))
      notify(`Submitted for review: ${opts.summary}`)
      return true
    } catch (e) {
      notify(e.message || 'Could not submit change', 'error')
      return false
    }
  }, [notify])

  const view = useMemo(() => (live ? buildView(live) : null), [live])

  const matchesFilters = useCallback(task => {
    if (freqFilter !== 'all' && task.chore.frequency !== freqFilter) return false
    if (assigneeFilter !== 'all' && task.assignee?.id !== assigneeFilter) return false
    const q = search.trim().toLowerCase()
    if (q && !task.chore.title.toLowerCase().includes(q)
      && !(task.assignee?.name || '').toLowerCase().includes(q)) return false
    return true
  }, [search, assigneeFilter, freqFilter])

  const stats = useMemo(() => {
    if (!view) return null
    let monthDone = 0, monthTotal = 0
    for (const c of cells) {
      if (!c.inMonth) continue
      for (const t of view.tasksFor(c.key)) {
        if (t.chore.pending === 'add') continue
        monthTotal++
        if (t.liveDone) monthDone++
      }
    }
    const todays = view.tasksFor(today).filter(t => t.chore.pending !== 'add')
    return {
      monthPct: pct(monthDone, monthTotal),
      monthDone, monthTotal,
      todayDone: todays.filter(t => t.liveDone).length,
      todayTotal: todays.length,
      choreCount: live.chores.filter(c => c.active).length,
      memberCount: live.members.filter(m => m.active).length,
    }
  }, [view, cells, today, live])

  const shiftMonth = delta => setCursor(c => {
    const d = new Date(c.year, c.month + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const goToday = () => setCursor({ year: now.getFullYear(), month: now.getMonth() })

  const pendingCount = view?.pending.length || 0
  const close = () => setModal(null)

  if (!configured) {
    return (
      <div className="ch-app">
        <div className="ch-empty">
          Chore mode needs <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
        </div>
      </div>
    )
  }

  return (
    <div className="ch-app">
      <header className="ch-header">
        <div className="ch-header-text">
          <h1>Household Chore Dashboard (3 BD / 2 BR)</h1>
          <p>Interactive Schedule, Fair Rotation &amp; Chore Customization</p>
        </div>
        <div className="ch-header-actions">
          <button className="ch-btn ch-btn-light" onClick={() => setModal({ type: 'family', focusAdd: true })}>+ Add Family Member</button>
          <button className="ch-btn ch-btn-light" onClick={() => setModal({ type: 'family' })}>⚙️ Manage Family</button>
          <button className="ch-btn ch-btn-light" onClick={() => setModal({ type: 'library' })}>✏️ Manage Chores Library</button>
          <button className="ch-btn ch-btn-light" onClick={() => setModal({ type: 'choreForm' })}>+ Add New Chore</button>
          <button
            className={`ch-btn ch-btn-review${pendingCount ? ' has-pending' : ''}`}
            onClick={() => setModal({ type: 'review' })}
          >
            Review Changes ({pendingCount})
          </button>
        </div>
      </header>

      <main className="ch-main">
        {loadError && <div className="ch-banner ch-banner-error">{loadError}</div>}
        {view?.resetPending && (
          <div className="ch-banner ch-banner-pending">
            A reset to the default chores and family members is waiting for review.
          </div>
        )}

        <section className="ch-stats" aria-label="Progress overview">
          <div className="ch-stat">
            <span className="ch-stat-label">{MONTHS[cursor.month]} completion</span>
            <span className="ch-stat-value">{stats ? `${stats.monthPct}%` : '—'}</span>
            <div className="ch-progress"><div style={{ width: `${stats?.monthPct || 0}%` }} /></div>
            <span className="ch-stat-sub">{stats ? `${stats.monthDone} of ${stats.monthTotal} tasks` : ''}</span>
          </div>
          <div className="ch-stat">
            <span className="ch-stat-label">Today's tasks</span>
            <span className="ch-stat-value">{stats ? `${stats.todayDone} / ${stats.todayTotal}` : '—'}</span>
            <span className="ch-stat-sub">completed today</span>
          </div>
          <div className="ch-stat">
            <span className="ch-stat-label">Chores master list</span>
            <span className="ch-stat-value">{stats ? stats.choreCount : '—'}</span>
            <span className="ch-stat-sub">active chores</span>
          </div>
          <div className="ch-stat">
            <span className="ch-stat-label">Family members</span>
            <span className="ch-stat-value">{stats ? stats.memberCount : '—'}</span>
            <span className="ch-stat-sub">active</span>
          </div>
        </section>

        <section className="ch-toolbar" aria-label="Filters">
          <input
            className="ch-input ch-search"
            type="search"
            placeholder="Search tasks or assignees…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search tasks or assignees"
          />
          <select className="ch-input" value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)} aria-label="Filter by assignee">
            <option value="all">All Assignees</option>
            {view?.activeMembers.filter(m => m.pending !== 'add').map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <select className="ch-input" value={freqFilter} onChange={e => setFreqFilter(e.target.value)} aria-label="Filter by frequency">
            <option value="all">All Frequencies</option>
            <option value="daily">Daily Only</option>
            <option value="weekly">Weekly Only</option>
            <option value="monthly">Monthly Only</option>
          </select>
          <div className={`ch-rotation${view?.rotationPending ? ' is-pending' : ''}`}>
            <label className="ch-switch">
              <input
                type="checkbox"
                role="switch"
                checked={!!view?.rotationEnabled}
                disabled={!view}
                onChange={e => submit('rotation_toggle', {
                  payload: { rotation_enabled: e.target.checked },
                  summary: `Turn automated task rotation ${e.target.checked ? 'on' : 'off'}`,
                })}
              />
              <span className="ch-switch-track" aria-hidden="true"><span /></span>
              <span>Enable Automated Task Rotation</span>
            </label>
            {view?.rotationPending && <span className="ch-tag ch-tag-pending">Pending</span>}
            <span className="ch-tip">
              <button type="button" className="ch-tip-btn" aria-label="About task rotation" aria-describedby="rotation-tip">i</button>
              <span role="tooltip" id="rotation-tip" className="ch-tip-text">
                When enabled, weekly and daily assignments automatically shift across active family
                members to ensure fair workload distribution.
              </span>
            </span>
          </div>
        </section>

        <section className="ch-calendar" aria-label="Monthly calendar">
          <div className="ch-cal-head">
            <button className="ch-btn ch-btn-ghost" onClick={() => shiftMonth(-1)} aria-label="Previous Month">‹ <span className="ch-hide-sm">Previous Month</span></button>
            <h2>{MONTHS[cursor.month]} {cursor.year}</h2>
            <div className="ch-cal-nav">
              <button className="ch-btn ch-btn-ghost" onClick={goToday}>Today</button>
              <button className="ch-btn ch-btn-ghost" onClick={() => shiftMonth(1)} aria-label="Next Month"><span className="ch-hide-sm">Next Month</span> ›</button>
            </div>
          </div>
          <div className="ch-grid ch-weekdays">
            {WEEKDAYS.map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="ch-grid">
            {cells.map(cell => {
              const tasks = view ? view.tasksFor(cell.key).filter(matchesFilters) : []
              const done = tasks.filter(t => t.done).length
              const cls = ['ch-day']
              if (!cell.inMonth) cls.push('is-outside')
              if (cell.key === today) cls.push('is-today')
              if (tasks.length && done === tasks.length) cls.push('is-complete')
              return (
                <div
                  key={cell.key}
                  role="button"
                  tabIndex={0}
                  className={cls.join(' ')}
                  onClick={() => setModal({ type: 'day', date: cell.key })}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModal({ type: 'day', date: cell.key }) }
                  }}
                  aria-label={`${cell.key}: ${done} of ${tasks.length} tasks done`}
                >
                  <div className="ch-day-head">
                    <span className="ch-day-num">{cell.day}</span>
                    {tasks.length > 0 && <span className="ch-day-badge">{done}/{tasks.length}<span className="ch-hide-sm"> done</span></span>}
                  </div>
                  <div className="ch-pills">
                    {tasks.slice(0, MAX_PILLS).map(t => <TaskPill key={t.key} task={t} />)}
                    {tasks.length > MAX_PILLS && <span className="ch-more">+{tasks.length - MAX_PILLS} more</span>}
                  </div>
                  <div className="ch-dots" aria-hidden="true">
                    {tasks.map(t => (
                      <span key={t.key} className={t.done ? 'is-done' : ''} style={{ background: t.assignee?.color || '#94a3b8' }} />
                    ))}
                  </div>
                  {tasks.length > 0 && (
                    <div className="ch-progress ch-progress-sm"><div style={{ width: `${pct(done, tasks.length)}%` }} /></div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </main>

      {modal?.type === 'day' && view && (
        <DayModal date={modal.date} view={view} submit={submit} onClose={close} />
      )}
      {modal?.type === 'library' && view && (
        <LibraryModal
          view={view}
          submit={submit}
          onClose={close}
          onAdd={() => setModal({ type: 'choreForm', returnTo: 'library' })}
          onEdit={chore => setModal({ type: 'choreForm', chore, returnTo: 'library' })}
        />
      )}
      {modal?.type === 'choreForm' && view && (
        <ChoreFormModal
          chore={modal.chore}
          view={view}
          submit={submit}
          onClose={() => setModal(modal.returnTo ? { type: modal.returnTo } : null)}
        />
      )}
      {modal?.type === 'family' && view && (
        <FamilyModal view={view} submit={submit} focusAdd={modal.focusAdd} onClose={close} />
      )}
      {modal?.type === 'review' && view && (
        <ReviewModal view={view} onReviewed={reload} notify={notify} onClose={close} />
      )}

      {toast && (
        <div className={`ch-toast ch-toast-${toast.kind}`} role="status">{toast.message}</div>
      )}
    </div>
  )
}

function TaskPill({ task }) {
  const color = task.assignee?.color || '#94a3b8'
  const pending = task.chore.pending || task.assigneePending || task.donePending
  return (
    <span
      className={`ch-pill${task.done ? ' is-done' : ''}${pending ? ' is-pending' : ''}`}
      style={{ '--pill': color }}
      title={`${task.chore.title} — ${task.assignee?.name || 'Unassigned'} (${FREQ_LABEL[task.chore.frequency]})`}
    >
      <span className="ch-avatar-dot" />
      <span className="ch-pill-text">{task.chore.title}</span>
    </span>
  )
}
