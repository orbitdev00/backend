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


const PLATFORM_CARDS = [
  {
    icon: '⬡',
    num: '01',
    title: 'Token Intelligence',
    scrollTo: 'section-analyzer',
    color: '#a78bfa',
    stats: ['Rug Probability', 'Bundle Detection', 'Fake Chart Score', 'Dev History'],
    body: 'Orbit pulls 20+ on-chain signals in real time and synthesizes everything into a plain-English verdict in under 5 seconds. Know before you buy.'
  },
  {
    icon: '◈',
    num: '02',
    title: 'Trader Community',
    scrollTo: 'section-community',
    color: '#60a5fa',
    stats: ['Forum Threads', 'Alpha Calls', 'Reputation System', 'Direct Messaging'],
    body: 'Threaded forum with voting, reputation scores, and a following feed. Your rep is built on what you actually say, not how loud you are.'
  },
  {
    icon: '◆',
    num: '03',
    title: 'On-Chain Leaderboard',
    scrollTo: 'section-leaderboard',
    color: '#4ade80',
    stats: ['Real DEX Data', 'Monthly PnL', 'Zero Self-Reporting', 'Wallet Verified'],
    body: 'Monthly rankings pulled from Raydium, Pump.fun, Jupiter, Orca, and Meteora. No screenshots. No lying. The chain does not forget.'
  },
  {
    icon: '◎',
    num: '04',
    title: 'Price Alerts',
    scrollTo: 'section-alerts',
    color: '#f59e0b',
    stats: ['15s Polling', 'Audio Alerts', 'Any Token', 'Cross-Device Sync'],
    body: 'Set a target MC, pick a direction, and get an audio alert the moment it triggers. Add as many tokens as you want.'
  },
]

