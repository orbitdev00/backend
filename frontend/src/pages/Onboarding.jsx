import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import StarField from '../components/StarField'
import './Onboarding.css'

const TOTAL_STEPS = 3 // 0: username  1: avatar  2: welcome

export default function Onboarding() {
  const nav          = useNavigate()
  const { user }     = useAuth()   // ProtectedRoute guarantees this is non-null on mount
  const fileRef      = useRef(null)
  const checkRef     = useRef(null)

  const [step, setStep]                     = useState(0)
  const [username, setUsername]             = useState('')
  const [usernameStatus, setUsernameStatus] = useState('idle') // idle|checking|available|taken|invalid
  const [pfpPreview, setPfpPreview]         = useState(null)
  const [pfpFile, setPfpFile]               = useState(null)
  const [isDragging, setIsDragging]         = useState(false)
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState('')

  // Debounced live username availability check.
  // Hard 2s cap so a slow/failing query never blocks the user.
  useEffect(() => {
    const u = username.trim()
    if (!u) { setUsernameStatus('idle'); return }
    if (u.length < 3 || !/^[a-zA-Z0-9_]+$/.test(u)) { setUsernameStatus('invalid'); return }

    setUsernameStatus('checking')
    let active = true

    const hardTimeout = setTimeout(() => {
      if (active) { active = false; setUsernameStatus('available') }
    }, 2000)

    checkRef.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.from('user_reputation')
          .select('username').eq('username', u).maybeSingle()
        clearTimeout(hardTimeout)
        if (!active) return
        if (error) { console.warn('Username check error:', error); setUsernameStatus('available'); return }
        setUsernameStatus(data ? 'taken' : 'available')
      } catch (e) {
        clearTimeout(hardTimeout)
        if (active) { console.warn('Username check failed:', e); setUsernameStatus('available') }
      }
    }, 500)

    return () => {
      active = false
      clearTimeout(hardTimeout)
      clearTimeout(checkRef.current)
    }
  }, [username])

  const processFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = e => setPfpPreview(e.target.result)
    reader.readAsDataURL(file)
    setPfpFile(file)
  }, [])

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    processFile(e.dataTransfer.files[0])
  }

  const saveAndLaunch = async () => {
    setSaving(true)
    setError('')
    try {
      let avatarUrl = typeof pfpPreview === 'string' && !pfpPreview.startsWith('data:')
        ? pfpPreview
        : null

      if (pfpFile) {
        const bitmap = await createImageBitmap(pfpFile)
        const size   = Math.min(bitmap.width, bitmap.height, 256)
        const canvas = document.createElement('canvas')
        canvas.width = size; canvas.height = size
        const ctx    = canvas.getContext('2d')
        const scale  = size / Math.min(bitmap.width, bitmap.height)
        const w = bitmap.width * scale, h = bitmap.height * scale
        ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85))
        const path = `${user.id}/avatar.jpg`
        const { error: uploadErr } = await supabase.storage.from('avatars')
          .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
        if (!uploadErr) {
          const { data } = supabase.storage.from('avatars').getPublicUrl(path)
          avatarUrl = data.publicUrl + '?t=' + Date.now()
        }
      }

      const { error: saveErr } = await supabase.from('user_reputation').upsert({
        user_id:    user.id,
        email:      user.email,
        username:   username.trim(),
        avatar_url: avatarUrl || null,
        updated_at: new Date().toISOString(),
      })

      if (saveErr) {
        setError(saveErr.message)
        setSaving(false)
        return
      }

      // Full reload so AuthContext re-fetches the updated profile
      window.location.href = '/'
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const advance = async () => {
    if (step === 0) {
      if (usernameStatus !== 'available') return
      setStep(1)
    } else if (step === 1) {
      setStep(2)
    } else {
      await saveAndLaunch()
    }
  }

  const initials = (username || user?.email || '??').slice(0, 2).toUpperCase()

  return (
    <div className="ob-root">
      <StarField />

      <div className="ob-card">
        <div className="ob-wordmark">ORBIT</div>

        <div className="ob-dots">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`ob-dot${i === step ? ' ob-dot--active' : i < step ? ' ob-dot--done' : ''}`}
            />
          ))}
        </div>

        <div className="ob-content" key={step}>

          {/* ── Step 0: Username ──────────────────────────────────── */}
          {step === 0 && (
            <div className="ob-step">
              <h1 className="ob-heading">Choose your username</h1>
              <p className="ob-sub">How you'll appear on the leaderboard, forum, and profile.</p>

              <div className="ob-field">
                <input
                  className={`ob-input${
                    usernameStatus === 'available' ? ' ob-input--ok'  :
                    usernameStatus === 'taken' || usernameStatus === 'invalid' ? ' ob-input--err' : ''
                  }`}
                  placeholder="choose your username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && usernameStatus === 'available' && advance()}
                  maxLength={30}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="ob-field-hint">
                  {usernameStatus === 'checking' && <span className="ob-hint--muted">checking…</span>}
                  {usernameStatus === 'available' && <span className="ob-hint--ok">✓ available</span>}
                  {usernameStatus === 'taken'     && <span className="ob-hint--err">✗ already taken</span>}
                  {usernameStatus === 'invalid' && username.trim() &&
                    <span className="ob-hint--err">letters, numbers, underscores only · min 3 chars</span>}
                </div>
              </div>

              <button
                className="ob-btn"
                onClick={advance}
                disabled={usernameStatus !== 'available'}
              >
                Continue →
              </button>
              <button className="ob-skip" onClick={() => { window.location.href = '/' }}>Skip for now</button>
            </div>
          )}

          {/* ── Step 1: Avatar ────────────────────────────────────── */}
          {step === 1 && (
            <div className="ob-step ob-step--center">
              <h1 className="ob-heading">Add a profile photo</h1>
              <p className="ob-sub">Optional — you can change this any time from your profile.</p>

              <div
                className="ob-avatar-ring"
                onClick={() => fileRef.current?.click()}
                title="Click to upload"
              >
                {pfpPreview
                  ? <img src={pfpPreview} alt="" className="ob-avatar-img" />
                  : <span className="ob-avatar-initials">{initials}</span>}
              </div>

              <div
                className={`ob-drop${isDragging ? ' ob-drop--over' : ''}`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragEnter={() => setIsDragging(true)}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <span className="ob-drop-arrow">↑</span>
                <span className="ob-drop-label">
                  {pfpPreview ? 'Click or drag to replace' : 'Click or drag a photo here'}
                </span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => processFile(e.target.files[0])}
              />

              <button className="ob-btn" onClick={advance}>
                {pfpPreview ? 'Continue →' : 'Skip — no photo'}
              </button>
            </div>
          )}

          {/* ── Step 2: Welcome ───────────────────────────────────── */}
          {step === 2 && (
            <div className="ob-step ob-step--welcome">
              <div className="ob-welcome-avatar">
                {pfpPreview
                  ? <img src={pfpPreview} alt="" className="ob-avatar-img" />
                  : <span className="ob-avatar-initials ob-avatar-initials--lg">{initials}</span>}
              </div>

              <h1 className="ob-heading ob-heading--lg">
                gm, <span className="ob-heading--purple">{username}</span>.
              </h1>
              <p className="ob-sub">You're all set. Time to find your edge.</p>

              {error && <div className="ob-error">{error}</div>}

              <button className="ob-btn ob-btn--launch" onClick={advance} disabled={saving}>
                {saving ? 'Setting up…' : 'Start Analyzing →'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
