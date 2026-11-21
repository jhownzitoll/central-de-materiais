-- Email channel deliberately isolated from the legacy Meta outbox: the legacy
-- WhatsApp claim RPC has no channel filter. No retroactive sends.
create table if not exists public.ibuild_email_outbox (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references public.orders(id) on delete restrict,
 store_id uuid not null references public.stores(id) on delete restrict,
 state text not null default 'PENDENTE' check(state in ('PENDENTE','EM_PROCESSAMENTO','ACEITO','ENTREGUE','FALHA','RESULTADO_INCERTO','CANCELADA')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 provider_message_id text unique,
 last_error_code text,
 locked_at timestamptz,
 accepted_at timestamptz,
 delivered_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.ibuild_email_outbox enable row level security;
revoke all on public.ibuild_email_outbox from public,anon,authenticated;
grant select,insert,update on public.ibuild_email_outbox to service_role;
create index if not exists ibuild_email_outbox_state_idx on public.ibuild_email_outbox(state,created_at);
comment on table public.ibuild_email_outbox is 'Owner-only transactional emails: independent of Meta dispatcher; no customer contacts or email secrets stored.';
