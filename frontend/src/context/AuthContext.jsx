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
    // Use raw REST to avoid deadlocked Supabase client
    try {
      const sbKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      const sbData = sbKey ? JSON.parse(localStorage.getItem(sbKey) || '{}') : {}
      const token = sbData?.access_token
      if (!token) return null
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_reputation?user_id=eq.${userId}&select=tier,username,avatar_url,score,role`,
        { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      const row = Array.isArray(data) ? data[0] : data
      setProfile(row || null)
      return row || null
    } catch (e) {
      console.warn('fetchProfile failed:', e)
      return null
    }
  }

  // Force sign out — clears everything locally without waiting for Supabase
  const forceSignOut = () => {
    // Clear all localStorage keys including Supabase auth token
    localStorage.clear()
    setUser(null)
    setSession(null)
    setProfile(null)
    window.location.href = '/login'
  }

  // signOut with 3s timeout — never hangs
  const signOut = async () => {
    // Fire Supabase signOut but don't wait more than 3s
    const signOutPromise = supabase.auth.signOut().catch(() => {})
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 3000))
    await Promise.race([signOutPromise, timeoutPromise])
    forceSignOut()
  }

  const validateSession = async () => {
    const path = window.location.pathname
    if (PUBLIC_PATHS.some(p => path.startsWith(p))) return
    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      const { data: { user: liveUser }, error } = await Promise.race([
        supabase.auth.getUser(),
        timeoutPromise,
      ])
      if (error || !liveUser) forceSignOut()
    } catch (_) {
      // timeout or network error — don't force sign out, just skip validation
    }
  }

  useEffect(() => {
    const init = async () => {
      // Read session from localStorage directly — no async Supabase call
      const sbKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      const sbData = sbKey ? JSON.parse(localStorage.getItem(sbKey) || '{}') : {}

      if (!sbData?.access_token) {
        setLoading(false)
        return
      }

      // Parse user from JWT without a network call
      try {
        const parts = sbData.access_token.split('.')
        const payload = JSON.parse(atob(parts[1]))
        const fakeUser = {
          id: payload.sub,
          email: payload.email,
          app_metadata: payload.app_metadata || {},
          user_metadata: payload.user_metadata || {},
        }
        setUser(fakeUser)
        setSession({ access_token: sbData.access_token })
        await fetchProfile(fakeUser.id)
      } catch (e) {
        console.warn('Session parse failed:', e)
      }

      setLoading(false)
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED' && !session) {
        forceSignOut()
        return
      }
      if (event === 'SIGNED_OUT') {
        forceSignOut()
        return
      }
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
      await fetchProfile(session?.user?.id ?? null)
    })

    const intervalId = setInterval(validateSession, 60_000)
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
      } catch (_) {}
    }
    return { data, error }
  }

  const signInWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
    return { data, error }
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
