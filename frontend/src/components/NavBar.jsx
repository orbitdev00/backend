import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import orbitPfp from '../orbitPfp.js'
import { useState, useRef, useEffect } from 'react'
import './NavBar.css'
import PricingPanel from './PricingPanel'
import { getUserTier } from '../lib/stripe'

export default function NavBar({ active, onLogoClick }) {
  const nav = useNavigate()
  const { user, signOut } = useAuth()
  const [showMenu, setShowMenu]         = useState(false)
  const [showMobile, setShowMobile]     = useState(false)
  const [showAccount, setShowAccount]   = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [pfpUrl, setPfpUrl]             = useState(null)
  const [username, setUsername]         = useState('')
  const [bio, setBio]                   = useState('')
  const [wallet, setWallet]               = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg]     = useState('')
  const [uploading, setUploading]       = useState(false)
  const [tier, setTier]               = useState('free')
  const [showPricing, setShowPricing]   = useState(false)
  const [showProfile, setShowProfile]   = useState(false)
  const [showBadges, setShowBadges]     = useState(false)
  const [allBadges, setAllBadges]       = useState([])
  const [ownedBadgeIds, setOwnedBadgeIds] = useState(new Set())
  const [unreadDMs, setUnreadDMs]       = useState(0)
  const fileRef = useRef(null)

  useEffect(() => {
    if (user) {
      getUserTier().then(d => setTier(d.tier || 'free'))
      // Fetch badges
      const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://backend-production-a427a.up.railway.app'
      Promise.all([
        fetch(`${BACKEND}/badges/all`).then(r => r.json()).catch(() => ({ badges: [] })),
        fetch(`${BACKEND}/badges/user/${user.id}`).then(r => r.json()).catch(() => ({ badges: [] })),
      ]).then(([allRes, userRes]) => {
        setAllBadges(allRes.badges || [])
        setOwnedBadgeIds(new Set((userRes.badges || []).map(b => b.id)))
      })
      // Fetch unread DM count
      const fetchUnread = async () => {
        const { count } = await supabase
          .from('direct_messages')
          .select('*', { count: 'exact', head: true })
          .eq('receiver_id', user.id)
          .eq('read', false)
        setUnreadDMs(count || 0)
      }
      fetchUnread()
      const interval = setInterval(fetchUnread, 30000) // poll every 30s
      return () => clearInterval(interval)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    supabase.from('user_reputation').select('username,bio,avatar_url').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data?.username) setUsername(data.username)
        if (data?.bio) setBio(data.bio)
        if (data?.avatar_url) setPfpUrl(data.avatar_url)
        if (data?.wallet_address) setWallet(data.wallet_address)
      })
  }, [user])

  const links = [
    { key: 'home',        label: 'Home',        path: '/' },
    { key: 'analyze',     label: 'Analyzer',    path: '/analyze' },
    { key: 'forum',       label: 'Forum',       path: '/forum' },
    { key: 'tracker',     label: 'Tracker',     path: '/tracker' },
    { key: 'leaderboard', label: 'Leaderboard', path: '/leaderboard' },
    { key: 'pricing',     label: 'Upgrade',     path: '/pricing' },
    { key: 'history',     label: 'History',     path: '/history' },
  ]

  const handleLogo = () => {
    if (onLogoClick) onLogoClick()
    nav('/')
  }

  const saveProfile = async () => {
    setSavingProfile(true); setProfileMsg('')
    await supabase.from('user_reputation').upsert({
      user_id: user.id, email: user.email,
      username: username.trim(), bio: bio.trim(), wallet_address: wallet.trim() || null,
      avatar_url: pfpUrl || null, updated_at: new Date().toISOString()
    })
    setSavingProfile(false); setProfileMsg('Saved!')
    setTimeout(() => setProfileMsg(''), 2000)
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
      // Resize to max 256px via canvas before upload
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
      // Add cache-bust
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
          <span className="nb-version">v0.4</span>
        </div>

        {/* Desktop nav */}
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
          {/* Inbox first */}
          {user && (
            <button className="nb-inbox-btn nb-desktop" onClick={() => { nav('/inbox'); setUnreadDMs(0) }} title="Messages" style={{position:'relative'}}>
              ✉
              {unreadDMs > 0 && (
                <span className="nb-inbox-badge">{unreadDMs > 9 ? '9+' : unreadDMs}</span>
              )}
            </button>
          )}

          {/* Avatar with dropdown */}
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
                  {tier !== 'free' && <div className="nb-tier-badge" style={{color: tier==='omega' ? '#f59e0b' : '#a78bfa'}}>{tier.toUpperCase()}</div>}
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
                  <button className="nb-menu-btn" onClick={() => { setShowProfile(true); setShowMenu(false) }}>
                    My Profile
                  </button>
                  <button className="nb-menu-btn" onClick={() => { setShowBadges(true); setShowMenu(false) }}>
                    🏅 My Badges
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

          {/* Mobile hamburger */}
          <button className="nb-hamburger nb-mobile" onClick={() => setShowMobile(p => !p)}>
            {showMobile ? '✕' : '☰'}
          </button>
        </div>
      </header>

      {/* Mobile menu */}
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
          <button className="nb-mobile-link" onClick={() => { setShowAccount(true); setShowMobile(false) }}>
            Account Settings
          </button>
          <button className="nb-mobile-link nb-mobile-signout" onClick={async () => { await signOut(); nav('/login') }}>
            Sign Out
          </button>
        </div>
      )}

      {/* Account Settings Modal */}
      {showAccount && (
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

            {/* Edit Profile link */}
            <div className="nb-modal-section">
              <button className="nb-menu-btn" style={{padding:0, color:'var(--green)'}}
                onClick={() => { setShowAccount(false); nav('/edit-profile') }}>
                Edit Profile (picture, username, bio, wallet) →
              </button>
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
      )}


      {/* My Profile Modal */}
      {showProfile && (
        <div className="nb-modal-overlay" onClick={() => setShowProfile(false)}>
          <div className="nb-modal" onClick={e => e.stopPropagation()}>
            <div className="nb-modal-header">
              <span>MY PROFILE</span>
              <button className="nb-modal-close" onClick={() => setShowProfile(false)}>✕</button>
            </div>

            {/* Avatar + name */}
            <div className="nb-modal-section">
              <div className="nb-pfp-row">
                <div className="nb-pfp-preview" style={{width:52,height:52,fontSize:16}}>
                  {pfpUrl
                    ? <img src={pfpUrl} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}} alt="" />
                    : initials}
                </div>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:'#fff',marginBottom:2}}>{username || 'No username set'}</div>
                  <div style={{fontSize:10,color:'#555'}}>{user?.email}</div>
                  {tier !== 'free' && (
                    <div className="nb-tier-badge" style={{color: tier==='omega' ? '#f59e0b' : '#a78bfa', display:'inline-block', marginTop:4}}>
                      {tier.toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bio */}
            {bio && (
              <div className="nb-modal-section">
                <div className="nb-modal-label">Bio</div>
                <div className="nb-modal-value" style={{lineHeight:1.5}}>{bio}</div>
              </div>
            )}

            {/* Actions */}
            <div className="nb-modal-section" style={{display:'flex',flexDirection:'column',gap:6,borderBottom:'none'}}>
              <button className="nb-menu-btn" style={{padding:'8px 0',color:'var(--green)'}}
                onClick={() => { setShowProfile(false); nav('/edit-profile') }}>
                ✏️ Edit Profile →
              </button>
              <button className="nb-menu-btn" style={{padding:'8px 0',color:'#7eb8f7'}}
                onClick={() => { setShowProfile(false); setShowBadges(true) }}>
                🏅 View My Badges →
              </button>
              <button className="nb-menu-btn" style={{padding:'8px 0',color:'#94a3b8'}}
                onClick={() => { setShowProfile(false); nav('/history') }}>
                📊 Analysis History →
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Badges Modal */}
      {showBadges && (
        <div className="nb-modal-overlay" onClick={() => setShowBadges(false)}>
          <div className="nb-badges-modal" onClick={e => e.stopPropagation()}>
            <div className="nb-modal-header">
              <span>MY BADGES <span style={{color:'#333',fontWeight:400,fontSize:10,letterSpacing:0}}>· {ownedBadgeIds.size}/{allBadges.length} collected</span></span>
              <button className="nb-modal-close" onClick={() => setShowBadges(false)}>✕</button>
            </div>
            <div className="nb-badges-scroll">
              {allBadges.length === 0
                ? <div style={{color:'#333',fontSize:12,textAlign:'center',padding:'32px 0'}}>Loading...</div>
                : (() => {
                    const CATS = {
                      activity:'Activity', trading:'Trading · PnL', community:'Community',
                      subscription:'Subscription', staff:'Staff', skill:'Skill', fun:'Fun · Rare'
                    }
                    const grouped = {}
                    for (const b of allBadges) {
                      if (!grouped[b.category]) grouped[b.category] = []
                      grouped[b.category].push(b)
                    }
                    return Object.entries(grouped).map(([cat, badges]) => (
                      <div key={cat} className="nb-badge-section">
                        <div className="nb-badge-cat-label">{CATS[cat] || cat}</div>
                        <div className="nb-badge-grid">
                          {badges.map(b => {
                            const owned = ownedBadgeIds.has(b.id)
                            return (
                              <div
                                key={b.id}
                                className={`nb-badge-item ${owned ? 'nb-badge-owned' : 'nb-badge-locked'}`}
                                style={{'--bc': owned ? b.color : '#1a1a1a'}}
                                title={owned ? `${b.name} — ${b.description}` : 'Not yet unlocked'}
                              >
                                <div className="nb-badge-emoji">{owned ? b.emoji : '◆'}</div>
                                <div className="nb-badge-name">{owned ? b.name : '???'}</div>
                                {owned && <div className={`nb-badge-rarity nb-badge-rarity--${b.rarity}`}>{b.rarity}</div>}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  })()
              }
            </div>
            <div className="nb-badges-footer">
              <span>{ownedBadgeIds.size} / {allBadges.length} collected</span>
              <button className="nb-badges-manage-btn" onClick={() => { setShowBadges(false); nav('/badges') }}>
                Manage equipped →
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}
