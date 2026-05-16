import { useState } from 'react'
import { supabase } from '../lib/supabase'
import orbitPfp from '../orbitPfp.js'
import './Auth.css'

export default function UpdatePassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState(false)
  const [loading, setLoading]   = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false); return }
    setSuccess(true)
    setLoading(false)
    setTimeout(() => { window.location.href = '/' }, 1500)
  }

  return (
    <div className="auth-page orbit-page-fadein">
      <div className="auth-card">
        <img src={orbitPfp} alt="ORBIT" className="auth-logo" />
        <h1 className="auth-title">Set new password</h1>
        <p className="auth-sub">Choose a new password for your account</p>

        {success ? (
          <p className="auth-sub" style={{ color: 'var(--green)', marginTop: 8 }}>
            ✓ Password updated — redirecting...
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="field">
              <label>New password</label>
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
              {loading ? 'Updating...' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
