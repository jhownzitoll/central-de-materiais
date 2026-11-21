-- iBuild Nexus Supervisor v1: continuous read-only health monitoring plus safe local smoke tests.
-- No automatic WhatsApp messages, payment changes, or unbounded ChatGPT requests.
create table if not exists ibuild_agent.supervisor_state (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default true,
  safe_repair_enabled boolean not null default true,
  chat_resume_enabled boolean not null default false,
  last_tick_at timestamptz,
  last_nexus_probe_at timestamptz,
  last_nexus_probe_job uuid,
  nexus_probe_handled_at timestamptz,
  last_waba_probe_at timestamptz,
  last_waba_probe_request bigint,
  waba_probe_handled_at timestamptz,
  max_chat_prompts_per_day integer not null default 3 check (max_chat_prompts_per_day between 0 and 6),
  updated_at timestamptz not null default now()
);
insert into ibuild_agent.supervisor_state(id) values(1) on conflict do nothing;
alter table ibuild_agent.supervisor_state enable row level security;
revoke all on ibuild_agent.supervisor_state from public, anon, authenticated;

create table if not exists ibuild_agent.supervisor_issues (
 id bigint generated always as identity primary key,
 component text not null,
 code text not null,
 severity text not null default 'WARN' check(severity in ('INFO','WARN','CRITICAL')),
 state text not null default 'OPEN' check (state in ('OPEN','RESOLVED')),
 message text not null,
 proposed_fix text,
 occurrences integer not null default 1,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 resolved_at timestamptz,
 constraint unique_issue_per_component unique(component,code),
 constraint supervisor_issue_message_limit check(char_length(message)<2000)
);
create index if not exists supervisor_issues_state_idx on ibuild_agent.supervisor_issues(state,severity,last_seen_at desc);
alter table ibuild_agent.supervisor_issues enable row level security;
revoke all on ibuild_agent.supervisor_issues from public, anon, authenticated;

create table if not exists ibuild_agent.supervisor_events (
 id bigint generated always as identity primary key,
 happened_at timestamptz not null default now(),
 component text not null,
 action text not null,
 result text not null,
 details jsonb not null default '{}'::jsonb,
 constraint supervisor_event_details_limit check(octet_length(details::text)<10000)
);
create index if not exists supervisor_events_time_idx on ibuild_agent.supervisor_events(happened_at desc);
alter table ibuild_agent.supervisor_events enable row level security;
revoke all on ibuild_agent.supervisor_events from public, anon, authenticated;

create or replace function ibuild_agent.observe_issue(
 p_component text,p_code text,p_severity text,p_message text,p_proposed_fix text,p_active boolean
) returns void language plpgsql security invoker set search_path='' as $$
declare v_old_state text;
begin
 select state into v_old_state
 from ibuild_agent.supervisor_issues
 where component=p_component and code=p_code;
 if p_active then
   insert into ibuild_agent.supervisor_issues(component,code,severity,state,message,proposed_fix,first_seen_at,last_seen_at,occurrences)
   values(p_component,p_code,p_severity,'OPEN',left(p_message,1900),p_proposed_fix,now(),now(),1)
   on conflict(component,code) do update
     set severity=excluded.severity, state='OPEN',message=excluded.message,
         proposed_fix=excluded.proposed_fix,last_seen_at=now(),resolved_at=null,
         occurrences=ibuild_agent.supervisor_issues.occurrences+1;
   if v_old_state is distinct from 'OPEN' then
     insert into ibuild_agent.supervisor_events(component,action,result,details)
     values(p_component,'DETECT','OPEN',jsonb_build_object('code',p_code,'severity',p_severity));
   end if;
 elsif v_old_state='OPEN' then
   update ibuild_agent.supervisor_issues set state='RESOLVED',resolved_at=now(),last_seen_at=now()
   where component=p_component and code=p_code;
   insert into ibuild_agent.supervisor_events(component,action,result,details)
   values(p_component,'DETECT','RESOLVED',jsonb_build_object('code',p_code));
 end if;
end;
$$;
revoke all on function ibuild_agent.observe_issue(text,text,text,text,text,boolean) from public, anon, authenticated;

