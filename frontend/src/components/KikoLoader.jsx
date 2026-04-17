import { useEffect, useRef } from 'react'

export default function KikoLoader({ visible }) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const t0Ref     = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width  = 160
    const H = canvas.height = 160
    const cx = W / 2, cy = H / 2

    // Particles orbiting the black hole
    const NPARTS = 120
    const parts  = Array.from({ length: NPARTS }, (_, i) => ({
      angle:  (i / NPARTS) * Math.PI * 2 + Math.random() * 0.1,
      rMult:  1.1 + Math.random() * 0.7,
      speed:  (0.018 + Math.random() * 0.022) * (i % 2 ? 1 : -1),
      sz:     0.4 + Math.random() * 1.2,
      bright: 0.4 + Math.random() * 0.6,
      lane:   Math.random(),
    }))

    const IMPLODE_DURATION = 600  // ms for implosion

    const draw = (ts) => {
      if (!t0Ref.current) t0Ref.current = ts
      const elapsed = ts - t0Ref.current

      ctx.clearRect(0, 0, W, H)

      // Implosion phase — shrink to nothing
      let holeR, diskAlpha, globalScale
      if (!visible) {
        // Imploding
        const t = Math.min(elapsed / IMPLODE_DURATION, 1)
        const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2
        holeR       = 32 * (1 - ease)
        diskAlpha   = 1 - ease
        globalScale = 1 - ease * 0.5
      } else {
        // Idle pulsing
        holeR     = 18 + Math.sin(elapsed * 0.002) * 3
        diskAlpha = 0.7 + Math.sin(elapsed * 0.003) * 0.3
        globalScale = 1
      }

      if (holeR < 0.5) {
        rafRef.current = null
        return
      }

      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(globalScale, globalScale)
      ctx.translate(-cx, -cy)

      // Outer glow
      const glow = ctx.createRadialGradient(cx, cy, holeR * 0.8, cx, cy, holeR * 2.2)
      glow.addColorStop(0,   `rgba(60,60,80,${0.25 * diskAlpha})`)
      glow.addColorStop(0.5, `rgba(30,30,50,${0.12 * diskAlpha})`)
      glow.addColorStop(1,   'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(cx, cy, holeR * 2.2, 0, Math.PI*2); ctx.fill()

      const diskY = holeR * 0.22

      // Disk back half
      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        p.angle += p.speed
        const r  = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py > 0 || Math.sqrt(px*px+py*py) < holeR) continue
        const a = p.bright * diskAlpha * (1 - p.lane * 0.4)
        ctx.beginPath(); ctx.arc(px, py, p.sz, 0, Math.PI*2)
        ctx.fillStyle = p.lane < 0.4
          ? `rgba(255,255,255,${a})`
          : `rgba(200,210,255,${a * 0.8})`
        ctx.fill()
      }
      ctx.restore()

      // Lensing ring
      for (let i = 0; i < 2; i++) {
        const rr = holeR * (1.08 + i * 0.07)
        const a  = (0.5 - i * 0.15) * diskAlpha
        const g  = ctx.createRadialGradient(cx, cy, rr * 0.88, cx, cy, rr * 1.12)
        g.addColorStop(0,   'rgba(255,255,255,0)')
        g.addColorStop(0.5, `rgba(255,255,255,${a})`)
        g.addColorStop(1,   'rgba(255,255,255,0)')
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI*2)
        ctx.strokeStyle = g; ctx.lineWidth = holeR * 0.07; ctx.stroke()
      }

      // Core
      ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI*2)
      ctx.fillStyle = '#000'; ctx.fill()

      // Disk front half
      ctx.save(); ctx.translate(cx, cy)
      for (const p of parts) {
        const r  = holeR * p.rMult
        const px = Math.cos(p.angle) * r
        const py = Math.sin(p.angle) * r * (diskY / holeR)
        if (py <= 0 || Math.sqrt(px*px+py*py) < holeR) continue
        const a = p.bright * diskAlpha * 1.3 * (1 - p.lane * 0.3)
        ctx.beginPath(); ctx.arc(px, py, p.sz * 1.1, 0, Math.PI*2)
        ctx.fillStyle = p.lane < 0.4
          ? `rgba(255,255,255,${a})`
          : `rgba(210,220,255,${a * 0.9})`
        ctx.fill()
      }
      ctx.restore()

      // Photon ring
      const ph = ctx.createRadialGradient(cx, cy, holeR * 0.95, cx, cy, holeR * 1.05)
      ph.addColorStop(0,   'rgba(255,255,255,0)')
      ph.addColorStop(0.5, `rgba(255,255,255,${0.5 * diskAlpha})`)
      ph.addColorStop(1,   'rgba(255,255,255,0)')
      ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI*2)
      ctx.strokeStyle = ph; ctx.lineWidth = holeR * 0.04; ctx.stroke()

      // Re-stamp core
      ctx.beginPath(); ctx.arc(cx, cy, holeR * 0.97, 0, Math.PI*2)
      ctx.fillStyle = '#000'; ctx.fill()

      ctx.restore()

      rafRef.current = requestAnimationFrame(draw)
    }

    t0Ref.current = null
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [visible])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 0', gap: 8,
    }}>
      <canvas ref={canvasRef} width={120} height={120} />
      <span style={{
        fontSize: 10, letterSpacing: '2px',
        color: 'var(--text-muted)', textTransform: 'uppercase',
        fontFamily: 'var(--mono)',
      }}>
        Analyzing...
      </span>
    </div>
  )
}
