-- Claim a specifically assigned browser task, never another READY task with different priority.
-- Chrome's previous UNKNOWN submission remains quarantined and is never replayed.
create or replace function ibuild_agent.claim_specific_work(p_worker text,p_work_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_task ibuild_agent.work_queue%rowtype;
begin
 if p_worker is null or length(p_worker)<8 or length(p_worker)>160 or p_work_id is null then
   raise exception 'Invalid worker or work ID';
 end if;
 if not pg_try_advisory_xact_lock(47910213579::bigint) then
   return jsonb_build_object('status','LOCK_BUSY');
 end if;
 if exists(select 1 from ibuild_agent.work_queue where state='IN_PROGRESS') then
   return jsonb_build_object('status','WORKER_BUSY');
 end if;
 select * into v_task from ibuild_agent.work_queue
 where id=p_work_id and state='READY' and next_review_at<=now()
   and attempt_count<max_attempts
   and not exists(
     select 1 from public.ibuild_chat_dispatches d
     where d.work_id=p_work_id and d.state='UNKNOWN')
 for update skip locked;
 if not found then return jsonb_build_object('status','TASK_NOT_READY_OR_UNCERTAIN'); end if;
 update ibuild_agent.work_queue
  set state='IN_PROGRESS',attempt_count=attempt_count+1,worker_id=p_worker,
      lease_until=now()+interval '25 minutes',updated_at=now()
  where id=v_task.id returning * into v_task;
 insert into ibuild_agent.work_log(work_id,attempt_no,worker_id,action,result)
 values(v_task.id,v_task.attempt_count,p_worker,'CLAIM','Claimed exact scheduled browser task');
 return jsonb_build_object('status','CLAIMED','id',v_task.id,'task_type',v_task.task_type,
 'title',v_task.title,'phase',v_task.phase,'diagnosis',v_task.diagnosis,
 'proposed_action',v_task.proposed_action,'attempt',v_task.attempt_count,'lease_until',v_task.lease_until);
end;$$;
revoke all on function ibuild_agent.claim_specific_work(text,uuid) from public,anon,authenticated;

-- Patch only the prompt text constructor, preserving the existing v3
-- stable-idle and uncertain-dispatch safety rules.
do $$
declare original text; updated text;
begin
 original:=pg_get_functiondef('ibuild_agent.chat_supervisor_2min_tick()'::regprocedure);
 if position('ibuild_agent.claim_work(' in original)=0 then
   raise exception 'Expected dispatch prompt text not found; abort change safely';
 end if;
 updated:=replace(original,
   'ibuild_agent.claim_work(',
   'ibuild_agent.claim_specific_work(');
 -- The previous prompt uses a worker identifier derived from the task ID.
 -- Append the exact UUID as the second argument in the SQL expression itself.
 updated:=replace(updated,
   '||v_task.id::text||'''); se não for a tarefa indicada',
   '||v_task.id::text||''','''||v_task.id::text||'''::uuid); se não for a tarefa indicada');
 if updated=original or position('ibuild_agent.claim_work(' in updated)>0 then
   raise exception 'Dispatch prompt not patched; abort safely';
 end if;
 if position('claim_specific_work(' in updated)=0 or position('::uuid); se não for a tarefa indicada' in updated)=0 then
   raise exception 'Target UUID argument missing; abort safely';
 end if;
 execute updated;
end;$$;
