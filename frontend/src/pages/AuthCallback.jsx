import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import orbitPfp from '../orbitPfp.js'
import './Auth.css'

export default function AuthCallback() {
  const [status, setStatus] = useState('verifying')
  const [error, setError]   = useState('')

  // Email confirmation — just redirect, no provider checks needed
  const finishEmail = async (session) => {
    setStatus('success')
    const { data: rep } = await supabase
      .from('user_reputation')
      .select('username')
      .eq('user_id', session.user.id)
      .single()
    setTimeout(() => { window.location.href = (!rep?.username) ? '/edit-profile?onboarding=1' : '/' }, 1200)
  }

  // Google OAuth — check for provider conflict then record provider
  const finishGoogle = async (session) => {
    const user  = session.user
    const email = user.email?.trim().toLowerCase()

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

  const finishRecovery = () => {
    setStatus('success')
    setTimeout(() => { window.location.href = '/update-password' }, 1200)
  }

  // Route to the correct handler based on which provider established the session
  const finishSession = async (session) => {
    const provider = session.user.app_metadata?.provider
    if (provider === 'google') {
      await finishGoogle(session)
    } else {
      await finishEmail(session)
    }
  }

  useEffect(() => {
    let done = false

    const finish = async (session, isRecovery = false) => {
      if (done) return
      done = true
      if (isRecovery) {
        finishRecovery()
      } else {
        await finishSession(session)
      }
    }

    // Safety net: supabase fires SIGNED_IN / PASSWORD_RECOVERY once it finishes processing URL tokens.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session)          await finish(session, false)
      if (event === 'PASSWORD_RECOVERY' && session)  await finish(session, true)
    })

    const handleCallback = async () => {
      try {
        // getSession() waits for supabase's internal init (including URL token detection)
        // to complete, so a session here means supabase already handled the tokens.
        const { data, error } = await supabase.auth.getSession()
        if (error) { setError(error.message); setStatus('error'); return }

        const params       = new URLSearchParams(window.location.search)
        const hashParams   = new URLSearchParams(window.location.hash.slice(1))
        const tokenHash    = params.get('token_hash')
        const type         = params.get('type') || hashParams.get('type') || 'signup'
        const isRecovery   = type === 'recovery'
        const code         = params.get('code')
        const accessToken  = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')

        if (data.session) { await finish(data.session, isRecovery); return }

        if (tokenHash) {
          // OTP / magic-link format — supabase doesn't auto-handle this, must call verifyOtp
          const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
          if (otpError) { setError(otpError.message); setStatus('error'); return }
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) { setError('Verification failed. Please try signing in.'); setStatus('error'); return }
          await finish(session, isRecovery)
        } else if (code) {
          // PKCE code — try exchange (works on same device; cross-device requires implicit flow)
          const { error: exchError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchError) {
            setError('Confirmation link expired or was opened in a different browser. Please request a new confirmation email.')
            setStatus('error')
            return
          }
          const { data: { session } } = await supabase.auth.getSession()
          await finish(session, isRecovery)
        } else if (accessToken) {
          // Hash-fragment tokens (#access_token=...) — supabase should auto-handle these,
          // but fall back to manual setSession just in case
          const { error: setErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          })
          if (setErr) { setError(setErr.message); setStatus('error'); return }
          const { data: { session } } = await supabase.auth.getSession()
          await finish(session, isRecovery)
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
    return () => subscription.unsubscribe()
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
