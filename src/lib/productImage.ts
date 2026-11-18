import type { Product } from '../types'
export function productImageCandidates(product: Pick<Product, 'sku' | 'image_key' | 'image_url'>) {
  const out: string[] = []
  if (product.image_url && /^https:\/\//i.test(product.image_url)) out.push(product.image_url)
  const key = (product.image_key || product.sku).trim()
  if (key) out.push(`/images/products/${encodeURIComponent(key)}.webp`)
  if (product.sku && key !== product.sku) out.push(`/images/products/${encodeURIComponent(product.sku)}.webp`)
  return [...new Set(out)]
}
