-- Visão comercial pública sem canais de contato direto do fornecedor.
begin;
create or replace view public.ibuild_catalog_settings
with (security_barrier=true)
as select
  ss.store_id,ss.subtitle,
  'Atendimento iBuild Materiais'::text as seller_name,
  null::text as seller_whatsapp,
  null::text as seller_email,
  ss.price_notice,ss.order_instructions,ss.pickup_info,ss.delivery_info
from public.store_settings ss
join public.stores s on s.id=ss.store_id
where s.active;
revoke all on public.ibuild_catalog_settings from public;
grant select on public.ibuild_catalog_settings to anon,authenticated;
comment on view public.ibuild_catalog_settings is
 'Somente metadados necessários ao catálogo público. Contatos privados não expostos.';
commit;