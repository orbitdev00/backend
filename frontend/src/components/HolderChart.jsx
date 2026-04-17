import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import './HolderChart.css'

export default function HolderChart({ snapshot: s }) {
  const holders = s.top_holders || []
  const chartData = holders.slice(0, 10).map((h, i) => ({
    name: `#${i+1}`,
    pct: parseFloat(h.pct?.toFixed(2)),
    address: h.address,
    isDev: h.address === s.dev_wallet,
  }))

  const Tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="tip">
        <div>{d.address?.slice(0,8)}...{d.address?.slice(-4)}</div>
        <div style={{ color: '#4ade80', marginTop: 2 }}>{d.pct}%</div>
        {d.isDev && <div style={{ color: 'var(--red)', fontSize: 10 }}>DEV</div>}
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-title">Top Holders</div>

      <div className="holder-stats">
        <Stat label="Top 5" value={`${s.top5_concentration_pct?.toFixed(1) || 0}%`} warn={s.top5_concentration_pct > 50} />
        <Stat label="Top 10" value={`${s.top10_concentration_pct?.toFixed(1) || 0}%`} warn={s.top10_concentration_pct > 70} />
        <Stat label="Dev Holding" value={`${s.dev_holding_pct?.toFixed(2) || 0}%`} warn={s.dev_holding_pct > 10} />
        <Stat label="Bundle" value={s.bundle_detected ? `Yes (${s.bundle_confidence}%)` : 'No'} warn={s.bundle_detected} />
      </div>

      {chartData.length > 0 ? (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <XAxis dataKey="name" tick={{ fill: '#444', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#444', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <Tooltip content={<Tip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="pct" radius={[2,2,0,0]}>
                {chartData.map((e, i) => (
                  <Cell key={i} fill={e.isDev ? '#ef4444' : e.pct > 10 ? '#eab308' : '#4ade80'} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="no-data">No holder data available</div>
      )}
    </div>
  )
}

function Stat({ label, value, warn }) {
  return (
    <div className={`h-stat ${warn ? 'warn' : ''}`}>
      <span className="h-stat-label">{label}</span>
      <span className={`h-stat-val ${warn ? 'c-red' : ''}`}>{value}</span>
    </div>
  )
}
