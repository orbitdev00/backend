import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import orbitPfp from '../orbitPfp.js'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import './NavBar.css'
import PricingPanel from './PricingPanel'
import { getUserTier, openBillingPortal } from '../lib/stripe'
import { grantBadge } from '../hooks/useBadges'

const CONTRACT_ADDRESS = 'Ge5JGnzggDqEa1cFcmrCLRQrRYsfcdtYMTjmug43pump'
const CA_SHORT = `${CONTRACT_ADDRESS.slice(0, 5)}…${CONTRACT_ADDRESS.slice(-4)}`

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

export default function NavBar({ active, onLogoClick }) {
  const nav = useNavigate()
  const { user, signOut } = useAuth()
  const [showMenu, setShowMenu]           = useState(false)
  const [showMobile, setShowMobile]       = useState(false)
  const [showAccount, setShowAccount]     = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [pfpUrl, setPfpUrl]               = useState(null)
  const [username, setUsername]           = useState('')
  const [bio, setBio]                     = useState('')
  const [wallet, setWallet]               = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg]       = useState('')
  const [uploading, setUploading]         = useState(false)
  const [tier, setTier]                   = useState('free')
  const [showPricing, setShowPricing]     = useState(false)
  const [userBadges, setUserBadges]       = useState({ owned: [], all: [], ownedIds: new Set() })
  const [portalLoading, setPortalLoading]   = useState(false)
  const [portalError, setPortalError]       = useState('')
  const [hasStripeAccount, setHasStripeAccount] = useState(false)
  const [selfGrantId, setSelfGrantId]     = useState('')
  const [selfGrantMsg, setSelfGrantMsg]   = useState('')
  const [selfGranting, setSelfGranting]   = useState(false)
  const [userRole, setUserRole]           = useState('member')
  const [unreadDMs, setUnreadDMs]         = useState(0)
  const [bellNotifs, setBellNotifs]       = useState([])
  const [showBell, setShowBell]           = useState(false)
  const [caCopied, setCaCopied]           = useState(false)
  const fileRef = useRef(null)

  const copyCa = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = CONTRACT_ADDRESS
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCaCopied(true)
    setTimeout(() => setCaCopied(false), 1400)
  }

  useEffect(() => {
    if (user) {
      getUserTier().then(d => setTier(d.tier || 'free'))

      const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'
      Promise.all([
        fetch(`${BACKEND}/badges/all`).then(r => r.json()).catch(() => ({ badges: [] })),
        fetch(`${BACKEND}/badges/user/${user.id}`).then(r => r.json()).catch(() => ({ badges: [] })),
      ]).then(([allRes, userRes]) => {
        const ownedIds = new Set((userRes.badges || []).map(b => b.id))
        setUserBadges({ owned: userRes.badges || [], all: allRes.badges || [], ownedIds })
      })

      const fetchUnread = async () => {
        const { count } = await supabase
          .from('direct_messages')
          .select('*', { count: 'exact', head: true })
          .eq('receiver_id', user.id)
          .eq('read', false)
        setUnreadDMs(count || 0)
      }
      fetchUnread()
      const interval = setInterval(fetchUnread, 30000)

      const loadBellNotifs = async () => {
        // Resolve lastRead from localStorage and DB — use whichever is newer
        let lastRead = parseInt(localStorage.getItem(`orbit_bell_ts_${user.id}`) || '0')
        try {
          const { data: rep } = await supabase
            .from('user_reputation').select('bell_read_at').eq('user_id', user.id).single()
          if (rep?.bell_read_at) {
            const dbTs = new Date(rep.bell_read_at).getTime()
            if (dbTs > lastRead) {
              lastRead = dbTs
              localStorage.setItem(`orbit_bell_ts_${user.id}`, String(dbTs))
            }
          }
        } catch(_) {}
        const lastReadIso = new Date(lastRead || 0).toISOString()
        const notifs = []

        try {
          const { data: userThreads } = await supabase.from('forum_threads').select('id,title').eq('user_id', user.id)
          if (userThreads?.length) {
            const threadIds = userThreads.map(t => t.id)
            const threadMap = {}
            userThreads.forEach(t => { threadMap[t.id] = t.title })
            const { data: replies } = await supabase.from('forum_posts')
              .select('id,thread_id,user_id,created_at,author_email').in('thread_id', threadIds)
              .neq('user_id', user.id).gt('created_at', lastReadIso)
              .order('created_at', { ascending: false }).limit(10)
            const repIds = [...new Set((replies || []).map(r => r.user_id).filter(Boolean))]
            const repMap = {}
            if (repIds.length) {
              const { data: reps } = await supabase.from('user_reputation').select('user_id,username').in('user_id', repIds)
              reps?.forEach(r => { repMap[r.user_id] = r.username })
            }
            for (const r of (replies || [])) {
              notifs.push({ id: `reply_${r.id}`, type: 'reply', text: `${repMap[r.user_id] || r.author_email?.split('@')[0]} replied to "${threadMap[r.thread_id]}"`, ts: r.created_at, link: `/forum/thread/${r.thread_id}` })
            }
          }
        } catch(_) {}

        try {
          const { data: newFollowers } = await supabase.from('user_follows')
            .select('follower_id,created_at').eq('following_id', user.id)
            .gt('created_at', lastReadIso).order('created_at', { ascending: false }).limit(10)
          if (newFollowers?.length) {
            const followerIds = [...new Set(newFollowers.map(f => f.follower_id))]
            const { data: reps } = await supabase.from('user_reputation').select('user_id,username').in('user_id', followerIds)
            const repMap = {}
            reps?.forEach(r => { repMap[r.user_id] = r.username })
            for (const f of newFollowers) {
              notifs.push({ id: `follow_${f.follower_id}`, type: 'follow', text: `${repMap[f.follower_id] || f.follower_id?.slice(0,8)} started following you`, ts: f.created_at, link: `/profile/${repMap[f.follower_id] || f.follower_id}` })
            }
          }
        } catch(_) {}

        try {
          const { data: follows } = await supabase.from('user_follows')
            .select('following_id,created_at').eq('follower_id', user.id)
          if (follows?.length) {
            const followingIds = follows.map(f => f.following_id)
            const { data: reps } = await supabase.from('user_reputation').select('user_id,username').in('user_id', followingIds)
            const repMap = {}
            reps?.forEach(r => { repMap[r.user_id] = r.username })
            for (const follow of follows) {
              // Only show threads posted AFTER this follow was created
              const notBefore = new Date(Math.max(
                new Date(follow.created_at || 0).getTime(),
                lastRead
              )).toISOString()
              const { data: threads } = await supabase.from('forum_threads')
                .select('id,title,user_id,created_at').eq('user_id', follow.following_id)
                .gt('created_at', notBefore).order('created_at', { ascending: false }).limit(5)
              for (const t of (threads || [])) {
                notifs.push({ id: `thread_${t.id}`, type: 'post', text: `${repMap[t.user_id] || t.user_id?.slice(0,8)} posted "${t.title}"`, ts: t.created_at, link: `/forum/thread/${t.id}` })
              }
            }
          }
        } catch(_) {}

        notifs.sort((a, b) => new Date(b.ts) - new Date(a.ts))
        setBellNotifs(notifs.slice(0, 15))
      }
      loadBellNotifs()
      const bellInterval = setInterval(loadBellNotifs, 120000)
      return () => { clearInterval(interval); clearInterval(bellInterval) }
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    // Use raw REST fetch to avoid deadlocked Supabase client
    const sbKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    const sbData = sbKey ? JSON.parse(localStorage.getItem(sbKey) || '{}') : {}
    const token = sbData?.access_token
    if (!token) return
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_reputation?user_id=eq.${user.id}&select=username,bio,avatar_url,role,stripe_customer_id`, {
      headers: {
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
      }
    })
    .then(r => r.json())
    .then(async data => {
      const row = Array.isArray(data) ? data[0] : data
      if (row?.username) {
        setUsername(row.username)
      } else {
        // No row or no username — generate placeholder and upsert so Profile page can find it
        const words = ['swift','lunar','pixel','storm','apex','neon','wild','iron','bolt','orbit','crypt','delta','echo','flux','glitch']
        const w = words[Math.floor(Math.random() * words.length)]
        const n = Math.floor(Math.random() * 9000) + 1000
        const placeholder = `${w}${n}`
        setUsername(placeholder)
        await supabase.from('user_reputation').upsert(
          { user_id: user.id, username: placeholder },
          { onConflict: 'user_id' }
        )
      }
      if (row?.bio) setBio(row.bio)
      if (row?.avatar_url) setPfpUrl(row.avatar_url)
      if (row?.wallet_address) setWallet(row.wallet_address)
      if (row?.role) setUserRole(row.role)
      setHasStripeAccount(!!row?.stripe_customer_id)
    })
    .catch(e => console.warn('NavBar profile fetch failed:', e))
  }, [user])

  const links = [
    { key: 'home',        label: 'Home',        path: '/' },
    { key: 'analyze',     label: 'Analyzer',    path: '/analyze' },
    { key: 'forum',       label: 'Forum',       path: '/forum' },
    { key: 'tracker',     label: 'Tracker',     path: '/tracker' },
    { key: 'leaderboard', label: 'Leaderboard', path: '/leaderboard' },
    { key: 'history',     label: 'History',     path: '/history' },
    { key: 'badges',      label: 'Badges',      path: '/badges' },
    { key: 'pricing',     label: 'Upgrade',     path: '/pricing' },
  ]

  const handleLogo = () => {
    if (onLogoClick) onLogoClick()
    nav('/')
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== user?.email) return
    setDeleting(true)
    try {
      await supabase.from('predictions').delete().eq('user_id', user.id)
      await supabase.auth.admin?.deleteUser(user.id)
      await signOut()
    } catch {
      await signOut()
    }
    setDeleting(false)
  }

  const handlePfpUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const bitmap = await createImageBitmap(file)
      const size = Math.min(bitmap.width, bitmap.height, 256)
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')
      const scale = size / Math.min(bitmap.width, bitmap.height)
      const w = bitmap.width * scale, h = bitmap.height * scale
      ctx.drawImage(bitmap, (size-w)/2, (size-h)/2, w, h)
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85))
      const path = `${user.id}/avatar.jpg`
      const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (uploadErr) { console.error('Upload error:', uploadErr); setUploading(false); return }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = data.publicUrl + '?t=' + Date.now()
      setPfpUrl(url)
      await supabase.from('user_reputation').upsert({
        user_id: user.id, email: user.email,
        avatar_url: url, updated_at: new Date().toISOString()
      })
    } catch(err) { console.error('PFP error:', err) }
    setUploading(false)
  }

  const initials = (username || user?.email || '').slice(0, 2).toUpperCase()

  return (
    <>
      <header className="navbar">
        <div className="nb-logo" onClick={handleLogo}>
          <img src={orbitPfp} className="nb-pfp" alt="" />
          <span className="nb-title">ORBIT</span>
          <span className="nb-version">v1.0</span>
        </div>

        <button
          className={`nb-ca ${caCopied ? 'nb-ca-copied' : ''}`}
          onClick={copyCa}
          title={caCopied ? 'Copied!' : `Copy contract address\n${CONTRACT_ADDRESS}`}
        >
          <span className="nb-ca-label">CA</span>
          <span className="nb-ca-addr">{caCopied ? 'Copied!' : CA_SHORT}</span>
        </button>

        <nav className="nb-links nb-desktop">
          {links.map(l => (
            <button
              key={l.key}
              className={`nb-link ${active === l.key ? 'nb-active' : ''}`}
              onClick={() => active === l.key ? window.location.reload() : nav(l.path)}
            >
              {l.label}
            </button>
          ))}
        </nav>

        <div className="nb-right">
          {user && (
            <button className="nb-inbox-btn nb-desktop" onClick={() => { nav('/inbox'); setUnreadDMs(0) }} title="Messages" style={{position:'relative'}}>
              ✉
              {unreadDMs > 0 && (
                <span className="nb-inbox-badge">{unreadDMs > 9 ? '9+' : unreadDMs}</span>
              )}
            </button>
          )}

          {user && (
            <div className="nb-bell-wrap nb-desktop">
              <button className="nb-bell-btn" onClick={() => setShowBell(p => !p)} style={{position:'relative'}}>
                🔔
                {bellNotifs.length > 0 && <span className="nb-bell-badge">{bellNotifs.length > 9 ? '9+' : bellNotifs.length}</span>}
              </button>
              {showBell && (
                <div className="nb-bell-dropdown">
                  <div className="nb-bell-header">
                    <span>Notifications</span>
                    {bellNotifs.length > 0 && (
                      <button className="nb-bell-clear" onClick={async () => {
                        const now = Date.now()
                        localStorage.setItem(`orbit_bell_ts_${user.id}`, String(now))
                        try {
                          await supabase.from('user_reputation').upsert(
                            { user_id: user.id, bell_read_at: new Date(now).toISOString() },
                            { onConflict: 'user_id' }
                          )
                        } catch(_) {}
                        setBellNotifs([])
                        setShowBell(false)
                      }}>Mark all read</button>
                    )}
                  </div>
                  {bellNotifs.length === 0
                    ? <div className="nb-bell-empty">No new notifications</div>
                    : bellNotifs.map(n => (
                      <div key={n.id} className="nb-bell-item" onClick={() => { nav(n.link); setShowBell(false) }}>
                        <div className="nb-bell-item-icon">
                          {n.type === 'reply' ? '💬' : n.type === 'follow' ? '👤' : '📝'}
                        </div>
                        <div className="nb-bell-item-body">
                          <div className="nb-bell-item-text">{n.text}</div>
                          <div className="nb-bell-item-time">{timeAgo(n.ts)}</div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          )}

          {user && (
            <div className="nb-avatar-wrap nb-desktop">
              <div className="nb-avatar" onClick={() => setShowMenu(p => !p)} title={user.email}>
                {pfpUrl
                  ? <img src={pfpUrl} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}} alt="" />
                  : initials}
              </div>
              {showMenu && (
                <div className="nb-dropdown">
                  <div className="nb-email">{user.email}</div>
                  {tier !== 'free' && (
                    <div className="nb-tier-badge" style={{color: tier==='omega' ? '#f59e0b' : '#a78bfa', margin:'0 14px 6px'}}>
                      {tier.toUpperCase()}
                    </div>
                  )}
                  <div className="nb-divider" />
                  {tier === 'free' && (
                    <button className="nb-menu-btn nb-upgrade-btn" onClick={() => { setShowMenu(false); nav('/pricing') }}>
                      ⚡ Upgrade to Degen
                    </button>
                  )}
                  {tier === 'degen' && (
                    <button className="nb-menu-btn nb-upgrade-btn nb-upgrade-omega" onClick={() => { setShowMenu(false); nav('/pricing') }}>
                      ⚡ Upgrade to Omega
                    </button>
                  )}
                  <button className="nb-menu-btn" onClick={() => { nav(`/profile/${username || user?.id}`); setShowMenu(false) }}>
                    My Profile
                  </button>
                  <div className="nb-divider" />
                  <button className="nb-signout-btn" onClick={() => { setShowMenu(false); signOut() }}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}

          <button className="nb-hamburger nb-mobile" onClick={() => setShowMobile(p => !p)}>
            {showMobile ? '✕' : '☰'}
          </button>
        </div>
      </header>

      {showMobile && (
        <div className="nb-mobile-menu">
          {links.map(l => (
            <button
              key={l.key}
              className={`nb-mobile-link ${active === l.key ? 'nb-active' : ''}`}
              onClick={() => { active === l.key ? window.location.reload() : nav(l.path); setShowMobile(false) }}
            >
              {l.label}
            </button>
          ))}
          <div className="nb-mobile-divider" />
          {user && tier === 'free' && (
            <button className="nb-mobile-link nb-mobile-upgrade" onClick={() => { nav('/pricing'); setShowMobile(false) }}>
              ⚡ Upgrade to Degen
            </button>
          )}
          {user && tier === 'degen' && (
            <button className="nb-mobile-link nb-mobile-upgrade" onClick={() => { nav('/pricing'); setShowMobile(false) }}>
              ⚡ Upgrade to Omega
            </button>
          )}
          {user && (
            <button className="nb-mobile-link" onClick={() => { nav(`/profile/${username || user?.id}`); setShowMobile(false) }}>
              👤 My Profile
            </button>
          )}
          <button className="nb-mobile-link nb-mobile-signout" onClick={() => signOut()}>
            Sign Out
          </button>
        </div>
      )}

      {/* Account Settings Modal — portalled to body so fixed positioning works on all pages */}
      {showAccount && createPortal(
        <div className="nb-modal-overlay" onClick={() => setShowAccount(false)}>
          <div className="nb-modal" onClick={e => e.stopPropagation()}>
            <div className="nb-modal-header">
              <span>Account Settings</span>
              <button className="nb-modal-close" onClick={() => setShowAccount(false)}>✕</button>
            </div>

            {/* Email */}
            <div className="nb-modal-section">
              <div className="nb-modal-label">Email</div>
              <div className="nb-modal-value">{user?.email}</div>
            </div>

            {/* Owner — Grant badge to self */}
            {tier === 'omega' || userRole === 'owner' ? null : null}
            {username === 'Orbit_Dev' || user?.email === 'orbitdev00@gmail.com' ? (
              <div className="nb-modal-section">
                <div className="nb-modal-label">🏅 Grant Badge to Self</div>
                <div style={{display:'flex', gap:6, marginTop:4}}>
                  <select
                    style={{flex:1, background:'#0d0d0d', border:'1px solid #2a2a2a', borderRadius:4, color:'#aaa', fontFamily:'var(--mono)', fontSize:11, padding:'6px 8px'}}
                    value={selfGrantId}
                    onChange={e => setSelfGrantId(e.target.value)}
                  >
                    <option value="">-- Select badge --</option>
                    <option value="owner">🌀 Owner</option>
                    <option value="mod">🛡️ Mod</option>
                    <option value="beta_tester">🧪 Beta Tester</option>
                    <option value="orbit_dev">💻 Orbit Dev</option>
                    <option value="advisor">🎖️ Advisor</option>
                    <option value="special">⭐ Special</option>
                    <option value="cupsey_warning">☕ Cupsey Warning</option>
                    <option value="og">👑 OG</option>
                    <option value="founding_omega">🟣 Founding Omega</option>
                    <option value="founding_degen">🔶 Founding Degen</option>
                  </select>
                  <button
                    style={{background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:4, color:'#94a3b8', fontFamily:'var(--mono)', fontSize:11, padding:'6px 14px', cursor:'pointer', whiteSpace:'nowrap'}}
                    disabled={!selfGrantId || selfGranting}
                    onClick={async () => {
                      setSelfGranting(true); setSelfGrantMsg('')
                      const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'
                      try {
                        const res = await fetch(`${BACKEND}/badges/grant`, {
                          method: 'POST',
                          headers: {'Content-Type': 'application/json'},
                          body: JSON.stringify({
                            granter_id: user.id,
                            target_user_id: user.id,
                            badge_id: selfGrantId,
                            granter_role: 'owner',
                          })
                        })
                        const data = await res.json()
                        setSelfGrantMsg(data.error ? '✗ ' + data.error : data.awarded ? '✓ Granted' : '✓ Already owned')
                      } catch(e) { setSelfGrantMsg('✗ Error') }
                      setSelfGranting(false)
                      setTimeout(() => setSelfGrantMsg(''), 3000)
                    }}
                  >
                    {selfGranting ? '...' : 'Grant'}
                  </button>
                </div>
                {selfGrantMsg && <div style={{fontSize:10, marginTop:6, color: selfGrantMsg.startsWith('✓') ? '#4ade80' : '#f87171', fontFamily:'var(--mono)'}}>{selfGrantMsg}</div>}
              </div>
            ) : null}

            {/* Subscription */}
            <div className="nb-modal-section">
              <div className="nb-modal-label">Subscription</div>
              <div className="nb-sub-plan-row">
                <div className="nb-sub-plan-name" style={{color: tier==='omega' ? '#f59e0b' : tier==='degen' ? '#a78bfa' : '#555'}}>
                  {tier === 'omega' ? '🌌 Omega' : tier === 'degen' ? '🔥 Degen' : '⬜ Free'}
                </div>
                <div className="nb-sub-plan-price">
                  {tier === 'omega' ? '$49.99/mo' : tier === 'degen' ? '$14.99/mo' : 'No charge'}
                </div>
              </div>
              {tier === 'free' && (
                <div style={{display:'flex', flexDirection:'column', gap:6, marginTop:10}}>
                  <button className="nb-sub-upgrade-btn nb-sub-degen" onClick={() => { setShowAccount(false); nav('/pricing') }}>
                    ⚡ Upgrade to Degen — $14.99/mo
                  </button>
                  <button className="nb-sub-upgrade-btn nb-sub-omega" onClick={() => { setShowAccount(false); nav('/pricing') }}>
                    🌌 Upgrade to Omega — $49.99/mo
                  </button>
                </div>
              )}
              {tier === 'degen' && (
                <button className="nb-sub-upgrade-btn nb-sub-omega" style={{marginTop:10}} onClick={() => { setShowAccount(false); nav('/pricing') }}>
                  🌌 Upgrade to Omega — $49.99/mo
                </button>
              )}
              {tier !== 'free' && (
                <>
                  {hasStripeAccount ? (
                    <>
                      <button className="nb-sub-portal-btn" style={{marginTop:10}} disabled={portalLoading}
                        onClick={async () => {
                          setPortalLoading(true)
                          setPortalError('')
                          const result = await openBillingPortal()
                          if (result?.error) setPortalError(result.error)
                          setPortalLoading(false)
                        }}>
                        {portalLoading ? 'Redirecting...' : 'Manage · Cancel · Invoices →'}
                      </button>
                      {portalError && <div style={{fontSize:11, color:'#f87171', marginTop:4, fontFamily:'var(--mono)'}}>{portalError}</div>}
                    </>
                  ) : (
                    <div style={{fontSize:11, color:'#888', marginTop:8, fontFamily:'var(--mono)'}}>Owner-granted plan · expires in 30 days</div>
                  )}
                </>
              )}
            </div>

            {/* Delete Account */}
            <div className="nb-modal-section nb-danger-section">
              <div className="nb-modal-label nb-danger-label">Delete Account</div>
              <div className="nb-modal-hint">This will delete all your data. Type your email to confirm.</div>
              <input
                className="nb-delete-input"
                placeholder={user?.email}
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
              />
              <button
                className="nb-delete-btn"
                disabled={deleteConfirm !== user?.email || deleting}
                onClick={handleDeleteAccount}
              >
                {deleting ? 'Deleting...' : 'Delete My Account'}
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </>
  )
}
