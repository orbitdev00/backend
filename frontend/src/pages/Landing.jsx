import { useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import orbitPfp from '../orbitPfp.js'
import './Landing.css'

const STATS = [
  { value: '< 5s', label: 'Analysis Time' },
  { value: '20+', label: 'On-chain Signals' },
  { value: '100%', label: 'Solana Native' },
]

const FEATURES = [
  {
    icon: '⬡',
    title: 'Token Analyzer',
    desc: 'Paste any Pump.fun CA. Get rug probability, holder distribution, bundle detection, fake chart scoring, and an AI narrative in under 5 seconds.',
  },
  {
    icon: '◈',
    title: 'Community Forum',
    desc: 'Discuss calls, share alpha, post analysis. Threaded forum with voting, moderation, and real-time notifications.',
  },
  {
    icon: '◎',
    title: 'Price Tracker',
    desc: 'Watch any token and get an audio alert the moment it hits your target market cap. Watchlist syncs across devices.',
  },
  {
    icon: '◆',
    title: 'Trader Leaderboard',
    desc: 'Monthly PnL rankings pulled directly from on-chain DEX swaps. No self-reporting. Connect your wallet to compete.',
  },
]

const TICKER_ITEMS = [
  'RUG DETECTION', 'HOLDER ANALYSIS', 'BUNDLE SCORING',
  'FAKE CHART DETECTION', 'DEV HISTORY', 'MIGRATION TRACKING',
  'FRESH WALLET SCAN', 'SNIPER DETECTION', 'LIQUIDITY DEPTH',
  'MOMENTUM SIGNALS', 'COMMUNITY FORUM', 'MONTHLY PNL',
]

export default function Landing({ onSwitch }) {
  const nav = useNavigate()
  const canvasRef = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setTimeout(() => setVisible(true), 50)
  }, [])

  // Starfield
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf
    let stars = []

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
      stars = Array.from({ length: 350 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 0.9 + 0.1,
        o: Math.random() * 0.5 + 0.1,
        speed: Math.random() * 0.015 + 0.005,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    const draw = (t) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      stars.forEach(s => {
        const opacity = s.o + Math.sin(t * s.speed + s.phase) * 0.15
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, opacity)})`
        ctx.fill()
      })
      raf = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <div className={`lp-screen ${visible ? 'lp-visible' : ''}`}>
      <canvas ref={canvasRef} className="lp-stars" />

      {/* Nav */}
      <header className="lp-nav">
        <div className="lp-nav-logo">
          <img src={orbitPfp} className="lp-nav-pfp" alt="" />
          <span className="lp-nav-title">ORBIT</span>
          <span className="lp-nav-version">v0.2</span>
        </div>
        <div className="lp-nav-actions">
          <button className="lp-btn-ghost" onClick={() => onSwitch('login')}>Sign in</button>
          <button className="lp-btn-primary" onClick={() => onSwitch('signup')}>Get started</button>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-eyebrow">
          <span className="lp-dot" />
          Solana Memecoin Intelligence
        </div>
        <h1 className="lp-hero-title">
          Know before<br />
          <span className="lp-hero-accent">everyone else.</span>
        </h1>
        <p className="lp-hero-sub">
          Orbit analyzes any Pump.fun token in under 5 seconds — rug probability,
          holder distribution, fake chart scoring, and AI-generated narrative.
          Free to use.
        </p>
        <div className="lp-hero-cta">
          <button className="lp-btn-primary lp-btn-lg" onClick={() => onSwitch('signup')}>
            Create free account
          </button>
          <button className="lp-btn-ghost lp-btn-lg" onClick={() => onSwitch('login')}>
            Sign in →
          </button>
        </div>
        <div className="lp-hero-stats">
          {STATS.map(s => (
            <div key={s.label} className="lp-stat">
              <span className="lp-stat-value">{s.value}</span>
              <span className="lp-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Ticker */}
      <div className="lp-ticker-wrap">
        <div className="lp-ticker">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span key={i} className="lp-ticker-item">
              <span className="lp-ticker-dot">◆</span>
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* Features */}
      <section className="lp-features">
        <div className="lp-section-label">What's inside</div>
        <div className="lp-features-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="lp-feature-card">
              <div className="lp-feature-icon">{f.icon}</div>
              <div className="lp-feature-title">{f.title}</div>
              <div className="lp-feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="lp-how">
        <div className="lp-section-label">How it works</div>
        <div className="lp-steps">
          <div className="lp-step">
            <div className="lp-step-num">01</div>
            <div className="lp-step-title">Paste a contract address</div>
            <div className="lp-step-desc">Any token on Pump.fun or Raydium. No setup, no wallet connection required.</div>
          </div>
          <div className="lp-step-arrow">→</div>
          <div className="lp-step">
            <div className="lp-step-num">02</div>
            <div className="lp-step-title">Orbit scans the chain</div>
            <div className="lp-step-desc">20+ on-chain signals pulled in real time — holders, dev history, bundle wallets, liquidity.</div>
          </div>
          <div className="lp-step-arrow">→</div>
          <div className="lp-step">
            <div className="lp-step-num">03</div>
            <div className="lp-step-title">Get your verdict</div>
            <div className="lp-step-desc">Rug probability, estimated peak MC, probability bands, and an AI narrative — in under 5 seconds.</div>
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="lp-cta-banner">
        <div className="lp-cta-inner">
          <div className="lp-cta-title">Ready to stop guessing?</div>
          <div className="lp-cta-sub">Free account. No wallet required to start.</div>
          <button className="lp-btn-primary lp-btn-lg" onClick={() => onSwitch('signup')}>
            Create free account
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-logo">
          <img src={orbitPfp} className="lp-nav-pfp" alt="" />
          <span className="lp-nav-title">ORBIT</span>
        </div>
        <div className="lp-footer-links">
          <button className="lp-footer-link" onClick={() => onSwitch('login')}>Sign in</button>
          <button className="lp-footer-link" onClick={() => onSwitch('signup')}>Sign up</button>
        </div>
        <div className="lp-footer-copy">orbit-app.xyz · {new Date().getFullYear()}</div>
      </footer>
    </div>
  )
}
