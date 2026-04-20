import { useEffect, useRef } from 'react'

export const starRegistry = { stars: [], scale: 1, cancelDraw: null }

export default function StarField() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    let animId

    const W = () => window.innerWidth
    const H = () => window.innerHeight

    canvas.width  = W()
    canvas.height = H()

    const NUM_STARS = 400
    starRegistry.stars = Array.from({ length: NUM_STARS }, () => ({
      x:     (Math.random() - 0.5) * W(),
      y:     (Math.random() - 0.5) * H(),
      // Smaller: 0.15 - 0.75px
      size:  0.3 + Math.random() * 0.9,
      // Base opacity lower
      opacity: 0.1 + Math.random() * 0.5,
      // Flicker params
      flickerSpeed: 0.0008 + Math.random() * 0.002,
      flickerPhase: Math.random() * Math.PI * 2,
    }))

    const draw = (ts) => {
      canvas.width  = W()
      canvas.height = H()

      // Slower drift: was 0.00015 per frame, now 0.00007
      starRegistry.scale = starRegistry.scale || 1
      starRegistry.scale += 0.00007
      if (starRegistry.scale > 2.5) starRegistry.scale = 1

      ctx.clearRect(0, 0, W(), H())
      ctx.save()
      ctx.translate(W() / 2, H() / 2)
      ctx.scale(starRegistry.scale, starRegistry.scale)

      for (const s of starRegistry.stars) {
        // Flicker: sine wave on opacity
        const flicker = Math.sin(ts * s.flickerSpeed + s.flickerPhase) * 0.28
        const op = Math.max(0.02, Math.min(0.9, s.opacity + flicker))
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${op})`
        ctx.fill()
      }

      ctx.restore()
      animId = requestAnimationFrame(draw)
    }

    starRegistry.cancelDraw = () => cancelAnimationFrame(animId)
    animId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animId)
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
