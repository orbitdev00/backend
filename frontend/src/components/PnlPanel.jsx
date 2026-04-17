export default function PnlPanel({ prediction: p }) {
  if (!p) return null
  const s = p.pnl_scenarios || {}

  const row = (label, value, color) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
      <span style={{ fontSize:10, letterSpacing:'1.5px', color:'var(--text-muted)', textTransform:'uppercase' }}>{label}</span>
      <span style={{ fontSize:16, fontWeight:700, fontFamily:'var(--mono)', color }}>
        {value != null && value > 0 ? `${value}x` : '—'}
      </span>
    </div>
  )

  return (
    <div className="panel">
      {row('Conservative', s.conservative, '#4ade80')}
      {row('Moderate',     s.moderate,     '#f97316')}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0' }}>
        <span style={{ fontSize:10, letterSpacing:'1.5px', color:'var(--text-muted)', textTransform:'uppercase' }}>Aggressive</span>
        <span style={{ fontSize:16, fontWeight:700, fontFamily:'var(--mono)', color:'var(--red)' }}>
          {s.aggressive != null && s.aggressive > 0 ? `${s.aggressive}x` : '—'}
        </span>
      </div>
    </div>
  )
}
