import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buildGroupReport, type GroupOrderDetails } from '../lib/groupReport'
import { formatMoney } from '../lib/money'
import type { OrderGroup, Order, OrderItem, OrderGroupLink } from '../types'

export function GroupOrderPage(){
  const {id}=useParams()
  const [group,setGroup]=useState<OrderGroup|null>(null)
  const [children,setChildren]=useState<GroupOrderDetails[]>([])
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  useEffect(()=>{
    if(!id||!supabase){setError('Pedido indisponível.');setLoading(false);return}
    let alive=true
    const load=async()=>{
      try{
        const [g,l]=await Promise.all([
          supabase!.from('order_groups').select('*').eq('id',id).maybeSingle(),
          supabase!.from('order_group_orders').select('order_id,group_id,store_id').eq('group_id',id),
        ])
        if(g.error||l.error||!g.data||!l.data?.length)throw new Error('Pedido não encontrado ou sem permissão.')
        const links=l.data as OrderGroupLink[]
        const ids=links.map(i=>i.order_id)
        const [o,i]=await Promise.all([
          supabase!.from('orders').select('*').in('id',ids),
          supabase!.from('order_items').select('*').in('order_id',ids).order('id'),
        ])
        if(o.error||i.error||!o.data||!i.data)throw new Error('Não foi possível consultar os subpedidos.')
        const children=(o.data as Order[]).map(order=>({order,items:(i.data as OrderItem[]).filter(item=>item.order_id===order.id)}))
        if(children.length!==links.length||children.some(child=>!child.items.length))throw new Error('Subpedidos ainda não disponíveis.')
        if(alive){setGroup(g.data as OrderGroup);setChildren(children)}
      }catch(e){if(alive)setError(e instanceof Error?e.message:'Erro ao consultar pedido.')}
      finally{if(alive)setLoading(false)}
    }
    void load()
    return()=>{alive=false}
  },[id])
  if(loading)return <div className="page-state">Carregando pedido consolidado…</div>
  if(error||!group)return <div className="container standard-page"><div className="status error" role="alert">{error||'Pedido não encontrado.'}</div></div>
  const report=buildGroupReport(group,children)
  return <div className="container standard-page">
    <Link className="back-link" to="/conta">← Meus pedidos</Link>
    <div className="page-heading"><div><span className="eyebrow">Pedido consolidado</span><h1>{group.public_number}</h1><p>{new Date(group.created_at).toLocaleString('pt-BR')} · {children.length} fornecedor(es)</p></div></div>
    {children.map(({order,items})=><section className="section-card" key={order.id}>
      <h2>{String(order.store_snapshot?.store_name||'Fornecedor')}</h2>
      <p>Subpedido: {order.public_number} · Situação: {order.status}</p>
      <div className="table-wrap"><table><thead><tr><th>Cód.</th><th>Material</th><th>Qtd.</th><th>Subtotal</th></tr></thead>
      <tbody>{items.map(item=><tr key={item.id}><td>{item.store_product_code_snapshot||item.sku_snapshot}</td><td>{item.product_name_snapshot}</td><td>{item.quantity}</td><td>{formatMoney(item.subtotal)}</td></tr>)}</tbody></table></div>
      <div className="order-total"><span>Total da loja</span><strong>{formatMoney(order.total)}</strong></div>
    </section>)}
    <section className="section-card"><h2>Total consolidado: {formatMoney(group.total)}</h2>
      <h3>Comprovante da solicitação</h3><pre className="order-report">{report}</pre>
      <button className="secondary" onClick={()=>void navigator.clipboard.writeText(report)}>Copiar comprovante</button>
    </section>
  </div>
}
