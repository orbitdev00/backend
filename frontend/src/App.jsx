import { useState, useEffect, useRef, useCallback } from 'react'
import CoinInput from './components/CoinInput'
import MetricsPanel from './components/MetricsPanel'
import PredictionPanel from './components/PredictionPanel'
import HolderChart from './components/HolderChart'
import FlagsList from './components/FlagsList'
import PnlPanel from './components/PnlPanel'
import { useSearchParams, useNavigate } from 'react-router-dom'
import NavBar from './components/NavBar'
import StarField from './components/StarField'
import CollapsiblePanel from './components/CollapsiblePanel'
import kikoPfp from './orbitPfp.js'
import { useAuth } from './context/AuthContext'
import BadgePopup from './components/BadgePopup'
import { supabase } from './lib/supabase'
import Landing from './pages/Landing'
import { useStreamAnalysis } from './hooks/useStreamAnalysis'
import Login from './pages/Login'
import SignUp from './pages/SignUp'
import ForgotPassword from './pages/ForgotPassword'
import AuthCallback from './pages/AuthCallback'
import BlackHole from './components/BlackHole'
import StreamReveal from './components/StreamReveal'
import './App.css'

const IDLE_QUOTES = [
  "I'm not selling, I'm accumulating.",
  "I should've taken profits...",
  "On to the next one I see?",
  "don't you dare paste that CA here",
  "This Cented guy kills everything. Worse than Stalin.",
  "tell Cupsy to leave my trenches alone",
  "another one? really?",
  "not again bro",
  "you really woke me up for this",
  "bro really said \"just one more\"",
  "this is the 6th CA today",
  "i counted. this is your 4th rug this week",
  "i'm starting to think you like losing",
  "i don't get paid enough for this",
  "every time. every single time.",
  "i already know how this ends and so do you",
  "you have the memory of a goldfish and i respect that",
  "you said never again literally yesterday",
  "the definition of insanity is pasting another CA",
  "firing up the cope engine",
  "here we go again",
]

const ANALYZING_QUOTES = [
  "bro what are you buying?",
  "you already know how this ends",
  "why would you even want to analyze that coin?",
  "narrative is good",
  "runner of the day for suuure (I'm lying)",
  "This is a good one",
  "Hmm idk it looks bundled...",
  `bro really pasted a CA at ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`,
  "you bought already didn't you",
  "please tell me you didn't buy already",
  "scanning for red flags... there are several",
  "checking if dev dumped already... give me a sec",
  "holders look sus ngl",
  "volume is... something",
  "this has been rugged in a parallel universe already",
  "okay actually this one might be different",
  "i've seen worse. not many, but some",
  "okay the community is actually active let's go",
  "twitter was made 11 minutes ago",
  "telegram has 4 members including the dev",
  "this token has been alive for 6 minutes",
  "okay i'm actually intrigued ngl",
  "i'm gonna be honest this looks mid",
  "okay volume is moving let's not sleep on this",
  "who sent you this",
  "whoever sent you this is not your friend",
  "this came from a telegram group didn't it",
  "some influencer called this a hidden gem huh",
  "if a KOL called this i'm going home",
  "initializing the bad news machine",
  "booting up my trust issues",
  "preparing to find something wrong with this",
  "okay let's see what we're working with",
  "fine. fine. pasting it.",
  "you're gonna buy regardless so let's at least check",
  "i can't stop you but i can warn you",
  "you've already decided haven't you. okay let's go.",
  "fine but if this rugs you owe me nothing because i'm a bot",
  "i'll analyze it but i want credit if it hits",
  "if this moons you better not forget who checked it",
  "alright. deep breath. let's look at this thing.",
  "warming up the rug detector",
]

function CyclingQuote({ quotes, interval = 5000 }) {
  const [current, setCurrent] = useState(quotes[Math.floor(Math.random() * quotes.length)])
  const [visible, setVisible] = useState(true)
  const idxRef = useRef(0)

  const next = useCallback(() => {
    setVisible(false)
    setTimeout(() => {
      idxRef.current = (idxRef.current + 1) % quotes.length
      setCurrent(quotes[idxRef.current])
      setVisible(true)
    }, 350)
  }, [quotes])

  useEffect(() => {
    const t = setInterval(next, interval)
    return () => clearInterval(t)
  }, [next, interval])

  return (
    <div className="quote-container" onClick={next} title="Click for next">
      <div
        className="landing-quote"
        style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.35s ease' }}
      >
        {current}
      </div>
    </div>
  )
}

