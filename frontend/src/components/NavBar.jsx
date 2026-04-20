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
  const fileRef = useRef(null)

  useEffect(() => {
    if (user) {
      getUserTier().then(d => setTier(d.tier || 'free'))
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
          <span className="nb-version">v0.1</span>
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
            <button className="nb-inbox-btn nb-desktop" onClick={() => nav('/inbox')} title="Messages">
              ✉
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
                  <button className="nb-menu-btn" onClick={() => { nav('/profile/' + (username || user.email?.split('@')[0])); setShowMenu(false) }}>
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

    </>
  )
}
