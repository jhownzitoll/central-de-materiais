-- Applies the additive production schema for consolidated multistore orders.
-- Uses pre-existing store orders as supplier suborders; legacy orders untouched.
create table if not exists public.order_groups (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete restrict,
 idempotency_key uuid not null,
 request_signature text not null,
 public_number text not null unique default ('IB-'||to_char(now(),'YYMMDD')||'-'||lpad(nextval('public.order_public_seq')::text,6,'0')),
 delivery_method text not null check (delivery_method in ('DELIVERY','PICKUP')),
 notes text, total numeric(14,2) not null default 0 check (total>=0),
 created_at timestamptz not null default now(), unique(user_id,idempotency_key)
);
create table if not exists public.order_group_orders (
 group_id uuid not null references public.order_groups(id) on delete restrict,
 order_id uuid primary key references public.orders(id) on delete restrict,
 store_id uuid not null references public.stores(id) on delete restrict,
 unique(group_id,store_id)
);
create index if not exists idx_group_orders_group on public.order_group_orders(group_id);
create index if not exists idx_order_groups_user_date on public.order_groups(user_id,created_at desc);
alter table public.order_groups enable row level security;
alter table public.order_group_orders enable row level security;
revoke all on public.order_groups from public,anon,authenticated;
revoke all on public.order_group_orders from public,anon,authenticated;
grant select on public.order_groups,public.order_group_orders to authenticated;
drop policy if exists order_groups_owner_admin_select on public.order_groups;
create policy order_groups_owner_admin_select on public.order_groups for select to authenticated
 using (user_id=(select auth.uid()) or private.current_user_is_super_admin());
drop policy if exists group_orders_owner_admin_select on public.order_group_orders;
create policy group_orders_owner_admin_select on public.order_group_orders for select to authenticated
 using (exists (select 1 from public.order_groups g where g.id=group_id
   and (g.user_id=(select auth.uid()) or private.current_user_is_super_admin())));

CREATE OR REPLACE FUNCTION private.create_multi_order_internal_v1(p_items jsonb, p_notes text, p_idempotency_key uuid, p_delivery_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_group public.order_groups%rowtype;
  v_method text := upper(coalesce(p_delivery_method,''));
  v_signature text;
  v_matched integer;
  v_batch record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_child_key uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'INVALID_REQUEST_KEY'; end if;
  if v_method not in ('DELIVERY','PICKUP') then raise exception 'INVALID_DELIVERY_METHOD'; end if;
  if length(coalesce(p_notes,''))>500 then raise exception 'NOTES_TOO_LONG'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 80 then
    raise exception 'INVALID_ITEMS';
  end if;
  if exists (
   select 1 from jsonb_array_elements(p_items) x
   where jsonb_typeof(x) <> 'object'
      or coalesce(x->>'offer_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then raise exception 'INVALID_OFFER_ID'; end if;
  v_signature := md5(p_items::text||'|'||coalesce(trim(p_notes),'')||'|'||v_method);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':'||p_idempotency_key::text,0));
  select * into v_group from public.order_groups
    where user_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_group.request_signature<>v_signature then raise exception 'REQUEST_KEY_CONFLICT'; end if;
    return jsonb_build_object('group_id',v_group.id,'public_number',v_group.public_number,
       'total',v_group.total,'duplicate',true,
       'orders',coalesce((select jsonb_agg(jsonb_build_object('order_id',o.id,'store_id',o.store_id,
           'public_number',o.public_number,'total',o.total) order by o.public_number)
         from public.order_group_orders l join public.orders o on o.id=l.order_id
         where l.group_id=v_group.id),'[]'::jsonb));
  end if;
  select count(*) into v_matched from jsonb_array_elements(p_items) x
    join public.store_offers so on so.id=(x->>'offer_id')::uuid;
  if v_matched<>jsonb_array_length(p_items) then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  insert into public.order_groups(user_id,idempotency_key,request_signature,delivery_method,notes)
    values(v_user,p_idempotency_key,v_signature,v_method,nullif(trim(p_notes),''))
    returning * into v_group;
  for v_batch in
    select so.store_id, jsonb_agg(x.value order by x.ord) as items
      from jsonb_array_elements(p_items) with ordinality as x(value,ord)
      join public.store_offers so on so.id=(x.value->>'offer_id')::uuid
      group by so.store_id order by so.store_id
  loop
    -- Stable per-supplier key makes the existing proven checkout idempotent.
    v_child_key := md5(v_user::text||':'||p_idempotency_key::text||':'||v_batch.store_id::text)::uuid;
    v_result := private.create_order_internal_v2(v_batch.store_id,v_batch.items,p_notes,v_child_key,v_method);
    insert into public.order_group_orders(group_id,order_id,store_id)
      values(v_group.id,(v_result->>'order_id')::uuid,v_batch.store_id);
    v_total := v_total + (v_result->>'total')::numeric;
    if v_total > 1000000 then raise exception 'ORDER_LIMIT'; end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'order_id',v_result->>'order_id','store_id',v_batch.store_id,
      'public_number',v_result->>'public_number','total',(v_result->>'total')::numeric));
  end loop;
  update public.order_groups set total=v_total where id=v_group.id;
  return jsonb_build_object('group_id',v_group.id,'public_number',v_group.public_number,
      'total',v_total,'orders',v_results,'duplicate',false);
end $function$


CREATE OR REPLACE FUNCTION public.create_multi_order_v1(p_items jsonb, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT gen_random_uuid(), p_delivery_method text DEFAULT 'DELIVERY'::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.create_multi_order_internal_v1(p_items,p_notes,p_idempotency_key,p_delivery_method)
$function$


revoke all on function private.create_multi_order_internal_v1(jsonb,text,uuid,text) from public,anon,authenticated;
grant execute on function private.create_multi_order_internal_v1(jsonb,text,uuid,text) to authenticated;
revoke all on function public.create_multi_order_v1(jsonb,text,uuid,text) from public,anon,authenticated;
grant execute on function public.create_multi_order_v1(jsonb,text,uuid,text) to authenticated;
