// Small animation helpers on the Web Animations API and <canvas>. Everything
// moves with transform and opacity only, and everything turns into a plain
// fade (or nothing) when the visitor prefers reduced motion.

export function reducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function layer() {
  const el = document.createElement('div')
  el.className = 'ch-fx-layer'
  document.body.appendChild(el)
  return el
}

/** Particles flying out from (x, y) in viewport coordinates. */
export function burst(x, y, { colors, count = 10, spread = 70, size = 8, duration = 700 }) {
  if (reducedMotion()) return
  const host = layer()
  const done = []
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span')
    p.className = 'ch-particle'
    const s = size * (0.6 + Math.random() * 0.8)
    p.style.cssText = `left:${x - s / 2}px;top:${y - s / 2}px;width:${s}px;height:${s}px;background:${colors[i % colors.length]}`
    host.appendChild(p)
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5
    const dist = spread * (0.5 + Math.random() * 0.7)
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist
    done.push(p.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px,${dy}px) scale(0.2)`, opacity: 0 },
    ], { duration: duration * (0.7 + Math.random() * 0.5), easing: 'cubic-bezier(0.1, 0.8, 0.3, 1)' }).finished)
  }
  Promise.all(done).finally(() => host.remove())
}

/** A circle that scales out from (x, y) in `color`. Resolves when it's done. */
export function scaleBurst(x, y, color) {
  if (reducedMotion()) return Promise.resolve()
  const host = layer()
  const dot = document.createElement('span')
  dot.className = 'ch-scale-burst'
  dot.style.cssText = `left:${x - 30}px;top:${y - 30}px;background:${color}`
  host.appendChild(dot)
  const reach = Math.hypot(window.innerWidth, window.innerHeight) / 30
  return dot.animate([
    { transform: 'scale(0.2)', opacity: 0.95 },
    { transform: `scale(${reach})`, opacity: 0.85, offset: 0.75 },
    { transform: `scale(${reach})`, opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }).finished.finally(() => host.remove())
}

/** Briefly washes an element in `color` (the element needs position: relative). */
export function flash(el, color) {
  const f = document.createElement('span')
  f.className = 'ch-flash'
  f.style.background = color
  el.appendChild(f)
  f.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: reducedMotion() ? 250 : 600, easing: 'ease-out' })
    .finished.finally(() => f.remove())
}

/** "+N pts" that floats up out of an element and fades. */
export function floatText(el, text, color) {
  const t = document.createElement('span')
  t.className = 'ch-float-text'
  t.textContent = text
  t.style.color = color
  el.appendChild(t)
  const frames = reducedMotion()
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
      { transform: 'translate(-50%, 0) scale(0.8)', opacity: 0 },
      { transform: 'translate(-50%, -18px) scale(1.1)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -56px) scale(1)', opacity: 0 },
    ]
  t.animate(frames, { duration: 1100, easing: 'ease-out' }).finished.finally(() => t.remove())
}

/** Full-screen confetti drawn on a canvas for ~3 seconds. */
export function confetti(colors) {
  if (reducedMotion()) return
  const canvas = document.createElement('canvas')
  canvas.className = 'ch-confetti'
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = window.innerWidth, h = window.innerHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  const count = w < 640 ? 110 : 180
  const pieces = Array.from({ length: count }, (_, i) => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3,
    y: h * 0.35,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 15 - 5,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.35,
    s: 6 + Math.random() * 7,
    c: colors[i % colors.length],
  }))
  const start = performance.now()
  const LIFE = 3000
  const frame = now => {
    const t = now - start
    ctx.clearRect(0, 0, w, h)
    ctx.globalAlpha = t > LIFE - 600 ? Math.max(0, (LIFE - t) / 600) : 1
    for (const p of pieces) {
      p.vy += 0.38
      p.vx *= 0.99
      p.x += p.vx
      p.y += p.vy
      p.r += p.vr
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.r)
      ctx.fillStyle = p.c
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2)
      ctx.restore()
    }
    if (t < LIFE) requestAnimationFrame(frame)
    else canvas.remove()
  }
  requestAnimationFrame(frame)
}

/** Center of an element in viewport coordinates. */
export function centerOf(el) {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
