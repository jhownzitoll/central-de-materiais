/** Arredondamento comercial por unidade: margem em basis points (100 bps = 1%). */
export const DEFAULT_PLATFORM_FEE_BPS = 100

function priceCents(basePrice: number): number {
  const cents = Math.round(basePrice * 100)
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('INVALID_BASE_PRICE')
  return cents
}

export function platformFeePerUnit(basePrice: number, feeBps = DEFAULT_PLATFORM_FEE_BPS): number {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) throw new Error('INVALID_PLATFORM_FEE')
  return Math.round(priceCents(basePrice) * feeBps / 10000) / 100
}

export function priceWithPlatformFee(basePrice: number, feeBps = DEFAULT_PLATFORM_FEE_BPS): number {
  // Em centavos, para obter a mesma regra ROUND(numeric, 2) do PostgreSQL.
  const cents = priceCents(basePrice)
  return (cents + Math.round(cents * feeBps / 10000)) / 100
}
