import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/money'
import { CustomerDetailsFields } from '../components/common/CustomerDetailsFields'
import { detailsFromProfile, detailsPayload, emptyCustomerDetails, validateCustomerDetails, type CustomerDetails } from '../lib/customerDetails'
import type { Order } from '../types'

export function AccountPage() {
  const { user, profile, refreshProfile } = useAuth()
  const [orders,setOrders] = useState<Order[]>([])
  const [loading,setLoading] = useState(true)
  const [editing,setEditing] = useState(false)
  const [saving,setSaving] = useState(false)
  const [message,setMessage] = useState('')
  const [success,setSuccess] = useState('')
  const [details,setDetails] = useState<CustomerDetails>({ ...emptyCustomerDetails })

  useEffect(()=>{ setDetails(detailsFromProfile(profile)) },[profile])
  useEffect(()=>{
    if(!supabase){setLoading(false);return}
    supabase.from('orders').select('*').order('created_at',{ascending:false})
      .then(({data})=>{setOrders((data||[]) as Order[]);setLoading(false)})
  },[])
  const change = (key: keyof CustomerDetails, value: string) => setDetails(prev=>({ ...prev,[key]:value }))

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage(''); setSuccess('')
    const validation = validateCustomerDetails(details)
    if (validation) {setMessage(validation);return}
    if (!user || !supabase) {setMessage('Faça login para salvar seus dados.');return}
    setSaving(true)
    const { error } = await supabase.from('profiles').update(detailsPayload(details)).eq('id',user.id).select('id').single()
    if (error) {setMessage(error.message);setSaving(false);return}
    try {
      await refreshProfile()
      setSuccess('Cadastro atualizado. Os próximos pedidos utilizarão esses dados.')
      setEditing(false)
    } catch {
      setMessage('Dados gravados, mas não foi possível atualizar a exibição. Recarregue a página.')
    }
    setSaving(false)
  }

  const delivery = profile?.delivery_street && profile?.delivery_postal_code
    ? `${profile.delivery_street}, ${profile.delivery_number || 'S/N'}${profile.delivery_complement ? ' — '+profile.delivery_complement : ''} · ${profile.delivery_district || ''} · ${profile.delivery_city || ''}/${profile.delivery_state || ''} · CEP ${profile.delivery_postal_code}`
    : 'Endereço ainda não informado'

  return <div className="container standard-page">
    <div className="page-heading"><div><span className="eyebrow">Minha conta</span><h1>{profile?.trade_name||profile?.full_name||'Cliente'}</h1><p>{profile?.email}</p></div></div>
    <div className="action-row" style={{marginBottom:18}}>
      <button type="button" className="secondary" onClick={()=>{setEditing(value=>!value);setMessage('');setSuccess('')}}>{editing?'Cancelar edição':'Editar cadastro e endereço'}</button>
      <Link className="secondary button-link" to="/recuperar-senha?mode=update">Definir ou alterar minha senha</Link>
    </div>
    {success && <div className="status" role="status">{success}</div>}
    {!editing && <section className="section-card">
      <h2>Dados de cadastro</h2>
      <div className="details-grid">
        <div><small>Tipo de pessoa</small><p><strong>{profile?.person_type||'Não informado'}</strong></p></div>
        <div><small>CPF / CNPJ</small><p><strong>{profile?.document||'Não informado'}</strong></p></div>
        {profile?.person_type==='CNPJ'&&<>
          <div><small>Razão social</small><p><strong>{profile.legal_name||'Não informado'}</strong></p></div>
          <div><small>Responsável</small><p><strong>{profile.full_name||'Não informado'}</strong></p></div>
        </>}
        <div><small>WhatsApp</small><p><strong>{profile?.phone||'Não informado'}</strong></p></div>
        <div><small>Endereço padrão</small><p>{delivery}</p></div>
      </div>
    </section>}
    {editing && <section className="section-card narrow-card">
      <h2>Atualizar seus dados</h2><p className="details-caption">CPF/CNPJ, empresa e endereço são usados nos próximos pedidos. Pedidos anteriores mantêm os dados originais.</p>
      <form onSubmit={save}>
        <CustomerDetailsFields value={details} onChange={change}/>
        {message && <div className="status error" role="alert">{message}</div>}
        <button className="primary" type="submit" disabled={saving}>{saving?'Salvando…':'Salvar cadastro'}</button>
      </form>
    </section>}
    <section className="section-card">
      <div className="section-head"><h2>Meus pedidos</h2></div>
      {loading?<p>Carregando…</p>:orders.length?<div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Status</th><th>Total</th><th></th></tr></thead>
      <tbody>{orders.map(order=><tr key={order.id}><td>{order.public_number}</td><td>{new Date(order.created_at).toLocaleDateString('pt-BR')}</td><td><span className="status-pill">{order.status}</span></td><td>{formatMoney(order.total)}</td><td><Link to={`/pedido/${order.id}`}>Abrir</Link></td></tr>)}</tbody></table></div>
      :<div className="empty-state"><h3>Nenhum pedido ainda</h3><p>Seu histórico aparecerá aqui.</p></div>}
    </section>
  </div>
}
