import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

const PUBLIC_PATHS = ['/login', '/auth/callback', '/forgot-password', '/update-password']

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = async (userId) => {
    if (!userId) { setProfile(null); return null }
    const { data } = await supabase
      .from('user_reputation')
      .select('tier,username,avatar_url,score,role')
      .eq('user_id', userId)
      .single()
    setProfile(data || null)
    return data || null
  }

  const forceSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const validateSession = async () => {
    const path = window.location.pathname
    if (PUBLIC_PATHS.some(p => path.startsWith(p))) return
    const { data: { session: live }, error } = await supabase.auth.getSession()
    if (!live || error) forceSignOut()
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
      fetchProfile(session?.user?.id ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Token refresh failed — account likely deleted
      if (event === 'TOKEN_REFRESHED' && !session) {
        forceSignOut()
        return
      }

      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
      const profileData = await fetchProfile(session?.user?.id ?? null)

      // Redirect to onboarding if signed in but username not yet set
      if (event === 'SIGNED_IN' && session?.user && !profileData?.username) {
        const path = window.location.pathname
        if (!['/onboarding', '/edit-profile', '/auth/callback', '/login'].includes(path)) {
          window.location.href = '/onboarding'
        }
      }
    })

    // Detect deleted-account sessions: poll every 60s
    const intervalId = setInterval(validateSession, 60_000)

    // Also validate when the tab regains focus
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') validateSession()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      subscription.unsubscribe()
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
    return { data, error }
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { data: null, error }
    if (data?.user && !data.user.email_confirmed_at) {
      await supabase.auth.signOut()
      return { data: null, error: { message: 'Please check your email and verify your account before signing in.' } }
    }
    if (data?.user) {
      try {
        const { data: rep } = await supabase
          .from('user_reputation')
          .select('auth_provider')
          .eq('user_id', data.user.id)
          .single()
        if (rep?.auth_provider === 'google') {
          await supabase.auth.signOut()
          return { data: null, error: { message: 'This email is registered with Google. Please use "Continue with Google" to sign in.' } }
        }
      } catch (_) { /* column may not exist yet — allow login */ }
    }
    return { data, error }
  }

  const signInWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
    return { data, error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const resetPassword = async (email) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback` })
    return { data, error }
  }

  return (
    <AuthContext.Provider value={{
      user, session, profile, loading,
      signUp, signIn, signInWithGoogle, signOut, resetPassword,
      refreshProfile: () => fetchProfile(user?.id),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
