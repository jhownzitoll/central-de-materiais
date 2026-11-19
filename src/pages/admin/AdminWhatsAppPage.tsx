import { useEffect, useState, type FormEvent } from 'react'
import { AdminNav } from '../../components/admin/AdminNav'
import { supabase } from '../../lib/supabase'

type Configuration={id:number;admin_phone:string|null;enabled:boolean;environment:'TESTE'|'PRODUCAO';template_name:string;template_language:string}
type Notice={id:string;order_id:string;state:string;attempts:number;last_error:string|null;created_at:string}
export function AdminWhatsAppPage(){
 const [config,setConfig]=useState<Configuration|null>(null),[rows,setRows]=useState<Notice[]>([])
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const load=async()=>{
  if(!supabase)return
  const [c,n]=await Promise.all([
   supabase.from('ibuild_notification_config').select('*').eq('id',1).single(),
   supabase.from('ibuild_notification_outbox').select('id,order_id,state,attempts,last_error,created_at').order('created_at',{ascending:false}).limit(100)
  ])
  if(c.error||n.error){setError('Configuração indisponível: verifique a migração do banco.');return}
  setConfig(c.data as Configuration);setRows((n.data||[]) as Notice[])
 }
 useEffect(()=>{void load()},[])
 const save=async(e:FormEvent)=>{
  e.preventDefault()
  if(!config||!supabase||busy)return
  const phone=String(config.admin_phone||'').replace(/\D/g,'')
  if(phone&&!/^[1-9][0-9]{9,14}$/.test(phone)){setError('Informe telefone com código do país e DDD.');return}
  if(config.enabled&&!phone){setError('Confirme o telefone destinatário antes de habilitar.');return}
  setBusy(true);setError('');setMessage('')
  const {error:err}=await supabase.from('ibuild_notification_config').update({
   admin_phone:phone||null,enabled:config.enabled,environment:config.environment,
   template_name:config.template_name.trim(),template_language:config.template_language.trim(),updated_at:new Date().toISOString()
  }).eq('id',1)
  if(err)setError(err.message)
  else {setMessage('Preferências salvas. O envio real depende de credenciais da Meta e template aprovado.');await load()}
  setBusy(false)
 }
 const dispatch=async()=>{
  if(!supabase||busy)return
  setBusy(true);setError('');setMessage('')
  const {data,error:err}=await supabase.functions.invoke('ibuild-whatsapp-dispatch',{body:{}})
  if(err)setError('Não foi possível consultar o serviço de envio: '+err.message)
  else setMessage(data?.configured===false?'Credenciais da Meta ainda não configuradas. Pedidos preservados na fila.':'Processamento concluído. Consulte o histórico abaixo.')
  await load();setBusy(false)
 }
 const retry=async(id:string)=>{
  if(!supabase||busy)return
  if(!window.confirm('Confirmar reenvio? Se o envio anterior ficou incerto, pode resultar em mensagem duplicada.'))return
  setBusy(true);setError('');setMessage('')
  const {error:err}=await supabase.rpc('ibuild_retry_notification',{p_notification_id:id})
  if(err)setError(err.message);else setMessage('Notificação devolvida à fila. Use “Processar fila” para tentar agora.')
  await load();setBusy(false)
 }
 return <div className="container admin-page">
  <div className="page-heading"><div><span className="eyebrow">iBuild · Integrações</span><h1>WhatsApp da central</h1><p>Você recebe primeiro. As lojas só recebem solicitações após sua aprovação.</p></div></div>
  <AdminNav/>
  {message&&<div className="status" role="status">{message}</div>}
  {error&&<div className="status error" role="alert">{error}</div>}
  <section className="section-card narrow-card">
   <h2>Notificações para o proprietário</h2>
   <p>Seu WhatsApp pessoal é o destinatário. Um número empresarial da Meta fará os envios pela Cloud API.</p>
   {config?<form onSubmit={save}>
    <label className="form-field"><span>Número destinatário (país + DDD + número)</span><input inputMode="tel" value={config.admin_phone||''} placeholder="55DDDNUMERO" onChange={e=>setConfig({...config,admin_phone:e.target.value})}/></label>
    <div className="form-grid">
     <label className="form-field"><span>Ambiente</span><select value={config.environment} onChange={e=>setConfig({...config,environment:e.target.value as 'TESTE'|'PRODUCAO'})}><option value="TESTE">Teste</option><option value="PRODUCAO">Produção</option></select></label>
     <label className="form-field"><span>Idioma do template</span><input value={config.template_language} onChange={e=>setConfig({...config,template_language:e.target.value})}/></label>
    </div>
    <label className="form-field"><span>Nome do modelo aprovado pela Meta</span><input value={config.template_name} onChange={e=>setConfig({...config,template_name:e.target.value})}/></label>
    <label className="checkbox"><input type="checkbox" checked={config.enabled} onChange={e=>setConfig({...config,enabled:e.target.checked})}/>Habilitar avisos para meu número autorizado</label>
    <button disabled={busy} className="primary" type="submit">Salvar preferências</button>
   </form>:<div className="page-state">Carregando preferências…</div>}
   <p className="small-note">Os segredos da Meta devem permanecer exclusivamente no Supabase (IBUILD_META_ACCESS_TOKEN, IBUILD_META_PHONE_NUMBER_ID, IBUILD_META_GRAPH_VERSION, IBUILD_META_APP_SECRET e IBUILD_META_VERIFY_TOKEN). Configurar o destinatário não significa que o envio já está ativo.</p>
  </section>
  <section className="section-card">
   <div className="section-head"><h2>Fila de notificações</h2><button className="secondary" disabled={busy} onClick={()=>void dispatch()}>Processar fila</button></div>
   <div className="table-wrap"><table><thead><tr><th>Recebido</th><th>Situação</th><th>Tentativas</th><th></th></tr></thead><tbody>{rows.map(n=><tr key={n.id}>
    <td>{new Date(n.created_at).toLocaleString('pt-BR')}<small style={{display:'block',color:'#70807a'}}>{n.order_id.slice(0,8)}</small></td>
    <td>{n.state.replaceAll('_',' ')}{n.last_error&&<small style={{display:'block'}}>{n.last_error}</small>}</td>
    <td>{n.attempts}</td>
    <td>{['FALHA_TEMPORARIA','FALHA_PERMANENTE','RESULTADO_INCERTO','AGUARDANDO_CONFIGURACAO'].includes(n.state)&&<button className="secondary" disabled={busy} onClick={()=>void retry(n.id)}>Reprocessar</button>}</td>
   </tr>)}</tbody></table></div>
   {rows.length===0&&<p>Sem notificações registradas no momento.</p>}
  </section>
 </div>
}
