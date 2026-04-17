import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
      '/pnl':        { target: 'http://localhost:8000', changeOrigin: true },
      '/snapshot':   { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
    }
  }
})
