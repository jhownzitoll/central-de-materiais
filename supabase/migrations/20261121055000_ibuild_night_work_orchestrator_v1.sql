-- Deterministic task orchestration for normal-ChatGPT supervision; not an LLM or a new ChatGPT session.
-- Purpose: persistent prioritized tasks, one-worker leases, audited decisions and safe non-replay.
create table if not exists ibuild_agent.work_queue (
 id uuid primary key default gen_random_uuid(),
 dedupe_key text not null unique check(length(dedupe_key) between 5 and 128),
 project text not null default 'ibuild' check(project='ibuild'),
 phase text not null default 'P0' check(phase in ('P0','PRODUCTION','CATALOG')),
 task_type text not null check(task_type in ('CODE_AUDIT','NEXUS_RECOVERY','EMAIL_TRANSPORT','TEST_ORDER','META_RECOVERY','INCIDENT_REVIEW','HANDOFF')),
 title text not null check(length(title)<=240),
 priority integer not null default 50 check(priority between 1 and 100),
 state text not null default 'READY'
   check(state in ('READY','IN_PROGRESS','WAITING_EXTERNAL','WAITING_NEXUS','WAITING_HUMAN','NEEDS_REVIEW','DONE','CANCELLED')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 30),
 max_attempts integer not null default 10 check(max_attempts between 1 and 30),
 worker_id text check(worker_id is null or length(worker_id)<=160),
 lease_until timestamptz,
 next_review_at timestamptz not null default now(),
 diagnosis text not null default '' check(length(diagnosis)<=3000),
 proposed_action text not null default '' check(length(proposed_action)<=3000),
 last_result text not null default '' check(length(last_result)<=4000),
 evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=16000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint lease_requires_worker check(state<>'IN_PROGRESS' or (worker_id is not null and lease_until is not null))
);
create index if not exists ibuild_agent_work_ready_idx on ibuild_agent.work_queue(state,priority desc,next_review_at);
create index if not exists ibuild_agent_work_lease_idx on ibuild_agent.work_queue(lease_until) where state='IN_PROGRESS';
alter table ibuild_agent.work_queue enable row level security;
revoke all on ibuild_agent.work_queue from public,anon,authenticated;

create table if not exists ibuild_agent.work_log (
 id bigint generated always as identity primary key,
 work_id uuid not null references ibuild_agent.work_queue(id) on delete restrict,
 attempt_no integer not null,
 worker_id text not null check(length(worker_id)<=160),
 action text not null check(action in ('CLAIM','HEARTBEAT','COMPLETE','REQUEUE','BLOCKED','EXPIRED')),
 result text not null default '' check(length(result)<=3000),
 evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=16000),
 happened_at timestamptz not null default now()
);
create index if not exists ibuild_agent_work_log_idx on ibuild_agent.work_log(work_id,happened_at desc);
alter table ibuild_agent.work_log enable row level security;
revoke all on ibuild_agent.work_log from public,anon,authenticated;

create or replace function ibuild_agent.work_queue_tick()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_online boolean;v_expired integer;v_count integer;v_p0_done boolean;
begin
 perform pg_advisory_xact_lock(47910213578::bigint);
 select d.status='ACTIVE' and d.last_seen_at>now()-interval '3 minutes' into v_online
 from public.nexus_devices_v1 d where d.id='175c11dc-055c-44ec-b7ec-06495a0b17c9';
 v_online:=coalesce(v_online,false);
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
  case when v_online then 'READY' else 'WAITING_NEXUS' end,
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

 -- Device health can release blocked work for a new review, never an in-progress task.
 update ibuild_agent.work_queue set
  state=case when v_online then 'READY' else 'WAITING_NEXUS' end,
  updated_at=now()
 where dedupe_key in ('P0:NEXUS','P0:TEST_ORDER','INCIDENT:NEXUS:DEVICE_OFFLINE')
   and state in ('READY','WAITING_NEXUS')
   and ((v_online and state='WAITING_NEXUS') or (not v_online and state='READY'));
 if v_p0_done then
   update ibuild_agent.work_queue set state='DONE',last_result='P0 checkpoint explicitly verified',updated_at=now()
   where dedupe_key like 'P0:%' and state in ('READY','WAITING_EXTERNAL','WAITING_NEXUS','WAITING_HUMAN');
 end if;
 select count(*) into v_count from ibuild_agent.work_queue where state='READY' and next_review_at<=now() and attempt_count<max_attempts;
 return jsonb_build_object('tick','OK','nexus_online',v_online,'ready',v_count,'expired_leases_for_review',v_expired,'p0_verified',v_p0_done);
