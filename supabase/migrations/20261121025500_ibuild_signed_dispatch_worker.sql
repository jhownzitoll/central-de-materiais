-- iBuild secure scheduled dispatcher and server-side integration permissions.
-- Execute on Supabase with privileged migration role. Do not expose the Vault secret.
begin;
grant select on table
 public.ibuild_notification_config,
 public.ibuild_notification_outbox,
 public.orders,
 public.order_items,
 public.ibuild_order_routing,
 public.ibuild_order_documents
to service_role;

grant select, insert on public.ibuild_whatsapp_messages to service_role;
grant select, insert on public.ibuild_whatsapp_status_events to service_role;
grant select, insert, update on public.ibuild_whatsapp_one_shot_tests to service_role;

do $setup$
begin
 if not exists(select 1 from vault.secrets where name='ibuild_dispatch_cron_secret') then
   perform vault.create_secret(
     pg_catalog.encode(extensions.gen_random_bytes(32),'hex'),
     'ibuild_dispatch_cron_secret',
     'Private signing secret for scheduled iBuild WhatsApp dispatcher'
   );
 end if;
end;
$setup$;

create or replace function private.ibuild_cron_sign(p_ts text)
returns text language sql stable security definer set search_path='' as $fn$
 select pg_catalog.encode(
   extensions.hmac(
     pg_catalog.convert_to(p_ts,'UTF8'),
     pg_catalog.convert_to(s.decrypted_secret,'UTF8'),
     'sha256'
   ),'hex'
 )
 from vault.decrypted_secrets s
 where s.name='ibuild_dispatch_cron_secret'
 limit 1
$fn$;
revoke all on function private.ibuild_cron_sign(text) from public,anon,authenticated,service_role;

create or replace function public.ibuild_verify_cron(p_ts text,p_sig text)
returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare expected text;
begin
 if p_ts is null or p_ts !~ '^[0-9]{10}$'
    or p_sig is null or p_sig !~ '^[0-9a-f]{64}$' then return false; end if;
 if abs(extract(epoch from now()) - p_ts::bigint) > 90 then return false; end if;
 select private.ibuild_cron_sign(p_ts) into expected;
 return expected is not null and expected=p_sig;
end
$fn$;
revoke all on function public.ibuild_verify_cron(text,text) from public,anon,authenticated;
grant execute on function public.ibuild_verify_cron(text,text) to service_role;
commit;

-- Each scheduled invocation receives an expiring HMAC. The secret stays in Vault.
select cron.schedule(
 'ibuild_dispatch_every_minute_v1',
 '* * * * *',
 $job$
 with request_time as (select floor(extract(epoch from now()))::bigint::text as ts)
 select net.http_post(
  url:='https://pkpihrxucorfbniltdtk.supabase.co/functions/v1/ibuild-whatsapp-dispatch',
  headers:=jsonb_build_object(
   'Content-Type','application/json',
   'x-ibuild-cron-ts',request_time.ts,
   'x-ibuild-cron-signature',private.ibuild_cron_sign(request_time.ts)
  ),
  body:='{}'::jsonb
 ) from request_time
 $job$
);
-- Keep ibuild_notification_config.enabled=false until Meta sends and webhook work.
