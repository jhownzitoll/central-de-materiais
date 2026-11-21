-- iBuild => Gmail personal bridge (no Meta, no API key for an email provider).
-- Only new order groups after initial deployment are eligible. Never resubmit uncertain sends.
create table if not exists public.ibuild_gmail_bridge_config (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default true,
  token_sha256 text not null check(token_sha256 ~ '^[a-f0-9]{64}$'),
  first_eligible_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ibuild_gmail_bridge_config enable row level security;
revoke all on public.ibuild_gmail_bridge_config from public,anon,authenticated;
grant select on public.ibuild_gmail_bridge_config to service_role;
insert into public.ibuild_gmail_bridge_config(id,token_sha256,enabled)
values(1,'42e4378d534d8b34353c53e1b14884a664995acf8d4f24790f8442d354b4754d',true)
on conflict(id) do nothing;

create table if not exists public.ibuild_gmail_outbox (
 group_id uuid primary key references public.order_groups(id) on delete restrict,
 state text not null default 'PENDING' check(state in ('PENDING','CLAIMED','ACCEPTED','FAILED','UNKNOWN','CANCELLED')),
 claim_id uuid unique,
 claimed_at timestamptz,
 accepted_at timestamptz,
 finished_at timestamptz,
 detail_code text check(detail_code is null or length(detail_code)<=120),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint ibuild_gmail_claim_integrity check (
  state not in ('CLAIMED','ACCEPTED','FAILED','UNKNOWN') or claim_id is not null
 )
);
create index if not exists ibuild_gmail_pending_idx on public.ibuild_gmail_outbox(created_at)
where state='PENDING';
alter table public.ibuild_gmail_outbox enable row level security;
revoke all on public.ibuild_gmail_outbox from public,anon,authenticated;
grant select,insert,update on public.ibuild_gmail_outbox to service_role;

-- Group links become visible only on transaction commit; therefore each queued
-- group is fully committed before the polling Apps Script can claim it.
create or replace function private.ibuild_gmail_queue_on_group_order()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from public.ibuild_gmail_bridge_config c
             join public.order_groups g on g.id=new.group_id
             where c.id=1 and c.enabled and g.created_at>=c.first_eligible_at)
  then
    insert into public.ibuild_gmail_outbox(group_id)
    values(new.group_id)
    on conflict(group_id) do nothing;
  end if;
  return new;
exception when others then
  raise warning 'iBuild Gmail queue unavailable for group %; cron reconciliation required',new.group_id;
  return new;
end; $$;
revoke all on function private.ibuild_gmail_queue_on_group_order() from public,anon,authenticated;
drop trigger if exists ibuild_gmail_order_group_link_v1 on public.order_group_orders;
create trigger ibuild_gmail_order_group_link_v1
after insert on public.order_group_orders
for each row execute function private.ibuild_gmail_queue_on_group_order();

create or replace function ibuild_agent.gmail_bridge_maintenance_v1()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_queued integer;v_uncertain integer;
begin
 if not pg_try_advisory_xact_lock(47910213975::bigint) then
   return jsonb_build_object('status','LOCK_BUSY');
 end if;
 with queued as (
  insert into public.ibuild_gmail_outbox(group_id)
  select g.id from public.order_groups g
  join public.ibuild_gmail_bridge_config c on c.id=1 and c.enabled
  where g.created_at>=c.first_eligible_at
    and exists(select 1 from public.order_group_orders x where x.group_id=g.id)
  order by g.created_at limit 100
  on conflict(group_id) do nothing
  returning group_id
 )
 select count(*) into v_queued from queued;
 with stalled as (
   update public.ibuild_gmail_outbox
   set state='UNKNOWN',finished_at=now(),
       detail_code='CLAIM_TIMEOUT_NO_AUTO_RETRY',updated_at=now()
   where state='CLAIMED' and claimed_at < now()-interval '12 minutes'
   returning group_id
 )
 select count(*) into v_uncertain from stalled;
 return jsonb_build_object('status','OK','new_groups_queued',v_queued,
                           'expired_claims_quarantined',v_uncertain);
end; $$;
revoke all on function ibuild_agent.gmail_bridge_maintenance_v1() from public,anon,authenticated;
select cron.schedule('ibuild_gmail_bridge_maintenance_v1','*/5 * * * *',
 $$select ibuild_agent.gmail_bridge_maintenance_v1();$$);
comment on table public.ibuild_gmail_outbox is
'Exactly one email attempt per new consolidated order group via owner-authorized Apps Script MailApp. ACCEPTED is not proof of inbox delivery; UNKNOWN never retried automatically.';
