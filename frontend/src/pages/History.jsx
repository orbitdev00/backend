import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import StarField from '../components/StarField'
import './History.css'

function fmtMC(n) {
  if (!n) return '—'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n/1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
}

export default function History() {
  const nav = useNavigate()
  const [rows, setRows]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [selected, setSelected]       = useState(null)
  const [editMode, setEditMode]       = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [clearing, setClearing]       = useState(false)

  useEffect(() => { loadHistory() }, [])

  const loadHistory = async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }
    const { data, error } = await supabase
      .from('predictions')
      .select('id,mint,name,symbol,snapshot_timestamp,market_cap_at_analysis,estimated_peak_mc,rug_probability,momentum,stage,actual_peak_mc')
      .eq('user_id', session.user.id)
      .order('snapshot_timestamp', { ascending: false })
      .limit(200)
    if (!error && data) setRows(data)
    setLoading(false)
  }

  const filtered = rows.filter(r =>
    !search ||
    r.name?.toLowerCase().includes(search.toLowerCase()) ||
    r.symbol?.toLowerCase().includes(search.toLowerCase()) ||
    r.mint?.toLowerCase().includes(search.toLowerCase())
  )

  const toggleSelect = (id, e) => {
    e.stopPropagation()
    setSelectedIds(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const deleteSelected = async () => {
    if (!selectedIds.size) return
    setClearing(true)
    await supabase.from('predictions').delete().in('id', [...selectedIds])
    setRows(prev => prev.filter(r => !selectedIds.has(r.id)))
    setSelectedIds(new Set())
    setClearing(false)
  }

  const clearAll = async () => {
    if (!confirm('Delete all analysis history? This cannot be undone.')) return
    setClearing(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (session) await supabase.from('predictions').delete().eq('user_id', session.user.id)
    setRows([])
    setSelectedIds(new Set())
    setClearing(false)
  }

  const exitEdit = () => {
    setEditMode(false)
    setSelectedIds(new Set())
  }

  return (
    <div className="history-screen">
      <StarField />
      <NavBar active="history" />
      <div className="history-body">
        <div className="history-header">
          <h2>Analysis History</h2>
          <div className="history-header-right">
            {!editMode ? (
              <>
                <input className="history-search" placeholder="Search by name, symbol or CA..."
                  value={search} onChange={e => setSearch(e.target.value)} />
                <button className="hist-edit-btn" onClick={() => setEditMode(true)}>Edit</button>
              </>
            ) : (
              <>
                {selectedIds.size > 0 && (
                  <button className="hist-clear-btn" onClick={deleteSelected} disabled={clearing}>
                    {clearing ? '...' : `Delete ${selectedIds.size}`}
                  </button>
                )}
                <button className="hist-clear-all-btn" onClick={clearAll} disabled={clearing}>
                  Clear All
                </button>
                <button className="hist-done-btn" onClick={exitEdit}>Done</button>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="history-loading">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="history-empty">No analyses yet. Go analyze a coin!</div>
        ) : (
          <div className="history-table">
            <div className="ht-head" style={{gridTemplateColumns: editMode ? '24px 2fr 1.5fr 1fr 1fr 1fr 0.6fr 1fr' : '2fr 1.5fr 1fr 1fr 1fr 0.6fr 1fr'}}>
              {editMode && <span></span>}
              <span>Coin</span>
              <span>Analyzed</span>
              <span>MC at Analysis</span>
              <span>Est. Peak</span>
              <span>Actual Peak</span>
              <span>Rug %</span>
              <span>Stage</span>
            </div>
            {filtered.map(r => (
              <div key={r.id}
                className={`ht-row ${selectedIds.has(r.id) ? 'ht-selected' : ''}`}
                style={{gridTemplateColumns: editMode ? '24px 2fr 1.5fr 1fr 1fr 1fr 0.6fr 1fr' : '2fr 1.5fr 1fr 1fr 1fr 0.6fr 1fr'}}
                onClick={() => editMode ? null : setSelected(r)}
              >
                {editMode && (
                  <input type="checkbox" className="ht-checkbox"
                    checked={selectedIds.has(r.id)}
                    onChange={e => toggleSelect(r.id, e)}
                    onClick={e => e.stopPropagation()} />
                )}
                <span className="ht-name">
                  <div>{r.name || '?'}</div>
                  <div className="ht-symbol">{r.symbol}</div>
                </span>
                <span className="ht-time">{fmtTime(r.snapshot_timestamp)}</span>
                <span>{fmtMC(r.market_cap_at_analysis)}</span>
                <span>{fmtMC(r.estimated_peak_mc)}</span>
                <span className={r.actual_peak_mc ? 'ht-actual' : 'ht-pending'}>
                  {r.actual_peak_mc ? fmtMC(r.actual_peak_mc) : '…'}
                </span>
                <span className={r.rug_probability > 70 ? 'c-red' : r.rug_probability > 40 ? 'c-yellow' : 'c-green'}>
                  {r.rug_probability ?? '?'}%
                </span>
                <span className="ht-stage">{r.stage?.replace(/_/g,' ') || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="hist-modal-overlay" onClick={() => setSelected(null)}>
          <div className="hist-modal" onClick={e => e.stopPropagation()}>
            <div className="hist-modal-header">
              <div>
                <div className="hist-modal-name">{selected.name} <span className="ht-symbol">{selected.symbol}</span></div>
                <div className="ht-time">{fmtTime(selected.snapshot_timestamp)}</div>
              </div>
              <button className="hist-modal-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="hist-modal-grid">
              <div className="hist-stat"><div className="hist-stat-label">MC at Analysis</div><div className="hist-stat-val">{fmtMC(selected.market_cap_at_analysis)}</div></div>
              <div className="hist-stat"><div className="hist-stat-label">Est. Peak</div><div className="hist-stat-val">{fmtMC(selected.estimated_peak_mc)}</div></div>
              <div className="hist-stat"><div className="hist-stat-label">Actual Peak</div><div className={`hist-stat-val ${selected.actual_peak_mc ? 'c-green' : 'c-muted'}`}>{selected.actual_peak_mc ? fmtMC(selected.actual_peak_mc) : 'Pending'}</div></div>
              <div className="hist-stat"><div className="hist-stat-label">Rug %</div><div className={`hist-stat-val ${selected.rug_probability > 70 ? 'c-red' : selected.rug_probability > 40 ? 'c-yellow' : 'c-green'}`}>{selected.rug_probability ?? '?'}%</div></div>
              <div className="hist-stat"><div className="hist-stat-label">Stage</div><div className="hist-stat-val">{selected.stage?.replace(/_/g,' ') || '—'}</div></div>
              <div className="hist-stat"><div className="hist-stat-label">Momentum</div><div className="hist-stat-val">{selected.momentum || '—'}</div></div>
            </div>
            <div className="hist-modal-actions">
              <button className="hist-reanalyze" onClick={() => { setSelected(null); nav(`/analyze?reanalyze=${selected.mint}`) }}>
                Re-analyze →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
