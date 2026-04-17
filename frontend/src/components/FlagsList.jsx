import './FlagsList.css'

// Only remove truly irrelevant social/vanity flags
const REMOVE = ['no social', 'no twitter', 'no telegram', 'no website', 'no community']
const shouldRemove = (f) => REMOVE.some(k => f.toLowerCase().includes(k))

export default function FlagsList({ prediction: p, snapshot: s }) {
  if (!p) return null
  // Inject hard on-chain flags that override AI
  const injected = []
  if (s?.uniform_holders_detected)
    injected.push({ type: 'warn', text: `Uniform holder distribution — CV ${s.uniform_holder_variance?.toFixed(3)} — coordinated wallet farm` })
  if (s?.shared_funder_detected && s?.shared_funder_wallets > 0)
    injected.push({ type: 'warn', text: `${s.shared_funder_wallets} buyers share same funding source (${s.shared_funder_pct}% of early buyers)` })
  if (s?.bundle_detected && s?.bundle_confidence > 40)
    injected.push({ type: 'warn', text: `Bundle detected — ${s.bundle_confidence}% confidence, ${s.bundled_wallet_count} wallets` })
  if (s?.is_honeypot)
    injected.push({ type: 'warn', text: 'HONEYPOT — token cannot be sold' })
  if (s?.can_mint)
    injected.push({ type: 'warn', text: 'Mint authority active — supply can be inflated' })
  if (s?.can_freeze)
    injected.push({ type: 'warn', text: 'Freeze authority active — wallets can be frozen' })
  if (s?.dev_is_serial_rugger)
    injected.push({ type: 'warn', text: s.dev_history_summary || 'Dev is a serial rugger' })
  if (s?.fake_chart_score > 40)
    injected.push({ type: 'warn', text: `Fake chart activity — score ${s.fake_chart_score}/100` })
  if (s?.mc_collapse_detected)
    injected.push({ type: 'warn', text: 'Market cap collapse detected — coin may be rugged' })

  const aiWarns  = (p.flags         || []).filter(f => !shouldRemove(f))
  const aiBulls  = (p.bullish_flags  || []).filter(f => !shouldRemove(f))

  const warns = [
    ...injected.filter(f => f.type === 'warn').map(f => f.text),
    ...aiWarns,
  ]

  // Dedup
  const seen = new Set()
  const deduped = warns.filter(f => {
    const key = f.toLowerCase().slice(0, 40)
    if (seen.has(key)) return false
    seen.add(key); return true
  })

  return (
    <div className="panel">
      <div className="panel-title">Signal Flags</div>

      <div className={`bundle-bar ${p.bundle_detected ? 'bundle-warn' : 'bundle-ok'}`}>
        <span className="bundle-icon">{p.bundle_detected ? '⚠' : '✓'}</span>
        <div>
          <div className="bundle-status">{p.bundle_detected ? `Bundle Detected (${p.bundle_confidence}%)` : 'No Bundle'}</div>
          {p.bundle_detected && p.bundle_impact && (
            <div className="bundle-sub">Impact: {p.bundle_impact.toUpperCase()}</div>
          )}
        </div>
      </div>

      <div className="divider" />

      {deduped.length === 0 && aiBulls.length === 0 ? (
        <div className="no-flags">No flags detected</div>
      ) : (
        <div className="flags-list">
          {deduped.length > 0 && (
            <>
              <div className="flag-group-label c-red">⚠ Warnings</div>
              {deduped.map((f, i) => <Flag key={i} text={f} type="warn" />)}
            </>
          )}
          {aiBulls.length > 0 && (
            <>
              <div className="flag-group-label c-green" style={{marginTop: deduped.length ? 12 : 0}}>✓ Bullish</div>
              {aiBulls.map((f, i) => <Flag key={i} text={f} type="bull" />)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Flag({ text, type }) {
  return (
    <div className={`flag flag-${type}`}>
      <span className="flag-icon">{type === 'warn' ? '⚠' : '✓'}</span>
      <span>{text}</span>
    </div>
  )
}

function SummaryBar({ label, value, invert }) {
  const v = value || 0
  const color = invert
    ? v >= 70 ? 'var(--red)' : v >= 40 ? 'var(--yellow)' : 'var(--green)'
    : v >= 50 ? 'var(--green)' : v >= 25 ? 'var(--yellow)' : 'var(--red)'
  return (
    <div className="s-bar-row">
      <span className="s-bar-label">{label}</span>
      <div className="s-bar-track"><div className="s-bar-fill" style={{width:`${v}%`,background:color}} /></div>
      <span className="s-bar-val" style={{color}}>{v}%</span>
    </div>
  )
}