const fmtUSD = (n) => {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n/1_000).toFixed(1)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(6)}`
}

export default function App() {
  const { user, profile, loading: authLoading, signOut } = useAuth()
  const tier = profile?.tier || 'free'

  // Auto-reanalyze from History — skip black hole, go straight to results
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const reanalyzeMint = searchParams.get('reanalyze')
    if (!reanalyzeMint) return
    setSearchParams({}, { replace: true })
    setMint(reanalyzeMint)
    setActiveMint(reanalyzeMint)
    setPhase('revealing')
    streamAnalyze(reanalyzeMint)
  }, [searchParams])

  const [authPage, setAuthPage]         = useState('landing')
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [isTrial, setIsTrial]           = useState(() => new URLSearchParams(window.location.search).get('trial') === '1')
  const [trialBlocked, setTrialBlocked] = useState(false)
  const [guestBlocked, setGuestBlocked]   = useState(false)
  const [upgradePrompt, setUpgradePrompt] = useState(null) // { title, message }
  const [collapsed, setCollapsed]       = useState({})
  const [mint, setMint]                 = useState('')
  const [activeMint, setActiveMint]     = useState('')
  const [copied, setCopied]             = useState(false)
  const [sharecopied, setShareCopied]   = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(null)
  const [badgePopupQueue, setBadgePopupQueue] = useState([])
  const [activeBadgePopup, setActiveBadgePopup] = useState(null)
  const knownBadgeIdsRef = useRef(null)
  // Animation state machine: idle → animating → black → revealing → done
  const [phase, setPhase] = useState('idle')
  // phase: idle | animating | black | revealing

  const {
    status, statusMsg, snapshot, prediction, preview, partials,
    lastUpdated, rateLimit, analyze: streamAnalyze, refresh: streamRefresh, disconnect,
  } = useStreamAnalysis()

  // Handle Stripe payment success redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      const tier = params.get('tier') || 'degen'
      setPaymentSuccess(tier)
      window.history.replaceState({}, '', window.location.pathname)
      setTimeout(() => setPaymentSuccess(null), 5000)
    }
  }, [])

  // Reset trial when user logs in
  useEffect(() => {
    if (user) { setIsTrial(false); setTrialBlocked(false); setGuestBlocked(false); localStorage.removeItem('orbit_guest_analyzed') }
  }, [user])




  // Set guestBlocked after auth resolves
  useEffect(() => {
    if (!authLoading && !user && localStorage.getItem('orbit_guest_analyzed') === '1') {
      setGuestBlocked(true)
    }
    if (user) {
      setGuestBlocked(false)
    }
  }, [authLoading, user])

  // Sync rate limit usage from backend on mount
  useEffect(() => {
    if (!user || tier !== 'free') return
    const today = new Date().toISOString().slice(0,10)
    const key = `orbit_usage_${user.id}_${today}`
    fetch(`https://backend-production-a427a.up.railway.app/usage?user_id=${user.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.count !== undefined) {
          localStorage.setItem(key, String(data.count))
        }
      })
      .catch(() => {})
  }, [user, tier])

  const togglePanel = (panel) => setCollapsed(prev => ({...prev, [panel]: !prev[panel]}))


  // ── Gate function — call before ANY analysis ─────────────────────────
  const checkCanAnalyze = useCallback(() => {
    // Both regular guests and trial guests share the same 1-analysis limit
    if (!user && localStorage.getItem('orbit_guest_analyzed') === '1') {
      setGuestBlocked(true)
      return false
    }
    if (user && tier === 'free') {
      const today = new Date().toISOString().slice(0,10)
      const used = parseInt(localStorage.getItem(`orbit_usage_${user.id}_${today}`) || '0')
      if (used >= 5) {
        setUpgradePrompt({
          title: 'Daily limit reached',
          message: 'You have used all 5 free analyses for today. Upgrade to Degen for unlimited analyses.',
          cta: 'Upgrade to Degen',
          ctaPath: '/pricing',
        })
        return false
      }
    }
    return true
  }, [user, tier])

  const analyze = useCallback(async (mintAddress) => {
    if (!mintAddress?.trim()) return
    if (!checkCanAnalyze()) return  // blocks before any animation or API call
    // All checks passed — now start the animation and API call
    setActiveMint(mintAddress.trim())
    setPhase('animating')
    streamAnalyze(mintAddress).then(result => {
      if (result?.trialUsed) { setPhase('idle'); setTrialBlocked(true) }
      if (result?.trialConsumed) setIsTrial(true)
      // Guest: mark as used after first analysis — clear results and show modal only
      if (!user) {
        localStorage.setItem('orbit_guest_analyzed', '1')
        setGuestBlocked(true)
        // Reset phase so dashboard doesn't show behind the modal
        setPhase('idle')
        disconnect()
      }
      // Free user: increment local daily counter
      if (user && tier === 'free') {
        const key = `orbit_usage_${user.id}_${new Date().toISOString().slice(0,10)}`
        const used = parseInt(localStorage.getItem(key) || '0')
        localStorage.setItem(key, String(used + 1))
      }
      // Rate limit exceeded for free users
      if (result?.rateLimitExceeded) {
        setUpgradePrompt({
          title: 'Daily limit reached',
          message: result?.message || "You've used all 5 free analyses for today. Upgrade to Degen for unlimited analyses.",
          cta: 'Upgrade to Degen',
          ctaPath: '/pricing',
        })
      }
      setTimeout(() => checkNewBadges(), 3000)
    })
  }, [streamAnalyze])

  const handleRefresh = useCallback(async () => {
    if (!checkCanAnalyze()) return
    if (!activeMint) return
    // Brief fade out then back in
    setPhase('idle')
    setTimeout(() => {
      setPhase('revealing')
      streamRefresh(activeMint).then(result => {
        if (result?.trialUsed) { setPhase('idle'); setTrialBlocked(true) }
      })
    }, 50)
  }, [user, isTrial, activeMint, streamRefresh])


  // Check for newly awarded badges after analysis
  const checkNewBadges = useCallback(async () => {
    if (!user) return
    const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'
    try {
      const res = await fetch(`${BACKEND}/badges/user/${user.id}`)
      const data = await res.json()
      const currentBadges = data.badges || []
      const currentIds = new Set(currentBadges.map(b => b.id))

      if (knownBadgeIdsRef.current === null) {
        // First load — just store, don't popup
        knownBadgeIdsRef.current = currentIds
        return
      }

      // Find newly awarded badges
      const newBadges = currentBadges.filter(b => !knownBadgeIdsRef.current.has(b.id))
      if (newBadges.length > 0) {
        knownBadgeIdsRef.current = currentIds
        setBadgePopupQueue(prev => [...prev, ...newBadges])
      }
    } catch(e) {
      console.error('[badges]', e)
    }
  }, [user])

  // Check guest analysis limit on mount
  useEffect(() => {
    if (!user && localStorage.getItem('orbit_guest_analyzed') === '1') {
      setGuestBlocked(true)
    }
  }, [user])

  // Auto-run from onboarding
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const mintParam = params.get('mint')
    const fromOnboarding = params.get('onboarding') === '1'
    if (mintParam && fromOnboarding) {
      setMintAddress(mintParam)
      setTimeout(() => {
        streamAnalyze(mintParam).then(result => {
          if (!user) {
            localStorage.setItem('orbit_guest_analyzed', '1')
            setGuestBlocked(true)
          }
          if (result?.trialUsed) { setPhase('idle'); setTrialBlocked(true) }
          if (result?.trialConsumed) setIsTrial(true)
          setTimeout(() => checkNewBadges(), 3000)
        })
        setPhase('animating')
        setActiveMint(mintParam)
      }, 400)
    }
  }, [])

  // Initialize known badges on mount
  useEffect(() => {
    if (!user || knownBadgeIdsRef.current !== null) return
    const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'
    fetch(`${BACKEND}/badges/user/${user.id}`)
      .then(r => r.json())
      .then(data => {
        knownBadgeIdsRef.current = new Set((data.badges || []).map(b => b.id))
      })
      .catch(() => {})
  }, [user])

  // Process popup queue
  useEffect(() => {
    if (activeBadgePopup || badgePopupQueue.length === 0) return
    const [next, ...rest] = badgePopupQueue
    setActiveBadgePopup(next)
    setBadgePopupQueue(rest)
  }, [badgePopupQueue, activeBadgePopup])

  const dismissBadgePopup = useCallback(() => {
    setActiveBadgePopup(null)
  }, [])

  const shareAnalysis = useCallback(async () => {
    if (!activeMint) return
    // Fetch the most recent prediction id for this mint
    try {
      const { data } = await supabase
        .from('predictions')
        .select('id')
        .eq('mint', activeMint)
        .order('snapshot_timestamp', { ascending: false })
        .limit(1)
        .single()
      if (data?.id) {
        const url = `${window.location.origin}/share/${data.id}`
        navigator.clipboard.writeText(url)
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2000)
      }
    } catch(e) { console.error('share error', e) }
  }, [activeMint])


  const downloadAnalysisImage = useCallback(() => {
    if (!snapshot || !prediction) return
    const W = 1200, H = 630
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    const PAD = 52

    const fmtU = (n) => {
      if (!n && n !== 0) return '—'
      if (n >= 1_000_000) return '$' + (n/1_000_000).toFixed(2) + 'M'
      if (n >= 1_000) return '$' + (n/1_000).toFixed(1) + 'K'
      return '$' + n.toFixed(2)
    }

    function rrect(x, y, w, h, r, fill, stroke) {
      ctx.beginPath()
      ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r)
      ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
      ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r)
      ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath()
      if (fill) { ctx.fillStyle = fill; ctx.fill() }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke() }
    }

    function drawCirc(cx, cy, r, pct, col) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2)
      ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 9; ctx.stroke()
      if (pct > 0) {
        ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + (pct/100)*Math.PI*2)
        ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt'
      }
    }

    function sColor(v, hi, mid, highBad) {
      if (highBad) return v >= hi ? '#ef4444' : v >= mid ? '#fbbf24' : '#4ade80'
      return v >= hi ? '#4ade80' : v >= mid ? '#fbbf24' : '#ef4444'
    }

    // BG
    const bg = ctx.createLinearGradient(0,0,0,H)
    bg.addColorStop(0,'#060608'); bg.addColorStop(1,'#0a0a0f')
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H)

    // Stars
    ;[...Array(80)].forEach((_,i) => {
      const sx = ((i*137.508+42)%1)*W, sy = ((i*97.312+13)%1)*H
      ctx.beginPath(); ctx.arc(sx,sy,i%3===0?1.5:0.8,0,Math.PI*2)
      ctx.fillStyle = `rgba(255,255,255,${0.15+(i%5)*0.08})`; ctx.fill()
    })

    // Glow
    const glow = ctx.createRadialGradient(W*0.85,H*0.15,0,W*0.85,H*0.15,380)
    glow.addColorStop(0,'rgba(120,80,220,0.12)'); glow.addColorStop(1,'rgba(0,0,0,0)')
    ctx.fillStyle = glow; ctx.fillRect(0,0,W,H)

    // Card
    rrect(PAD,PAD,W-PAD*2,H-PAD*2,16,'#0d0d0dcc','#1e1e1e')

    // Header
    rrect(PAD,PAD,W-PAD*2,56,0,'#0808088a',null)
    ctx.strokeStyle='#161616'; ctx.lineWidth=1
    ctx.beginPath(); ctx.moveTo(PAD,PAD+56); ctx.lineTo(W-PAD,PAD+56); ctx.stroke()
    ctx.fillStyle='#fff'; ctx.font='700 14px monospace'; ctx.textAlign='left'
    ctx.fillText('ORBIT', PAD+24, PAD+36)
    ctx.fillStyle='#1e1e1e'; ctx.font='11px monospace'; ctx.textAlign='right'
    ctx.fillText('orbit-app.xyz', W-PAD-24, PAD+36); ctx.textAlign='left'

    // Coin name
    const CY = PAD + 56 + 36
    ctx.fillStyle='#f1f5f9'; ctx.font='800 32px sans-serif'
    ctx.fillText((snapshot.name || '—').slice(0,28), PAD+24, CY)
    ctx.fillStyle='#475569'; ctx.font='13px monospace'
    ctx.fillText(`${snapshot.symbol || ''}  ·  MC: ${fmtU(snapshot.market_cap_usd)}`, PAD+24, CY+24)

    // Divider
    ctx.strokeStyle='#161616'; ctx.lineWidth=1
    ctx.beginPath(); ctx.moveTo(PAD+24,CY+44); ctx.lineTo(W-PAD-24,CY+44); ctx.stroke()

    const COL1X = PAD+24, COL2X = W/2+20, ROW2Y = CY+64

    // Scores
    ctx.fillStyle='#334155'; ctx.font='700 9px monospace'
    ctx.fillText('SCORES', COL1X, ROW2Y+4)

    const purity = Math.max(0, 100-(prediction.risk_score||0))
    const rugP = Math.round(prediction.rug_probability??0)
    const bundleP = Math.round(snapshot.bundle_confidence??0)
    const scores = [
      {label:'Rug %', val:rugP, col:sColor(rugP,70,40,true)},
      {label:'Purity', val:Math.round(purity), col:sColor(purity,70,40,false)},
      {label:'Bundle %', val:bundleP, col:sColor(bundleP,60,30,true)},
    ]
    scores.forEach((s,i) => {
      const cx2 = COL1X+50+i*130, cy2 = ROW2Y+70
      drawCirc(cx2,cy2,38,s.val,s.col)
      ctx.fillStyle=s.col; ctx.font='700 20px sans-serif'; ctx.textAlign='center'
      ctx.fillText(s.val,cx2,cy2+7)
      ctx.fillStyle='#475569'; ctx.font='10px monospace'
      ctx.fillText(s.label,cx2,cy2+56); ctx.textAlign='left'
    })

    // Momentum + Stage
    const TAG_Y = ROW2Y+160
    const mom = (prediction.momentum||'—').toUpperCase()
    const stg = (prediction.stage||'—').replace(/_/g,' ').toUpperCase()
    const mCol = {DEAD:'#475569',WEAK:'#64748b',BUILDING:'#fbbf24',STRONG:'#4ade80',PARABOLIC:'#4ade80'}[mom]||'#64748b'
    rrect(COL1X,TAG_Y,160,40,6,'#111','#1e1e1e')
    ctx.fillStyle='#475569'; ctx.font='9px monospace'; ctx.fillText('MOMENTUM',COL1X+12,TAG_Y+14)
    ctx.fillStyle=mCol; ctx.font='700 13px sans-serif'; ctx.fillText(mom,COL1X+12,TAG_Y+30)
    rrect(COL1X+172,TAG_Y,160,40,6,'#111','#1e1e1e')
    ctx.fillStyle='#475569'; ctx.font='9px monospace'; ctx.fillText('STAGE',COL1X+184,TAG_Y+14)
    ctx.fillStyle='#94a3b8'; ctx.font='700 13px sans-serif'; ctx.fillText(stg,COL1X+184,TAG_Y+30)

    // Vertical divider
    ctx.strokeStyle='#161616'; ctx.lineWidth=1
    ctx.beginPath(); ctx.moveTo(W/2+4,CY+54); ctx.lineTo(W/2+4,H-PAD-60); ctx.stroke()

    // Right — peak
    ctx.fillStyle='#334155'; ctx.font='700 9px monospace'; ctx.fillText('ESTIMATED PEAK MC',COL2X,ROW2Y+4)
    ctx.fillStyle='#a78bfa'; ctx.font='800 44px sans-serif'
    ctx.fillText(fmtU(prediction.estimated_peak_mc),COL2X,ROW2Y+52)
    ctx.fillStyle='#334155'; ctx.font='12px monospace'
    ctx.fillText(`${fmtU(prediction.peak_mc_range?.low)} – ${fmtU(prediction.peak_mc_range?.high)}`,COL2X,ROW2Y+74)

    // Prob bars
    ctx.strokeStyle='#161616'
    ctx.beginPath(); ctx.moveTo(COL2X,ROW2Y+90); ctx.lineTo(W-PAD-24,ROW2Y+90); ctx.stroke()
    ctx.fillStyle='#334155'; ctx.font='700 9px monospace'; ctx.fillText('PROBABILITY OF REACHING',COL2X,ROW2Y+108)
    const probs = prediction.probability_bands || {}
    const pArr = [['$100K','100k'],['$250K','250k'],['$500K','500k'],['$1M','1m'],['$5M','5m']]
    const BAR_W = W-PAD-24-COL2X-60
    pArr.forEach(([lbl,key],i) => {
      const val = Math.round(probs[key]||0), by = ROW2Y+124+i*36
      ctx.fillStyle='#475569'; ctx.font='11px monospace'; ctx.fillText(lbl,COL2X,by+4)
      const col = val>=50?'#4ade80':val>=25?'#fbbf24':'#ef4444'
      const bx = COL2X+52
      rrect(bx,by-6,BAR_W,10,5,'#1a1a1a',null)
      if (val>0) rrect(bx,by-6,Math.max(10,BAR_W*val/100),10,5,col,null)
      ctx.fillStyle=col; ctx.font='700 10px monospace'; ctx.textAlign='right'
      ctx.fillText(`${val}%`,W-PAD-24,by+4); ctx.textAlign='left'
    })

    // Footer
    ctx.strokeStyle='#161616'
    ctx.beginPath(); ctx.moveTo(PAD,H-PAD-36); ctx.lineTo(W-PAD,H-PAD-36); ctx.stroke()
    ctx.fillStyle='#2a2a2a'; ctx.font='11px monospace'
    ctx.fillText('orbit-app.xyz',PAD+24,H-PAD-14)
    ctx.fillStyle='#1a1a1a'; ctx.textAlign='right'
    ctx.fillText(`orbit-app.xyz`,W-PAD-24,H-PAD-14); ctx.textAlign='left'

    const link = document.createElement('a')
    link.download = `orbit-${(snapshot.symbol||activeMint?.slice(0,8)||'analysis').toLowerCase()}.png`
    link.href = canvas.toDataURL('image/png',1.0)
    link.click()
  }, [snapshot, prediction, activeMint])

  const copyCa = useCallback(() => {
    navigator.clipboard.writeText(activeMint).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [activeMint])

  // Auth routing — after all hooks
  const isCallback = window.location.pathname === '/auth/callback' ||
    window.location.hash.includes('access_token') ||
    window.location.search.includes('code=')

  if (authLoading) return (
    <>
      <StarField />
      <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div className="loading-spinner" />
      </div>
    </>
  )

  if (isCallback) return <><StarField /><AuthCallback /></>

  // Payment success toast
  const PaymentToast = paymentSuccess ? (
    <div style={{
      position:'fixed', top:16, right:16, zIndex:9999,
      background: paymentSuccess==='omega' ? '#f59e0b' : '#a78bfa',
      color:'#000', fontFamily:'var(--mono)', fontSize:11,
      fontWeight:700, letterSpacing:'1px', padding:'10px 18px',
      borderRadius:6, boxShadow:'0 4px 20px rgba(0,0,0,0.4)',
      animation:'fadeIn 0.3s ease',
    }}>
      🎉 Welcome to {paymentSuccess.toUpperCase()}! Your subscription is active.
    </div>
  ) : null

  if (!user && !isTrial) {
    if (authPage === 'signup') return <><StarField /><SignUp onSwitch={setAuthPage} /></>
    if (authPage === 'forgot') return <><StarField /><ForgotPassword onSwitch={setAuthPage} /></>
    if (authPage === 'login')  return <><StarField /><Login onSwitch={setAuthPage} onTrial={() => setIsTrial(true)} /></>
    return <Landing onSwitch={setAuthPage} />
  }

  const showLanding = phase === 'idle' || phase === 'animating'

  return (

    <div className={`app ${phase === "revealing" ? "phase-revealing" : ""}`}>
      {(phase === 'idle' || phase === 'animating') && <StarField />}

      <BlackHole
        active={phase === 'animating'}
        onBlack={() => { setPhase('revealing') }}
      />

      <NavBar
        active="analyze"
        onLogoClick={() => { disconnect(); setActiveMint(''); setPhase('idle'); setMint('') }}
      />
      <header className="app-header" style={{display:'none'}}>
        <div className="user-menu">
          {user ? (
            <>
              <div className="user-avatar" onClick={() => setShowAccountMenu(p => !p)} title={user.email}>
                {user.email?.slice(0,2).toUpperCase()}
              </div>
              {showAccountMenu && (
                <div className="account-dropdown">
                  <div className="account-email">{user.email}</div>
                  <div className="account-divider" />
                  <button className="account-item account-item-danger" onClick={() => { signOut(); setShowAccountMenu(false) }}>
                    Sign out
                  </button>
                </div>
              )}
            </>
          ) : (
            <button className="btn-signout" onClick={() => setIsTrial(false)}>Sign in</button>
          )}
        </div>
      </header>


      <div className="app-body">

        {/* Landing */}
        {showLanding && (
          <div className="landing" id="landing-screen">
            <img src={kikoPfp} alt="ORBIT" className="landing-pfp" />
            <div className="landing-input-wrap">
              <CoinInput value={mint} onChange={setMint} onSubmit={() => { if (!checkCanAnalyze()) return; analyze(mint) }}
                onRefresh={handleRefresh} loading={false} hasData={false} />
            </div>
            <CyclingQuote quotes={IDLE_QUOTES} interval={6000} />
          </div>
        )}

        {/* Loading — shows preview card if market data arrived, spinner otherwise */}
        {status === 'loading' && !snapshot && phase === 'idle' && (
          <div className="landing">
            <img src={kikoPfp} alt="ORBIT" className="landing-pfp loading-pfp" />
            <div className="landing-input-wrap">
              <CoinInput value={mint} onChange={setMint} onSubmit={() => { if (!checkCanAnalyze()) return; analyze(mint) }}
                onRefresh={handleRefresh} loading={true} hasData={false} />
            </div>
            <CyclingQuote quotes={ANALYZING_QUOTES} interval={5000} />
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="landing" id="landing-screen">
            <img src={kikoPfp} alt="ORBIT" className="landing-pfp" />
            <div className="landing-input-wrap">
              <CoinInput value={mint} onChange={setMint} onSubmit={() => { if (!checkCanAnalyze()) return; analyze(mint) }}
                onRefresh={handleRefresh} loading={false} hasData={false} />
            </div>
            <div className="error-inline">⚠ {statusMsg}</div>
          </div>
        )}

        {/* Trial blocked modal */}
        {guestBlocked && (
        <div className="trial-modal-overlay">
          <div className="trial-modal">
            <img src={kikoPfp} className="trial-modal-pfp" alt="" />
            <h2 className="trial-modal-title">Create a free account</h2>
            <p className="trial-modal-sub">You've used your guest analysis. Sign up free to get 5 analyses per day, full forum access, and more.</p>
            <button className="btn-primary" style={{width:'100%',marginTop:8}} onClick={() => window.location.href='/signup'}>Create Free Account</button>
            <button style={{background:'none',border:'none',color:'#64748b',fontSize:12,cursor:'pointer',marginTop:8}} onClick={() => window.location.href='/login'}>Already have an account? Sign in</button>
          </div>
        </div>
      )}
      {/* Guest blocked modal */}
      {guestBlocked && !user && (
        <div className="trial-modal-overlay" style={{backdropFilter:'blur(8px)'}}>
          <div className="trial-modal" style={{maxWidth:380}}>
            <img src={kikoPfp} className="trial-modal-pfp" alt="" />
            <h2 className="trial-modal-title">Create a free account</h2>
            <p className="trial-modal-sub">You've used your guest analysis. Sign up free to get 5 analyses per day, full forum access, tracker, and more.</p>
            <button className="btn-primary" style={{width:'100%',marginTop:8,background:'#a78bfa',border:'none',borderRadius:6,color:'#000',fontFamily:'var(--mono)',fontSize:12,fontWeight:700,padding:'12px',cursor:'pointer',letterSpacing:1}} onClick={() => window.location.href='/signup'}>
              Create Free Account →
            </button>
            <button style={{background:'none',border:'none',color:'#64748b',fontSize:12,cursor:'pointer',marginTop:8,fontFamily:'var(--mono)'}} onClick={() => window.location.href='/login'}>
              Already have an account? Sign in
            </button>
          </div>
        </div>
      )}

      {/* Upgrade prompt modal */}
      {upgradePrompt && (
        <div className="trial-modal-overlay" style={{backdropFilter:'blur(8px)'}}>
          <div className="trial-modal" style={{maxWidth:380}}>
            <img src={kikoPfp} className="trial-modal-pfp" alt="" />
            <h2 className="trial-modal-title">{upgradePrompt.title}</h2>
            <p className="trial-modal-sub">{upgradePrompt.message}</p>
            <button className="btn-primary" style={{width:'100%',marginTop:8,background:'#a78bfa',border:'none',borderRadius:6,color:'#000',fontFamily:'var(--mono)',fontSize:12,fontWeight:700,padding:'12px',cursor:'pointer',letterSpacing:1}} onClick={() => window.location.href=upgradePrompt.ctaPath}>
              {upgradePrompt.cta} →
            </button>
            <button style={{background:'none',border:'none',color:'#64748b',fontSize:12,cursor:'pointer',marginTop:8,fontFamily:'var(--mono)'}} onClick={() => setUpgradePrompt(null)}>
              Maybe later
            </button>
          </div>
        </div>
      )}

      {trialBlocked && (
          <div className="trial-modal-overlay">
            <div className="trial-modal">
              <img src={kikoPfp} alt="ORBIT" className="trial-modal-pfp" />
              <h2 className="trial-modal-title">Your free analysis is up.</h2>
              <p className="trial-modal-sub">Create a free account to keep analyzing coins with Orbit.</p>
              <button className="btn-primary" style={{width:'100%'}} onClick={() => { setTrialBlocked(false); setIsTrial(false); setAuthPage('signup') }}>
                Create account — it's free
              </button>
              <button className="link-btn" style={{marginTop:10}} onClick={() => { setTrialBlocked(false); setIsTrial(false); setAuthPage('login') }}>
                Already have an account? Sign in
              </button>
            </div>
          </div>
        )}

        {/* Analysis dashboard */}
        {phase === 'revealing' && (
          <div className="dashboard">
            {/* ── Desktop 4-col grid / Mobile single col stack ── */}
            <div className="dash-grid" key={activeMint}>

              {/* Col 1 — Market Data */}
              <div className="dash-col dash-col-1">
                {(partials?.market || snapshot) && (
                  <StreamReveal show={phase === "revealing"} delay={300}>
                    <CollapsiblePanel title="Market Data" id="market" collapsed={collapsed} toggle={togglePanel}>
                      <MetricsPanel snapshot={snapshot || partials?.market} />
                    </CollapsiblePanel>
                  </StreamReveal>
                )}

              </div>

              {/* Col 2+3 — Input + Coin Name + Kiko Analysis + Signal Flags */}
              <div className="dash-col dash-col-center">
                {/* Coin name + CA block — loads first */}
                {(snapshot || partials?.market) && (
                  <StreamReveal show={phase === "revealing"} delay={0}>
                  <div className="panel coin-name-panel">
                    <div className="coin-name-row">
                      <button className="btn-copy-icon" onClick={copyCa} data-ca={activeMint} title={activeMint}>
                        {copied ? '✓' : '⧉'}
                      </button>
                      <button className="btn-copy-icon" onClick={downloadAnalysisImage} title="Download analysis as image" style={{fontSize:'12px', letterSpacing:'0.5px'}}>↓ img</button>
                      <div className="coin-name-center">
                        <span className="coin-title-name">{(snapshot || partials?.market)?.name}</span>
                        <span className="coin-title-symbol">{(snapshot || partials?.market)?.symbol}</span>
                        {(snapshot || partials?.market)?.chain === 'ethereum'
                          ? <span className="badge badge-eth">ETH</span>
                          : <span className="badge badge-sol">SOL</span>}
                        {(snapshot || partials?.market)?.is_migrated && <span className="badge badge-blue">Migrated</span>}
                        {snapshot?.king_of_the_hill && <span className="badge badge-yellow">👑 KOTH</span>}
                      </div>
                      <button className="btn-refresh-inline" onClick={handleRefresh} title="Refresh analysis">↻</button>
                      <button className="btn-refresh-inline" onClick={shareAnalysis} title="Share analysis" style={{marginLeft:4, color: sharecopied ? '#4ade80' : undefined}}>{sharecopied ? '✓' : '↗'}</button>
                    </div>
                  </div>
                  </StreamReveal>
                )}
                <StreamReveal show={phase === "revealing"} delay={0}>
                  <CollapsiblePanel title="Orbit Analysis" id="analysis" collapsed={collapsed} toggle={togglePanel}>
                    <PredictionPanel prediction={prediction} snapshot={snapshot} />
                  </CollapsiblePanel>
                </StreamReveal>

              </div>

              {/* Col 4 — Input + Top Holders */}
              <div className="dash-col dash-col-4">
                <StreamReveal show={phase === "revealing"} delay={600}>
                <div className="panel center-input-panel">
                  <CoinInput value={mint} onChange={setMint} onSubmit={() => { if (!checkCanAnalyze()) return; analyze(mint) }}
                    onRefresh={null} loading={status === 'loading'} hasData={false} />
                </div>
                </StreamReveal>

                {(partials?.holders || snapshot) && (
                  <StreamReveal show={phase === "revealing"} delay={600}>
                    <CollapsiblePanel title="Top Holders" id="holders" collapsed={collapsed} toggle={togglePanel}>
                      <HolderChart snapshot={{ ...(partials?.holders || {}), ...(snapshot || {}) }} />
                    </CollapsiblePanel>
                  </StreamReveal>
                )}
                {prediction && snapshot && (
                  <StreamReveal show={phase === "revealing"} delay={900}>
                    <CollapsiblePanel title="Signal Flags" id="flags" collapsed={collapsed} toggle={togglePanel}>
                      <FlagsList prediction={prediction} snapshot={snapshot} />
                    </CollapsiblePanel>
                  </StreamReveal>
                )}
              </div>

            </div>
          </div>
        )}

      </div>
      {activeBadgePopup && (
        <BadgePopup badge={activeBadgePopup} onClose={dismissBadgePopup} />
      )}
    </div>
  )
}
