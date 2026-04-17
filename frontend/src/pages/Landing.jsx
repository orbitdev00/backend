import { useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import orbitPfp from '../orbitPfp.js'
import './Landing.css'

const SOCIALS = [
  { label: 'X', url: 'https://x.com/OrbitDevs00' },
  { label: 'Discord', url: 'https://discord.gg/792YWsb4sA' },
  { label: 'GitHub', url: 'https://github.com/orbitdev00' },
]

const STATS = [
  { value: '< 5s', label: 'Per analysis' },
  { value: '20+', label: 'On-chain signals' },
  { value: '100%', label: 'Solana native' },
]

const FEATURES = [
  { num: '01', title: 'Token Intelligence', body: 'Rug probability, bundle detection, fake volume scoring, dev history, fresh wallet concentration — pulled live from the chain in under 5 seconds.' },
  { num: '02', title: 'Trader Community', body: 'Forum built for real degens. Share analysis, discuss tokens, build reputation based on accuracy — not just volume.' },
  { num: '03', title: 'On-Chain Leaderboard', body: 'Monthly PnL rankings pulled directly from DEX swap history. No self-reporting. No lying about entries. Real numbers.' },
  { num: '04', title: 'Price Alerts', body: 'Watch any token and get notified the moment it hits your target market cap. Watchlist syncs across devices.' },
]

function useInView(threshold = 0.15) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true) }, { threshold })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return [ref, inView]
}

