import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { siteUrl } from '../lib/site'
import { CustomerDetailsFields } from '../components/common/CustomerDetailsFields'
import { detailsPayload, emptyCustomerDetails, validateCustomerDetails, type CustomerDetails } from '../lib/customerDetails'

export function SignupPage() {
  const [details,setDetails] = useState<CustomerDetails>({ ...emptyCustomerDetails })
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [message,setMessage] = useState('')
  const [busy,setBusy] = useState(false)
  const navigate = useNavigate()
  const change = (key: keyof CustomerDetails, value: string) => setDetails(previous=>({ ...previous, [key]:value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage('')
    const invalid = validateCustomerDetails(details)
    if (invalid) { setMessage(invalid); return }
    if (password.length < 8) { setMessage('Use uma senha com pelo menos 8 caracteres.'); return }
    if (!supabase || !hasSupabaseConfig) { setMessage('O cadastro ainda não está disponível.'); return }
    const normalizedEmail = email.trim().toLowerCase()
    setBusy(true)
    const { error } = await supabase.auth.signUp({
      email: normalizedEmail, password,
      options: { emailRedirectTo: `${siteUrl()}/confirmar-email`, data: detailsPayload(details) },
    })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    try { sessionStorage.setItem('central-materiais:pending-email',normalizedEmail) } catch {}
    navigate('/confirmar-email',{ state: { email: normalizedEmail } })
  }
  return <div className="auth-page"><section className="auth-card wide">
    <div className="auth-brand"><span className="brand-mark">CM</span><div><h1>Criar conta</h1><p>Cadastre sua marcenaria ou seus dados pessoais para enviar pedidos.</p></div></div>
    <form onSubmit={submit}>
      <CustomerDetailsFields value={details} onChange={change}/>
      <h3 className="details-heading">Acesso à conta</h3>
      <label className="form-field"><span>E-mail</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required maxLength={254}/></label>
      <label className="form-field"><span>Senha</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} autoComplete="new-password" required/></label>
      <p className="privacy-note">Utilizaremos seus dados para identificação, atendimento, entrega e registro de pedidos. O endereço será confirmado antes da compra.</p>
      {message&&<div role="alert" className="status error">{message}</div>}
      <button className="primary" disabled={busy}>{busy?'Criando conta…':'Criar conta'}</button>
    </form>
    <div className="auth-links"><Link to="/login">Já tenho conta</Link></div>
  </section></div>
}
