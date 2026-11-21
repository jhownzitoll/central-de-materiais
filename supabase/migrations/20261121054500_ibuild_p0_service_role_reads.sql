-- iBuild P0: repair restricted service-role read permissions needed by Edge Functions.
-- Preserve RLS and deny client roles. No write grants or exposure of private profile fields.
grant select (id,user_id,created_at) on table public.order_groups to service_role;
grant select (group_id,order_id,store_id) on table public.order_group_orders to service_role;
grant select (id,email,platform_role,active) on table public.profiles to service_role;
