-- Keep work ready before the next hourly ChatGPT-normal scheduled iteration.
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
     next_review_at=case when p_state='READY' then now()+interval '45 minutes' else now() end,
     last_result=left(coalesce(p_result,''),4000),evidence=ibuild_agent.work_queue.evidence||p_evidence,updated_at=now()
 where id=p_id;
 insert into ibuild_agent.work_log(work_id,attempt_no,worker_id,action,result,evidence)
 values(p_id,v_task.attempt_count,p_worker,v_action,left(coalesce(p_result,''),3000),p_evidence);
 return jsonb_build_object('status','RECORDED','id',p_id,'result_state',p_state);
end;$$;
revoke all on function ibuild_agent.finish_work(uuid,text,text,text,jsonb) from public,anon,authenticated;

