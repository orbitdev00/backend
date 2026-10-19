import { useEffect, useMemo, useRef, useState } from 'react'
import { reviewChanges } from './api.js'
import {
  WEEKDAYS, WEEKDAYS_LONG, FREQ_LABEL, MEMBER_COLORS, longDate, shortDate, scheduleLabel, pct,
} from './schedule.js'

const PIN_KEY = 'chore-approval-pin'
const isPendingId = id => String(id).startsWith('pending:')

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

function PendingTag({ kind }) {
  if (!kind) return null
  const label = { add: 'Pending add', edit: 'Pending edit', delete: 'Pending delete', remove: 'Pending removal' }[kind] || 'Pending'
  return <span className="ch-tag ch-tag-pending">{label}</span>
}

function Avatar({ member, size = 28 }) {
  const initial = (member?.name || '?').trim().charAt(0).toUpperCase()
  return (
    <span className="ch-avatar" style={{ background: member?.color || '#94a3b8', width: size, height: size }} aria-hidden="true">
      {initial}
    </span>
  )
}

// ── Day detail ───────────────────────────────────────────────────────────────

export function DayModal({ date, view, submit, onClose }) {
  const tasks = view.tasksFor(date)
  const done = tasks.filter(t => t.done).length
  const progress = pct(done, tasks.length)
  const members = view.activeMembers.filter(m => !isPendingId(m.id))
  const when = shortDate(date)

  const toggle = t => submit('completion_set', {
    payload: { chore_id: t.chore.id, date, done: !t.done },
    summary: `Mark '${t.chore.title}' ${t.done ? 'not done' : 'done'} on ${when}`,
  })
  const reassign = (t, memberId) => {
    const m = members.find(x => x.id === memberId)
    if (!m) return
    submit('assignment_set', {
      payload: { chore_id: t.chore.id, date, member_id: m.id },
      summary: `Reassign '${t.chore.title}' on ${when} to ${m.name}`,
    })
  }
  const remove = t => {
    if (!window.confirm(`Delete '${t.chore.title}' from the chore library and every day on the calendar?`)) return
    submit('chore_delete', { target_id: t.chore.id, summary: `Delete chore '${t.chore.title}'` })
  }

  return (
    <Modal title={`Tasks for ${longDate(date)}`} subtitle={`${progress}% complete · ${done} of ${tasks.length} done`} onClose={onClose}>
      <div className="ch-progress ch-progress-lg"><div style={{ width: `${progress}%` }} /></div>
      {tasks.length === 0 && <p className="ch-muted">No chores scheduled for this day.</p>}
      <ul className="ch-task-list">
        {tasks.map(t => {
          const locked = t.chore.pending === 'add' || t.chore.pending === 'delete'
          return (
            <li key={t.key} className={`ch-task${t.done ? ' is-done' : ''}${t.chore.pending ? ' is-pending' : ''}`}>
              <button
                className={`ch-check${t.done ? ' is-checked' : ''}${t.donePending ? ' is-pending' : ''}`}
                onClick={() => toggle(t)}
                disabled={locked}
                role="checkbox"
                aria-checked={t.done}
                aria-label={`Mark ${t.chore.title} ${t.done ? 'not done' : 'done'}`}
              >
                <span>✓</span>
              </button>
              <div className="ch-task-main">
                <div className="ch-task-title">{t.chore.title}</div>
                <div className="ch-task-meta">
                  <span className={`ch-tag ch-tag-${t.chore.frequency}`}>{FREQ_LABEL[t.chore.frequency]}</span>
                  <span className="ch-tag">{t.chore.minutes}m</span>
                  <span className="ch-tag ch-tag-zone">{t.chore.zone}</span>
                  <PendingTag kind={t.chore.pending} />
                  {t.donePending && <span className="ch-tag ch-tag-pending">{t.done ? 'Done' : 'Not done'} · pending</span>}
                </div>
              </div>
              <div className="ch-task-actions">
                <span className={`ch-assignee${t.assigneePending ? ' is-pending' : ''}`}>
                  <Avatar member={t.assignee} size={24} />
                  <select
                    className="ch-input ch-input-sm"
                    value={t.assignee?.id || ''}
                    disabled={locked || !members.length}
                    onChange={e => reassign(t, e.target.value)}
                    aria-label={`Assignee for ${t.chore.title}`}
                  >
                    {!t.assignee && <option value="">Unassigned</option>}
                    {t.assignee && !members.some(m => m.id === t.assignee.id) && (
                      <option value={t.assignee.id}>{t.assignee.name}</option>
                    )}
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </span>
                <button className="ch-icon-btn ch-danger" onClick={() => remove(t)} disabled={locked} aria-label={`Delete ${t.chore.title}`}>🗑</button>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="ch-note">Changes are submitted for review and appear with a dashed outline until approved.</p>
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

  const remove = c => {
    if (!window.confirm(`Delete '${c.title}' from the chore library and every day on the calendar?`)) return
    submit('chore_delete', { target_id: c.id, summary: `Delete chore '${c.title}'` })
  }

  return (
    <Modal title="Manage Chores Library" onClose={onClose} wide>
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
          <div key={c.id} className={`ch-lib-card${c.pending ? ' is-pending' : ''}${c.pending === 'delete' ? ' is-deleting' : ''}`}>
            <div className="ch-lib-main">
              <div className="ch-task-title">{c.title}</div>
              <div className="ch-task-meta">
                <span className={`ch-tag ch-tag-${c.frequency}`}>{FREQ_LABEL[c.frequency]}</span>
                <span className="ch-tag ch-tag-zone">{c.zone}</span>
                <span className="ch-tag">{c.minutes}m</span>
                <span className="ch-tag">{scheduleLabel(c)}</span>
                <PendingTag kind={c.pending} />
              </div>
            </div>
            <div className="ch-lib-actions">
              <button className="ch-btn ch-btn-ghost" onClick={() => onEdit(c)} disabled={c.pending === 'add' || c.pending === 'delete'}>Edit</button>
              <button className="ch-btn ch-btn-ghost ch-danger" onClick={() => remove(c)} disabled={c.pending === 'add' || c.pending === 'delete'}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ── Add / edit chore ─────────────────────────────────────────────────────────

export function ChoreFormModal({ chore, view, submit, onClose }) {
  const editing = Boolean(chore)
  const [form, setForm] = useState(() => ({
    title: chore?.title || '',
    frequency: chore?.frequency || 'weekly',
    zone: chore?.zone || 'General',
    minutes: chore?.minutes || 15,
    preferred_weekday: chore?.preferred_weekday ?? 1,
    month_day: chore?.month_day ?? 1,
  }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const zones = useMemo(() => [...new Set(view.chores.map(c => c.zone))].sort(), [view.chores])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const onSubmit = async e => {
    e.preventDefault()
    const payload = {
      title: form.title.trim(),
      frequency: form.frequency,
      zone: form.zone.trim(),
      minutes: Number(form.minutes),
      preferred_weekday: form.frequency === 'weekly' ? Number(form.preferred_weekday) : null,
      month_day: form.frequency === 'monthly' ? Number(form.month_day) : null,
    }
    if (!payload.title) return setError('Give the chore a title.')
    if (!payload.zone) return setError('Choose a zone or room.')
    if (!Number.isInteger(payload.minutes) || payload.minutes < 1 || payload.minutes > 600) return setError('Time must be 1–600 minutes.')
    if (payload.frequency === 'monthly' && !(payload.month_day >= 1 && payload.month_day <= 31)) return setError('Day of month must be 1–31.')

    let summary
    if (editing) {
      const changes = []
      if (payload.title !== chore.title) changes.push(`title → '${payload.title}'`)
      if (payload.frequency !== chore.frequency) changes.push(`${FREQ_LABEL[payload.frequency].toLowerCase()}`)
      if (payload.zone !== chore.zone) changes.push(`zone → ${payload.zone}`)
      if (payload.minutes !== chore.minutes) changes.push(`${chore.minutes}m → ${payload.minutes}m`)
      if (payload.frequency === 'weekly' && payload.preferred_weekday !== chore.preferred_weekday) changes.push(`on ${WEEKDAYS[payload.preferred_weekday]}`)
      if (payload.frequency === 'monthly' && payload.month_day !== chore.month_day) changes.push(`on day ${payload.month_day}`)
      if (!changes.length) return onClose()
      summary = `Edit chore '${chore.title}': ${changes.join(', ')}`
    } else {
      const when = payload.frequency === 'weekly' ? `, ${WEEKDAYS[payload.preferred_weekday]}`
        : payload.frequency === 'monthly' ? `, day ${payload.month_day}` : ''
      summary = `Add chore '${payload.title}' (${FREQ_LABEL[payload.frequency].toLowerCase()}${when}, ${payload.minutes}m)`
    }
    setBusy(true)
    const ok = await submit(editing ? 'chore_edit' : 'chore_add', { target_id: editing ? chore.id : null, payload, summary })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title={editing ? 'Edit Chore' : 'Add New Chore'} onClose={onClose}>
      <form className="ch-form" onSubmit={onSubmit}>
        <label>Title
          <input className="ch-input" value={form.title} maxLength={120} onChange={e => set('title', e.target.value)} data-autofocus required />
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
        </div>
        <div className="ch-form-row">
          <label>Zone / Room
            <input className="ch-input" list="ch-zones" value={form.zone} maxLength={40} onChange={e => set('zone', e.target.value)} required />
            <datalist id="ch-zones">{zones.map(z => <option key={z} value={z} />)}</datalist>
          </label>
          <label>Time estimate (minutes)
            <input className="ch-input" type="number" min="1" max="600" value={form.minutes} onChange={e => set('minutes', e.target.value)} required />
          </label>
        </div>
        {error && <div className="ch-form-error">{error}</div>}
        <div className="ch-form-actions">
          <button type="button" className="ch-btn ch-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="ch-btn ch-btn-primary" disabled={busy}>{editing ? 'Submit Changes' : 'Submit Chore'}</button>
        </div>
        <p className="ch-note">Your change will be reviewed before it goes live.</p>
      </form>
    </Modal>
  )
}

// ── Family ───────────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }) {
  return (
    <div className="ch-colors" role="radiogroup" aria-label="Avatar color">
      {MEMBER_COLORS.map(c => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={c}
          className={`ch-swatch${value.toLowerCase() === c ? ' is-selected' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="ch-swatch ch-swatch-custom" title="Custom color">
        <input type="color" value={value} onChange={e => onChange(e.target.value)} aria-label="Custom color" />
        <span>+</span>
      </label>
    </div>
  )
}

function MemberRow({ member, submit }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.name)
  const [color, setColor] = useState(member.color)
  const locked = isPendingId(member.id) || member.pending === 'remove'

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed === member.name && color.toLowerCase() === member.color.toLowerCase()) return setEditing(false)
    const parts = []
    if (trimmed !== member.name) parts.push(`rename to ${trimmed}`)
    if (color.toLowerCase() !== member.color.toLowerCase()) parts.push(`color ${color}`)
    const ok = await submit('member_edit', {
      target_id: member.id,
      payload: { name: trimmed, color: color.toLowerCase() },
      summary: `Update family member '${member.name}': ${parts.join(', ')}`,
    })
    if (ok) setEditing(false)
  }
  const remove = () => {
    if (!window.confirm(`Remove ${member.name}? Their chores will be re-balanced across everyone else.`)) return
    submit('member_remove', { target_id: member.id, summary: `Remove family member '${member.name}'` })
  }

  return (
    <li className={`ch-member${member.pending ? ' is-pending' : ''}`}>
      <div className="ch-member-row">
        <Avatar member={member} size={36} />
        <div className="ch-member-name">
          {member.name}
          <PendingTag kind={member.pending} />
        </div>
        <button className="ch-btn ch-btn-ghost" onClick={() => setEditing(v => !v)} disabled={locked}>{editing ? 'Close' : 'Edit'}</button>
        <button className="ch-btn ch-btn-ghost ch-danger" onClick={remove} disabled={locked}>Remove</button>
      </div>
      {editing && (
        <div className="ch-member-edit">
          <input className="ch-input" value={name} maxLength={40} onChange={e => setName(e.target.value)} aria-label="Name" />
          <ColorPicker value={color} onChange={setColor} />
          <button className="ch-btn ch-btn-primary" onClick={save}>Submit Changes</button>
        </div>
      )}
    </li>
  )
}

export function FamilyModal({ view, submit, focusAdd, onClose }) {
  const members = view.members.filter(m => m.active)
  const [name, setName] = useState('')
  const [color, setColor] = useState(MEMBER_COLORS[members.length % MEMBER_COLORS.length])
  const inputRef = useRef(null)
  useEffect(() => { if (focusAdd) inputRef.current?.focus() }, [focusAdd])

  const add = async e => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const ok = await submit('member_add', {
      payload: { name: trimmed, color: color.toLowerCase() },
      summary: `Add family member '${trimmed}'`,
    })
    if (ok) setName('')
  }
  const reset = () => {
    if (!window.confirm('Reset all chores, family members, assignments and completions to the defaults? This will be submitted for review.')) return
    submit('reset_defaults', { summary: 'Reset all chores and family members to the default data' })
  }

  return (
    <Modal title="Manage Family" subtitle={`${members.filter(m => m.pending !== 'add').length} active members`} onClose={onClose}>
      <form className="ch-member-add" onSubmit={add}>
        <div className="ch-member-add-row">
          <Avatar member={{ name: name || '?', color }} size={36} />
          <input ref={inputRef} className="ch-input" placeholder="New family member name" value={name} maxLength={40} onChange={e => setName(e.target.value)} aria-label="New family member name" />
          <button type="submit" className="ch-btn ch-btn-primary" disabled={!name.trim()}>+ Add</button>
        </div>
        <ColorPicker value={color} onChange={setColor} />
      </form>
      <ul className="ch-member-list">
        {members.map(m => <MemberRow key={m.id} member={m} submit={submit} />)}
      </ul>
      <div className="ch-settings">
        <h4>Settings</h4>
        <p className="ch-muted">Restore the default 15 chores and family members. Clears all assignments and check-offs.</p>
        <button className="ch-btn ch-btn-ghost ch-danger" onClick={reset} disabled={view.resetPending}>
          {view.resetPending ? 'Reset pending review' : 'Reset Default Data'}
        </button>
      </div>
    </Modal>
  )
}

// ── Review ───────────────────────────────────────────────────────────────────

const CHANGE_LABEL = {
  chore_add: 'Add chore', chore_edit: 'Edit chore', chore_delete: 'Delete chore',
  member_add: 'Add member', member_edit: 'Edit member', member_remove: 'Remove member',
  assignment_set: 'Reassign', completion_set: 'Check-off', rotation_toggle: 'Rotation',
  reset_defaults: 'Reset data',
}

function readPin() {
  try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' }
}
function writePin(pin) {
  try { pin ? sessionStorage.setItem(PIN_KEY, pin) : sessionStorage.removeItem(PIN_KEY) } catch { /* private mode */ }
}

export function ReviewModal({ view, onReviewed, notify, onClose }) {
  const [pin, setPin] = useState(readPin)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(() => new Set())
  const items = view.pending.filter(p => !done.has(p.id))

  const run = async (action, ids) => {
    if (!pin.trim()) return setError('Enter the approval PIN first.')
    setBusy(true)
    setError('')
    try {
      const { results } = await reviewChanges(pin.trim(), action, ids)
      writePin(pin.trim())
      const ok = results.filter(r => r.ok).map(r => r.id)
      const failed = results.filter(r => !r.ok)
      setDone(prev => new Set([...prev, ...ok]))
      if (failed.length) setError(`${failed.length} change(s) could not be applied: ${failed[0].error}`)
      else notify(`${ok.length} change${ok.length === 1 ? '' : 's'} ${action === 'approve' ? 'approved' : 'rejected'}`)
      await onReviewed()
    } catch (e) {
      if (e.status === 403) { writePin(''); setPin('') }
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Review Changes (${items.length})`}
      subtitle="Oldest first. Approved changes go live for everyone."
      onClose={onClose}
      wide
      footer={items.length > 0 && (
        <button className="ch-btn ch-btn-primary" disabled={busy} onClick={() => run('approve', items.map(p => p.id))}>
          Approve All ({items.length})
        </button>
      )}
    >
      <label className="ch-pin">Approval PIN
        <input
          className="ch-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={e => setPin(e.target.value)}
          placeholder="Enter PIN"
          data-autofocus={!pin || undefined}
        />
      </label>
      {error && <div className="ch-form-error">{error}</div>}
      {items.length === 0 && <p className="ch-muted">Nothing waiting for review.</p>}
      <ul className="ch-review-list">
        {items.map(p => (
          <li key={p.id} className="ch-review-item">
            <div className="ch-review-main">
              <span className="ch-tag ch-tag-type">{CHANGE_LABEL[p.change_type] || p.change_type}</span>
              <div className="ch-review-summary">{p.summary}</div>
              <div className="ch-review-time">{new Date(p.submitted_at).toLocaleString()}</div>
            </div>
            <div className="ch-review-actions">
              <button className="ch-btn ch-btn-approve" disabled={busy} onClick={() => run('approve', [p.id])}>Approve</button>
              <button className="ch-btn ch-btn-ghost ch-danger" disabled={busy} onClick={() => run('reject', [p.id])}>Reject</button>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
