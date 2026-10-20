import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const BACKEND_URL = process.env.VITE_BACKEND_URL || 'https://backend-3pyp.onrender.com'

// VITE_APP_MODE: "orbit" (full app) | "chores" (Matos Dashboard chores app). Default: chores.
// See ORBIT_CHORE_MODE.md at the repo root.
function resolveAppMode(mode) {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const value = (process.env.VITE_APP_MODE || env.VITE_APP_MODE || 'chores').trim().toLowerCase()
  return value === 'orbit' ? 'orbit' : 'chores'
}

const CHORES_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E" +
  "%3Crect width='64' height='64' rx='14' fill='%234f46e5'/%3E" +
  "%3Cpath d='M18 33l9 9 19-20' fill='none' stroke='white' stroke-width='7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"

function appModeHtml(appMode) {
  return {
    name: 'app-mode-html',
    transformIndexHtml(html) {
      if (appMode === 'orbit') return html
      return html
        .replace('<title>Orbit</title>',
          '<title>Matos Dashboard</title>\n' +
          '    <meta name="description" content="Family chores: today\'s tasks, points, streaks and the shared calendar." />\n' +
          '    <meta name="theme-color" content="#4f46e5" />\n' +
          `    <link rel="icon" href="${CHORES_FAVICON}" />`)
        .replace(/family=Inter:wght@300;400;500;600&family=JetBrains\+Mono:wght@400;500/, 'family=Inter:wght@400;500;600;700')
    },
  }
}

export default defineConfig(({ mode }) => {
  const appMode = resolveAppMode(mode)
  const entry = appMode === 'orbit' ? './src/OrbitMain.jsx' : './src/chores/ChoresMain.jsx'
  return {
  plugins: [react(), appModeHtml(appMode)],
  resolve: {
    alias: { 'virtual:app-entry': fileURLToPath(new URL(entry, import.meta.url)) },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'localhost', '127.0.0.1',
      '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io',
      'fozy-unamortized-darci.ngrok-free.dev',
    ],
    proxy: {
      '/analyze':      { target: 'http://localhost:8000', changeOrigin: true },
      '/preview':      { target: 'http://localhost:8000', changeOrigin: true },
      '/stats':        { target: 'http://localhost:8000', changeOrigin: true },
      '/health':       { target: 'http://localhost:8000', changeOrigin: true },
      '/test-supabase':{ target: 'http://localhost:8000', changeOrigin: true },
      '/pnl':          { target: 'http://localhost:8000', changeOrigin: true },
      '/snapshot':     { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
    }
  },
  define: {
    __API_URL__: JSON.stringify(
      process.env.NODE_ENV === 'production' ? BACKEND_URL : 'http://localhost:8000'
    )
  }
}
})
