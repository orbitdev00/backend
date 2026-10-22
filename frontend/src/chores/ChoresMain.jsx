import React from 'react'
import ReactDOM from 'react-dom/client'

// Chores mode: no router, auth, WebSocket, RPC or Stripe code is imported here.
// /pickleball is the standalone tournament page. Neither app's code (or CSS) is
// loaded on the other's page. Any other path is redirected to "/".
export function mount(rootEl) {
  const root = ReactDOM.createRoot(rootEl)
  const render = App => root.render(<React.StrictMode><App /></React.StrictMode>)

  if (window.location.pathname.replace(/\/+$/, '') === '/pickleball') {
    import('../pickleball/PickleballApp.jsx').then(m => render(m.default))
    return
  }
  if (window.location.pathname !== '/') {
    window.history.replaceState(null, '', '/')
  }
  document.title = 'Matos Dashboard'
  import('./ChoreApp.jsx').then(m => render(m.default))
}
