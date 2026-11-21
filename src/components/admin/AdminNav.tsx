import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

export function AdminNav() {
  const { isSuperAdmin } = useAuth()
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!isSuperAdmin || !supabase) return
    let alive = true
    const count = async () => {
      const { count, error } = await supabase.from('ibuild_admin_order_alerts')
        .select('order_id', { count: 'exact', head: true }).is('acknowledged_at', null)
      if (alive && !error) setUnread(count || 0)
    }
    void count()
    const timer = window.setInterval(() => { if (!document.hidden) void count() }, 25000)
    const focus = () => void count()
    window.addEventListener('focus', focus)
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [isSuperAdmin])
  return <nav className="admin-nav" aria-label="Administração">
    <NavLink end to="/admin">Visão geral</NavLink>
    {isSuperAdmin && <NavLink to="/admin/lojas">Lojas</NavLink>}
    <NavLink to="/admin/produtos">Produtos e preços</NavLink>
    <NavLink to="/admin/pedidos">{isSuperAdmin ? 'Central de pedidos' : 'Pedidos'}</NavLink>
    {isSuperAdmin && <NavLink to="/admin/avisos">Avisos de pedidos{unread > 0 ? ' (' + unread + ')' : ''}</NavLink>}
    {isSuperAdmin && <NavLink to="/admin/whatsapp">WhatsApp</NavLink>}
    {isSuperAdmin && <NavLink to="/admin/clientes">Clientes</NavLink>}
    <NavLink to="/admin/config">Configurações</NavLink>
  </nav>
}
