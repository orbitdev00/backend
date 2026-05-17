import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import orbitPfp from '../orbitPfp.js'
import './Auth.css'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('verifying')
  const [error, setError]   = useState('')

  const finishEmail = async (session) => {
    setStatus('success')
    const { data: rep } = await supabase
      .from('user_reputation')
      .select('username')
      .eq('user_id', session.user.id)
      .maybeSingle()
    setTimeout(() => navigate(rep?.username ? '/' : '/onboarding'), 1200)
  }

  const finishGoogle = async (session) => {
    const user  = session.user
    const email = user.email?.trim().toLowerCase()

    // Block if this email already belongs to an email/password account
    const { data: existing } = await supabase
      .from('user_reputation')
      .select('auth_provider, user_id')
      .eq('email', email)
      .maybeSingle()
    if (existing && existing.user_id !== user.id && existing.auth_provider === 'email') {
      await supabase.auth.signOut()
      setError('An account with this email already exists. Please sign in with your email and password instead.')
      setStatus('error')
      return
    }

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
      .maybeSingle()
    // New Google users (no username) → onboarding; returning users → home
    setTimeout(() => navigate(rep?.username ? '/' : '/onboarding'), 1200)
  }

  const finishRecovery = () => {
    setStatus('success')
    setTimeout(() => navigate('/update-password'), 1200)
  }

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session)         await finish(session, false)
      if (event === 'PASSWORD_RECOVERY' && session) await finish(session, true)
    })

    const handleCallback = async () => {
      try {
        const params     = new URLSearchParams(window.location.search)
        const hashParams = new URLSearchParams(window.location.hash.slice(1))
        const code       = params.get('code')
        const tokenHash  = params.get('token_hash')
        // explicitType is null for Google OAuth PKCE callbacks (no type param in URL).
        // Defaulting to 'signup' would incorrectly treat OAuth codes as email confirmations
        // and call signOut() before the code exchange, breaking the OAuth flow.
        const explicitType = params.get('type') || hashParams.get('type')
        const type         = explicitType || 'signup'
        const isRecovery   = type === 'recovery'
        const accessToken  = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')

        // Only true when Supabase explicitly sets type=signup — email confirmations only.
        // Google OAuth PKCE sends ?code= with no type param, so explicitType is null there.
        const isSignupToken = (code || tokenHash) && explicitType === 'signup'

        if (isSignupToken) {
          // Sign out any existing session before exchanging the confirmation token.
          // This prevents a logged-in account from being reused instead of the
          // newly confirmed one (e.g. mobile confirms, desktop has a different session).
          await supabase.auth.signOut()
        } else {
          // Non-signup flows: if the SDK already has a session (e.g. OAuth redirect
          // handled implicitly), use it directly.
          const { data: { session: existing } } = await supabase.auth.getSession()
          if (existing) { await finish(existing, isRecovery); return }
        }

        if (code) {
          // PKCE code — the standard Supabase email confirmation format
          const { data, error: exchError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchError) {
            // Token already consumed (confirmed on mobile, link re-opened on desktop)
            if (isSignupToken) { navigate('/login?verified=1'); return }
            setError('This confirmation link has expired or was already used. Please request a new one.')
            setStatus('error')
            return
          }
          await finish(data.session, isRecovery)
        } else if (tokenHash) {
          // OTP token_hash — used when Supabase is in OTP/implicit mode
          const { data: verifyData, error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
          if (otpError) {
            if (isSignupToken) { navigate('/login?verified=1'); return }
            setError(otpError.message); setStatus('error'); return
          }
          const confirmedEmail = verifyData.user?.email
          const session = verifyData?.session ?? (await supabase.auth.getSession()).data.session
          if (!session) {
            setStatus('success')
            setTimeout(() => navigate('/login'), 1200)
            return
          }
          // Guard against the getSession() fallback returning a stale session
          if (confirmedEmail && session.user.email !== confirmedEmail) {
            await supabase.auth.signOut()
            setError('Session mismatch — please sign in with your confirmed account.')
            setStatus('error')
            return
          }
          await finish(session, isRecovery)
        } else if (accessToken) {
          // Hash-fragment tokens from implicit OAuth redirect
          const { error: setErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          })
          if (setErr) { setError(setErr.message); setStatus('error'); return }
          const { data: { session } } = await supabase.auth.getSession()
          await finish(session, isRecovery)
        } else {
          // No recognisable token in the URL — the link may have been opened on a
          // second device after already being consumed on the first. Send the user
          // to /login with the verified banner so they know to sign in manually.
          navigate('/login?verified=1')
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
              onClick={() => navigate('/')}>
              Go to sign in
            </button>
          </>
        )}
      </div>
    </div>
  )
}
