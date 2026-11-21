import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminNav } from '../../components/admin/AdminNav'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

type Alert = {
  order_id: string
  store_id: string
  public_number: string
  created_at: string
  acknowledged_at: string | null
}

const when = (iso: string) => new Date(iso).toLocaleString('pt-BR')
const canNotify = () => typeof window !== 'undefined' && 'Notification' in window

export function AdminAlertsPage() {
  const { isSuperAdmin } = useAuth()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const [notifyEnabled, setNotifyEnabled] = useState(false)
  const seen = useRef<Set<string> | null>(null)
  const notifications = useRef(false)
  const pending = useRef(false)

  const refresh = useCallback(async () => {
    if (!supabase || !isSuperAdmin || pending.current) return
    pending.current = true
    try {
      const { data, error: fetchError } = await supabase.from('ibuild_admin_order_alerts')
        .select('order_id,store_id,public_number,created_at,acknowledged_at')
        .order('created_at', { ascending: false }).limit(250)
      if (fetchError) throw fetchError
      const rows = (data || []) as Alert[]
      // No historical pop-ups: the first successful fetch establishes a baseline.
      if (seen.current && notifications.current && canNotify() && Notification.permission === 'granted') {
        for (const a of rows.filter(x => !x.acknowledged_at && !seen.current!.has(x.order_id)).slice(0, 3)) {
          try { new Notification('iBuild: novo pedido', { body: a.public_number + ' aguardando conferência.' }) } catch { /* denied or unsupported */ }
        }
      }
      seen.current = new Set(rows.map(x => x.order_id))
      setAlerts(rows)
      setError('')
    } catch {
      setError('Não foi possível consultar a caixa de pedidos. Confira sua sessão de administrador.')
    } finally { pending.current = false; setLoading(false) }
  }, [isSuperAdmin])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 20000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [refresh])

  const enableNotifications = async () => {
    if (!canNotify()) { setError('Este navegador não oferece notificações nativas. Use a central de avisos.'); return }
    const permission = await Notification.requestPermission()
    if (permission === 'granted') { notifications.current = true; setNotifyEnabled(true); setError('') }
    else setError('Permissão de notificações negada ou indisponível no Chrome.')
  }

  const acknowledge = async (orderId: string) => {
    if (!supabase || !isSuperAdmin || acknowledging) return
    setAcknowledging(orderId); setError('')
    try {
      const { error: rpcError } = await supabase.rpc('ibuild_acknowledge_order_alert', { p_order_id: orderId })
      if (rpcError) throw rpcError
      await refresh()
    } catch { setError('Não foi possível confirmar a leitura. Seu acesso de SUPER_ADMIN pode ter expirado.') }
    finally { setAcknowledging(null) }
  }

  const unread = alerts.filter(x => !x.acknowledged_at).length
  return <div className="container admin-page">
    <div className="page-heading"><div><span className="eyebrow">iBuild · Sem Meta</span><h1>Caixa de avisos de pedidos</h1>
      <p>Avisos gerados pelo próprio banco de dados. Somente o administrador pode visualizar e confirmar.</p></div></div>
    <AdminNav />
    <section className="section-card">
      <div className="ops-toolbar">
        <div><strong>{unread} não conferido(s)</strong><p>Atualização automática enquanto esta página estiver aberta, inclusive em segundo plano quando o Chrome permitir.</p></div>
        <button className="secondary" onClick={() => void refresh()}>Atualizar agora</button>
        {canNotify() && <button className="secondary" disabled={notifyEnabled}
          onClick={() => void enableNotifications()}>{notifyEnabled ? 'Avisos do Chrome ativados' : 'Ativar avisos no Chrome'}</button>}
      </div>
      {error && <div className="status error" role="alert">{error}</div>}
      {loading ? <p>Carregando avisos…</p> : alerts.length === 0
        ? <div className="empty-state"><h3>Nenhum novo pedido registrado</h3>
            <p>Esta caixa começa a registrar pedidos criados após a implantação. Nenhuma mensagem externa é enviada automaticamente.</p></div>
        : <div className="ops-order-list">{alerts.map(a =>
          <div className="ops-order-card" key={a.order_id}>
            <span><strong>{a.public_number}</strong><small>{when(a.created_at)}</small></span>
            <span><strong>{a.acknowledged_at ? 'Conferido' : 'Aguardando conferência'}</strong>
              <small>{a.acknowledged_at ? 'Confirmado em ' + when(a.acknowledged_at) : 'Novo pedido no servidor'}</small></span>
            <span><Link to="/admin/pedidos">Abrir central de pedidos</Link></span>
            {!a.acknowledged_at && <button className="secondary" disabled={acknowledging !== null}
              onClick={() => void acknowledge(a.order_id)}>
              {acknowledging === a.order_id ? 'Registrando…' : 'Marcar como conferido'}</button>}
          </div>
        )}</div>}
      <p style={{ marginTop: 16 }}>Os avisos do Chrome exigem permissão e esta página aberta. Não substituem e-mail ou notificações push em segundo plano.</p>
    </section>
  </div>
}
