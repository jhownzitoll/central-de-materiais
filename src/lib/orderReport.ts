import type { Order, OrderItem } from '../types'
import { formatMoney } from './money'

export function buildOrderReport(order: Order, items: OrderItem[]) {
  const c = order.customer_snapshot || {}; const store = order.store_snapshot || {}; const name = String(c.trade_name || c.full_name || 'Cliente')
  const lines = [`PEDIDO ${order.public_number}`,new Date(order.created_at).toLocaleString('pt-BR'),`Loja: ${String(store.store_name || '-')}`,'','CLIENTE',`Nome: ${name}`,`Documento: ${String(c.document || '-')}`,`Telefone: ${String(c.phone || '-')}`,`E-mail: ${String(c.email || '-')}`,'','ITENS']
  items.forEach((item) => { const code = item.store_product_code_snapshot ? ` | Cód. loja ${item.store_product_code_snapshot}` : ''; lines.push(`${item.quantity} × ${item.product_name_snapshot} | SKU ${item.sku_snapshot}${code} | ${formatMoney(item.unit_price_snapshot)} | ${formatMoney(item.subtotal)}`) })
  lines.push('', `TOTAL: ${formatMoney(order.total)}`); if (order.notes) lines.push(`Observações: ${order.notes}`); if (store.seller_name) lines.push('', `Vendedor: ${String(store.seller_name)}`); return lines.join('\n')
}
