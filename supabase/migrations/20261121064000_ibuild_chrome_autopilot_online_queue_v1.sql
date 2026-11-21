-- Accept proof of Chrome Playwriter telemetry independently of the legacy Nexus Runner heartbeat.
-- The old Nexus DEVICE_OFFLINE issue must remain true; only browser-capable P0 tests are released.
create or replace function ibuild_agent.work_queue_tick()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_online boolean;v_chrome_online boolean;v_expired integer;v_count integer;v_p0_done boolean;
begin
 perform pg_advisory_xact_lock(47910213578::bigint);
 select d.status='ACTIVE' and d.last_seen_at>now()-interval '3 minutes' into v_online
 from public.nexus_devices_v1 d where d.id='175c11dc-055c-44ec-b7ec-06495a0b17c9';
 v_online:=coalesce(v_online,false);
 -- Playwriter bridge runs independently of legacy Nexus v0.3.
 select exists (
   select 1 from (
     select observed_at,state,authenticated,composer_ready,browser_url
     from public.ibuild_chat_monitor_signals
     order by observed_at desc,id desc limit 1
   ) o
   where o.observed_at>now()-interval '90 seconds'
     and o.state in ('IDLE','BUSY')
     and o.authenticated=true and o.composer_ready=true
     and o.browser_url like 'https://chatgpt.com/%'
 ) into v_chrome_online;
 select exists(select 1 from public.ibuild_agent_checkpoints_v1 where run_id='ibuild-p0-chat-normal-20261121' and gate_state in ('PASS','VERIFIED','ACCEPTED')) into v_p0_done;

 -- An interrupted worker is never resumed or retried blindly: preserve evidence for review.
 with expired as (
   update ibuild_agent.work_queue
   set state='NEEDS_REVIEW',last_result='Lease expired: unknown side effects; inspect logs and remote state before retry',
       lease_until=null,updated_at=now()
   where state='IN_PROGRESS' and lease_until<now()-interval '2 minutes'
   returning id,attempt_count,worker_id
 ), logged as (
   insert into ibuild_agent.work_log(work_id,attempt_no,worker_id,action,result)
   select id,attempt_count,coalesce(worker_id,'unknown'),'EXPIRED','No automatic re-execution' from expired
   returning id
 ) select count(*) into v_expired from logged;

 -- Explicit P0 tasks. Existing progress is never reset by a 2-minute monitor.
 insert into ibuild_agent.work_queue(dedupe_key,task_type,title,priority,state,diagnosis,proposed_action)
 values
 ('P0:CODE_AUDIT','CODE_AUDIT','Auditar e corrigir falhas tecnicas P0',85,'READY',
  'Pedido de teste, PDF por loja e notificacao recebida ainda nao comprovados.',
  'Ler checkpoint, logs e GitHub; corrigir somente problemas reproduzidos. Testar build e publicar com evidencias.'),
 ('P0:EMAIL_TRANSPORT','EMAIL_TRANSPORT','Conectar remetente transacional autorizado',100,'WAITING_EXTERNAL',
  'Readiness da funcao indica API key e remetente ausentes; destinatario SUPER_ADMIN confirmado.',
  'Buscar alternativas seguras gratuitas com APIs autorizadas; nunca inventar chave nem usar credenciais de terceiros.'),
 ('P0:NEXUS','NEXUS_RECOVERY','Recuperar runner Nexus e sessao local',95,
  case when v_online then 'READY' else 'WAITING_NEXUS' end,
  'Runner Nexus precisa estar online e ChatGPT normal autenticado para operar o navegador.',
  'Checar heartbeat; recuperar somente por mecanismos locais realmente instalados. Nao usar Work nem afirmar reinicio remoto inexistente.'),
 ('P0:TEST_ORDER','TEST_ORDER','Comprovar pedido teste, PDF e recebimento',90,
  case when v_online or v_chrome_online then 'READY' else 'WAITING_NEXUS' end,
  'Sem nova compra de teste, PDF por loja e comprovante de mensagem recebida.',
  'Criar pedido de TESTE sem cobranca apenas apos autenticar; nunca mensagem comercial a terceiro; confirmar Gmail/Meta.')
 on conflict(dedupe_key) do nothing;

 insert into ibuild_agent.work_queue(dedupe_key,task_type,title,priority,state,diagnosis,proposed_action)
 select 'INCIDENT:'||i.component||':'||i.code,'INCIDENT_REVIEW',
        left('Investigar '||i.component||' / '||i.code,240),
        case i.severity when 'CRITICAL' then 80 when 'WARN' then 60 else 30 end,
        case when i.code in ('WABA_BLOCKED','WABA_REVIEW_REJECTED','BUSINESS_VERIFICATION_PENDING','META_DISPATCH_DISABLED')
             then 'WAITING_EXTERNAL'
             when i.code='DEVICE_OFFLINE' then 'WAITING_NEXUS' else 'READY' end,
        left(i.message,3000),left(coalesce(i.proposed_fix,''),3000)
 from ibuild_agent.supervisor_issues i where i.state='OPEN'
 on conflict(dedupe_key) do update set
   diagnosis=excluded.diagnosis,proposed_action=excluded.proposed_action,
   updated_at=case when ibuild_agent.work_queue.diagnosis is distinct from excluded.diagnosis then now()
                   else ibuild_agent.work_queue.updated_at end;

 -- The legacy runner remains OFFLINE; new Chrome connector must not fake its heartbeat.
 update ibuild_agent.work_queue set
  state=case when v_online then 'READY' else 'WAITING_NEXUS' end,
  updated_at=now()
 where dedupe_key in ('P0:NEXUS','INCIDENT:NEXUS:DEVICE_OFFLINE')
   and state in ('READY','WAITING_NEXUS')
   and ((v_online and state='WAITING_NEXUS') or (not v_online and state='READY'));
 -- Browser-capable tasks can proceed using the independently authenticated Chrome.
 update ibuild_agent.work_queue set
  state=case when v_online or v_chrome_online then 'READY' else 'WAITING_NEXUS' end,
  updated_at=now()
 where dedupe_key='P0:TEST_ORDER'
   and state in ('READY','WAITING_NEXUS')
   and (((v_online or v_chrome_online) and state='WAITING_NEXUS')
     or (not (v_online or v_chrome_online) and state='READY'));
 -- Release the installation milestone on actual telemetry, not a Windows installer message.
 if v_chrome_online then
   update ibuild_agent.work_queue set
      state='DONE',last_result='Chrome Playwriter connected: fresh authenticated browser telemetry verified in Supabase',
      evidence=evidence||jsonb_build_object('chrome_telemetry_confirmed',true,'confirmed_at',now()),
      updated_at=now()
    where dedupe_key='P0:AUTOPILOT_LOCAL_INSTALL' and state in ('WAITING_HUMAN','WAITING_NEXUS','READY');
 end if;
 if v_p0_done then
   update ibuild_agent.work_queue set state='DONE',last_result='P0 checkpoint explicitly verified',updated_at=now()
   where dedupe_key like 'P0:%' and state in ('READY','WAITING_EXTERNAL','WAITING_NEXUS','WAITING_HUMAN');
 end if;
 select count(*) into v_count from ibuild_agent.work_queue where state='READY' and next_review_at<=now() and attempt_count<max_attempts;
 return jsonb_build_object('tick','OK','nexus_online',v_online,'chrome_browser_online',v_chrome_online,'ready',v_count,'expired_leases_for_review',v_expired,'p0_verified',v_p0_done);
end;$$;
revoke all on function ibuild_agent.work_queue_tick() from public,anon,authenticated;
