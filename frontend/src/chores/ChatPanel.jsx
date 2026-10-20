import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadMessages, messagesAfter, sendChat } from './api.js'
import ChatMessage from './ChatMessage.js'

const OPEN_POLL_MS = 4000
const CLOSED_POLL_MS = 30000
const MAX_LEN = 500
const READ_KEY = 'chore_chat_read'

function readMark() {
  try { return localStorage.getItem(READ_KEY) } catch { return null }
}
function writeMark(iso) {
  try { localStorage.setItem(READ_KEY, iso) } catch { /* private mode: badge just resets */ }
}

/**
 * Chat state. While open: loads the last 100 messages, then polls for new ones
 * every 4s. While closed: polls every 30s just to count unread messages.
 */
export function useChat(meId, open) {
  const [messages, setMessages] = useState([])
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState('')
  const loaded = useRef(false)
  const initialIds = useRef(new Set())
  const lastAt = useRef(null)

  // `advance` moves the polling cursor. A message we just sent doesn't, so a
  // message someone else posted a moment earlier is still picked up.
  const merge = useCallback((rows, advance = true) => {
    if (!rows.length) return
    setMessages(prev => {
      const seen = new Set(prev.map(m => m.id))
      const next = [...prev, ...rows.filter(m => !seen.has(m.id))]
      return next.slice(-200)
    })
    if (advance) lastAt.current = rows[rows.length - 1].created_at
  }, [])

  useEffect(() => {
    if (!open) return
    let alive = true
    const markRead = () => {
      if (lastAt.current) writeMark(lastAt.current)
      setUnread(0)
    }
    const tick = async () => {
      try {
        if (!loaded.current) {
          const rows = await loadMessages(100)
          if (!alive) return
          initialIds.current = new Set(rows.map(m => m.id))
          loaded.current = true
          setMessages(rows)
          lastAt.current = rows.length ? rows[rows.length - 1].created_at : new Date().toISOString()
        } else {
          const rows = await messagesAfter(lastAt.current)
          if (!alive) return
          merge(rows)
        }
        markRead()
        setError('')
      } catch {
        if (alive) setError('Can’t reach chat. Retrying…')
      }
    }
    tick()
    const id = setInterval(tick, OPEN_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [open, merge])

  useEffect(() => {
    if (open || !meId) return
    let alive = true
    const tick = async () => {
      let mark = readMark()
      if (!mark) { mark = new Date().toISOString(); writeMark(mark) }
      try {
        const rows = await messagesAfter(mark, 'id,member_id,created_at')
        if (alive) setUnread(rows.filter(m => m.member_id !== meId).length)
      } catch { /* keep the old count */ }
    }
    tick()
    const id = setInterval(tick, CLOSED_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [open, meId])

  const send = useCallback(async text => {
    const { message } = await sendChat(meId, text)
    merge([message], false)
    return message
  }, [meId, merge])

  return { messages, unread, error, send, initialIds: initialIds.current }
}

export function ChatPanel({ chat, me, members, variant, onClose }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState('')
  const [now, setNow] = useState(Date.now)
  const listRef = useRef(null)
  const stick = useRef(true)
  const byId = new Map(members.map(m => [m.id, m]))

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  // Start at the bottom, and follow new messages unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat.messages.length])

  const onScroll = e => {
    const el = e.currentTarget
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const submit = async e => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setSendError('')
    try {
      stick.current = true
      await chat.send(text)
      setDraft('')
    } catch (err) {
      setSendError(err.message || 'Could not send')
    }
    setBusy(false)
  }

  return (
    <section className={`ch-chat ch-chat-${variant}`} aria-label="Family chat">
      <header className="ch-chat-head">
        <h2>Family Chat</h2>
        {onClose && <button className="ch-icon-btn" onClick={onClose} aria-label="Close chat">✕</button>}
      </header>
      <ol className="ch-chat-list" ref={listRef} onScroll={onScroll} aria-live="polite">
        {chat.messages.length === 0 && <li className="ch-chat-empty">No messages yet. Say hi! 👋</li>}
        {chat.messages.map(m => (
          <ChatMessage
            key={m.id}
            message={m}
            sender={byId.get(m.member_id)}
            mine={m.member_id === me.id}
            animate={!chat.initialIds.has(m.id)}
            now={now}
          />
        ))}
      </ol>
      {(chat.error || sendError) && <div className="ch-chat-error">{sendError || chat.error}</div>}
      <form className="ch-chat-form" onSubmit={submit}>
        <input
          className="ch-input"
          value={draft}
          maxLength={MAX_LEN}
          onChange={e => setDraft(e.target.value)}
          placeholder={`Message as ${me.name}…`}
          aria-label="Message"
        />
        <button className="ch-btn ch-btn-primary" disabled={busy || !draft.trim()}>Send</button>
      </form>
      {draft.length > MAX_LEN - 50 && <div className="ch-chat-count">{draft.length}/{MAX_LEN}</div>}
    </section>
  )
}
