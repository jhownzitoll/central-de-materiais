import { useEffect, useMemo, useState } from 'react'
import { AdminNav } from '../../components/admin/AdminNav'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { buildOrderReport } from '../../lib/orderReport'
import { buildSupplierReport, routingLabel, type RoutingState } from '../../lib/routing'
import { formatMoney } from '../../lib/money'
import type { Order, OrderItem, OrderStatus } from '../../types'
type Routing={order_id:string;store_id:string;state:RoutingState;forwarded_at:string|null;opened_at:string|null}
type Notice={id:string;order_id:string;state:string;last_error:string|null}
type Event={id:number;kind:string;created_at:string;actor_kind:string}
const orderStatuses:OrderStatus[]=['NOVO','EM_ATENDIMENTO','ORCAMENTO','CONFIRMADO','CANCELADO','FINALIZADO']
const moment=(date?:string|null)=>date?new Date(date).toLocaleString('pt-BR'):'—'
export function AdminOrdersPage(){
 const {isSuperAdmin}=useAuth()
 const [orders,setOrders]=useState<Order[]>([])
 const [routes,setRoutes]=useState<Routing[]>([])
 const [notices,setNotices]=useState<Notice[]>([])
 const [phones,setPhones]=useState<Record<string,string>>({})
 const [filter,setFilter]=useState('pending'),[query,setQuery]=useState('')
 const [selected,setSelected]=useState<Order|null>(null)
 const [items,setItems]=useState<OrderItem[]>([])
 const [events,setEvents]=useState<Event[]>([])
 const [note,setNote]=useState(''),[busy,setBusy]=useState(false)
 const [message,setMessage]=useState(''),[error,setError]=useState('')
 const routingMap=useMemo(()=>new Map(routes.map(x=>[x.order_id,x])),[routes])
 const noticeMap=useMemo(()=>new Map(notices.map(x=>[x.order_id,x])),[notices])
 const refresh=async()=>{
   if(!supabase)return
   const [o,r,n,s]=await Promise.all([
     supabase.from('orders').select('*').order('created_at',{ascending:false}).limit(500),
     isSuperAdmin?supabase.from('ibuild_order_routing').select('*'):Promise.resolve({data:[],error:null}),
     isSuperAdmin?supabase.from('ibuild_notification_outbox').select('id,order_id,state,last_error'):Promise.resolve({data:[],error:null}),
     isSuperAdmin?supabase.from('store_settings').select('store_id,seller_whatsapp'):Promise.resolve({data:[],error:null}),
   ])
   if(o.error||r.error||n.error||s.error){setError('Não foi possível consultar todos os pedidos e estados.');return}
   setOrders((o.data||[]) as Order[])
   setRoutes((r.data||[]) as Routing[])
   setNotices((n.data||[]) as Notice[])
   setPhones(Object.fromEntries((s.data||[]).map(v=>[v.store_id,String(v.seller_whatsapp||'').replace(/\D/g,'')])))
   setError('')
 }
 useEffect(()=>{void refresh()},[isSuperAdmin])
 const counts=useMemo(()=>({
   pending:routes.filter(x=>x.state==='AGUARDANDO_CONFERENCIA').length,
   ready:routes.filter(x=>['APROVADO','ENCAMINHAMENTO_INICIADO'].includes(x.state)).length,
   sent:routes.filter(x=>x.state==='ENCAMINHADO').length,
   fail:notices.filter(x=>['FALHA_TEMPORARIA','FALHA_PERMANENTE','RESULTADO_INCERTO'].includes(x.state)).length,
 }),[routes,notices])
 const visible=useMemo(()=>orders.filter(o=>{
  const c=o.customer_snapshot||{},s=o.store_snapshot||{},r=routingMap.get(o.id)
  const match=[o.public_number,c.full_name,c.trade_name,s.store_name].join(' ').toLowerCase().includes(query.toLowerCase().trim())
  if(!match)return false
  if(!isSuperAdmin)return filter==='all'||o.status===filter
  return filter==='all'||(filter==='pending'&&r?.state==='AGUARDANDO_CONFERENCIA')||
   (filter==='ready'&&(r?.state==='APROVADO'||r?.state==='ENCAMINHAMENTO_INICIADO'))||
   (filter==='sent'&&r?.state==='ENCAMINHADO')||
   (filter==='fail'&&['FALHA_TEMPORARIA','FALHA_PERMANENTE','RESULTADO_INCERTO'].includes(noticeMap.get(o.id)?.state||''))||
   (filter==='cancelled'&&o.status==='CANCELADO')
 }),[orders,filter,query,isSuperAdmin,routingMap,noticeMap])
 const open=async(o:Order)=>{
  if(!supabase)return
  setSelected(o);setItems([]);setEvents([]);setMessage('');setError('');setNote('')
  const [i,e]=await Promise.all([
   supabase.from('order_items').select('*').eq('order_id',o.id).order('id'),
   isSuperAdmin?supabase.from('ibuild_order_events').select('id,kind,created_at,actor_kind').eq('order_id',o.id).order('created_at',{ascending:false}):Promise.resolve({data:[],error:null})
  ])
  if(i.error){setError('Não foi possível carregar os itens.');return}
  setItems((i.data||[]) as OrderItem[]);setEvents((e.data||[]) as Event[])
  if(isSuperAdmin)void supabase.rpc('ibuild_mark_seen',{p_order_id:o.id})
 }
 const act=async(name:string)=>{
  if(!supabase||!selected||busy)return
  if(name==='REJECT'&&!window.confirm('Rejeitar e cancelar esta solicitação?'))return
  if(name==='CONFIRM_FORWARD'&&!window.confirm('Você realmente ENVIOU a mensagem à loja no WhatsApp? Abrir o link não comprova envio.'))return
  setBusy(true);setError('');setMessage('')
  const {error:e}=await supabase.rpc('ibuild_route_action',{p_order_id:selected.id,p_action:name,p_note:note.trim()||null})
  if(e)setError(e.message)
  else{
   setMessage(name==='APPROVE'?'Pedido aprovado.':name==='REJECT'?'Pedido rejeitado.':name==='START_FORWARD'?'Encaminhamento preparado. Agora envie pelo WhatsApp.':'Confirmação manual de encaminhamento registrada.')
   const [{data:updated},{data:history}]=await Promise.all([
    supabase.from('orders').select('*').eq('id',selected.id).single(),
    supabase.from('ibuild_order_events').select('id,kind,created_at,actor_kind').eq('order_id',selected.id).order('created_at',{ascending:false})
   ])
   if(updated)setSelected(updated as Order)
   setEvents((history||[]) as Event[])
   await refresh()
  }
  setBusy(false)
 }
 const updateStatus=async(value:OrderStatus)=>{
  if(!supabase||!selected||busy)return
  setBusy(true)
  const {error:e}=await supabase.from('orders').update({status:value}).eq('id',selected.id)
  if(e)setError(e.message);else{setSelected({...selected,status:value});await refresh()}
  setBusy(false)
 }
 const r=selected?routingMap.get(selected.id):undefined,n=selected?noticeMap.get(selected.id):undefined
 const report=selected&&items.length?buildOrderReport(selected,items):''
 const supplier=selected&&items.length?buildSupplierReport(selected,items):''
 const phone=selected?phones[selected.store_id]||'':''
 const forwardURL=phone&&supplier?'https://wa.me/'+phone+'?text='+encodeURIComponent(supplier):''
 return <div className="container admin-page">
  <div className="page-heading"><div><span className="eyebrow">iBuild · Intermediação</span><h1>{isSuperAdmin?'Central de pedidos':'Pedidos da loja'}</h1><p>{isSuperAdmin?'Receba, confira e libere um pedido por vez ao fornecedor correto.':'Consulte somente os pedidos liberados à sua loja.'}</p></div></div>
  <AdminNav/>
  {isSuperAdmin&&<div className="ops-metrics"><div><small>Para conferir</small><strong>{counts.pending}</strong></div><div><small>Para encaminhar</small><strong>{counts.ready}</strong></div><div><small>Encaminhados</small><strong>{counts.sent}</strong></div><div><small>Falhas de aviso</small><strong>{counts.fail}</strong></div></div>}
  <section className="section-card"><div className="ops-toolbar">
   <input className="admin-search" aria-label="Buscar pedido" value={query} placeholder="Pedido, cliente, fornecedor..." onChange={e=>setQuery(e.target.value)}/>
   <select aria-label="Filtrar pedidos" value={filter} onChange={e=>setFilter(e.target.value)}>
    {isSuperAdmin?<><option value="pending">Aguardando conferência</option><option value="ready">Para encaminhar</option><option value="sent">Encaminhados</option><option value="fail">Falhas de notificação</option><option value="cancelled">Cancelados</option><option value="all">Todos</option></>:<><option value="all">Todos</option>{orderStatuses.map(s=><option key={s} value={s}>{s}</option>)}</>}
   </select><button className="secondary" onClick={()=>void refresh()}>Atualizar</button></div>
   {error&&!selected&&<div className="status error">{error}</div>}
   <div className="ops-order-list">{visible.map(o=>{
    const c=o.customer_snapshot||{},s=o.store_snapshot||{},rt=routingMap.get(o.id),notice=noticeMap.get(o.id)
    return <button key={o.id} className="ops-order-card" onClick={()=>void open(o)}>
      <span><strong>{o.public_number}</strong><small>{moment(o.created_at)}</small></span>
      <span><strong>{String(c.trade_name||c.full_name||'Cliente')}</strong><small>{String(s.store_name||'Fornecedor')}</small></span>
      <span className="ops-order-value">{formatMoney(o.total)}<small>{isSuperAdmin?routingLabel(rt?.state):o.status}</small></span>
      {isSuperAdmin&&<span className="ops-notice">{notice?.state?.replaceAll('_',' ')||'—'}</span>}
      <span className="ops-chevron">Abrir →</span>
    </button>})}
   {!visible.length&&<div className="empty-state"><h3>Sem pedidos neste filtro</h3><p>Novas solicitações aparecerão aqui.</p></div>}</div>
  </section>
  {selected&&<div className="modal-shell"><button className="overlay open" aria-label="Fechar" onClick={()=>setSelected(null)}/>
   <section className="edit-panel ops-panel"><div className="drawer-head"><div><small>{String(selected.store_snapshot?.store_name||'Fornecedor')}</small><h2>{selected.public_number}</h2></div><button className="close" onClick={()=>setSelected(null)}>×</button></div>
    <div className="edit-form">
      <div className="ops-state"><div><small>Status do pedido</small><strong>{selected.status}</strong></div>{isSuperAdmin&&<div><small>Intermediação</small><strong>{routingLabel(r?.state)}</strong></div>}</div>
      {isSuperAdmin&&n&&<div className="status">WhatsApp: {n.state.replaceAll('_',' ')}{n.last_error&&<p>{n.last_error}</p>}</div>}
      {message&&<div className="status" role="status">{message}</div>}
      {error&&<div className="status error" role="alert">{error}</div>}
      <h3>Relatório oficial</h3><pre className="order-report">{report||'Carregando itens...'}</pre>
      {isSuperAdmin&&r&&selected.status!=='CANCELADO'&&<>
       <h3>Conferência do intermediário</h3>
       <label className="form-field"><span>Observação interna (opcional)</span><textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
       {r.state==='AGUARDANDO_CONFERENCIA'&&<div className="action-row"><button className="primary fit" disabled={busy||!report} onClick={()=>void act('APPROVE')}>Aprovar pedido</button><button className="secondary" disabled={busy} onClick={()=>void act('REJECT')}>Rejeitar</button></div>}
       {r.state==='APROVADO'&&<button className="primary" disabled={busy||!phone} onClick={()=>void act('START_FORWARD')}>{phone?'Preparar envio à loja':'Cadastre o WhatsApp da loja'}</button>}
       {r.state==='ENCAMINHAMENTO_INICIADO'&&<div className="ops-forward">
        <p>Confira o destinatário e envie pelo seu WhatsApp. Abrir a conversa não registra envio.</p>
        <pre className="order-report">{supplier}</pre>
        <div className="action-row"><button className="secondary" onClick={()=>void navigator.clipboard.writeText(supplier)}>Copiar relatório</button>{forwardURL&&<a className="primary button-link whatsapp fit" href={forwardURL} target="_blank" rel="noopener noreferrer">Abrir WhatsApp da loja</a>}</div>
        <button className="primary" disabled={busy||!phone} onClick={()=>void act('CONFIRM_FORWARD')}>Confirmar que enviei à loja</button>
       </div>}
       {r.state==='ENCAMINHADO'&&<div className="status">Envio confirmado por você em {moment(r.forwarded_at)}.</div>}
       {r.state==='REJEITADO'&&<div className="status error">Pedido rejeitado.</div>}
      </>}
      {!isSuperAdmin&&<label className="form-field"><span>Atualizar status comercial</span><select disabled={busy} value={selected.status} onChange={e=>void updateStatus(e.target.value as OrderStatus)}>{orderStatuses.map(s=><option key={s}>{s}</option>)}</select></label>}
      <div className="action-row"><button className="secondary" disabled={!report} onClick={()=>void navigator.clipboard.writeText(report)}>Copiar relatório</button></div>
      {isSuperAdmin&&<><h3>Histórico</h3><div className="ops-timeline">{events.map(e=><div key={e.id}><strong>{e.kind.replaceAll('_',' ').toLowerCase()}</strong><small>{moment(e.created_at)} · {e.actor_kind}</small></div>)}{!events.length&&<p>Sem eventos adicionais.</p>}</div></>}
    </div>
   </section></div>}
 </div>
}
