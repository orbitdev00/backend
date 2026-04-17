import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import NavBar from '../components/NavBar'
import './Tracker.css'

const DEXSCREENER = 'https://api.dexscreener.com/latest/dex/tokens'
const POLL_MS = 5_000

function fmtMC(n) {
  if (!n) return '$0'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n/1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export default function Tracker() {
  const { user } = useAuth()
  const [tracked, setTracked]   = useState([])
  const [mint, setMint]         = useState('')
  const [targetMC, setTargetMC] = useState('')
  const [direction, setDir]     = useState('above')
  const [sound, setSound]       = useState('ping')
  const [note, setNote]         = useState('')
  const [adding, setAdding]     = useState(false)
  const [tab, setTab]           = useState('alerts')   // 'alerts' | 'watchlist'
  const [watchlist, setWatchlist] = useState([])
  const [watchMint, setWatchMint] = useState('')
  const [watchNote, setWatchNote] = useState('')
  const [addingWatch, setAddingWatch] = useState(false)
  const pollRef = useRef(null)

  // Load tracked from localStorage (alerts) + Supabase (watchlist)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('orbit_tracked') || '[]')
      setTracked(saved)
    } catch {}
  }, [])

  useEffect(() => {
    if (user) loadWatchlist()
  }, [user])

  const loadWatchlist = async () => {
    const { data } = await supabase.from('watchlist')
      .select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    setWatchlist(data || [])
  }

  const saveTracked = (list) => {
    setTracked(list)
    localStorage.setItem('orbit_tracked', JSON.stringify(list))
  }

  // Poll alerts every 5s
  useEffect(() => {
    if (tracked.length === 0) { clearInterval(pollRef.current); return }
    const poll = async () => {
      const mints = tracked.map(t => t.mint).join(',')
      if (!mints) return
      try {
        const res   = await fetch(`${DEXSCREENER}/${mints}?t=${Date.now()}`, { cache: 'no-store' })
        const data  = await res.json()
        const pairs = Array.isArray(data) ? data : (data.pairs || [])
        setTracked(prev => prev.map(t => {
          const pair = pairs.find(p => p.baseToken?.address === t.mint)
          if (!pair) return t
          const mc = parseFloat(pair.marketCap || pair.fdv || 0)
          const hit = (t.direction === 'above' && mc >= t.targetMC) || (t.direction === 'below' && mc <= t.targetMC)
          if (hit && !t.triggered) { playSound(t.sound); return { ...t, lastMC: mc, triggered: true } }
          return { ...t, lastMC: mc }
        }))
      } catch {}
    }
    poll()
    pollRef.current = setInterval(poll, POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [tracked.length, JSON.stringify(tracked.map(t => t.mint))])

  // Poll watchlist MCs every 15s
  useEffect(() => {
    if (watchlist.length === 0) return
    const poll = async () => {
      const mints = watchlist.map(w => w.mint).join(',')
      if (!mints) return
      try {
        const res   = await fetch(`${DEXSCREENER}/${mints}?t=${Date.now()}`, { cache: 'no-store' })
        const data  = await res.json()
        const pairs = Array.isArray(data) ? data : (data.pairs || [])
        setWatchlist(prev => prev.map(w => {
          const pair = pairs.find(p => p.baseToken?.address === w.mint)
          if (!pair) return w
          return { ...w, lastMC: parseFloat(pair.marketCap || pair.fdv || 0) }
        }))
      } catch {}
    }
    poll()
    const id = setInterval(poll, 15_000)
    return () => clearInterval(id)
  }, [watchlist.length, JSON.stringify(watchlist.map(w => w.mint))])

  const playSound = (type) => {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    if (type === 'chime') {
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3)
      gain.gain.setValueAtTime(0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(); osc.stop(ctx.currentTime + 0.5)
    } else if (type === 'ping') {
      osc.frequency.setValueAtTime(1200, ctx.currentTime)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.start(); osc.stop(ctx.currentTime + 0.3)
    } else {
      osc.type = 'square'
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1)
      osc.frequency.setValueAtTime(440, ctx.currentTime + 0.2)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(); osc.stop(ctx.currentTime + 0.4)
    }
  }

  const fetchName = async (mintAddr) => {
    try {
      const res   = await fetch(`${DEXSCREENER}/${mintAddr}`)
      const data  = await res.json()
      const pairs = Array.isArray(data) ? data : (data.pairs || [])
      return pairs[0]?.baseToken?.name || mintAddr.slice(0, 8) + '...'
    } catch { return mintAddr.slice(0, 8) + '...' }
  }

  const addTracker = async () => {
    if (!mint.trim() || !targetMC) return
    setAdding(true)
    const name = await fetchName(mint.trim())
    saveTracked([...tracked, {
      mint: mint.trim(), name,
      targetMC: parseFloat(targetMC) * 1000,
      direction, sound, note: note.trim(),
      lastMC: 0, triggered: false, addedAt: Date.now(),
    }])
    setMint(''); setTargetMC(''); setNote(''); setAdding(false)
  }

  const addToWatchlist = async () => {
    if (!user || !watchMint.trim()) return
    setAddingWatch(true)
    const name = await fetchName(watchMint.trim())
    const { data } = await supabase.from('watchlist').insert({
      user_id: user.id,
      mint: watchMint.trim(),
      name,
      note: watchNote.trim() || null,
    }).select().single()
    if (data) setWatchlist(prev => [data, ...prev])
    setWatchMint(''); setWatchNote(''); setAddingWatch(false)
  }

  const removeTracker  = (m) => saveTracked(tracked.filter(t => t.mint !== m))
  const resetTracker   = (m) => saveTracked(tracked.map(t => t.mint === m ? { ...t, triggered: false } : t))
  const removeWatchlist = async (id) => {
    await supabase.from('watchlist').delete().eq('id', id)
    setWatchlist(prev => prev.filter(w => w.id !== id))
  }

  return (
    <div className="tracker-screen">
      <NavBar active="tracker" />
      <div className="tracker-body">
        <div className="tracker-header">
          <h2>Tracker</h2>
          <div className="tracker-tabs">
            <button className={`tracker-tab ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>
              Alerts {tracked.length > 0 && <span className="tracker-badge">{tracked.length}</span>}
            </button>
            <button className={`tracker-tab ${tab === 'watchlist' ? 'active' : ''}`} onClick={() => setTab('watchlist')}>
              Watchlist {watchlist.length > 0 && <span className="tracker-badge">{watchlist.length}</span>}
            </button>
          </div>
        </div>

        {/* ALERTS TAB */}
        {tab === 'alerts' && (
          <>
            <div className="tracker-add panel">
              <div className="add-row">
                <input className="add-input" placeholder="Token CA" value={mint} onChange={e => setMint(e.target.value)} />
                <input className="add-input add-mc" placeholder="Target MC (K)" type="number" value={targetMC} onChange={e => setTargetMC(e.target.value)} />
                <select className="add-select" value={direction} onChange={e => setDir(e.target.value)}>
                  <option value="above">Rises above</option>
                  <option value="below">Falls below</option>
                </select>
                <select className="add-select" value={sound} onChange={e => { setSound(e.target.value); playSound(e.target.value) }}>
                  <option value="ping">Ping</option>
                  <option value="alarm">Alarm</option>
                  <option value="chime">Chime</option>
                </select>
                <button className="add-btn" onClick={addTracker} disabled={adding}>{adding ? '...' : 'Add Alert'}</button>
              </div>
              <div className="add-hint">Target MC is in thousands — enter 100 for $100K</div>
            </div>

            {tracked.length === 0
              ? <div className="tracker-empty">No alerts yet. Add one above.</div>
              : <div className="tracker-list">
                  {tracked.map(t => (
                    <div key={t.addedAt} className={`tracker-row panel ${t.triggered ? 'triggered' : ''}`}>
                      <div className="tr-info">
                        <div className="tr-name">{t.name}</div>
                        <div className="tr-mint">{t.mint.slice(0,8)}...{t.mint.slice(-4)}</div>
                        {t.note && <div className="tr-note">{t.note}</div>}
                      </div>
                      <div className="tr-mc"><div className="tr-label">Current</div><div className="tr-val">{fmtMC(t.lastMC)}</div></div>
                      <div className="tr-mc"><div className="tr-label">Target</div><div className="tr-val">{t.direction === 'above' ? '↑' : '↓'} {fmtMC(t.targetMC)}</div></div>
                      <div className="tr-status">
                        {t.triggered
                          ? <span className="tr-triggered">✓ Triggered</span>
                          : <span className="tr-watching">● Watching</span>}
                      </div>
                      <div className="tr-actions">
                        {t.triggered && <button className="tr-btn" onClick={() => resetTracker(t.mint)}>Reset</button>}
                        <button className="tr-btn tr-remove" onClick={() => removeTracker(t.mint)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </>
        )}

        {/* WATCHLIST TAB */}
        {tab === 'watchlist' && (
          <>
            {!user && <div className="tracker-empty">Sign in to save a watchlist across devices.</div>}
            {user && (
              <div className="tracker-add panel">
                <div className="add-row">
                  <input className="add-input" placeholder="Token CA" value={watchMint} onChange={e => setWatchMint(e.target.value)} />
                  <input className="add-input" placeholder="Note (optional)" value={watchNote} onChange={e => setWatchNote(e.target.value)} />
                  <button className="add-btn" onClick={addToWatchlist} disabled={addingWatch || !watchMint.trim()}>
                    {addingWatch ? '...' : 'Watch'}
                  </button>
                </div>
                <div className="add-hint">Watchlist is saved to your account and syncs across devices.</div>
              </div>
            )}

            {watchlist.length === 0
              ? <div className="tracker-empty">{user ? 'No coins in your watchlist yet.' : ''}</div>
              : <div className="tracker-list">
                  {watchlist.map(w => (
                    <div key={w.id} className="tracker-row panel">
                      <div className="tr-info">
                        <div className="tr-name">{w.name}</div>
                        <div className="tr-mint">{w.mint.slice(0,8)}...{w.mint.slice(-4)}</div>
                        {w.note && <div className="tr-note">{w.note}</div>}
                      </div>
                      <div className="tr-mc">
                        <div className="tr-label">MC</div>
                        <div className="tr-val">{w.lastMC ? fmtMC(w.lastMC) : '—'}</div>
                      </div>
                      <div className="tr-actions">
                        <button className="tr-btn tr-remove" onClick={() => removeWatchlist(w.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </>
        )}
      </div>
    </div>
  )
}
