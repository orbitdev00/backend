import { useEffect, useRef } from 'react'
import './BlackHole.css'
import { starRegistry } from './StarField'

const PHASES = { pfp: 800, hold: 1000, absorb: 1400, implode: 700 }
const ease3  = t => 1 - Math.pow(1 - t, 3)
const easeIO = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2
const easeIn = t => t * t

// Elements to restore — kept outside effect so cleanup can always access them
let _els = []

function restoreElements() {
  // Nothing to restore — starfield restored after onBlack fires
  _els = []
}

function restoreStarfield() {
  const sf = document.querySelector('.starfield-canvas')
  if (sf) { sf.style.display = ''; sf.style.opacity = '' }
}

export default function BlackHole({ active, onBlack }) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const stateRef  = useRef({ phase: 'idle' })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.display = 'none'  // hidden by default

    if (!active) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      canvas.style.display = 'none'
      canvas.classList.remove('absorbing')
      restoreElements()
      stateRef.current = { phase: 'idle' }
      return
    }

    const W = canvas.width  = canvas.offsetWidth  || window.innerWidth
    const H = canvas.height = canvas.offsetHeight || window.innerHeight
    canvas.style.display = 'block'
    const ctx    = canvas.getContext('2d')
    // Center on pfp position
    const _pfp   = document.querySelector('.landing-pfp')
    const _pfpR  = _pfp ? _pfp.getBoundingClientRect() : null
    const cx     = _pfpR ? _pfpR.left + _pfpR.width  / 2 : W / 2
    const cy     = _pfpR ? _pfpR.top  + _pfpR.height / 2 : H / 2
    // Target radius = pfp icon size (~80px radius)
    const pfp0   = document.querySelector('.landing-pfp')
    const pfpR0  = pfp0 ? pfp0.getBoundingClientRect() : null
    const tgtR   = pfpR0 ? pfpR0.width / 2 : 80

    // Grab individual landing children — NOT the whole landing div (React unmounts it)
    // Grab them NOW while they exist, store refs before animation starts
    const ASSET_SELS = ['.landing-pfp', '.landing-input-wrap', '.quote-container']
    _els = ASSET_SELS
      .flatMap(sel => [...document.querySelectorAll(sel)])
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 })

    // Compute distance from black hole center for each element
    _els.forEach(el => {
      const r       = el.getBoundingClientRect()
      const ecx     = r.left + r.width  / 2
      const ecy     = r.top  + r.height / 2
      const dist    = Math.sqrt((ecx - cx)**2 + (ecy - cy)**2)
      el._bhDist    = dist
      el.style.transition      = 'none'
      el.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`
      el.style.willChange      = 'transform'
    })

    // Accretion disk particles — white/blue-white only
    const NPARTS = 380
    const parts  = Array.from({ length: NPARTS }, (_, i) => ({
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

      // Back half disk
      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        p.angle += p.speed
        const r  = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py > 0 || Math.sqrt(px*px + py*py) < holeR) continue
        const a = p.bright * alpha * (1 - p.lane * 0.45)
        ctx.beginPath(); ctx.arc(px, py, p.sz, 0, Math.PI * 2)
        ctx.fillStyle = p.lane < 0.4 ? `rgba(255,255,255,${a})` : `rgba(200,215,255,${a * 0.8})`
        ctx.fill()
      }
      ctx.restore()

      // Lensing rings
      for (let i = 0; i < 3; i++) {
        const rr = holeR * (1.07 + i * 0.065)
        const a  = (0.6 - i * 0.15) * alpha
        const g  = ctx.createRadialGradient(cx, cy, rr * .87, cx, cy, rr * 1.13)
        g.addColorStop(0,    'rgba(255,255,255,0)')
        g.addColorStop(0.45, `rgba(220,235,255,${a * .5})`)
        g.addColorStop(0.65, `rgba(255,255,255,${a})`)
        g.addColorStop(0.85, `rgba(200,215,255,${a * .4})`)
        g.addColorStop(1,    'rgba(255,255,255,0)')
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2)
        ctx.strokeStyle = g; ctx.lineWidth = holeR * 0.06; ctx.stroke()
      }

      if (fillCore) { ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill() }

      // Front half disk
      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        const r  = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py <= 0 || Math.sqrt(px*px + py*py) < holeR) continue
        const a = p.bright * alpha * 1.4 * (1 - p.lane * 0.3)
        ctx.beginPath(); ctx.arc(px, py, p.sz * 1.1, 0, Math.PI * 2)
        ctx.fillStyle = p.lane < 0.4 ? `rgba(255,255,255,${a})` : `rgba(210,225,255,${a * 0.85})`
        ctx.fill()
      }
      ctx.restore()

      // Photon ring
      const ph = ctx.createRadialGradient(cx, cy, holeR * .96, cx, cy, holeR * 1.05)
      ph.addColorStop(0,   'rgba(255,255,255,0)')
      ph.addColorStop(0.5, `rgba(255,255,255,${0.55 * alpha})`)
      ph.addColorStop(1,   'rgba(255,255,255,0)')
      ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI * 2)
      ctx.strokeStyle = ph; ctx.lineWidth = holeR * 0.04; ctx.stroke()

      if (fillCore) { ctx.beginPath(); ctx.arc(cx, cy, holeR * .97, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill() }
    }

    // Hide pfp immediately — black hole will replace it
    const pfpEl = document.querySelector('.landing-pfp')

    stateRef.current = { phase: 'pfp', t0: performance.now(), called: false }

    const frame = ts => {
      const s   = stateRef.current
      const dur = PHASES[s.phase] || 1000
      const t   = Math.min((ts - s.t0) / dur, 1)
      ctx.clearRect(0, 0, W, H)

      if (s.phase === 'pfp') {
        // Black hole grows at pfp position while pfp shrinks
        const et    = ease3(t)
        const holeR = et * tgtR
        if (pfpEl) pfpEl.style.transform = `scale(${1 - et})`
        drawDisk(holeR, et, false, false)
        if (t >= 1) {
          if (pfpEl) { pfpEl.style.opacity = '0'; pfpEl.style.visibility = 'hidden' }
          s.phase = 'hold'; s.t0 = ts
        }

      } else if (s.phase === 'hold') {
        // Black hole sits at pfp size for 1 second
        drawDisk(tgtR, 1, false, false)
        if (t >= 1) { s.phase = 'absorb'; s.t0 = ts }

      } else if (s.phase === 'absorb') {
        canvas.classList.add('absorbing')
        const et    = easeIO(t)
        const holeR = tgtR + et * tgtR * 0.2

        // Hide the real starfield — we take over drawing stars individually
        const sfCanvas = document.querySelector('.starfield-canvas')
        if (sfCanvas) sfCanvas.style.display = 'none'

        // Initialize from real star positions in StarField registry
        if (!s.stars) {
          const sc = starRegistry.scale || 1
          const hw = W / 2, hh = H / 2
          s.stars = starRegistry.stars.map(star => {
            // Convert from StarField coordinate space (centered, scaled) to screen space
            const sx   = hw + star.x * sc
            const sy   = hh + star.y * sc
            const dist = Math.sqrt((sx - cx)**2 + (sy - cy)**2)
            return {
              x: sx, y: sy,
              size:     star.size,
              opacity:  star.opacity,
              dist,
              normDist: dist / (Math.sqrt(W*W + H*H) / 2),
            }
          })
        }

        drawDisk(holeR, 1, false, false)

        // Draw each star pulled toward center with gravity
        for (const star of s.stars) {
          const gravity  = 1 - star.normDist * 0.65
          const localT   = Math.min(1, et * (0.4 + gravity * 0.8))
          const eased    = localT < 0.5 ? 4*localT*localT*localT : 1-Math.pow(-2*localT+2,3)/2
          const sx = cx + (star.x - cx) * (1 - eased)
          const sy = cy + (star.y - cy) * (1 - eased)
          const scale = Math.max(0, 1 - eased)
          if (scale < 0.01) continue
          ctx.beginPath()
          ctx.arc(sx, sy, star.size * scale, 0, Math.PI*2)
          ctx.fillStyle = `rgba(255,255,255,${star.opacity})`
          ctx.fill()
        }

        // Gravity absorption — closer elements absorbed faster
        if (!s.maxDist) s.maxDist = Math.max(..._els.map(e => e._bhDist || 1), 1)
        _els.forEach(el => {
          const normDist = el._bhDist / s.maxDist
          // Closer elements have lower delay — absorbed sooner
          // Gravity curve: progress is boosted for near elements
          const gravity  = 1 - normDist * 0.7  // 1.0 near, 0.3 far
          const localT   = Math.min(1, et * (0.5 + gravity))
          const ease     = localT < 0.5 ? 4*localT*localT*localT : 1 - Math.pow(-2*localT+2,3)/2
          const scale    = Math.max(0.0, 1 - ease)
          el.style.transform = `scale(${scale})`
          el.style.opacity   = '1'
        })

        if (t >= 1) {
          _els.forEach(el => { el.style.opacity = '0' })
          s.phase = 'implode'; s.t0 = ts
        }

      } else if (s.phase === 'implode') {
        // Shrink black hole to nothing, no background fill
        const et    = easeIn(t)
        const holeR = Math.max(0, tgtR * (1 - et))
        if (holeR > 1) drawDisk(holeR, 1 - et, false, false)

        if (t >= 1 && !s.called) {
          s.called = true
          restoreElements()
          setTimeout(() => {
            restoreStarfield()
            if (onBlack) onBlack()
          }, 50)
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
