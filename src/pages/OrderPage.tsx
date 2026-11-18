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
    Promise.all([
      supabase.from('orders').select('*').eq('id',id).maybeSingle(),
      supabase.from('order_items').select('*').eq('order_id',id).order('id')
    ]).then(([orderResponse,itemResponse])=>{
      if(!current)return
      if(orderResponse.error||itemResponse.error){setLoadError('Não foi possível carregar o relatório oficial do pedido.');return}
      if(!orderResponse.data){setLoadError('Pedido não encontrado ou sem permissão de acesso.');return}
      if(!itemResponse.data?.length){setLoadError('Os itens do pedido não estão disponíveis.');return}
      setOrder(orderResponse.data as Order)
      setItems(itemResponse.data as OrderItem[])
    }).catch(()=>{
      if(current)setLoadError('Falha ao consultar o pedido. Tente novamente mais tarde.')
    }).finally(()=>{if(current)setLoading(false)})
    return ()=>{current=false}
  },[id])
  if(loading)return <div className="page-state">Carregando pedido…</div>;if(loadError)return <div className="container standard-page"><div className="status error" role="alert">{loadError}</div></div>;if(!order)return <div className="container standard-page"><div className="status error">Pedido não encontrado ou sem permissão de acesso.</div></div>
  const report=buildOrderReport(order,items);const whatsapp=String((order.store_snapshot as any)?.seller_whatsapp||'').replace(/\D/g,'')
  return <div className="container standard-page"><Link className="back-link" to="/conta">← Meus pedidos</Link><div className="page-heading"><div><span className="eyebrow">Pedido</span><h1>{order.public_number}</h1><p>{new Date(order.created_at).toLocaleString('pt-BR')}</p></div><span className="status-pill big">{order.status}</span></div><section className="section-card"><div className="table-wrap"><table><thead><tr><th>Cód.</th><th>Produto</th><th>Qtd.</th><th>Unitário</th><th>Subtotal</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.store_product_code_snapshot||item.sku_snapshot}</td><td>{item.product_name_snapshot}</td><td>{item.quantity}</td><td>{formatMoney(item.unit_price_snapshot)}</td><td>{formatMoney(item.subtotal)}</td></tr>)}</tbody></table></div><div className="order-total"><span>Total</span><strong>{formatMoney(order.total)}</strong></div></section><section className="section-card"><h2>Relatório para o vendedor</h2><pre className="order-report">{report}</pre><div className="action-row"><button className="secondary" onClick={()=>void navigator.clipboard.writeText(report)}>Copiar relatório</button>{whatsapp&&<a className="primary button-link whatsapp" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(report)}`} target="_blank" rel="noreferrer">Abrir no WhatsApp</a>}</div></section></div>}
