import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { siteUrl } from '../lib/site'
import { useAuth } from '../hooks/useAuth'

type SocialProvider = 'google' | 'facebook'

function VisibilityIcon({ visible }: { visible: boolean }) {
  return visible
    ? <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c5.5 0 9.6 5.1 10 7-.3.9-1.3 2.5-2.8 3.9M6.3 6.3C3.8 7.9 2.3 10.6 2 12c.4 1.9 4.5 7 10 7 1.6 0 3.1-.4 4.3-1"/></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { user, loading, canManageStores } = useAuth()
  const requested = params.get('returnTo')
  const safeReturn = requested && requested.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\') ? requested : null

  useEffect(() => {
    if (user && !loading) navigate(safeReturn || (canManageStores ? '/admin' : '/'), { replace: true })
  }, [user, loading, canManageStores, safeReturn, navigate])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !hasSupabaseConfig) { setMessage('Autenticação não configurada.'); return }
    setMessage('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) { setBusy(false); setMessage('E-mail ou senha inválidos. Confira sua conta ou recupere a senha.'); return }
    // O AuthProvider carregará o papel administrativo antes de redirecionar.
  }

  const signInSocial = async (provider: SocialProvider) => {
    if (!supabase || !hasSupabaseConfig) { setMessage('Autenticação não configurada.'); return }
    setMessage('')
    setBusy(true)
    const destination = `${siteUrl()}/login${safeReturn ? `?returnTo=${encodeURIComponent(safeReturn)}` : ''}`
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: destination } })
    if (error) {
      setBusy(false)
      setMessage(`Não foi possível iniciar o acesso com ${provider === 'google' ? 'Google' : 'Facebook'}. O provedor precisa estar habilitado no Supabase. ${error.message}`)
    }
  }

  return <div className="auth-page">
    <section className="auth-card">
      <div className="auth-brand"><span className="brand-mark">CM</span><div><h1>Entrar</h1><p>Acesse sua conta para enviar pedidos ou administrar a loja.</p></div></div>
      <form onSubmit={submit}>
        <label className="form-field"><span>E-mail</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" inputMode="email" required /></label>
        <label className="form-field"><span>Senha</span><span className="password-entry"><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /><button type="button" className="password-toggle" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}><VisibilityIcon visible={showPassword} /></button></span></label>
        {message && <div className="status error" role="alert">{message}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar com e-mail'}</button>
      </form>
      <div className="social-divider"><span>ou entre com</span></div>
      <div className="social-providers">
        <button type="button" className="social-provider" onClick={() => void signInSocial('google')} disabled={busy}><span className="social-provider-symbol google-symbol" aria-hidden="true">G</span> Google</button>
        <button type="button" className="social-provider" onClick={() => void signInSocial('facebook')} disabled={busy}><span className="social-provider-symbol facebook-symbol" aria-hidden="true">f</span> Facebook</button>
      </div>
      <p className="social-note">A entrada com redes sociais exige habilitação do provedor na administração do Supabase. Instagram não oferece integração nativa de login nesta configuração.</p>
      <div className="auth-links"><Link to="/cadastro">Criar conta</Link><Link to="/recuperar-senha">Esqueci minha senha</Link></div>
    </section>
  </div>
}
