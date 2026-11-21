-- iBuild first-party order inbox: independent of Meta and any email provider.
-- No historical orders are queued by this migration, and no outbound messages are sent.
create table if not exists public.ibuild_admin_order_alerts (
  order_id uuid primary key references public.orders(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  public_number text not null,
  created_at timestamptz not null,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  constraint ibuild_admin_alert_ack_consistent check (
    (acknowledged_at is null and acknowledged_by is null)
    or (acknowledged_at is not null and acknowledged_by is not null)
  )
);
create index if not exists ibuild_admin_alerts_recent_idx
  on public.ibuild_admin_order_alerts(created_at desc);
create index if not exists ibuild_admin_alerts_unread_idx
  on public.ibuild_admin_order_alerts(created_at desc)
  where acknowledged_at is null;

alter table public.ibuild_admin_order_alerts enable row level security;
revoke all on public.ibuild_admin_order_alerts from public,anon,authenticated;
grant select on public.ibuild_admin_order_alerts to authenticated;
grant select,insert,update on public.ibuild_admin_order_alerts to service_role;

drop policy if exists ibuild_admin_alerts_super_admin_only on public.ibuild_admin_order_alerts;
create policy ibuild_admin_alerts_super_admin_only
on public.ibuild_admin_order_alerts for select to authenticated
using (private.current_user_is_super_admin());

-- Capture new suborders. The checkout has not yet created order_group_orders links,
-- so these alerts are keyed by orders.id and refer to the same existing admin workflow.
create or replace function private.ibuild_new_admin_order_alert()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  insert into public.ibuild_admin_order_alerts(order_id,store_id,public_number,created_at)
  values(new.id,new.store_id,new.public_number,new.created_at)
  on conflict(order_id) do nothing;
  return new;
exception when others then
  -- A transient problem with notifications must NEVER discard a customer's order.
  -- The 5-minute reconciliation cron will recover it.
  raise warning 'iBuild: admin order alert capture failed for order %, will reconcile',new.id;
  return new;
end; $$;
revoke all on function private.ibuild_new_admin_order_alert()
from public,anon,authenticated;
drop trigger if exists ibuild_orders_admin_inbox_v1 on public.orders;
create trigger ibuild_orders_admin_inbox_v1
after insert on public.orders
for each row execute function private.ibuild_new_admin_order_alert();

-- Reconcile only orders created after deployment. Excludes historical attempts.
create or replace function ibuild_agent.reconcile_owner_inbox_v1()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_added integer;
begin
 if not pg_try_advisory_xact_lock(47910213955::bigint) then
   return jsonb_build_object('status','LOCK_BUSY');
 end if;
 with added as (
   insert into public.ibuild_admin_order_alerts(order_id,store_id,public_number,created_at)
   select o.id,o.store_id,o.public_number,o.created_at
   from public.orders o
   where o.created_at >= '2026-11-21 17:40:00+00'::timestamptz
     and not exists (
       select 1 from public.ibuild_admin_order_alerts a where a.order_id=o.id
     )
   order by o.created_at
   limit 100
   on conflict(order_id) do nothing
   returning order_id
 )
 select count(*) into v_added from added;
 return jsonb_build_object('status','OK','recovered',v_added);
end; $$;
revoke all on function ibuild_agent.reconcile_owner_inbox_v1()
from public,anon,authenticated;
select cron.schedule('ibuild_admin_inbox_reconcile_v1','*/5 * * * *',
$$select ibuild_agent.reconcile_owner_inbox_v1();$$);

-- An authenticated, confirmed SUPER_ADMIN is the only actor allowed to acknowledge.
create or replace function public.ibuild_acknowledge_order_alert(p_order_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_updated integer;
begin
 if not private.current_user_is_super_admin() then
   raise exception 'ADMIN_REQUIRED' using errcode='42501';
 end if;
 if p_order_id is null then return false; end if;
 update public.ibuild_admin_order_alerts
 set acknowledged_at=now(), acknowledged_by=auth.uid()
 where order_id=p_order_id and acknowledged_at is null;
 get diagnostics v_updated=row_count;
 return v_updated>0;
end; $$;
revoke all on function public.ibuild_acknowledge_order_alert(uuid)
from public,anon,authenticated;
grant execute on function public.ibuild_acknowledge_order_alert(uuid)
to authenticated;
comment on table public.ibuild_admin_order_alerts
is 'Internal, private admin inbox. One notification per newly registered suborder; no Meta or email delivery required.';
