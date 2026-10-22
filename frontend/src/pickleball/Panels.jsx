import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api.js'
import WallMessage from './WallMessage.js'
import { teamName } from './bracket.js'
import { MESSAGE_MAX, relativeTime } from './teams.js'
import { ICONS } from './notify.js'
import { reducedMotion } from './motion.js'
import { replay } from './fx.js'

const CLOSE_MS = 240

/** Side drawer (bottom sheet on phones) that slides in and out. */
export function Drawer({ title, id, onClose, children, side = 'right' }) {
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
    <div className={`pb-drawer-root is-${side}${closing ? ' is-closing' : ''}`}>
      <div className="pb-backdrop" onClick={close} />
      <aside className="pb-drawer" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} ref={panelRef} tabIndex={-1}>
        <div className="pb-drawer-head">
          <h2 id={`${id}-title`} className="pb-modal-title">{title}</h2>
          <button type="button" className="pb-icon-btn" onClick={close} aria-label="Close">✕</button>
        </div>
        {typeof children === 'function' ? children(close) : children}
      </aside>
    </div>
  )
}

/** The tournament chat (message wall), opened from the nav bar. */
export function ChatPanel({ messages, entries, owned, tokens, newIds, organizer, onPosted, asOrganizer }) {
  const [text, setText] = useState('')
  const [asId, setAsId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const listRef = useRef(null)
  const formRef = useRef(null)
  const stick = useRef(true)
  const byId = useMemo(() => Object.fromEntries(entries.map(e => [e.id, e])), [entries])
  const poster = owned.find(e => e.id === asId) || owned[0]
  const now = Date.now()

  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = () => {
    const el = listRef.current
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  const send = async e => {
    e.preventDefault()
    const body = text.trim()
    if (!body || !poster || busy) return
    setBusy(true)
    setError('')
    try {
      await api.postMessage(poster.id, tokens[poster.id], body)
      setText('')
      stick.current = true
      await onPosted()
    } catch (err) {
      setError(err.message)
      replay(formRef.current, 'is-shaking')
    } finally {
      setBusy(false)
    }
  }

  const remove = async id => {
    if (confirmId !== id) return setConfirmId(id)
    setConfirmId(null)
    try {
      await asOrganizer(p => api.adminDeleteMessage(p, id))
      onPosted()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="pb-chat">
      <ol className="pb-wall-list" ref={listRef} onScroll={onScroll} aria-live="polite" aria-label="Messages">
        {messages.length === 0 && <li className="pb-empty">No messages yet. Say hi!</li>}
        {messages.map(m => (
          <WallMessage key={m.id} message={m} team={byId[m.entry_id]} now={now} isNew={newIds.has(m.id)}
            onDelete={organizer ? () => remove(m.id) : null} confirming={confirmId === m.id} />
        ))}
      </ol>
      {poster ? (
        <form className="pb-compose" onSubmit={send} ref={formRef}>
          {owned.length > 1 && (
            <select className="pb-input pb-compose-as" value={poster.id} onChange={e => setAsId(e.target.value)} aria-label="Post as">
              {owned.map(e => <option key={e.id} value={e.id}>{teamName(e)}</option>)}
            </select>
          )}
          <div className="pb-compose-row">
            <textarea className="pb-input pb-compose-text" rows={2} value={text} maxLength={MESSAGE_MAX}
              placeholder={`Message as ${teamName(poster)}`} aria-label="Message"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(e) }} />
            <button type="submit" className="pb-btn pb-btn-ball pb-send" disabled={busy || !text.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 11.5 21 3l-8.5 18-2.2-7.3L3 11.5Z" fill="currentColor" /></svg>
            </button>
          </div>
          <p className="pb-hint">{text.length}/{MESSAGE_MAX} · Mention a player's name to notify their team</p>
          {error && <p className="pb-error" role="alert">{error}</p>}
        </form>
      ) : (
        <p className="pb-hint pb-chat-join">Join the tournament to chat.</p>
      )}
    </div>
  )
}

/** Notification list for this device. */
export function NotificationsPanel({ items, readAt, alerts, onAlerts, onOpen, onClear }) {
  const now = Date.now()
  const since = readAt ? Date.parse(readAt) : 0
  const canAlert = typeof window !== 'undefined' && 'Notification' in window
  const denied = canAlert && Notification.permission === 'denied'
  return (
    <div className="pb-notifs">
      {canAlert && (
        <div className="pb-notif-alerts">
          <div>
            <strong>Device alerts</strong>
            <p className="pb-hint">{denied ? 'Blocked in your browser settings.' : 'Pop-up alerts while this tab is in the background.'}</p>
          </div>
          <button type="button" className={`pb-switch${alerts ? ' is-on' : ''}`} role="switch" aria-checked={alerts}
            aria-label="Device alerts" disabled={denied} onClick={() => onAlerts(!alerts)}>
            <span className="pb-switch-knob" />
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="pb-empty">You're all caught up. New teams, chat mentions and changes to your team show up here.</p>
      ) : (
        <ul className="pb-notif-list">
          {items.map((item, i) => (
            <li key={item.id} style={{ '--i': Math.min(i, 10) }}>
              <button type="button" className={`pb-notif-item${Date.parse(item.at) > since ? ' is-unread' : ''}${item.personal ? ' is-personal' : ''}`}
                onClick={() => onOpen(item)}>
                <span className="pb-notif-icon" aria-hidden="true">{ICONS[item.kind] || '•'}</span>
                <span className="pb-notif-text">{item.text}</span>
                <time className="pb-notif-time" dateTime={item.at}>{relativeTime(item.at, now)}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <div className="pb-form-actions">
          <button type="button" className="pb-btn pb-btn-ghost" onClick={onClear}>Clear all</button>
        </div>
      )}
    </div>
  )
}
