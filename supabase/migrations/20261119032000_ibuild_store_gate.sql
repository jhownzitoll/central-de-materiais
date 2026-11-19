-- Aplicar SOMENTE após publicar frontend que usa ibuild_catalog_settings.
begin;
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
using(
  user_id=(select auth.uid()) or private.current_user_is_super_admin()
  or (private.can_manage_store(store_id) and private.ibuild_order_is_forwarded(id))
);
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select to authenticated
using(exists(
 select 1 from public.orders o where o.id=order_items.order_id
 and (o.user_id=(select auth.uid()) or private.current_user_is_super_admin()
 or (private.can_manage_store(o.store_id) and private.ibuild_order_is_forwarded(o.id)))
));
drop policy if exists orders_store_update on public.orders;
create policy orders_store_update on public.orders for update to authenticated
using(private.can_manage_store(store_id) and
 (private.current_user_is_super_admin() or private.ibuild_order_is_forwarded(id)))
with check(private.can_manage_store(store_id) and
 (private.current_user_is_super_admin() or private.ibuild_order_is_forwarded(id)));

-- Ocultar WhatsApp do vendedor na API pública; o catálogo usa a view segura.
drop policy if exists store_settings_public on public.store_settings;
drop policy if exists store_settings_authenticated on public.store_settings;
drop policy if exists store_settings_admin_select on public.store_settings;
create policy store_settings_admin_select on public.store_settings for select to authenticated
using(private.can_manage_store(store_id));
commit;