-- Restrict raw order reads to customer owners and iBuild superadmins.
-- Suppliers must use privacy-filtered ibuild_supplier_* RPCs, never raw fee-bearing tables.
-- Existing customer and superadmin reads remain compatible during rollout.
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
 using (user_id=(select auth.uid()) or private.current_user_is_super_admin());
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select to authenticated
 using (exists (select 1 from public.orders o where o.id=order_items.order_id
   and (o.user_id=(select auth.uid()) or private.current_user_is_super_admin())));
