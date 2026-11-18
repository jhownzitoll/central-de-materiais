import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CartLine } from '../types'

const STORAGE_KEY = 'central-materiais-cart:v3'

type CartContextValue = { lines: CartLine[]; quantityOf: (sku: string) => number; setQuantity: (sku: string, qty: number) => void; clear: () => void; totalUnits: number }
const CartContext = createContext<CartContextValue | null>(null)

function readCart(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((x) => x && typeof x.sku === 'string' && Number.isSafeInteger(Number(x.qty)) && Number(x.qty) > 0).map((x) => ({ sku: x.sku, qty: Math.min(999, Number(x.qty)) }))
  } catch { return [] }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(readCart)
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lines)) } catch {} }, [lines])
  const value = useMemo<CartContextValue>(() => ({
    lines,
    quantityOf: (sku) => lines.find((x) => x.sku === sku)?.qty ?? 0,
    setQuantity: (sku, qty) => {
      const safe = Math.max(0, Math.min(999, Math.trunc(qty)))
      setLines((current) => safe === 0 ? current.filter((x) => x.sku !== sku) : current.some((x) => x.sku === sku) ? current.map((x) => x.sku === sku ? { ...x, qty: safe } : x) : [...current, { sku, qty: safe }])
    },
    clear: () => setLines([]),
    totalUnits: lines.reduce((sum, x) => sum + x.qty, 0),
  }), [lines])
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const value = useContext(CartContext)
  if (!value) throw new Error('useCart deve ser usado dentro de CartProvider')
  return value
}
