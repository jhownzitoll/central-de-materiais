-- POST-DEPLOY ONLY. Do not run while the old Workers frontend still selects orders/order_items directly.
-- Requires frontend using ibuild_customer_order(s)_v1 and ibuild_supplier_order(s)_v1 RPCs.
-- This blocks customers and suppliers from querying internal fee snapshots in raw order tables.
begin;
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (private.current_user_is_super_admin());
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select to authenticated
  using (private.current_user_is_super_admin());
commit;
