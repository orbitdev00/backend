import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import orbitPfp from '../orbitPfp.js'
import './Auth.css'

export default function AuthCallback() {
  const [status, setStatus] = useState('verifying')
  const [error, setError]   = useState('')

  const finishGoogle = async (session) => {
    const user  = session.user
    const email = user.email?.trim().toLowerCase()

    // Block if the email was registered via email/password
    try {
      const { data: existing } = await supabase
        .from('user_reputation')
        .select('auth_provider, user_id')
        .eq('email', email)
        .single()
      if (existing && existing.user_id !== user.id && existing.auth_provider === 'email') {
        await supabase.auth.signOut()
        setError('An account with this email already exists. Please sign in with your email and password.')
        setStatus('error')
        return
      }
    } catch (_) { /* no existing row — safe */ }

    // Record Google as the auth provider on first login
    await supabase.from('user_reputation').upsert({
      user_id: user.id,
      email,
      auth_provider: 'google',
    }, { onConflict: 'user_id', ignoreDuplicates: false })

    setStatus('success')
    const { data: rep } = await supabase
      .from('user_reputation')
      .select('username')
      .eq('user_id', user.id)
      .single()
    setTimeout(() => { window.location.href = (!rep?.username) ? '/edit-profile?onboarding=1' : '/' }, 1200)
  }

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) { setError(error.message); setStatus('error'); return }

        if (data.session) {
          await finishGoogle(data.session)
          return
        }

        const params     = new URLSearchParams(window.location.search)
        const hashParams = new URLSearchParams(window.location.hash.slice(1))
        const code        = params.get('code')
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')

        if (code) {
          const { error: exchError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchError) { setError(exchError.message); setStatus('error'); return }
          const { data: { session } } = await supabase.auth.getSession()
          await finishGoogle(session)
        } else if (accessToken) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          })
          if (setErr) { setError(setErr.message); setStatus('error'); return }
          const { data: { session } } = await supabase.auth.getSession()
          await finishGoogle(session)
        } else {
          setError('No auth token found. Please try signing in again.')
          setStatus('error')
        }
      } catch (e) {
        setError(e.message)
        setStatus('error')
      }
    }

    handleCallback()
  }, [])

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={orbitPfp} alt="ORBIT" className="auth-logo" style={{
          animation: status === 'verifying' ? 'pulse 1.4s ease-in-out infinite' : 'none'
        }} />
        <h1 className="auth-title">ORBIT</h1>

        {status === 'verifying' && (
          <>
            <div className="loading-spinner" style={{marginTop: 8}} />
            <p className="auth-sub" style={{marginTop: 12}}>Verifying your account...</p>
          </>
        )}

        {status === 'success' && (
          <p className="auth-sub" style={{color: 'var(--green)', marginTop: 8}}>
            ✓ Account verified — redirecting...
          </p>
        )}

        {status === 'error' && (
          <>
            <div className="auth-error" style={{marginTop: 8, width: '100%', textAlign: 'center'}}>
              {error}
            </div>
            <button className="btn-primary" style={{marginTop: 12}}
              onClick={() => window.location.href = '/'}>
              Go to sign in
            </button>
          </>
        )}
      </div>
    </div>
  )
}
