import type { Order, OrderGroup, OrderItem } from '../types'
import { formatMoney } from './money'

export type GroupOrderDetails = { order: Order; items: OrderItem[] }

/** Both formats use persisted order snapshots, never product prices from the current catalog. */
export function buildGroupReport(
  group: Pick<OrderGroup,'public_number'|'total'|'created_at'>,
  suborders: GroupOrderDetails[],
  administrator = false,
): string {
  if (!suborders.length || suborders.some(s => !s.items.length)) throw new Error('GROUP_ITEMS_REQUIRED')
  const customer = suborders[0].order.customer_snapshot || {}
  const buyer = String(customer.trade_name || customer.full_name || 'Cliente')
  const lines = [
    administrator ? 'iBUILD MATERIAIS — RELATÓRIO ADMINISTRATIVO CONSOLIDADO' : 'iBUILD MATERIAIS — COMPROVANTE CONSOLIDADO',
    'Pedido: ' + group.public_number,
    'Data: ' + new Date(group.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    'Cliente: ' + buyer,
    'Contato: ' + String(customer.phone || '—'),
    'Recebimento: ' + (suborders[0].order.delivery_method === 'PICKUP' ? 'Retirada em cada loja' : 'Entrega'),
  ]
  const address = customer.delivery_address
  if (address && typeof address === 'object' && !Array.isArray(address)) {
    const a = address as Record<string,unknown>
    lines.push('Endereço: ' + [a.street,a.number,a.district,a.city,a.state,a.postal_code].filter(Boolean).join(', '))
  }
  let sum = 0
  let fees = 0
  for (const { order, items } of suborders) {
    const seller = order.store_snapshot || {}
    sum += Number(order.total)
    fees += Number(order.platform_fee_total || 0)
    lines.push('', 'FORNECEDOR: ' + String(seller.store_name || 'Loja'), 'Subpedido: ' + order.public_number)
    for (const item of items) {
      lines.push(' • ' + item.product_name_snapshot + ' (' + (item.store_product_code_snapshot || item.sku_snapshot) + ')')
      lines.push('   ' + item.quantity + ' × ' + formatMoney(item.unit_price_snapshot) + ' = ' + formatMoney(item.subtotal))
    }
    lines.push('Subtotal da loja: ' + formatMoney(order.total))
    if (administrator) {
      const base = items.reduce((v,i) => v + Number(i.base_unit_price_snapshot ?? i.unit_price_snapshot) * i.quantity, 0)
      lines.push('Valor base de referência: ' + formatMoney(base))
      lines.push('Taxa iBuild desta loja: ' + formatMoney(order.platform_fee_total || 0))
    }
  }
  lines.push('', 'TOTAL CONSOLIDADO: ' + formatMoney(group.total))
  if (administrator) lines.push('TAXAS IBUILD CONSOLIDADAS: ' + formatMoney(fees))
  if (Math.abs(sum - Number(group.total)) > 0.009) lines.push('ATENÇÃO: divergência de totais; solicite conferência.')
  const notes = suborders[0].order.notes
  if (notes) lines.push('Observações: ' + notes)
  lines.push('', 'Solicitação comercial. Não substitui nota fiscal ou comprovante de pagamento.')
  return lines.join('\n')
}
