import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import NavBar from '../components/NavBar'
import './EditProfile.css'

export default function EditProfile() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [username, setUsername]   = useState('')
  const [bio, setBio]             = useState('')
  const [wallet, setWallet]       = useState('')
  const [pfpUrl, setPfpUrl]       = useState(null)
  const [showPnl, setShowPnl]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [error, setError]         = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (!user) { nav('/login'); return }
    loadProfile()
  }, [user])

  const loadProfile = async () => {
    const { data } = await supabase.from('user_reputation')
      .select('username,bio,wallet_address,avatar_url')
      .eq('user_id', user.id).single()
    if (data) {
      setUsername(data.username || '')
      setBio(data.bio || '')
      setWallet(data.wallet_address || '')
      setPfpUrl(data.avatar_url || null)
    }
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
      const { error: uploadErr } = await supabase.storage.from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (uploadErr) { setError('Upload failed: ' + uploadErr.message); setUploading(false); return }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setPfpUrl(data.publicUrl + '?t=' + Date.now())
    } catch(err) { setError('Upload error: ' + err.message) }
    setUploading(false)
  }


  const save = async () => {
    if (!username.trim()) { setError('Username is required.'); return }
    if (username.trim().length < 3) { setError('Username must be at least 3 characters.'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) { setError('Username can only contain letters, numbers and underscores.'); return }
    setSaving(true); setError(''); setMsg('')

    // Check username uniqueness
    const { data: existing } = await supabase.from('user_reputation')
      .select('user_id').eq('username', username.trim()).single()
    if (existing && existing.user_id !== user.id) {
      setError('Username already taken.')
      setSaving(false); return
    }

    const { error: saveErr } = await supabase.from('user_reputation').upsert({
      user_id: user.id,
      email: user.email,
      username: username.trim(),
      bio: bio.trim(),
      wallet_address: wallet.trim() || null,
      show_pnl: showPnl,
      avatar_url: pfpUrl || null,
      updated_at: new Date().toISOString(),
    })

    if (saveErr) { setError(saveErr.message); setSaving(false); return }
    setMsg('Profile saved!')
    setSaving(false)
    setTimeout(() => nav(`/profile/${username.trim()}`), 800)
  }

  const initials = username?.slice(0,2).toUpperCase() || user?.email?.slice(0,2).toUpperCase()

  return (
    <div className="ep-screen">
      <NavBar />
      <div className="ep-body">
        <div className="ep-header">
          <button className="ep-back" onClick={() => nav(-1)}>← Back</button>
          <h2>Edit Profile</h2>
        </div>

        <div className="ep-card">
          {/* PFP */}
          <div className="ep-section">
            <div className="ep-label">Profile Picture</div>
            <div className="ep-pfp-row">
              <div className="ep-pfp-preview" onClick={() => fileRef.current?.click()}>
                {pfpUrl ? <img src={pfpUrl} alt="" /> : <span>{initials}</span>}
                <div className="ep-pfp-overlay">Upload</div>
              </div>
              <div>
                <button className="ep-upload-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading...' : 'Choose Photo'}
                </button>
                <div className="ep-hint">Square image recommended. Max 5MB.</div>
                <div className="ep-hint">Requires Supabase Storage bucket "avatars" to be public.</div>
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePfpUpload} />
            </div>
          </div>

          {/* Username */}
          <div className="ep-section">
            <div className="ep-label">Username <span className="ep-required">*</span></div>
            <input className="ep-input" placeholder="username" value={username}
              onChange={e => setUsername(e.target.value)} maxLength={30} />
            <div className="ep-hint">Letters, numbers and underscores only. Min 3 characters.</div>
          </div>

          {/* Bio */}
          <div className="ep-section">
            <div className="ep-label">Bio</div>
            <textarea className="ep-input ep-textarea" placeholder="Tell the community about yourself..."
              value={bio} onChange={e => setBio(e.target.value)} maxLength={160} rows={3} />
            <div className="ep-hint">{bio.length}/160</div>
          </div>

          {/* Wallet */}
          <div className="ep-section">
            <div className="ep-label">Solana Wallet <span className="ep-optional">(optional)</span></div>
            <input className="ep-input ep-mono" placeholder="Your public wallet address..."
              value={wallet} onChange={e => setWallet(e.target.value)} maxLength={44} />
            <div className="ep-hint" style={{color:'#555'}}>
              🔒 Read-only public data only. We never request access, signatures, or private keys.
            </div>
          </div>

          {/* Show PnL toggle */}
          <div className="ep-section">
            <div className="ep-label">PnL Visibility</div>
            <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
              <div
                onClick={() => setShowPnl(p => !p)}
                style={{
                  width:36, height:20, borderRadius:10, position:'relative', cursor:'pointer',
                  background: showPnl ? 'var(--green)' : '#222',
                  border: '1px solid', borderColor: showPnl ? 'var(--green)' : '#333',
                  transition:'background 0.2s',
                }}>
                <div style={{
                  position:'absolute', top:2, left: showPnl ? 17 : 2,
                  width:14, height:14, borderRadius:'50%', background:'#fff',
                  transition:'left 0.2s',
                }} />
              </div>
              <span style={{fontSize:12, color: showPnl ? '#ccc' : '#555'}}>
                {showPnl ? 'PnL visible on your profile' : 'PnL hidden from others'}
              </span>
            </label>
            <div className="ep-hint">When enabled, your monthly net SOL is shown on your public profile.</div>
          </div>



          {error && <div className="ep-error">{error}</div>}
          {msg && <div className="ep-success">{msg}</div>}

          <div className="ep-actions">
            <button className="ep-cancel" onClick={() => nav(-1)}>Cancel</button>
            <button className="ep-save" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
