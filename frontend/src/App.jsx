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
import Landing from './pages/Landing'
import { useStreamAnalysis } from './hooks/useStreamAnalysis'
import Login from './pages/Login'
import SignUp from './pages/SignUp'
import ForgotPassword from './pages/ForgotPassword'
import AuthCallback from './pages/AuthCallback'
import { supabase } from './lib/supabase'
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
  const { user, loading: authLoading, signOut } = useAuth()

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
  const [collapsed, setCollapsed]       = useState({})
  const [mint, setMint]                 = useState('')
  const [activeMint, setActiveMint]     = useState('')
  const [copied, setCopied]             = useState(false)
  // Animation state machine: idle → animating → black → revealing → done
  const [phase, setPhase] = useState('idle')
  // phase: idle | animating | black | revealing

  const {
    status, statusMsg, snapshot, prediction, preview, partials,
    lastUpdated, analyze: streamAnalyze, refresh: streamRefresh, disconnect,
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
    if (user) { setIsTrial(false); setTrialBlocked(false) }
  }, [user])



  const togglePanel = (panel) => setCollapsed(prev => ({...prev, [panel]: !prev[panel]}))

  const analyze = useCallback(async (mintAddress) => {
    if (!mintAddress?.trim()) return
    setActiveMint(mintAddress.trim())
    setPhase('animating')
    streamAnalyze(mintAddress).then(result => {
      if (result?.trialUsed) { setPhase('idle'); setTrialBlocked(true) }
      if (result?.trialConsumed) setIsTrial(true)
    })
  }, [streamAnalyze])

  const handleRefresh = useCallback(async () => {
    if (!user && isTrial) { setTrialBlocked(true); return }
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
              <CoinInput value={mint} onChange={setMint} onSubmit={() => analyze(mint)}
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
              <CoinInput value={mint} onChange={setMint} onSubmit={() => analyze(mint)}
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
              <CoinInput value={mint} onChange={setMint} onSubmit={() => analyze(mint)}
                onRefresh={handleRefresh} loading={false} hasData={false} />
            </div>
            <div className="error-inline">⚠ {statusMsg}</div>
          </div>
        )}

        {/* Trial blocked modal */}
        {trialBlocked && (
          <div className="trial-modal-overlay">
            <div className="trial-modal">
              <img src={orbitPfp} alt="ORBIT" className="trial-modal-pfp" />
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
                {prediction && snapshot && (
                  <StreamReveal show={phase === "revealing"} delay={900}>
                    <CollapsiblePanel title="PnL Scenarios" id="pnl" collapsed={collapsed} toggle={togglePanel}>
                      <PnlPanel prediction={prediction} />
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
                      <div className="coin-name-center">
                        <span className="coin-title-name">{(snapshot || partials?.market)?.name}</span>
                        <span className="coin-title-symbol">{(snapshot || partials?.market)?.symbol}</span>
                        {(snapshot || partials?.market)?.is_migrated && <span className="badge badge-blue">Migrated</span>}
                        {snapshot?.king_of_the_hill && <span className="badge badge-yellow">👑 KOTH</span>}
                      </div>
                      <button className="btn-refresh-inline" onClick={handleRefresh} title="Refresh analysis">↻</button>
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
                  <CoinInput value={mint} onChange={setMint} onSubmit={() => analyze(mint)}
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
    </div>
  )
}
