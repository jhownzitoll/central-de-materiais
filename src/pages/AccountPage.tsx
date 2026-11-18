import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/money'
import type { Order } from '../types'

export function AccountPage() {
  const { profile } = useAuth(); const [orders,setOrders]=useState<Order[]>([]); const [loading,setLoading]=useState(true)
  useEffect(()=>{ if(!supabase){setLoading(false);return} supabase.from('orders').select('*').order('created_at',{ascending:false}).then(({data})=>{setOrders((data||[]) as Order[]);setLoading(false)}) },[])
  return <div className="container standard-page"><div className="page-heading"><div><span className="eyebrow">Minha conta</span><h1>{profile?.trade_name||profile?.full_name||'Cliente'}</h1><p>{profile?.email}</p></div></div><section className="info-grid"><div className="info-card"><small>Tipo</small><strong>{profile?.person_type}</strong></div><div className="info-card"><small>Documento</small><strong>{profile?.document}</strong></div><div className="info-card"><small>WhatsApp</small><strong>{profile?.phone}</strong></div></section><section className="section-card"><div className="section-head"><h2>Meus pedidos</h2></div>{loading?<p>Carregando…</p>:orders.length?<div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>{orders.map((order)=><tr key={order.id}><td>{order.public_number}</td><td>{new Date(order.created_at).toLocaleDateString('pt-BR')}</td><td><span className="status-pill">{order.status}</span></td><td>{formatMoney(order.total)}</td><td><Link to={`/pedido/${order.id}`}>Abrir</Link></td></tr>)}</tbody></table></div>:<div className="empty-state"><h3>Nenhum pedido ainda</h3><p>Seu histórico aparecerá aqui.</p></div>}</section></div>
}
