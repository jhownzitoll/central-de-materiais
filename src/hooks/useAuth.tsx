import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { hasSupabaseConfig, supabase } from '../lib/supabase'
import type { Profile, StoreMembership } from '../types'

type AuthContextValue = {
  user: User | null
  session: Session | null
  profile: Profile | null
  memberships: StoreMembership[]
  loading: boolean
  isSuperAdmin: boolean
  canManageStores: boolean
  managedStoreIds: string[]
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<StoreMembership[]>([])
  const [loading, setLoading] = useState(true)

  const loadAccess = async (userId?: string) => {
    if (!supabase || !userId) { setProfile(null); setMemberships([]); return }
    const [profileResult, membershipResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('store_members').select('*, stores(*)').eq('user_id', userId).eq('active', true),
    ])
    if (profileResult.error) throw profileResult.error
    if (membershipResult.error) throw membershipResult.error
    setProfile((profileResult.data as Profile | null) ?? null)
    setMemberships((membershipResult.data || []) as StoreMembership[])
  }

  const refreshProfile = async () => { await loadAccess(session?.user.id) }

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return }
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      try { await loadAccess(data.session?.user.id) } catch { setProfile(null); setMemberships([]) }
      if (alive) setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      void loadAccess(next?.user.id).finally(() => setLoading(false))
    })
    return () => { alive = false; listener.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const isSuperAdmin = profile?.platform_role === 'SUPER_ADMIN'
    const managedStoreIds = memberships.filter((m) => m.role === 'STORE_ADMIN' && m.active).map((m) => m.store_id)
    return {
      user: session?.user ?? null, session, profile, memberships, loading, isSuperAdmin,
      canManageStores: isSuperAdmin || managedStoreIds.length > 0,
      managedStoreIds, refreshProfile,
      signOut: async () => {
        if (supabase) await supabase.auth.signOut()
        setSession(null); setProfile(null); setMemberships([])
      },
    }
  }, [session, profile, memberships, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return value
}
