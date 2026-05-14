import { useEffect, useRef } from 'react'

const ease3  = t => 1 - Math.pow(1 - t, 3)
const easeIO = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2
const easeIn = t => t * t

export default function LandingBlackHole({ active, origin, onDone }) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!active || !origin) { canvas.style.display = 'none'; return }

    const W = canvas.width  = window.innerWidth
    const H = canvas.height = window.innerHeight
    canvas.style.display = 'block'
    const ctx = canvas.getContext('2d')
    const scrollY = window.scrollY || 0

    // Black hole spawns at button click position (viewport coords)
    const cx = origin.x
    const cy = origin.y
    const maxR = Math.sqrt(W * W + H * H) * 0.5

    // Hide the real star canvas immediately — we draw our own stars for absorption
    const lpCanvas = document.querySelector('.lp-canvas')
    if (lpCanvas) { lpCanvas.style.opacity = '0'; lpCanvas.style.display = 'none' }
    const sfCanvas = document.querySelector('.starfield-canvas')
    if (sfCanvas) { sfCanvas.style.opacity = '0'; sfCanvas.style.display = 'none' }

    // Always generate absorption stars regardless of lpCanvas
    const starData = Array.from({ length: 280 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      o: Math.random() * 0.5 + 0.2,
    }))

    // Accretion disk particles
    const NPARTS = 300
    const parts = Array.from({ length: NPARTS }, (_, i) => ({
      angle: (i / NPARTS) * Math.PI * 2 + Math.random() * 0.1,
      rMult: 1.05 + Math.random() * 0.8,
      speed: (0.007 + Math.random() * 0.01) * (i % 2 ? 1 : -1),
      sz:    0.5 + Math.random() * 1.6,
      bright: 0.4 + Math.random() * 0.6,
      lane:  Math.random(),
    }))

    const drawDisk = (holeR, alpha) => {
      if (holeR < 1 || alpha <= 0) return
      const diskY = holeR * 0.18

      // Glow
      const glow = ctx.createRadialGradient(cx, cy, holeR * 0.5, cx, cy, holeR * 3.5)
      glow.addColorStop(0,   `rgba(100,60,200,${0.18 * alpha})`)
      glow.addColorStop(0.5, `rgba(50,30,120,${0.08 * alpha})`)
      glow.addColorStop(1,   'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(cx, cy, holeR * 3.5, 0, Math.PI * 2); ctx.fill()

      // Back disk
      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        p.angle += p.speed
        const r = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py > 0 || Math.sqrt(px*px+py*py) < holeR) continue
        const a = p.bright * alpha * (1 - p.lane * 0.4)
        ctx.beginPath(); ctx.arc(px, py, p.sz, 0, Math.PI * 2)
        ctx.fillStyle = p.lane < 0.4
          ? `rgba(180,140,255,${a})`
          : `rgba(255,255,255,${a * 0.7})`
        ctx.fill()
      }
      ctx.restore()

      // Lensing rings
      for (let i = 0; i < 3; i++) {
        const rr = holeR * (1.06 + i * 0.06)
        const a  = (0.55 - i * 0.14) * alpha
        const g  = ctx.createRadialGradient(cx, cy, rr * 0.88, cx, cy, rr * 1.12)
        g.addColorStop(0,    'rgba(200,160,255,0)')
        g.addColorStop(0.5,  `rgba(200,160,255,${a * 0.5})`)
        g.addColorStop(0.65, `rgba(255,255,255,${a})`)
        g.addColorStop(1,    'rgba(200,160,255,0)')
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2)
        ctx.strokeStyle = g; ctx.lineWidth = holeR * 0.055; ctx.stroke()
      }

      // Core
      ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI * 2)
      ctx.fillStyle = '#000'; ctx.fill()

      // Front disk
      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        const r = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py <= 0 || Math.sqrt(px*px+py*py) < holeR) continue
        const a = p.bright * alpha * 1.3 * (1 - p.lane * 0.3)
        ctx.beginPath(); ctx.arc(px, py, p.sz * 1.1, 0, Math.PI * 2)
        ctx.fillStyle = p.lane < 0.4
          ? `rgba(180,140,255,${a})`
          : `rgba(255,255,255,${a * 0.85})`
        ctx.fill()
      }
      ctx.restore()

      // Photon ring
      const ph = ctx.createRadialGradient(cx, cy, holeR * 0.96, cx, cy, holeR * 1.05)
      ph.addColorStop(0,   'rgba(200,160,255,0)')
      ph.addColorStop(0.5, `rgba(220,180,255,${0.6 * alpha})`)
      ph.addColorStop(1,   'rgba(200,160,255,0)')
      ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI * 2)
      ctx.strokeStyle = ph; ctx.lineWidth = holeR * 0.04; ctx.stroke()

      ctx.beginPath(); ctx.arc(cx, cy, holeR * 0.97, 0, Math.PI * 2)
      ctx.fillStyle = '#000'; ctx.fill()
    }

    // Page content elements to suck in
    const pageEl = document.querySelector('.lp')
    let contentEls = []
    if (pageEl) {
      contentEls = [...pageEl.querySelectorAll(
        '.lp-nav, .lp-hero, .lp-ticker-outer, .lp-section, .lp-joke-strip, .lp-data-strip, .lp-footer, .lp-final'
      )].filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      contentEls.forEach(el => {
        const r   = el.getBoundingClientRect()
        const ecx = r.left + r.width / 2
        const ecy = r.top  + r.height / 2
        el._dist  = Math.sqrt((ecx - cx) ** 2 + (ecy - cy) ** 2)
        el._maxD  = Math.sqrt(W * W + H * H)
        el.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`
        el.style.willChange = 'transform, opacity'
        el.style.transition = 'none'
      })
    }

    // Phases: spawn(600) -> grow(800) -> suck(1200) -> implode(500)
    const PHASES = { spawn: 600, grow: 800, suck: 1200, implode: 500 }
    const state = { phase: 'spawn', t0: performance.now(), called: false }
    let lpHidden = false

    const frame = ts => {
      const dur = PHASES[state.phase]
      const t   = Math.min((ts - state.t0) / dur, 1)
      ctx.clearRect(0, 0, W, H)

      if (state.phase === 'spawn') {
        // Small black hole appears from button
        const et    = ease3(t)
        const holeR = et * 40
        drawDisk(holeR, et)

        if (t >= 1) { state.phase = 'grow'; state.t0 = ts }

      } else if (state.phase === 'grow') {
        // Grows to 120px radius
        const et    = easeIO(t)
        const holeR = 40 + et * 80
        drawDisk(holeR, 1)

        if (t >= 1) {
          lpHidden = true
          canvas.style.zIndex = '9999'
          document.body.classList.add('lp-bh-sucking')
          state.phase = 'suck'; state.t0 = ts
        }

      } else if (state.phase === 'suck') {
        // Suck in all page content
        const et    = easeIO(t)
        const holeR = 120 + et * 30

        // Draw remaining stars being pulled in
        for (const s of starData) {
          const dist = Math.sqrt((s.x - cx) ** 2 + (s.y - cy) ** 2)
          const normD = dist / maxR
          const gravity = 1 - normD * 0.6
          const localT = Math.min(1, et * (0.3 + gravity))
          const eased  = easeIO(localT)
          const sx = cx + (s.x - cx) * (1 - eased)
          const sy = cy + (s.y - cy) * (1 - eased)
          const scale = Math.max(0, 1 - eased)
          if (scale < 0.01) continue
          ctx.beginPath(); ctx.arc(sx, sy, s.r * scale, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,255,255,${s.o * scale})`
          ctx.fill()
        }

        drawDisk(holeR, 1)

        // Suck page elements
        const maxD = contentEls.reduce((m, el) => Math.max(m, el._dist || 0), 1)
        contentEls.forEach(el => {
          const normD   = (el._dist || 0) / maxD
          const gravity = 1 - normD * 0.65
          const localT  = Math.min(1, et * (0.4 + gravity * 0.9))
          const eased   = easeIO(localT)
          const scale   = Math.max(0, 1 - eased)
          el.style.transform = `scale(${scale})`
          el.style.opacity   = `${scale}`
        })

        if (t >= 1) {
          contentEls.forEach(el => { el.style.opacity = '0' })
          state.phase = 'implode'; state.t0 = ts
        }

      } else if (state.phase === 'implode') {
        // Black hole collapses to nothing
        const et    = easeIn(t)
        const holeR = Math.max(0, 150 * (1 - et))
        if (holeR > 1) drawDisk(holeR, 1 - et * 0.5)

        // Full black overlay fades in
        ctx.fillStyle = `rgba(0,0,0,${et})`
        ctx.fillRect(0, 0, W, H)

        if (t >= 1 && !state.called) {
          state.called = true
          // Inject fade-in style for next page
          const style = document.createElement('style')
          style.id = 'orbit-fadein'
          style.textContent = 'body > * { animation: orbitFadeIn 0.6s ease forwards !important } @keyframes orbitFadeIn { from { opacity: 0 } to { opacity: 1 } }'
          document.head.appendChild(style)
          setTimeout(() => { const s = document.getElementById('orbit-fadein'); if(s) s.remove() }, 800)
          if (onDone) onDone()
        }
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (lpCanvas) { lpCanvas.style.display = ''; lpCanvas.style.opacity = '' }
      const sfCanvas = document.querySelector('.starfield-canvas')
      if (sfCanvas) { sfCanvas.style.display = ''; sfCanvas.style.opacity = '' }
      document.body.classList.remove('lp-bh-sucking')
      contentEls.forEach(el => {
        el.style.transform = ''
        el.style.opacity = ''
        el.style.willChange = ''
      })
    }
  }, [active, origin])

  return (
    <canvas
      ref={canvasRef}
      className="lp-bh-canvas"
      style={{
        display: 'none',
        position: 'fixed',
        top: 0, left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9,
        pointerEvents: active ? 'all' : 'none',
      }}
    />
  )
}
