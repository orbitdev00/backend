import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api.js'
import Bracket from './Bracket.jsx'
import { Modal, PinForm, SlotDraw, TeamForm } from './Modals.jsx'
import { ChatPanel, Drawer, NotificationsPanel } from './Panels.jsx'
import { MAX_TEAMS, teamName } from './bracket.js'
import { forgetToken, formatEventDate, readPin, readTokens, savePin, saveToken } from './teams.js'
import { addItems, bracketEvents, loadNotify, messageEvents, saveNotify, snapshotEntries, unreadCount } from './notify.js'
import { drawBracketImage } from './drawBracket.js'
import { scrollToSlot } from './motion.js'
import { installRipples } from './fx.js'
import './pickleball.css'

const BRACKET_POLL_MS = 10_000
const WALL_POLL_MS = 8_000
const PANEL_CLOSE_MS = 260

const RULES = [
  ['Format', "Double elimination with a winners' bracket and a losers' bracket. Lose once and you drop to the losers' bracket; lose twice and you're out."],
  ['Games', 'First to 11 points.'],
  ['Sides', 'Switch sides when the first team reaches 6 points.'],
  ['Teams', 'Doubles: every team is two players. 12 teams in all.'],
  ['Seeding', 'Slots are drawn at random when you join. Slots 1 to 4 get a first-round bye.'],
  ['Grand final', "The winners' bracket champion plays the losers' bracket champion."],
]

/** Ids that weren't in `prev`, once there is a previous list to compare to. */
function addedIds(prevRef, rows) {
  const ids = new Set(rows.map(r => r.id))
  const prev = prevRef.current
  prevRef.current = ids
  if (!prev) return new Set()
  return new Set([...ids].filter(id => !prev.has(id)))
}

const badge = n => (n > 99 ? '99+' : String(n))

