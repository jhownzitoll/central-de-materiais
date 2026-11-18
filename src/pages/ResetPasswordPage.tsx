import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { siteUrl } from '../lib/site'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const updating = params.get('mode') === 'update'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    if (!supabase || !hasSupabaseConfig) { setMessage('A recuperação não está configurada.'); return }
    setBusy(true)
    if (updating) {
      const { error } = await supabase.auth.updateUser({ password })
      setMessage(error ? 'É necessário entrar na conta ou abrir o link de recuperação antes de trocar a senha. ' + error.message : 'Senha alterada. Acesse sua conta usando a nova senha.')
      if (!error) setPassword('')
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${siteUrl()}/recuperar-senha?mode=update` })
      setMessage(error ? error.message : 'Se esse endereço estiver cadastrado, você receberá as instruções por e-mail.')
    }
    setBusy(false)
  }

  return <div className="auth-page"><section className="auth-card">
    <h1>{updating ? 'Definir nova senha' : 'Recuperar senha'}</h1>
    <p>{updating ? 'Defina uma senha forte para sua conta já autenticada.' : 'Enviaremos um link de recuperação para seu e-mail.'}</p>
    <form onSubmit={submit}>
      {updating
        ? <label className="form-field"><span>Nova senha</span><span className="password-entry"><input type={visible ? 'text' : 'password'} minLength={8} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required /><button type="button" className="password-toggle" aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? '◉' : '◉'}</button></span></label>
        : <label className="form-field"><span>E-mail</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label>}
      {message && <div className={message.startsWith('Senha alterada') ? 'status' : 'status error'} role="status">{message}</div>}
      <button className="primary" disabled={busy}>{busy ? 'Processando…' : updating ? 'Salvar nova senha' : 'Enviar instruções'}</button>
    </form>
    <div className="auth-links"><Link to="/login">Voltar ao login</Link></div>
  </section></div>
}
