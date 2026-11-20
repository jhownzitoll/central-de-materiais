import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CreateMultiOrderResult, Product, Store, StoreSettings, Order, OrderItem } from '../../types'
import { useCart } from '../../hooks/useCart'
import { useAuth } from '../../hooks/useAuth'
import { formatMoney } from '../../lib/money'
import { buildGroupReport } from '../../lib/groupReport'
import { hasCompleteCheckoutProfile } from '../../lib/customerDetails'
import { hasSupabaseConfig, supabase } from '../../lib/supabase'

type CartItem = { sku: string; qty: number; product: Product }
const newKey = () => crypto.randomUUID()

export function CartDrawer({ open, onClose, products, store }: {
  open: boolean; onClose: () => void; products: Product[]; store: Store; settings: StoreSettings
}) {
  const { lines, setQuantity, clear, totalUnits } = useCart()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [notes, setNotes] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CreateMultiOrderResult | null>(null)
  const [report, setReport] = useState('')
  const [reportError, setReportError] = useState('')
  const checkoutKey = useRef(newKey())
  useEffect(() => { checkoutKey.current = newKey() }, [lines,notes,deliveryMethod])

  const items = useMemo<CartItem[]>(() => lines.map(line => ({
    ...line, product: products.find(p => p.offer_id === line.sku || p.sku === line.sku),
  })).filter((x): x is CartItem => Boolean(x.product)), [lines,products])
  const incompleteCart = items.length !== lines.length
  const priceOf = (p: Product) => p.effective_price ?? p.promotional_price ?? p.price
  const total = items.reduce((v,i)=>v+i.qty*priceOf(i.product),0)
  const groups = useMemo(()=>Array.from(new Set(items.map(i=>i.product.store_id||store.id))),[items,store.id])

  const checkout = async () => {
    setError('')
    if (!user) { onClose(); navigate('/login?returnTo=/'); return }
    if (!hasSupabaseConfig || !supabase) { setError('O banco ainda precisa ser conectado.'); return }
    if (!items.length || incompleteCart) { setError('Existem materiais indisponíveis no carrinho. Atualize o catálogo.'); return }
    if (!hasCompleteCheckoutProfile(profile,deliveryMethod)) {
      setError('Complete os dados cadastrais e o endereço de entrega em Minha conta antes de finalizar. Para retirada, endereço não é obrigatório.')
      return
    }
    setSubmitting(true)
    const payload=items.map(i=>({
      offer_id:i.product.offer_id,sku:i.product.sku,qty:i.qty,expected_price:priceOf(i.product),
    }))
    try {
      const {data,error:rpcError}=await supabase.rpc('create_multi_order_v1',{
        p_items:payload,p_notes:notes.trim()||null,
        p_idempotency_key:checkoutKey.current,p_delivery_method:deliveryMethod,
      })
      if(rpcError){
        const msg=rpcError.message
        setError(msg.includes('PRICE_CHANGED')?'Um ou mais preços mudaram. Atualize o catálogo e confira o carrinho novamente.'
          :msg.includes('SELLER_NOT_CONFIGURED')?'Uma loja não possui contato comercial configurado. Avise a administração.'
          :msg.includes('BUSINESS_DETAILS_REQUIRED')?'Complete os dados da empresa e responsável em Minha conta.'
          :msg.includes('DELIVERY_ADDRESS_REQUIRED')?'Complete o endereço de entrega em Minha conta.'
          :msg.includes('PROFILE_INCOMPLETE')?'Complete seus dados cadastrais em Minha conta.'
          :msg.includes('REQUEST_KEY_CONFLICT')?'O carrinho mudou durante a tentativa. Revise os produtos e tente novamente.'
          :msg)
        return
      }
      const parsed=data as CreateMultiOrderResult
      if(!parsed?.group_id || !parsed.orders?.length) throw new Error('INVALID_GROUP_RESPONSE')
      const childIds=parsed.orders.map(o=>o.order_id)
      const [ordersResponse,itemsResponse]=await Promise.all([
        supabase.from('orders').select('*').in('id',childIds),
        supabase.from('order_items').select('*').in('order_id',childIds).order('id'),
      ])
      if(ordersResponse.error || itemsResponse.error || !ordersResponse.data?.length || !itemsResponse.data?.length){
        setReport('')
        setReportError('Pedido registrado. Consulte o comprovante em Meus pedidos.')
      } else {
        const children=(ordersResponse.data as Order[]).map(order=>({
          order,items:(itemsResponse.data as OrderItem[]).filter(i=>i.order_id===order.id),
        }))
        setReport(buildGroupReport({
          public_number:parsed.public_number,total:parsed.total,created_at:new Date().toISOString(),
        },children))
        setReportError('')
      }
      setResult(parsed)
      clear()
      checkoutKey.current=newKey()
      // A distribuição às lojas é exclusiva da central administrativa.
      // Não disparar WhatsApp Cloud API ou mensagens aos vendedores na compra do cliente.
    } catch {
      setError('Não foi possível confirmar a solicitação. Consulte Meus pedidos antes de tentar novamente.')
    } finally {setSubmitting(false)}
  }

  if(!open)return null
  return <>
    <button className="overlay open" aria-label="Fechar carrinho" onClick={onClose}/>
    <aside className="cart-drawer open" aria-label="Carrinho">
      <div className="drawer-head"><div>
        <small>{result?'Pedido consolidado registrado':`${totalUnits} item(ns) · ${groups.length} fornecedor(es)`}</small>
        <h2>{result?result.public_number:'Seu carrinho'}</h2>
      </div><button className="close" onClick={onClose}>×</button></div>
      <div className="drawer-body">
        {result?<div className="success-panel">
          <div className="success-icon">✓</div>
          <h3>Pedido salvo com sucesso</h3>
          <p>Total oficial: <strong>{formatMoney(result.total)}</strong></p>
          <p>{result.orders.length} loja(s) no pedido. A central iBuild conferirá e encaminhará cada parte ao fornecedor correspondente.</p>
          {report?<pre className="order-report">{report}</pre>
            :<div className="status error" role="status">{reportError||'Comprovante indisponível neste momento.'}</div>}
          <button className="secondary full" onClick={()=>{onClose();navigate(`/pedido/grupo/${result.group_id}`)}}>Abrir pedido consolidado</button>
          <button className="secondary full" onClick={()=>{setResult(null);setReport('');setReportError('');setNotes('');onClose()}}>Continuar no catálogo</button>
        </div>:items.length?<>{items.map(({product,qty})=>
          <div className="cart-line" key={product.offer_id||product.sku}>
            <div><h4>{product.name}</h4><p>{product.store_name||store.name} · {product.store_product_code||product.sku} · {formatMoney(priceOf(product))} / {product.unit}</p></div>
            <strong>{formatMoney(priceOf(product)*qty)}</strong>
            <div></div><div className="stepper">
              <button onClick={()=>setQuantity(product.offer_id||product.sku,qty-1)}>−</button>
              <output>{qty}</output>
              <button className="plus" onClick={()=>setQuantity(product.offer_id||product.sku,qty+1)}>+</button>
            </div>
          </div>)}
          {incompleteCart&&<div className="status error">O carrinho contém produtos que não estão mais disponíveis. Atualize o catálogo.</div>}
          <div className="delivery-choice" role="group" aria-label="Como deseja receber o pedido?">
            <h4>Como deseja receber?</h4>
            <label><input type="radio" name="deliveryMethod" checked={deliveryMethod==='DELIVERY'} onChange={()=>setDeliveryMethod('DELIVERY')}/> Entrega no endereço cadastrado</label>
            <label><input type="radio" name="deliveryMethod" checked={deliveryMethod==='PICKUP'} onChange={()=>setDeliveryMethod('PICKUP')}/> Retirada nas respectivas lojas</label>
          </div>
          {deliveryMethod==='DELIVERY'&&<p className="delivery-summary">{profile?.delivery_street?
            `${profile.delivery_street}, ${profile.delivery_number||'S/N'} · ${profile.delivery_district||''} · ${profile.delivery_city||''}/${profile.delivery_state||''} · CEP ${profile.delivery_postal_code||''}`
            :'Nenhum endereço informado.'}</p>}
          {user&&!hasCompleteCheckoutProfile(profile,deliveryMethod)&&<button className="secondary full" type="button" onClick={()=>{onClose();navigate('/conta')}}>Completar cadastro e endereço</button>}
          <label className="form-field"><span>Observações (opcional)</span>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={500} placeholder="Ex.: separar material para retirada amanhã."/>
          </label>
          {error&&<div className="status error">{error}</div>}
        </>:<div className="empty-state"><h3>Seu carrinho está vazio</h3><p>Adicione produtos pelo catálogo.</p></div>}
      </div>
      {!result&&items.length>0&&<div className="drawer-bottom">
        <div className="totals"><span>Total estimado</span><strong>{formatMoney(total)}</strong></div>
        <p className="small-note">Os preços de todas as lojas são revalidados no servidor. Um subpedido será criado para cada fornecedor.</p>
        <button className="primary" disabled={submitting||incompleteCart} onClick={()=>void checkout()}>
          {submitting?'Registrando…':user?'Finalizar pedido':'Entrar para finalizar'}
        </button>
      </div>}
    </aside>
  </>
}
