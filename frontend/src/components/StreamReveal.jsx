import { useEffect, useRef, useState } from 'react'
import './StreamReveal.css'

export default function StreamReveal({ children, show, delay = 0 }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!show) { setVisible(false); return }
    const id1 = requestAnimationFrame(() => {
      const id2 = requestAnimationFrame(() => {
        const t = delay > 0 ? setTimeout(() => setVisible(true), delay) : null
        if (!delay) setVisible(true)
        return () => t && clearTimeout(t)
      })
      return () => cancelAnimationFrame(id2)
    })
    return () => cancelAnimationFrame(id1)
  }, [show, delay])

  return (
    <div className={`sr${visible ? ' sr-in' : ''}`}>
      {children}
    </div>
  )
}
