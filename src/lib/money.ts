export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export function formatMoney(value: number) { return brl.format(Number(value) || 0) }
