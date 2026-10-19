import React from 'react'
import ReactDOM from 'react-dom/client'
import ChoreApp from './ChoreApp.jsx'

// Chores mode: no router, auth, WebSocket, RPC or Stripe code is imported here.
// Any path other than "/" is redirected to "/".
export function mount(rootEl) {
  if (window.location.pathname !== '/') {
    window.history.replaceState(null, '', '/')
  }
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ChoreApp />
    </React.StrictMode>
  )
}
