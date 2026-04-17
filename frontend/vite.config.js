import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const RAILWAY_URL = 'https://backend-production-a427a.up.railway.app' // ← replace after Railway deploys

export default defineConfig({
  plugins: [react()],
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
      process.env.NODE_ENV === 'production' ? RAILWAY_URL : 'http://localhost:8000'
    )
  }
})
