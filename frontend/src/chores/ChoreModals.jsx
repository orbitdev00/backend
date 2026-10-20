import { useEffect, useMemo, useRef, useState } from 'react'
import {
  WEEKDAYS, WEEKDAYS_LONG, FREQ_LABEL, DIFFICULTY, longDate, shortDate, scheduleLabel, pct, formatTime, pointsFor,
} from './schedule.js'

function Modal({ title, subtitle, onClose, children, footer, wide }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Runs once per open so background polling re-renders don't steal focus.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector('[data-autofocus]')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [])
  return (
    <div className="ch-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`ch-modal${wide ? ' ch-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="ch-modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <div className="ch-modal-sub">{subtitle}</div>}
          </div>
          <button className="ch-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ch-modal-body">{children}</div>
        {footer && <div className="ch-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Avatar({ member, size = 28 }) {
  const initial = (member?.name || '?').trim().charAt(0).toUpperCase()
  return (
    <span className="ch-avatar" style={{ background: member?.color || '#94a3b8', width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {initial}
    </span>
  )
}

export function Flame({ days }) {
  return <span className="ch-flame" title={`${days} day streak`}>🔥{days}</span>
}

export function TaskMeta({ task, showFrequency }) {
  const c = task.chore
  return (
    <span className="ch-task-meta">
      {task.overdue && <span className="ch-tag ch-tag-overdue">Overdue</span>}
      {c.time_of_day && <span className="ch-tag ch-tag-time">{formatTime(c.time_of_day)}</span>}
      <span className="ch-tag">{c.minutes}m</span>
      <span className={`ch-tag ch-tag-${c.difficulty}`}>{DIFFICULTY[c.difficulty]?.label}</span>
      {showFrequency && <span className={`ch-tag ch-tag-${c.frequency}`}>{FREQ_LABEL[c.frequency]}</span>}
      <span className="ch-tag ch-tag-zone">{c.zone}</span>
    </span>
  )
}

// ── Day detail ───────────────────────────────────────────────────────────────

export function DayModal({ date, view, me, justDone, onToggle, submit, onClose }) {
  const tasks = view.tasksFor(date)
  const done = tasks.filter(t => t.done).length
  const progress = pct(done, tasks.length)
  const when = shortDate(date)
  const canReassign = date >= view.yesterday

  const reassign = (t, memberId) => {
    const m = view.members.find(x => x.id === memberId)
    if (!m) return
    submit('assignment_set', {
      payload: { chore_id: t.chore.id, date, member_id: m.id },
      message: `'${t.chore.title}' on ${when} → ${m.name}`,
    })
  }
  const remove = t => {
    if (!window.confirm(`Delete '${t.chore.title}' from the chore library? Points already earned are kept.`)) return
    submit('chore_delete', { target_id: t.chore.id, message: `Deleted '${t.chore.title}'` })
  }

  return (
    <Modal title={`Tasks for ${longDate(date)}`} subtitle={`${progress}% complete · ${done} of ${tasks.length} done`} onClose={onClose}>
      <div className="ch-progress ch-progress-lg"><div style={{ width: `${progress}%` }} /></div>
      {tasks.length === 0 && <p className="ch-muted">No chores scheduled for this day.</p>}
      <ul className="ch-task-list">
        {tasks.map(t => {
          const mine = t.assignee?.id === me.id
          const canCheck = mine && t.checkable
          const why = !t.checkable ? (date > view.today ? 'Can’t check off future tasks' : 'Only today and yesterday can be checked off')
            : !mine ? `Only ${t.assignee?.name || 'the assignee'} can check this off` : ''
          return (
            <li key={t.key} className={`ch-task${t.done ? ' is-done' : ''}${t.overdue ? ' is-overdue' : ''}${!canCheck ? ' is-locked' : ''}`}>
              <button
                className={`ch-check${t.done ? ' is-checked' : ''}${justDone === t.key && t.done ? ' just-done' : ''}`}
                onClick={() => onToggle(t)}
                disabled={!canCheck}
                role="checkbox"
                aria-checked={t.done}
                aria-label={canCheck ? `Mark ${t.chore.title} ${t.done ? 'not done' : 'done'}` : why}
                title={why || undefined}
              >
                <span>{canCheck || t.done ? '✓' : '🔒'}</span>
              </button>
              <div className="ch-task-main">
                <div className="ch-task-title">{t.chore.title}</div>
                {t.chore.description && <div className="ch-task-desc">{t.chore.description}</div>}
                <TaskMeta task={t} showFrequency />
              </div>
              <div className="ch-task-actions">
                <span className="ch-points-badge">{t.points} pts</span>
                <span className="ch-assignee">
                  <Avatar member={t.assignee} size={24} />
                  <select
                    className="ch-input ch-input-sm"
                    value={t.assignee?.id || ''}
                    disabled={!canReassign || t.done || !view.members.length}
                    title={t.done ? 'Uncheck it first to reassign' : !canReassign ? 'Past tasks can’t be reassigned' : undefined}
                    onChange={e => reassign(t, e.target.value)}
                    aria-label={`Assignee for ${t.chore.title}`}
                  >
                    {!t.assignee && <option value="">Unassigned</option>}
                    {view.members.map(m => <option key={m.id} value={m.id}>{m.name}{m.id === me.id ? ' (me)' : ''}</option>)}
                  </select>
                </span>
                {t.chore.active && (
                  <button className="ch-icon-btn ch-danger" onClick={() => remove(t)} aria-label={`Delete ${t.chore.title}`}>🗑</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="ch-note">You can check off your own tasks for today and yesterday.</p>
    </Modal>
  )
}

// ── Chores library ───────────────────────────────────────────────────────────

export function LibraryModal({ view, submit, onClose, onAdd, onEdit }) {
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const chores = view.chores
    .filter(c => tab === 'all' || c.frequency === tab)
    .filter(c => {
      const s = q.trim().toLowerCase()
      return !s || c.title.toLowerCase().includes(s) || c.zone.toLowerCase().includes(s)
    })
  const counts = useMemo(() => {
    const out = { all: view.chores.length, daily: 0, weekly: 0, monthly: 0 }
    for (const c of view.chores) out[c.frequency]++
    return out
  }, [view.chores])
  const names = ids => view.members.filter(m => ids.includes(m.id)).map(m => m.name).join(' & ')

  const remove = c => {
    if (!window.confirm(`Delete '${c.title}'? It disappears from today on. Points already earned are kept.`)) return
    submit('chore_delete', { target_id: c.id, message: `Deleted '${c.title}'` })
  }
  const reset = () => {
    if (!window.confirm('Reset the chore list and family members to the defaults? Points, streaks and check-offs are kept.')) return
    submit('reset_defaults', { message: 'Chores and family members reset to the defaults' })
  }

  return (
    <Modal title="Chores Library" onClose={onClose} wide>
      <div className="ch-lib-top">
        <div className="ch-tabs" role="tablist">
          {['all', 'daily', 'weekly', 'monthly'].map(t => (
            <button key={t} role="tab" aria-selected={tab === t} className={`ch-tab${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)}>
              {t === 'all' ? 'All Chores' : FREQ_LABEL[t]} <span className="ch-tab-count">{counts[t]}</span>
            </button>
          ))}
        </div>
        <button className="ch-btn ch-btn-primary" onClick={onAdd}>+ Add New Chore</button>
      </div>
      <input className="ch-input ch-lib-search" type="search" placeholder="Search chores or rooms…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search chores" data-autofocus />
      {chores.length === 0 && <p className="ch-muted">No chores match.</p>}
      <div className="ch-lib-list">
        {chores.map(c => (
          <div key={c.id} className="ch-lib-card">
            <div className="ch-lib-main">
              <div className="ch-task-title">{c.title}</div>
              {c.description && <div className="ch-task-desc">{c.description}</div>}
              <div className="ch-task-meta">
                <span className={`ch-tag ch-tag-${c.frequency}`}>{FREQ_LABEL[c.frequency]}</span>
                <span className="ch-tag">{scheduleLabel(c)}</span>
                {c.time_of_day && <span className="ch-tag ch-tag-time">{formatTime(c.time_of_day)}</span>}
                <span className="ch-tag ch-tag-zone">{c.zone}</span>
                <span className="ch-tag">{c.minutes}m</span>
                <span className={`ch-tag ch-tag-${c.difficulty}`}>{DIFFICULTY[c.difficulty]?.label}</span>
                <span className="ch-tag ch-tag-points">{pointsFor(c)} pts</span>
                {c.allowed_member_ids && <span className="ch-tag">{names(c.allowed_member_ids)} only</span>}
                {c.starts_on > view.today && <span className="ch-tag">Starts {shortDate(c.starts_on)}</span>}
              </div>
            </div>
            <div className="ch-lib-actions">
              <button className="ch-btn ch-btn-ghost" onClick={() => onEdit(c)}>Edit</button>
              <button className="ch-btn ch-btn-ghost ch-danger" onClick={() => remove(c)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      <div className="ch-settings">
        <h4>Settings</h4>
        <p className="ch-muted">Restore the default chores and family members. Points, streaks and check-offs are kept.</p>
        <button className="ch-btn ch-btn-ghost ch-danger" onClick={reset}>Reset Default Data</button>
      </div>
    </Modal>
  )
}

// ── Add / edit chore ─────────────────────────────────────────────────────────

const SCHEDULE_NOTE = 'Schedule changes start tomorrow, so today and past days stay as they were.'

export function ChoreFormModal({ chore, view, submit, onClose }) {
  const editing = Boolean(chore)
  const [form, setForm] = useState(() => ({
    title: chore?.title || '',
    description: chore?.description || '',
    frequency: chore?.frequency || 'weekly',
    zone: chore?.zone || 'General',
    minutes: chore?.minutes || 15,
    difficulty: chore?.difficulty || 'easy',
    time_of_day: chore?.time_of_day ? chore.time_of_day.slice(0, 5) : '',
    preferred_weekday: chore?.preferred_weekday ?? 1,
    month_day: chore?.month_day ?? 1,
    allowed: chore?.allowed_member_ids || view.members.map(m => m.id),
  }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const zones = useMemo(() => [...new Set(view.chores.map(c => c.zone))].sort(), [view.chores])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleMember = id => set('allowed', form.allowed.includes(id) ? form.allowed.filter(x => x !== id) : [...form.allowed, id])
  const minutes = Number(form.minutes)
  const preview = Number.isInteger(minutes) && minutes > 0 ? pointsFor({ minutes, difficulty: form.difficulty }) : 0

  const onSubmit = async e => {
    e.preventDefault()
    const everyone = view.members.every(m => form.allowed.includes(m.id))
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      frequency: form.frequency,
      zone: form.zone.trim(),
      minutes,
      difficulty: form.difficulty,
      time_of_day: form.time_of_day || null,
      preferred_weekday: form.frequency === 'weekly' ? Number(form.preferred_weekday) : null,
      month_day: form.frequency === 'monthly' ? Number(form.month_day) : null,
      allowed_member_ids: everyone ? null : view.members.filter(m => form.allowed.includes(m.id)).map(m => m.id),
    }
    if (!payload.title) return setError('Give the chore a title.')
    if (!payload.zone) return setError('Choose a zone or room.')
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return setError('Time must be 1–600 minutes.')
    if (payload.frequency === 'monthly' && !(payload.month_day >= 1 && payload.month_day <= 31)) return setError('Day of month must be 1–31.')
    if (!form.allowed.length) return setError('Pick at least one person who can do this chore.')

    setBusy(true)
    const result = await submit(editing ? 'chore_edit' : 'chore_add', {
      target_id: editing ? chore.id : null,
      payload,
      message: editing
        ? `Saved '${payload.title}'`
        : `Added '${payload.title}'${payload.frequency === 'weekly' ? ` (${WEEKDAYS[payload.preferred_weekday]})` : ''}`,
    })
    setBusy(false)
    if (result) onClose()
  }

  return (
    <Modal title={editing ? 'Edit Chore' : 'Add New Chore'} onClose={onClose}>
      <form className="ch-form" onSubmit={onSubmit}>
        <label>Title
          <input className="ch-input" value={form.title} maxLength={120} onChange={e => set('title', e.target.value)} data-autofocus required />
        </label>
        <label>Description
          <textarea className="ch-input ch-textarea" value={form.description} maxLength={500} rows={2} onChange={e => set('description', e.target.value)} placeholder="Optional: what does this involve?" />
        </label>
        <div className="ch-form-row">
          <label>Frequency
            <select className="ch-input" value={form.frequency} onChange={e => set('frequency', e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          {form.frequency === 'weekly' && (
            <label>Preferred day
              <select className="ch-input" value={form.preferred_weekday} onChange={e => set('preferred_weekday', Number(e.target.value))}>
                {WEEKDAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
          )}
          {form.frequency === 'monthly' && (
            <label>Day of month
              <input className="ch-input" type="number" min="1" max="31" value={form.month_day} onChange={e => set('month_day', e.target.value)} />
            </label>
          )}
          <label>Time of day
            <input className="ch-input" type="time" value={form.time_of_day} onChange={e => set('time_of_day', e.target.value)} />
          </label>
        </div>
        <div className="ch-form-row">
          <label>Zone / Room
            <input className="ch-input" list="ch-zones" value={form.zone} maxLength={40} onChange={e => set('zone', e.target.value)} required />
            <datalist id="ch-zones">{zones.map(z => <option key={z} value={z} />)}</datalist>
          </label>
          <label>Time estimate (minutes)
            <input className="ch-input" type="number" min="1" max="600" value={form.minutes} onChange={e => set('minutes', e.target.value)} required />
          </label>
          <label>Difficulty
            <select className="ch-input" value={form.difficulty} onChange={e => set('difficulty', e.target.value)}>
              {Object.entries(DIFFICULTY).map(([k, d]) => <option key={k} value={k}>{d.label} ({d.multiplier}x)</option>)}
            </select>
          </label>
        </div>
        <fieldset className="ch-fieldset">
          <legend>Who can do it</legend>
          <div className="ch-member-checks">
            {view.members.map(m => (
              <label key={m.id} className={`ch-member-check${form.allowed.includes(m.id) ? ' is-on' : ''}`} style={{ '--who': m.color }}>
                <input type="checkbox" checked={form.allowed.includes(m.id)} onChange={() => toggleMember(m.id)} />
                <Avatar member={m} size={22} />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="ch-points-preview">Worth <strong>{preview} pts</strong> each time it’s done</div>
        {error && <div className="ch-form-error">{error}</div>}
        <div className="ch-form-actions">
          <button type="button" className="ch-btn ch-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="ch-btn ch-btn-primary" disabled={busy}>{editing ? 'Save Changes' : 'Add Chore'}</button>
        </div>
        <p className="ch-note">{editing ? `${SCHEDULE_NOTE} New points values apply to future check-offs only.` : 'Points already earned never change.'}</p>
      </form>
    </Modal>
  )
}
