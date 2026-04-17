import { useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import orbitPfp from '../orbitPfp.js'
import './Landing.css'

const SIGNALS = [
  'RUG PROBABILITY', 'HOLDER DISTRIBUTION', 'BUNDLE DETECTION',
  'FAKE CHART SCORING', 'DEV HISTORY', 'MIGRATION TRACKING',
  'FRESH WALLET SCAN', 'SNIPER DETECTION', 'LIQUIDITY DEPTH',
  'MOMENTUM SIGNALS', 'PURITY SCORE', 'PEAK MC ESTIMATE',
]

const PROBLEMS = [
  { icon: '⚠', text: 'You find a coin. It looks clean. You ape in. It rugs in 4 minutes.' },
  { icon: '📊', text: 'You\'re reading charts alone while the people with real data are already out.' },
  { icon: '💬', text: 'Alpha gets shared in private groups. You\'re always the last to know.' },
  { icon: '🎰', text: 'Every trade feels like a coin flip because you\'re flying blind.' },
]

const PILLARS = [
  {
    icon: '⬡',
    label: 'Intelligence',
    title: 'Know what the chart won\'t tell you.',
    desc: 'Rug probability. Bundle wallets. Dev history. Fake volume scoring. Fresh wallet concentration. AI narrative. All in under 5 seconds.',
  },
  {
    icon: '◈',
    label: 'Community',
    title: 'Trade alongside people who know what they\'re doing.',
    desc: 'Forum built for degens. Share analysis, post calls, discuss tokens. Reputation earned through accuracy — not just noise.',
  },
  {
    icon: '◆',
    label: 'Accountability',
    title: 'Your PnL is on-chain. There\'s nowhere to hide.',
    desc: 'Monthly leaderboard pulled directly from DEX swap history. No self-reporting. No lying about entries. Real numbers, real traders.',
  },
]

const MOCK_SIGNALS = [
  { label: 'Rug Probability', value: '12%', color: '#4ade80' },
  { label: 'Bundle Score', value: '0%', color: '#4ade80' },
  { label: 'Purity', value: '74/100', color: '#a78bfa' },
  { label: 'Fresh Wallets', value: '3 (4%)', color: '#4ade80' },
  { label: 'Dev Sold', value: '0%', color: '#4ade80' },
  { label: 'Est. Peak', value: '$8.5M', color: '#a78bfa' },
]

function useInView(ref, threshold = 0.15) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true) }, { threshold })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return inView
}

function Section({ children, className = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref)
  return (
    <div ref={ref} className={`lp-section-wrap ${inView ? 'lp-in-view' : ''} ${className}`}>
      {children}
    </div>
  )
}

