import type { Order, OrderItem } from '../types'
import { formatMoney } from './money'
export type RoutingState='AGUARDANDO_CONFERENCIA'|'APROVADO'|'ENCAMINHAMENTO_INICIADO'|'ENCAMINHADO'|'REJEITADO'
const labels:Record<RoutingState,string>={
  AGUARDANDO_CONFERENCIA:'Aguardando conferência',APROVADO:'Aprovado · encaminhar',
  ENCAMINHAMENTO_INICIADO:'Envio iniciado · confirmar',ENCAMINHADO:'Encaminhado',REJEITADO:'Rejeitado'
}
export const routingLabel=(state?:RoutingState):string=>state?labels[state]:'Pedido histórico'
const text=(value:unknown):string=>typeof value==='string'&&value.trim()?value.trim():'—'
export function buildSupplierReport(order:Order,items:OrderItem[]):string {
  if(!items.length)throw new Error('IBUILD_ITEMS_REQUIRED')
  const c=order.customer_snapshot||{},s=order.store_snapshot||{}
  const a=c.delivery_address&&typeof c.delivery_address==='object'&&!Array.isArray(c.delivery_address)?c.delivery_address as Record<string,unknown>:null
  const lines=['iBUILD MATERIAIS — SOLICITAÇÃO AO FORNECEDOR',
    'Pedido: '+order.public_number,'Loja: '+text(s.store_name),
    'Comprador: '+text(c.trade_name||c.full_name),'Responsável: '+text(c.responsible_name||c.full_name),
    'Contato: '+text(c.phone),'Recebimento: '+(order.delivery_method==='PICKUP'?'Retirada':'Entrega')]
  if(a)lines.push('Endereço: '+text(a.street)+', '+text(a.number),'Bairro: '+text(a.district),'Cidade/UF: '+text(a.city)+'/'+text(a.state),'CEP: '+text(a.postal_code))
  lines.push('','MATERIAIS')
  items.forEach((i,k)=>{
    const base=Number(i.base_unit_price_snapshot??i.unit_price_snapshot)
    lines.push((k+1)+'. '+i.product_name_snapshot+' · '+text(i.store_product_code_snapshot||i.sku_snapshot),
      '   '+i.quantity+' × '+formatMoney(base)+' = '+formatMoney(base*i.quantity))
  })
  lines.push('','TOTAL DE REFERÊNCIA PARA A LOJA: '+formatMoney(items.reduce((n,i)=>n+Number(i.base_unit_price_snapshot??i.unit_price_snapshot)*i.quantity,0)))
  if(order.notes)lines.push('Observações: '+order.notes)
  lines.push('','Pedido intermediado pela iBuild Materiais. Valores sujeitos à confirmação comercial. Não comprova pagamento.')
  return lines.join('\n')
}
