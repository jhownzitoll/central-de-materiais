import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { BRAND_COMMERCIAL_NAME, BRAND_MARK } from '../../lib/branding'

export function Layout() {
  const { user, profile, canManageStores, signOut } = useAuth()
  return <div className="app-shell">
    <header className="site-header">
      <div className="container header-row compact-header">
        <Link to="/" className="brand" aria-label={`${BRAND_COMMERCIAL_NAME} - início`}>
          <span className="brand-mark">{BRAND_MARK}</span>
          <span><strong className="brand-name">{BRAND_COMMERCIAL_NAME}</strong><small className="brand-sub">Catálogo para marcenaria</small></span>
        </Link>
        <nav className="main-nav" aria-label="Navegação principal">
          <NavLink to="/">Catálogo</NavLink>
          {user && <NavLink to="/conta">Minha conta</NavLink>}
          {canManageStores && <NavLink to="/admin">Admin</NavLink>}
          {!user ? <NavLink className="nav-cta" to="/login">Entrar</NavLink> : <button className="link-button" onClick={() => void signOut()}>Sair{profile?.trade_name || profile?.full_name ? ` · ${profile.trade_name || profile.full_name}` : ''}</button>}
        </nav>
      </div>
    </header>
    <main><Outlet /></main>
    <footer className="site-footer"><div className="container">{BRAND_COMMERCIAL_NAME} · Plataforma multi-loja de materiais para marcenaria</div></footer>
  </div>
}
