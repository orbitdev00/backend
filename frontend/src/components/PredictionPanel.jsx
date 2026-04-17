import React from 'react'
import './PredictionPanel.css'
import KikoLoader from './KikoLoader'

const fmtUSD = (n) => {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n/1_000).toFixed(1)}K`
  return `$${n}`
}

const momentumColor = (m) => ({
  dead: 'var(--text-muted)', weak: 'var(--text-dim)',
  building: 'var(--yellow)', strong: '#4ade80', parabolic: '#4ade80'
})[m] || 'var(--text-dim)'

const purityScore = (risk) => Math.max(0, 100 - (risk || 0))
const purityColor = (p) => p >= 70 ? '#4ade80' : p >= 40 ? 'var(--yellow)' : 'var(--red)'
const rugColor    = (r) => r >= 70 ? 'var(--red)'   : r >= 40 ? 'var(--yellow)' : '#4ade80'
const bundleColor = (b) => b >= 60 ? 'var(--red)'   : b >= 30 ? 'var(--yellow)' : '#4ade80'

const isRugged = (p, s) => {
  const collapsed = s?.mc_collapse_detected ?? false
  const pctDown   = s?.pct_from_24h_peak ?? 0
  const change24h = s?.price_change_24h ?? 0
  const change1h  = s?.price_change_1h ?? 0
  const vol1h     = s?.volume_1h ?? 0
  const vol24h    = s?.volume_24h ?? 0
  const mc        = s?.market_cap_usd ?? 0
  const liquidity = s?.liquidity_usd ?? 0
  return collapsed
    || (pctDown >= 60 && vol1h < 2000)
    || change24h < -70
    || change1h < -50
    || (mc > 0 && mc < 3000 && vol24h < 5000 && liquidity < 500)
}

const isFake = (p, s) => {
  if (isRugged(p, s)) return false
  const rugProb  = p?.rug_probability ?? 0
  const uniform  = s?.uniform_holders_detected ?? false
  const farm     = s?.shared_funder_detected ?? false
  const honeypot = s?.is_honeypot ?? false
  const change1h = s?.price_change_1h ?? 0
  const vol1h    = s?.volume_1h ?? 0
  if (honeypot) return true
  if (rugProb >= 85 && (uniform || farm)) return true
  if (rugProb >= 95 && change1h < 5 && vol1h < 10000) return true
  return false
}

function SpecialCircle({ text }) {
  const r = 44, cx = 52, cy = 52
  const circ = 2 * Math.PI * r
  return (
    <div className="circle-large-wrap">
      <svg width="116" height="116" viewBox="0 0 104 104">
        <circle cx={cx} cy={cy} r={r} fill="var(--red-bg)" stroke="var(--red)" strokeWidth="8" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--red)" strokeWidth="8"
          strokeDasharray={`${circ} 0`} transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cy + 5} textAnchor="middle" fill="var(--red)"
          fontSize={text === 'FAKE' ? '16' : '12'} fontWeight="700" fontFamily="Inter" letterSpacing="2">
          {text}
        </text>
      </svg>
      <span className="circle-label-large" style={{color:'transparent', userSelect:'none'}}>—</span>
    </div>
  )
}

function CircleLarge({ score, label, color }) {
  const r = 44, cx = 52, cy = 52
  const circ = 2 * Math.PI * r
  const filled = ((score || 0) / 100) * circ
  return (
    <div className="circle-large-wrap">
      <svg width="104" height="104" viewBox="0 0 104 104">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border2)" strokeWidth="7" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 0.5s ease' }} />
        <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize="22" fontWeight="700" fontFamily="Inter">{score}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="Inter" letterSpacing="1">/100</text>
      </svg>
      <span className="circle-label-large">{label}</span>
    </div>
  )
}

function CircleSmall({ score, label, color }) {
  const r = 26, cx = 32, cy = 32
  const circ = 2 * Math.PI * r
  const filled = ((score || 0) / 100) * circ
  return (
    <div className="circle-small-wrap">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border2)" strokeWidth="5" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cx + 5} textAnchor="middle" fill={color} fontSize="13" fontWeight="600" fontFamily="Inter">{score}</text>
      </svg>
      <span className="circle-label-small">{label}</span>
    </div>
  )
}

function ProbBar({ label, value }) {
  const color = value >= 50 ? '#4ade80' : value >= 25 ? 'var(--yellow)' : 'var(--red)'
  return (
    <div className="prob-row">
      <span className="prob-label">{label}</span>
      <div className="prob-track">
        <div className="prob-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="prob-val" style={{ color }}>{value}%</span>
    </div>
  )
}

export default function PredictionPanel({ prediction: p, snapshot: s }) {
  const [imploding, setImploding]   = React.useState(false)
  const [showContent, setShowContent] = React.useState(false)

  React.useEffect(() => {
    if (!p) {
      setShowContent(false)
      setImploding(false)
      return
    }
    if (p && s) {
      setImploding(true)
      const t = setTimeout(() => { setImploding(false); setShowContent(true) }, 650)
      return () => clearTimeout(t)
    }
  }, [p?.rug_probability, p?.reasoning, s?.mint])

  if (!showContent && !imploding) {
    return (
      <div className="panel">
        <KikoLoader visible={true} />
      </div>
    )
  }

  if (imploding) {
    return (
      <div className="panel">
        <KikoLoader visible={false} />
      </div>
    )
  }

  if (!p || !s) return null

  const bands      = p.probability_bands || {}
  const purity     = purityScore(p.risk_score)
  const rugProb    = p.rug_probability ?? 0
  const bundleConf = s?.bundle_confidence ?? 0
  const rugged     = isRugged(p, s)
  const fake       = isFake(p, s)

  const specialLayout = (text) => (
    <div className="panel">
      <div className="panel-title">Orbit Analysis</div>
      <div className="circles-row">
        <CircleSmall score={purity}     label="Purity"   color={purityColor(purity)} />
        <SpecialCircle text={text} />
        <CircleSmall score={bundleConf} label="Bundle %" color={bundleColor(bundleConf)} />
      </div>
      <div className="divider" />
      <div className="section-label">Analysis</div>
      <div className="reasoning">{p.reasoning || '—'}</div>
    </div>
  )

  if (fake && !rugged) return specialLayout('FAKE')
  if (rugged)          return specialLayout('RUGGED')

  return (
    <div className="panel">
      <div className="panel-title">Orbit Analysis</div>

      <div className="circles-row">
        <CircleSmall score={rugProb}    label="Rug %"    color={rugColor(rugProb)} />
        <CircleLarge score={purity}     label="Purity"   color={purityColor(purity)} />
        <CircleSmall score={bundleConf} label="Bundle %" color={bundleColor(bundleConf)} />
      </div>

      {/* Social media indicators */}
      <div className="socials-indicator-row">
        <div className={`social-dot ${s?.has_twitter ? 'social-active' : 'social-inactive'}`} title="Twitter/X">𝕏</div>
        <div className={`social-dot ${s?.has_telegram ? 'social-active' : 'social-inactive'}`} title="Telegram">✈</div>
        <div className={`social-dot ${s?.has_website ? 'social-active' : 'social-inactive'}`} title="Website">🌐</div>
        <div className={`social-dot ${s?.dex_banner ? 'social-active' : 'social-inactive'}`} title="DexScreener Banner">📊</div>
      </div>

      <div className="momentum-row">
        <div className="momentum-box">
          <span className="score-label">Momentum</span>
          <span className="momentum-val" style={{ color: momentumColor(p.momentum) }}>
            {(p.momentum || '—').toUpperCase()}
          </span>
        </div>
        <div className="momentum-box">
          <span className="score-label">Stage</span>
          <span className="stage-val">{(p.stage || '—').replace(/_/g,' ')}</span>
        </div>
      </div>

      <div className="divider" />

      <div className="section-label">Probability of Reaching</div>
      <div className="prob-bands">
        {[['$100K','100k'],['$250K','250k'],['$500K','500k'],['$1M','1m'],['$5M','5m'],['$10M','10m']].map(([label,key]) => (
          <ProbBar key={key} label={label} value={bands[key] || 0} />
        ))}
      </div>

      <div className="peak-section">
        <span className="peak-label">Estimated Peak</span>
        <span className="peak-value">{fmtUSD(p.estimated_peak_mc)}</span>
        <span className="peak-range">{fmtUSD(p.peak_mc_range?.low)} – {fmtUSD(p.peak_mc_range?.high)}</span>
        <span className="current-mc">now: {fmtUSD(s?.market_cap_usd)}</span>
      </div>

      <div className="divider" />
      <div className="section-label">Analysis</div>
      <div className="reasoning">{p.reasoning || '—'}</div>
    </div>
  )
}