function Reveal({ children, delay = 0, className = '' }) {
  const [ref, inView] = useInView()
  return (
    <div ref={ref} className={`lp-reveal ${inView ? 'lp-revealed' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

export default function Landing({ onSwitch }) {
  const canvasRef = useRef(null)
  const scrollRef = useRef(0)
  const [visible, setVisible] = useState(false)
  const [mockVisible, setMockVisible] = useState(false)
  const mockRef = useRef(null)
  const mockInView = useRef(false)

  useEffect(() => { setTimeout(() => setVisible(true), 80) }, [])

  useEffect(() => {
    const onScroll = () => { scrollRef.current = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Starfield
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf, stars = []

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight + 400
      stars = Array.from({ length: 320 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 0.2,
        o: Math.random() * 0.5 + 0.1,
        speed: Math.random() * 0.015 + 0.003,
        phase: Math.random() * Math.PI * 2,
        depth: Math.random() * 0.35 + 0.05,
      }))
    }

    const draw = (t) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const scroll = scrollRef.current
      stars.forEach(s => {
        const o = Math.max(0.02, Math.min(0.9, s.o + Math.sin(t * 0.001 * s.speed * 60 + s.phase) * 0.25))
        const r = Math.max(0.1, s.r + Math.sin(t * 0.0008 * s.speed * 60 + s.phase) * 0.2)
        const py = s.y - scroll * s.depth
        ctx.beginPath()
        ctx.arc(s.x, py, r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${o})`
        ctx.fill()
      })
      raf = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  // Mock bar reveal
  useEffect(() => {
    if (!mockRef.current) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !mockInView.current) {
        mockInView.current = true
        setTimeout(() => setMockVisible(true), 100)
      }
    }, { threshold: 0.3 })
    obs.observe(mockRef.current)
    return () => obs.disconnect()
  }, [])

  return (
    <div className={`lp ${visible ? 'lp-in' : ''}`}>
      <canvas ref={canvasRef} className="lp-canvas" />

      {/* ── NAV ── */}
      <nav className="lp-nav">
        <div className="lp-nav-brand">
          <img src={orbitPfp} className="lp-nav-pfp" alt="" />
          <span className="lp-nav-name">ORBIT</span>
          <span className="lp-nav-ver">v0.2</span>
        </div>
        <div className="lp-nav-right">
          <div className="lp-nav-socials">
            {SOCIALS.map(s => (
              <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer" className="lp-nav-social">{s.label}</a>
            ))}
          </div>
          <div className="lp-nav-divider" />
          <button className="lp-nav-signin" onClick={() => onSwitch('login')}>Sign in</button>
          <button className="lp-nav-cta" onClick={() => onSwitch('signup')}>Get started</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-glow" />
        <Reveal className="lp-hero-tag-wrap">
          <div className="lp-hero-tag"><span className="lp-pulse" />On-chain intelligence · Solana</div>
        </Reveal>
        <Reveal delay={100}>
          <h1 className="lp-hero-h1">
            The edge isn't luck.<br />
            <em>It's information.</em>
          </h1>
        </Reveal>
        <Reveal delay={220}>
          <p className="lp-hero-sub">
            Orbit analyzes any Pump.fun token in under 5 seconds. Rug probability, holder distribution,
            fake chart scoring, AI narrative. Then connects you with the traders who are already using it.
          </p>
        </Reveal>
        <Reveal delay={340} className="lp-hero-cta-wrap">
          <button className="lp-cta-primary" onClick={() => onSwitch('signup')}>Create free account</button>
          <button className="lp-cta-ghost" onClick={() => onSwitch('trial')}>Try one analysis free →</button>
        </Reveal>
        <Reveal delay={440}>
          <div className="lp-hero-stats">
            {STATS.map((s, i) => (
              <div key={i} className="lp-stat">
                <span className="lp-stat-n">{s.value}</span>
                <span className="lp-stat-l">{s.label}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── TICKER ── */}
      <div className="lp-ticker-outer">
        <div className="lp-ticker-inner">
          {['RUG DETECTION','HOLDER ANALYSIS','BUNDLE SCORING','FAKE CHART','DEV HISTORY','MIGRATION TRACKING','FRESH WALLETS','SNIPER DETECTION','LIQUIDITY DEPTH','MOMENTUM','PURITY SCORE','PEAK MC ESTIMATE',
            'RUG DETECTION','HOLDER ANALYSIS','BUNDLE SCORING','FAKE CHART','DEV HISTORY','MIGRATION TRACKING','FRESH WALLETS','SNIPER DETECTION','LIQUIDITY DEPTH','MOMENTUM','PURITY SCORE','PEAK MC ESTIMATE'
          ].map((t, i) => <span key={i} className="lp-tick">{t}<span className="lp-tick-sep">◆</span></span>)}
        </div>
      </div>

      {/* ── PROBLEM ── */}
      <section className="lp-section lp-problem">
        <Reveal>
          <div className="lp-label">The problem</div>
          <h2 className="lp-h2">Most traders lose<br />because they're guessing.</h2>
        </Reveal>
        <div className="lp-problem-grid">
          {[
            ['Rugs in seconds', 'You find a coin. It looks clean. You ape in. It rugs.'],
            ['Late to the alpha', 'Real calls happen in private groups. You're always last.'],
            ['No on-chain context', 'Charts tell you price. Not who's holding, who sold, or who bundled.'],
            ['Flying blind', 'Every trade feels like a coin flip because it basically is.'],
          ].map(([title, body], i) => (
            <Reveal key={i} delay={i * 80}>
              <div className="lp-prob-card">
                <span className="lp-prob-num">0{i + 1}</span>
                <div className="lp-prob-title">{title}</div>
                <div className="lp-prob-body">{body}</div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={200}>
          <div className="lp-problem-close">
            You don't have a discipline problem.<br />
            <span className="lp-purple">You have a data problem.</span>
          </div>
        </Reveal>
      </section>

      {/* ── FEATURES ── */}
      <section className="lp-section lp-features">
        <Reveal>
          <div className="lp-label">The platform</div>
          <h2 className="lp-h2">Four tools.<br />One unfair advantage.</h2>
        </Reveal>
        <div className="lp-feat-list">
          {FEATURES.map((f, i) => (
            <Reveal key={i} delay={i * 60}>
              <div className="lp-feat-row">
                <span className="lp-feat-num">{f.num}</span>
                <div className="lp-feat-content">
                  <div className="lp-feat-title">{f.title}</div>
                  <div className="lp-feat-body">{f.body}</div>
                </div>
                <div className="lp-feat-arrow">→</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── MOCK ANALYZER ── */}
      <section className="lp-section lp-mock-section">
        <Reveal>
          <div className="lp-label">Live demo</div>
          <h2 className="lp-h2">This is what you get.<br />In under 5 seconds.</h2>
        </Reveal>
        <div ref={mockRef} className={`lp-mock ${mockVisible ? 'lp-mock-go' : ''}`}>
          <div className="lp-mock-top">
            <div className="lp-mock-coin">
              <span className="lp-mock-dot" />
              <span className="lp-mock-name">DOGE</span>
              <span className="lp-mock-sym">DOGE</span>
              <span className="lp-mock-badge">Migrated</span>
            </div>
            <span className="lp-mock-mc">$5.15M</span>
          </div>

          <div className="lp-mock-circles">
            {[
              { score: 12, max: 100, label: 'RUG %', col: '#4ade80', good: true },
              { score: 74, max: 100, label: 'PURITY', col: '#a78bfa', center: true },
              { score: 0, max: 100, label: 'BUNDLE %', col: '#4ade80', good: true },
            ].map((c, i) => {
              const size = c.center ? 96 : 70
              const cx = size / 2, r = size / 2 - 6
              const circ = 2 * Math.PI * r
              const pct = mockVisible ? c.score / 100 : 0
              return (
                <div key={i} className="lp-mock-circle-item">
                  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <circle cx={cx} cy={cx} r={r} fill="none" stroke="#1a1a1a" strokeWidth={c.center ? 6 : 5} />
                    <circle cx={cx} cy={cx} r={r} fill="none" stroke={c.col} strokeWidth={c.center ? 6 : 5}
                      strokeDasharray={`${circ * pct} ${circ}`}
                      strokeDashoffset={circ * 0.25}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)' }} />
                    <text x={cx} y={cx - 3} textAnchor="middle" fill={c.col}
                      fontSize={c.center ? 20 : 14} fontWeight="700" fontFamily="Syne, sans-serif">{c.score}</text>
                    <text x={cx} y={cx + (c.center ? 14 : 11)} textAnchor="middle"
                      fill="#555" fontSize={c.center ? 8 : 7} fontFamily="JetBrains Mono, monospace">{c.label}</text>
                  </svg>
                </div>
              )
            })}
          </div>

          <div className="lp-mock-meta">
            <span className="lp-mock-meta-item"><span className="lp-mock-meta-l">Momentum</span><span className="lp-purple" style={{fontWeight:600}}>BUILDING</span></span>
            <span className="lp-mock-meta-sep" />
            <span className="lp-mock-meta-item"><span className="lp-mock-meta-l">Stage</span><span>Post Migration Pump</span></span>
            <span className="lp-mock-meta-sep" />
            <span className="lp-mock-meta-item"><span className="lp-mock-meta-l">Est. Peak</span><span style={{color:'#4ade80',fontWeight:600}}>$8.5M</span></span>
          </div>

          <div className="lp-mock-bars">
            <div className="lp-mock-bars-label">Probability of reaching</div>
            {[['$100K',100,'#4ade80'],['$250K',100,'#4ade80'],['$500K',100,'#4ade80'],['$1M',95,'#4ade80'],['$5M',78,'#f59e0b'],['$10M',52,'#f97316']].map(([lbl, pct, col], i) => (
              <div key={lbl} className="lp-mock-bar-row">
                <span className="lp-mock-bar-lbl">{lbl}</span>
                <div className="lp-mock-bar-track">
                  <div className="lp-mock-bar-fill" style={{
                    width: mockVisible ? `${pct}%` : '0%',
                    background: col,
                    transitionDelay: `${0.4 + i * 0.07}s`
                  }} />
                </div>
                <span className="lp-mock-bar-pct" style={{ color: col }}>{pct}%</span>
              </div>
            ))}
          </div>

          <div className="lp-mock-ai">
            <span className="lp-mock-ai-label">Orbit Analysis</span>
            DOGE shows strong post-migration fundamentals with clean holder distribution and zero dev risk.
            High organic volume suggests sustained interest. Low rug probability (12) reflects clean dev history
            and zero manipulation signals. Recommend monitoring for entry on dips toward $4.2M...
          </div>
        </div>

        <Reveal delay={100}>
          <button className="lp-cta-ghost" style={{marginTop:32}} onClick={() => onSwitch('trial')}>
            Try it yourself — no account needed (yet) →
          </button>
        </Reveal>
      </section>

      {/* ── WALLET ── */}
      <section className="lp-section lp-wallet">
        <div className="lp-wallet-grid">
          <Reveal>
            <div className="lp-label">Your wallet</div>
            <h2 className="lp-h2">Optional.<br />Seriously.</h2>
            <p className="lp-wallet-body">
              Add your public Solana wallet if you want your monthly PnL on the leaderboard.
              Read-only. No connection request, no signing, no approvals.
            </p>
            <p className="lp-wallet-quip">
              Unlike other sites, we have zero interest in your money.<br />
              We built a <em>tool</em>, not a wallet drainer.
            </p>
          </Reveal>
          <Reveal delay={150}>
            <div className="lp-wallet-card">
              <div className="lp-wallet-card-label">Monthly PnL · April 2026</div>
              <div className="lp-wallet-card-val">+14.2 SOL</div>
              <div className="lp-wallet-card-sub">Verified on-chain</div>
              <div className="lp-wallet-card-addr">7xK2...mF9p</div>
              <div className="lp-wallet-card-bar">
                <div className="lp-wallet-card-fill" />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="lp-section lp-final">
        <div className="lp-final-glow" />
        <Reveal>
          <div className="lp-label">Start now</div>
          <h2 className="lp-final-h2">
            One analysis.<br />
            <em>That's all it takes.</em>
          </h2>
          <p className="lp-final-sub">No wallet required to start.</p>
          <div className="lp-final-btns">
            <button className="lp-cta-primary lp-cta-xl" onClick={() => onSwitch('signup')}>Create free account</button>
            <button className="lp-cta-ghost" onClick={() => onSwitch('trial')}>Try without account</button>
          </div>
        </Reveal>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-footer-top">
          <div className="lp-footer-brand">
            <div className="lp-footer-logo">
              <img src={orbitPfp} className="lp-nav-pfp" alt="" />
              <span className="lp-nav-name">ORBIT</span>
              <span className="lp-nav-ver">v0.2</span>
            </div>
            <p className="lp-footer-tag">On-chain intelligence for Solana traders.</p>
            <div className="lp-footer-status"><span className="lp-status-dot" />All systems operational</div>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-col-head">Platform</div>
            {['Analyzer','Forum','Tracker','Leaderboard'].map(l => (
              <button key={l} className="lp-footer-link" onClick={() => onSwitch('signup')}>{l}</button>
            ))}
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-col-head">Account</div>
            <button className="lp-footer-link" onClick={() => onSwitch('login')}>Sign in</button>
            <button className="lp-footer-link" onClick={() => onSwitch('signup')}>Create account</button>
            <button className="lp-footer-link" onClick={() => onSwitch('trial')}>Try free</button>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-col-head">Community</div>
            {SOCIALS.map(s => (
              <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer" className="lp-footer-link">{s.label}</a>
            ))}
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span className="lp-footer-copy">© {new Date().getFullYear()} Orbit · orbit-app.xyz</span>
          <span className="lp-footer-disc">Orbit does not provide financial advice. All analysis is for informational purposes only.</span>
        </div>
      </footer>
    </div>
  )
}
