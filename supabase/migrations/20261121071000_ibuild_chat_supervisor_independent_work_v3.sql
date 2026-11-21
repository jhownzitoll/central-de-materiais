-- Safe progression after uncertain browser sends. Requires the updated v3 local client.
create or replace function ibuild_agent.chat_supervisor_2min_tick()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_last public.ibuild_chat_monitor_signals%rowtype;
 v_first public.ibuild_chat_monitor_signals%rowtype;
 v_online boolean;
 v_busy boolean;
 v_task ibuild_agent.work_queue%rowtype;
 v_id uuid;
 v_sent_today integer;
 v_day_start timestamptz;
 v_limit integer;
 v_last_sent timestamptz;
 v_count integer;
begin
 if not pg_try_advisory_xact_lock(47910213622::bigint) then
   return jsonb_build_object('status','LOCK_BUSY');
 end if;
 select max_chat_prompts_per_day,chat_resume_enabled
   into v_limit,v_online from ibuild_agent.supervisor_state where id=1;
 if not coalesce(v_online,false) then return jsonb_build_object('status','DISABLED'); end if;
 -- Handle expiring claims with uncertainty instead of automatic retry.
 with lost as(
   update public.ibuild_chat_dispatches
   set state='UNKNOWN',finished_at=now(),error='Client claimed command but never confirmed; do not auto-retry'
   where state='CLAIMED' and claimed_at<now()-interval '6 minutes' returning id
 ) select count(*) into v_count from lost;
 select * into v_last from public.ibuild_chat_monitor_signals
   where observed_at>now()-interval '3 minutes' order by observed_at desc,id desc limit 1;
 if not found then return jsonb_build_object('status','NO_FRESH_BROWSER_TELEMETRY','uncertain_claims',v_count); end if;
 if v_last.state='BUSY' then return jsonb_build_object('status','CHAT_BUSY_WAIT_2_MIN'); end if;
 -- Old Windows clients reported UNKNOWN after a fixed 2.4s DOM wait.
 -- Do not dispatch more prompts until the updated Playwriter companion is installed.
 if v_last.note <> 'playwriter-existing-chrome-v3' then
   return jsonb_build_object('status','CLIENT_UPGRADE_REQUIRED','observed_version',left(v_last.note,80));
 end if;
 if v_last.state<>'IDLE' or not v_last.authenticated or not v_last.composer_ready or not v_last.composer_empty
    or v_last.browser_url !~ '^https://chatgpt[.]com(/|$)'
 then return jsonb_build_object('status','CHAT_UNVERIFIED_OR_BLOCKED'); end if;
 select * into v_first from public.ibuild_chat_monitor_signals
 where session_id=v_last.session_id and state='IDLE' and authenticated and composer_ready and composer_empty
   and browser_url=v_last.browser_url and last_response_fingerprint=v_last.last_response_fingerprint
   and observed_at between v_last.observed_at-interval '5 minutes'
                       and v_last.observed_at-interval '90 seconds'
 order by observed_at desc limit 1;
 if not found then return jsonb_build_object('status','WAIT_FOR_SECOND_IDLE_SAMPLE'); end if;
 -- Require uninterrupted idle: no BUSY/UNKNOWN events between the two stable observations.
 if exists(select 1 from public.ibuild_chat_monitor_signals s
   where s.session_id=v_last.session_id
     and s.observed_at>v_first.observed_at and s.observed_at<v_last.observed_at
     and (s.state<>'IDLE' or not s.authenticated or not s.composer_ready or not s.composer_empty
          or s.last_response_fingerprint<>v_last.last_response_fingerprint))
 then return jsonb_build_object('status','IDLE_SEQUENCE_INTERRUPTED'); end if;
 -- PREPARED/CLAIMED are active. UNKNOWN is immutable evidence, but after
 -- 15 minutes of no retry and two confirmed-idle samples a DIFFERENT task may run.
 if exists(select 1 from public.ibuild_chat_dispatches
           where state in ('PREPARED','CLAIMED')
              or (state='UNKNOWN' and created_at > now()-interval '15 minutes'))
 then return jsonb_build_object('status','PENDING_OR_UNCERTAIN_DISPATCH'); end if;
 -- A task whose send result was UNKNOWN is never re-enqueued, regardless of attempt count.
 -- Other independent tasks may proceed once the browser is verifiably idle.

 select max(sent_at) into v_last_sent from public.ibuild_chat_dispatches where state='SENT';
 if v_last_sent>now()-interval '12 minutes' then return jsonb_build_object('status','COOLDOWN'); end if;
 v_day_start:=date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
 select count(*) into v_sent_today from public.ibuild_chat_dispatches
   where created_at>=v_day_start and state in ('CLAIMED','SENT','UNKNOWN');
 if v_sent_today>=v_limit then return jsonb_build_object('status','DAILY_LIMIT','used',v_sent_today); end if;
 if exists(select 1 from ibuild_agent.work_queue where state='IN_PROGRESS' and lease_until>now())
 then return jsonb_build_object('status','WORK_BUSY'); end if;
 -- Do not move to a new task until the previous ChatGPT turn has saved work progress.
 -- If ChatGPT sent a prompt but made no DB claim after 35 min and the UI
 -- is confirmed idle, quarantine that task as NEEDS_REVIEW; never replay it.
 with expired_unclaimed as (
   update ibuild_agent.work_queue w
   set state='NEEDS_REVIEW',updated_at=now(),
       last_result='Prompt sent and confirmed in browser, but no task claim/checkpoint after 35 minutes; manual review required'
   from public.ibuild_chat_dispatches d
   where d.work_id=w.id and d.state='SENT'
     and w.state='READY' and w.attempt_count=d.task_attempt
     and d.sent_at<now()-interval '35 minutes'
   returning w.id,w.attempt_count
 )
 insert into ibuild_agent.work_log(work_id,attempt_no,worker_id,action,result)
 select id,attempt_count,'supervisor-chat-v3','EXPIRED',
        'Confirmed browser send, no work checkpoint after 35m. No auto-retry.'
 from expired_unclaimed;
 if exists(
   select 1 from public.ibuild_chat_dispatches d join ibuild_agent.work_queue w on w.id=d.work_id
   where d.state='SENT' and w.state='READY' and w.attempt_count=d.task_attempt
 ) then return jsonb_build_object('status','WAITING_FOR_CHAT_TASK_CHECKPOINT'); end if;
 select * into v_task from ibuild_agent.work_queue
   where state='READY' and next_review_at<=now() and attempt_count<max_attempts
     and not exists(select 1 from public.ibuild_chat_dispatches d
       where d.work_id=ibuild_agent.work_queue.id
         and (d.task_attempt=ibuild_agent.work_queue.attempt_count or d.state='UNKNOWN'))
   order by priority desc,next_review_at asc,id limit 1;
 if not found then return jsonb_build_object('status','NO_NEW_READY_TASK'); end if;
 insert into public.ibuild_chat_dispatches(work_id,task_attempt,session_id,prompt_text)
 values(v_task.id,v_task.attempt_count,v_last.session_id,
 'iBuild P0 — execução técnica no ChatGPT NORMAL, sem Work. Leia PRIMEIRO docs/OPERACAO_AGENTE_NOTURNO_2026-11-21.md em GitHub jhownzitoll/central-de-materiais. A fila identificou a tarefa: '||
 v_task.title||'. Contexto: '||left(v_task.diagnosis,1100)||
 '. Objetivo/hipótese: '||left(v_task.proposed_action,1100)||
 '. Leia Supabase pkpihrxucorfbniltdtk, checkpoint public.ibuild_agent_checkpoints_v1, estados e logs reais. Assuma UMA tarefa via select ibuild_agent.claim_work(''chatgpt-normal-browser-'||v_task.id::text||'''); se não for a tarefa indicada ou WORKER_BUSY, não execute escrita. Investigue, faça correções permitidas, teste, e chame ibuild_agent.finish_work com evidência e estado real. Não reenviar pedidos/email/WhatsApp de resultado incerto, não pagar, não contornar autenticação, não iniciar catálogo antes de prova P0. Se dependência externa: registre WAITING_EXTERNAL. Não presuma execução contínua ou prova de entrega.')
 on conflict(work_id,task_attempt) do nothing returning id into v_id;
 if v_id is null then return jsonb_build_object('status','ALREADY_PREPARED'); end if;
 insert into ibuild_agent.supervisor_events(component,action,result,details)
 values('AGENT','PREPARE_IDLE_CHAT_TASK','PREPARED',jsonb_build_object('dispatch_id',v_id,'work_id',v_task.id,'state','verified_idle_twice'));
 return jsonb_build_object('status','PREPARED','dispatch_id',v_id,'work_id',v_task.id);
end;$$;
revoke all on function ibuild_agent.chat_supervisor_2min_tick() from public,anon,authenticated;
