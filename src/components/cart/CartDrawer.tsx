import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CreateOrderResult, Product, Store, StoreSettings } from '../../types'
import { useCart } from '../../hooks/useCart'
import { useAuth } from '../../hooks/useAuth'
import { formatMoney } from '../../lib/money'
import { hasSupabaseConfig, supabase } from '../../lib/supabase'

export function CartDrawer({ open, onClose, products, store, settings }: { open: boolean, onClose: () => void, products: Product[], store: Store, settings: StoreSettings }) {
  const { lines, setQuantity, clear, totalUnits } = useCart()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CreateOrderResult | null>(null)
  const [report, setReport] = useState('')

  const items = useMemo(() => lines.map((line) => ({ ...line, product: products.find((p) => p.sku === line.sku) })).filter((x): x is typeof x & { product: Product } => Boolean(x.product)), [lines, products])
  const productPrice = (p: Product) => p.effective_price ?? p.promotional_price ?? p.price
  const total = items.reduce((sum, item) => sum + item.qty * productPrice(item.product), 0)

  const buildReport = (order: CreateOrderResult) => {
    const customer = profile?.trade_name || profile?.full_name || profile?.email || 'Cliente'
    const itemLines = items.map(({ product, qty }) => {
      const price = productPrice(product)
      const code = product.store_product_code || product.sku
      return `${qty}x ${code} · ${product.name}\n${formatMoney(price)} / ${product.unit} · Subtotal ${formatMoney(price * qty)}`
    }).join('\n\n')
    return [
      `PEDIDO ${order.public_number}`,
      `Loja: ${store.name}`,
      `Cliente: ${customer}`,
      profile?.document ? `${profile.person_type}: ${profile.document}` : '',
      profile?.phone ? `Contato: ${profile.phone}` : '',
      '', itemLines, '', `TOTAL: ${formatMoney(order.total)}`,
      notes.trim() ? `Observações: ${notes.trim()}` : '',
    ].filter(Boolean).join('\n')
  }

  const checkout = async () => {
    setError('')
    if (!user) { onClose(); navigate('/login?returnTo=/'); return }
    if (!hasSupabaseConfig || !supabase) { setError('O banco ainda precisa ser conectado para registrar pedidos.'); return }
    if (!items.length) return
    setSubmitting(true)
    const key = crypto.randomUUID ? crypto.randomUUID() : `order-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const payload = items.map((item) => ({ offer_id: item.product.offer_id, sku: item.product.sku, qty: item.qty, expected_price: productPrice(item.product) }))
    const { data, error: rpcError } = await supabase.rpc('create_order', { p_store_id: store.id, p_items: payload, p_notes: notes.trim() || null, p_idempotency_key: key })
    setSubmitting(false)
    if (rpcError) {
      const msg = rpcError.message.includes('PRICE_CHANGED') ? 'Um ou mais preços mudaram. Atualize o catálogo e confira o carrinho novamente.' : rpcError.message
      setError(msg); return
    }
    const parsed = data as CreateOrderResult
    setResult(parsed)
    setReport(buildReport(parsed))
    clear()
  }

  const whatsapp = result?.seller_whatsapp || settings.seller_whatsapp || ''
  const whatsappUrl = whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(report)}` : ''

  if (!open) return null
  return <>
    <button className="overlay open" aria-label="Fechar carrinho" onClick={onClose} />
    <aside className="cart-drawer open" aria-label="Carrinho">
      <div className="drawer-head"><div><small>{result ? 'Pedido registrado' : `${totalUnits} item(ns) · ${store.name}`}</small><h2>{result ? result.public_number : 'Seu carrinho'}</h2></div><button className="close" onClick={onClose}>×</button></div>
      <div className="drawer-body">
        {result ? <div className="success-panel">
          <div className="success-icon">✓</div><h3>Pedido salvo com sucesso</h3>
          <p>Total oficial: <strong>{formatMoney(result.total)}</strong></p>
          <pre className="order-report">{report}</pre>
          {whatsappUrl && <a className="primary whatsapp" href={whatsappUrl} target="_blank" rel="noreferrer">Abrir pedido no WhatsApp</a>}
          <button className="secondary full" onClick={() => { setResult(null); setReport(''); setNotes(''); onClose() }}>Continuar no catálogo</button>
        </div> : items.length ? <>
          {items.map(({ product, qty }) => <div className="cart-line" key={product.sku}>
            <div><h4>{product.name}</h4><p>{product.store_product_code || product.sku} · {formatMoney(productPrice(product))} / {product.unit}</p></div>
            <strong>{formatMoney(productPrice(product) * qty)}</strong>
            <div></div><div className="stepper"><button onClick={() => setQuantity(product.sku, qty - 1)}>−</button><output>{qty}</output><button className="plus" onClick={() => setQuantity(product.sku, qty + 1)}>+</button></div>
          </div>)}
          <label className="form-field"><span>Observações (opcional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Ex.: separar material para retirada amanhã." /></label>
          {error && <div className="status error">{error}</div>}
        </> : <div className="empty-state"><h3>Seu carrinho está vazio</h3><p>Adicione produtos pelo catálogo.</p></div>}
      </div>
      {!result && items.length > 0 && <div className="drawer-bottom">
        <div className="totals"><span>Total estimado</span><strong>{formatMoney(total)}</strong></div>
        <p className="small-note">O preço da {store.name} é revalidado no servidor antes de registrar o pedido.</p>
        <button className="primary" disabled={submitting} onClick={() => void checkout()}>{submitting ? 'Registrando…' : user ? 'Finalizar pedido' : 'Entrar para finalizar'}</button>
      </div>}
    </aside>
  </>
}
