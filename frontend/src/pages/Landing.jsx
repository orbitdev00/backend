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
  { icon: '⚠', text: 'You find a coin. It looks clean. You ape in. It rugs.' },
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

const SOCIALS = [
  { icon: '𝕏', label: 'Twitter', url: 'https://x.com/OrbitDevs00' },
  { icon: '💬', label: 'Discord', url: 'https://discord.gg/792YWsb4sA' },
  { icon: '⌥', label: 'GitHub', url: 'https://github.com/orbitdev00' },
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

  // Parallax scroll ref
  const scrollYRef = useRef(0)
  useEffect(() => {
    const onScroll = () => { scrollYRef.current = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Starfield with parallax
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf
    let stars = []

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight + 300
      stars = Array.from({ length: 400 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.4 + 0.3,
        o: Math.random() * 0.6 + 0.15,
        speed: Math.random() * 0.012 + 0.004,
        phase: Math.random() * Math.PI * 2,
        depth: Math.random() * 0.4 + 0.05, // parallax factor
      }))
    }

    const draw = (t) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const scrollOffset = scrollYRef.current
      stars.forEach(s => {
        // Twinkle: sine wave on opacity
        const twinkle = Math.sin(t * 0.001 * s.speed * 80 + s.phase)
        const opacity = Math.max(0.05, Math.min(1, s.o + twinkle * 0.25))
        // Parallax: scroll offset scaled by depth
        const py = s.y - scrollOffset * s.depth
        // Size pulse: subtle radius variation
        const r = s.r + Math.sin(t * 0.0008 * s.speed * 60 + s.phase) * 0.15
        ctx.beginPath()
        ctx.arc(s.x, py, Math.max(0.1, r), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${opacity})`
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
          <div className="lp-nav-socials">
            {SOCIALS.map(s => (
              <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer" className="lp-nav-social" title={s.label}>
                {s.icon}
              </a>
            ))}
          </div>
          <button className="lp-btn-ghost" onClick={() => onSwitch('login')}>Sign in</button>
          <button className="lp-btn-primary" onClick={() => onSwitch('signup')}>Get started free</button>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-glass">
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
          <p className="lp-hero-note">No wallet required to start.</p>
        </div>

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
        <div className="lp-problem-title-glass">
          <div className="lp-section-eyebrow">The problem</div>
          <h2 className="lp-section-title">
            Most traders lose because they're<br />
            <span className="lp-accent-red">working with incomplete information.</span>
          </h2>
        </div>
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
        <div className="lp-pillars-title-glass">
          <div className="lp-section-eyebrow">The platform</div>
          <h2 className="lp-section-title">
            Three things working together.<br />
            <span className="lp-hero-accent">Nothing like it exists.</span>
          </h2>
        </div>
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
        <div className="lp-mock-title-glass">
          <div className="lp-section-eyebrow">The analyzer</div>
          <h2 className="lp-section-title">Paste a CA. Get the truth.</h2>
          <p className="lp-section-sub">
            20+ on-chain signals, AI narrative, and probability bands — in under 5 seconds.
          </p>
        </div>
        <div ref={mockRef} className={`lp-mock-card ${mockVisible ? 'lp-mock-visible' : ''}`}>
          {/* Header */}
          <div className="lp-mock-header">
            <div className="lp-mock-coin">
              <div className="lp-mock-coin-dot" />
              <span className="lp-mock-coin-name">ASTEROID</span>
              <span className="lp-mock-coin-sym">ASTEROID</span>
              <span className="lp-mock-coin-badge">Migrated</span>
            </div>
            <div className="lp-mock-mc">$5.15M MC</div>
          </div>

          {/* Circles row like real panel */}
          <div className="lp-mock-circles">
            <div className="lp-mock-circle-wrap">
              <svg width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="26" fill="none" stroke="#1a1a1a" strokeWidth="5"/>
                <circle cx="32" cy="32" r="26" fill="none" stroke="#4ade80" strokeWidth="5"
                  strokeDasharray={`${mockVisible ? 163.36*0.12 : 0} 163.36`}
                  strokeDashoffset="40.84" strokeLinecap="round"
                  style={{transition:'stroke-dasharray 1s ease 0.3s'}}/>
                <text x="32" y="30" textAnchor="middle" fill="#4ade80" fontSize="13" fontWeight="700" fontFamily="Inter">12</text>
                <text x="32" y="42" textAnchor="middle" fill="#555" fontSize="8" fontFamily="Inter">RUG %</text>
              </svg>
            </div>
            <div className="lp-mock-purity-wrap">
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="#1a1a1a" strokeWidth="7"/>
                <circle cx="50" cy="50" r="42" fill="none" stroke="#f59e0b" strokeWidth="7"
                  strokeDasharray={`${mockVisible ? 263.89*0.74 : 0} 263.89`}
                  strokeDashoffset="65.97" strokeLinecap="round"
                  style={{transition:'stroke-dasharray 1s ease 0.2s'}}/>
                <text x="50" y="44" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="700" fontFamily="Inter">74</text>
                <text x="50" y="56" textAnchor="middle" fill="#555" fontSize="9" fontFamily="Inter">/100</text>
                <text x="50" y="68" textAnchor="middle" fill="#aaa" fontSize="8" fontFamily="Inter">PURITY</text>
              </svg>
            </div>
            <div className="lp-mock-circle-wrap">
              <svg width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="26" fill="none" stroke="#1a1a1a" strokeWidth="5"/>
                <circle cx="32" cy="32" r="26" fill="none" stroke="#4ade80" strokeWidth="5"
                  strokeDasharray={`0 163.36`} strokeLinecap="round"/>
                <text x="32" y="30" textAnchor="middle" fill="#4ade80" fontSize="13" fontWeight="700" fontFamily="Inter">0</text>
                <text x="32" y="42" textAnchor="middle" fill="#555" fontSize="8" fontFamily="Inter">BUNDLE %</text>
              </svg>
            </div>
          </div>

          {/* Momentum + Stage */}
          <div className="lp-mock-meta">
            <div className="lp-mock-meta-col">
              <span className="lp-mock-meta-label">Momentum</span>
              <span className="lp-mock-meta-val" style={{color:'#a78bfa'}}>BUILDING</span>
            </div>
            <div className="lp-mock-meta-col">
              <span className="lp-mock-meta-label">Stage</span>
              <span className="lp-mock-meta-val" style={{color:'#e8e8e8'}}>Post Migration Pump</span>
            </div>
          </div>

          {/* Prob bars */}
          <div className="lp-mock-bars">
            <div className="lp-mock-bar-label">Probability of reaching</div>
            {[['$100K', 100, '#4ade80'], ['$250K', 100, '#4ade80'], ['$500K', 100, '#4ade80'], ['$1M', 95, '#4ade80'], ['$5M', 78, '#f59e0b'], ['$10M', 52, '#f97316']].map(([label, pct, col], i) => (
              <div key={label} className="lp-mock-bar-row">
                <span className="lp-mock-bar-target">{label}</span>
                <div className="lp-mock-bar-track">
                  <div className="lp-mock-bar-fill"
                    style={{ width: mockVisible ? `${pct}%` : '0%', background: col, transitionDelay: `${0.3 + i * 0.07}s` }}
                  />
                </div>
                <span className="lp-mock-bar-pct" style={{ color: col }}>{pct}%</span>
              </div>
            ))}
          </div>

          {/* Est peak */}
          <div className="lp-mock-peak">
            <span className="lp-mock-peak-label">Estimated Peak</span>
            <span className="lp-mock-peak-val">$8.50M</span>
            <span className="lp-mock-peak-range">$7.2M — $9.8M</span>
            <span className="lp-mock-peak-now">now: $5.15M</span>
          </div>

          {/* AI narrative */}
          <div className="lp-mock-narrative">
            <span className="lp-mock-narrative-label">Orbit Analysis</span>
            DOGE shows strong post-migration fundamentals with clean holder distribution and zero dev risk. High organic volume suggests sustained interest. Recommend monitoring for entry on dips toward $4.2M...
          </div>
        </div>
        <button className="lp-btn-outline lp-btn-lg lp-mock-cta" onClick={() => onSwitch('trial')}>
          Try it yourself — free, no account needed (yet) →
        </button>
      </Section>

      {/* Wallet section */}
      <Section className="lp-wallet-section">
        <div className="lp-wallet-inner">
          <div className="lp-wallet-text">
            <div className="lp-wallet-text-glass">
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
                <span className="lp-wallet-joke-sub">We built a <em>tool</em>, not a wallet drainer.</span>
              </p>
            </div>
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
        <div className="lp-final-glass">
          <div className="lp-final-eyebrow">
            <span className="lp-dot" /> Free to start
          </div>
          <h2 className="lp-final-title">
            One analysis.<br />
            <span className="lp-hero-accent">That's all it takes.</span>
          </h2>
          <p className="lp-final-sub">
            See exactly what you've been missing. No wallet required to start.
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
      <footer className="lp-footer-new">
        <div className="lp-footer-top">
          {/* Brand */}
          <div className="lp-footer-brand">
            <div className="lp-footer-logo-row">
              <img src={orbitPfp} className="lp-nav-pfp" alt="" />
              <span className="lp-nav-title">ORBIT</span>
              <span className="lp-nav-version">v0.2</span>
            </div>
            <p className="lp-footer-tagline">On-chain intelligence for Solana traders.</p>
            <div className="lp-footer-status">
              <span className="lp-status-dot" />
              All systems operational
            </div>
          </div>

          {/* Platform links */}
          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Platform</div>
            <button className="lp-footer-col-link" onClick={() => onSwitch('signup')}>Analyzer</button>
            <button className="lp-footer-col-link" onClick={() => onSwitch('signup')}>Forum</button>
            <button className="lp-footer-col-link" onClick={() => onSwitch('signup')}>Tracker</button>
            <button className="lp-footer-col-link" onClick={() => onSwitch('signup')}>Leaderboard</button>
          </div>

          {/* Account links */}
          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Account</div>
            <button className="lp-footer-col-link" onClick={() => onSwitch('login')}>Sign in</button>
            <button className="lp-footer-col-link" onClick={() => onSwitch('signup')}>Create account</button>
            <button className="lp-footer-col-link" onClick={() => onSwitch('trial')}>Try free</button>
          </div>

          {/* Community */}
          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Community</div>
            {SOCIALS.map(s => (
              <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer" className="lp-footer-col-link lp-footer-col-a">
                {s.label}
              </a>
            ))}
          </div>
        </div>

        <div className="lp-footer-bottom">
          <span className="lp-footer-copy">© {new Date().getFullYear()} Orbit · orbit-app.xyz</span>
          <span className="lp-footer-disclaimer">
            Orbit does not provide financial advice. All analysis is for informational purposes only.
          </span>
        </div>
      </footer>
    </div>
  )
}
