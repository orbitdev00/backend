import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import './PageTransition.css'

export default function PageTransition({ children }) {
  const location = useLocation()
  const [displayLocation, setDisplayLocation] = useState(location)
  const [phase, setPhase] = useState('in') // 'in' | 'out'

  useEffect(() => {
    if (location.pathname !== displayLocation.pathname) {
      setPhase('out')
      const t = setTimeout(() => {
        setDisplayLocation(location)
        setPhase('in')
      }, 220)
      return () => clearTimeout(t)
    }
  }, [location])

  return (
    <div className={`pt-wrap pt-${phase}`}>
      {children}
    </div>
  )
}
