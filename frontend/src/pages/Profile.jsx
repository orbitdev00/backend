import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import NavBar from '../components/NavBar'
import { grantBadge } from '../hooks/useBadges'
import './Profile.css'

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

function fmtMC(n) {
  if (!n) return '$0'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n/1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}


function OwnerPanel({ profile, setProfile, currentUserId }) {
  const [action, setAction]       = useState('')
  const [badgeId, setBadgeId]     = useState('')
  const [badgeMsg, setBadgeMsg]   = useState('')
  const [grantingBadge, setGrantingBadge] = useState(false)
  const [tier, setTier]           = useState(profile?.tier || 'free')
  const [confirm, setConfirm]     = useState(false)
  const [msg, setMsg]             = useState('')
  const [saving, setSaving]       = useState(false)

  const ACTIONS = [
    { value: '', label: '-- Select action --' },
    { value: 'set_tier', label: 'Change membership tier' },
    { value: 'add_mod', label: 'Add mod status' },
    { value: 'remove_mod', label: 'Remove mod status' },
    { value: 'ban', label: 'Ban account (read-only)' },
    { value: 'unban', label: 'Unban account' },
    { value: 'delete', label: 'Delete account' },
  ]

  const getConfirmText = () => {
    if (action === 'set_tier') return `Set @${profile?.username || 'user'} tier to ${tier.toUpperCase()}?`
    if (action === 'add_mod') return `Give @${profile?.username || 'user'} mod status? They can delete threads and ban users.`
    if (action === 'remove_mod') return `Remove mod status from @${profile?.username || 'user'}?`
    if (action === 'ban') return `Ban @${profile?.username || 'user'}? They will be read-only.`
    if (action === 'unban') return `Unban @${profile?.username || 'user'}?`
    if (action === 'delete') return `PERMANENTLY DELETE @${profile?.username || 'user'}'s account? This cannot be undone.`
    return ''
  }

  const execute = async () => {
    setSaving(true)
    setMsg('')
    try {
      if (action === 'set_tier') {
        const expiresAt = (tier === 'degen' || tier === 'omega')
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null
        const { error } = await supabase.from('user_reputation')
          .update({ tier, subscription_expires_at: expiresAt })
          .eq('user_id', profile.user_id)
        if (error) throw error
        setProfile(p => ({ ...p, tier }))
        setMsg(`✓ Tier set to ${tier}${expiresAt ? ' (expires in 30 days)' : ''}`)
        // Refresh auth context if owner changed their own tier
        if (typeof refreshProfile === 'function') refreshProfile()
        // Send welcome email via backend if upgrading to paid tier
        if (tier === 'degen' || tier === 'omega') {
          try {
            await fetch('https://backend-production-a427a.up.railway.app/admin/assign-tier', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-admin-secret': import.meta.env.VITE_ADMIN_SECRET || '',
              },
              body: JSON.stringify({ user_id: profile.user_id, tier }),
            })
          } catch (e) { console.warn('Email send failed:', e) }
        }
      } else if (action === 'add_mod') {
        const { error } = await supabase.from('user_reputation')
          .update({ role: 'mod' })
          .eq('user_id', profile.user_id)
        if (error) throw error
        setMsg('✓ Mod status granted')
      } else if (action === 'remove_mod') {
        const { error } = await supabase.from('user_reputation')
          .update({ role: 'member' })
          .eq('user_id', profile.user_id)
        if (error) throw error
        setMsg('✓ Mod status removed')
      } else if (action === 'ban') {
        const { error } = await supabase.from('user_reputation')
          .update({ role: 'banned' })
          .eq('user_id', profile.user_id)
        if (error) throw error
        setMsg('✓ Account banned')
      } else if (action === 'unban') {
        const { error } = await supabase.from('user_reputation')
          .update({ role: 'member' })
          .eq('user_id', profile.user_id)
        if (error) throw error
        setMsg('✓ Account unbanned')
      } else if (action === 'delete') {
        const { error } = await supabase.from('user_reputation')
          .delete()
          .eq('user_id', profile.user_id)
        if (error) throw error
        setMsg('✓ Account deleted')
      }
    } catch (e) {
      setMsg('Error: ' + e.message)
    }
    setSaving(false)
    setConfirm(false)
    setTimeout(() => setMsg(''), 4000)
  }

  return (
    <div className="profile-owner-panel">
      <div className="profile-owner-label">👁️‍🗨️ Owner Controls</div>
      <div className="profile-owner-row">
        <select className="profile-owner-select" value={action} onChange={e => { setAction(e.target.value); setConfirm(false) }}>
          {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>

      {action === 'set_tier' && (
        <div className="profile-owner-row" style={{marginTop:8}}>
          <select className="profile-owner-select" value={tier} onChange={e => setTier(e.target.value)}>
            <option value="free">Free</option>
            <option value="degen">Degen</option>
            <option value="omega">Omega</option>
          </select>
        </div>
      )}

      {action && !confirm && (
        <button className="profile-owner-btn profile-owner-btn-confirm" onClick={() => setConfirm(true)}>
          Apply
        </button>
      )}

      {confirm && (
        <div className="profile-owner-confirm">
          <div className="profile-owner-confirm-text">{getConfirmText()}</div>
          <div className="profile-owner-confirm-btns">
            <button
              className="profile-owner-btn"
              style={{background: action === 'delete' ? '#ef4444' : undefined}}
              onClick={execute}
              disabled={saving}
            >
              {saving ? 'Working...' : 'Confirm'}
            </button>
            <button className="profile-owner-btn-cancel" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && <div className={msg.slice(0,5) === 'Error' ? 'profile-owner-msg profile-owner-msg-err' : 'profile-owner-msg'}>{msg}</div>}

      {/* Badge Grant */}
      <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid #1a1a1a'}}>
        <div className="profile-owner-label" style={{marginBottom:6}}>🏅 Grant Badge</div>
        <div className="profile-owner-row">
          <select className="profile-owner-select" value={badgeId} onChange={e => setBadgeId(e.target.value)}>
            <option value="">-- Select badge --</option>
            <option value="owner">🌀 Owner</option>
            <option value="mod">🛡️ Mod</option>
            <option value="beta_tester">🧪 Beta Tester</option>
            <option value="orbit_dev">💻 Orbit Dev</option>
            <option value="advisor">🎖️ Advisor</option>
            <option value="special">⭐ Special</option>
            <option value="cupsey_warning">☕ Cupsey Warning</option>
          </select>
          <button
            className="profile-owner-btn"
            disabled={!badgeId || grantingBadge}
            onClick={async () => {
              setGrantingBadge(true); setBadgeMsg('')
              const res = await grantBadge(currentUserId, profile.user_id, badgeId, 'owner')
              setBadgeMsg(res.error ? 'Error: ' + res.error : res.awarded ? '✓ Badge granted' : 'Already has badge')
              setGrantingBadge(false)
              setTimeout(() => setBadgeMsg(''), 3000)
            }}
          >
            {grantingBadge ? '...' : 'Grant'}
          </button>
        </div>
        {badgeMsg && <div className="profile-owner-msg">{badgeMsg}</div>}
      </div>
    </div>
  )
}

export default function Profile() {
  const { username } = useParams()
  const nav = useNavigate()
  const { user, refreshProfile } = useAuth()
  const [profile, setProfile]     = useState(null)
  const [badges, setBadges]       = useState([])
  const [threads, setThreads]     = useState([])
  const [replies, setReplies]     = useState([])
  const [isFollowing, setIsFollowing] = useState(false)
  const [tab, setTab]             = useState('threads')
  const OWNER_EMAIL = 'orbitdev00@gmail.com'
  const [loading, setLoading]     = useState(true)
  const [dmOpen, setDmOpen]       = useState(false)
  const [pnlLoading, setPnlLoading] = useState(false)
  const [pnlMsg, setPnlMsg]         = useState('')
  const [dmBody, setDmBody]       = useState('')
  const [dmSending, setDmSending] = useState(false)
  const [dmSent, setDmSent]       = useState(false)

  useEffect(() => { loadProfile() }, [username])

  const loadProfile = async () => {
    setLoading(true)
    // Find by username or user_id
    let { data: rep } = await supabase.from('user_reputation')
.select('*').eq('username', username).single()
    if (!rep) {
      const { data } = await supabase.from('user_reputation')
        .select('*,total_pnl_pct,show_pnl,wallet_address').eq('user_id', username).single()
      rep = data
    }
    if (!rep) { setLoading(false); return }
    // Try to get auth creation date for own profile
    setProfile(rep)

    // Load equipped badges from new schema
    try {
      const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'
      const res = await fetch(`${BACKEND}/badges/user/${rep.user_id}/equipped`)
      const data = await res.json()
      setBadges(data.equipped || [])
    } catch(e) { setBadges([]) }

    // Load forum threads
    const { data: t } = await supabase.from('forum_threads')
      .select('id,title,reply_count,created_at').eq('user_id', rep.user_id)
      .order('created_at', { ascending: false }).limit(10)
    setThreads(t || [])

    // Load replies
    const { data: replyData } = await supabase.from('forum_posts')
      .select('id,body,created_at,thread_id,forum_threads(title)')
      .eq('user_id', rep.user_id)
      .order('created_at', { ascending: false }).limit(20)
    setReplies(replyData || [])

    // Check if following
    if (user && user.id !== rep.user_id) {
      const { data: f } = await supabase.from('user_follows')
        .select('id').eq('follower_id', user.id).eq('following_id', rep.user_id).single()
      setIsFollowing(!!f)
    }
    setLoading(false)
  }

  const toggleFollow = async () => {
    if (!user) { nav('/login'); return }
    if (isFollowing) {
      await supabase.from('user_follows').delete()
        .eq('follower_id', user.id).eq('following_id', profile.user_id)
      await supabase.from('user_reputation').update({ follower_count: Math.max((profile.follower_count||1)-1,0) }).eq('user_id', profile.user_id)
      await supabase.from('user_reputation').update({ following_count: Math.max((profile.following_count||1)-1,0) }).eq('user_id', user.id)
      setIsFollowing(false)
      setProfile(p => ({ ...p, follower_count: Math.max((p.follower_count||1)-1,0) }))
    } else {
      await supabase.from('user_follows').insert({ follower_id: user.id, following_id: profile.user_id })
      await supabase.from('user_reputation').update({ follower_count: (profile.follower_count||0)+1 }).eq('user_id', profile.user_id)
      await supabase.from('user_reputation').update({ following_count: (profile.following_count||0)+1 }).eq('user_id', user.id)
      setIsFollowing(true)
      setProfile(p => ({ ...p, follower_count: (p.follower_count||0)+1 }))
    }
  }

  const sendDM = async () => {
    if (!dmBody.trim() || !user) return
    setDmSending(true)
    await supabase.from('direct_messages').insert({
      sender_id: user.id, receiver_id: profile.user_id, body: dmBody.trim()
    })
    setDmSending(false); setDmSent(true); setDmBody('')
    setTimeout(() => { setDmSent(false); setDmOpen(false) }, 2000)
  }

  const refreshPnl = async () => {
    if (!profile?.wallet_address) {
      setPnlMsg('no_wallet')
      return
    }
    setPnlLoading(true); setPnlMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'
      const resp = await fetch(`${BACKEND}/pnl/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: profile.wallet_address,
          user_id: user.id,
          jwt: session?.access_token || '',
        }),
      })
      const data = await resp.json()
      if (data.error) { setPnlMsg('error'); return }
      setPnlMsg('done')
      // Refresh profile to show new PnL
      loadProfile()
    } catch { setPnlMsg('error') }
    finally { setPnlLoading(false) }
  }

  const isOwnProfile = user?.id === profile?.user_id
  const isOwner = user?.email === OWNER_EMAIL && !isOwnProfile
  const displayName = profile?.username || profile?.email?.split('@')[0]

  if (loading) return <div className="profile-screen"><NavBar /><div className="profile-loading">Loading...</div></div>
  if (!profile) return (
    <div className="profile-screen">
      <NavBar />
      <div className="profile-loading" style={{flexDirection:'column',gap:12}}>
        <div>Profile not found.</div>
        {user && <button className="btn-primary" style={{marginTop:8}} onClick={() => nav('/edit-profile')}>Set up your profile</button>}
      </div>
    </div>
  )

  return (
    <div className="profile-screen">
      <NavBar />
      <div className="profile-body">

        {/* Header */}
        <div className="profile-header">
          <div className="profile-avatar-large" style={{cursor: isOwnProfile ? "default" : "pointer"}} onClick={() => !isOwnProfile && nav(`/profile/${profile.username || profile.user_id}`)}>
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt="" />
              : displayName?.slice(0,2).toUpperCase()}
          </div>
          <div className="profile-info">
            <div className="profile-name">{displayName}</div>
            {profile.bio && <div className="profile-bio">{profile.bio}</div>}
            <div className="profile-badges">
              {badges.map(b => (
                <span key={b?.id} className="profile-badge" style={{background: b?.color + '22', color: b?.color, border: `1px solid ${b?.color}44`}} title={b?.description}>
                  {b?.emoji} {b?.name}
                </span>
              ))}
            </div>
            <div className="profile-member-since">
              Member since {profile.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', {month:'long', year:'numeric'}) : '—'}
            </div>
            <div className="profile-stats">
              <div><span>{profile.score || 0}</span><span>Rep</span></div>
              <div><span>{profile.follower_count || 0}</span><span>Followers</span></div>
              <div><span>{profile.following_count || 0}</span><span>Following</span></div>
              <div><span>{threads.length + replies.length}</span><span>Posts</span></div>
              {(profile.show_pnl !== false || isOwnProfile) && profile.total_pnl_pct !== null && profile.total_pnl_pct !== undefined && (
                <div>
                  <span style={{color: profile.total_pnl_pct > 0 ? 'var(--green)' : 'var(--red)'}}>
                    {profile.total_pnl_pct > 0 ? '+' : ''}{Number(profile.total_pnl_pct).toFixed(4)}
                  </span>
                  <span>SOL/mo</span>
                </div>
              )}
            </div>
          </div>
          {!isOwnProfile && user && (
            <div className="profile-actions">
              <button className={`profile-follow-btn ${isFollowing ? 'following' : ''}`} onClick={toggleFollow}>
                {isFollowing ? 'Following' : '+ Follow'}
              </button>
              <button className="profile-dm-btn" onClick={() => setDmOpen(p => !p)}>
                ✉ Message
              </button>
            </div>
          )}
          {isOwner && !isOwnProfile && (
            <OwnerPanel profile={profile} setProfile={setProfile} currentUserId={user?.id} />
          )}
          {isOwnProfile && (
            <div style={{display:'flex',flexDirection:'column',gap:8,alignItems:'flex-end'}}>
              <button className="profile-edit-btn profile-edit-btn--primary" onClick={() => nav('/edit-profile')}>✏️ Edit Profile</button>
              <button className="profile-edit-btn" onClick={refreshPnl} disabled={pnlLoading}
                style={{fontSize:10, opacity: pnlLoading ? 0.5 : 1}}>
                {pnlLoading ? 'Refreshing...' : '↻ Refresh Monthly PnL'}
              </button>
              {pnlMsg === 'no_wallet' && (
                <div style={{fontSize:10,color:'#888',textAlign:'right',maxWidth:160}}>
                  No wallet linked. Add it in <span style={{color:'var(--green)',cursor:'pointer'}} onClick={() => nav('/edit-profile')}>Edit Profile</span>.
                </div>
              )}
              {pnlMsg === 'done' && <div style={{fontSize:10,color:'var(--green)'}}>✓ PnL updated</div>}
              {pnlMsg === 'error' && <div style={{fontSize:10,color:'var(--red)'}}>Failed to refresh</div>}
            </div>
          )}
        </div>

        {/* DM box */}
        {dmOpen && (
          <div className="profile-dm-box">
            <div className="profile-dm-label">Message {displayName}</div>
            {dmSent
              ? <div className="profile-dm-sent">✓ Sent!</div>
              : <>
                  <textarea className="profile-dm-input" placeholder="Write a message..."
                    value={dmBody} onChange={e => setDmBody(e.target.value)} rows={3} />
                  <button className="profile-dm-send" onClick={sendDM} disabled={dmSending || !dmBody.trim()}>
                    {dmSending ? 'Sending...' : 'Send'}
                  </button>
                </>
            }
          </div>
        )}

        {/* Tabs */}
        <div className="profile-tabs">
          <button className={`profile-tab ${tab==='threads'?'active':''}`} onClick={() => setTab('threads')}>Threads</button>
          <button className={`profile-tab ${tab==='replies'?'active':''}`} onClick={() => setTab('replies')}>Replies</button>
        </div>

        {/* Replies tab */}
        {tab === 'replies' && (
          <div className="profile-threads">
            {replies.length === 0
              ? <div className="profile-empty">No replies yet.</div>
              : replies.map(r => (
                <div key={r.id} className="pthread-row" onClick={() => nav(`/forum/thread/${r.thread_id}`)}>
                  <div className="pthread-meta" style={{marginBottom:4}}>Replied in: {r.forum_threads?.title}</div>
                  <div className="pthread-title" style={{fontSize:12,color:'#aaa',fontWeight:300}}>{r.body?.slice(0,120)}{r.body?.length > 120 ? '...' : ''}</div>
                  <div className="pthread-meta" style={{marginTop:4}}>{timeAgo(r.created_at)}</div>
                </div>
              ))
            }
          </div>
        )}

        {/* Calls tab - hidden, keeping for data compat */}
        {tab === 'calls' && (
          <div className="profile-calls">
            {calls.length === 0
              ? <div className="profile-empty">No calls yet.</div>
              : calls.map(c => (
                <div key={c.id} className="pcall-row" onClick={() => nav(`/analyze?mint=${c.mint}`)}>
                  <div className="pcall-main">
                    <div className="pcall-name">{c.name || c.mint?.slice(0,8)+'...'} <span className="pcall-symbol">{c.symbol}</span></div>
                    <div className="pcall-note">{c.note || '—'}</div>
                  </div>
                  <div className="pcall-mc">
                    <div className="pcall-label">Entry</div>
                    <div>{fmtMC(c.entry_mc)}</div>
                  </div>
                  <div className="pcall-mc">
                    <div className="pcall-label">Peak</div>
                    <div>{c.peak_mc ? fmtMC(c.peak_mc) : '…'}</div>
                  </div>
                  <div className="pcall-status" style={{color: statusColor[c.status]}}>
                    {statusLabel[c.status]}
                  </div>
                  <div className="pcall-time">{timeAgo(c.called_at)}</div>
                </div>
              ))
            }
          </div>
        )}

        {/* Replies tab */}
        
        {/* Threads tab */}
        {tab === 'threads' && (
          <div className="profile-threads">
            {threads.length === 0
              ? <div className="profile-empty">No forum posts yet.</div>
              : threads.map(t => (
                <div key={t.id} className="pthread-row" onClick={() => nav(`/forum/thread/${t.id}`)}>
                  <div className="pthread-title">{t.title}</div>
                  <div className="pthread-meta">{t.reply_count} replies · {timeAgo(t.created_at)}</div>
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  )
}
