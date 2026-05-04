// Onboarding.jsx — Step 2 of onboarding: run your first analysis
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import StarField from '../components/StarField'
import orbitPfp from '../orbitPfp.js'
import './Onboarding.css'

const STEPS = [
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
    sub: 'Run your first analysis to complete setup. Paste any Solana CA below.',
  },
]

export default function Onboarding() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [step, setStep]       = useState(0)
  const [username, setUsername] = useState('')
  const [mint, setMint]       = useState('')
  const [error, setError]     = useState('')

  useEffect(() => {
    if (!user) { nav('/login'); return }
    supabase.from('user_reputation').select('username').eq('user_id', user.id).single()
      .then(({ data }) => { if (data?.username) setUsername(data.username) })
  }, [user])

  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  function handleNext() {
    if (isLast) {
      handleAnalyze()
    } else {
      setStep(s => s + 1)
    }
  }

  function handleAnalyze() {
    if (!mint.trim()) { setError('Paste a contract address to continue.'); return }
    nav(`/analyze?mint=${encodeURIComponent(mint.trim())}&onboarding=1`)
  }

  function handleSkip() {
    nav('/')
  }

  return (
    <div className="ob-screen">
      <StarField />
      <div className="ob-card">
        {/* Logo */}
        <div className="ob-logo-row">
          <img src={orbitPfp} className="ob-logo" alt="" />
          <span className="ob-logo-text">ORBIT</span>
        </div>

        {/* Step indicator */}
        <div className="ob-steps">
          {STEPS.map((_, i) => (
            <div key={i} className={`ob-step-dot ${i === step ? 'ob-step-dot--active' : ''} ${i < step ? 'ob-step-dot--done' : ''}`} />
          ))}
        </div>

        {/* Content */}
        <div className="ob-content">
          <h1 className="ob-title">{current.title.replace('$username', username)}</h1>
          <p className="ob-sub">{current.sub}</p>

          {/* Final step — CA input */}
          {isLast && (
            <div className="ob-input-wrap">
              <input
                className="ob-input"
                placeholder="Paste contract address..."
                value={mint}
                onChange={e => { setMint(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                autoFocus
              />
              {error && <div className="ob-error">{error}</div>}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="ob-actions">
          <button className="ob-btn-primary" onClick={handleNext}>
            {isLast ? '🔭 Run Analysis' : 'Continue →'}
          </button>
          {!isLast && (
            <button className="ob-btn-skip" onClick={handleSkip}>
              Skip for now
            </button>
          )}
          {isLast && (
            <button className="ob-btn-skip" onClick={handleSkip}>
              Skip — go to home
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
