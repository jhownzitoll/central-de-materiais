import { useEffect, useMemo, useRef, useState } from 'react'
import { AdminNav } from '../../components/admin/AdminNav'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/money'
import { buildOrderReport } from '../../lib/orderReport'
import type { Order, OrderItem, OrderStatus } from '../../types'

const statuses: OrderStatus[] = ['NOVO','EM_ATENDIMENTO','ORCAMENTO','CONFIRMADO','CANCELADO','FINALIZADO']

export function AdminOrdersPage() {
  const [orders,setOrders]=useState<Order[]>([]);const[query,setQuery]=useState('');const[status,setStatus]=useState('all');const[selected,setSelected]=useState<Order|null>(null);const[items,setItems]=useState<OrderItem[]>([])
  const [itemsLoading,setItemsLoading]=useState(false);const[itemsError,setItemsError]=useState('')
  const requestSeq=useRef(0)
  const load=async()=>{if(!supabase)return;const{data}=await supabase.from('orders').select('*').order('created_at',{ascending:false});setOrders((data||[]) as Order[])}
  useEffect(()=>{void load()},[])
  const filtered=useMemo(()=>orders.filter(o=>{const c:any=o.customer_snapshot||{};const text=[o.public_number,c.full_name,c.trade_name,c.document,c.phone,(o.store_snapshot as any)?.store_name].filter(Boolean).join(' ').toLowerCase();return(status==='all'||o.status===status)&&(!query||text.includes(query.toLowerCase()))}),[orders,query,status])
  const open=async(order:Order)=>{
    const request=++requestSeq.current
    setSelected(order);setItems([]);setItemsError('');setItemsLoading(true)
    if(!supabase){setItemsError('Serviço indisponível.');setItemsLoading(false);return}
    try {
      const {data,error}=await supabase.from('order_items').select('*').eq('order_id',order.id).order('id')
      if(request!==requestSeq.current)return
      if(error||!data?.length){setItemsError('Não foi possível consultar os itens deste pedido.');setItems([])}
      else setItems(data as OrderItem[])
    } catch {
      if(request===requestSeq.current)setItemsError('Falha ao consultar os itens do pedido.')
    } finally {
      if(request===requestSeq.current)setItemsLoading(false)
    }
  }
  const close=()=>{requestSeq.current++;setSelected(null);setItems([]);setItemsError('');setItemsLoading(false)}
  const changeStatus=async(next:OrderStatus)=>{if(!supabase||!selected)return;const{error}=await supabase.from('orders').update({status:next}).eq('id',selected.id);if(!error){setSelected({...selected,status:next});await load()}}
  const report=selected&&!itemsLoading&&!itemsError&&items.length?buildOrderReport(selected,items):'';const whatsapp=String((selected?.store_snapshot as any)?.seller_whatsapp||'').replace(/\D/g,'')
  return <div className="container admin-page"><div className="page-heading"><div><span className="eyebrow">Administração</span><h1>Pedidos</h1><p>Pedidos prontos para lançamento no sistema da loja.</p></div></div><AdminNav />
    <section className="section-card"><div className="admin-toolbar"><input className="admin-search" placeholder="Pedido, cliente, loja..." value={query} onChange={e=>setQuery(e.target.value)}/><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Todos os status</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></div>
      <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Loja</th><th>Cliente</th><th>Data</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>{filtered.map(o=>{const c:any=o.customer_snapshot||{};const st:any=o.store_snapshot||{};return <tr key={o.id}><td>{o.public_number}</td><td>{st.store_name||'-'}</td><td>{c.trade_name||c.full_name||'-'}</td><td>{new Date(o.created_at).toLocaleString('pt-BR')}</td><td><span className="status-pill">{o.status}</span></td><td>{formatMoney(o.total)}</td><td><button className="link-button" onClick={()=>void open(o)}>Abrir</button></td></tr>})}</tbody></table></div>
    </section>
    {selected&&<div className="modal-shell"><button className="overlay open" onClick={close}/><section className="edit-panel"><div className="drawer-head"><div><small>Pedido</small><h2>{selected.public_number}</h2></div><button className="close" onClick={close}>×</button></div><div className="edit-form">
      <label className="form-field"><span>Status</span><select value={selected.status} onChange={e=>void changeStatus(e.target.value as OrderStatus)}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label>
      {itemsLoading?<div className="status">Carregando relatório oficial…</div>:itemsError?<div className="status error" role="alert">{itemsError}</div>:<pre className="order-report">{report}</pre>}
      <div className="action-row"><button className="secondary" disabled={!report} onClick={()=>void navigator.clipboard.writeText(report)}>Copiar relatório</button>{whatsapp&&report&&<a className="primary button-link whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(report)}`}>Abrir WhatsApp</a>}</div>
    </div></section></div>}
  </div>
}