export default function Landing({ onSwitch }) {
  const canvasRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [mockVisible, setMockVisible] = useState(false)
  const mockRef = useRef(null)
  const mockInView = useInView(mockRef)

  useEffect(() => { setTimeout(() => setVisible(true), 60) }, [])
  useEffect(() => { if (mockInView) setTimeout(() => setMockVisible(true), 200) }, [mockInView])

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
      stars = Array.from({ length: 400 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.4 + 0.3,
        o: Math.random() * 0.6 + 0.15,
        speed: Math.random() * 0.012 + 0.004,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    const draw = (t) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      stars.forEach(s => {
        const opacity = s.o + Math.sin(t * 0.001 * s.speed * 60 + s.phase) * 0.2
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, opacity))})`
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
          <button className="lp-btn-primary" onClick={() => onSwitch('signup')}>Get started free</button>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-eyebrow">
          <span className="lp-dot" />
          Built for Solana traders
        </div>
        <h1 className="lp-hero-title">
          Stop trading blind.<br />
          <span className="lp-hero-accent">Start trading informed.</span>
        </h1>
        <p className="lp-hero-sub">
          Orbit is the platform where on-chain intelligence meets trader community.
          Analyze any Pump.fun token in seconds, discuss with real traders,
          and build a reputation based on actual performance.
        </p>
        <div className="lp-hero-cta">
          <button className="lp-btn-primary lp-btn-lg" onClick={() => onSwitch('signup')}>
            Create free account
          </button>
          <button className="lp-btn-outline lp-btn-lg" onClick={() => onSwitch('trial')}>
            Try one analysis free →
          </button>
        </div>
        <p className="lp-hero-note">No wallet required. No credit card. Ever.</p>

        {/* Floating signal tags */}
        <div className="lp-hero-tags">
          {SIGNALS.slice(0, 6).map((s, i) => (
            <span key={s} className="lp-signal-tag" style={{ animationDelay: `${i * 0.15}s` }}>{s}</span>
          ))}
        </div>
      </section>

      {/* Ticker */}
      <div className="lp-ticker-wrap">
        <div className="lp-ticker">
          {[...SIGNALS, ...SIGNALS].map((item, i) => (
            <span key={i} className="lp-ticker-item">
              <span className="lp-ticker-dot">◆</span>{item}
            </span>
          ))}
        </div>
      </div>

      {/* Problem */}
      <Section className="lp-problem-section">
        <div className="lp-section-eyebrow">The problem</div>
        <h2 className="lp-section-title">
          Most traders lose because they're<br />
          <span className="lp-accent-red">working with incomplete information.</span>
        </h2>
        <div className="lp-problems-grid">
          {PROBLEMS.map((p, i) => (
            <div key={i} className="lp-problem-card" style={{ animationDelay: `${i * 0.1}s` }}>
              <span className="lp-problem-icon">{p.icon}</span>
              <p className="lp-problem-text">{p.text}</p>
            </div>
          ))}
        </div>
        <div className="lp-problem-closer">
          You don't have a discipline problem. You have a data problem.
        </div>
      </Section>

      {/* Pillars */}
      <Section className="lp-pillars-section">
        <div className="lp-section-eyebrow">The platform</div>
        <h2 className="lp-section-title">
          Three things working together.<br />
          <span className="lp-hero-accent">Nothing like it exists.</span>
        </h2>
        <div className="lp-pillars-grid">
          {PILLARS.map((p, i) => (
            <div key={p.label} className="lp-pillar-card" style={{ animationDelay: `${i * 0.12}s` }}>
              <div className="lp-pillar-icon">{p.icon}</div>
              <div className="lp-pillar-label">{p.label}</div>
              <div className="lp-pillar-title">{p.title}</div>
              <div className="lp-pillar-desc">{p.desc}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Mock analysis */}
      <Section className="lp-mock-section">
        <div className="lp-section-eyebrow">The analyzer</div>
        <h2 className="lp-section-title">Paste a CA. Get the truth.</h2>
        <p className="lp-section-sub">
          20+ on-chain signals, AI narrative, and probability bands — in under 5 seconds.
        </p>
        <div ref={mockRef} className={`lp-mock-card ${mockVisible ? 'lp-mock-visible' : ''}`}>
          <div className="lp-mock-header">
            <div className="lp-mock-coin">
              <div className="lp-mock-coin-dot" />
              <span className="lp-mock-coin-name">ASTEROID</span>
              <span className="lp-mock-coin-badge">Migrated</span>
            </div>
            <div className="lp-mock-mc">$5.15M MC</div>
          </div>
          <div className="lp-mock-signals">
            {MOCK_SIGNALS.map((s, i) => (
              <div key={s.label} className="lp-mock-signal" style={{ animationDelay: mockVisible ? `${i * 0.08}s` : '0s' }}>
                <span className="lp-mock-signal-label">{s.label}</span>
                <span className="lp-mock-signal-value" style={{ color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
          <div className="lp-mock-bars">
            <div className="lp-mock-bar-label">Probability of reaching</div>
            {[['$100K', 100], ['$500K', 100], ['$1M', 92], ['$5M', 68], ['$10M', 42]].map(([label, pct], i) => (
              <div key={label} className="lp-mock-bar-row">
                <span className="lp-mock-bar-target">{label}</span>
                <div className="lp-mock-bar-track">
                  <div
                    className="lp-mock-bar-fill"
                    style={{ width: mockVisible ? `${pct}%` : '0%', transitionDelay: `${0.4 + i * 0.08}s` }}
                  />
                </div>
                <span className="lp-mock-bar-pct" style={{ color: pct >= 50 ? '#4ade80' : '#f97316' }}>{pct}%</span>
              </div>
            ))}
          </div>
          <div className="lp-mock-narrative">
            <span className="lp-mock-narrative-label">AI Analysis</span>
            ASTEROID shows strong post-migration fundamentals with clean holder distribution and zero dev risk. High organic volume suggests sustained interest. Recommend monitoring for entry on dips toward $4.2M...
          </div>
        </div>
        <button className="lp-btn-outline lp-btn-lg lp-mock-cta" onClick={() => onSwitch('trial')}>
          Try it yourself — free, no account needed →
        </button>
      </Section>

      {/* Wallet section */}
      <Section className="lp-wallet-section">
        <div className="lp-wallet-inner">
          <div className="lp-wallet-text">
            <div className="lp-section-eyebrow">Your wallet</div>
            <h2 className="lp-wallet-title">Optional. Seriously.</h2>
            <p className="lp-wallet-desc">
              Add your public Solana wallet address if you want your
              monthly PnL visible on the leaderboard. That's it.
              We pull read-only on-chain data — no connection request,
              no signing, no approvals.
            </p>
            <p className="lp-wallet-joke">
              Unlike other sites, we have zero interest in your money.<br />
              <span className="lp-wallet-joke-sub">We built a tool, not a trap.</span>
            </p>
          </div>
          <div className="lp-wallet-visual">
            <div className="lp-wallet-card">
              <div className="lp-wallet-card-label">Monthly PnL</div>
              <div className="lp-wallet-card-value c-green">+14.2 SOL</div>
              <div className="lp-wallet-card-sub">Verified on-chain · April 2026</div>
              <div className="lp-wallet-card-addr">7xK2...mF9p</div>
            </div>
          </div>
        </div>
      </Section>

      {/* Final CTA */}
      <Section className="lp-final-section">
        <div className="lp-final-inner">
          <div className="lp-final-eyebrow">
            <span className="lp-dot" /> Free to start
          </div>
          <h2 className="lp-final-title">
            The information gap is real.<br />
            <span className="lp-hero-accent">Close it.</span>
          </h2>
          <p className="lp-final-sub">
            No wallet. No credit card. One free analysis to see what you've been missing.
          </p>
          <div className="lp-final-btns">
            <button className="lp-btn-primary lp-btn-xl" onClick={() => onSwitch('signup')}>
              Create free account
            </button>
            <button className="lp-btn-ghost lp-btn-lg" onClick={() => onSwitch('trial')}>
              Try without account
            </button>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-logo">
          <img src={orbitPfp} className="lp-nav-pfp" alt="" />
          <span className="lp-nav-title">ORBIT</span>
          <span className="lp-nav-version">v0.2</span>
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
