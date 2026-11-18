import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

export function ProtectedRoute({ children, admin = false, superAdmin = false }: { children: React.ReactNode, admin?: boolean, superAdmin?: boolean }) {
  const { user, profile, loading, canManageStores, isSuperAdmin } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page-state">Carregando acesso…</div>
  if (!user) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (!profile?.active) return <div className="page-state error-card">Sua conta está inativa.</div>
  if (superAdmin && !isSuperAdmin) return <Navigate to="/" replace />
  if (admin && !canManageStores) return <Navigate to="/" replace />
  return <>{children}</>
}
