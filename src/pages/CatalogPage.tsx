import { useEffect, useMemo, useState } from 'react'
import type { Category, Product, Store, StoreSettings } from '../types'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { CatalogHero } from '../components/catalog/CatalogHero'
import { CategoryChips } from '../components/catalog/CategoryChips'
import { ProductCard } from '../components/catalog/ProductCard'
import { CartDrawer } from '../components/cart/CartDrawer'
import { useCart } from '../hooks/useCart'
import { formatMoney } from '../lib/money'
import { priceWithPlatformFee, DEFAULT_PLATFORM_FEE_BPS } from '../lib/platformFee'

const demoStore: Store = { id: 'demo-casa-do-mdf', slug: 'casa-do-mdf', name: 'Casa do MDF', legal_name: null, cnpj: null, email: null, phone: null, description: null, logo_key: null, logo_url: null, active: true, featured: true, display_order: 1 }
const demoSettings: StoreSettings = { store_id: demoStore.id, subtitle: 'Materiais para marcenaria', seller_name: 'Vendedor principal', seller_whatsapp: '', seller_email: null, price_notice: 'Preços publicados pela Casa do MDF e sujeitos à confirmação comercial.', order_instructions: null, pickup_info: null, delivery_info: null }
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() }

export function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]); const [categories, setCategories] = useState<Category[]>([]); const [store, setStore] = useState<Store>(demoStore); const [settings, setSettings] = useState<StoreSettings>(demoSettings); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [category, setCategory] = useState('all'); const [sort, setSort] = useState('default'); const [cartOpen, setCartOpen] = useState(false); const { quantityOf, setQuantity, totalUnits, lines } = useCart()
  const loadCatalog = async () => {
    setLoading(true); setError('')
    if (!supabase || !hasSupabaseConfig) { setProducts([]); setCategories([]); setStore(demoStore); setSettings(demoSettings); setError('Conecte o site ao Supabase para carregar o catálogo oficial da Casa do MDF.'); setLoading(false); return }
    const configResult = await supabase.from('platform_config').select('*').eq('id', 1).maybeSingle()
    if (configResult.error || !configResult.data?.default_store_id) { setError('A loja principal ainda não foi configurada.'); setLoading(false); return }
    const defaultStoreId = configResult.data.default_store_id as string
    const [storesResult, settingsResult, catResult, prodResult, offerResult] = await Promise.all([
      supabase.from('stores').select('*').eq('active',true).order('display_order'),
      supabase.from('ibuild_catalog_settings').select('*').eq('store_id',defaultStoreId).maybeSingle(),
      supabase.from('categories').select('*').eq('active',true).order('display_order'),
      supabase.from('products').select('*, categories(name)').eq('status','ACTIVE').order('display_order'),
      supabase.from('store_offers').select('*').eq('active',true),
    ])
    if (storesResult.error || catResult.error || prodResult.error || offerResult.error || !storesResult.data?.length) {
      setError('Não foi possível carregar o catálogo agora. Tente novamente.'); setLoading(false); return
    }
    const stores = (storesResult.data || []) as Store[]
    const storeMap = new Map(stores.map(st => [st.id,st]))
    const productsMap = new Map((prodResult.data||[]).map((p:any)=>[p.id,p]))
    const platformFeeBps = Number(configResult.data.platform_fee_bps ?? DEFAULT_PLATFORM_FEE_BPS)
    const normalizedProducts = (offerResult.data || []).flatMap((o:any) => {
      const st = storeMap.get(o.store_id)
      const p:any = productsMap.get(o.product_id)
      if (!st || !p) return []
      const price = Number(o.price), promo = o.promotional_price == null ? null : Number(o.promotional_price)
      return [{...p, category_name:p.categories?.name || 'Outros', offer_id:o.id,
        store_id:st.id,store_name:st.name,store_slug:st.slug,
        store_product_code:o.store_product_code,custom_name:o.custom_name,
        custom_description:o.custom_description,custom_brand:o.custom_brand,
        section_label:o.section_label,price,promotional_price:promo,
        effective_price:priceWithPlatformFee(promo ?? price,platformFeeBps),
        offer_active:o.active,availability_note:o.availability_note,
        name:o.custom_name || p.name,description:o.custom_description || p.description,
        brand:o.custom_brand || p.brand} as Product]
    })
    const chosen = stores.find(st=>st.id===defaultStoreId) || stores[0]
    setProducts(normalizedProducts)
    setCategories((catResult.data || []) as Category[])
    setStore(chosen)
    if (settingsResult.data) setSettings(settingsResult.data as StoreSettings)
    setLoading(false)
  }
  useEffect(() => { void loadCatalog() }, [])
  // Upgrade old SKU-keyed carts to offer IDs when the catalog is available.
  useEffect(()=>{ if (!products.length) return; for (const line of lines) {
    if (products.some(p=>p.offer_id===line.sku)) continue
    const candidate=products.find(p=>p.sku===line.sku && p.offer_id)
    if (candidate?.offer_id) { setQuantity(candidate.offer_id,Math.min(999,line.qty+quantityOf(candidate.offer_id)));setQuantity(line.sku,0) }
  } },[products])
  const visible = useMemo(() => { const q=normalize(query.trim()); const copy=products.filter((p)=>{const matchesCategory=category==='all'||p.category_id===category; const haystack=normalize([p.sku,p.store_product_code,p.name,p.category_name,p.brand,p.description].filter(Boolean).join(' ')); return matchesCategory&&(!q||haystack.includes(q))}); const productPrice=(p:Product)=>p.effective_price??p.promotional_price??p.price; if(sort==='priceAsc')copy.sort((a,b)=>productPrice(a)-productPrice(b)); if(sort==='priceDesc')copy.sort((a,b)=>productPrice(b)-productPrice(a)); if(sort==='name')copy.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')); if(sort==='default')copy.sort((a,b)=>a.display_order-b.display_order||a.name.localeCompare(b.name,'pt-BR')); return copy },[products,category,query,sort])
  const cartTotal=lines.reduce((sum,line)=>{const product=products.find((p)=>p.offer_id===line.sku || p.sku===line.sku); return sum+(product?(product.effective_price??product.price)*line.qty:0)},0)
  return <><div className="container catalog-page">{!hasSupabaseConfig&&<div className="demo-banner">Configuração Supabase ausente neste ambiente.</div>}<CatalogHero/><div className="store-strip"><strong>{store.name}</strong><span>Catálogo de fornecedores · pedidos agrupados por loja</span></div><section className="catalog-controls" aria-label="Busca e filtros"><label className="search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Buscar MDF, dobradiças, SKU, puxadores..." /></label><select className="sort" value={sort} onChange={(e)=>setSort(e.target.value)} aria-label="Ordenar produtos"><option value="default">Ordem do catálogo</option><option value="name">Nome A–Z</option><option value="priceAsc">Menor preço</option><option value="priceDesc">Maior preço</option></select><button className="cart-trigger" onClick={()=>setCartOpen(true)}>Carrinho <span>{totalUnits}</span></button></section><div className="catalog-top"><div><h2>Catálogo</h2><p>{visible.length} produto{visible.length===1?'':'s'} encontrado{visible.length===1?'':'s'}</p></div></div><CategoryChips categories={categories} active={category} onChange={setCategory}/>{error&&<div className="status error">{error} <button className="link-button" onClick={()=>void loadCatalog()}>Tentar novamente</button></div>}{loading?<div className="products skeleton-grid">{Array.from({length:8}).map((_,i)=><div className="product-card skeleton" key={i}/>)}</div>:visible.length?<div className="products">{visible.map((product)=><ProductCard key={product.offer_id || product.sku} product={product} quantity={quantityOf(product.offer_id || product.sku)} onQuantity={(qty)=>setQuantity(product.offer_id || product.sku,qty)}/>)}</div>:<div className="empty-state large"><h3>Nenhum produto encontrado</h3><p>Tente outro termo ou categoria.</p></div>}<div className="price-notice">Preços publicados por cada fornecedor; confirmação comercial após o pedido.</div></div>{totalUnits>0&&<button className="mobile-cart" onClick={()=>setCartOpen(true)}><span>{totalUnits} item(ns)</span><strong>{formatMoney(cartTotal)}</strong></button>}<CartDrawer open={cartOpen} onClose={()=>setCartOpen(false)} products={products} store={store} settings={settings}/></>
}
