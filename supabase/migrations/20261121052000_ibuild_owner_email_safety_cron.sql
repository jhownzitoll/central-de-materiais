-- Safety-only job: never retries an email; converts stale in-flight sends to
-- RESULTADO_INCERTO so a human can reconcile provider/inbox evidence.
do $schedule$
begin
 if not exists(select 1 from cron.job where jobname='ibuild_email_inflight_safety_v1') then
   perform cron.schedule(
     'ibuild_email_inflight_safety_v1',
     '*/5 * * * *',
     $task$
       update public.ibuild_email_outbox
       set state='RESULTADO_INCERTO',
           last_error_code='STALE_INFLIGHT_REQUIRES_RECONCILIATION',
           locked_at=null,updated_at=now()
       where state='EM_PROCESSAMENTO'
         and locked_at < now()-interval '10 minutes'
     $task$
   );
 end if;
end;
$schedule$;
