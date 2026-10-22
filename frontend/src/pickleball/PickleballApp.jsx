import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api.js'
import Bracket from './Bracket.jsx'
import WallMessage from './WallMessage.js'
import { Modal, PinForm, SlotDraw, TeamForm } from './Modals.jsx'
import { MAX_TEAMS, teamName } from './bracket.js'
import { MESSAGE_MAX, forgetToken, formatEventDate, readPin, readTokens, savePin, saveToken } from './teams.js'
import { drawBracketImage } from './drawBracket.js'
import { scrollToSlot } from './motion.js'
import './pickleball.css'

const BRACKET_POLL_MS = 10_000
const WALL_POLL_MS = 8_000

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

export default function PickleballApp() {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [messages, setMessages] = useState([])
  const [colors, setColors] = useState([])
  const [tokens, setTokens] = useState(() => readTokens())
  const [pin, setPin] = useState(() => readPin())
  const [modal, setModal] = useState(null)
  const [newIds, setNewIds] = useState(() => new Set())
  const [newMsgIds, setNewMsgIds] = useState(() => new Set())
  const [pulseSlot, setPulseSlot] = useState(null)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const seenEntries = useRef(null)
  const seenMessages = useRef(null)

  const entries = data?.entries || []
  const settings = data?.settings
  const ownedIds = useMemo(() => new Set(entries.filter(e => tokens[e.id]).map(e => e.id)), [entries, tokens])
  const owned = entries.filter(e => ownedIds.has(e.id))
  const full = entries.length >= MAX_TEAMS
  const organizer = Boolean(pin)

  const refresh = useCallback(async () => {
    try {
      const d = await api.loadBracket()
      const added = addedIds(seenEntries, d.entries)
      if (added.size) {
        setNewIds(added)
        setTimeout(() => setNewIds(new Set()), 1400)
      }
      setData(d)
      setLoadError('')
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
      setMessages(rows)
    } catch { /* keep the last messages */ }
  }, [])

  useEffect(() => {
    document.title = settings?.event_name || 'Pickleball Tournament'
  }, [settings?.event_name])

  useEffect(() => {
    if (!api.configured) return
    refresh()
    refreshWall()
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

  const say = text => {
    setNotice(text)
    setTimeout(() => setNotice(n => (n === text ? '' : n)), 4000)
  }

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

  // ── Actions ────────────────────────────────────────────────────────────────

  // The draw replaces the join dialog right away (no delayed close that would dismiss it).
  const join = async team => {
    try {
      const res = await api.joinTournament(team)
      saveToken(res.id, res.token)
      setTokens(readTokens())
      setModal({ type: 'draw', slot: res.slot, team: teamName(team) })
      refresh()
    } catch (err) {
      if (err.status === 409) refresh()
      throw err
    }
  }

  const finishDraw = slot => {
    setModal(null)
    requestAnimationFrame(() => {
      scrollToSlot(slot)
      setPulseSlot(slot)
      setTimeout(() => setPulseSlot(null), 2600)
    })
  }

  const saveTeam = entry => async (team, close) => {
    if (ownedIds.has(entry.id)) await api.editEntry(entry.id, tokens[entry.id], team)
    else await asOrganizer(p => api.adminEditEntry(p, entry.id, team))
    close()
    say('Team updated')
    refresh()
  }

  const removeTeam = entry => async close => {
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

  return (
    <div className="pb-app">
      <header className="pb-header">
        <div className="pb-header-inner">
          <div className="pb-brand">
            <Ball />
            <div>
              <h1 className="pb-title">{settings?.event_name || 'Pickleball Tournament'}</h1>
              {settings?.event_date && <p className="pb-date">{formatEventDate(settings.event_date)}</p>}
            </div>
          </div>
          <p className="pb-count" aria-live="polite">
            <strong>{data ? entries.length : '–'}</strong> of {MAX_TEAMS} teams
          </p>
        </div>
      </header>

      <main className="pb-main">
        <div className="pb-cta">
          <button type="button" className="pb-btn pb-btn-ball pb-join" disabled={!data || full}
            onClick={() => setModal({ type: 'join' })}>
            {full ? 'Tournament full' : 'Join Tournament'}
          </button>
          <button type="button" className="pb-btn pb-btn-ghost" onClick={saveImage} disabled={!data || saving}>
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

        <Wall messages={messages} entries={entries} owned={owned} tokens={tokens} newIds={newMsgIds}
          organizer={organizer} onPosted={refreshWall} asOrganizer={asOrganizer} />

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
      {modal?.type === 'draw' && <SlotDraw slot={modal.slot} team={modal.team} onDone={() => finishDraw(modal.slot)} />}
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
          {RULES.map(([term, text]) => (
            <div key={term} className="pb-rule"><dt>{term}</dt><dd>{text}</dd></div>
          ))}
        </dl>
      )}
    </section>
  )
}

function Wall({ messages, entries, owned, tokens, newIds, organizer, onPosted, asOrganizer }) {
  const [text, setText] = useState('')
  const [asId, setAsId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const listRef = useRef(null)
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
    <section className="pb-card pb-wall" aria-labelledby="pb-wall-title">
      <h2 id="pb-wall-title" className="pb-card-title">Message wall</h2>
      <ol className="pb-wall-list" ref={listRef} onScroll={onScroll} aria-live="polite">
        {messages.length === 0 && <li className="pb-empty">No messages yet.</li>}
        {messages.map(m => (
          <WallMessage key={m.id} message={m} team={byId[m.entry_id]} now={now} isNew={newIds.has(m.id)}
            onDelete={organizer ? () => remove(m.id) : null} confirming={confirmId === m.id} />
        ))}
      </ol>
      {poster ? (
        <form className="pb-compose" onSubmit={send}>
          {owned.length > 1 && (
            <select className="pb-input pb-compose-as" value={poster.id} onChange={e => setAsId(e.target.value)} aria-label="Post as">
              {owned.map(e => <option key={e.id} value={e.id}>{teamName(e)}</option>)}
            </select>
          )}
          <div className="pb-compose-row">
            <textarea className="pb-input pb-compose-text" rows={2} value={text} maxLength={MESSAGE_MAX}
              placeholder={`Post as ${teamName(poster)}`} aria-label="Message"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(e) }} />
            <button type="submit" className="pb-btn pb-btn-ball" disabled={busy || !text.trim()}>Send</button>
          </div>
          <p className="pb-hint">{text.length}/{MESSAGE_MAX}</p>
          {error && <p className="pb-error" role="alert">{error}</p>}
        </form>
      ) : (
        <p className="pb-hint">Join the tournament to post on the wall.</p>
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
      <p className="pb-hint">Every team box has an Edit button, and wall messages can be deleted. Slots can't be moved.</p>
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
