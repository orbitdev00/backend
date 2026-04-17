import './MetricsPanel.css'

const fmtUSD = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n/1_000).toFixed(1)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(6)}`
}

const fmtAge = (s) => {
  if (!s) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`
}

const fmtNum = (n) => {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n/1_000).toFixed(1)}K`
  return `${n}`
}

export default function MetricsPanel({ snapshot: s }) {
  return (
    <div className="panel">
      <div className="panel-title">Market Data</div>

      <div className="metrics-grid2">
        <Metric label="Market Cap" value={fmtUSD(s.market_cap_usd)} big />
        <Metric label="Liquidity"  value={fmtUSD(s.liquidity_usd)} />
        <Metric label="Price"      value={fmtUSD(s.price_usd)} />
        <Metric label="Age"        value={fmtAge(s.age_seconds)} />
      </div>

      <div className="divider" />
      <div className="section-label">Volume</div>
      <div className="metrics-grid3">
        <Metric label="5m"  value={fmtUSD(s.volume_5m)} />
        <Metric label="1h"  value={fmtUSD(s.volume_1h)} />
        <Metric label="24h" value={fmtUSD(s.volume_24h)} />
      </div>

      {/* Migration countdown — only for bonding curve coins */}
      {s.migration_pct_complete !== undefined && s.migration_pct_complete < 100 && (
        <>
          <div className="divider" />
          <div className="section-label">Migration Progress</div>
          <div className="migration-bar-wrap">
            <div className="migration-bar">
              <div className="migration-fill" style={{width: `${s.migration_pct_complete}%`}} />
            </div>
            <div className="migration-meta">
              <span className="migration-pct">{s.migration_pct_complete}%</span>
              <span className="migration-eta">ETA {s.migration_eta_label || '—'}</span>
            </div>
          </div>
        </>
      )}

      {s.pct_from_24h_peak > 10 && (
        <>
          <div className="divider" />
          <div className="peak-warning">↓ {s.pct_from_24h_peak?.toFixed(0)}% from 24h peak</div>
        </>
      )}

      {/* Dev wallet history */}
      {s.dev_history_summary && s.dev_history_summary !== 'No history found' && (
        <>
          <div className="divider" />
          <div className="section-label">Dev History</div>
          <div className={`dev-history-bar ${s.dev_is_serial_rugger ? 'dev-danger' : s.dev_prev_rugs > 0 ? 'dev-warn' : 'dev-clean'}`}>
            <span className="dev-history-icon">{s.dev_is_serial_rugger ? '⚠' : s.dev_prev_rugs > 0 ? '◦' : '▪'}</span>
            <span className="dev-history-text">{s.dev_history_summary}</span>
          </div>
        </>
      )}

      <div className="divider" />
      <div className="section-label">Security</div>
      <div className="metrics-grid2">
        <Metric label="Dev Holding"   value={`${s.dev_holding_pct?.toFixed(2)||0}%`}     className={s.dev_holding_pct > 10 ? 'c-red' : s.dev_holding_pct > 5 ? 'c-yellow' : 'c-green'} />
        <Metric label="Top 10"        value={`${s.top10_concentration_pct?.toFixed(1)||0}%`} className={s.top10_concentration_pct > 70 ? 'c-red' : s.top10_concentration_pct > 40 ? 'c-yellow' : 'c-green'} />
        <Metric label="Bundle"        value={s.bundle_detected ? `Yes (${s.bundle_confidence}%)` : 'None'} className={s.bundle_detected ? 'c-red' : 'c-green'} />
        <Metric label="Dev Sold"      value={`${s.dev_sell_pct?.toFixed(0)||0}%`} className={s.dev_sell_pct > 50 ? 'c-red' : s.dev_sell_pct > 20 ? 'c-yellow' : 'c-green'} />
        <Metric label="Fresh Wallets" value={`${s.fresh_wallet_count} (${s.fresh_wallet_pct}%)`} className={s.fresh_wallet_pct > 60 ? 'c-red' : s.fresh_wallet_pct > 30 ? 'c-yellow' : 'c-green'} />
        <Metric label="Snipers"       value={fmtNum(s.sniper_count)} className={s.sniper_count > 5 ? 'c-red' : s.sniper_count > 2 ? 'c-yellow' : 'c-green'} />
        <Metric label="Honeypot"      value={s.is_honeypot ? 'YES' : 'No'} className={s.is_honeypot ? 'c-red' : 'c-green'} />
        <Metric label="Mint Auth"     value={s.can_mint ? 'YES' : 'No'} className={s.can_mint ? 'c-red' : 'c-green'} />
        <Metric label="Freeze Auth"   value={s.can_freeze ? 'YES' : 'No'} className={s.can_freeze ? 'c-red' : 'c-green'} />
        <Metric label="Wallet Farm" value={
          s.uniform_holders_detected ? 'Uniform dist.' :
          s.shared_funder_detected && s.shared_funder_wallets > 0 ? `Yes (${s.shared_funder_wallets} wallets)` :
          s.shared_funder_detected ? 'Detected' : 'None'
        } className={s.shared_funder_detected || s.uniform_holders_detected ? 'c-red' : 'c-green'} />
      </div>

      {/* GoPlus critical flags */}
      {(s.goplus_flags || []).length > 0 && (
        <>
          <div className="divider" />
          {(s.goplus_flags || []).map((f, i) => (
            <div key={i} className="alert-box alert-red" style={{marginBottom: 4}}>
              <span className="alert-icon">🚨</span>
              <div className="alert-title">{f}</div>
            </div>
          ))}
        </>
      )}

      {/* Fake chart warning */}
      {s.fake_chart_score > 30 && (
        <>
          <div className="divider" />
          <div className={`alert-box ${s.fake_chart_score > 60 ? 'alert-red' : 'alert-yellow'}`}>
            <span className="alert-icon">{s.fake_chart_score > 60 ? '🚨' : '⚠'}</span>
            <div>
              <div className="alert-title">
                {s.fake_chart_score > 60 ? 'Fake Chart Detected' : 'Suspicious Chart Activity'}
                <span className="alert-score"> — {s.fake_chart_score}/100</span>
              </div>
              {(s.fake_chart_flags || []).map((f, i) => (
                <div key={i} className="alert-sub">· {f}</div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Uniform holder alert */}
      {s.uniform_holders_detected && (
        <>
          <div className="divider" />
          <div className="alert-box alert-red">
            <span className="alert-icon">⚠</span>
            <div>
              <div className="alert-title">Uniform Holder Distribution</div>
              <div className="alert-sub">All top holders own nearly identical amounts — statistically impossible in organic trading. Coordinated wallet farm.</div>
            </div>
          </div>
        </>
      )}

      {/* Wallet farm alert */}
      {s.shared_funder_detected && (
        <>
          <div className="divider" />
          <div className="alert-box alert-red">
            <span className="alert-icon">⚠</span>
            <div>
              <div className="alert-title">Wallet Farm Detected</div>
              <div className="alert-sub">{s.shared_funder_wallets} buyers share same funding source ({s.shared_funder_pct}% of early buyers)</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Metric({ label, value, big, className }) {
  return (
    <div className={`metric ${big?'metric-big':''}`}>
      <span className="metric-label">{label}</span>
      <span className={`metric-value ${className||''}`}>{value||'—'}</span>
    </div>
  )
}
