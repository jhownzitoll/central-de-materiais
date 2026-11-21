-- Ensure authenticated Meta diagnostics remain fresh for the remediation supervisor.
-- Read-only Meta GET endpoints only: no template creation, no messages, no payment changes.
select cron.schedule('ibuild_meta_diagnostics_every_30m_v1','17,47 * * * *',
$$with ts as (select floor(extract(epoch from now()))::bigint::text v)
  select net.http_post(
    url:='https://pkpihrxucorfbniltdtk.supabase.co/functions/v1/ibuild-integration-diagnostics',
    headers:=jsonb_build_object('Content-Type','application/json',
      'x-ibuild-cron-ts',ts.v,
      'x-ibuild-cron-signature',private.ibuild_cron_sign(ts.v)),
    body:='{}'::jsonb, timeout_milliseconds:=45000)
  from ts;$$);
