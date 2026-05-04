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
  const ts       = data.snapshot_timestamp
    ? new Date(data.snapshot_timestamp).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' })
    : '—'

  const momentumColor = {
    DEAD:'#475569', WEAK:'#64748b', BUILDING:'#fbbf24', STRONG:'#4ade80', PARABOLIC:'#4ade80'
  }[momentum] || '#64748b'

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
          <button className="sa-copy-btn" onClick={copyLink}>
            {copied ? '✓ Copied' : '⧉ Share'}
          </button>
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
          <CircleSmall score={data.bundle_impact ?? 0} label="Bundle %" color={data.bundle_impact > 60 ? '#ef4444' : data.bundle_impact > 30 ? '#fbbf24' : '#4ade80'} />
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
