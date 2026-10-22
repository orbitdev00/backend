import { useEffect, useRef, useState } from 'react'
import { MAX_TEAMS } from './bracket.js'
import { NAME_MAX, SKILLS, cleanName, teamErrors } from './teams.js'
import { reducedMotion } from './motion.js'

const CLOSE_MS = 200

/** Dialog with enter/exit transitions. `children` may be a function of close(). */
export function Modal({ title, onClose, children, labelledBy = 'pb-modal-title', wide = false }) {
  const [closing, setClosing] = useState(false)
  const panelRef = useRef(null)
  const close = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, reducedMotion() ? 0 : CLOSE_MS)
  }

  useEffect(() => {
    const opener = document.activeElement
    const onKey = e => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('pb-locked')
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('pb-locked')
      opener?.focus?.()
    }
  }, [])

  return (
    <div className={`pb-modal-root${closing ? ' is-closing' : ''}`}>
      <div className="pb-backdrop" onClick={close} />
      <div className={`pb-modal${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        ref={panelRef} tabIndex={-1}>
        <div className="pb-modal-head">
          <h2 id={labelledBy} className="pb-modal-title">{title}</h2>
          <button type="button" className="pb-icon-btn" onClick={close} aria-label="Close">✕</button>
        </div>
        {typeof children === 'function' ? children(close) : children}
      </div>
    </div>
  )
}

/**
 * Join (no `entry`) or edit a team. `onSubmit(team)` resolves on success and
 * throws with the backend's message. `onRemove` (edit only) leaves/removes.
 */
export function TeamForm({ entry, entries, colors, onSubmit, onRemove, removeLabel, submitLabel, close }) {
  const [form, setForm] = useState(() => ({
    player_name: entry?.player_name || '',
    partner_name: entry?.partner_name || '',
    skill_level: entry?.skill_level || '',
    color: entry?.color || '',
  }))
  const [touched, setTouched] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const errors = teamErrors(form, entries, entry?.id)
  if (!form.skill_level) errors.skill_level = 'Pick a skill level'
  if (!colors.includes(form.color)) errors.color = 'Pick a team color'
  const valid = Object.keys(errors).length === 0
  const set = key => e => setForm(f => ({ ...f, [key]: e.target ? e.target.value : e }))
  const show = key => (touched[key] || touched.submit) && errors[key]

  const submit = async e => {
    e.preventDefault()
    setTouched(t => ({ ...t, submit: true }))
    if (!valid || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit({ ...form, player_name: cleanName(form.player_name), partner_name: cleanName(form.partner_name) }, close)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirmRemove) return setConfirmRemove(true)
    setBusy(true)
    setError('')
    try {
      await onRemove(close)
    } catch (err) {
      setError(err.message)
      setBusy(false)
      setConfirmRemove(false)
    }
  }

  return (
    <form className="pb-form" onSubmit={submit} noValidate>
      <Field id="pb-player" label="Your name" error={show('player_name')}>
        <input id="pb-player" className="pb-input" value={form.player_name} onChange={set('player_name')}
          onBlur={() => setTouched(t => ({ ...t, player_name: true }))} maxLength={NAME_MAX + 10} autoComplete="name"
          required autoFocus={!entry} />
      </Field>
      <Field id="pb-partner" label="Partner name" error={show('partner_name')}>
        <input id="pb-partner" className="pb-input" value={form.partner_name} onChange={set('partner_name')}
          onBlur={() => setTouched(t => ({ ...t, partner_name: true }))} maxLength={NAME_MAX + 10} autoComplete="off" required />
      </Field>
      <Field id="pb-skill" label="Skill level" error={show('skill_level')}>
        <select id="pb-skill" className="pb-input" value={form.skill_level} onChange={set('skill_level')} required>
          <option value="" disabled>Choose…</option>
          {SKILLS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <fieldset className="pb-field pb-swatches-field">
        <legend className="pb-label">Team color</legend>
        <div className="pb-swatches" role="radiogroup" aria-label="Team color">
          {colors.map((c, i) => (
            <label key={c} className="pb-swatch" style={{ '--swatch': c }}>
              <input type="radio" name="pb-color" value={c} checked={form.color === c} onChange={() => set('color')(c)} />
              <span className="pb-swatch-dot" aria-hidden="true" />
              <span className="pb-sr">Color {i + 1}</span>
            </label>
          ))}
        </div>
        {!colors.length && <p className="pb-hint">Loading colors…</p>}
        {show('color') && <p className="pb-error">{errors.color}</p>}
      </fieldset>

      {error && <p className="pb-error pb-form-error" role="alert">{error}</p>}

      <div className="pb-form-actions">
        {onRemove && (
          <button type="button" className={`pb-btn pb-btn-danger${confirmRemove ? ' is-confirming' : ''}`} onClick={remove} disabled={busy}>
            {confirmRemove ? 'Tap again to confirm' : removeLabel}
          </button>
        )}
        <button type="submit" className="pb-btn pb-btn-ball" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  )
}

function Field({ id, label, error, children }) {
  return (
    <div className="pb-field">
      <label className="pb-label" htmlFor={id}>{label}</label>
      {children}
      {error && <p className="pb-error" id={`${id}-error`}>{error}</p>}
    </div>
  )
}

/** 1.5s number roll that lands on `slot`, then onDone(). Reduced motion: no roll. */
export function SlotDraw({ slot, team, onDone }) {
  const still = reducedMotion()
  const [shown, setShown] = useState(still ? slot : 1 + Math.floor(Math.random() * MAX_TEAMS))
  const [tick, setTick] = useState(0)
  const [landed, setLanded] = useState(still)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const timers = []
    if (!still) {
      let at = 0, delay = 45
      while (at + delay < 1500) {
        at += delay
        timers.push(setTimeout(() => {
          setShown(n => { let next; do next = 1 + Math.floor(Math.random() * MAX_TEAMS); while (next === n); return next })
          setTick(t => t + 1)
        }, at))
        delay *= 1.13
      }
      timers.push(setTimeout(() => { setShown(slot); setTick(t => t + 1); setLanded(true) }, 1500))
    }
    timers.push(setTimeout(() => doneRef.current(), still ? 1400 : 2600))
    return () => timers.forEach(clearTimeout)
  }, [slot, still])

  return (
    <div className="pb-draw" role="dialog" aria-modal="true" aria-label="Slot draw" onClick={() => landed && doneRef.current()}>
      <div className="pb-draw-card">
        <p className="pb-draw-kicker">{landed ? "You're in!" : 'Drawing your slot…'}</p>
        <div className={`pb-draw-ball${landed ? ' is-landed' : ''}`}>
          <span key={tick} className="pb-draw-num">{shown}</span>
        </div>
        <p className="pb-draw-team" aria-live="polite">
          {landed ? <>{team} · <strong>Slot {slot}</strong></> : ' '}
        </p>
      </div>
    </div>
  )
}

export function PinForm({ onSubmit, close }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault()
    if (!pin || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(pin, close)
    } catch (err) {
      setError(err.message)
      setBusy(false)
      setPin('')
    }
  }
  return (
    <form className="pb-form" onSubmit={submit}>
      <div className="pb-field">
        <label className="pb-label" htmlFor="pb-pin">Organizer PIN</label>
        <input id="pb-pin" className="pb-input" type="password" inputMode="numeric" autoComplete="off" value={pin}
          onChange={e => setPin(e.target.value)} autoFocus required />
      </div>
      {error && <p className="pb-error" role="alert">{error}</p>}
      <div className="pb-form-actions">
        <button type="submit" className="pb-btn pb-btn-ball" disabled={busy || !pin}>{busy ? 'Checking…' : 'Unlock'}</button>
      </div>
    </form>
  )
}

