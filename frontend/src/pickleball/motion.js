// Pickleball page motion helpers. Animations use transform and opacity only.

export function reducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/** Scroll the box for `slot` into view (inside its sideways scroller too). */
export function scrollToSlot(slot) {
  const el = document.querySelector(`.pb-section.is-winners [data-slot="${slot}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center', inline: 'center' })
}
