import type { CustomerDetails } from '../../lib/customerDetails'
import { digits, formatCpfCnpj, formatPhone } from '../../lib/validation'

const states = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

export function CustomerDetailsFields({ value, onChange }: {
  value: CustomerDetails,
  onChange: (key: keyof CustomerDetails, next: string) => void,
}) {
  const set = (key: keyof CustomerDetails) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(key, event.target.value)
  return <>
    <div className="segmented" aria-label="Tipo de cadastro">
      <button type="button" aria-pressed={value.person_type === 'CNPJ'} className={value.person_type === 'CNPJ' ? 'active' : ''} onClick={() => {onChange('person_type','CNPJ');onChange('document','')}}>Empresa / CNPJ</button>
      <button type="button" aria-pressed={value.person_type === 'CPF'} className={value.person_type === 'CPF' ? 'active' : ''} onClick={() => {onChange('person_type','CPF');onChange('document','')}}>Pessoa física / CPF</button>
    </div>
    <h3 className="details-heading">Identificação</h3>
    <div className="details-grid">
      <label className="form-field"><span>{value.person_type}</span><input value={formatCpfCnpj(value.document)} onChange={e => onChange('document',digits(e.target.value).slice(0,value.person_type === 'CPF'?11:14))} inputMode="numeric" autoComplete="off" required/></label>
      {value.person_type === 'CNPJ' && <>
        <label className="form-field"><span>Nome fantasia da marcenaria</span><input value={value.trade_name} onChange={set('trade_name')} maxLength={120} required/></label>
        <label className="form-field"><span>Razão social</span><input value={value.legal_name} onChange={set('legal_name')} maxLength={160} required/></label>
      </>}
      <label className="form-field"><span>{value.person_type === 'CPF' ? 'Nome completo' : 'Responsável pela compra'}</span><input value={value.full_name} onChange={set('full_name')} autoComplete="name" maxLength={120} required/></label>
      <label className="form-field"><span>WhatsApp com DDD</span><input value={formatPhone(value.phone)} onChange={e=>onChange('phone',digits(e.target.value).slice(0,15))} inputMode="tel" autoComplete="tel" required/></label>
    </div>
    <h3 className="details-heading">Endereço padrão de entrega</h3>
    <p className="details-caption">Será confirmado no fechamento de cada pedido. Retirada na loja continua disponível.</p>
    <div className="details-grid">
      <label className="form-field"><span>CEP</span><input value={digits(value.delivery_postal_code).replace(/^(\d{5})(\d)/,'$1-$2')} onChange={e=>onChange('delivery_postal_code',digits(e.target.value).slice(0,8))} inputMode="numeric" autoComplete="postal-code" maxLength={9} placeholder="00000-000" required/></label>
      <label className="form-field"><span>Rua / avenida</span><input value={value.delivery_street} onChange={set('delivery_street')} autoComplete="address-line1" maxLength={160} required/></label>
      <label className="form-field"><span>Número</span><input value={value.delivery_number} onChange={set('delivery_number')} maxLength={20} placeholder="Ex.: 120 ou S/N" required/></label>
      <label className="form-field"><span>Complemento (opcional)</span><input value={value.delivery_complement} onChange={set('delivery_complement')} autoComplete="address-line2" maxLength={120} placeholder="Galpão, bloco, sala..."/></label>
      <label className="form-field"><span>Bairro</span><input value={value.delivery_district} onChange={set('delivery_district')} maxLength={120} required/></label>
      <label className="form-field"><span>Cidade</span><input value={value.delivery_city} onChange={set('delivery_city')} autoComplete="address-level2" maxLength={120} required/></label>
      <label className="form-field"><span>Estado (UF)</span><select value={value.delivery_state} onChange={set('delivery_state')} autoComplete="address-level1" required><option value="">Selecione</option>{states.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
      <label className="form-field"><span>Referência para entrega (opcional)</span><input value={value.delivery_reference} onChange={set('delivery_reference')} maxLength={180} placeholder="Próximo à..."/></label>
    </div>
  </>
}
