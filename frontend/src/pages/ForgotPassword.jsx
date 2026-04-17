import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import orbitPfp from '../orbitPfp.js'
import './Auth.css'

export default function ForgotPassword({ onSwitch }) {
  const { resetPassword } = useAuth()
  const [email, setEmail]     = useState('')
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await resetPassword(email)
    if (error) { setError(error.message); setLoading(false); return }
    setSuccess(true)
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={orbitPfp} alt="ORBIT" className="auth-logo" />
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-sub">Enter your email and we'll send a reset link</p>

        {success ? (
          <>
            <p className="auth-success">Check your email for a reset link.</p>
            <button className="btn-primary" onClick={() => onSwitch('login')}>Back to sign in</button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="auth-footer">
          <button className="link-btn" onClick={() => onSwitch('login')}>← Back to sign in</button>
        </div>
      </div>
    </div>
  )
}