create or replace function ibuild_agent.nexus_supervisor_tick()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_lock boolean;
  v_state ibuild_agent.supervisor_state%rowtype;
  v_dev_id uuid := '175c11dc-055c-44ec-b7ec-06495a0b17c9'::uuid;
  v_dev_status text;
  v_last_seen timestamptz;
  v_online boolean := false;
  v_active_count integer := 0;
  v_stuck_count integer := 0;
  v_expired_count integer := 0;
  v_recent_fail_count integer := 0;
  v_needs_pulse boolean := false;
  v_last_pulse_job_status text;
  v_last_pulse_job_error text;
  v_job_id uuid;
  v_http_code integer;
  v_http_body text;
  v_body jsonb;
  v_messaging_enabled boolean;
  v_unknown_delivery_count integer;
  v_cron_active integer;
  v_waba_response_found boolean := false;
  v_error text;
  v_nonce text;
  v_waba_request bigint;
  v_idle_run_count integer;
begin
  select pg_try_advisory_xact_lock(479102135::bigint) into v_lock;
  if not v_lock then return jsonb_build_object('skipped','already_running'); end if;

  select * into v_state from ibuild_agent.supervisor_state where id=1 for update;
  if not found or not v_state.enabled then return jsonb_build_object('enabled',false); end if;
  update ibuild_agent.supervisor_state set last_tick_at=now(),updated_at=now() where id=1;

  select d.status,d.last_seen_at into v_dev_status,v_last_seen
  from public.nexus_devices_v1 d where d.id=v_dev_id;
  v_online := (v_dev_status='ACTIVE' and v_last_seen>=now()-interval '3 minutes');
  perform ibuild_agent.observe_issue('NEXUS','DEVICE_OFFLINE','CRITICAL',
    'Runner Nexus sem heartbeat recente; o banco nao pode reiniciar sozinho um processo local desligado.',
    'Reiniciar o runner local e configurar inicializacao automatica no PC.',not v_online);

  select count(*) into v_active_count from public.nexus_jobs_v1
  where device_id=v_dev_id and status in ('PENDING','RUNNING');
  select count(*) into v_stuck_count from public.nexus_jobs_v1
  where device_id=v_dev_id and status='RUNNING' and claimed_at<now()-interval '7 minutes';
  perform ibuild_agent.observe_issue('NEXUS','STUCK_RUNNING_JOB','WARN',
    'Um job Nexus permanece RUNNING por mais de 7 minutos. Resultado incerto: nao repetir.',
    'Inspecionar processo e capturas locais; jamais reenviar automaticamente clique/POST/envio.',v_stuck_count>0);

  select count(*) into v_recent_fail_count from public.nexus_jobs_v1
  where device_id=v_dev_id and status='FAILED' and finished_at>now()-interval '15 minutes'
    and action not in ('LOCAL_SMOKE_TEST');
  perform ibuild_agent.observe_issue('NEXUS','RECENT_FAILURE_BURST','WARN',
    'Falhas sucessivas no navegador Nexus; trocar localizador ou estrategia, nao insistir no mesmo clique.',
    'Checar job.error e pagina atual. Usar BROWSER_READ/INSPECT; apos 2 falhas equivalentes trocar metodo.',
    v_recent_fail_count>=3);

  -- Safely terminalize only commands that the Nexus never claimed and whose deadline has passed.
  if v_state.safe_repair_enabled then
    with expired as (
     update public.nexus_jobs_v1
       set status='FAILED',finished_at=now(),error='SUPERVISOR: expirado sem ser iniciado; nao repetido'
     where device_id=v_dev_id and status='PENDING' and claimed_at is null
       and expires_at<now()-interval '2 minutes'
     returning id
    ) select count(*) into v_expired_count from expired;
    if v_expired_count>0 then
      insert into ibuild_agent.supervisor_events(component,action,result,details)
      values('NEXUS','EXPIRE_UNCLAIMED','SUCCEEDED',jsonb_build_object('count',v_expired_count));
    end if;
  end if;

  -- Review previous local smoke test, never replay an unknown user action.
  if v_state.last_nexus_probe_job is not null and v_state.nexus_probe_handled_at is null then
    select status,left(coalesce(error,''),160) into v_last_pulse_job_status,v_last_pulse_job_error
    from public.nexus_jobs_v1 where id=v_state.last_nexus_probe_job;
    if v_last_pulse_job_status in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') then
      update ibuild_agent.supervisor_state set nexus_probe_handled_at=now() where id=1;
      perform ibuild_agent.observe_issue('NEXUS','SMOKE_TEST_FAILED','WARN',
        'Teste local do runner Nexus nao concluiu: '||coalesce(v_last_pulse_job_error,'erro desconhecido'),
        'Verificar Nexus Runner, sessao local e logs do dispositivo.',
        v_last_pulse_job_status<>'SUCCEEDED');
      insert into ibuild_agent.supervisor_events(component,action,result,details)
      values('NEXUS','LOCAL_SMOKE_TEST',v_last_pulse_job_status,jsonb_build_object('job_id',v_state.last_nexus_probe_job));
    elsif v_state.last_nexus_probe_at<now()-interval '5 minutes' then
      perform ibuild_agent.observe_issue('NEXUS','SMOKE_TEST_TIMEOUT','WARN',
        'Teste LOCAL_SMOKE_TEST nao foi concluido dentro de 5 minutos.',
        'Verificar se o runner esta ativo. Nao duplicar jobs ate resolver.',
        true);
    end if;
  end if;

  if v_online and v_active_count=0 and v_state.safe_repair_enabled
    and (v_state.last_nexus_probe_at is null or v_state.last_nexus_probe_at<now()-interval '12 minutes')
    and (v_state.last_nexus_probe_job is null or v_state.nexus_probe_handled_at is not null)
  then
    insert into public.nexus_jobs_v1(device_id,action,payload,expires_at)
    values(v_dev_id,'LOCAL_SMOKE_TEST','{}'::jsonb,now()+interval '4 minutes')
    returning id into v_job_id;
    update ibuild_agent.supervisor_state
      set last_nexus_probe_at=now(),last_nexus_probe_job=v_job_id,nexus_probe_handled_at=null where id=1;
    insert into ibuild_agent.supervisor_events(component,action,result,details)
    values('NEXUS','QUEUE_SMOKE','QUEUED',jsonb_build_object('job_id',v_job_id));
  end if;

  -- Keep outbound notifications disabled when Meta is blocked: never change this automatically.
  select enabled into v_messaging_enabled from public.ibuild_notification_config where id=1;
  perform ibuild_agent.observe_issue('IBUILD','META_DISPATCH_DISABLED','INFO',
    'Despacho WhatsApp esta desativado; o supervisor nao deve ativa-lo enquanto a Meta estiver bloqueada.',
    'Primeiro resolver a autorizacao da WABA ou implementar canal alternativo homologado.',
    coalesce(v_messaging_enabled,false)=false);

  select count(*) into v_unknown_delivery_count from public.ibuild_notification_outbox
   where state in ('RESULTADO_INCERTO','FALHA_PERMANENTE','FALHA_TEMPORARIA')
   and created_at>=now()-interval '24 hours';
  perform ibuild_agent.observe_issue('IBUILD','NOTIFICATION_REQUIRES_REVIEW','WARN',
    'Existem eventos recentes de mensagem com entrega incerta ou falha.',
    'Inspecionar outbox e logs; evitar reenvio se o resultado da API e incerto.',
    v_unknown_delivery_count>0);

  select count(*) into v_cron_active from cron.job
   where jobname in ('ibuild_dispatch_every_minute_v1','ibuild_recover_stale_inflight_v1')
   and active=true;
  perform ibuild_agent.observe_issue('IBUILD','CORE_CRON_MISSING_OR_DISABLED','CRITICAL',
    'Pelo menos um cron essencial da fila de notificacoes esta ausente ou desativado.',
    'Verificar alteracoes recentes; restaurar apenas apos confirmar que nao foi uma pausa intencional.',
    v_cron_active<>2);

  select count(*) into v_idle_run_count from ibuild_agent.runs
  where status in ('QUEUED','RUNNING','SUSPECT') and progress_at<now()-interval '25 minutes'
   and heartbeat_at<now()-interval '25 minutes';
  perform ibuild_agent.observe_issue('AGENT','NO_CHECKPOINT','WARN',
    'Agente sem checkpoint persistente por 25 minutos; isso nao comprova que a conversa terminou.',
    'Inspecionar a conversa ChatGPT antes de qualquer novo prompt; nao interromper geracao em andamento.',
    v_idle_run_count>0);

  -- Parse finished Graph API probe from previous tick.
  if v_state.last_waba_probe_request is not null and v_state.waba_probe_handled_at is null then
   select status_code,content into v_http_code,v_http_body
   from net._http_response where id=v_state.last_waba_probe_request;
   v_waba_response_found := found;
   if v_waba_response_found then
     begin v_body:=v_http_body::jsonb; exception when others then v_body:='{}'::jsonb; end;
     perform ibuild_agent.observe_issue('META','WABA_BLOCKED','CRITICAL',
       'Meta Cloud API confirma que a WABA IBuild nao esta liberada para enviar.',
       'Recuperacao oficial da WABA; nao gerar novos tokens indefinidamente.',
       v_http_code=200 and v_body->>'health_can_send'='BLOCKED');
     perform ibuild_agent.observe_issue('META','WABA_REVIEW_REJECTED','CRITICAL',
       'A revisao da WABA original retornou REJECTED.',
       'Consultar motivo/recurso no Meta Business Manager; verificacao humana quando necessaria.',
       v_http_code=200 and v_body->>'waba_review_status'='REJECTED');
     perform ibuild_agent.observe_issue('META','BUSINESS_VERIFICATION_PENDING','WARN',
       'A verificacao empresarial na Meta ainda esta pendente de submissao.',
       'Conferir autorizacoes/verificacoes e documentos oficiais; nao inventar dados legais.',
       v_http_code=200 and v_body->>'business_verification_status'='pending_submission');
     perform ibuild_agent.observe_issue('META','GRAPH_PROBE_FAILED','WARN',
       'Consulta automatizada da Meta falhou (codigo HTTP '||coalesce(v_http_code::text,'?')||').',
       'Verificar logs da Edge Function ibuild-waba-recovery-audit; nao revelar tokens.',
       v_http_code is null or v_http_code<>200);
     update ibuild_agent.supervisor_state set waba_probe_handled_at=now() where id=1;
     insert into ibuild_agent.supervisor_events(component,action,result,details)
     values('META','READONLY_GRAPH_CHECK',case when v_http_code=200 then 'OK' else 'FAILED' end,
     jsonb_build_object('http_code',v_http_code,'waba_status',coalesce(v_body->>'waba_status','unknown'),'can_send',coalesce(v_body->>'health_can_send','unknown')));
   elsif v_state.last_waba_probe_at<now()-interval '6 minutes' then
     perform ibuild_agent.observe_issue('META','GRAPH_PROBE_TIMEOUT','WARN',
       'A verificacao de saude da Meta ainda nao retornou apos 6 minutos.',
       'Consultar pg_net, Edge logs e conectividade.',true);
     update ibuild_agent.supervisor_state set waba_probe_handled_at=now() where id=1;
   end if;
  end if;

  if (v_state.last_waba_probe_at is null or v_state.last_waba_probe_at<now()-interval '15 minutes')
    and (v_state.last_waba_probe_request is null or v_state.waba_probe_handled_at is not null)
  then
   begin
     v_nonce:=floor(extract(epoch from now()))::bigint::text;
     select net.http_post(
       url:='https://pkpihrxucorfbniltdtk.supabase.co/functions/v1/ibuild-waba-recovery-audit',
       headers:=jsonb_build_object('Content-Type','application/json',
         'x-ibuild-cron-ts',v_nonce,
         'x-ibuild-cron-signature',private.ibuild_cron_sign(v_nonce)),
       body:='{}'::jsonb,
       timeout_milliseconds:=15000
     ) into v_waba_request;
     update ibuild_agent.supervisor_state
      set last_waba_probe_at=now(),last_waba_probe_request=v_waba_request,waba_probe_handled_at=null where id=1;
     insert into ibuild_agent.supervisor_events(component,action,result,details)
     values('META','QUEUE_READONLY_PROBE','QUEUED',jsonb_build_object('request_id',v_waba_request));
   exception when others then
     get stacked diagnostics v_error = message_text;
     perform ibuild_agent.observe_issue('META','GRAPH_PROBE_ENQUEUE_FAILED','WARN',
       'Falha ao agendar verificacao read-only da Meta.',
       'Verificar pg_net e cron; manter credenciais no backend.',true);
   end;
  end if;

  return jsonb_build_object('status','OK','nexus_online',v_online,
    'nexus_active_jobs_before_tick',v_active_count,
    'nexus_stuck_jobs',v_stuck_count,'expired_unclaimed_cleaned',v_expired_count,
    'recent_nexus_failures',v_recent_fail_count,
    'unknown_notification_events',v_unknown_delivery_count,
    'agent_without_checkpoint',v_idle_run_count,
    'chat_auto_resume_enabled',v_state.chat_resume_enabled);
end;
$$;
revoke all on function ibuild_agent.nexus_supervisor_tick() from public,anon,authenticated;
select cron.schedule('ibuild_nexus_supervisor_v1','*/2 * * * *',$$select ibuild_agent.nexus_supervisor_tick();$$);