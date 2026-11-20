-- Additive, privacy-minimised read/write RPCs for clients and suppliers.
-- Raw order table RLS will only be tightened after the deployed frontend uses these RPCs.
create or replace function private.ibuild_safe_order_json(o public.orders, p_supplier boolean default false)
returns jsonb language sql stable set search_path to '' as $$
select jsonb_build_object(
 'id',o.id,'public_number',o.public_number,'user_id',o.user_id,'store_id',o.store_id,
 'customer_snapshot',o.customer_snapshot,'store_snapshot',o.store_snapshot,
 'subtotal',case when p_supplier then
   coalesce((select sum(i.quantity*coalesce(i.base_unit_price_snapshot,i.unit_price_snapshot)) from public.order_items i where i.order_id=o.id),0)
   else o.subtotal end,
 'total',case when p_supplier then
   coalesce((select sum(i.quantity*coalesce(i.base_unit_price_snapshot,i.unit_price_snapshot)) from public.order_items i where i.order_id=o.id),0)
   else o.total end,
 'status',o.status,'delivery_method',o.delivery_method,'notes',o.notes,'created_at',o.created_at
);
$$;
revoke all on function private.ibuild_safe_order_json(public.orders,boolean) from public,anon,authenticated;

create or replace function private.ibuild_safe_items_json(p_order_id uuid,p_supplier boolean default false)
returns jsonb language sql stable set search_path to '' as $$
select coalesce(jsonb_agg(jsonb_build_object(
 'id',i.id,'order_id',i.order_id,'product_id',i.product_id,'offer_id',i.offer_id,
 'sku_snapshot',i.sku_snapshot,'store_product_code_snapshot',i.store_product_code_snapshot,
 'product_name_snapshot',i.product_name_snapshot,'unit_snapshot',i.unit_snapshot,
 'quantity',i.quantity,
 'unit_price_snapshot',case when p_supplier then coalesce(i.base_unit_price_snapshot,i.unit_price_snapshot) else i.unit_price_snapshot end,
 'subtotal',case when p_supplier then round(i.quantity*coalesce(i.base_unit_price_snapshot,i.unit_price_snapshot),2) else i.subtotal end
 ) order by i.id),'[]'::jsonb) from public.order_items i where i.order_id=p_order_id;
$$;
revoke all on function private.ibuild_safe_items_json(uuid,boolean) from public,anon,authenticated;

create or replace function private.ibuild_customer_orders_internal_v1()
returns jsonb language sql stable security definer set search_path to '' as $$
 select coalesce(jsonb_agg(private.ibuild_safe_order_json(o,false) order by o.created_at desc),'[]'::jsonb)
 from public.orders o where auth.uid() is not null and o.user_id=auth.uid();
$$;
create or replace function private.ibuild_customer_order_internal_v1(p_order_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
 select jsonb_build_object('order',private.ibuild_safe_order_json(o,false),
   'items',private.ibuild_safe_items_json(o.id,false))
 from public.orders o where auth.uid() is not null and o.id=p_order_id and o.user_id=auth.uid();
$$;
create or replace function private.ibuild_supplier_orders_internal_v1()
returns jsonb language sql stable security definer set search_path to '' as $$
 select coalesce(jsonb_agg(private.ibuild_safe_order_json(o,true) order by o.created_at desc),'[]'::jsonb)
 from public.orders o
 where auth.uid() is not null and private.can_manage_store(o.store_id)
   and private.ibuild_order_is_forwarded(o.id);
$$;
create or replace function private.ibuild_supplier_order_internal_v1(p_order_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
 select jsonb_build_object('order',private.ibuild_safe_order_json(o,true),
   'items',private.ibuild_safe_items_json(o.id,true))
 from public.orders o
 where auth.uid() is not null and o.id=p_order_id
 and private.can_manage_store(o.store_id) and private.ibuild_order_is_forwarded(o.id);
$$;

create or replace function private.ibuild_supplier_set_status_internal_v1(p_order_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_order public.orders%rowtype;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_status not in ('EM_ATENDIMENTO','ORCAMENTO','CONFIRMADO','FINALIZADO') then
   raise exception 'INVALID_SUPPLIER_STATUS'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found or not private.can_manage_store(v_order.store_id)
     or not private.ibuild_order_is_forwarded(v_order.id) then
   raise exception 'SUPPLIER_ORDER_ACCESS_DENIED'; end if;
 if v_order.status='CANCELADO' then raise exception 'ORDER_CANCELLED'; end if;
 update public.orders set status=p_status::public.order_status where id=p_order_id;
 return jsonb_build_object('order_id',p_order_id,'status',p_status);
end;
$$;
revoke all on function private.ibuild_customer_orders_internal_v1() from public,anon,authenticated;
revoke all on function private.ibuild_customer_order_internal_v1(uuid) from public,anon,authenticated;
revoke all on function private.ibuild_supplier_orders_internal_v1() from public,anon,authenticated;
revoke all on function private.ibuild_supplier_order_internal_v1(uuid) from public,anon,authenticated;
revoke all on function private.ibuild_supplier_set_status_internal_v1(uuid,text) from public,anon,authenticated;
grant execute on function private.ibuild_customer_orders_internal_v1() to authenticated;
grant execute on function private.ibuild_customer_order_internal_v1(uuid) to authenticated;
grant execute on function private.ibuild_supplier_orders_internal_v1() to authenticated;
grant execute on function private.ibuild_supplier_order_internal_v1(uuid) to authenticated;
grant execute on function private.ibuild_supplier_set_status_internal_v1(uuid,text) to authenticated;

create or replace function public.ibuild_customer_orders_v1()
returns jsonb language sql stable security invoker set search_path to '' as $$
 select private.ibuild_customer_orders_internal_v1() $$;
create or replace function public.ibuild_customer_order_v1(p_order_id uuid)
returns jsonb language sql stable security invoker set search_path to '' as $$
 select private.ibuild_customer_order_internal_v1(p_order_id) $$;
create or replace function public.ibuild_supplier_orders_v1()
returns jsonb language sql stable security invoker set search_path to '' as $$
 select private.ibuild_supplier_orders_internal_v1() $$;
create or replace function public.ibuild_supplier_order_v1(p_order_id uuid)
returns jsonb language sql stable security invoker set search_path to '' as $$
 select private.ibuild_supplier_order_internal_v1(p_order_id) $$;
create or replace function public.ibuild_supplier_set_status_v1(p_order_id uuid,p_status text)
returns jsonb language sql security invoker set search_path to '' as $$
 select private.ibuild_supplier_set_status_internal_v1(p_order_id,p_status) $$;
revoke all on function public.ibuild_customer_orders_v1() from public,anon,authenticated;
revoke all on function public.ibuild_customer_order_v1(uuid) from public,anon,authenticated;
revoke all on function public.ibuild_supplier_orders_v1() from public,anon,authenticated;
revoke all on function public.ibuild_supplier_order_v1(uuid) from public,anon,authenticated;
revoke all on function public.ibuild_supplier_set_status_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.ibuild_customer_orders_v1() to authenticated;
grant execute on function public.ibuild_customer_order_v1(uuid) to authenticated;
grant execute on function public.ibuild_supplier_orders_v1() to authenticated;
grant execute on function public.ibuild_supplier_order_v1(uuid) to authenticated;
grant execute on function public.ibuild_supplier_set_status_v1(uuid,text) to authenticated;
