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
  const [portalLoading, setPortalLoading] = useState(false)
  const [selfGrantId, setSelfGrantId]     = useState('')
  const [selfGrantMsg, setSelfGrantMsg]   = useState('')
  const [selfGranting, setSelfGranting]   = useState(false)
  const [userRole, setUserRole]           = useState('member')
  const [unreadDMs, setUnreadDMs]         = useState(0)
  const fileRef = useRef(null)

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
      return () => clearInterval(interval)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    supabase.from('user_reputation').select('username,bio,avatar_url,role').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data?.username) setUsername(data.username)
        if (data?.bio) setBio(data.bio)
        if (data?.avatar_url) setPfpUrl(data.avatar_url)
        if (data?.wallet_address) setWallet(data.wallet_address)
        if (data?.role) setUserRole(data.role)
      })
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

  const initials = user?.email?.slice(0, 2).toUpperCase()

  return (
    <>
      <header className="navbar">
        <div className="nb-logo" onClick={handleLogo}>
          <img src={orbitPfp} className="nb-pfp" alt="" />
          <span className="nb-title">ORBIT</span>
          <span className="nb-version">v0.75</span>
        </div>

        <nav className="nb-links nb-desktop">
          {links.map(l => (
            <button
              key={l.key}
              className={`nb-link ${active === l.key ? 'nb-active' : ''}`}
              onClick={() => nav(l.path)}
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
                  <button className="nb-menu-btn" onClick={() => { nav('/profile/' + (username || user.id)); setShowMenu(false) }}>
                    My Profile
                  </button>
                  <button className="nb-menu-btn" onClick={() => { setShowAccount(true); setShowMenu(false) }}>
                    Account Settings
                  </button>
                  <div className="nb-divider" />
                  <button className="nb-signout-btn" onClick={async () => { await signOut(); setShowMenu(false); nav('/login') }}>
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
              onClick={() => { nav(l.path); setShowMobile(false) }}
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
            <button className="nb-mobile-link" onClick={() => { nav('/profile/' + (username || user?.id)); setShowMobile(false) }}>
              👤 My Profile
            </button>
          )}
          <button className="nb-mobile-link" onClick={() => { setShowAccount(true); setShowMobile(false) }}>
            Account Settings
          </button>
          <button className="nb-mobile-link nb-mobile-signout" onClick={async () => { await signOut(); nav('/login') }}>
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
                <button className="nb-sub-portal-btn" style={{marginTop:10}} disabled={portalLoading}
                  onClick={async () => { setPortalLoading(true); await openBillingPortal(); setPortalLoading(false) }}>
                  {portalLoading ? 'Redirecting...' : 'Manage · Cancel · Invoices →'}
                </button>
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
