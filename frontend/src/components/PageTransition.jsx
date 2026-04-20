import './PageTransition.css'

// Keyed by location.pathname in main.jsx - remounts on every route change
// triggering the CSS animation fresh each time
export default function PageTransition({ children }) {
  return (
    <div className="pt-wrap">
      {children}
    </div>
  )
}
