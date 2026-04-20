import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import App from './App.jsx'
import Home from './pages/Home.jsx'
import Tracker from './pages/Tracker.jsx'
import History from './pages/History.jsx'
import Login from './pages/Login.jsx'
import Landing from './pages/Landing.jsx'
import SignUp from './pages/SignUp.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import AuthCallback from './pages/AuthCallback.jsx'
import Forum from './pages/Forum.jsx'
import ForumCategory from './pages/ForumCategory.jsx'
import ForumThread from './pages/ForumThread.jsx'
import ForumNew from './pages/ForumNew.jsx'
import Leaderboard from './pages/Leaderboard.jsx'
import Profile from './pages/Profile.jsx'
import Inbox from './pages/Inbox.jsx'
import EditProfile from './pages/EditProfile.jsx'
import Pricing from './pages/Pricing.jsx'
import PageTransition from './components/PageTransition.jsx'
import StarField from './components/StarField.jsx'
import './index.css'
import './mobile.css'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{color:'#444',padding:40,fontFamily:'monospace'}}>Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RootRoute() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [isTrial, setIsTrial] = React.useState(false)

  const handleSwitch = (page) => {
    if (page === 'login')   navigate('/login')
    else if (page === 'signup')  navigate('/signup')
    else if (page === 'forgot')  navigate('/forgot')
    else if (page === 'trial')   { navigate('/analyze?trial=1') }
  }

  if (loading) return null
  if (user) return <Home />
  return <Landing onSwitch={handleSwitch} />
}

function AppRoutes() {
  const { user } = useAuth()
  const navigate = useNavigate()
  return (
    <Routes>
      <Route path="/login"          element={<><StarField /><Login onSwitch={(p) => navigate(p === 'login' ? '/login' : p === 'signup' ? '/signup' : p === 'forgot' ? '/forgot' : '/')} /></>} />
      <Route path="/signup"         element={<><StarField /><SignUp onSwitch={(p) => navigate(p === 'login' ? '/login' : p === 'signup' ? '/signup' : p === 'forgot' ? '/forgot' : '/')} /></>} />
      <Route path="/forgot"         element={<><StarField /><ForgotPassword onSwitch={(p) => navigate(p === 'login' ? '/login' : p === 'signup' ? '/signup' : p === 'forgot' ? '/forgot' : '/')} /></>} />
      <Route path="/auth/callback"  element={<AuthCallback />} />
      <Route path="/" element={<RootRoute />} />
      <Route path="/analyze" element={<ProtectedRoute><App /></ProtectedRoute>} />
      <Route path="/tracker" element={<ProtectedRoute><Tracker /></ProtectedRoute>} />
      <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
      <Route path="/forum" element={<Forum />} />
      <Route path="/forum/category/:slug" element={<ForumCategory />} />
      <Route path="/forum/thread/:id" element={<ForumThread />} />
      <Route path="/forum/new" element={<ProtectedRoute><ForumNew /></ProtectedRoute>} />
      <Route path="/leaderboard" element={<Leaderboard />} />
      <Route path="/profile/:username" element={<Profile />} />
      <Route path="/inbox" element={<ProtectedRoute><Inbox /></ProtectedRoute>} />
      <Route path="/edit-profile" element={<ProtectedRoute><EditProfile /></ProtectedRoute>} />
      <Route path="/pricing" element={<ProtectedRoute><Pricing /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