export default function PickleballApp() {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [messages, setMessages] = useState([])
  const [colors, setColors] = useState([])
  const [tokens, setTokens] = useState(() => readTokens())
  const [pin, setPin] = useState(() => readPin())
  const [modal, setModal] = useState(null)
  const [panel, setPanel] = useState(null) // 'chat' | 'notifs'
  const [newIds, setNewIds] = useState(() => new Set())
  const [newMsgIds, setNewMsgIds] = useState(() => new Set())
  const [pulseSlot, setPulseSlot] = useState(null)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [notify, setNotify] = useState(() => loadNotify())
  const [ring, setRing] = useState(0)
  const [panelReadAt, setPanelReadAt] = useState(null)
  const rootRef = useRef(null)
  const seenEntries = useRef(null)
  const seenMessages = useRef(null)
  const notifyRef = useRef(notify)
  const dataRef = useRef(null)
  const chatOpen = useRef(false)
  const ignore = useRef(new Set())

  const entries = data?.entries || []
  const settings = data?.settings
  const ownedIds = useMemo(() => new Set(entries.filter(e => tokens[e.id]).map(e => e.id)), [entries, tokens])
  const owned = entries.filter(e => ownedIds.has(e.id))
  const full = entries.length >= MAX_TEAMS
  const organizer = Boolean(pin)
  const unread = unreadCount(notify.items, notify.readAt)
  const chatReadSince = notify.chatReadAt ? Date.parse(notify.chatReadAt) : Infinity
  const chatUnread = messages.filter(m => !ownedIds.has(m.entry_id) && Date.parse(m.created_at) > chatReadSince).length

  useEffect(() => (rootRef.current ? installRipples(rootRef.current) : undefined), [])

  const updateNotify = patch => {
    notifyRef.current = { ...notifyRef.current, ...patch }
    saveNotify(notifyRef.current)
    setNotify(notifyRef.current)
  }

  const say = text => {
    setNotice(text)
    setTimeout(() => setNotice(n => (n === text ? '' : n)), 4000)
  }

  /** Your own changes don't notify you. */
  const ignoreFor = id => {
    ignore.current.add(id)
    setTimeout(() => ignore.current.delete(id), 30_000)
  }

  const deliver = events => {
    if (!events.length) return
    updateNotify({ items: addItems(notifyRef.current.items, events) })
    setRing(r => r + 1)
    const loud = events.filter(e => e.personal || e.kind === 'full')
    if (loud.length && !document.hidden) say(loud[loud.length - 1].text)
    if (notifyRef.current.alerts && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const title = dataRef.current?.settings?.event_name || 'Pickleball Tournament'
      for (const e of events.slice(-3)) {
        try { new Notification(title, { body: e.text, tag: e.id }) } catch { /* not allowed here */ }
      }
    }
  }

  const refresh = useCallback(async () => {
    try {
      const d = await api.loadBracket()
      const added = addedIds(seenEntries, d.entries)
      if (added.size) {
        setNewIds(added)
        setTimeout(() => setNewIds(new Set()), 1400)
      }
      dataRef.current = d
      setData(d)
      setLoadError('')

      const cur = notifyRef.current
      const next = { entries: snapshotEntries(d.entries), settings: d.settings }
      const events = bracketEvents(cur.entries ? { entries: cur.entries, settings: cur.settings } : null, next,
        { tokens: readTokens(), ignore: ignore.current })
      const removed = events.filter(e => e.kind === 'removed')
      removed.forEach(e => forgetToken(e.entryId))
      if (removed.length) setTokens(readTokens())
      updateNotify(next)
      deliver(events)
    } catch {
      setLoadError("Couldn't load the bracket. Retrying…")
    }
  }, [])

  const refreshWall = useCallback(async () => {
    try {
      const rows = await api.loadMessages()
      const added = addedIds(seenMessages, rows)
      if (added.size) {
        setNewMsgIds(added)
        setTimeout(() => setNewMsgIds(new Set()), 1200)
      }
      const cur = notifyRef.current
      const newest = rows.length ? rows[rows.length - 1].created_at : cur.lastMessageAt
      if (!cur.wallInit) {
        // First visit on this device: nothing old counts as new.
        updateNotify({ wallInit: true, lastMessageAt: newest, chatReadAt: newest || new Date().toISOString() })
      } else {
        const ents = dataRef.current?.entries || []
        const toks = readTokens()
        const events = messageEvents(cur.lastMessageAt || '1970-01-01T00:00:00Z', rows, {
          owned: ents.filter(e => toks[e.id]),
          byId: Object.fromEntries(ents.map(e => [e.id, e])),
          skipPlain: chatOpen.current,
        })
        updateNotify({ lastMessageAt: newest, ...(chatOpen.current && newest ? { chatReadAt: newest } : {}) })
        deliver(events)
      }
      setMessages(rows)
    } catch { /* keep the last messages */ }
  }, [])

  useEffect(() => {
    document.title = settings?.event_name || 'Pickleball Tournament'
  }, [settings?.event_name])

  useEffect(() => {
    if (!api.configured) return
    refresh().then(refreshWall)
    const a = setInterval(() => { if (!document.hidden) refresh() }, BRACKET_POLL_MS)
    const b = setInterval(() => { if (!document.hidden) refreshWall() }, WALL_POLL_MS)
    return () => { clearInterval(a); clearInterval(b) }
  }, [refresh, refreshWall])

  useEffect(() => {
    api.getConfig().then(c => setColors(c.colors || [])).catch(() => {})
  }, [])

  // A PIN from earlier in this tab is re-checked once; organizer requests check it again anyway.
  useEffect(() => {
    if (!pin) return
    api.verifyPin(pin).catch(err => { if (err.status !== 429) endOrganizer() })
  }, [])

  const endOrganizer = (message = '') => {
    savePin('')
    setPin('')
    if (message) say(message)
  }

  // Any organizer call that comes back 401/503 ends organizer mode.
  const asOrganizer = async fn => {
    try {
      return await fn(pin)
    } catch (err) {
      if (err.status === 401 || err.status === 503) endOrganizer('Organizer mode ended. Enter the PIN again.')
      throw err
    }
  }

  // ── Panels ─────────────────────────────────────────────────────────────────

  const openChat = () => {
    chatOpen.current = true
    const newest = messages.length ? messages[messages.length - 1].created_at : notifyRef.current.chatReadAt
    if (newest) updateNotify({ chatReadAt: newest })
    setPanel('chat')
  }

  const closePanel = () => {
    chatOpen.current = false
    setPanel(null)
  }

  const openNotifs = () => {
    setPanelReadAt(notifyRef.current.readAt)
    updateNotify({ readAt: new Date().toISOString() })
    setPanel('notifs')
  }

  const setAlerts = async on => {
    if (!on) return updateNotify({ alerts: false })
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      updateNotify({ alerts: permission === 'granted' })
      if (permission !== 'granted') say('Alerts are blocked for this site')
    } catch {
      say("This browser can't show alerts")
    }
  }

  const openItem = (item, close) => {
    close()
    setTimeout(() => {
      if (item.kind === 'message' || item.kind === 'mention') openChat()
      else if (item.slot) showSlot(item.slot)
    }, PANEL_CLOSE_MS + 20)
  }

  const showSlot = slot => {
    requestAnimationFrame(() => {
      scrollToSlot(slot)
      setPulseSlot(slot)
      setTimeout(() => setPulseSlot(null), 2600)
    })
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  // The draw replaces the join dialog right away (no delayed close that would dismiss it).
  const join = async team => {
    try {
      const res = await api.joinTournament(team)
      saveToken(res.id, res.token)
      ignoreFor(res.id)
      setTokens(readTokens())
      setModal({ type: 'draw', slot: res.slot, team: teamName(team), color: team.color })
      refresh()
    } catch (err) {
      if (err.status === 409) refresh()
      throw err
    }
  }

  const finishDraw = slot => {
    setModal(null)
    showSlot(slot)
  }

  const saveTeam = entry => async (team, close) => {
    ignoreFor(entry.id)
    if (ownedIds.has(entry.id)) await api.editEntry(entry.id, tokens[entry.id], team)
    else await asOrganizer(p => api.adminEditEntry(p, entry.id, team))
    close()
    say('Team updated')
    refresh()
  }

  const removeTeam = entry => async close => {
    ignoreFor(entry.id)
    if (ownedIds.has(entry.id)) {
      await api.leaveEntry(entry.id, tokens[entry.id])
      forgetToken(entry.id)
      setTokens(readTokens())
      say('You left the tournament. Your slot is open again.')
    } else {
      await asOrganizer(p => api.adminRemoveEntry(p, entry.id))
      say('Team removed')
    }
    close()
    refresh()
    refreshWall()
  }

  const unlock = async (value, close) => {
    await api.verifyPin(value)
    savePin(value)
    setPin(value)
    close()
    say('Organizer mode on')
  }

  const saveImage = async () => {
    setSaving(true)
    try {
      await drawBracketImage({ entries, settings })
    } catch {
      say("Couldn't create the image")
    } finally {
      setSaving(false)
    }
  }

  if (!api.configured) {
    return (
      <div className="pb-app">
        <main className="pb-main"><p className="pb-empty">This page isn't set up yet.</p></main>
      </div>
    )
  }

  const editing = modal?.type === 'edit' ? modal.entry : null
  const editingOwn = editing && ownedIds.has(editing.id)
  const eventName = settings?.event_name || 'Pickleball Tournament'

  return (
    <div className="pb-app" ref={rootRef}>
      <nav className="pb-nav" aria-label="Tournament">
        <div className="pb-nav-inner">
          <a className="pb-nav-brand" href="/pickleball" aria-label={`${eventName}, top of page`}>
            <Ball />
            <span className="pb-nav-name">{eventName}</span>
          </a>
          <span className="pb-nav-count" aria-label={`${entries.length} of ${MAX_TEAMS} teams`}>
            {data ? entries.length : '–'}<span>/{MAX_TEAMS}</span>
          </span>
          <div className="pb-nav-actions">
            <button type="button" className={`pb-nav-btn${panel === 'chat' ? ' is-active' : ''}`} onClick={openChat}
              aria-label={chatUnread ? `Chat, ${chatUnread} unread` : 'Chat'}>
              <ChatIcon />
              <span className="pb-nav-label">Chat</span>
              {chatUnread > 0 && <span key={chatUnread} className="pb-badge">{badge(chatUnread)}</span>}
            </button>
            <button type="button" className={`pb-nav-btn${panel === 'notifs' ? ' is-active' : ''}`} onClick={openNotifs}
              aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}>
              <span key={ring} className={`pb-bell${ring && unread ? ' is-ringing' : ''}`}><BellIcon /></span>
              <span className="pb-nav-label">Alerts</span>
              {unread > 0 && <span key={unread} className="pb-badge">{badge(unread)}</span>}
            </button>
          </div>
        </div>
      </nav>

      <header className="pb-hero">
        <div className="pb-hero-inner">
          <div className="pb-hero-text">
            <p className="pb-kicker">Doubles · Double elimination</p>
            <h1 className="pb-title">{eventName}</h1>
            {settings?.event_date && <p className="pb-date">{formatEventDate(settings.event_date)}</p>}
          </div>
          <div className="pb-meter" aria-live="polite">
            <div className="pb-meter-text"><strong>{data ? entries.length : '–'}</strong> of {MAX_TEAMS} teams</div>
            <div className="pb-meter-track" aria-hidden="true">
              <span className="pb-meter-fill" style={{ transform: `scaleX(${entries.length / MAX_TEAMS})` }} />
            </div>
          </div>
        </div>
      </header>

      <main className="pb-main">
        <div className="pb-cta">
          <button type="button" className="pb-btn pb-btn-ball pb-join" disabled={!data || full}
            onClick={() => setModal({ type: 'join' })}>
            {full ? 'Tournament full' : 'Join Tournament'}
          </button>
          <button type="button" className="pb-btn pb-btn-ghost pb-save" onClick={saveImage} disabled={!data || saving}>
            {saving ? 'Saving…' : 'Save bracket image'}
          </button>
        </div>

        {loadError && <p className="pb-banner" role="status">{loadError}</p>}

        <Rules />

        {data ? (
          <Bracket entries={entries} ownedIds={ownedIds} organizer={organizer} newIds={newIds} pulseSlot={pulseSlot}
            onEdit={entry => setModal({ type: 'edit', entry })} />
        ) : (
          !loadError && <p className="pb-empty">Loading bracket…</p>
        )}

        {organizer && <OrganizerPanel settings={settings} asOrganizer={asOrganizer} onSaved={refresh}
          onExit={() => endOrganizer('Organizer mode off')} />}
      </main>

      <footer className="pb-footer">
        <span>Brackets are for planning only. Results aren't tracked here.</span>
        {!organizer && (
          <button type="button" className="pb-link" onClick={() => setModal({ type: 'pin' })}>Organizer</button>
        )}
      </footer>

      <div className={`pb-toast${notice ? ' is-shown' : ''}`} role="status" aria-live="polite">{notice}</div>

      {panel === 'chat' && (
        <Drawer title="Chat" id="pb-chat" onClose={closePanel}>
          <ChatPanel messages={messages} entries={entries} owned={owned} tokens={tokens} newIds={newMsgIds}
            organizer={organizer} onPosted={refreshWall} asOrganizer={asOrganizer} />
        </Drawer>
      )}
      {panel === 'notifs' && (
        <Drawer title="Notifications" id="pb-notifs" onClose={closePanel}>
          {close => (
            <NotificationsPanel items={notify.items} readAt={panelReadAt} alerts={notify.alerts} onAlerts={setAlerts}
              onOpen={item => openItem(item, close)} onClear={() => updateNotify({ items: [] })} />
          )}
        </Drawer>
      )}

      {modal?.type === 'join' && (
        <Modal title="Join the tournament" onClose={() => setModal(null)}>
          {close => <TeamForm entries={entries} colors={colors} onSubmit={join} submitLabel="Join" close={close} />}
        </Modal>
      )}
      {editing && (
        <Modal title={editingOwn ? 'Edit your team' : `Edit team · Slot ${editing.slot}`} onClose={() => setModal(null)}>
          {close => (
            <TeamForm entry={editing} entries={entries} colors={colors} onSubmit={saveTeam(editing)}
              onRemove={removeTeam(editing)} removeLabel={editingOwn ? 'Leave tournament' : 'Remove team'}
              submitLabel="Save" close={close} />
          )}
        </Modal>
      )}
      {modal?.type === 'pin' && (
        <Modal title="Organizer" onClose={() => setModal(null)}>
          {close => <PinForm onSubmit={unlock} close={close} />}
        </Modal>
      )}
      {modal?.type === 'draw' && (
        <SlotDraw slot={modal.slot} team={modal.team} color={modal.color} onDone={() => finishDraw(modal.slot)} />
      )}
    </div>
  )
}

