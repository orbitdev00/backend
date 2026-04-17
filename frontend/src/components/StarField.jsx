import { useEffect, useRef } from 'react'

// Shared star registry — BlackHole reads this during absorption
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

    const NUM_STARS = 600
    // Store stars in registry so BlackHole can access actual positions
    starRegistry.stars = Array.from({ length: NUM_STARS }, () => ({
      x:       (Math.random() - 0.5) * W(),
      y:       (Math.random() - 0.5) * H(),
      size:    Math.random() * 1.8 + 0.5,
      opacity: Math.random() * 0.6 + 0.3,
    }))

    const draw = () => {
      canvas.width  = W()
      canvas.height = H()

      starRegistry.scale = starRegistry.scale || 1
      starRegistry.scale += 0.00015
      if (starRegistry.scale > 2.5) starRegistry.scale = 1

      ctx.clearRect(0, 0, W(), H())
      ctx.save()
      ctx.translate(W() / 2, H() / 2)
      ctx.scale(starRegistry.scale, starRegistry.scale)

      for (const s of starRegistry.stars) {
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${s.opacity})`
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
