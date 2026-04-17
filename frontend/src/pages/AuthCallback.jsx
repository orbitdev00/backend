import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import orbitPfp from '../orbitPfp.js'
import './Auth.css'

export default function AuthCallback() {
  const [status, setStatus] = useState('verifying')
  const [error, setError]   = useState('')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Parse the URL hash/params that Supabase sends back
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          setError(error.message)
          setStatus('error')
          return
        }

        if (data.session) {
          setStatus('success')
          // Redirect to app after short delay
          setTimeout(() => {
            window.location.href = '/'
          }, 1500)
        } else {
          // Try exchanging the code from URL
          const params = new URLSearchParams(window.location.search)
          const hashParams = new URLSearchParams(window.location.hash.slice(1))

          const code         = params.get('code')
          const accessToken  = hashParams.get('access_token')
          const refreshToken = hashParams.get('refresh_token')

          if (code) {
            const { error: exchError } = await supabase.auth.exchangeCodeForSession(code)
            if (exchError) { setError(exchError.message); setStatus('error'); return }
            setStatus('success')
            setTimeout(() => { window.location.href = '/' }, 1500)
          } else if (accessToken) {
            const { error: setErr } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            })
            if (setErr) { setError(setErr.message); setStatus('error'); return }
            setStatus('success')
            setTimeout(() => { window.location.href = '/' }, 1500)
          } else {
            setError('No auth token found. Please try signing in again.')
            setStatus('error')
          }
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
          <>
            <p className="auth-sub" style={{color: 'var(--green)', marginTop: 8}}>
              ✓ Account verified — redirecting...
            </p>
          </>
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