function Ball() {
  return (
    <svg className="pb-ball" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="var(--pb-ball)" />
      {[[15, 16], [28, 12], [35, 25], [24, 25], [16, 32], [29, 36]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="var(--pb-ball-ink)" opacity="0.55" />
      ))}
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M6 10a6 6 0 1 1 12 0c0 3.5 1.2 5.3 2 6.2.3.4 0 .8-.4.8H4.4c-.4 0-.7-.4-.4-.8.8-.9 2-2.7 2-6.2Z"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9.5 20a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function Rules() {
  const [open, setOpen] = useState(false)
  return (
    <section className={`pb-card pb-rules${open ? ' is-open' : ''}`}>
      <button type="button" className="pb-rules-toggle" aria-expanded={open} aria-controls="pb-rules-body"
        onClick={() => setOpen(o => !o)}>
        <span>Format and rules</span>
        <span className="pb-chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <dl id="pb-rules-body" className="pb-rules-body">
          {RULES.map(([term, text], i) => (
            <div key={term} className="pb-rule" style={{ '--i': i }}><dt>{term}</dt><dd>{text}</dd></div>
          ))}
        </dl>
      )}
    </section>
  )
}

function OrganizerPanel({ settings, asOrganizer, onSaved, onExit }) {
  const [name, setName] = useState(settings?.event_name || '')
  const [day, setDay] = useState(settings?.event_date || '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    setName(settings?.event_name || '')
    setDay(settings?.event_date || '')
  }, [settings?.event_name, settings?.event_date])

  const save = async e => {
    e.preventDefault()
    setBusy(true)
    setStatus('')
    try {
      await asOrganizer(p => api.adminSaveSettings(p, { event_name: name, event_date: day || null }))
      setStatus('Saved')
      onSaved()
    } catch (err) {
      setStatus(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pb-card pb-organizer" aria-labelledby="pb-org-title">
      <div className="pb-organizer-head">
        <h2 id="pb-org-title" className="pb-card-title">Organizer</h2>
        <button type="button" className="pb-btn pb-btn-ghost" onClick={onExit}>Exit organizer mode</button>
      </div>
      <p className="pb-hint">Every team box has an Edit button, and chat messages can be deleted. Slots can't be moved.</p>
      <form className="pb-form pb-settings" onSubmit={save}>
        <div className="pb-field">
          <label className="pb-label" htmlFor="pb-event-name">Event name</label>
          <input id="pb-event-name" className="pb-input" value={name} maxLength={60} onChange={e => setName(e.target.value)} required />
        </div>
        <div className="pb-field">
          <label className="pb-label" htmlFor="pb-event-date">Event date</label>
          <input id="pb-event-date" className="pb-input" type="date" value={day} onChange={e => setDay(e.target.value)} />
        </div>
        <div className="pb-form-actions">
          {status && <span className="pb-hint" role="status">{status}</span>}
          <button type="submit" className="pb-btn pb-btn-ball" disabled={busy || !name.trim()}>Save event</button>
        </div>
      </form>
    </section>
  )
}
