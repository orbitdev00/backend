import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import NavBar from '../components/NavBar'
import StarField from '../components/StarField'
import './Tracker.css'

const DEX_V1      = 'https://api.dexscreener.com/tokens/v1'
const DEX_LEGACY  = 'https://api.dexscreener.com/latest/dex/tokens'
const POLL_MS = 5_000

function detectChain(mint) {
  return /^0x[0-9a-fA-F]{40}$/.test(mint) ? 'ethereum' : 'solana'
}

async function fetchMC(mint) {
  try {
    const chain = detectChain(mint)
    const url   = chain === 'solana'
      ? `${DEX_V1}/solana/${mint}`
      : `${DEX_LEGACY}/${mint}`
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return 0
    const data  = await r.json()
    let pairs   = Array.isArray(data) ? data : (data.pairs || [])
    if (!Array.isArray(data)) {
      const filtered = pairs.filter(p => p.chainId === chain)
      if (filtered.length) pairs = filtered
    }
    for (const p of pairs) {
      const mc = parseFloat(p.marketCap || p.fdv || 0)
      if (mc > 0) return mc
    }
    return 0
  } catch { return 0 }
}

function fmtMC(n) {
  if (!n) return '$0'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n/1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export default function Tracker() {
  const { user, profile } = useAuth()
  const tier = profile?.tier || 'free'
  const ALERT_LIMIT = !user ? 0 : (tier === 'degen' || tier === 'omega') ? Infinity : 1
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
      const mints   = tracked.map(t => t.mint)
      const results = await Promise.all(mints.map(fetchMC))
      const mcMap   = Object.fromEntries(mints.map((m, i) => [m, results[i]]))
      setTracked(prev => prev.map(t => {
        const mc  = mcMap[t.mint] ?? t.lastMC
        const hit = (t.direction === 'above' && mc >= t.targetMC) || (t.direction === 'below' && mc <= t.targetMC)
        if (hit && !t.triggered) { playSound(t.sound); return { ...t, lastMC: mc, triggered: true } }
        return { ...t, lastMC: mc }
      }))
    }
    poll()
    pollRef.current = setInterval(poll, POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [tracked.length, JSON.stringify(tracked.map(t => t.mint))])

  // Poll watchlist MCs every 15s
  useEffect(() => {
    if (watchlist.length === 0) return
    const poll = async () => {
      const mints   = watchlist.map(w => w.mint)
      const results = await Promise.all(mints.map(fetchMC))
      const mcMap   = Object.fromEntries(mints.map((m, i) => [m, results[i]]))
      setWatchlist(prev => prev.map(w => ({ ...w, lastMC: mcMap[w.mint] ?? w.lastMC })))
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
      const chain = detectChain(mintAddr)
      const url   = chain === 'solana'
        ? `${DEX_V1}/solana/${mintAddr}`
        : `${DEX_LEGACY}/${mintAddr}`
      const res   = await fetch(url)
      if (!res.ok) return mintAddr.slice(0, 8) + '...'
      const data  = await res.json()
      const pairs = Array.isArray(data) ? data : (data.pairs || [])
      return pairs[0]?.baseToken?.name || mintAddr.slice(0, 8) + '...'
    } catch { return mintAddr.slice(0, 8) + '...' }
  }

  const addTracker = async () => {
    if (!mint.trim() || !targetMC) return
    if (tracked.length >= ALERT_LIMIT) {
      alert(tier === 'free' ? 'Free accounts can track 1 coin. Upgrade to Degen for unlimited alerts.' : 'Upgrade required.')
      return
    }
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

  const nav = useNavigate()

  if (!user) return (
    <div className="tracker-screen">
      <StarField />
      <NavBar active="tracker" />
      <div className="tracker-body" style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16,minHeight:'60vh'}}>
        <div style={{fontSize:32}}>🔒</div>
        <div style={{fontSize:16,fontWeight:700,color:'#f1f5f9'}}>Sign in to use Tracker</div>
        <div style={{fontSize:12,color:'#64748b',textAlign:'center',maxWidth:300}}>Track coins and get alerted when your MC targets hit. Requires a free account.</div>
        <button onClick={() => window.location.href='/login'} style={{background:'var(--green)',border:'none',borderRadius:6,color:'#000',fontFamily:'var(--mono)',fontSize:11,fontWeight:700,padding:'10px 24px',cursor:'pointer',letterSpacing:1,textTransform:'uppercase'}}>Sign In</button>
        <button onClick={() => window.location.href='/signup'} style={{background:'none',border:'1px solid #2a2a2a',borderRadius:6,color:'#64748b',fontFamily:'var(--mono)',fontSize:11,padding:'8px 24px',cursor:'pointer'}}>Create Free Account</button>
      </div>
    </div>
  )

  return (
    <div className="tracker-screen">
      <StarField />
      <NavBar active="tracker" />
      <div className="tracker-body">
        <div className="tracker-header">
          <div className="tracker-heading-wrap"><h2>Tracker</h2><p>Watch coins · get alerted when targets hit.</p></div>
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
            {tier === 'free' && (
              <div style={{background:'rgba(167,139,250,0.06)',border:'1px solid rgba(167,139,250,0.2)',borderRadius:6,padding:'8px 14px',marginBottom:8,fontSize:11,color:'#a78bfa',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Free plan · {tracked.length}/1 alert used</span>
                <span style={{cursor:'pointer',textDecoration:'underline'}} onClick={() => window.location.href='/pricing'}>Upgrade for unlimited →</span>
              </div>
            )}
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
