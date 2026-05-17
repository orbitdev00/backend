import { useEffect, useRef } from 'react'
import { starRegistry } from './StarField'

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

    const cx = origin.x
    const cy = origin.y
    const maxR = Math.max(
      Math.sqrt(cx * cx + cy * cy),
      Math.sqrt((W - cx) * (W - cx) + cy * cy),
      Math.sqrt(cx * cx + (H - cy) * (H - cy)),
      Math.sqrt((W - cx) * (W - cx) + (H - cy) * (H - cy)),
    )

    const sfCanvas = document.querySelector('.starfield-canvas')

    // Accretion disk particles
    const NPARTS = 300
    const parts = Array.from({ length: NPARTS }, (_, i) => ({
      angle:  (i / NPARTS) * Math.PI * 2 + Math.random() * 0.1,
      rMult:  1.05 + Math.random() * 0.8,
      speed:  (0.007 + Math.random() * 0.01) * (i % 2 ? 1 : -1),
      sz:     0.5 + Math.random() * 1.6,
      bright: 0.4 + Math.random() * 0.6,
      lane:   Math.random(),
    }))

    const drawDisk = (holeR, alpha) => {
      if (holeR < 1 || alpha <= 0) return
      const diskY = holeR * 0.18

      const glow = ctx.createRadialGradient(cx, cy, holeR * 0.5, cx, cy, holeR * 3.5)
      glow.addColorStop(0,   `rgba(100,60,200,${0.18 * alpha})`)
      glow.addColorStop(0.5, `rgba(50,30,120,${0.08 * alpha})`)
      glow.addColorStop(1,   'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(cx, cy, holeR * 3.5, 0, Math.PI * 2); ctx.fill()

      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        p.angle += p.speed
        const r  = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py > 0 || Math.sqrt(px*px+py*py) < holeR) continue
        const a = p.bright * alpha * (1 - p.lane * 0.4)
        ctx.beginPath(); ctx.arc(px, py, p.sz, 0, Math.PI * 2)
        ctx.fillStyle = p.lane < 0.4 ? `rgba(180,140,255,${a})` : `rgba(255,255,255,${a * 0.7})`
        ctx.fill()
      }
      ctx.restore()

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

      ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI * 2)
      ctx.fillStyle = '#000'; ctx.fill()

      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        const r  = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py <= 0 || Math.sqrt(px*px+py*py) < holeR) continue
        const a = p.bright * alpha * 1.3 * (1 - p.lane * 0.3)
        ctx.beginPath(); ctx.arc(px, py, p.sz * 1.1, 0, Math.PI * 2)
        ctx.fillStyle = p.lane < 0.4 ? `rgba(180,140,255,${a})` : `rgba(255,255,255,${a * 0.85})`
        ctx.fill()
      }
      ctx.restore()

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

    // Snapshot of real parallax star positions taken at suck-start
    let suckStars = null

    const captureSuckStars = () => {
      // Snapshot star positions — sfCanvas fades out gradually in the suck loop
      const scroll = starRegistry.getScrollY ? starRegistry.getScrollY() : 0
      suckStars = (starRegistry.stars || []).map(s => {
        const rawY    = s.y - scroll * s.parallax
        const screenY = ((rawY % H) + H) % H
        return { x: s.x, y: screenY, r: s.r, o: s.o, depth: s.depth }
      })
    }

    // Phases: spawn(600) -> grow(800) -> suck(1400) -> implode(600)
    const PHASES = { spawn: 600, grow: 800, suck: 1400, implode: 600 }
    const state = { phase: 'spawn', t0: performance.now(), called: false }

    const frame = ts => {
      const dur = PHASES[state.phase]
      const t   = Math.min((ts - state.t0) / dur, 1)

      // Canvas stays transparent — page content behind remains visible
      ctx.clearRect(0, 0, W, H)

      if (state.phase === 'spawn') {
        const et    = ease3(t)
        const holeR = et * 40
        drawDisk(holeR, et)
        if (t >= 1) { state.phase = 'grow'; state.t0 = ts }

      } else if (state.phase === 'grow') {
        const et    = easeIO(t)
        const holeR = 40 + et * 80
        drawDisk(holeR, 1)
        if (t >= 1) {
          captureSuckStars()
          state.phase = 'suck'; state.t0 = ts
        }

      } else if (state.phase === 'suck') {
        const et    = easeIO(t)
        const holeR = 120 + et * 30

        // sfCanvas fades out over first half of suck; canvas stars fade in as complement
        // so the two layers crossfade seamlessly with no sudden pop or doubling
        const sfAlpha = Math.max(0, 1 - et * 2)
        if (sfCanvas) sfCanvas.style.opacity = `${sfAlpha}`

        if (suckStars) {
          for (const s of suckStars) {
            const dist    = Math.sqrt((s.x - cx) ** 2 + (s.y - cy) ** 2)
            const normD   = Math.min(1, dist / maxR)
            const gravity = 1 - normD * 0.55
            const localT  = Math.min(1, et * (0.5 + gravity * 0.8))
            const eased   = easeIO(localT)
            const sx      = cx + (s.x - cx) * (1 - eased)
            const sy      = cy + (s.y - cy) * (1 - eased)
            const scale   = Math.max(0, 1 - eased)
            if (scale < 0.01) continue
            // Alpha complements sfCanvas so total brightness stays constant during crossfade
            const alpha = s.o * scale * (1 - sfAlpha)
            const col = s.depth > 0.52
              ? `rgba(220,200,255,${alpha})`
              : `rgba(255,255,255,${alpha})`
            ctx.beginPath()
            ctx.arc(sx, sy, Math.max(0.1, s.r * scale), 0, Math.PI * 2)
            ctx.fillStyle = col
            ctx.fill()
          }
        }

        drawDisk(holeR, 1)

        // Pull page elements toward the black hole via CSS
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
          if (sfCanvas) sfCanvas.style.opacity = '0'
          state.phase = 'implode'; state.t0 = ts
        }

      } else if (state.phase === 'implode') {
        const et    = easeIn(t)
        const holeR = Math.max(0, 150 * (1 - et))
        if (holeR > 1) drawDisk(holeR, 1 - et)

        // Brief black fade at the very end for a clean page transition
        if (et > 0.6) {
          const fadeIn = (et - 0.6) / 0.4
          ctx.fillStyle = `rgba(0,0,0,${fadeIn})`
          ctx.fillRect(0, 0, W, H)
        }

        if (t >= 1 && !state.called) {
          state.called = true
          const style = document.createElement('style')
          style.id = 'orbit-fadein'
          style.textContent = 'body > * { animation: orbitFadeIn 0.5s ease forwards !important } @keyframes orbitFadeIn { from { opacity: 0 } to { opacity: 1 } }'
          document.head.appendChild(style)
          setTimeout(() => { const s = document.getElementById('orbit-fadein'); if (s) s.remove() }, 700)
          if (onDone) onDone()
        }
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      canvas.style.zIndex = '0'
      const sf = document.querySelector('.starfield-canvas')
      if (sf) { sf.style.display = ''; sf.style.opacity = '' }
      contentEls.forEach(el => {
        el.style.transform  = ''
        el.style.opacity    = ''
        el.style.willChange = ''
      })
    }
  }, [active, origin])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'none',
        position: 'fixed', inset: 0,
        zIndex: 0,           // starts behind page content (z-index 1); JS raises to 9999 at suck phase
        pointerEvents: active ? 'all' : 'none',
      }}
    />
  )
}
