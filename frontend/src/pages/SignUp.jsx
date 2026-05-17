import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import orbitPfp from '../orbitPfp.js'
import './Auth.css'

function ConfirmWaiting({ email, onSwitch }) {
  const navigate = useNavigate()
  const [resending, setResending] = useState(false)
  const [resent, setResent]       = useState(false)

  // If the user confirms in another tab on the same browser, auto-redirect
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') navigate('/')
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleResend = async () => {
    setResending(true)
    await supabase.auth.resend({ type: 'signup', email })
    setResent(true)
    setResending(false)
  }

  return (
    <div className="auth-page orbit-page-fadein">
      <div className="auth-card">
        <img src={orbitPfp} alt="ORBIT" className="auth-logo" />
        <h1 className="auth-title">Check your email</h1>
        <p className="auth-sub" style={{textAlign:'center',maxWidth:280,marginBottom:16}}>
          We sent an activation link to <strong>{email}</strong>. Open it to access ORBIT.
        </p>
        <p className="auth-sub" style={{fontSize:11,color:'#444',textAlign:'center'}}>
          Check your spam folder if you don't see it within a minute.
        </p>
        {!resent ? (
          <button className="link-btn" style={{marginTop:8}} onClick={handleResend} disabled={resending}>
            {resending ? 'Resending...' : 'Resend email'}
          </button>
        ) : (
          <p style={{fontSize:12,color:'var(--green)',marginTop:8}}>✓ Sent again</p>
        )}
        <button className="btn-primary" style={{marginTop:16,width:'100%'}} onClick={() => onSwitch('login')}>
          Already confirmed? Sign in
        </button>
      </div>
    </div>
  )
}

export default function SignUp({ onSwitch }) {
  const { signUp, signInWithGoogle } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [error, setError]         = useState('')
  const [emailError, setEmailError] = useState('')
  const [success, setSuccess]     = useState(false)
  const [loading, setLoading]     = useState(false)
  const [checking, setChecking]   = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setEmailError('')

    // Synchronous validation — no DB hit needed
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return }
    if (!username.trim()) { setError('Username is required'); return }
    if (username.trim().length < 3) { setError('Username must be at least 3 characters'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) { setError('Username: letters, numbers and underscores only'); return }

    // DB checks — show "Checking..." while queries run
    setChecking(true)
    setLoading(true)

    // 1. Username uniqueness
    const { data: takenUser } = await supabase.from('user_reputation')
      .select('user_id').eq('username', username.trim()).maybeSingle()
    if (takenUser) {
      setError('Username already taken')
      setChecking(false); setLoading(false); return
    }

    // 2. Email conflict — check BEFORE calling signUp so Supabase never sees the request
    const { data: existingEmail } = await supabase.from('user_reputation')
      .select('auth_provider').eq('email', email.trim().toLowerCase()).maybeSingle()
    if (existingEmail?.auth_provider === 'google') {
      setEmailError('This email is linked to a Google account. Use "Sign in with Google" instead.')
      setChecking(false); setLoading(false); return
    }
    if (existingEmail?.auth_provider === 'email') {
      setEmailError('An account with this email already exists. Sign in instead.')
      setChecking(false); setLoading(false); return
    }

    // 3. No conflict — proceed with signup
    setChecking(false)
    const { data: authData, error } = await signUp(email, password)
    if (error) {
      const msg = error.message?.toLowerCase() || ''
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('email address is already')) {
        setEmailError('This email is already registered. Sign in or reset your password.')
      } else {
        setError(error.message)
      }
      setLoading(false); return
    }

    // Save username and auth provider
    if (authData?.user) {
      await supabase.from('user_reputation').upsert({
        user_id: authData.user.id,
        email: email.trim().toLowerCase(),
        username: username.trim(),
        auth_provider: 'email',
        created_at: new Date().toISOString(),
      })
    }
    setSuccess(true)
    setLoading(false)
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    const { error } = await signInWithGoogle()
    if (error) { setError(error.message); setGoogleLoading(false) }
  }

  if (success) {
    return <ConfirmWaiting email={email} onSwitch={onSwitch} />
  }

  return (
    <div className="auth-page orbit-page-fadein">
      <div className="auth-card">
        <img src={orbitPfp} alt="ORBIT" className="auth-logo" />
        <h1 className="auth-title">ORBIT</h1>
        <p className="auth-sub">Create your account</p>

        <button className="btn-google" onClick={handleGoogle} disabled={googleLoading}>
          <svg width="16" height="16" viewBox="0 0 24 24" style={{flexShrink:0}}>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {googleLoading ? 'Redirecting...' : 'Continue with Google'}
        </button>

        <div className="auth-divider"><span>or</span></div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label>Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="letters, numbers, underscores" required autoComplete="off" maxLength={30} />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => { setEmail(e.target.value); setEmailError('') }}
              placeholder="you@example.com" required autoComplete="email" />
            {emailError && <div style={{fontSize:11, color:'#ef4444', marginTop:4, fontFamily:'var(--mono)'}}>{emailError}</div>}
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Min 8 characters" required autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Confirm password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••" required autoComplete="new-password" />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {checking ? 'Checking...' : loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <div className="auth-footer">
          <span>Already have an account? <button className="link-btn" onClick={() => onSwitch('login')}>Sign in</button></span>
        </div>
      </div>
    </div>
  )
}
