-- Map the executor's own P0 checkpoint to the supervisor run; avoid false stalls and accidental duplicate prompts.
create or replace function ibuild_agent.sync_executor_checkpoint()
returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
 c public.ibuild_agent_checkpoints_v1%rowtype;
 r ibuild_agent.runs%rowtype;
 desired text;
 stamp text;
begin
 select * into c from public.ibuild_agent_checkpoints_v1
  where run_id='ibuild-p0-chat-normal-20261121'
  order by last_checkpoint_at desc limit 1;
 if not found then return jsonb_build_object('status','no_executor_checkpoint'); end if;
 select * into r from ibuild_agent.runs where project='ibuild' and phase=c.phase
  order by created_at desc limit 1;
 if not found then return jsonb_build_object('status','run_not_registered'); end if;

 desired := case
   when c.state='WAITING_EXTERNAL' then 'WAITING_EXTERNAL'
   when c.state='WAITING_HUMAN' then 'WAITING_HUMAN'
   when c.state='PAUSED' then 'PAUSED'
   when c.state='RUNNING' then 'RUNNING'
   when c.state='QUEUED' then 'QUEUED'
   when c.state='DONE' and c.gate_state in ('VERIFIED','PASS','ACCEPTED') then 'DONE'
   when c.state='FAILED' then 'FAILED'
   else 'RUNNING' end;
 stamp:=c.last_checkpoint_at::text;
 if coalesce(r.evidence->>'executor_checkpoint_at','')=stamp and r.status=desired then
   return jsonb_build_object('status','unchanged','executor_state',desired);
 end if;

 update ibuild_agent.runs set
  status=desired,
  checkpoint=left('Executor P0: estado='||coalesce(c.state,'?')||'; gate='||coalesce(c.gate_state,'?')||'; registro='||coalesce(c.run_id,'?'),4000),
  next_action=left(coalesce(c.next_action,r.next_action,''),2000),
  blocker=case when desired in ('WAITING_EXTERNAL','WAITING_HUMAN')
    then 'Dependencia externa registrada pelo agente; nao enviar prompts ou repetir mensagens sem checagem.'
    else null end,
  heartbeat_at=greatest(r.heartbeat_at,coalesce(c.heartbeat_at,c.last_checkpoint_at)),
  progress_at=greatest(r.progress_at,coalesce(c.last_progress_at,c.last_checkpoint_at)),
  updated_at=now(),
  evidence=r.evidence||jsonb_build_object(
   'executor_checkpoint_at',stamp,'executor_run_id',c.run_id,
   'executor_gate',c.gate_state,'executor_state',c.state)
 where id=r.id;

 insert into ibuild_agent.events(run_id,event_type,detail,evidence)
 values(r.id,'EXECUTOR_CHECKPOINT_SYNC',
   'Checkpoint do executor sincronizado com o supervisor.',
   jsonb_build_object('executor_state',desired,'gate',c.gate_state,'at',stamp));
 return jsonb_build_object('status','updated','run_id',r.id,'executor_state',desired,'gate',c.gate_state);
end;
$$;
revoke all on function ibuild_agent.sync_executor_checkpoint() from public,anon,authenticated;
select cron.schedule('ibuild_agent_checkpoint_sync_v1','*/2 * * * *',
  $$select ibuild_agent.sync_executor_checkpoint();$$);