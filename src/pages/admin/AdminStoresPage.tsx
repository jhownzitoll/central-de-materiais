import { useEffect, useState } from 'react'
import { AdminNav } from '../../components/admin/AdminNav'
import { supabase } from '../../lib/supabase'
import type { Store } from '../../types'

export function AdminStoresPage() {
  const [stores, setStores] = useState<Store[]>([])
  const [message, setMessage] = useState('')
  const load = async () => { if (!supabase) return; const { data, error } = await supabase.from('stores').select('*').order('display_order'); if (error) setMessage(error.message); else setStores((data || []) as Store[]) }
  useEffect(() => { void load() }, [])
  return <div className="container admin-page"><div className="page-heading"><div><span className="eyebrow">Super admin</span><h1>Lojas</h1><p>Controle global da plataforma. A Casa do MDF é a primeira loja cadastrada.</p></div></div><AdminNav />{message && <div className="status error">{message}</div>}<section className="section-card"><div className="product-admin-list">{stores.map((s) => <div className="admin-product-row" key={s.id}><div className="admin-thumb">{s.name.slice(0,2).toUpperCase()}</div><div><strong>{s.name}</strong><small>{s.slug} · {s.active ? 'Ativa' : 'Inativa'}</small></div><div className="admin-price"><strong>{s.featured ? 'Principal' : 'Secundária'}</strong><small>Ordem {s.display_order}</small></div><span className="secondary">Loja cadastrada</span></div>)}</div></section></div>
}
