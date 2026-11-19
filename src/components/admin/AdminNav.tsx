import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

export function AdminNav() {
  const { isSuperAdmin } = useAuth()
  return <nav className="admin-nav" aria-label="Administração">
    <NavLink end to="/admin">Visão geral</NavLink>
    {isSuperAdmin && <NavLink to="/admin/lojas">Lojas</NavLink>}
    <NavLink to="/admin/produtos">Produtos e preços</NavLink>
    <NavLink to="/admin/pedidos">{isSuperAdmin?'Central de pedidos':'Pedidos'}</NavLink>
    {isSuperAdmin && <NavLink to="/admin/whatsapp">WhatsApp</NavLink>}
    {isSuperAdmin && <NavLink to="/admin/clientes">Clientes</NavLink>}
    <NavLink to="/admin/config">Configurações</NavLink>
  </nav>
}
