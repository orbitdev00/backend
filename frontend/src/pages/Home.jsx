import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import StarField from '../components/StarField'
import NavBar from '../components/NavBar'
import './Home.css'

export default function Home() {
  const nav = useNavigate()
  const { user } = useAuth()

  return (
    <div className="home-screen">
      <StarField />
      <NavBar active="home" />

      <div className="home-body">
        <div className="home-welcome">
          <h1>Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}.</h1>
          <p>What are we doing today?</p>
        </div>

        <div className="home-cards">
          <div className="home-card" onClick={() => nav('/forum')}>
            <div className="card-icon">◈</div>
            <div className="card-label">Forum</div>
            <div className="card-desc">Discuss calls, share alpha, and connect with the community</div>
          </div>

          <div className="home-card" onClick={() => nav('/analyze')}>
            <div className="card-icon">⬡</div>
            <div className="card-label">Analyzer</div>
            <div className="card-desc">Analyze any Pump.fun token — rug detection, peak MC, holder data</div>
          </div>

          <div className="home-card" onClick={() => nav('/tracker')}>
            <div className="card-icon">◎</div>
            <div className="card-label">Tracker</div>
            <div className="card-desc">Watch coins and get notified when they hit your MC targets</div>
          </div>

          <div className="home-card" onClick={() => nav('/leaderboard')}>
            <div className="card-icon">◆</div>
            <div className="card-label">Leaderboard</div>
            <div className="card-desc">See the top traders and most active community members</div>
          </div>

          <div className="home-card" onClick={() => nav('/history')}>
            <div className="card-icon">◫</div>
            <div className="card-label">History</div>
            <div className="card-desc">Review past analyses and track how your calls played out</div>
          </div>
        </div>
      </div>
    </div>
  )
}
