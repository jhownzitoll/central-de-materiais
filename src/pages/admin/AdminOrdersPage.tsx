import { useEffect, useMemo, useState } from 'react'
import { AdminNav } from '../../components/admin/AdminNav'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { buildOrderReport } from '../../lib/orderReport'
import { buildGroupReport, type GroupOrderDetails } from '../../lib/groupReport'
import { buildSupplierReport, routingLabel, type RoutingState } from '../../lib/routing'
import { formatMoney } from '../../lib/money'
import { createSupplierPdfFile, downloadSupplierPdf, shareSupplierPdf } from '../../lib/supplierPdf'
import type { Order, OrderGroup, OrderGroupLink, OrderItem, OrderStatus } from '../../types'
type Routing={order_id:string;store_id:string;state:RoutingState;forwarded_at:string|null;opened_at:string|null}
type Notice={id:string;order_id:string;state:string;last_error:string|null}
type Event={id:number;kind:string;created_at:string;actor_kind:string}
const orderStatuses:OrderStatus[]=['NOVO','EM_ATENDIMENTO','ORCAMENTO','CONFIRMADO','CANCELADO','FINALIZADO']
const moment=(date?:string|null)=>date?new Date(date).toLocaleString('pt-BR'):'—'
export function AdminOrdersPage(){
 const {isSuperAdmin}=useAuth()
 const [orders,setOrders]=useState<Order[]>([])
 const [groups,setGroups]=useState<OrderGroup[]>([])
 const [links,setLinks]=useState<OrderGroupLink[]>([])
 const [selectedGroup,setSelectedGroup]=useState<OrderGroup|null>(null)
 const [groupDetails,setGroupDetails]=useState<GroupOrderDetails[]>([])
 const [groupLoading,setGroupLoading]=useState(false)
 const [supplierPdfs,setSupplierPdfs]=useState<Record<string,File>>({})
 const [pdfNotice,setPdfNotice]=useState('')
 const [pdfError,setPdfError]=useState('')
 const [secureDocuments,setSecureDocuments]=useState<Record<string,{pdf_url:string;whatsapp_url:string|null;sha256:string}>>({})
 const [secureBusy,setSecureBusy]=useState<string|null>(null)
 const [routes,setRoutes]=useState<Routing[]>([])
 const [notices,setNotices]=useState<Notice[]>([])
 const [phones,setPhones]=useState<Record<string,string>>({})
 const [filter,setFilter]=useState('pending'),[query,setQuery]=useState('')
 const [selected,setSelected]=useState<Order|null>(null)
 const [items,setItems]=useState<OrderItem[]>([])
 const [events,setEvents]=useState<Event[]>([])
 const [note,setNote]=useState(''),[busy,setBusy]=useState(false)
 const [message,setMessage]=useState(''),[error,setError]=useState('')
 useEffect(()=>{
   let active=true
   if(!selected || !items.length)return
   void createSupplierPdfFile(selected,items).then(file=>{
     if(active)setSupplierPdfs(previous=>({...previous,[selected.id]:file}))
   }).catch(()=>{
     if(active)setPdfError('Não foi possível gerar o PDF desta loja.')
   })
   return()=>{active=false}
 },[selected?.id,items])
 useEffect(()=>{
   let active=true
   if(!selectedGroup||!groupDetails.length)return
   void Promise.all(groupDetails.map(async({order,items})=>({
     id:order.id,file:await createSupplierPdfFile(order,items),
   }))).then(ready=>{
     if(active)setSupplierPdfs(previous=>({
       ...previous,...Object.fromEntries(ready.map(pdf=>[pdf.id,pdf.file])),
     }))
   }).catch(()=>{
     if(active)setPdfError('Não foi possível gerar todos os PDFs. Confira os itens dos subpedidos.')
   })
   return()=>{active=false}
 },[selectedGroup?.id,groupDetails])
 const prepareSecureDocument=async(orderId:string)=>{
   if(!supabase||!isSuperAdmin||secureBusy)return
   setSecureBusy(orderId);setPdfError('');setPdfNotice('')
   try{
     const {data,error:fnError}=await supabase.functions.invoke('ibuild-order-doc-link',{body:{order_id:orderId}})
     if(fnError||!data?.ok||typeof data.pdf_url!=='string')throw new Error('PRIVATE_PDF_LINK_UNAVAILABLE')
     setSecureDocuments(previous=>({...previous,[orderId]:{
       pdf_url:data.pdf_url,whatsapp_url:typeof data.whatsapp_url==='string'?data.whatsapp_url:null,
       sha256:String(data.sha256||'')
     }}))
     setPdfNotice('Link temporário preparado para o proprietário. Nenhuma mensagem foi enviada automaticamente.')
   }catch{setPdfError('Não foi possível preparar o link privado. Confira sua sessão e tente novamente.')}
   finally{setSecureBusy(null)}
 }
 const downloadPdf=(file:File)=>{
   downloadSupplierPdf(file)
   setPdfNotice('PDF baixado. Encaminhe o documento para a loja correspondente.')
 }
 const sharePdf=(file:File)=>{
   // Preserve transient user activation for navigator.share().
   void shareSupplierPdf(file).then(outcome=>{
     if(outcome==='downloaded')setPdfNotice('Compartilhamento de arquivos indisponível aqui. PDF baixado; anexe-o na conversa da loja.')
     else if(outcome==='shared')setPdfNotice('Confira se a mensagem foi realmente enviada antes de confirmar o encaminhamento.')
   }).catch(()=>setPdfError('Falha ao compartilhar o PDF. Use o botão de download.'))
 }
 const routingMap=useMemo(()=>new Map(routes.map(x=>[x.order_id,x])),[routes])
 const noticeMap=useMemo(()=>new Map(notices.map(x=>[x.order_id,x])),[notices])
 const refresh=async()=>{
   if(!supabase)return
   const [o,r,n,s,g,l]=await Promise.all([
     isSuperAdmin?supabase.from('orders').select('*').order('created_at',{ascending:false}).limit(500):supabase.rpc('ibuild_supplier_orders_v1'),
     isSuperAdmin?supabase.from('ibuild_order_routing').select('*'):Promise.resolve({data:[],error:null}),
     isSuperAdmin?supabase.from('ibuild_notification_outbox').select('id,order_id,state,last_error'):Promise.resolve({data:[],error:null}),
     isSuperAdmin?supabase.from('store_settings').select('store_id,seller_whatsapp'):Promise.resolve({data:[],error:null}),
     isSuperAdmin?supabase.from('order_groups').select('*').order('created_at',{ascending:false}).limit(250):Promise.resolve({data:[],error:null}),
     isSuperAdmin?supabase.from('order_group_orders').select('*'):Promise.resolve({data:[],error:null}),
   ])
   if(o.error||r.error||n.error||s.error||g.error||l.error){setError('Não foi possível consultar todos os pedidos e estados.');return}
   setOrders((o.data||[]) as Order[])
   setGroups((g.data||[]) as OrderGroup[])
   setLinks((l.data||[]) as OrderGroupLink[])
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
 const linkedOrderIds=useMemo(()=>new Set(links.map(l=>l.order_id)),[links])
 const visibleGroups=useMemo(()=>groups.filter(g=>{
   const children=links.filter(l=>l.group_id===g.id).map(l=>orders.find(o=>o.id===l.order_id)).filter((o):o is Order=>Boolean(o))
   if (!children.length) return false
   const q=query.trim().toLowerCase()
   const searchable=[g.public_number,...children.flatMap(o=>[o.public_number,String(o.customer_snapshot?.trade_name||o.customer_snapshot?.full_name||''),String(o.store_snapshot?.store_name||'')])].join(' ').toLowerCase()
   if(q&&!searchable.includes(q))return false
   if(filter==='all')return true
   if(filter==='cancelled')return children.every(o=>o.status==='CANCELADO')
   if(filter==='fail')return children.some(o=>['FALHA_TEMPORARIA','FALHA_PERMANENTE','RESULTADO_INCERTO'].includes(noticeMap.get(o.id)?.state||''))
   if(filter==='pending')return children.some(o=>routingMap.get(o.id)?.state==='AGUARDANDO_CONFERENCIA')
   if(filter==='ready')return children.some(o=>['APROVADO','ENCAMINHAMENTO_INICIADO'].includes(routingMap.get(o.id)?.state||''))
   if(filter==='sent')return children.every(o=>routingMap.get(o.id)?.state==='ENCAMINHADO')
   return true
 }),[groups,links,orders,query,filter,routingMap,noticeMap])
 const openGroup=async(g:OrderGroup)=>{
   if(!supabase)return
   setSelectedGroup(g);setGroupDetails([]);setGroupLoading(true);setError('');setPdfNotice('');setPdfError('')
   const ids=links.filter(l=>l.group_id===g.id).map(l=>l.order_id)
   const children=orders.filter(o=>ids.includes(o.id))
   if(children.length!==ids.length){setError('Nem todos os subpedidos estão disponíveis nesta página.');setGroupLoading(false);return}
   const {data,error:e}=await supabase.from('order_items').select('*').in('order_id',ids).order('id')
   if(e){setError('Falha ao carregar os itens consolidados.');setGroupLoading(false);return}
   setGroupDetails(children.map(order=>({order,items:((data||[]) as OrderItem[]).filter(i=>i.order_id===order.id)})))
   setGroupLoading(false)
 }
 const open=async(o:Order)=>{
  setSelectedGroup(null)
  if(!supabase)return
  setSelected(o);setItems([]);setEvents([]);setMessage('');setError('');setNote('');setPdfNotice('');setPdfError('')
  const [i,e]=await Promise.all([
   isSuperAdmin?supabase.from('order_items').select('*').eq('order_id',o.id).order('id'):supabase.rpc('ibuild_supplier_order_v1',{p_order_id:o.id}),
   isSuperAdmin?supabase.from('ibuild_order_events').select('id,kind,created_at,actor_kind').eq('order_id',o.id).order('created_at',{ascending:false}):Promise.resolve({data:[],error:null})
  ])
  if(i.error){setError('Não foi possível carregar os itens.');return}
  setItems((isSuperAdmin?(i.data||[]):(i.data?.items||[])) as OrderItem[]);setEvents((e.data||[]) as Event[])
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
  const {error:e}=await supabase.rpc('ibuild_supplier_set_status_v1',{p_order_id:selected.id,p_status:value})
  if(e)setError(e.message);else{setSelected({...selected,status:value});await refresh()}
  setBusy(false)
 }
 const r=selected?routingMap.get(selected.id):undefined,n=selected?noticeMap.get(selected.id):undefined
 const report=selected&&items.length&&isSuperAdmin?buildOrderReport(selected,items):''
 const supplier=selected&&items.length?buildSupplierReport(selected,items):''
 const visibleReport=isSuperAdmin?report:supplier
 const phone=selected?phones[selected.store_id]||'':''
 const validPhone=/^[1-9][0-9]{9,14}$/.test(phone)
 const longMessage=encodeURIComponent(supplier).length>2500
 const forwardURL=validPhone&&supplier?'https://wa.me/'+phone+(longMessage?'':'?text='+encodeURIComponent(supplier)):''
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
   <div className="ops-order-list">{isSuperAdmin&&visibleGroups.map(g=>{
     const childOrders=links.filter(l=>l.group_id===g.id).map(l=>orders.find(o=>o.id===l.order_id)).filter((o):o is Order=>Boolean(o))
     const pending=childOrders.filter(o=>routingMap.get(o.id)?.state!=='ENCAMINHADO').length
     return <button key={g.id} className="ops-order-card" onClick={()=>void openGroup(g)}>
       <span><strong>{g.public_number}</strong><small>{moment(g.created_at)} · consolidado</small></span>
       <span><strong>{String(childOrders[0]?.customer_snapshot?.trade_name||childOrders[0]?.customer_snapshot?.full_name||'Cliente')}</strong><small>{childOrders.length} fornecedor(es)</small></span>
       <span className="ops-order-value">{formatMoney(g.total)}<small>{pending} loja(s) não encaminhadas</small></span>
       <span className="ops-chevron">Conferir →</span>
     </button>
   })}{visible.filter(o=>!isSuperAdmin||!linkedOrderIds.has(o.id)).map(o=>{
    const c=o.customer_snapshot||{},s=o.store_snapshot||{},rt=routingMap.get(o.id),notice=noticeMap.get(o.id)
    return <button key={o.id} className="ops-order-card" onClick={()=>void open(o)}>
      <span><strong>{o.public_number}</strong><small>{moment(o.created_at)}</small></span>
      <span><strong>{String(c.trade_name||c.full_name||'Cliente')}</strong><small>{String(s.store_name||'Fornecedor')}</small></span>
      <span className="ops-order-value">{formatMoney(o.total)}<small>{isSuperAdmin?routingLabel(rt?.state):o.status}</small></span>
      {isSuperAdmin&&<span className="ops-notice">{notice?.state?.replaceAll('_',' ')||'—'}</span>}
      <span className="ops-chevron">Abrir →</span>
    </button>})}
   {!visible.filter(o=>!isSuperAdmin||!linkedOrderIds.has(o.id)).length&&!visibleGroups.length&&<div className="empty-state"><h3>Sem pedidos neste filtro</h3><p>Novas solicitações aparecerão aqui.</p></div>}</div>
  </section>
  {isSuperAdmin&&selectedGroup&&<div className="modal-shell">
    <button className="overlay open" aria-label="Fechar" onClick={()=>setSelectedGroup(null)}/>
    <section className="edit-panel ops-panel">
      <div className="drawer-head"><div><small>Pedido consolidado</small><h2>{selectedGroup.public_number}</h2></div>
        <button className="close" onClick={()=>setSelectedGroup(null)}>×</button></div>
      <div className="edit-form">
        <p>{groupDetails.length} loja(s) · Total: <strong>{formatMoney(selectedGroup.total)}</strong></p>
        {groupLoading?<p>Carregando fornecedores…</p>:<>
          {groupDetails.map(({order,items})=><div className="section-card" key={order.id}>
            <h3>{String(order.store_snapshot?.store_name||'Fornecedor')}</h3>
            <p>{order.public_number} · {formatMoney(order.total)} · {routingLabel(routingMap.get(order.id)?.state)}</p>
            <p>{items.length} item(ns)</p>
            <div className="action-row">
              <button className="secondary" disabled={!supplierPdfs[order.id]}
                onClick={()=>downloadPdf(supplierPdfs[order.id])}>
                {supplierPdfs[order.id]?'Baixar PDF da loja':'Preparando PDF…'}
              </button>
              <button className="secondary" disabled={!supplierPdfs[order.id]||routingMap.get(order.id)?.state!=='ENCAMINHAMENTO_INICIADO'}
                title="Disponível após aprovar e preparar o encaminhamento"
                onClick={()=>sharePdf(supplierPdfs[order.id])}>Compartilhar PDF</button>
              <button className="secondary" disabled={secureBusy!==null} onClick={()=>void prepareSecureDocument(order.id)}>
                {secureBusy===order.id?'Gerando link…':'Preparar PDF privado e WhatsApp'}
              </button>
              {secureDocuments[order.id]&&<>
                <a className="secondary" href={secureDocuments[order.id].pdf_url} target="_blank" rel="noopener noreferrer">Visualizar PDF privado (1 hora)</a>
                {secureDocuments[order.id].whatsapp_url&&<a className="secondary" href={secureDocuments[order.id].whatsapp_url!} target="_blank" rel="noopener noreferrer">Abrir WhatsApp do proprietário (envio manual)</a>}
              </>}
              <button className="primary fit" onClick={()=>void open(order)}>Conferir ou encaminhar esta loja</button>
            </div>
          </div>)}
          {groupDetails.length>0&&groupDetails.every(x=>x.items.length>0)&&<>
            <h3>Relatório administrativo consolidado</h3>
            <pre className="order-report">{buildGroupReport(selectedGroup,groupDetails,true)}</pre>
            <button className="secondary" onClick={()=>void navigator.clipboard.writeText(buildGroupReport(selectedGroup,groupDetails,true))}>Copiar relatório consolidado</button>
          </>}
        </>}
        {pdfNotice&&<div className="status" role="status">{pdfNotice}</div>}
        {pdfError&&<div className="status error" role="alert">{pdfError}</div>}
        {error&&<div className="status error">{error}</div>}
      </div>
    </section>
  </div>}
  {selected&&<div className="modal-shell"><button className="overlay open" aria-label="Fechar" onClick={()=>setSelected(null)}/>
   <section className="edit-panel ops-panel"><div className="drawer-head"><div><small>{String(selected.store_snapshot?.store_name||'Fornecedor')}</small><h2>{selected.public_number}</h2></div><button className="close" onClick={()=>setSelected(null)}>×</button></div>
    <div className="edit-form">
      <div className="ops-state"><div><small>Status do pedido</small><strong>{selected.status}</strong></div>{isSuperAdmin&&<div><small>Intermediação</small><strong>{routingLabel(r?.state)}</strong></div>}</div>
      {isSuperAdmin&&n&&<div className="status">WhatsApp: {n.state.replaceAll('_',' ')}{n.last_error&&<p>{n.last_error}</p>}</div>}
      {message&&<div className="status" role="status">{message}</div>}
      {error&&<div className="status error" role="alert">{error}</div>}
      <h3>{isSuperAdmin?'Relatório administrativo — iBuild':'Relatório comercial — sua loja'}</h3><pre className="order-report">{visibleReport||'Carregando itens...'}</pre>
      {items.length>0&&<div className="action-row">
        <button className="secondary" disabled={!selected||!supplierPdfs[selected.id]}
          onClick={()=>selected&&downloadPdf(supplierPdfs[selected.id])}>
          {selected&&supplierPdfs[selected.id]?'Baixar pedido desta loja em PDF':'Preparando PDF…'}
        </button>
        {isSuperAdmin&&selected&&<button className="secondary" disabled={secureBusy!==null}
          onClick={()=>void prepareSecureDocument(selected.id)}>
          {secureBusy===selected.id?'Gerando link…':'Preparar PDF privado e WhatsApp'}
        </button>}
        {isSuperAdmin&&selected&&secureDocuments[selected.id]&&<>
          <a className="secondary" href={secureDocuments[selected.id].pdf_url} target="_blank" rel="noopener noreferrer">Visualizar PDF privado (1 hora)</a>
          {secureDocuments[selected.id].whatsapp_url&&<a className="secondary" href={secureDocuments[selected.id].whatsapp_url!} target="_blank" rel="noopener noreferrer">Abrir WhatsApp do proprietário (envio manual)</a>}
        </>}
        {isSuperAdmin&&<button className="secondary"
          disabled={!selected||!supplierPdfs[selected.id]||r?.state!=='ENCAMINHAMENTO_INICIADO'}
          title="Disponível após aprovação e preparação do encaminhamento"
          onClick={()=>selected&&sharePdf(supplierPdfs[selected.id])}>Compartilhar PDF no celular</button>}
      </div>}
      {pdfNotice&&<div className="status" role="status">{pdfNotice}</div>}
      {pdfError&&<div className="status error" role="alert">{pdfError}</div>}
      {isSuperAdmin&&r&&selected.status!=='CANCELADO'&&<>
       <h3>Conferência do intermediário</h3>
       <label className="form-field"><span>Observação interna (opcional)</span><textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
       {r.state==='AGUARDANDO_CONFERENCIA'&&<div className="action-row"><button className="primary fit" disabled={busy||!report} onClick={()=>void act('APPROVE')}>Aprovar pedido</button><button className="secondary" disabled={busy} onClick={()=>void act('REJECT')}>Rejeitar</button></div>}
       {r.state==='APROVADO'&&<button className="primary" disabled={busy||!validPhone} onClick={()=>void act('START_FORWARD')}>{validPhone?'Preparar envio à loja':'Cadastre um WhatsApp válido da loja'}</button>}
       {r.state==='ENCAMINHAMENTO_INICIADO'&&<div className="ops-forward">
        <p>Compartilhe o PDF no celular (escolhendo o contato da loja) ou baixe-o e anexe manualmente no WhatsApp. Abrir a conversa não registra envio.</p>
        {longMessage&&<p className="status">Relatório extenso: use «Copiar relatório», abra o WhatsApp e cole a mensagem manualmente.</p>}
        <pre className="order-report">{supplier}</pre>
        <div className="action-row"><button className="secondary" onClick={()=>void navigator.clipboard.writeText(supplier)}>Copiar relatório</button>{forwardURL&&<a className="primary button-link whatsapp fit" href={forwardURL} target="_blank" rel="noopener noreferrer">Abrir WhatsApp da loja</a>}</div>
        <button className="primary" disabled={busy||!validPhone} onClick={()=>void act('CONFIRM_FORWARD')}>Confirmar que enviei à loja</button>
       </div>}
       {r.state==='ENCAMINHADO'&&<div className="status">Envio confirmado por você em {moment(r.forwarded_at)}.</div>}
       {r.state==='REJEITADO'&&<div className="status error">Pedido rejeitado.</div>}
      </>}
      {!isSuperAdmin&&<label className="form-field"><span>Atualizar status comercial</span><select disabled={busy} value={selected.status} onChange={e=>void updateStatus(e.target.value as OrderStatus)}>{orderStatuses.filter(s=>!['NOVO','CANCELADO'].includes(s)).map(s=><option key={s}>{s}</option>)}</select></label>}
      <div className="action-row"><button className="secondary" disabled={!visibleReport} onClick={()=>void navigator.clipboard.writeText(visibleReport)}>Copiar relatório</button></div>
      {isSuperAdmin&&<><h3>Histórico</h3><div className="ops-timeline">{events.map(e=><div key={e.id}><strong>{e.kind.replaceAll('_',' ').toLowerCase()}</strong><small>{moment(e.created_at)} · {e.actor_kind}</small></div>)}{!events.length&&<p>Sem eventos adicionais.</p>}</div></>}
    </div>
   </section></div>}
 </div>
}
