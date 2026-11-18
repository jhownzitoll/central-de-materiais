import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { hasSupabaseConfig, supabase } from '../lib/supabase'
import { siteUrl } from '../lib/site'

const PENDING_EMAIL_KEY = 'central-materiais:pending-email'

function savedEmail() {
  try { return sessionStorage.getItem(PENDING_EMAIL_KEY) || '' } catch { return '' }
}

export function ConfirmEmailPage() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const initialEmail = (location.state as { email?: string } | null)?.email
  const [email, setEmail] = useState(initialEmail || savedEmail())
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [seconds, setSeconds] = useState(60)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (seconds <= 0) return
    const id = window.setTimeout(() => setSeconds(s => Math.max(0, s - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [seconds])

  const verify = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !hasSupabaseConfig) { setMessage('Autenticação indisponível no momento.'); return }
    const normalized = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalized)) { setMessage('Informe um e-mail válido.'); return }
    if (!/^\d{6}$/.test(code)) { setMessage('Digite os seis números recebidos no e-mail.'); return }
    setBusy(true)
    setMessage('')
    const { error } = await supabase.auth.verifyOtp({ email: normalized, token: code, type: 'email' })
    setBusy(false)
    if (error) { setMessage('Código inválido ou expirado. Confira o e-mail ou solicite um novo código.'); return }
    try { sessionStorage.removeItem(PENDING_EMAIL_KEY) } catch {}
    setSuccess(true)
    navigate('/conta', { replace: true })
  }

  const resend = async () => {
    if (!supabase || !hasSupabaseConfig || resending || seconds > 0) return
    const normalized = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalized)) { setMessage('Informe um e-mail válido.'); return }
    setResending(true)
    setMessage('')
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: normalized,
      options: { emailRedirectTo: `${siteUrl()}/confirmar-email` },
    })
    setResending(false)
    if (error) { setMessage('Não foi possível reenviar agora. Aguarde e tente novamente.'); return }
    try { sessionStorage.setItem(PENDING_EMAIL_KEY, normalized) } catch {}
    setSeconds(60)
    setCode('')
    setMessage('Se o cadastro estiver pendente, um novo código será enviado ao e-mail informado.')
  }

  if (loading) return <div className="page-state">Verificando cadastro…</div>
  if (user || success) {
    return <div className="auth-page"><section className="auth-card center">
      <div className="success-icon">✓</div>
      <h1>E-mail confirmado</h1>
      <p>Seu e-mail foi confirmado. Você já pode acessar sua conta.</p>
      <Link className="primary button-link" to="/conta">Ir para minha conta</Link>
    </section></div>
  }

  return <div className="auth-page">
    <section className="auth-card center">
      <div className="success-icon" aria-hidden="true">✉</div>
      <h1>Confirme seu e-mail</h1>
      <p>Enviamos um código de seis dígitos para seu e-mail. Digite-o abaixo para concluir o cadastro.</p>
      <form onSubmit={verify} className="verification-form">
        <label className="form-field">
          <span>E-mail do cadastro</span>
          <input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required />
        </label>
        <label className="form-field">
          <span>Código de confirmação</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            aria-label="Código de seis dígitos"
            className="verification-code"
            required
          />
        </label>
        {message && <div role="status" className={message.startsWith('Se o cadastro') ? 'status' : 'status error'}>{message}</div>}
        <button type="submit" className="primary" disabled={busy || code.length !== 6}>
          {busy ? 'Verificando…' : 'Confirmar código'}
        </button>
      </form>
      <button type="button" className="link-button verification-resend" disabled={resending || seconds > 0} onClick={() => void resend()}>
        {resending ? 'Enviando…' : seconds > 0 ? `Reenviar código em ${seconds}s` : 'Reenviar código'}
      </button>
      <div className="auth-links">
        <Link to="/cadastro">Corrigir meus dados</Link>
        <Link to="/login">Já tenho conta</Link>
      </div>
    </section>
  </div>
}
