import { useLayoutEffect, useRef } from 'react'
import { reducedMotion } from './motion.js'

/** A number that counts from its previous value to the new one. */
export function CountUp({ value, duration = 700 }) {
  const ref = useRef(null)
  const shown = useRef(null)
  // The text is written straight to the DOM so counting doesn't re-render React.
  useLayoutEffect(() => {
    const el = ref.current
    const from = shown.current ?? value
    if (from === value || reducedMotion()) {
      shown.current = value
      el.textContent = String(value)
      return
    }
    let raf, start
    const step = t => {
      start ??= t
      const k = Math.min(1, (t - start) / duration)
      const n = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3)))
      shown.current = n
      el.textContent = String(n)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <span ref={ref} className="ch-countup" />
}

/**
 * FLIP: children with data-flip set slide from their old position to the new
 * one whenever the list re-renders in a different order.
 */
export function useFlip(listRef) {
  const last = useRef(new Map())
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const next = new Map()
    for (const el of list.querySelectorAll('[data-flip]')) {
      const top = el.getBoundingClientRect().top
      next.set(el.dataset.flip, top)
      const before = last.current.get(el.dataset.flip)
      if (before != null && Math.abs(before - top) > 1 && !reducedMotion()) {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 450, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
      }
    }
    last.current = next
  })
}
