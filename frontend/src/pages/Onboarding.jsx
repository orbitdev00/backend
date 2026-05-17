import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import StarField from '../components/StarField'
import orbitPfp from '../orbitPfp.js'
import './Onboarding.css'

const SLIDES = [
  {
    id: 'welcome',
    title: 'Welcome to Orbit.',
    sub: 'The Solana memecoin analysis platform built for degens who want an edge.',
  },
  {
    id: 'what',
    title: 'What Orbit does.',
    sub: 'Paste any Solana contract address and get an instant deep analysis — rug risk, market cap prediction, momentum score, dev history, bundle detection, and more.',
  },
  {
    id: 'community',
    title: 'More than a tool.',
    sub: 'Track wallets, compare PnL with other traders, post calls in the forum, and earn badges as you build your reputation.',
  },
  {
    id: 'analyze',
    title: "You're ready.",
    sub: 'Run your first analysis to see Orbit in action, or head straight to home.',
  },
]

export default function Onboarding() {
  const nav = useNavigate()
  const { user } = useAuth()
  const fileRef = useRef(null)

  const [phase, setPhase]           = useState('setup') // 'setup' | 'slides'
  const [slideIdx, setSlideIdx]     = useState(0)
  const [username, setUsername]     = useState('')
  const [pfpUrl, setPfpUrl]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [setupError, setSetupError] = useState('')
  const [mint, setMint]             = useState('')
  const [caError, setCaError]       = useState('')

  useEffect(() => {
    if (!user) { nav('/login'); return }
    supabase.from('user_reputation').select('username,avatar_url').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data?.avatar_url) setPfpUrl(data.avatar_url)
        // Already has a username — skip setup, go straight to slides
        if (data?.username) { setUsername(data.username); setPhase('slides') }
      })
  }, [user])

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
      ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85))
      const path = `${user.id}/avatar.jpg`
      const { error: uploadErr } = await supabase.storage.from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (uploadErr) { setSetupError('Upload failed.'); setUploading(false); return }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setPfpUrl(data.publicUrl + '?t=' + Date.now())
    } catch { setSetupError('Upload error.') }
    setUploading(false)
  }

  const handleSaveProfile = async () => {
    const u = username.trim()
    if (!u) { setSetupError('Username is required.'); return }
    if (u.length < 3) { setSetupError('Username must be at least 3 characters.'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(u)) { setSetupError('Letters, numbers and underscores only.'); return }
    setSaving(true); setSetupError('')

    const { data: taken } = await supabase.from('user_reputation')
      .select('user_id').eq('username', u).single()
    if (taken && taken.user_id !== user.id) {
      setSetupError('Username already taken.'); setSaving(false); return
    }

    const { error: saveErr } = await supabase.from('user_reputation').upsert({
      user_id: user.id,
      email: user.email,
      username: u,
      avatar_url: pfpUrl || null,
      updated_at: new Date().toISOString(),
    })
    if (saveErr) { setSetupError(saveErr.message); setSaving(false); return }
    setSaving(false)
    setPhase('slides')
  }

  const isLastSlide = slideIdx === SLIDES.length - 1

  function handleNextSlide() {
    if (isLastSlide) {
      if (!mint.trim()) { setCaError('Paste a contract address to continue.'); return }
      nav(`/analyze?mint=${encodeURIComponent(mint.trim())}`)
    } else {
      setSlideIdx(i => i + 1)
    }
  }

  const initials = (username || user?.email || '??').slice(0, 2).toUpperCase()

  // ── Profile setup phase ──────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="ob-screen">
        <StarField />
        <div className="ob-card">
          <div className="ob-logo-row">
            <img src={orbitPfp} className="ob-logo" alt="" />
            <span className="ob-logo-text">ORBIT</span>
          </div>

          <div className="ob-content" style={{minHeight: 'unset', marginBottom: 24}}>
            <h1 className="ob-title">Set up your profile</h1>
            <p className="ob-sub">Choose a username to get started. You can change it any time.</p>
          </div>

          {/* Avatar */}
          <div style={{display:'flex', alignItems:'center', gap:16, marginBottom:20}}>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                width:64, height:64, borderRadius:'50%',
                background:'#111', border:'1px solid #2a2a2a',
                display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', overflow:'hidden', flexShrink:0, position:'relative',
              }}
            >
              {pfpUrl
                ? <img src={pfpUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} />
                : <span style={{fontFamily:'var(--mono)',fontSize:18,color:'#475569'}}>{initials}</span>}
              <div style={{
                position:'absolute', inset:0, background:'rgba(0,0,0,0.5)',
                display:'flex', alignItems:'center', justifyContent:'center',
                opacity:0, transition:'opacity 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.opacity = 1}
                onMouseLeave={e => e.currentTarget.style.opacity = 0}
              >
                <span style={{color:'#fff',fontSize:18}}>{uploading ? '…' : '+'}</span>
              </div>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                background:'none', border:'1px solid #1e1e1e', borderRadius:6,
                color:'#64748b', fontFamily:'var(--mono)', fontSize:11,
                padding:'7px 14px', cursor:'pointer',
              }}
            >
              {uploading ? 'Uploading...' : 'Upload photo (optional)'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePfpUpload} />
          </div>

          {/* Username */}
          <div className="ob-input-wrap" style={{marginTop:0}}>
            <input
              className="ob-input"
              placeholder="Username..."
              value={username}
              onChange={e => { setUsername(e.target.value); setSetupError('') }}
              onKeyDown={e => e.key === 'Enter' && handleSaveProfile()}
              maxLength={30}
              autoFocus
            />
            {setupError && <div className="ob-error">{setupError}</div>}
          </div>

          <div className="ob-actions" style={{marginTop:24}}>
            <button className="ob-btn-primary" onClick={handleSaveProfile} disabled={saving}>
              {saving ? 'Saving...' : 'Continue →'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Slides phase ─────────────────────────────────────────────────────────
  const current = SLIDES[slideIdx]
  return (
    <div className="ob-screen">
      <StarField />
      <div className="ob-card">
        <div className="ob-logo-row">
          <img src={orbitPfp} className="ob-logo" alt="" />
          <span className="ob-logo-text">ORBIT</span>
        </div>

        <div className="ob-steps">
          {SLIDES.map((_, i) => (
            <div key={i} className={`ob-step-dot ${i === slideIdx ? 'ob-step-dot--active' : ''} ${i < slideIdx ? 'ob-step-dot--done' : ''}`} />
          ))}
        </div>

        <div className="ob-content">
          <h1 className="ob-title">{current.title}</h1>
          <p className="ob-sub">{current.sub}</p>

          {isLastSlide && (
            <div className="ob-input-wrap">
              <input
                className="ob-input"
                placeholder="Paste contract address..."
                value={mint}
                onChange={e => { setMint(e.target.value); setCaError('') }}
                onKeyDown={e => e.key === 'Enter' && handleNextSlide()}
                autoFocus
              />
              {caError && <div className="ob-error">{caError}</div>}
            </div>
          )}
        </div>

        <div className="ob-actions">
          <button className="ob-btn-primary" onClick={handleNextSlide}>
            {isLastSlide ? '🔭 Run Analysis' : 'Continue →'}
          </button>
          <button className="ob-btn-skip" onClick={() => nav('/')}>
            {isLastSlide ? 'Skip — go to home' : 'Skip for now'}
          </button>
        </div>
      </div>
    </div>
  )
}