function FeaturesSection() {
  const [hovered, setHovered] = useState(null)
  return (
    <section className="lp-section lp-features">
      <Reveal>
        <div className="lp-label">The platform</div>
        <h2 className="lp-h2">Four tools.<br />One unfair advantage.</h2>
        <div className="lp-platform-tool-labels">
          {PLATFORM_CARDS.map((c, i) => (
            <span key={i} className="lp-tool-label" style={{color: c.color, borderColor: c.color + '44'}}>{c.icon} {c.title}</span>
          ))}
        </div>
      </Reveal>
      <div className="lp-platform-grid">
        {PLATFORM_CARDS.map((c, i) => (
          <Reveal key={i} delay={i * 80}>
            <div
              className={`lp-platform-card ${hovered === i ? 'lp-platform-hovered' : ''}`}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => { const el = document.getElementById(c.scrollTo); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}) }}
              style={{'--card-color': c.color, cursor:'pointer'}}
            >
              <div className="lp-platform-card-top">
                <span className="lp-platform-icon" style={{color: c.color}}>{c.icon}</span>
                <span className="lp-platform-num">{c.num}</span>
              </div>
              <div className="lp-platform-title">{c.title}</div>
              <div className="lp-platform-stats">
                {c.stats.map(s => (
                  <span key={s} className="lp-platform-stat" style={{borderColor: c.color + '33', color: c.color}}>{s}</span>
                ))}
              </div>
              <div className="lp-platform-body">{c.body}</div>
              <div className="lp-platform-glow" style={{background: `radial-gradient(circle at 50% 100%, ${c.color}18 0%, transparent 70%)`}} />
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

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
            Everyone sees the chart.<br />
            <em>Not everyone sees the truth.</em>
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
          <h2 className="lp-h2">Most traders lose because<br />they are <span className="lp-purple lp-underline">guessing.</span></h2>
        </Reveal>
        <div className="lp-problem-row">
          {[
            ['Rugs', 'You find a coin. It looks clean. You ape in. It rugs.'],
            ['Late alpha', 'Real calls happen in private groups. You are always last.'],
            ['No context', 'Charts show price. Not who is holding, who sold, or who bundled.'],
            ['Coin flip', 'Every trade feels like a gamble because it basically is.'],
          ].map(([title, body], i) => (
            <Reveal key={i} delay={i * 60}>
              <div className="lp-prob-pill">
                <span className="lp-prob-pill-num">0{i+1}</span>
                <span className="lp-prob-pill-title">{title}</span>
                <span className="lp-prob-pill-body">{body}</span>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={160}>
          <div className="lp-problem-close">
            You don't have a discipline problem.{' '}
            <span className="lp-purple">You have a data problem.</span>
          </div>
        </Reveal>
      </section>

      {/* ── DATA STRIP ── */}
      <div className="lp-data-strip">
        <div className="lp-data-strip-inner">
          {['20+ on-chain signals','AI-generated narrative','Rug probability scoring','Bundle wallet detection','Dev sell history','Fresh wallet analysis','Sniper detection','Migration tracking','Liquidity depth','Peak MC estimate',
            '20+ on-chain signals','AI-generated narrative','Rug probability scoring','Bundle wallet detection','Dev sell history','Fresh wallet analysis','Sniper detection','Migration tracking','Liquidity depth','Peak MC estimate'
          ].map((t, i) => (
            <span key={i} className="lp-data-item">
              <span className="lp-data-dot" />
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* ── FEATURES ── */}
      <FeaturesSection />

      {/* ── MOCK ANALYZER ── */}
      <section className="lp-section lp-mock-section" id="section-analyzer">
        <Reveal>
          <div className="lp-label">Token Intelligence</div>
          <h2 className="lp-h2">This is what you get.<br />In under <span className="lp-purple">5 seconds.</span></h2>
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
                      fontSize={c.center ? 20 : 14} fontWeight="700" fontFamily="Outfit, sans-serif">{c.score}</text>
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
          <div className="lp-mock-summary">
            <div className="lp-mock-summary-item"><span className="lp-mock-summary-icon" style={{color:'#4ade80'}}>◆</span><span>Rug probability score from 0 to 100</span></div>
            <div className="lp-mock-summary-item"><span className="lp-mock-summary-icon" style={{color:'#a78bfa'}}>◆</span><span>Purity score measuring holder legitimacy</span></div>
            <div className="lp-mock-summary-item"><span className="lp-mock-summary-icon" style={{color:'#60a5fa'}}>◆</span><span>Bundle detection across all wallet clusters</span></div>
            <div className="lp-mock-summary-item"><span className="lp-mock-summary-icon" style={{color:'#f59e0b'}}>◆</span><span>AI narrative with entry recommendation</span></div>
            <div className="lp-mock-summary-item"><span className="lp-mock-summary-icon" style={{color:'#4ade80'}}>◆</span><span>Probability bands for $100K to $10M milestones</span></div>
            <div className="lp-mock-summary-item"><span className="lp-mock-summary-icon" style={{color:'#f87171'}}>◆</span><span>Dev sell history and fresh wallet concentration</span></div>
          </div>
        </Reveal>
      </section>

      {/* ── COMMUNITY DEMO ── */}
      <section className="lp-section lp-community-section">
        <div style={{borderTop:'1px solid var(--line)', paddingTop:80}}>
          <Reveal>
            <div className="lp-label">Trader Community</div>
            <h2 className="lp-h2">No influencers.<br />No paid promotions.<br /><em>Just traders.</em></h2>
            <p className="lp-community-body">
              Post your analysis. Share your calls. Build a reputation based on what you actually say — not how many followers you have. The forum is merit-based. The chain keeps score.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <p className="lp-community-note">
              Friendly reminder: the average X call lasts 9 minutes before the dev rugs and the account goes private. Orbit analysis lasts forever. Or until you close the tab.
            </p>
          </Reveal>
          <Reveal delay={100}>
            <div className="lp-community-demo">
              <div className="lp-forum-header">
                <span className="lp-forum-category">Announcements</span>
                <span className="lp-forum-category">Analysis</span>
                <span className="lp-forum-category lp-forum-active">General</span>
                <span className="lp-forum-category">Education</span>
              </div>
              {[
                { user:'sidewalk_sam', rep:12, badge:'Member', time:'4m ago', title:'I accidentally full ported into a coin and then shlaro sold his bundle and now I am sleeping on the sidewalk', replies:47, votes:203, downvotes:0, tag:'General' },
                { user:'newdegen99', rep:1, badge:'Member', time:'12m ago', title:'just started trading, when will I get rich', replies:892, votes:0, downvotes:891, tag:'General' },
                { user:'definitely_not_sus', rep:203, badge:'Member', time:'1h ago', title:'How to Rugpull Coins: A Comprehensive In-Depth Guide for Beginners and Advanced Traders Alike', replies:1, votes:4, downvotes:0, tag:'Education' },
              ].map((t, i) => (
                <div key={i} className="lp-forum-thread">
                  <div className="lp-forum-thread-left">
                    <div className="lp-forum-avatar">{t.user[0].toUpperCase()}</div>
                  </div>
                  <div className="lp-forum-thread-body">
                    <div className="lp-forum-thread-meta">
                      <span className="lp-forum-user">{t.user}</span>
                      <span className="lp-forum-rep">REP {t.rep}</span>
                      <span className="lp-forum-badge">{t.badge}</span>
                      <span className="lp-forum-time">{t.time}</span>
                      <span className="lp-forum-tag">{t.tag}</span>
                    </div>
                    <div className="lp-forum-thread-title">{t.title}</div>
                    <div className="lp-forum-thread-foot">{t.replies} replies</div>
                  </div>
                  <div className="lp-forum-vote-col">
                    {t.votes > 0 && <div className="lp-forum-vote-up-block"><span>▲</span><span>{t.votes}</span></div>}
                    {t.downvotes > 0 && <div className="lp-forum-vote-dn-block"><span>▼</span><span>{t.downvotes}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── ALERTS DEMO ── */}
      <section className="lp-section lp-alerts-section" id="section-alerts">
        <div style={{borderTop:'1px solid var(--line)', paddingTop:80}}>
          <Reveal>
            <div className="lp-label">Price Alerts</div>
            <h2 className="lp-h2">Set it.<br /><em>Get notified. Act first.</em></h2>
          </Reveal>
          <Reveal delay={100}>
            <div className="lp-alerts-demo">
              <div className="lp-alerts-header">
                <span className="lp-alerts-title">Watchlist</span>
                <span className="lp-alerts-count">4 tokens</span>
              </div>
              {[
                { name:'DOGE', ca:'7xK2...mF9p', target:'$8M', dir:'above', mc:'$5.15M', status:'watching', pct:64 },
                { name:'PEPE2', ca:'9mN4...kL2w', target:'$500K', dir:'above', mc:'$487K', status:'close', pct:97 },
                { name:'RUGME', ca:'3pQ8...xR7t', target:'$100K', dir:'below', mc:'$234K', status:'watching', pct:43 },
                { name:'MOON', ca:'2kF1...vB9s', target:'$2M', dir:'above', mc:'$2.1M', status:'triggered', pct:100 },
              ].map((a, i) => (
                <div key={i} className={`lp-alert-row ${a.status === 'triggered' ? 'lp-alert-triggered' : ''}`}>
                  <div className="lp-alert-coin">
                    <span className="lp-alert-name">{a.name}</span>
                    <span className="lp-alert-ca">{a.ca}</span>
                  </div>
                  <div className="lp-alert-target">
                    <span className="lp-alert-target-label">Target</span>
                    <span className="lp-alert-target-val">{a.target} {a.dir}</span>
                  </div>
                  <div className="lp-alert-mc">
                    <span className="lp-alert-mc-label">Current MC</span>
                    <span className="lp-alert-mc-val">{a.mc}</span>
                  </div>
                  <div className="lp-alert-bar-wrap">
                    <div className="lp-alert-bar-track">
                      <div className="lp-alert-bar-fill" style={{
                        width:`${a.pct}%`,
                        background: a.status==='triggered' ? '#4ade80' : a.status==='close' ? '#f59e0b' : '#a78bfa'
                      }} />
                    </div>
                    <span className="lp-alert-pct">{a.pct}%</span>
                  </div>
                  <div className={`lp-alert-status lp-alert-${a.status}`}>
                    {a.status === 'triggered' ? '🔔 Triggered' : a.status === 'close' ? 'Close' : 'Watching'}
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── WALLET ── */}
      <section className="lp-section lp-wallet" id="section-leaderboard">
        <div className="lp-wallet-grid">
          <Reveal>
            <div className="lp-label">On-Chain Leaderboard</div>
            <h2 className="lp-h2 lp-h2-sm"><em>Your PnL is already on-chain.</em><br />Might as well show it off.</h2>
            <p className="lp-wallet-body">
              Add your wallet and you are on the board. Win big and everyone knows.
              Lose big and... well, everyone still knows. Orbit tracks both sides — Highest PnL
              and Lowest PnL, verified on-chain every month.
            </p>
            <p className="lp-wallet-quip">
              Read-only. No connection request, no signing, no approvals.<br />
              <em>Either way, at least you showed up.</em>
            </p>
            <div className="lp-wallet-compete">
              <span className="lp-wallet-compete-label">Top trader this month</span>
              <span className="lp-wallet-compete-val">+38.7 SOL</span>
              <span className="lp-wallet-compete-q">Top spot is empty. Someone has to take it.</span>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="lp-wallet-card">
              <div className="lp-wallet-card-label">Monthly PnL · April 2026</div>
              <div className="lp-wallet-card-val">+14.2 SOL</div>
              <div className="lp-wallet-card-sub">Verified on-chain · Rank #3</div>
              <div className="lp-wallet-card-addr">7xK2...mF9p</div>
              <div className="lp-wallet-card-bar">
                <div className="lp-wallet-card-fill" />
              </div>
              <div className="lp-wallet-card-ranks">
                <div className="lp-rank-section-label">Highest PnL</div>
                {[['#1','orbitking','38.7','#4ade80'],['#2','sol_runner','22.1','#4ade80'],['#3','7xK2...','14.2','#4ade80']].map(([rank, name, pnl, col]) => (
                  <div key={rank} className="lp-rank-row">
                    <span className="lp-rank-pos">{rank}</span>
                    <span className="lp-rank-name">{name}</span>
                    <span className="lp-rank-pnl" style={{color:col}}>+{pnl} SOL</span>
                  </div>
                ))}
                <div className="lp-rank-section-label lp-rank-section-label-red">Lowest PnL</div>
                {[['#1','rekt_lord','-18.4','#f87171'],['#2','paper_hands','-12.1','#f87171'],['#3','fomo_bro','-9.3','#f87171']].map(([rank, name, pnl, col]) => (
                  <div key={rank+name} className="lp-rank-row">
                    <span className="lp-rank-pos">{rank}</span>
                    <span className="lp-rank-name">{name}</span>
                    <span className="lp-rank-pnl" style={{color:col}}>{pnl} SOL</span>
                  </div>
                ))}
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
          <div className="lp-final-btns">
            <button className="lp-cta-primary lp-cta-xl" onClick={() => onSwitch('signup')}>Create free account</button>
            <button className="lp-cta-ghost" onClick={() => onSwitch('trial')}>Try without account</button>
          </div>
        </Reveal>
      </section>

      {/* ── CUPSEY JOKE ── */}
      <div className="lp-joke-strip lp-joke-strip-center">
        <span className="lp-joke-text">
          We genuinely hope Cupsey does not buy our coin.
          <span className="lp-joke-sub">You know what he does to charts. We all know.</span>
        </span>
      </div>

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
