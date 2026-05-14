import { useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import orbitPfp from '../orbitPfp.js'
import './Landing.css'

const SOCIALS = [
  { label: 'X', url: 'https://x.com/OrbitDevs00' },
  { label: 'Discord', url: 'https://discord.gg/uGGCJD2gF' },
  { label: 'GitHub', url: 'https://github.com/orbitdev00' },
]

const STATS = [
  { value: '< 5s', label: 'Per analysis' },
  { value: '20+', label: 'On-chain signals' },
  { value: 'SOL + ETH', label: 'Multi-chain' },
]

const FEATURES = [
  { num: '01', title: 'Token Intelligence', body: 'Rug probability, bundle detection, fake volume scoring, dev history, fresh wallet concentration — pulled live from the chain in seconds.' },
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
    body: 'Orbit pulls 20+ on-chain signals in real time and synthesizes everything into a plain-English verdict in seconds. Know before you buy.'
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
    body: 'Set a target MC, pick a direction, and get an audio alert the moment it triggers. Free accounts get 1 alert. Degen and Omega unlock unlimited.'
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
  const starRafRef = useRef(null)
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

  // Starfield — fixed canvas (covers global StarField), viewport-sized with wrap parallax
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let stars = []

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
      stars = Array.from({ length: 900 }, () => {
        const depth = Math.random() * 0.75 + 0.05
        const t = (depth - 0.05) / 0.75
        return {
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: 0.15 + Math.random() * 0.45 + t * 1.7,
          o: 0.06 + Math.random() * 0.18 + t * 0.58,
          speed:  Math.random() * 0.015 + 0.003,
          phase:  Math.random() * Math.PI * 2,
          phase2: Math.random() * Math.PI * 2,
          depth,
        }
      })
    }

    const draw = (ts) => {
      const W = canvas.width, H = canvas.height
      ctx.clearRect(0, 0, W, H)
      const scroll = scrollRef.current
      for (const s of stars) {
        const w1 = Math.sin(ts * 0.001  * s.speed * 60 + s.phase)
        const w2 = Math.sin(ts * 0.0017 * s.speed * 45 + s.phase2) * 0.5
        const o  = Math.max(0.02, Math.min(0.95, s.o + (w1 + w2) * 0.32))
        const r  = Math.max(0.1, s.r + w1 * 0.3)
        // Parallax: foreground stars drift upward as you scroll, wrap around
        const drawY = ((s.y - scroll * s.depth * 0.2) % H + H) % H
        if (r > 1.5 && s.depth > 0.52) {
          const grd = ctx.createRadialGradient(s.x, drawY, 0, s.x, drawY, r * 4.5)
          grd.addColorStop(0, `rgba(210,190,255,${o * 0.28})`)
          grd.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.beginPath(); ctx.arc(s.x, drawY, r * 4.5, 0, Math.PI * 2)
          ctx.fillStyle = grd; ctx.fill()
        }
        ctx.beginPath(); ctx.arc(s.x, drawY, r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${o})`; ctx.fill()
      }
      starRafRef.current = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    starRafRef.current = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(starRafRef.current); window.removeEventListener('resize', resize) }
  }, [])

  const bhRef = useRef({ active: false, raf: null })

  const flyTo = (e, dest) => {
    if (bhRef.current.active) return
    cancelAnimationFrame(starRafRef.current)
    const scrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    document.body.style.top = `-${scrollY}px`
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    document.body.dataset.scrollY = scrollY
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    runBlackHole(cx, cy, dest)
  }

  const runBlackHole = (cx, cy, dest) => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (bhRef.current.active) return
    bhRef.current.active = true
    canvas.dataset.bhActive = '1'

    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height

    const ease3  = t => 1 - Math.pow(1 - t, 3)
    const easeIO = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2
    const easeIn = t => t * t

    // Snapshot viewport stars for the absorption animation
    const starSnap = Array.from({ length: 320 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      o: Math.random() * 0.5 + 0.15,
    }))

    // Page elements to absorb
    const pageEls = [...document.querySelectorAll(
      '.lp-nav, .lp-hero, .lp-ticker-outer, .lp-section, .lp-joke-strip, .lp-data-strip, .lp-wallet, .lp-final, .lp-footer'
    )].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 })
    pageEls.forEach(el => {
      const r = el.getBoundingClientRect()
      el._dist = Math.sqrt((r.left+r.width/2-cx)**2+(r.top+r.height/2-cy)**2)
      el.style.transformOrigin = `${cx-r.left}px ${cy-r.top}px`
      el.style.willChange = 'transform,opacity'
      el.style.transition = 'none'
    })
    const maxDist = Math.max(...pageEls.map(e=>e._dist), 1)
    const maxR = Math.sqrt(W*W+H*H)

    const NPARTS = 300
    const parts = Array.from({ length: NPARTS }, (_, i) => ({
      angle: (i/NPARTS)*Math.PI*2 + Math.random()*0.1,
      rMult: 1.05 + Math.random()*0.85,
      speed: (0.007+Math.random()*0.011)*(i%2?1:-1),
      sz: 0.5+Math.random()*1.7,
      bright: 0.4+Math.random()*0.6,
      lane: Math.random(),
    }))

    const drawDisk = (holeR, alpha) => {
      if (holeR < 1 || alpha <= 0) return
      const diskY = holeR * 0.18
      const glow = ctx.createRadialGradient(cx,cy,holeR*0.4,cx,cy,holeR*3.5)
      glow.addColorStop(0, `rgba(120,80,220,${0.22*alpha})`)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(cx,cy,holeR*3.5,0,Math.PI*2); ctx.fill()
      ctx.save(); ctx.translate(cx,cy)
      for (const p of parts) {
        p.angle += p.speed
        const r=holeR*p.rMult
        const px=Math.cos(p.angle)*r, py=Math.sin(p.angle)*r*(diskY/holeR)
        if (py>0||Math.sqrt(px*px+py*py)<holeR) continue
        const a=p.bright*alpha*(1-p.lane*0.4)
        ctx.beginPath(); ctx.arc(px,py,p.sz,0,Math.PI*2)
        ctx.fillStyle=p.lane<0.4?`rgba(180,140,255,${a})`:`rgba(255,255,255,${a*0.7})`
        ctx.fill()
      }
      ctx.restore()
      for (let i=0;i<3;i++) {
        const rr=holeR*(1.06+i*0.06), a=(0.55-i*0.14)*alpha
        const g=ctx.createRadialGradient(cx,cy,rr*0.88,cx,cy,rr*1.12)
        g.addColorStop(0,'rgba(200,160,255,0)')
        g.addColorStop(0.5,`rgba(200,160,255,${a*0.5})`)
        g.addColorStop(0.65,`rgba(255,255,255,${a})`)
        g.addColorStop(1,'rgba(200,160,255,0)')
        ctx.beginPath(); ctx.arc(cx,cy,rr,0,Math.PI*2)
        ctx.strokeStyle=g; ctx.lineWidth=holeR*0.055; ctx.stroke()
      }
      ctx.beginPath(); ctx.arc(cx,cy,holeR,0,Math.PI*2); ctx.fillStyle='#000'; ctx.fill()
      ctx.save(); ctx.translate(cx,cy)
      for (const p of parts) {
        const r=holeR*p.rMult
        const px=Math.cos(p.angle)*r, py=Math.sin(p.angle)*r*(diskY/holeR)
        if(py<=0||Math.sqrt(px*px+py*py)<holeR) continue
        const a=p.bright*alpha*1.3*(1-p.lane*0.3)
        ctx.beginPath(); ctx.arc(px,py,p.sz*1.1,0,Math.PI*2)
        ctx.fillStyle=p.lane<0.4?`rgba(180,140,255,${a})`:`rgba(255,255,255,${a*0.85})`
        ctx.fill()
      }
      ctx.restore()
      const ph=ctx.createRadialGradient(cx,cy,holeR*0.96,cx,cy,holeR*1.05)
      ph.addColorStop(0,'rgba(200,160,255,0)')
      ph.addColorStop(0.5,`rgba(220,180,255,${0.6*alpha})`)
      ph.addColorStop(1,'rgba(200,160,255,0)')
      ctx.beginPath(); ctx.arc(cx,cy,holeR,0,Math.PI*2)
      ctx.strokeStyle=ph; ctx.lineWidth=holeR*0.04; ctx.stroke()
      ctx.beginPath(); ctx.arc(cx,cy,holeR*0.97,0,Math.PI*2)
      ctx.fillStyle='#000'; ctx.fill()
    }

    const PHASES = { spawn:933, absorb:1467, implode:667 }
    const state = { phase:'spawn', t0:performance.now(), called:false }

    const frame = ts => {
      const dur = PHASES[state.phase]
      const t = Math.min((ts-state.t0)/dur, 1)
      // Fill black each frame — hides the page background behind the canvas
      ctx.fillStyle = '#000'
      ctx.fillRect(0,0,W,H)

      if (state.phase === 'spawn') {
        drawDisk(ease3(t)*65, ease3(t))
        // Draw stars during spawn
        for (const s of starSnap) {
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2)
          ctx.fillStyle = `rgba(255,255,255,${s.o})`; ctx.fill()
        }
        if (t>=1) { state.phase='absorb'; state.t0=ts }

      } else if (state.phase === 'absorb') {
        const et = easeIO(t)
        drawDisk(65, 1)
        // Stars pulled toward black hole
        for (const s of starSnap) {
          const dist = Math.sqrt((s.x-cx)**2+(s.y-cy)**2)
          const lT = Math.min(1, et*(0.3+(1-dist/maxR)*0.8))
          const ease = easeIO(lT)
          const sx2=cx+(s.x-cx)*(1-ease), sy2=cy+(s.y-cy)*(1-ease)
          const sc=Math.max(0,1-ease)
          if(sc<0.01) continue
          ctx.beginPath(); ctx.arc(sx2,sy2,s.r*sc,0,Math.PI*2)
          ctx.fillStyle=`rgba(255,255,255,${s.o*sc})`; ctx.fill()
        }
        // Page elements scale toward black hole
        pageEls.forEach(el => {
          const normD=el._dist/maxDist
          // All elements must reach sc=0 by t=1, closer ones get there sooner
          const delay = normD * 0.3  // far elements start later
          const localT = Math.min(1, Math.max(0, (et - delay) / (1 - delay)))
          const ease = easeIO(localT)
          const sc = Math.max(0, 1 - ease)
          el.style.transform=`scale(${sc})`
          el.style.opacity=t > 0.66 ? `${Math.max(0, 1 - (t - 0.66) / 0.34)}` : '1'
        })
        if (t>=1) {
          pageEls.forEach(el=>{el.style.opacity='0';el.style.transform='scale(0)'})
          state.phase='implode'; state.t0=ts
        }

      } else if (state.phase === 'implode') {
        const et = easeIn(t)
        const holeR = Math.max(0,65*(1-et))
        if(holeR>1) drawDisk(holeR,1-et*0.5)
        ctx.fillStyle=`rgba(0,0,0,${et})`
        ctx.fillRect(0,0,W,H)
        if (t>=1 && !state.called) {
          state.called=true
          pageEls.forEach(el=>{
            el.style.transform=''
            el.style.opacity=''
            el.style.willChange=''
          })
          bhRef.current.active=false
          delete canvas.dataset.bhActive
          document.body.style.overflow = ''
          document.body.style.position = ''
          document.body.style.width = ''
          document.body.style.top = ''
          window.scrollTo(0, parseInt(document.body.dataset.scrollY || '0'))
          const style=document.createElement('style')
          style.id='orbit-fadein'
          style.textContent=`body>*{animation:orbitFI 0.55s ease forwards}@keyframes orbitFI{from{opacity:0}to{opacity:1}}`
          document.head.appendChild(style)
          setTimeout(()=>{const s=document.getElementById('orbit-fadein');if(s)s.remove()},700)
          if(dest) onSwitch(dest)
          return
        }
      }
      bhRef.current.raf = requestAnimationFrame(frame)
    }
    bhRef.current.raf = requestAnimationFrame(frame)
  }

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
          <span className="lp-nav-ver">v0.8</span>
        </div>
        <div className="lp-nav-right">
          <div className="lp-nav-socials">
            {SOCIALS.map(s => (
              <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer" className="lp-nav-social">{s.label}</a>
            ))}
          </div>
          <div className="lp-nav-divider" />
          <button className="lp-nav-signin lp-nav-signin-fade" onClick={() => { document.querySelector('.lp').style.transition='opacity 0.5s ease'; document.querySelector('.lp').style.opacity='0'; setTimeout(() => onSwitch('login'), 480) }}>Sign in</button>
          <button className="lp-nav-cta" onClick={(e) => flyTo(e, 'signup')}>Create account</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-glow" />
        <Reveal className="lp-hero-tag-wrap">
          <div className="lp-hero-tag"><span className="lp-pulse" />On-chain intelligence · SOL + ETH</div>
        </Reveal>
        <Reveal delay={100}>
          <h1 className="lp-hero-h1">
            Everyone sees the chart.<br />
            <em>Not everyone sees the truth.</em>
          </h1>
        </Reveal>
        <Reveal delay={220}>
          <p className="lp-hero-sub">
            Orbit analyzes any Solana or ETH token in seconds. Rug probability, holder distribution,
            fake chart scoring, AI narrative. Then connects you with the traders who are already using it.
          </p>
        </Reveal>
        <Reveal delay={340} className="lp-hero-cta-wrap">
          <button className="lp-cta-primary" onClick={(e) => flyTo(e, 'signup')}>Create free account</button>
          <button className="lp-cta-ghost" onClick={(e) => flyTo(e, 'trial')}>Try one analysis free →</button>
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
          {['RUG DETECTION','HOLDER ANALYSIS','BUNDLE SCORING','FAKE CHART','DEV HISTORY','MIGRATION TRACKING','FRESH WALLETS','SNIPER DETECTION','LIQUIDITY DEPTH','MOMENTUM','PURITY SCORE','PEAK MC ESTIMATE','ETH SUPPORT','GOPLUS SECURITY','CHAIN DETECTION',
            'RUG DETECTION','HOLDER ANALYSIS','BUNDLE SCORING','FAKE CHART','DEV HISTORY','MIGRATION TRACKING','FRESH WALLETS','SNIPER DETECTION','LIQUIDITY DEPTH','MOMENTUM','PURITY SCORE','PEAK MC ESTIMATE','ETH SUPPORT','GOPLUS SECURITY','CHAIN DETECTION'
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
          <h2 className="lp-h2">This is what you get.<br /><span className="lp-purple">In seconds.</span></h2>
        </Reveal>
        <div ref={mockRef} className={`lp-mock ${mockVisible ? 'lp-mock-go' : ''}`}>
          <div className="lp-mock-top">
            <div className="lp-mock-coin">
              <span className="lp-mock-dot" />
              <span className="lp-mock-name">PEPE</span>
              <span className="lp-mock-sym">PEPE</span>
              <span className="lp-mock-badge lp-mock-badge-chain">SOL</span>
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
            PEPE shows strong post-migration fundamentals with clean holder distribution and zero dev risk.
            Chain detection: Solana. GoPlus security check passed. High organic volume suggests sustained
            interest. Low rug probability (12) reflects clean dev history and zero manipulation signals.
            Recommend monitoring for entry on dips toward $4.2M...
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
      <section className="lp-section lp-community-section" id="section-community">
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
              Friendly reminder: the average X community is active for 9 minutes before the dev rugs and the account goes private. Orbit analysis lasts longer. Hopefully.
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
                <span className="lp-alerts-count">Degen plan · unlimited alerts</span>
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
              <span className="lp-wallet-compete-q">Rankings reset each month. May is live.</span>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="lp-wallet-card">
              <div className="lp-wallet-card-label">Monthly PnL · May 2026</div>
              <div className="lp-wallet-card-val">+14.2 SOL</div>
              <div className="lp-wallet-card-sub">Verified on-chain · Rank #3</div>
              <div className="lp-wallet-card-addr">7xK2...mF9p</div>
              <div className="lp-wallet-card-bar">
                <div className="lp-wallet-card-fill" />
              </div>
              <div className="lp-wallet-card-ranks">
                <div className="lp-rank-section-label">Highest PnL</div>
                {[
                  { rank:'#1', name:'orbitking',  pnl:'+38.7', col:'#4ade80', tier:'OMEGA', tierCol:'#f59e0b', init:'OK', bg:'#2d1845' },
                  { rank:'#2', name:'sol_runner',  pnl:'+22.1', col:'#4ade80', tier:'DEGEN', tierCol:'#a78bfa', init:'SR', bg:'#12274a' },
                  { rank:'#3', name:'7xK2...mF9p', pnl:'+14.2', col:'#4ade80', tier:'DEGEN', tierCol:'#a78bfa', init:'7K', bg:'#0e2e2e' },
                ].map(u => (
                  <div key={u.rank} className="lp-rank-row">
                    <span className="lp-rank-pos">{u.rank}</span>
                    <div className="lp-rank-avatar" style={{background: u.bg}}>{u.init}</div>
                    <div className="lp-rank-meta">
                      <span className="lp-rank-name">{u.name}</span>
                      <span className="lp-rank-tier" style={{color: u.tierCol}}>{u.tier}</span>
                    </div>
                    <span className="lp-rank-pnl" style={{color: u.col}}>{u.pnl} SOL</span>
                  </div>
                ))}
                <div className="lp-rank-section-label lp-rank-section-label-red">Lowest PnL</div>
                {[
                  { rank:'#1', name:'rekt_lord',   pnl:'-18.4', col:'#f87171', tier:'FREE',  tierCol:'#555570', init:'RL', bg:'#3a1010' },
                  { rank:'#2', name:'paper_hands',  pnl:'-12.1', col:'#f87171', tier:'DEGEN', tierCol:'#a78bfa', init:'PH', bg:'#1a1535' },
                  { rank:'#3', name:'fomo_bro',     pnl:'-9.3',  col:'#f87171', tier:'FREE',  tierCol:'#555570', init:'FB', bg:'#1a2015' },
                ].map(u => (
                  <div key={u.rank + u.name} className="lp-rank-row">
                    <span className="lp-rank-pos">{u.rank}</span>
                    <div className="lp-rank-avatar" style={{background: u.bg}}>{u.init}</div>
                    <div className="lp-rank-meta">
                      <span className="lp-rank-name">{u.name}</span>
                      <span className="lp-rank-tier" style={{color: u.tierCol}}>{u.tier}</span>
                    </div>
                    <span className="lp-rank-pnl" style={{color: u.col}}>{u.pnl} SOL</span>
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
            <button className="lp-cta-primary lp-cta-xl" onClick={(e) => flyTo(e, 'signup')}>Create free account</button>
            <button className="lp-cta-ghost" onClick={(e) => flyTo(e, 'trial')}>Try without account</button>
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
              <span className="lp-nav-ver">v0.8</span>
            </div>
            <p className="lp-footer-tag">On-chain intelligence for Solana and ETH traders.</p>
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
