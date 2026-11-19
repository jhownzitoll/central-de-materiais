-- Remove a view SECURITY DEFINER exposta a clientes.
-- Cache público com somente metadados autorizados, RLS e view SECURITY INVOKER.
begin;
create table if not exists public.ibuild_catalog_settings_cache (
  store_id uuid primary key references public.stores(id) on delete cascade,
  subtitle text,
  price_notice text,
  order_instructions text,
  pickup_info text,
  delivery_info text,
  updated_at timestamptz not null default now()
);
alter table public.ibuild_catalog_settings_cache enable row level security;
revoke all on public.ibuild_catalog_settings_cache from public,anon,authenticated;
grant select on public.ibuild_catalog_settings_cache to anon,authenticated;
create policy ibuild_catalog_cache_public on public.ibuild_catalog_settings_cache for select to anon,authenticated
using (exists(select 1 from public.stores s where s.id=store_id and s.active));

insert into public.ibuild_catalog_settings_cache(
  store_id,subtitle,price_notice,order_instructions,pickup_info,delivery_info,updated_at)
select store_id,subtitle,price_notice,order_instructions,pickup_info,delivery_info,now()
from public.store_settings
on conflict(store_id) do update set
  subtitle=excluded.subtitle,price_notice=excluded.price_notice,
  order_instructions=excluded.order_instructions,pickup_info=excluded.pickup_info,
  delivery_info=excluded.delivery_info,updated_at=now();

create or replace function private.ibuild_refresh_public_store_settings()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_op='DELETE' then
   delete from public.ibuild_catalog_settings_cache where store_id=old.store_id;
   return old;
 end if;
 insert into public.ibuild_catalog_settings_cache(
   store_id,subtitle,price_notice,order_instructions,pickup_info,delivery_info,updated_at)
 values(new.store_id,new.subtitle,new.price_notice,new.order_instructions,new.pickup_info,new.delivery_info,now())
 on conflict(store_id) do update set
   subtitle=excluded.subtitle,price_notice=excluded.price_notice,
   order_instructions=excluded.order_instructions,pickup_info=excluded.pickup_info,
   delivery_info=excluded.delivery_info,updated_at=now();
 return new;
end $fn$;
drop trigger if exists ibuild_settings_public_cache on public.store_settings;
create trigger ibuild_settings_public_cache after insert or update or delete on public.store_settings
for each row execute function private.ibuild_refresh_public_store_settings();

create or replace view public.ibuild_catalog_settings with
 (security_invoker=true,security_barrier=true)
as select c.store_id,c.subtitle,
 'Atendimento iBuild Materiais'::text as seller_name,
 null::text as seller_whatsapp,
 null::text as seller_email,
 c.price_notice,c.order_instructions,c.pickup_info,c.delivery_info
from public.ibuild_catalog_settings_cache c
join public.stores s on s.id=c.store_id
where s.active;
grant select on public.ibuild_catalog_settings to anon,authenticated;
create index if not exists ibuild_event_actor_id_idx on public.ibuild_order_events(actor_id);
create index if not exists ibuild_routing_approved_by_idx on public.ibuild_order_routing(approved_by);
create index if not exists ibuild_routing_forwarded_by_idx on public.ibuild_order_routing(forwarded_by);
commit;