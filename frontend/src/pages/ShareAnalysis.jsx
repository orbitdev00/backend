// ShareAnalysis.jsx — Public shareable analysis card
// Route: /share/:id
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import StarField from '../components/StarField'
import orbitPfp from '../orbitPfp.js'
import './ShareAnalysis.css'

const fmtUSD = (n) => {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n/1_000).toFixed(1)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(6)}`
}

const purityScore = (risk) => Math.max(0, 100 - (risk || 0))
const purityColor = (p) => p >= 70 ? '#4ade80' : p >= 40 ? '#fbbf24' : '#ef4444'
const rugColor    = (r) => r >= 70 ? '#ef4444' : r >= 40 ? '#fbbf24' : '#4ade80'

function CircleSmall({ score, label, color }) {
  const r = 26, cx = 32, cy = 32
  const circ = 2 * Math.PI * r
  const filled = ((score || 0) / 100) * circ
  return (
    <div className="sa-circle-wrap">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e1e1e" strokeWidth="5" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cx + 5} textAnchor="middle" fill={color} fontSize="13" fontWeight="600" fontFamily="Inter">{score}</text>
      </svg>
      <span className="sa-circle-label">{label}</span>
    </div>
  )
}

function ProbBar({ label, value }) {
  const color = value >= 50 ? '#4ade80' : value >= 25 ? '#fbbf24' : '#ef4444'
  return (
    <div className="sa-prob-row">
      <span className="sa-prob-label">{label}</span>
      <div className="sa-prob-track">
        <div className="sa-prob-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="sa-prob-val" style={{ color }}>{value}%</span>
    </div>
  )
}

export default function ShareAnalysis() {
  const { id } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: row, error } = await supabase
        .from('predictions')
        .select('*')
        .eq('id', id)
        .single()
      if (error || !row) { setNotFound(true); setLoading(false); return }
      setData(row)
      setLoading(false)
    }
    load()
  }, [id])

  function copyLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return (
    <div className="sa-screen">
      <StarField />
      <div className="sa-loading">Loading analysis...</div>
    </div>
  )

  if (notFound) return (
    <div className="sa-screen">
      <StarField />
      <div className="sa-card">
        <div className="sa-not-found">Analysis not found or has been removed.</div>
        <button className="sa-btn-primary" onClick={() => nav('/')}>Go to Orbit</button>
      </div>
    </div>
  )

  const purity  = purityScore(data.risk_score)
  const rugProb = data.rug_probability ?? 0
  const bands   = {
    '100k': data.prob_100k, '250k': data.prob_250k,
    '500k': data.prob_500k, '1m': data.prob_1m,
    '5m': data.prob_5m, '10m': data.prob_10m,
  }
  const momentum = (data.momentum || '—').toUpperCase()
  const stage    = (data.stage || '—').replace(/_/g, ' ')
  const tsRaw = data.snapshot_timestamp ? new Date(data.snapshot_timestamp) : null
  const ts = tsRaw && !isNaN(tsRaw.getTime()) && tsRaw.getFullYear() > 1971
    ? tsRaw.toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' })
    : '—'

  const momentumColor = {
    DEAD:'#475569', WEAK:'#64748b', BUILDING:'#fbbf24', STRONG:'#4ade80', PARABOLIC:'#4ade80'
  }[momentum] || '#64748b'


  function downloadImage() {
    // 1200x630 — standard OG/Twitter image size
    const W = 1200, H = 630
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    const PAD = 52

    // ── helpers ──────────────────────────────────────────
    function drawRoundRect(x, y, w, h, r, fill, stroke) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + w - r, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + r)
      ctx.lineTo(x + w, y + h - r)
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
      ctx.lineTo(x + r, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - r)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
      if (fill) { ctx.fillStyle = fill; ctx.fill() }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke() }
    }

    function drawCircle(cx, cy, r, pct, trackColor, fillColor) {
      // Track
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = trackColor
      ctx.lineWidth = 9
      ctx.stroke()
      // Fill arc
      if (pct > 0) {
        ctx.beginPath()
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * Math.PI * 2)
        ctx.strokeStyle = fillColor
        ctx.lineWidth = 9
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.lineCap = 'butt'
      }
    }

    function drawBar(x, y, w, h, pct, trackColor, fillColor) {
      drawRoundRect(x, y, w, h, h / 2, trackColor, null)
      if (pct > 0) {
        const fw = Math.max(h, w * pct / 100)
        drawRoundRect(x, y, fw, h, h / 2, fillColor, null)
      }
    }

    function scoreColor(val, threshHigh, threshMid, highBad) {
      // highBad=true means high value = red (rug%), false means high = green (purity)
      if (highBad) return val >= threshHigh ? '#ef4444' : val >= threshMid ? '#fbbf24' : '#4ade80'
      return val >= threshHigh ? '#4ade80' : val >= threshMid ? '#fbbf24' : '#ef4444'
    }

    // ── background ───────────────────────────────────────
    // Deep space gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#060608')
    bg.addColorStop(1, '#0a0a0f')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Subtle star field
    const starSeed = [...Array(80)].map((_, i) => ({
      x: ((i * 137.508 + 42) % 1) * W,
      y: ((i * 97.312 + 13) % 1) * H,
      r: (i % 3 === 0 ? 1.5 : 0.8),
      o: 0.15 + (i % 5) * 0.08,
    }))
    starSeed.forEach(s => {
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${s.o})`; ctx.fill()
    })

    // Purple glow top-right
    const glow = ctx.createRadialGradient(W * 0.85, H * 0.15, 0, W * 0.85, H * 0.15, 380)
    glow.addColorStop(0, 'rgba(120, 80, 220, 0.12)')
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)

    // Card
    drawRoundRect(PAD, PAD, W - PAD * 2, H - PAD * 2, 16, '#0d0d0dcc', '#1e1e1e')

    // ── header strip ─────────────────────────────────────
    const HH = 56
    drawRoundRect(PAD, PAD, W - PAD * 2, HH, 0, '#0808088a', null)
    ctx.strokeStyle = '#161616'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD, PAD + HH); ctx.lineTo(W - PAD, PAD + HH); ctx.stroke()

    // ORBIT brand
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 14px monospace'
    ctx.textAlign = 'left'
    ctx.fillText('ORBIT', PAD + 24, PAD + 36)

    // Powered tag
    ctx.fillStyle = '#a78bfa'
    ctx.font = '700 10px monospace'
    ctx.fillText('AI ANALYSIS', PAD + 88, PAD + 36)

    // orbit-app.xyz right
    ctx.fillStyle = '#2a2a2a'
    ctx.font = '11px monospace'
    ctx.textAlign = 'right'
    ctx.fillText('orbit-app.xyz', W - PAD - 24, PAD + 36)
    ctx.textAlign = 'left'

    // ── coin identity ────────────────────────────────────
    const CY = PAD + HH + 44
    ctx.fillStyle = '#f1f5f9'
    ctx.font = '800 42px sans-serif'
    ctx.fillText(data.name || '—', PAD + 24, CY)

    // Symbol pill
    const symX = PAD + 24
    const nameW = ctx.measureText(data.name || '—').width + 12
    ctx.fillStyle = '#1e1e1e'
    drawRoundRect(symX + nameW, CY - 22, ctx.measureText(data.symbol || '').width + 20, 26, 4, '#1a1a1a', '#2a2a2a')
    ctx.fillStyle = '#64748b'
    ctx.font = '700 13px monospace'
    ctx.fillText(data.symbol || '', symX + nameW + 10, CY - 4)

    // MC at analysis
    ctx.fillStyle = '#334155'
    ctx.font = '13px monospace'
    ctx.fillText(`MC at analysis: ${fmtUSD(data.market_cap_at_analysis)}`, PAD + 24, CY + 26)

    // ── divider ───────────────────────────────────────────
    ctx.strokeStyle = '#161616'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD + 24, CY + 46); ctx.lineTo(W - PAD - 24, CY + 46); ctx.stroke()

    // ── LEFT COLUMN — scores ─────────────────────────────
    const COL1X = PAD + 24
    const COL2X = W / 2 + 20
    const ROW2Y = CY + 66

    // Section label
    ctx.fillStyle = '#334155'
    ctx.font = '700 9px monospace'
    ctx.fillText('SCORES', COL1X, ROW2Y + 4)

    const scores = [
      { label: 'Rug %',    val: Math.round(rugProb), color: scoreColor(rugProb, 70, 40, true) },
      { label: 'Purity',   val: Math.round(purity),  color: scoreColor(purity, 70, 40, false) },
      { label: 'Bundle %', val: Math.round(data.bundle_confidence ?? 0), color: scoreColor(data.bundle_confidence ?? 0, 60, 30, true) },
    ]

    const CR = 38
    scores.forEach((s, i) => {
      const cx = COL1X + 50 + i * 130
      const cy = ROW2Y + 70
      drawCircle(cx, cy, CR, s.val, '#1e1e1e', s.color)
      ctx.fillStyle = s.color
      ctx.font = '700 20px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(s.val, cx, cy + 7)
      ctx.fillStyle = '#475569'
      ctx.font = '10px monospace'
      ctx.fillText(s.label, cx, cy + CR + 18)
    })
    ctx.textAlign = 'left'

    // Momentum + Stage tags
    const TAG_Y = ROW2Y + 160
    const mColor = { DEAD:'#475569', WEAK:'#64748b', BUILDING:'#fbbf24', STRONG:'#4ade80', PARABOLIC:'#4ade80' }[momentum] || '#64748b'
    drawRoundRect(COL1X, TAG_Y, 160, 40, 6, '#111', '#1e1e1e')
    ctx.fillStyle = '#475569'; ctx.font = '9px monospace'
    ctx.fillText('MOMENTUM', COL1X + 12, TAG_Y + 14)
    ctx.fillStyle = mColor; ctx.font = '700 13px sans-serif'
    ctx.fillText(momentum, COL1X + 12, TAG_Y + 30)

    drawRoundRect(COL1X + 172, TAG_Y, 160, 40, 6, '#111', '#1e1e1e')
    ctx.fillStyle = '#475569'; ctx.font = '9px monospace'
    ctx.fillText('STAGE', COL1X + 184, TAG_Y + 14)
    ctx.fillStyle = '#94a3b8'; ctx.font = '700 13px sans-serif'
    ctx.fillText(stage.toUpperCase(), COL1X + 184, TAG_Y + 30)

    // ── divider vertical ─────────────────────────────────
    ctx.strokeStyle = '#161616'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(W / 2 + 4, CY + 56); ctx.lineTo(W / 2 + 4, H - PAD - 60); ctx.stroke()

    // ── RIGHT COLUMN — peak + prob bars ──────────────────
    // Estimated peak
    ctx.fillStyle = '#334155'; ctx.font = '700 9px monospace'
    ctx.fillText('ESTIMATED PEAK MC', COL2X, ROW2Y + 4)

    ctx.fillStyle = '#a78bfa'
    ctx.font = '800 44px sans-serif'
    ctx.fillText(fmtUSD(data.estimated_peak_mc), COL2X, ROW2Y + 52)

    ctx.fillStyle = '#334155'; ctx.font = '12px monospace'
    ctx.fillText(`${fmtUSD(data.peak_mc_low)} – ${fmtUSD(data.peak_mc_high)}`, COL2X, ROW2Y + 74)

    // Prob bars
    ctx.strokeStyle = '#161616'
    ctx.beginPath(); ctx.moveTo(COL2X, ROW2Y + 90); ctx.lineTo(W - PAD - 24, ROW2Y + 90); ctx.stroke()

    ctx.fillStyle = '#334155'; ctx.font = '700 9px monospace'
    ctx.fillText('PROBABILITY OF REACHING', COL2X, ROW2Y + 108)

    const probData = [
      ['$100K', data.prob_100k || 0],
      ['$250K', data.prob_250k || 0],
      ['$500K', data.prob_500k || 0],
      ['$1M',   data.prob_1m   || 0],
      ['$5M',   data.prob_5m   || 0],
    ]
    const BAR_W = W - PAD - 24 - COL2X - 60
    probData.forEach(([label, val], i) => {
      const by = ROW2Y + 124 + i * 36
      ctx.fillStyle = '#475569'; ctx.font = '11px monospace'
      ctx.fillText(label, COL2X, by + 4)
      const barX = COL2X + 52
      const col = val >= 50 ? '#4ade80' : val >= 25 ? '#fbbf24' : '#ef4444'
      drawBar(barX, by - 6, BAR_W, 10, val, '#1a1a1a', col)
      ctx.fillStyle = col; ctx.font = '700 10px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`${val}%`, W - PAD - 24, by + 4)
      ctx.textAlign = 'left'
    })

    // ── footer ────────────────────────────────────────────
    ctx.strokeStyle = '#161616'
    ctx.beginPath(); ctx.moveTo(PAD, H - PAD - 36); ctx.lineTo(W - PAD, H - PAD - 36); ctx.stroke()

    // Fix timestamp — parse correctly
    let tsDisplay = '—'
    if (data.snapshot_timestamp) {
      const parsed = new Date(data.snapshot_timestamp)
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1971) {
        tsDisplay = parsed.toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' })
      }
    }

    ctx.fillStyle = '#2a2a2a'; ctx.font = '11px monospace'
    ctx.fillText(`Analyzed ${tsDisplay}`, PAD + 24, H - PAD - 14)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#1e1e1e'
    ctx.fillText(`orbit-app.xyz/share/${id}`, W - PAD - 24, H - PAD - 14)
    ctx.textAlign = 'left'

    // Download
    const link = document.createElement('a')
    link.download = `orbit-${(data.symbol || data.mint?.slice(0,8) || 'analysis').toLowerCase()}.png`
    link.href = canvas.toDataURL('image/png', 1.0)
    link.click()
  }

  return (
    <div className="sa-screen">
      <StarField />
      <div className="sa-card">

        {/* Header */}
        <div className="sa-header">
          <div className="sa-brand" onClick={() => nav('/')}>
            <img src={orbitPfp} className="sa-logo" alt="" />
            <span className="sa-brand-name">ORBIT</span>
          </div>
          <div style={{display:'flex', gap:8}}>
            <button className="sa-copy-btn" onClick={copyLink}>
              {copied ? '✓ Copied' : '⧉ Share'}
            </button>
            <button className="sa-copy-btn" onClick={downloadImage} title="Download as image">
              ↓ Image
            </button>
          </div>
        </div>

        {/* Coin identity */}
        <div className="sa-coin-row">
          <div className="sa-coin-name">{data.name || '—'}</div>
          <div className="sa-coin-symbol">{data.symbol || '—'}</div>
          <div className="sa-coin-mc">{fmtUSD(data.market_cap_at_analysis)} at analysis</div>
        </div>

        <div className="sa-mint">{data.mint}</div>

        {/* Scores */}
        <div className="sa-circles">
          <CircleSmall score={rugProb} label="Rug %" color={rugColor(rugProb)} />
          <CircleSmall score={purity}  label="Purity" color={purityColor(purity)} />
          <CircleSmall score={Math.round(data.bundle_confidence ?? 0)} label="Bundle %" color={data.bundle_confidence > 60 ? '#ef4444' : data.bundle_confidence > 30 ? '#fbbf24' : '#4ade80'} />
        </div>

        {/* Momentum + Stage */}
        <div className="sa-tags">
          <div className="sa-tag">
            <span className="sa-tag-label">Momentum</span>
            <span className="sa-tag-val" style={{ color: momentumColor }}>{momentum}</span>
          </div>
          <div className="sa-tag">
            <span className="sa-tag-label">Stage</span>
            <span className="sa-tag-val">{stage}</span>
          </div>
        </div>

        <div className="sa-divider" />

        {/* Peak prediction */}
        <div className="sa-peak-section">
          <div className="sa-peak-label">Estimated Peak</div>
          <div className="sa-peak-value">{fmtUSD(data.estimated_peak_mc)}</div>
          <div className="sa-peak-range">
            {fmtUSD(data.peak_mc_low)} – {fmtUSD(data.peak_mc_high)}
          </div>
        </div>

        <div className="sa-divider" />

        {/* Probability bands */}
        <div className="sa-section-label">Probability of Reaching</div>
        <div className="sa-probs">
          {[['$100K','100k'],['$250K','250k'],['$500K','500k'],['$1M','1m'],['$5M','5m'],['$10M','10m']].map(([label, key]) => (
            <ProbBar key={key} label={label} value={bands[key] || 0} />
          ))}
        </div>

        <div className="sa-divider" />

        {/* Reasoning */}
        <div className="sa-section-label">Analysis</div>
        <div className="sa-reasoning">{data.reasoning || '—'}</div>

        <div className="sa-divider" />

        {/* Footer */}
        <div className="sa-footer">
          <div className="sa-timestamp">Analyzed {ts}</div>
          <button className="sa-btn-primary" onClick={() => nav('/')}>
            Analyze your own →
          </button>
        </div>

      </div>
    </div>
  )
}
