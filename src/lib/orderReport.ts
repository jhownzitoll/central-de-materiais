import type { Order, OrderItem } from '../types'
import { formatMoney } from './money'

function clean(value: unknown, fallback = '-') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function buildOrderReport(order: Order, items: OrderItem[]): string {
  if (!items.length) throw new Error('REPORT_ITEMS_REQUIRED')

  const customer = order.customer_snapshot || {}
  const seller = order.store_snapshot || {}
  const isCompany = customer.person_type === 'CNPJ'
  const buyerName = clean(isCompany ? customer.trade_name : customer.full_name, 'Cliente')
  const method = clean(customer.delivery_method || order.delivery_method, 'DELIVERY')
  const addressRaw = customer.delivery_address
  const address = addressRaw && typeof addressRaw === 'object' && !Array.isArray(addressRaw)
    ? addressRaw as Record<string, unknown> : null

  const date = new Date(order.created_at)
  const formattedDate = Number.isNaN(date.getTime()) ? order.created_at : new Intl.DateTimeFormat('pt-BR', {
    timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short',
  }).format(date)

  const lines = [
    'CENTRAL DE MATERIAIS — RELATÓRIO DE PEDIDO',
    `Pedido: ${order.public_number}`,
    `Data: ${formattedDate}`,
    `Status: ${order.status}`,
    '',
    'LOJA / FORNECEDOR',
    `Loja: ${clean(seller.store_name)}`,
    `Atendente: ${clean(seller.seller_name)}`,
    '',
    'COMPRADOR',
    `${isCompany ? 'Nome fantasia' : 'Nome'}: ${buyerName}`,
  ]
  if (isCompany) {
    lines.push(`Razão social: ${clean(customer.legal_name)}`)
    lines.push(`Responsável pela compra: ${clean(customer.responsible_name || customer.full_name)}`)
  }
  lines.push(`${isCompany ? 'CNPJ' : 'CPF'}: ${clean(customer.document)}`)
  lines.push(`WhatsApp: ${clean(customer.phone)}`)
  lines.push(`E-mail: ${clean(customer.email)}`)
  lines.push('', 'RECEBIMENTO')
  if (method === 'PICKUP') {
    lines.push('Modalidade: Retirada na loja')
  } else {
    lines.push('Modalidade: Entrega')
    if (address) {
      const line = [address.street,address.number].filter(Boolean).map(v=>String(v)).join(', ')
      const complement = address.complement ? ` — ${String(address.complement)}` : ''
      lines.push(`Endereço: ${line || '-'}${complement}`)
      lines.push(`Bairro: ${clean(address.district)}`)
      lines.push(`Cidade / UF: ${clean(address.city)} / ${clean(address.state)}`)
      lines.push(`CEP: ${clean(address.postal_code)}`)
      if (address.reference) lines.push(`Referência: ${String(address.reference)}`)
    } else {
      lines.push('Endereço: não registrado (pedido anterior à atualização do cadastro)')
    }
  }
  lines.push('', 'ITENS DO PEDIDO')
  items.forEach((item,index) => {
    const code = item.store_product_code_snapshot ? ` | Cód. loja: ${item.store_product_code_snapshot}` : ''
    lines.push(`${index+1}. ${item.product_name_snapshot} | SKU: ${item.sku_snapshot}${code}`)
    lines.push(`    ${item.quantity} × ${formatMoney(item.unit_price_snapshot)} = ${formatMoney(item.subtotal)}`)
  })
  lines.push('',`SUBTOTAL: ${formatMoney(order.subtotal)}`,`TOTAL DO PEDIDO: ${formatMoney(order.total)}`)
  if (order.notes?.trim()) lines.push('',`Observações do comprador: ${order.notes.trim()}`)
  lines.push('', 'Documento de pedido para conferência. Não substitui nota fiscal nem comprovante de pagamento.')
  return lines.join('\n')
}
