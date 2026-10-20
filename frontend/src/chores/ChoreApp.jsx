import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { configured, loadAll, submitChange, readUserCookie, writeUserCookie } from './api.js'
import {
  WEEKDAYS, MONTHS, FREQ_LABEL, monthGrid, nyNow, addDays, buildView, pct, pointsFor,
} from './schedule.js'
import { DayModal, LibraryModal, ChoreFormModal, TaskMeta, Avatar, Flame } from './ChoreModals.jsx'
import './chores.css'

const POLL_MS = 15000
const CLOCK_MS = 60000
const MAX_PILLS = 4

export default function ChoreApp() {
  const [now, setNow] = useState(nyNow)
  const [cursor, setCursor] = useState(() => {
    const [y, m] = nyNow().key.split('-').map(Number)
    return { year: y, month: m - 1 }
  })
  const [live, setLive] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [meId, setMeId] = useState(readUserCookie)
  const [tab, setTab] = useState('day')
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [freqFilter, setFreqFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [justDone, setJustDone] = useState(null)
  const toastTimer = useRef(null)

  const today = now.key
  const yesterday = addDays(today, -1)
  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])

  const reload = useCallback(async () => {
    if (!configured) return
    try {
      const t = nyNow().key
      const data = await loadAll(cells[0].key, cells[cells.length - 1].key, addDays(t, -1), t)
      setLive(data)
      setLoadError('')
    } catch (e) {
      setLoadError('Could not load the chore schedule. Retrying…')
    }
  }, [cells])

  useEffect(() => {
    reload()
    const id = setInterval(reload, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') { setNow(nyNow()); reload() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [reload])

  // Keeps "today" and overdue styling current, and refetches when the day rolls over.
  useEffect(() => {
    const id = setInterval(() => setNow(n => {
      const next = nyNow()
      return next.key === n.key && next.minutes === n.minutes ? n : next
    }), CLOCK_MS)
    return () => clearInterval(id)
  }, [])
  useEffect(() => { reload() }, [today]) // eslint-disable-line react-hooks/exhaustive-deps

  const notify = useCallback((message, kind = 'info') => {
    clearTimeout(toastTimer.current)
    setToast({ message, kind, id: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  /** Apply a change through the backend, then refresh. Returns the result or null. */
  const submit = useCallback(async (changeType, opts) => {
    try {
      const result = await submitChange(changeType, opts)
      if (opts?.message) notify(opts.message)
      reload()
      return result
    } catch (e) {
      notify(e.message || 'Could not save change', 'error')
      reload()
      return null
    }
  }, [notify, reload])

  const view = useMemo(() => (live ? buildView(live, now) : null), [live, now])
  const me = view?.members.find(m => m.id === meId) || null

  const pickMe = id => {
    writeUserCookie(id)
    setMeId(id)
    setTab('day')
  }

  const toggle = useCallback(async task => {
    if (!me || task.assignee?.id !== me.id || !task.checkable) return
    const done = !task.done
    // Optimistic: flip it now, the reload after submit brings the real row.
    setLive(l => {
      if (!l) return l
      const rest = l.completions.filter(c => !(c.chore_id === task.chore.id && c.date === task.date))
      return {
        ...l,
        completions: done
          ? [...rest, { chore_id: task.chore.id, date: task.date, completed_by: me.id, points_awarded: pointsFor(task.chore) }]
          : rest,
      }
    })
    if (done) setJustDone(task.key)
    const result = await submit('completion_set', {
      payload: { chore_id: task.chore.id, date: task.date, done, member_id: me.id },
    })
    if (result?.done && !result.already) notify(`+${result.points} pts`, 'points')
  }, [me, submit, notify])

  const matchesFilters = useCallback(task => {
    if (freqFilter !== 'all' && task.chore.frequency !== freqFilter) return false
    if (assigneeFilter !== 'all' && task.assignee?.id !== assigneeFilter) return false
    const q = search.trim().toLowerCase()
    if (q && !task.chore.title.toLowerCase().includes(q)
      && !(task.assignee?.name || '').toLowerCase().includes(q)) return false
    return true
  }, [search, assigneeFilter, freqFilter])

  const shiftMonth = delta => setCursor(c => {
    const d = new Date(c.year, c.month + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const goToday = () => {
    const [y, m] = today.split('-').map(Number)
    setCursor({ year: y, month: m - 1 })
  }
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

  if (!view) {
    return (
      <div className="ch-app">
        <div className="ch-empty">{loadError || 'Loading…'}</div>
      </div>
    )
  }

  if (!me) return <WhoAreYou members={view.members} onPick={pickMe} />

  const board = live.leaderboard || []
  const myRow = board.find(r => r.member_id === me.id)

  return (
    <div className="ch-app">
      <header className="ch-header">
        <h1>Matos Dashboard</h1>
        <div className="ch-header-actions">
          <label className="ch-me">
            <Avatar member={me} size={28} />
            <select className="ch-me-select" value={me.id} onChange={e => pickMe(e.target.value)} aria-label="Who are you?">
              {view.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button className="ch-btn ch-btn-light" onClick={() => setModal({ type: 'library' })}>Chores Library</button>
        </div>
      </header>

      <nav className="ch-tabs ch-top-tabs" role="tablist" aria-label="Views">
        <TabButton id="day" tab={tab} setTab={setTab} active={tab === 'day' || tab === 'board'}>My Day</TabButton>
        <TabButton id="calendar" tab={tab} setTab={setTab}>Calendar</TabButton>
      </nav>

      <main className="ch-main">
        {loadError && <div className="ch-banner ch-banner-error">{loadError}</div>}

        {tab !== 'calendar' && (
          <div className={`ch-home${tab === 'board' ? ' show-board' : ''}`}>
            <MyDay
              me={me}
              tasks={view.tasksFor(today).filter(t => t.assignee?.id === me.id)}
              row={myRow}
              justDone={justDone}
              onToggle={toggle}
              onOpenDay={() => setModal({ type: 'day', date: today })}
            />
            <Leaderboard rows={board} meId={me.id} />
          </div>
        )}

        {tab === 'calendar' && (
          <>
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
                {view.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select className="ch-input" value={freqFilter} onChange={e => setFreqFilter(e.target.value)} aria-label="Filter by frequency">
                <option value="all">All Frequencies</option>
                <option value="daily">Daily Only</option>
                <option value="weekly">Weekly Only</option>
                <option value="monthly">Monthly Only</option>
              </select>
              <div className="ch-rotation">
                <label className="ch-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={view.rotationEnabled}
                    onChange={e => submit('rotation_toggle', {
                      payload: { rotation_enabled: e.target.checked },
                      message: `Task rotation turns ${e.target.checked ? 'on' : 'off'} starting tomorrow`,
                    })}
                  />
                  <span className="ch-switch-track" aria-hidden="true"><span /></span>
                  <span>Automated Task Rotation</span>
                </label>
                <span className="ch-tip">
                  <button type="button" className="ch-tip-btn" aria-label="About task rotation" aria-describedby="rotation-tip">i</button>
                  <span role="tooltip" id="rotation-tip" className="ch-tip-text">
                    When on, daily and weekly chores shift across the people allowed to do them so the work
                    stays fair. Changes take effect tomorrow, so today and past days never reshuffle.
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
                  const tasks = view.tasksFor(cell.key).filter(matchesFilters)
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
          </>
        )}
      </main>

      <nav className="ch-bottom-bar" aria-label="Views">
        <BottomTab id="day" tab={tab} setTab={setTab} icon="☀️">My Day</BottomTab>
        <BottomTab id="calendar" tab={tab} setTab={setTab} icon="📅">Calendar</BottomTab>
        <BottomTab id="board" tab={tab} setTab={setTab} icon="🏆">Leaderboard</BottomTab>
      </nav>

      {modal?.type === 'day' && (
        <DayModal date={modal.date} view={view} me={me} justDone={justDone} onToggle={toggle} submit={submit} onClose={close} />
      )}
      {modal?.type === 'library' && (
        <LibraryModal
          view={view}
          submit={submit}
          onClose={close}
          onAdd={() => setModal({ type: 'choreForm', returnTo: 'library' })}
          onEdit={chore => setModal({ type: 'choreForm', chore, returnTo: 'library' })}
        />
      )}
      {modal?.type === 'choreForm' && (
        <ChoreFormModal
          chore={modal.chore}
          view={view}
          submit={submit}
          onClose={() => setModal(modal.returnTo ? { type: modal.returnTo } : null)}
        />
      )}

      {toast && (
        <div key={toast.id} className={`ch-toast ch-toast-${toast.kind}`} role="status">{toast.message}</div>
      )}
    </div>
  )
}

function TabButton({ id, tab, setTab, active, children }) {
  const on = active ?? tab === id
  return (
    <button role="tab" aria-selected={on} className={`ch-tab${on ? ' is-active' : ''}`} onClick={() => setTab(id)}>
      {children}
    </button>
  )
}

function BottomTab({ id, tab, setTab, icon, children }) {
  return (
    <button className={`ch-bottom-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </button>
  )
}

function WhoAreYou({ members, onPick }) {
  return (
    <div className="ch-who">
      <h1>Matos Dashboard</h1>
      <h2>Who are you?</h2>
      <div className="ch-who-grid">
        {members.map(m => (
          <button key={m.id} className="ch-who-btn" style={{ '--who': m.color }} onClick={() => onPick(m.id)}>
            <Avatar member={m} size={56} />
            <span>{m.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MyDay({ me, tasks, row, justDone, onToggle, onOpenDay }) {
  const done = tasks.filter(t => t.done).length
  const streak = row?.streak || 0
  return (
    <section className="ch-card ch-myday" aria-label="My Day">
      <div className="ch-myday-head">
        <h2>Hi {me.name}</h2>
        <button className="ch-btn ch-btn-ghost ch-btn-sm" onClick={onOpenDay}>Everyone's tasks</button>
      </div>
      <div className="ch-summary">
        <div className="ch-summary-item">
          <span className="ch-summary-value">{done}/{tasks.length}</span>
          <span className="ch-summary-label">tasks done today</span>
        </div>
        <div className="ch-summary-item">
          <span className="ch-summary-value">{row?.points_today ?? 0}</span>
          <span className="ch-summary-label">points today</span>
        </div>
        <div className="ch-summary-item">
          <span className="ch-summary-value">{streak >= 2 ? <Flame days={streak} /> : streak}</span>
          <span className="ch-summary-label">day streak</span>
        </div>
      </div>
      <div className="ch-progress"><div style={{ width: `${pct(done, tasks.length)}%` }} /></div>

      {tasks.length === 0 && <p className="ch-muted ch-myday-empty">Nothing assigned to you today. Enjoy it!</p>}
      {tasks.length > 0 && done === tasks.length && <p className="ch-myday-done">All done for today 🎉</p>}
      <ul className="ch-mytasks">
        {tasks.map(t => (
          <li key={t.key}>
            <button
              className={`ch-mytask${t.done ? ' is-done' : ''}${t.overdue ? ' is-overdue' : ''}${justDone === t.key && t.done ? ' just-done' : ''}`}
              onClick={() => onToggle(t)}
              role="checkbox"
              aria-checked={t.done}
            >
              <span className="ch-check-circle" aria-hidden="true">✓</span>
              <span className="ch-mytask-body">
                <span className="ch-mytask-title">{t.chore.title}</span>
                {t.chore.description && <span className="ch-mytask-desc">{t.chore.description}</span>}
                <TaskMeta task={t} />
              </span>
              <span className="ch-points-badge">{t.points} pts</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Leaderboard({ rows, meId }) {
  const [mode, setMode] = useState('week')
  const key = mode === 'week' ? 'points_week' : 'points_all'
  const sorted = [...rows].sort((a, b) => b[key] - a[key] || b.streak - a.streak || a.name.localeCompare(b.name))
  return (
    <section className="ch-card ch-board" aria-label="Leaderboard">
      <div className="ch-board-head">
        <h2>Leaderboard</h2>
        <div className="ch-seg" role="tablist" aria-label="Leaderboard period">
          <button role="tab" aria-selected={mode === 'week'} className={mode === 'week' ? 'is-active' : ''} onClick={() => setMode('week')}>This Week</button>
          <button role="tab" aria-selected={mode === 'all'} className={mode === 'all' ? 'is-active' : ''} onClick={() => setMode('all')}>All Time</button>
        </div>
      </div>
      <ol className="ch-board-list">
        {sorted.map((r, i) => (
          <li key={r.member_id} className={`ch-board-row${r.member_id === meId ? ' is-me' : ''}`}>
            <span className="ch-board-rank">{i + 1}</span>
            <span className="ch-board-dot" style={{ background: r.color }} aria-hidden="true" />
            <span className="ch-board-name">
              {r.name}
              {r.streak >= 2 && <Flame days={r.streak} />}
            </span>
            <span className="ch-board-points">{r[key]} <small>pts</small></span>
          </li>
        ))}
      </ol>
      {mode === 'week' && <p className="ch-note">Resets every Sunday.</p>}
    </section>
  )
}

function TaskPill({ task }) {
  const color = task.assignee?.color || '#94a3b8'
  return (
    <span
      className={`ch-pill${task.done ? ' is-done' : ''}${task.overdue ? ' is-overdue' : ''}`}
      style={{ '--pill': color }}
      title={`${task.chore.title} — ${task.assignee?.name || 'Unassigned'} (${FREQ_LABEL[task.chore.frequency]})`}
    >
      <span className="ch-avatar-dot" />
      <span className="ch-pill-text">{task.chore.title}</span>
    </span>
  )
}
