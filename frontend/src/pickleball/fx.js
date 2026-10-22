// Click effects: a ripple from the tap point on every button, and a burst of
// balls for big moments. Transform and opacity only; nothing when the visitor
// prefers reduced motion.
import { reducedMotion } from './motion.js'

const RIPPLE_TARGETS = '.pb-btn, .pb-edit, .pb-icon-btn, .pb-nav-btn, .pb-link, .pb-jump-btn, .pb-rules-toggle, .pb-notif-item, .pb-swatch'

/** Delegated ripple on pointerdown inside `root`. Returns a cleanup function. */
export function installRipples(root) {
  const onDown = e => {
    const el = e.target.closest?.(RIPPLE_TARGETS)
    if (!el || el.disabled || !root.contains(el) || reducedMotion()) return
    const r = el.getBoundingClientRect()
    const size = Math.max(r.width, r.height) * 2.2
    const dot = document.createElement('span')
    dot.className = 'pb-ripple'
    dot.setAttribute('aria-hidden', 'true')
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`
    el.appendChild(dot)
    const done = () => dot.remove()
    dot.addEventListener('animationend', done)
    setTimeout(done, 900)
  }
  root.addEventListener('pointerdown', onDown)
  return () => root.removeEventListener('pointerdown', onDown)
}

/** Little balls flying out from (x, y) in viewport coordinates. */
export function burst(x, y, colors, count = 22) {
  if (reducedMotion() || typeof document === 'undefined') return
  const host = document.createElement('div')
  host.className = 'pb-fx-layer'
  document.body.appendChild(host)
  const anims = []
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span')
    const size = 8 + Math.random() * 10
    p.className = 'pb-particle'
    p.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;background:${colors[i % colors.length]}`
    host.appendChild(p)
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4
    const dist = 90 + Math.random() * 120
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist
    anims.push(p.animate([
      { transform: 'translate(0, 0) scale(0.4)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${dx * 1.1}px, ${dy * 1.1 + 70}px) scale(0.6)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' }).finished)
  }
  Promise.allSettled(anims).then(() => host.remove())
}

/** Re-triggers a CSS animation class (e.g. a shake on an error). */
export function replay(el, className) {
  if (!el || reducedMotion()) return
  el.classList.remove(className)
  void el.offsetWidth
  el.classList.add(className)
}
