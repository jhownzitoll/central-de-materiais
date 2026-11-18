import type { Order, OrderItem } from '../types'
import { formatMoney } from './money'

export function buildOrderReport(order: Order, items: OrderItem[]) {
  const c = order.customer_snapshot || {}
  const store = order.store_snapshot || {}
  const isCompany = String(c.person_type || '') === 'CNPJ'
  const name = String(c.trade_name || c.full_name || 'Cliente')
  const method = String(c.delivery_method || order.delivery_method || 'DELIVERY')
  const rawAddress = c.delivery_address
  const address = rawAddress && typeof rawAddress === 'object' && !Array.isArray(rawAddress)
    ? rawAddress as Record<string, unknown> : null

  const lines = [
    `PEDIDO ${order.public_number}`,
    new Date(order.created_at).toLocaleString('pt-BR'),
    `Loja: ${String(store.store_name || '-')}`, '',
    'CLIENTE',
    `${isCompany ? 'Nome fantasia' : 'Nome'}: ${name}`,
    isCompany ? `Razão social: ${String(c.legal_name || '-')}` : '',
    isCompany ? `Responsável: ${String(c.responsible_name || c.full_name || '-')}` : '',
    `${isCompany ? 'CNPJ' : 'CPF'}: ${String(c.document || '-')}`,
    `Telefone: ${String(c.phone || '-')}`,
    `E-mail: ${String(c.email || '-')}`, '',
    'RECEBIMENTO',
    method === 'PICKUP' ? 'Modalidade: Retirada na loja' : 'Modalidade: Entrega',
  ].filter(line=>line!=='')
  if (method === 'DELIVERY') {
    if (address) {
      const line = [address.street, address.number].filter(Boolean).join(', ')
      const complement = address.complement ? ` — ${String(address.complement)}` : ''
      lines.push(`Endereço: ${line}${complement}`)
      lines.push(`Bairro: ${String(address.district || '-')}`)
      lines.push(`Cidade/UF: ${String(address.city || '-')}/${String(address.state || '-')}`)
      lines.push(`CEP: ${String(address.postal_code || '-')}`)
      if (address.reference) lines.push(`Referência: ${String(address.reference)}`)
    } else {
      lines.push('Endereço: não registrado (pedido anterior à atualização do cadastro)')
    }
  }
  lines.push('', 'ITENS')
  items.forEach(item=>{
    const code = item.store_product_code_snapshot ? ` | Cód. loja ${item.store_product_code_snapshot}` : ''
    lines.push(`${item.quantity} × ${item.product_name_snapshot} | SKU ${item.sku_snapshot}${code} | ${formatMoney(item.unit_price_snapshot)} | ${formatMoney(item.subtotal)}`)
  })
  lines.push('', `TOTAL: ${formatMoney(order.total)}`)
  if (order.notes) lines.push(`Observações: ${order.notes}`)
  if (store.seller_name) lines.push('', `Vendedor: ${String(store.seller_name)}`)
  return lines.join('\n')
}
