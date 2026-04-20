import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import StarField from '../components/StarField'
import NavBar from '../components/NavBar'
import './Home.css'

const CARDS = [
  {
    key: 'analyze',
    icon: '⬡',
    label: 'Analyzer',
    desc: 'Rug detection, peak MC prediction, holder distribution, AI narrative. Any Pump.fun token in seconds.',
    path: '/analyze',
    color: '#a78bfa',
    shadow: '0 0 40px rgba(167,139,250,0.15)',
    border: 'rgba(167,139,250,0.25)',
    tag: 'AI TRAINED',
  },
  {
    key: 'forum',
    icon: '◈',
    label: 'Community',
    desc: 'Share calls, post alpha, and connect with traders who actually know what they are doing.',
    path: '/forum',
    color: '#60a5fa',
    shadow: '0 0 40px rgba(96,165,250,0.15)',
    border: 'rgba(96,165,250,0.25)',
    tag: 'LIVE',
  },
  {
    key: 'tracker',
    icon: '◎',
    label: 'Tracker',
    desc: 'Watch coins and get alerted the moment they hit your MC targets. Set it and forget it.',
    path: '/tracker',
    color: '#4ade80',
    shadow: '0 0 40px rgba(74,222,128,0.15)',
    border: 'rgba(74,222,128,0.25)',
    tag: 'ALERTS',
  },
  {
    key: 'leaderboard',
    icon: '◆',
    label: 'Leaderboard',
    desc: 'On-chain PnL, public rankings, and community reputation. Your edge, on display.',
    path: '/leaderboard',
    color: '#f59e0b',
    shadow: '0 0 40px rgba(245,158,11,0.15)',
    border: 'rgba(245,158,11,0.25)',
    tag: 'ON-CHAIN',
  },
]

export default function Home() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [visible, setVisible] = useState(false)
  const username = user?.user_metadata?.username || user?.email?.split('@')[0] || 'trader'

  useEffect(() => { setTimeout(() => setVisible(true), 60) }, [])

  return (
    <div className="home-screen">
      <StarField />
      <NavBar active="home" />
      <div className={`home-body ${visible ? 'home-visible' : ''}`}>

        <div className="home-hero">
          <div className="home-hero-pill">
            <span className="home-hero-pulse" />
            v0.3 · All systems operational
          </div>
          <h1 className="home-hero-title">
            gm, <span className="home-hero-name">{username}</span>
          </h1>
          <p className="home-hero-sub">Four tools. One unfair advantage. Where to?</p>
        </div>

        <div className="home-grid">
          {CARDS.map((c, i) => (
            <div
              key={c.key}
              className="home-card"
              onClick={() => nav(c.path)}
              style={{
                '--cc': c.color,
                '--cb': c.border,
                '--cs': c.shadow,
                animationDelay: `${0.05 + i * 0.07}s`,
              }}
            >
              <div className="home-card-bg" />
              <div className="home-card-border-top" />
              <div className="home-card-inner">
                <div className="home-card-head">
                  <span className="home-card-icon">{c.icon}</span>
                  <span className="home-card-tag">{c.tag}</span>
                </div>
                <div className="home-card-label">{c.label}</div>
                <div className="home-card-desc">{c.desc}</div>
                <div className="home-card-footer">
                  <span className="home-card-cta">Open {c.label}</span>
                  <span className="home-card-arrow">→</span>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
