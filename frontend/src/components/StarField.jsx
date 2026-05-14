import { useEffect, useRef } from 'react'

export const starRegistry = { cancelDraw: null }

export default function StarField() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animId
    let stars = []

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
      stars = Array.from({ length: 700 }, () => {
        const depth = Math.random() * 0.75 + 0.05   // 0.05 (far) → 0.80 (near)
        const t = (depth - 0.05) / 0.75             // 0–1 closeness
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
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const s of stars) {
        const w1 = Math.sin(ts * 0.001  * s.speed * 60 + s.phase)
        const w2 = Math.sin(ts * 0.0017 * s.speed * 45 + s.phase2) * 0.5
        const o = Math.max(0.02, Math.min(0.95, s.o + (w1 + w2) * 0.32))
        const r = Math.max(0.1, s.r + w1 * 0.3)
        if (r > 1.5 && s.depth > 0.52) {
          const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 4.5)
          grd.addColorStop(0, `rgba(210,190,255,${o * 0.28})`)
          grd.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.beginPath()
          ctx.arc(s.x, s.y, r * 4.5, 0, Math.PI * 2)
          ctx.fillStyle = grd
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${o})`
        ctx.fill()
      }
      animId = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    starRegistry.cancelDraw = () => cancelAnimationFrame(animId)
    animId = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 0,
      }}
    />
  )
}
