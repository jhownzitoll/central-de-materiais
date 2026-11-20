import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminNav } from '../../components/admin/AdminNav'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/money'
import { useAuth } from '../../hooks/useAuth'
import { BRAND_INSTITUTIONAL_NAME } from '../../lib/branding'

export function AdminDashboardPage(){const{isSuperAdmin,managedStoreIds}=useAuth();const[metrics,setMetrics]=useState({products:0,stores:0,orders:0,total:0})
  useEffect(()=>{if(!supabase)return;Promise.all([
    supabase.from('products').select('id',{count:'exact',head:true}),
    supabase.from('stores').select('id',{count:'exact',head:true}),
    !isSuperAdmin?supabase.rpc('ibuild_supplier_orders_v1'):supabase.from('orders').select('id,total')
  ]).then(([p,s,o])=>setMetrics({products:p.count||0,stores:s.count||0,orders:o.data?.length||0,total:(o.data||[]).reduce((a:any,x:any)=>a+Number(x.total||0),0)}))},[isSuperAdmin,managedStoreIds.join(',')])
  return <div className="container admin-page"><div className="page-heading"><div><span className="eyebrow">Administração</span><h1>{isSuperAdmin?BRAND_INSTITUTIONAL_NAME:'Painel da loja'}</h1><p>{isSuperAdmin?'Controle global de lojas, catálogo e ofertas.':'Gerencie seus preços, produtos e pedidos.'}</p></div></div><AdminNav />
    <div className="metric-grid"><div className="metric"><small>Produtos globais</small><strong>{metrics.products}</strong></div><div className="metric"><small>Lojas</small><strong>{metrics.stores}</strong></div><div className="metric"><small>Pedidos</small><strong>{metrics.orders}</strong></div><div className="metric"><small>Valor registrado</small><strong>{formatMoney(metrics.total)}</strong></div></div>
    <section className="section-card"><h2>Operação comercial iBuild</h2><p>Receba e confira pedidos na central. Os fornecedores só podem processar solicitações depois de seu encaminhamento. {isSuperAdmin&&<Link to="/admin/pedidos"> Abrir central de pedidos →</Link>}</p></section></div>}
