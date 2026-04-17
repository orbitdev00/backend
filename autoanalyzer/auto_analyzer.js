/**
 * KIKO Auto-Analyzer
 * Connects to PumpPortal WebSocket, receives new token events,
 * silently analyzes each one through KIKO backend, logs to Supabase.
 * 
 * Run alongside K.K. Bot or standalone:
 *   node auto_analyzer.js
 */

const WebSocket = require('ws')
// fetch is built-in in Node 18+

// ── Config ────────────────────────────────────────────────────────────────────
const KIKO_BACKEND  = process.env.KIKO_BACKEND  || 'http://localhost:8000'
const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data'
const ANALYZE_DELAY = 7_200_000  // wait 2 hours — coins need time to show rug behavior
const MAX_QUEUE     = 50       // max tokens queued at once
const MIN_MC        = 5_000    // skip tokens under $5K MC
const CONCURRENCY   = 1        // only 1 at a time — don't compete with manual analyses
const ITEM_DELAY    = 10_000    // 10s between each analysis to protect Helius quota

// ── State ─────────────────────────────────────────────────────────────────────
const queue    = []
let   active   = 0
let   analyzed = 0
let   errors   = 0

// ── PumpPortal connection ─────────────────────────────────────────────────────
function connectPumpPortal() {
  const ws = new WebSocket(PUMPPORTAL_WS)

  ws.on('open', () => {
    console.log('[AutoAnalyzer] Connected to PumpPortal')
    // Subscribe to new token creations
    ws.send(JSON.stringify({ method: 'subscribeNewToken' }))
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())

      // New token event
      if (msg.mint && msg.name) {
        const mint = msg.mint
        const name = msg.name || '?'
        const mc   = msg.marketCapSol * (msg.solPrice || 150) || 0

        if (mc < MIN_MC) return  // too small, skip
        if (queue.length >= MAX_QUEUE) return  // queue full

        console.log(`[AutoAnalyzer] Queuing ${name} (${mint.slice(0,8)}...) MC: $${mc.toFixed(0)}`)

        // Delay analysis — give the coin time to get some data
        setTimeout(() => {
          queue.push({ mint, name })
          drainQueue()
        }, ANALYZE_DELAY)
      }
    } catch (e) {}
  })

  ws.on('close', () => {
    console.log('[AutoAnalyzer] PumpPortal disconnected — reconnecting in 5s...')
    setTimeout(connectPumpPortal, 5_000)
  })

  ws.on('error', (e) => {
    console.error('[AutoAnalyzer] WS error:', e.message)
  })
}

// ── Queue drain ───────────────────────────────────────────────────────────────
async function drainQueue() {
  while (queue.length > 0 && active < CONCURRENCY) {
    const { mint, name } = queue.shift()
    active++
    analyzeToken(mint, name).finally(() => {
      active--
      setTimeout(drainQueue, ITEM_DELAY)  // wait before next item
    })
    break  // only start one at a time, let finally() restart
  }
}

// ── Analyze a single token ────────────────────────────────────────────────────
async function analyzeToken(mint, name) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    const res = await fetch(`${KIKO_BACKEND}/snapshot/${mint}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      console.warn(`[AutoAnalyzer] ${name}: HTTP ${res.status}`)
      errors++
      return
    }

    const data = await res.json()
    if (data.error) {
      console.warn(`[AutoAnalyzer] ${name}: ${data.error}`)
      errors++
      return
    }

    const rug  = data.prediction?.rug_probability ?? '?'
    const mc   = data.snapshot?.market_cap_usd ?? 0
    analyzed++

    console.log(`[AutoAnalyzer] ✓ ${name.padEnd(20)} MC: $${String(Math.round(mc)).padStart(8)}  Rug: ${rug}%  [${analyzed} total]`)

  } catch (e) {
    console.warn(`[AutoAnalyzer] ${name}: ${e.message || e}`)
    errors++
  }
}

// ── Stats logger ──────────────────────────────────────────────────────────────
setInterval(() => {
  console.log(`[AutoAnalyzer] Stats — Analyzed: ${analyzed} | Errors: ${errors} | Queue: ${queue.length} | Active: ${active}`)
}, 60_000)

// ── Start ─────────────────────────────────────────────────────────────────────
console.log(`[AutoAnalyzer] Starting — backend: ${KIKO_BACKEND}`)
console.log(`[AutoAnalyzer] Will analyze tokens with MC > $${MIN_MC} after ${ANALYZE_DELAY/1000}s delay`)
connectPumpPortal()
