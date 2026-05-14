import { useEffect, useRef } from 'react'

export const starRegistry = { cancelDraw: null }

export default function StarField() {
  const canvasRef = useRef(null)
  const scrollRef = useRef(0)

  useEffect(() => {
    const onScroll = () => { scrollRef.current = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animId
    let stars = []

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
      stars = Array.from({ length: 294 }, () => {
        const depth = Math.random() * 0.75 + 0.05   // 0.05 (far) → 0.80 (near)
        const t = (depth - 0.05) / 0.75             // 0–1 closeness
        return {
          x:        Math.random() * canvas.width,
          y:        Math.random() * canvas.height,
          r:        0.15 + Math.random() * 0.45 + t * 1.7,
          o:        0.06 + Math.random() * 0.18 + t * 0.58,
          freq:     0.0006 + Math.random() * 0.002,  // radians/ms → periods 3–10s
          phase:    Math.random() * Math.PI * 2,
          phase2:   Math.random() * Math.PI * 2,
          parallax: depth * 0.9,                     // far≈0, near≈0.72
          depth,
        }
      })
    }

    const draw = (ts) => {
      const H = canvas.height
      ctx.clearRect(0, 0, canvas.width, H)
      const scroll = scrollRef.current

      for (const s of stars) {
        const w1 = Math.sin(ts * s.freq + s.phase)
        const w2 = Math.sin(ts * s.freq * 1.7 + s.phase2) * 0.4
        const o  = Math.max(0.02, Math.min(0.95, s.o + (w1 + w2) * 0.38))
        const r  = Math.max(0.1,  s.r + w1 * 0.28)

        // parallax — near stars scroll faster, wrap with ghost copy to prevent pop
        const rawY = s.y - scroll * s.parallax
        const dy1  = ((rawY % H) + H) % H
        const dy2  = dy1 - H

        const paint = (dy) => {
          if (dy < -r * 5 || dy > H + r * 5) return
          if (r > 1.5 && s.depth > 0.52) {
            const grd = ctx.createRadialGradient(s.x, dy, 0, s.x, dy, r * 4.5)
            grd.addColorStop(0, `rgba(210,190,255,${o * 0.28})`)
            grd.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.beginPath()
            ctx.arc(s.x, dy, r * 4.5, 0, Math.PI * 2)
            ctx.fillStyle = grd
            ctx.fill()
          }
          ctx.beginPath()
          ctx.arc(s.x, dy, r, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,255,255,${o})`
          ctx.fill()
        }

        paint(dy1)
        paint(dy2)
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
      className="starfield-canvas"
      style={{
        position: 'fixed', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 0,
      }}
    />
  )
}
