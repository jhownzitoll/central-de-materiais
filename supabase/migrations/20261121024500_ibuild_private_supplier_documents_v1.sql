-- iBuild: server-generated private supplier PDFs, no public storage access.
-- Safely repeatable on an existing installation.
begin;
create table if not exists public.ibuild_order_documents (
  order_id uuid primary key references public.orders(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  size_bytes integer not null check(size_bytes between 100 and 10000000),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz not null default now()
);
alter table public.ibuild_order_documents enable row level security;
revoke all on public.ibuild_order_documents from public, anon, authenticated;
grant select, insert on public.ibuild_order_documents to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ibuild-order-pdfs','ibuild-order-pdfs',false,10000000,array['application/pdf']::text[])
on conflict(id) do nothing;
comment on table public.ibuild_order_documents is
 'Per-supplier PDF metadata stored server-side only. Private Supabase Storage objects.';
commit;
-- Jobs stuck after a crashed delivery attempt are marked uncertain, NEVER blindly retried.
select cron.schedule('ibuild_recover_stale_inflight_v1','*/5 * * * *',$job$
 update public.ibuild_notification_outbox
 set state='RESULTADO_INCERTO',locked_at=null,
     last_error='Interrompido durante processamento; verificar entrega antes de reenviar.',
     updated_at=now()
 where state='EM_PROCESSAMENTO' and locked_at < now()-interval '10 minutes'
$job$);
