import { useEffect, useRef } from 'react'
import { starRegistry } from './StarField'
import './BlackHole.css'

const PHASES = { pfp: 800, hold: 1000, absorb: 1400, implode: 700 }
const ease3  = t => 1 - Math.pow(1 - t, 3)
const easeIO = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2
const easeIn = t => t * t

let _els = []

function restoreElements() {
  _els.forEach(el => {
    el.style.transform  = ''
    el.style.opacity    = ''
    el.style.willChange = ''
  })
  _els = []
}

function restoreStarfield() {
  const sf = starRegistry.canvas || document.querySelector('.starfield-canvas')
  if (sf) { sf.style.display = ''; sf.style.opacity = '' }
}

export default function BlackHole({ active, onBlack }) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const stateRef  = useRef({ phase: 'idle' })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.display = 'none'

    if (!active) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      canvas.style.display = 'none'
      canvas.classList.remove('absorbing')
      restoreElements()
      restoreStarfield()
      stateRef.current = { phase: 'idle' }
      return
    }

    const W = canvas.width  = canvas.offsetWidth  || window.innerWidth
    const H = canvas.height = canvas.offsetHeight || window.innerHeight
    canvas.style.display = 'block'
    const ctx = canvas.getContext('2d')
    const sfCanvas = starRegistry.canvas

    const _pfp  = document.querySelector('.landing-pfp')
    const _pfpR = _pfp ? _pfp.getBoundingClientRect() : null
    const cx    = _pfpR ? _pfpR.left + _pfpR.width  / 2 : W / 2
    const cy    = _pfpR ? _pfpR.top  + _pfpR.height / 2 : H / 2
    const tgtR  = _pfpR ? _pfpR.width / 2 : 80

    const ASSET_SELS = ['.landing-pfp', '.landing-input-wrap', '.quote-container']
    _els = ASSET_SELS
      .flatMap(sel => [...document.querySelectorAll(sel)])
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 })

    _els.forEach(el => {
      const r = el.getBoundingClientRect()
      const ecx = r.left + r.width  / 2
      const ecy = r.top  + r.height / 2
      el._bhDist = Math.sqrt((ecx - cx) ** 2 + (ecy - cy) ** 2)
      el.style.transition      = 'none'
      el.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`
      el.style.willChange      = 'transform'
    })

    const NPARTS = 380
    const parts = Array.from({ length: NPARTS }, (_, i) => ({
      angle:  (i / NPARTS) * Math.PI * 2 + Math.random() * 0.08,
      rMult:  1.05 + Math.random() * 0.9,
      speed:  (0.006 + Math.random() * 0.012) * (i % 2 ? 1 : -1),
      sz:     0.5 + Math.random() * 1.9,
      bright: 0.3 + Math.random() * 0.7,
      lane:   Math.random(),
    }))

    const drawDisk = (holeR, alpha, fillCore = true, drawGlow = true) => {
      if (holeR < 1 || alpha <= 0) return
      const diskY = holeR * 0.19

      if (drawGlow) {
        const glow = ctx.createRadialGradient(cx, cy, holeR * 0.5, cx, cy, holeR * 3)
        glow.addColorStop(0,   `rgba(80,100,180,${0.15 * alpha})`)
        glow.addColorStop(0.5, `rgba(40,50,100,${0.08 * alpha})`)
        glow.addColorStop(1,   'rgba(0,0,0,0)')
        ctx.fillStyle = glow
        ctx.beginPath(); ctx.arc(cx, cy, holeR * 3, 0, Math.PI * 2); ctx.fill()
      }

      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        p.angle += p.speed
        const r  = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py > 0 || Math.sqrt(px * px + py * py) < holeR) continue
        const a = p.bright * alpha * (1 - p.lane * 0.45)
        ctx.beginPath(); ctx.arc(px, py, p.sz, 0, Math.PI * 2)
        ctx.fillStyle = p.lane < 0.4 ? `rgba(255,255,255,${a})` : `rgba(200,215,255,${a * 0.8})`
        ctx.fill()
      }
      ctx.restore()

      for (let i = 0; i < 3; i++) {
        const rr = holeR * (1.07 + i * 0.065)
        const a  = (0.6 - i * 0.15) * alpha
        const g  = ctx.createRadialGradient(cx, cy, rr * 0.87, cx, cy, rr * 1.13)
        g.addColorStop(0,    'rgba(255,255,255,0)')
        g.addColorStop(0.45, `rgba(220,235,255,${a * 0.5})`)
        g.addColorStop(0.65, `rgba(255,255,255,${a})`)
        g.addColorStop(0.85, `rgba(200,215,255,${a * 0.4})`)
        g.addColorStop(1,    'rgba(255,255,255,0)')
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2)
        ctx.strokeStyle = g; ctx.lineWidth = holeR * 0.06; ctx.stroke()
      }

      if (fillCore) {
        ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI * 2)
        ctx.fillStyle = '#000'; ctx.fill()
      }

      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        const r  = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py <= 0 || Math.sqrt(px * px + py * py) < holeR) continue
        const a = p.bright * alpha * 1.4 * (1 - p.lane * 0.3)
        ctx.beginPath(); ctx.arc(px, py, p.sz * 1.1, 0, Math.PI * 2)
        ctx.fillStyle = p.lane < 0.4 ? `rgba(255,255,255,${a})` : `rgba(210,225,255,${a * 0.85})`
        ctx.fill()
      }
      ctx.restore()

      const ph = ctx.createRadialGradient(cx, cy, holeR * 0.96, cx, cy, holeR * 1.05)
      ph.addColorStop(0,   'rgba(255,255,255,0)')
      ph.addColorStop(0.5, `rgba(255,255,255,${0.55 * alpha})`)
      ph.addColorStop(1,   'rgba(255,255,255,0)')
      ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI * 2)
      ctx.strokeStyle = ph; ctx.lineWidth = holeR * 0.04; ctx.stroke()

      if (fillCore) {
        ctx.beginPath(); ctx.arc(cx, cy, holeR * 0.97, 0, Math.PI * 2)
        ctx.fillStyle = '#000'; ctx.fill()
      }
    }

    // Draw a snapshot of stars onto the canvas at their current positions.
    // Called once at the hold→absorb transition so there is no 1-frame gap
    // when the sfCanvas is hidden and the BlackHole canvas takes over.
    const paintStarsAtRest = (stars) => {
      for (const star of stars) {
        ctx.beginPath()
        ctx.arc(star.x, star.y, Math.max(0.1, star.r), 0, Math.PI * 2)
        ctx.fillStyle = star.depth > 0.52
          ? `rgba(220,200,255,${star.o})`
          : `rgba(255,255,255,${star.o})`
        ctx.fill()
      }
    }

    const pfpEl = document.querySelector('.landing-pfp')
    stateRef.current = { phase: 'pfp', t0: performance.now(), called: false }

    const frame = ts => {
      const s   = stateRef.current
      const dur = PHASES[s.phase] || 1000
      const t   = Math.min((ts - s.t0) / dur, 1)
      ctx.clearRect(0, 0, W, H)

      // ── pfp: avatar shrinks into the black hole ──────────────────────────
      if (s.phase === 'pfp') {
        const et    = ease3(t)
        const holeR = et * tgtR
        if (pfpEl) pfpEl.style.transform = `scale(${1 - et})`
        drawDisk(holeR, et, false, false)
        if (t >= 1) {
          if (pfpEl) { pfpEl.style.opacity = '0'; pfpEl.style.visibility = 'hidden' }
          s.phase = 'hold'; s.t0 = ts
        }

      // ── hold: black hole holds at pfp size ───────────────────────────────
      } else if (s.phase === 'hold') {
        drawDisk(tgtR, 1, false, false)
        if (t >= 1) {
          // Snapshot parallax-corrected star screen positions
          const scroll = starRegistry.getScrollY ? starRegistry.getScrollY() : 0
          const maxR = Math.max(
            Math.sqrt(cx * cx + cy * cy),
            Math.sqrt((W - cx) * (W - cx) + cy * cy),
            Math.sqrt(cx * cx + (H - cy) * (H - cy)),
            Math.sqrt((W - cx) * (W - cx) + (H - cy) * (H - cy)),
          )
          s.stars = (starRegistry.stars || []).map(star => {
            const rawY = star.y - scroll * star.parallax
            const y    = ((rawY % H) + H) % H
            return { x: star.x, y, r: star.r, o: star.o, depth: star.depth }
          })
          s.maxR    = maxR
          s.maxDist = Math.max(..._els.map(e => e._bhDist || 1), 1)

          // Cancel StarField's rAF loop then blank its canvas so no further
          // frames bleed through, then paint the snapshot onto BlackHole canvas.
          if (starRegistry.cancelDraw) starRegistry.cancelDraw()
          if (sfCanvas) sfCanvas.getContext('2d').clearRect(0, 0, sfCanvas.width, sfCanvas.height)
          paintStarsAtRest(s.stars)

          s.phase = 'absorb'; s.t0 = ts
        }

      // ── absorb: stars and elements spiral into the black hole ────────────
      } else if (s.phase === 'absorb') {
        canvas.classList.add('absorbing')
        const et    = easeIO(t)
        const holeR = tgtR + et * tgtR * 0.2

        // Stars drawn before disk so they appear behind the accretion ring
        if (s.stars) {
          for (const star of s.stars) {
            const dist    = Math.sqrt((star.x - cx) ** 2 + (star.y - cy) ** 2)
            const normD   = Math.min(1, dist / s.maxR)
            const gravity = 1 - normD * 0.55
            const localT  = Math.min(1, et * (0.5 + gravity * 0.8))
            const eased   = easeIO(localT)
            const sx      = cx + (star.x - cx) * (1 - eased)
            const sy      = cy + (star.y - cy) * (1 - eased)
            const scale   = Math.max(0, 1 - eased)
            if (scale < 0.01) continue
            ctx.beginPath()
            ctx.arc(sx, sy, Math.max(0.1, star.r * scale), 0, Math.PI * 2)
            ctx.fillStyle = star.depth > 0.52
              ? `rgba(220,200,255,${star.o * scale})`
              : `rgba(255,255,255,${star.o * scale})`
            ctx.fill()
          }
        }

        drawDisk(holeR, 1, true, true)

        // Page elements pulled toward the black hole
        _els.forEach(el => {
          const normD   = (el._bhDist || 0) / s.maxDist
          const gravity = 1 - normD * 0.65
          const localT  = Math.min(1, et * (0.4 + gravity * 0.9))
          const ease    = easeIO(localT)
          const scale   = Math.max(0, 1 - ease)
          el.style.transform = `scale(${scale})`
          el.style.opacity   = `${scale}`
        })

        if (t >= 1) {
          _els.forEach(el => { el.style.opacity = '0' })
          s.phase = 'implode'; s.t0 = ts
        }

      // ── implode: black hole collapses ────────────────────────────────────
      } else if (s.phase === 'implode') {
        const et    = easeIn(t)
        const holeR = Math.max(0, tgtR * (1 - et))
        if (holeR > 1) drawDisk(holeR, 1 - et, true, false)

        if (t >= 1 && !s.called) {
          s.called = true
          // Elements stay at opacity:0 (set at end of absorb) — restoreElements()
          // must NOT run here because the canvas is z-index:0 and restored elements
          // would paint above it, causing a flash. Cleanup happens in active=false branch.
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, W, H)
          // Stop this rAF loop BEFORE calling onBlack so the dashboard
          // never renders with a transparent canvas on top of it
          if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
          setTimeout(() => {
            restoreStarfield()
            if (onBlack) onBlack()
          }, 50)
          return  // do not re-queue
        }
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [active])

  return (
    <canvas
      ref={canvasRef}
      className="blackhole-canvas"
    />
  )
}
