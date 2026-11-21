-- iBuild P0: deterministic server-side recovery if the browser closes after checkout.
-- Do not process historical groups or issue retries for any existing outbox row.
-- Each Edge invocation validates an expiring Vault-backed HMAC (no secrets in SQL/logs).
do $install$
begin
 if not exists(select 1 from cron.job where jobname='ibuild_owner_email_rescue_v1') then
   perform cron.schedule(
     'ibuild_owner_email_rescue_v1',
     '*/5 * * * *',
     $job$
     with candidates as (
       select g.id from public.order_groups g
       where g.created_at >= '2026-11-21 05:11:18+00'::timestamptz
         and g.created_at >= now()-interval '24 hours'
         and g.created_at <= now()-interval '1 minute'
         and exists (
           select 1 from public.order_group_orders l
             join public.orders o on o.id=l.order_id
           where l.group_id=g.id and o.status<>'CANCELADO'
             and not exists(select 1 from public.ibuild_email_outbox e where e.order_id=o.id)
         )
         and not exists (
           select 1 from public.order_group_orders l
             join public.orders o on o.id=l.order_id
           where l.group_id=g.id and o.status='CANCELADO'
         )
       order by g.created_at asc limit 2
     ),
     ts as (select floor(extract(epoch from now()))::bigint::text as value)
     select net.http_post(
       url:='https://pkpihrxucorfbniltdtk.supabase.co/functions/v1/ibuild-owner-email-dispatch',
       headers:=jsonb_build_object(
         'Content-Type','application/json',
         'x-ibuild-cron-ts',ts.value,
         'x-ibuild-cron-signature',private.ibuild_cron_sign(ts.value)
       ),
       body:=jsonb_build_object('group_id',c.id),
       timeout_milliseconds:=15000
     ) from candidates c cross join ts
     $job$
   );
 end if;
end;
$install$;
