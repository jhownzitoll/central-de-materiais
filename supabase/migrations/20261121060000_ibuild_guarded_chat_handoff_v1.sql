-- Resume protocol: database can prepare a handoff; only an authenticated Nexus browser can create a real ChatGPT chat.
-- Guarded against concurrent sessions, external blockers, and repeated attempts.
create table if not exists ibuild_agent.chat_handoffs (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references ibuild_agent.runs(id) on delete restrict,
 request_key text not null unique,
 previous_chat_url text,
 created_chat_url text,
 state text not null default 'READY_FOR_REVIEW'
  check(state in ('READY_FOR_REVIEW','DISPATCHED','CONFIRMED','FAILED','BLOCKED','CANCELLED')),
 prompt_text text not null check(length(prompt_text)<=2500),
 browser_job_id uuid,
 evidence jsonb not null default '{}'::jsonb
  check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=10000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists ibuild_agent_chat_handoffs_status_idx on ibuild_agent.chat_handoffs(state,created_at);
alter table ibuild_agent.chat_handoffs enable row level security;
revoke all on ibuild_agent.chat_handoffs from public,anon,authenticated;

-- Ensure only one normal-ChatGPT worker can claim work even if two scheduled runs overlap.
create or replace function ibuild_agent.claim_work(p_worker text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_task ibuild_agent.work_queue%rowtype;
begin
 if p_worker is null or length(p_worker)<8 or length(p_worker)>160 then
  raise exception 'Invalid worker id';
 end if;
 if not pg_try_advisory_xact_lock(47910213579::bigint) then
  return jsonb_build_object('status','LOCK_BUSY');
 end if;
 -- Avoid parallel iterations across multiple scheduled chats.
 if exists(select 1 from ibuild_agent.work_queue where state='IN_PROGRESS')
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


create or replace function ibuild_agent.chat_handoff_tick()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_online boolean;v_allowed boolean;v_pending integer;v_registered integer;v_run ibuild_agent.runs%rowtype;v_key text;v_handoff uuid;
begin
 if not pg_try_advisory_xact_lock(47910213601::bigint) then return jsonb_build_object('status','LOCK_BUSY'); end if;
 select s.chat_resume_enabled into v_allowed from ibuild_agent.supervisor_state s where s.id=1;
 if not coalesce(v_allowed,false) then return jsonb_build_object('status','DISABLED'); end if;
 select d.status='ACTIVE' and d.last_seen_at>now()-interval '3 minutes' into v_online
 from public.nexus_devices_v1 d where d.id='175c11dc-055c-44ec-b7ec-06495a0b17c9';
 if not coalesce(v_online,false) then return jsonb_build_object('status','WAITING_NEXUS'); end if;
 select count(*) into v_pending from public.nexus_jobs_v1
 where device_id='175c11dc-055c-44ec-b7ec-06495a0b17c9' and status in ('PENDING','RUNNING');
 if v_pending>0 then return jsonb_build_object('status','BROWSER_BUSY'); end if;
 select count(*) into v_registered from ibuild_agent.chat_handoffs
 where created_at>now()-interval '24 hours';
 if v_registered>=3 then return jsonb_build_object('status','DAILY_LIMIT'); end if;
 select * into v_run from ibuild_agent.runs
 where project='ibuild' and phase='P0' and status in ('SUSPECT','STALLED')
   and heartbeat_at<now()-interval '25 minutes'
 order by created_at desc limit 1;
 if not found then return jsonb_build_object('status','NO_STALLED_RUN'); end if;
 v_key:=v_run.id::text||':'||to_char(now() at time zone 'America/Sao_Paulo','YYYYMMDD');
 insert into ibuild_agent.chat_handoffs(run_id,request_key,previous_chat_url,prompt_text)
 values(v_run.id,v_key,v_run.executor_chat_url,
 'iBuild P0 — NOVA CONVERSA NORMAL (não Work). Continue pelo checkpoint Supabase public.ibuild_agent_checkpoints_v1 run_id ibuild-p0-chat-normal-20261121; confira ibuild_agent.runs e GitHub jhownzitoll/central-de-materiais antes de atuar. Não repita pedidos, emails ou WhatsApp com efeito incerto. Mantenha Meta desabilitada até autorização. Primeiro confira bloqueios externos; depois assuma um item pela fila ibuild_agent.work_queue. Faça uma iteração operacional e grave evidência. Caso sessão exija login/CAPTCHA, pare e registre WAITING_HUMAN.')
 on conflict(request_key) do nothing returning id into v_handoff;
 if v_handoff is null then return jsonb_build_object('status','ALREADY_PREPARED'); end if;
 insert into ibuild_agent.work_queue(dedupe_key,task_type,title,priority,state,diagnosis,proposed_action)
 values('HANDOFF:'||v_key,'HANDOFF','Transferir executor P0 para conversa nova normal',94,
  'READY','Executor SUSPECT e Nexus online; necessario confirmar que a UI nao esta gerando resposta.',
  'Verificar ChatGPT normal logado, abrir nova conversa apenas uma vez e registrar ID de conversa e job.')
 on conflict(dedupe_key) do nothing;
 insert into ibuild_agent.supervisor_events(component,action,result,details)
 values('AGENT','PREPARE_CHAT_HANDOFF','READY',jsonb_build_object('handoff_id',v_handoff,'run_id',v_run.id));
 return jsonb_build_object('status','PREPARED','handoff_id',v_handoff,'run_id',v_run.id);
end;$$;
revoke all on function ibuild_agent.chat_handoff_tick() from public,anon,authenticated;

-- Explicit authorization has been given for safe new-chat handoffs, not unrestricted site automation.
update ibuild_agent.supervisor_state set chat_resume_enabled=true,updated_at=now() where id=1;
select cron.schedule('ibuild_night_chat_handoff_v1','*/5 * * * *',
  $$select ibuild_agent.chat_handoff_tick();$$);
