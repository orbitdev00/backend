import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import NavBar from '../components/NavBar'
import StarField from '../components/StarField'
import './Leaderboard.css'

export default function Leaderboard() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [tab, setTab]               = useState('pnl')
  const [pnlSection, setPnlSection] = useState('high')
  const [leaders, setLeaders]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [recap, setRecap]             = useState(null)

  useEffect(() => { loadLeaderboard() }, [tab])
  useEffect(() => { loadWeeklyRecap() }, [])

  const loadWeeklyRecap = async () => {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay()) // Sunday
    weekStart.setHours(0,0,0,0)
    const weekStartISO = weekStart.toISOString()

    // Top PnL this week — use pnl_updated_at if available, else just use current standings
    const { data: pnlData } = await supabase
      .from('user_reputation')
      .select('user_id,username,avatar_url,total_pnl_pct,wallet_address')
      .not('total_pnl_pct', 'is', null)
      .not('wallet_address', 'is', null)
      .order('total_pnl_pct', { ascending: false })
      .limit(3)

    const { data: loserData } = await supabase
      .from('user_reputation')
      .select('user_id,username,avatar_url,total_pnl_pct,wallet_address')
      .not('total_pnl_pct', 'is', null)
      .not('wallet_address', 'is', null)
      .order('total_pnl_pct', { ascending: true })
      .limit(1)

    const { data: repData } = await supabase
      .from('user_reputation')
      .select('user_id,username,avatar_url,score')
      .gt('score', 0)
      .order('score', { ascending: false })
      .limit(1)

    setRecap({
      topPnl: pnlData || [],
      worstPnl: loserData?.[0] || null,
      topRep: repData?.[0] || null,
      weekLabel: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
        ' – ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    })
  }

  const loadLeaderboard = async () => {
    setLoading(true)
    if (tab === 'pnl') {
      const { data } = await supabase
        .from('user_reputation')
        .select('user_id,username,email,avatar_url,wallet_address,score,total_pnl_pct')
        .not('wallet_address', 'is', null)
        .not('total_pnl_pct', 'is', null)
        .order('total_pnl_pct', { ascending: false })
        .limit(50)
      setLeaders(data || [])
    } else {
      const { data } = await supabase
        .from('user_reputation')
        .select('user_id,username,email,avatar_url,score')
        .gt('score', 0)
        .order('score', { ascending: false })
        .limit(50)
      // Get actual post counts
      if (data) {
        for (const row of data) {
          const { count: tc } = await supabase.from('forum_threads').select('id', { count: 'exact', head: true }).eq('user_id', row.user_id)
          const { count: pc } = await supabase.from('forum_posts').select('id', { count: 'exact', head: true }).eq('user_id', row.user_id)
          row.actual_post_count = (tc || 0) + (pc || 0)
        }
      }
      setLeaders(data || [])
    }
    setLoading(false)
  }

  const displayName = (row) => row.username || row.email?.split('@')[0] || '?'
  const medals = ['🥇', '🥈', '🥉']

  const renderPnlRow = (row, i, colorClass) => (
    <div key={row.user_id}
      className={`lb-row ${row.user_id === user?.id ? 'lb-you' : ''}`}
      style={{ gridTemplateColumns: '40px 1fr 120px 120px' }}
      onClick={() => nav(`/profile/${row.username || row.user_id}`)}>
      <span className="lb-rank">{medals[i] || i + 1}</span>
      <span className="lb-user">
        <div className="lb-avatar">
          {row.avatar_url ? <img src={row.avatar_url} alt="" /> : displayName(row).slice(0,2).toUpperCase()}
        </div>
        <span>{displayName(row)}{row.user_id === user?.id && ' (you)'}</span>
      </span>
      <span className="lb-wallet">
        {row.wallet_address ? `${row.wallet_address.slice(0,4)}...${row.wallet_address.slice(-4)}` : '—'}
      </span>
      <span className={colorClass}>
        {Number(row.total_pnl_pct) > 0 ? '+' : ''}{Number(row.total_pnl_pct).toFixed(4)} SOL
      </span>
    </div>
  )


  const WeeklyRecap = () => {
    if (!recap) return null
    const { topPnl, worstPnl, topRep, weekLabel } = recap
    if (topPnl.length === 0 && !worstPnl && !topRep) return null

    const Avatar = ({ row }) => (
      <div className="lb-avatar" style={{width:32,height:32,fontSize:11}}>
        {row?.avatar_url
          ? <img src={row.avatar_url} alt="" />
          : (row?.username || '?').slice(0,2).toUpperCase()}
      </div>
    )

    return (
      <div className="lb-recap-card">
        <div className="lb-recap-header">
          <span className="lb-recap-title">⚡ Weekly Recap</span>
          <span className="lb-recap-week">{weekLabel}</span>
        </div>
        <div className="lb-recap-grid">
          {/* Top PnL */}
          <div className="lb-recap-section">
            <div className="lb-recap-section-label">🏆 Top Traders</div>
            {topPnl.map((row, i) => (
              <div key={row.user_id} className="lb-recap-row" onClick={() => nav(`/profile/${row.username || row.user_id}`)}>
                <span className="lb-recap-medal">{['🥇','🥈','🥉'][i]}</span>
                <Avatar row={row} />
                <span className="lb-recap-name">{row.username || '?'}</span>
                <span className="lb-recap-val c-green">
                  {Number(row.total_pnl_pct) > 0 ? '+' : ''}{Number(row.total_pnl_pct).toFixed(3)} SOL
                </span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="lb-recap-divider" />

          {/* Worst + Top Rep */}
          <div className="lb-recap-section">
            {worstPnl && (
              <>
                <div className="lb-recap-section-label">💀 Biggest Loss</div>
                <div className="lb-recap-row" onClick={() => nav(`/profile/${worstPnl.username || worstPnl.user_id}`)}>
                  <span className="lb-recap-medal">💀</span>
                  <Avatar row={worstPnl} />
                  <span className="lb-recap-name">{worstPnl.username || '?'}</span>
                  <span className="lb-recap-val c-red">{Number(worstPnl.total_pnl_pct).toFixed(3)} SOL</span>
                </div>
              </>
            )}
            {topRep && (
              <>
                <div className="lb-recap-section-label" style={{marginTop: worstPnl ? 14 : 0}}>🌟 Top Contributor</div>
                <div className="lb-recap-row" onClick={() => nav(`/profile/${topRep.username || topRep.user_id}`)}>
                  <span className="lb-recap-medal">🌟</span>
                  <Avatar row={topRep} />
                  <span className="lb-recap-name">{topRep.username || '?'}</span>
                  <span className="lb-recap-val c-purple">{topRep.score} rep</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  const winners = leaders.filter(r => r.total_pnl_pct > 0)
  const losers  = [...leaders].filter(r => r.total_pnl_pct <= 0).reverse()

  return (
    <div className="lb-screen">
      <StarField />
      <NavBar active="leaderboard" />
      <div className="lb-body">
        <div className="lb-heading-wrap"><h2>Leaderboard</h2><p>On-chain PnL · community rankings.</p></div>
        <WeeklyRecap />
        <div className="lb-header">
          <div className="lb-tabs">
            <button className={`lb-tab ${tab === 'pnl' ? 'active' : ''}`} onClick={() => setTab('pnl')}>Monthly PnL</button>
            <button className={`lb-tab ${tab === 'reputation' ? 'active' : ''}`} onClick={() => setTab('reputation')}>Reputation</button>
          </div>
        </div>

        {tab === 'pnl' && (
          <div>
            {loading ? <div className="lb-loading">Loading...</div> : leaders.length === 0
              ? <div className="lb-loading">No PnL data yet. Add your wallet and click Refresh Monthly PnL in Edit Profile.</div>
              : (
                <>
                  <div style={{ display:'flex', gap:4, marginBottom:12 }}>
                    <button onClick={() => setPnlSection('high')} style={{
                      background: pnlSection === 'high' ? '#1a1a1a' : 'none',
                      border: '1px solid', borderColor: pnlSection === 'high' ? '#4ade80' : '#222',
                      borderRadius: 4, color: pnlSection === 'high' ? '#4ade80' : '#555',
                      fontFamily: 'inherit', fontSize: 11, padding: '6px 14px', cursor: 'pointer',
                    }}>
                      🏆 Highest PnL
                    </button>
                    <button onClick={() => setPnlSection('low')} style={{
                      background: pnlSection === 'low' ? '#1a1a1a' : 'none',
                      border: '1px solid', borderColor: pnlSection === 'low' ? 'var(--red)' : '#222',
                      borderRadius: 4, color: pnlSection === 'low' ? 'var(--red)' : '#555',
                      fontFamily: 'inherit', fontSize: 11, padding: '6px 14px', cursor: 'pointer',
                    }}>
                      💀 Lowest PnL
                    </button>
                  </div>

                  {pnlSection === 'high' && (
                    <div className="lb-table">
                      <div className="lb-head" style={{ gridTemplateColumns: '40px 1fr 120px 120px' }}>
                        <span>#</span><span>User</span><span>Wallet</span><span>Net SOL (Month)</span>
                      </div>
                      {winners.length === 0
                        ? <div className="lb-loading">No positive PnL this month yet.</div>
                        : winners.map((row, i) => renderPnlRow(row, i, 'c-green'))}
                    </div>
                  )}

                  {pnlSection === 'low' && (
                    <div className="lb-table">
                      <div className="lb-head" style={{ gridTemplateColumns: '40px 1fr 120px 120px' }}>
                        <span>#</span><span>User</span><span>Wallet</span><span>Net SOL (Month)</span>
                      </div>
                      {losers.length === 0
                        ? <div className="lb-loading">No losses this month — everyone's winning!</div>
                        : losers.map((row, i) => renderPnlRow(row, i, 'c-red'))}
                    </div>
                  )}
                </>
              )
            }
          </div>
        )}

        {tab === 'reputation' && (
          <div className="lb-table">
            <div className="lb-head" style={{ gridTemplateColumns: '40px 1fr 100px 80px' }}>
              <span>#</span><span>User</span><span>Rep Score</span><span>Posts</span>
            </div>
            {loading ? <div className="lb-loading">Loading...</div> : leaders.map((row, i) => (
              <div key={row.user_id}
                className={`lb-row ${row.user_id === user?.id ? 'lb-you' : ''}`}
                style={{ gridTemplateColumns: '40px 1fr 100px 80px' }}
                onClick={() => nav(`/profile/${row.username || row.user_id}`)}>
                <span className="lb-rank">{medals[i] || i + 1}</span>
                <span className="lb-user">
                  <div className="lb-avatar">
                    {row.avatar_url ? <img src={row.avatar_url} alt="" /> : displayName(row).slice(0,2).toUpperCase()}
                  </div>
                  <span>{displayName(row)}{row.user_id === user?.id && ' (you)'}</span>
                </span>
                <span className="c-green">{row.score}</span>
                <span>{row.actual_post_count ?? row.post_count ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
