import type { PersonType, Profile } from '../types'
import { digits, isValidCnpj, isValidCpf } from './validation'

export interface CustomerDetails {
  person_type: PersonType
  document: string
  full_name: string
  trade_name: string
  legal_name: string
  phone: string
  delivery_postal_code: string
  delivery_street: string
  delivery_number: string
  delivery_complement: string
  delivery_district: string
  delivery_city: string
  delivery_state: string
  delivery_reference: string
}

export const emptyCustomerDetails: CustomerDetails = {
  person_type: 'CNPJ', document: '', full_name: '', trade_name: '', legal_name: '',
  phone: '', delivery_postal_code: '', delivery_street: '', delivery_number: '',
  delivery_complement: '', delivery_district: '', delivery_city: '', delivery_state: '', delivery_reference: '',
}

export function detailsFromProfile(profile: Profile | null): CustomerDetails {
  return {
    person_type: profile?.person_type || 'CNPJ',
    document: profile?.document || '',
    full_name: profile?.full_name || '',
    trade_name: profile?.trade_name || '',
    legal_name: profile?.legal_name || '',
    phone: profile?.phone || '',
    delivery_postal_code: profile?.delivery_postal_code || '',
    delivery_street: profile?.delivery_street || '',
    delivery_number: profile?.delivery_number || '',
    delivery_complement: profile?.delivery_complement || '',
    delivery_district: profile?.delivery_district || '',
    delivery_city: profile?.delivery_city || '',
    delivery_state: profile?.delivery_state || '',
    delivery_reference: profile?.delivery_reference || '',
  }
}

export function validateCustomerDetails(d: CustomerDetails, requireAddress = true): string | null {
  const doc = digits(d.document)
  if (d.person_type === 'CPF' ? !isValidCpf(doc) : !isValidCnpj(doc)) return `${d.person_type} inválido.`
  if (d.full_name.trim().length < 3) return d.person_type === 'CPF' ? 'Informe o nome completo.' : 'Informe o nome do responsável pela compra.'
  if (d.person_type === 'CNPJ' && d.trade_name.trim().length < 3) return 'Informe o nome fantasia da marcenaria.'
  if (d.person_type === 'CNPJ' && d.legal_name.trim().length < 3) return 'Informe a razão social da empresa.'
  const phone = digits(d.phone)
  if (phone.length < 10 || phone.length > 15) return 'Informe um WhatsApp com DDD válido.'
  if (requireAddress) {
    if (digits(d.delivery_postal_code).length !== 8) return 'Informe um CEP válido de 8 dígitos.'
    if (d.delivery_street.trim().length < 3) return 'Informe o nome da rua ou avenida.'
    if (!d.delivery_number.trim()) return 'Informe o número da entrega. Se não houver, utilize S/N.'
    if (d.delivery_district.trim().length < 2) return 'Informe o bairro.'
    if (d.delivery_city.trim().length < 2) return 'Informe a cidade.'
    if (!/^[A-Z]{2}$/.test(d.delivery_state.trim().toUpperCase())) return 'Selecione o estado (UF).'
  }
  return null
}

export function detailsPayload(d: CustomerDetails) {
  const clean = (v: string) => v.trim() || null
  return {
    person_type: d.person_type, document: digits(d.document),
    full_name: clean(d.full_name), trade_name: d.person_type === 'CNPJ' ? clean(d.trade_name) : null,
    legal_name: d.person_type === 'CNPJ' ? clean(d.legal_name) : null,
    phone: digits(d.phone),
    delivery_postal_code: digits(d.delivery_postal_code) || null,
    delivery_street: clean(d.delivery_street),
    delivery_number: clean(d.delivery_number),
    delivery_complement: clean(d.delivery_complement),
    delivery_district: clean(d.delivery_district),
    delivery_city: clean(d.delivery_city),
    delivery_state: clean(d.delivery_state)?.toUpperCase() || null,
    delivery_reference: clean(d.delivery_reference),
  }
}

export function hasCompleteCheckoutProfile(p: Profile | null, deliveryMethod: 'DELIVERY' | 'PICKUP'): boolean {
  if (!p || !p.person_type || !p.document || !p.phone || !p.full_name) return false
  if (p.person_type === 'CNPJ' && (!p.trade_name || !p.legal_name)) return false
  if (deliveryMethod === 'PICKUP') return true
  return Boolean(p.delivery_postal_code && p.delivery_postal_code.length === 8 &&
    p.delivery_street && p.delivery_number && p.delivery_district && p.delivery_city && p.delivery_state)
}