end;$$;
revoke all on function ibuild_agent.work_queue_tick() from public,anon,authenticated;

create or replace function ibuild_agent.claim_work(p_worker text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_task ibuild_agent.work_queue%rowtype;
begin
 if p_worker is null or length(p_worker)<8 or length(p_worker)>160 then
  raise exception 'Invalid worker id';
 end if;
 -- Avoid parallel iterations across multiple scheduled chats.
 if exists(select 1 from ibuild_agent.work_queue where state='IN_PROGRESS' and lease_until>now())
 then return jsonb_build_object('status','WORKER_BUSY'); end if;
 select * into v_task from ibuild_agent.work_queue
 where state='READY' and next_review_at<=now() and attempt_count<max_attempts
 order by priority desc,next_review_at asc,id
 for update skip locked limit 1;
 if not found then return jsonb_build_object('status','NO_READY_WORK'); end if;
 update ibuild_agent.work_queue
  set state='IN_PROGRESS',attempt_count=attempt_count+1,worker_id=p_worker,lease_until=now()+interval '25 minutes',updated_at=now()
  where id=v_task.id returning * into v_task;
 insert into ibuild_agent.work_log(work_id,attempt_no,worker_id,action,result)
 values(v_task.id,v_task.attempt_count,p_worker,'CLAIM','Worker claimed task with bounded lease');
 return jsonb_build_object('status','CLAIMED','id',v_task.id,'task_type',v_task.task_type,
 'title',v_task.title,'phase',v_task.phase,'diagnosis',v_task.diagnosis,
 'proposed_action',v_task.proposed_action,'attempt',v_task.attempt_count,'lease_until',v_task.lease_until);
end;$$;
revoke all on function ibuild_agent.claim_work(text) from public,anon,authenticated;

create or replace function ibuild_agent.finish_work(p_id uuid,p_worker text,p_state text,p_result text,p_evidence jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_task ibuild_agent.work_queue%rowtype;v_action text;
begin
 if p_state not in ('READY','WAITING_EXTERNAL','WAITING_NEXUS','WAITING_HUMAN','NEEDS_REVIEW','DONE') then
  raise exception 'Invalid next state';
 end if;
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or octet_length(p_evidence::text)>16000 then
  raise exception 'Invalid evidence';
 end if;
 select * into v_task from ibuild_agent.work_queue
 where id=p_id and state='IN_PROGRESS' and worker_id=p_worker for update;
 if not found then return jsonb_build_object('status','NOT_CLAIMED_BY_WORKER'); end if;
 v_action:=case when p_state='READY' then 'REQUEUE'
                when p_state in ('WAITING_EXTERNAL','WAITING_HUMAN','WAITING_NEXUS') then 'BLOCKED' else 'COMPLETE' end;
 update ibuild_agent.work_queue
 set state=case when p_state='READY' and attempt_count>=max_attempts then 'NEEDS_REVIEW' else p_state end,
     lease_until=null,worker_id=null,
     next_review_at=case when p_state='READY' then now()+interval '60 minutes' else now() end,
     last_result=left(coalesce(p_result,''),4000),evidence=ibuild_agent.work_queue.evidence||p_evidence,updated_at=now()
 where id=p_id;
 insert into ibuild_agent.work_log(work_id,attempt_no,worker_id,action,result,evidence)
 values(p_id,v_task.attempt_count,p_worker,v_action,left(coalesce(p_result,''),3000),p_evidence);
 return jsonb_build_object('status','RECORDED','id',p_id,'result_state',p_state);
end;$$;
revoke all on function ibuild_agent.finish_work(uuid,text,text,text,jsonb) from public,anon,authenticated;

select cron.schedule('ibuild_night_work_queue_v1','*/2 * * * *',
  $$select ibuild_agent.work_queue_tick();$$);
