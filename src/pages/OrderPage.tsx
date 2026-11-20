import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buildOrderReport } from '../lib/orderReport'
import { formatMoney } from '../lib/money'
import type { Order, OrderItem } from '../types'

export function OrderPage(){const{id}=useParams();const[order,setOrder]=useState<Order|null>(null);const[items,setItems]=useState<OrderItem[]>([]);const[loading,setLoading]=useState(true);const[loadError,setLoadError]=useState('')
  useEffect(()=>{
    if(!supabase||!id){setLoadError('O pedido não está disponível.');setLoading(false);return}
    let current=true
    supabase.rpc('ibuild_customer_order_v1',{p_order_id:id}).then(({data,error:queryError})=>{
      if(!current)return
      if(queryError || !data?.order || !data?.items?.length){
        setLoadError('Pedido não encontrado ou sem permissão de acesso.');return
      }
      setOrder(data.order as Order)
      setItems(data.items as OrderItem[])
    }).catch(()=>{
      if(current)setLoadError('Falha ao consultar o pedido. Tente novamente.')
    }).finally(()=>{if(current)setLoading(false)})
    return ()=>{current=false}
  },[id])
  if(loading)return <div className="page-state">Carregando pedido…</div>;if(loadError)return <div className="container standard-page"><div className="status error" role="alert">{loadError}</div></div>;if(!order)return <div className="container standard-page"><div className="status error">Pedido não encontrado ou sem permissão de acesso.</div></div>
  const report=buildOrderReport(order,items)
  return <div className="container standard-page"><Link className="back-link" to="/conta">← Meus pedidos</Link><div className="page-heading"><div><span className="eyebrow">Pedido</span><h1>{order.public_number}</h1><p>{new Date(order.created_at).toLocaleString('pt-BR')}</p></div><span className="status-pill big">{order.status}</span></div><section className="section-card"><div className="table-wrap"><table><thead><tr><th>Cód.</th><th>Produto</th><th>Qtd.</th><th>Unitário</th><th>Subtotal</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.store_product_code_snapshot||item.sku_snapshot}</td><td>{item.product_name_snapshot}</td><td>{item.quantity}</td><td>{formatMoney(item.unit_price_snapshot)}</td><td>{formatMoney(item.subtotal)}</td></tr>)}</tbody></table></div><div className="order-total"><span>Total</span><strong>{formatMoney(order.total)}</strong></div></section><section className="section-card"><h2>Relatório da solicitação</h2><pre className="order-report">{report}</pre><div className="action-row"><button className="secondary" onClick={()=>void navigator.clipboard.writeText(report)}>Copiar relatório</button></div></section></div>}
