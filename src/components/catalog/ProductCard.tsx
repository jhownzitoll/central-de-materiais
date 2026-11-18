import { useState } from 'react'
import type { Product } from '../../types'
import { formatMoney } from '../../lib/money'
import { productImageCandidates } from '../../lib/productImage'

function ProductPlaceholder({ category }: { category?: string }) {
  return <div className="placeholder" aria-hidden="true">
    <svg viewBox="0 0 80 80"><rect x="15" y="18" width="50" height="44" rx="8"/><path d="M22 52 34 39l8 8 8-9 10 14"/><circle cx="32" cy="31" r="4"/></svg>
    <small>{category || 'Produto'}</small>
  </div>
}

export function ProductCard({ product, quantity, onQuantity }: { product: Product, quantity: number, onQuantity: (qty: number) => void }) {
  const candidates = productImageCandidates(product)
  const [imageIndex, setImageIndex] = useState(0)
  const src = candidates[imageIndex]
  const price = product.effective_price ?? product.promotional_price ?? product.price
  return <article className="product-card">
    <div className="product-photo">
      {src ? <img src={src} alt={`Foto de ${product.name}`} loading="lazy" onError={() => setImageIndex((i) => i + 1)} /> : <ProductPlaceholder category={product.category_name} />}
      {src && imageIndex >= candidates.length && <ProductPlaceholder category={product.category_name} />}
      <span className="sku">{product.sku}</span>
    </div>
    <div className="product-body">
      <div className="category-label">{product.category_name || 'Outros'}</div>
      <h3>{product.name}</h3>
      {product.description && <p className="product-description">{product.description}</p>}
      <p className="unit">Unidade: {product.unit}</p>
      <div className="seller-label">Vendido por <strong>{product.store_name || 'Loja'}</strong></div>
      <div className="price-line">
        <div><div className="price">{formatMoney(price)}</div><div className="price-unit">por {product.unit}</div></div>
        <div className="stepper" aria-label={`Quantidade de ${product.name}`}>
          <button type="button" onClick={() => onQuantity(quantity - 1)} aria-label="Diminuir quantidade">−</button>
          <output>{quantity}</output>
          <button type="button" className="plus" onClick={() => onQuantity(quantity + 1)} aria-label="Adicionar unidade">+</button>
        </div>
      </div>
    </div>
  </article>
}
