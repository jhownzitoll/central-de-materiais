import { useEffect, useMemo, useState } from 'react'
import { AdminNav } from '../../components/admin/AdminNav'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/money'
import { useAuth } from '../../hooks/useAuth'
import type { Category, Product, Store } from '../../types'

type Editable = Partial<Product> & { offer_id?: string, store_id?: string }
const blank: Editable = { sku:'', name:'', unit:'un', price:0, description:'', brand:'', display_order:999, image_key:'', image_url:'', category_id:null, status:'ACTIVE', offer_active:true, store_product_code:'' }

export function AdminProductsPage() {
  const { isSuperAdmin, managedStoreIds } = useAuth()
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Editable | null>(null)
  const [message, setMessage] = useState('')

  const loadStores = async () => {
    if (!supabase) return
    let q = supabase.from('stores').select('*').order('display_order')
    if (!isSuperAdmin && managedStoreIds.length) q = q.in('id', managedStoreIds)
    const { data } = await q
    const list = (data || []) as Store[]
    setStores(list)
    if (!storeId && list[0]) setStoreId(list[0].id)
  }

  const load = async () => {
    if (!supabase || !storeId) return
    const [p,c,o] = await Promise.all([
      supabase.from('products').select('*, categories(name)').order('display_order'),
      supabase.from('categories').select('*').order('display_order'),
      supabase.from('store_offers').select('*').eq('store_id',storeId),
    ])
    const offers = new Map((o.data || []).map((x:any) => [x.product_id,x]))
    setProducts((p.data || []).flatMap((x:any) => {
      const offer:any = offers.get(x.id)
      if (!offer) return []
      return [{...x, category_name:x.categories?.name || '', offer_id:offer.id, store_id:offer.store_id, store_product_code:offer.store_product_code, price:Number(offer.price), promotional_price:offer.promotional_price == null ? null : Number(offer.promotional_price), offer_active:offer.active, availability_note:offer.availability_note} as Product]
    }))
    setCategories((c.data || []) as Category[])
  }

  useEffect(() => { void loadStores() }, [isSuperAdmin, managedStoreIds.join(',')])
  useEffect(() => { void load() }, [storeId])

  const filtered = useMemo(() => products.filter((p) => !query || [p.sku,p.store_product_code,p.name,p.category_name].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase())), [products,query])

  const save = async (e:React.FormEvent) => {
    e.preventDefault(); setMessage('')
    if (!supabase || !selected || !storeId) return
    const sku=String(selected.sku||'').trim().toUpperCase(), name=String(selected.name||'').trim(), unit=String(selected.unit||'').trim(), price=Number(selected.price)
    if (!sku || !name || !unit || !Number.isFinite(price) || price < 0) { setMessage('Preencha SKU, produto, unidade e preço.'); return }

    let productId=selected.id
    if (productId) {
      if (isSuperAdmin || selected.owner_store_id===storeId) {
        const { error } = await supabase.from('products').update({name,unit,category_id:selected.category_id||null,brand:selected.brand||null,description:selected.description||null,image_key:selected.image_key||sku,image_url:selected.image_url||null,display_order:Number(selected.display_order)||999,status:selected.status||'ACTIVE'}).eq('id',productId)
        if (error) { setMessage(error.message); return }
      }
    } else {
      const { data,error } = await supabase.from('products').insert({sku,name,unit,category_id:selected.category_id||null,brand:selected.brand||null,description:selected.description||null,image_key:selected.image_key||sku,image_url:selected.image_url||null,display_order:Number(selected.display_order)||999,status:'ACTIVE',owner_store_id:storeId}).select('id').single()
      if (error) { setMessage(error.message); return }
      productId=data.id
    }

    const { error: offerError } = await supabase.from('store_offers').upsert({store_id:storeId,product_id:productId,store_product_code:selected.store_product_code||sku,price,active:selected.offer_active!==false,availability_note:selected.availability_note||null},{onConflict:'store_id,product_id'})
    if (offerError) { setMessage(offerError.message); return }
    setMessage('Produto e preço da loja salvos.'); setSelected(null); await load()
  }

  const currentStore=stores.find(s=>s.id===storeId)
  return <div className="container admin-page">
    <div className="page-heading"><div><span className="eyebrow">Administração</span><h1>Produtos e preços</h1><p>Os produtos são globais; o preço e o código são específicos de cada loja.</p></div><button className="primary fit" disabled={!storeId} onClick={()=>setSelected({...blank,store_id:storeId,owner_store_id:storeId})}>+ Novo produto</button></div>
    <AdminNav />
    <section className="section-card"><div className="admin-toolbar">
      <select value={storeId} onChange={(e)=>setStoreId(e.target.value)}>{stores.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select>
      <input className="admin-search" placeholder="Buscar SKU, código ou nome..." value={query} onChange={(e)=>setQuery(e.target.value)} />
    </div>
    <p className="small-note">Editando tabela de preços: <strong>{currentStore?.name || '—'}</strong></p>
    <div className="product-admin-list">{filtered.map(p=><div className="admin-product-row" key={p.id}><div className="admin-thumb">{p.image_key||p.sku}</div><div><strong>{p.name}</strong><small>{p.sku}{p.store_product_code?` · Cód. loja ${p.store_product_code}`:''} · {p.category_name}</small></div><div className="admin-price"><strong>{formatMoney(p.promotional_price ?? p.price)}</strong><small>{p.offer_active?'Ativo':'Inativo'}</small></div><button className="secondary" onClick={()=>setSelected({...p})}>Editar</button></div>)}</div></section>

    {selected && <div className="modal-shell"><button className="overlay open" onClick={()=>setSelected(null)} /><section className="edit-panel"><div className="drawer-head"><h2>{selected.id?`Editar ${selected.sku}`:'Novo produto'}</h2><button className="close" onClick={()=>setSelected(null)}>×</button></div><form className="edit-form" onSubmit={save}>
      <div className="form-grid"><label className="form-field"><span>SKU global</span><input value={selected.sku||''} onChange={e=>setSelected({...selected,sku:e.target.value})} disabled={Boolean(selected.id)} required /></label><label className="form-field"><span>Código no sistema da loja</span><input value={selected.store_product_code||''} onChange={e=>setSelected({...selected,store_product_code:e.target.value})} /></label></div>
      <label className="form-field"><span>Produto</span><input value={selected.name||''} onChange={e=>setSelected({...selected,name:e.target.value})} required /></label>
      <div className="form-grid"><label className="form-field"><span>Categoria</span><select value={selected.category_id||''} onChange={e=>setSelected({...selected,category_id:e.target.value||null})}><option value="">Sem categoria</option>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label className="form-field"><span>Unidade</span><input value={selected.unit||''} onChange={e=>setSelected({...selected,unit:e.target.value})} /></label></div>
      <div className="form-grid"><label className="form-field"><span>Preço da {currentStore?.name}</span><input type="number" min="0" step="0.01" value={selected.price??0} onChange={e=>setSelected({...selected,price:Number(e.target.value)})} /></label><label className="form-field"><span>Ordem</span><input type="number" value={selected.display_order??999} onChange={e=>setSelected({...selected,display_order:Number(e.target.value)})} /></label></div>
      <label className="form-field"><span>Descrição</span><textarea value={selected.description||''} onChange={e=>setSelected({...selected,description:e.target.value})} /></label>
      <div className="form-grid"><label className="form-field"><span>Marca</span><input value={selected.brand||''} onChange={e=>setSelected({...selected,brand:e.target.value})} /></label><label className="form-field"><span>Image key</span><input value={selected.image_key||''} placeholder={selected.sku||'M001'} onChange={e=>setSelected({...selected,image_key:e.target.value})} /></label></div>
      <label className="form-field"><span>Observação de disponibilidade</span><input value={selected.availability_note||''} onChange={e=>setSelected({...selected,availability_note:e.target.value})} /></label>
      <label className="checkbox"><input type="checkbox" checked={selected.offer_active!==false} onChange={e=>setSelected({...selected,offer_active:e.target.checked})} /> Oferta ativa nesta loja</label>
      {message&&<div className="status">{message}</div>}<button className="primary">Salvar</button>
    </form></section></div>}
  </div>
}
