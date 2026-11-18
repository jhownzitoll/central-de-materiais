import { useEffect, useState } from 'react'
import { AdminNav } from '../../components/admin/AdminNav'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Store, StoreSettings } from '../../types'

export function AdminConfigPage() {
  const { isSuperAdmin, managedStoreIds } = useAuth()
  const [stores,setStores]=useState<Store[]>([])
  const [storeId,setStoreId]=useState('')
  const [form,setForm]=useState<StoreSettings | null>(null)
  const [message,setMessage]=useState('')

  const loadStores=async()=>{
    if(!supabase)return
    let q=supabase.from('stores').select('*').order('display_order')
    if(!isSuperAdmin&&managedStoreIds.length)q=q.in('id',managedStoreIds)
    const {data}=await q
    const list=(data||[]) as Store[];setStores(list);if(!storeId&&list[0])setStoreId(list[0].id)
  }
  const loadSettings=async()=>{
    if(!supabase||!storeId)return
    const {data}=await supabase.from('store_settings').select('*').eq('store_id',storeId).maybeSingle()
    setForm((data as StoreSettings|null)||{store_id:storeId,subtitle:'',seller_name:'Vendedor principal',seller_whatsapp:'',seller_email:null,price_notice:'Valores sujeitos à confirmação comercial.',order_instructions:null,pickup_info:null,delivery_info:null})
  }
  useEffect(()=>{void loadStores()},[isSuperAdmin,managedStoreIds.join(',')])
  useEffect(()=>{void loadSettings()},[storeId])

  const save=async(e:React.FormEvent)=>{e.preventDefault();setMessage('');if(!supabase||!form)return
    const payload={...form,seller_whatsapp:String(form.seller_whatsapp||'').replace(/\D/g,'')}
    const {error}=await supabase.from('store_settings').upsert(payload,{onConflict:'store_id'})
    setMessage(error?error.message:'Configurações da loja salvas.')
  }
  return <div className="container admin-page"><div className="page-heading"><div><span className="eyebrow">Administração</span><h1>Configurações da loja</h1><p>WhatsApp, vendedor e informações operacionais são independentes por loja.</p></div></div><AdminNav />
    <section className="section-card narrow-card"><label className="form-field"><span>Loja</span><select value={storeId} onChange={e=>setStoreId(e.target.value)}>{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {form&&<form onSubmit={save}>
      <label className="form-field"><span>Subtítulo</span><input value={form.subtitle||''} onChange={e=>setForm({...form,subtitle:e.target.value})}/></label>
      <label className="form-field"><span>Aviso de preços</span><input value={form.price_notice||''} onChange={e=>setForm({...form,price_notice:e.target.value})}/></label>
      <div className="form-grid"><label className="form-field"><span>Nome do vendedor</span><input value={form.seller_name||''} onChange={e=>setForm({...form,seller_name:e.target.value})}/></label><label className="form-field"><span>WhatsApp</span><input value={form.seller_whatsapp||''} onChange={e=>setForm({...form,seller_whatsapp:e.target.value})}/></label></div>
      <label className="form-field"><span>E-mail do vendedor</span><input type="email" value={form.seller_email||''} onChange={e=>setForm({...form,seller_email:e.target.value})}/></label>
      <label className="form-field"><span>Instruções do pedido</span><textarea value={form.order_instructions||''} onChange={e=>setForm({...form,order_instructions:e.target.value})}/></label>
      {message&&<div className="status">{message}</div>}<button className="primary">Salvar configurações</button>
    </form>}</section>
  </div>
}
