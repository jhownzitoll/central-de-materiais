-- iBuild Materiais: intermediação e outbox; migração aditiva.
-- Aplicar ANTES de publicar frontend que consome os novos recursos.
-- Não altera pedidos históricos ou precificação.
begin;

create table if not exists public.ibuild_order_routing (
  order_id uuid primary key references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  state text not null default 'AGUARDANDO_CONFERENCIA'
    check (state in ('AGUARDANDO_CONFERENCIA','APROVADO','ENCAMINHAMENTO_INICIADO','ENCAMINHADO','REJEITADO')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  forwarded_by uuid references auth.users(id),
  forwarded_at timestamptz,
  opened_at timestamptz,
  admin_note text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists ibuild_routing_store_state on public.ibuild_order_routing(store_id,state,updated_at desc);

create table if not exists public.ibuild_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check(length(kind) between 3 and 60),
  actor_id uuid references auth.users(id),
  actor_kind text not null check (actor_kind in ('SISTEMA','ADMIN','FORNECEDOR','META')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ibuild_events_order_time on public.ibuild_order_events(order_id,created_at desc);

create table if not exists public.ibuild_notification_config (
  id smallint primary key default 1 check(id=1),
  admin_phone text check(admin_phone is null or admin_phone ~ '^[1-9][0-9]{9,14}$'),
  enabled boolean not null default false,
  environment text not null default 'TESTE' check(environment in ('TESTE','PRODUCAO')),
  template_name text not null default 'ibuild_novo_pedido',
  template_language text not null default 'pt_BR',
  updated_at timestamptz not null default now()
);
insert into public.ibuild_notification_config (id) values(1) on conflict(id) do nothing;

create table if not exists public.ibuild_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_key text not null default 'NOVO_PEDIDO',
  recipient_kind text not null default 'ADMIN' check(recipient_kind in ('ADMIN','FORNECEDOR')),
  recipient_phone text,
  state text not null default 'AGUARDANDO_CONFIGURACAO' check(state in (
   'AGUARDANDO_CONFIGURACAO','PENDENTE','EM_PROCESSAMENTO','ACEITO',
   'ENVIADO','ENTREGUE','LIDO','FALHA_TEMPORARIA','FALHA_PERMANENTE','RESULTADO_INCERTO','CANCELADA')),
  attempts integer not null default 0 check(attempts between 0 and 100),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  provider_message_id text unique,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,event_key,recipient_kind)
);
create index if not exists ibuild_outbox_ready on public.ibuild_notification_outbox(state,next_attempt_at,created_at);
create index if not exists ibuild_outbox_order on public.ibuild_notification_outbox(order_id);

alter table public.ibuild_order_routing enable row level security;
alter table public.ibuild_order_events enable row level security;
alter table public.ibuild_notification_config enable row level security;
alter table public.ibuild_notification_outbox enable row level security;

revoke all on public.ibuild_order_routing from public,anon,authenticated;
revoke all on public.ibuild_order_events from public,anon,authenticated;
revoke all on public.ibuild_notification_config from public,anon,authenticated;
revoke all on public.ibuild_notification_outbox from public,anon,authenticated;
grant select on public.ibuild_order_routing,public.ibuild_order_events,public.ibuild_notification_config,public.ibuild_notification_outbox to authenticated;
grant update(admin_phone,enabled,environment,template_name,template_language,updated_at)
  on public.ibuild_notification_config to authenticated;

create policy ibuild_routing_super_select on public.ibuild_order_routing for select to authenticated
  using(private.current_user_is_super_admin());
create policy ibuild_events_super_select on public.ibuild_order_events for select to authenticated
  using(private.current_user_is_super_admin());
create policy ibuild_outbox_super_select on public.ibuild_notification_outbox for select to authenticated
  using(private.current_user_is_super_admin());
create policy ibuild_config_super_select on public.ibuild_notification_config for select to authenticated
  using(private.current_user_is_super_admin());
create policy ibuild_config_super_update on public.ibuild_notification_config for update to authenticated
  using(private.current_user_is_super_admin()) with check(private.current_user_is_super_admin());

create or replace function private.ibuild_new_order() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare cfg public.ibuild_notification_config%rowtype;
begin
  if new.status <> 'NOVO' then return new; end if;
  insert into public.ibuild_order_routing(order_id,store_id)
    values(new.id,new.store_id) on conflict(order_id) do nothing;
  insert into public.ibuild_order_events(order_id,kind,actor_kind)
    values(new.id,'PEDIDO_CRIADO','SISTEMA');
  select * into cfg from public.ibuild_notification_config where id=1;
  insert into public.ibuild_notification_outbox(order_id,recipient_phone,state)
    values(new.id,cfg.admin_phone,
      case when cfg.enabled and cfg.admin_phone is not null then 'PENDENTE' else 'AGUARDANDO_CONFIGURACAO' end)
    on conflict(order_id,event_key,recipient_kind) do nothing;
  return new;
end $fn$;
drop trigger if exists ibuild_orders_created on public.orders;
create trigger ibuild_orders_created after insert on public.orders
for each row execute function private.ibuild_new_order();

create or replace function private.ibuild_redact_store_contact() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
  -- Contacto comercial privado, acessível ao intermediário por store_settings.
  new.store_snapshot := new.store_snapshot - 'seller_whatsapp' - 'seller_email';
  return new;
end $fn$;
drop trigger if exists ibuild_orders_redact_contact on public.orders;
create trigger ibuild_orders_redact_contact before insert on public.orders
for each row execute function private.ibuild_redact_store_contact();

create or replace function public.create_order_v2(
  p_store_id uuid,p_items jsonb,p_notes text default null,p_idempotency_key uuid default gen_random_uuid(),
  p_delivery_method text default 'DELIVERY')
returns jsonb language sql set search_path to 'private','public','pg_catalog','pg_temp' as $fn$
  select private.create_order_internal_v2(p_store_id,p_items,p_notes,p_idempotency_key,p_delivery_method) - 'seller_whatsapp'
$fn$;
create or replace function public.create_order(
  p_store_id uuid,p_items jsonb,p_notes text default null,p_idempotency_key uuid default gen_random_uuid())
returns jsonb language sql set search_path to 'private','public','pg_catalog','pg_temp' as $fn$
  select private.create_order_internal_v2(p_store_id,p_items,p_notes,p_idempotency_key,'DELIVERY') - 'seller_whatsapp'
$fn$;

create or replace function private.ibuild_order_is_forwarded(p_order_id uuid)
returns boolean language sql stable security definer set search_path='' as $fn$
  select exists(
    select 1 from public.ibuild_order_routing r
    where r.order_id=p_order_id and r.state='ENCAMINHADO'
  );
$fn$;
revoke all on function private.ibuild_order_is_forwarded(uuid) from public,anon;
grant execute on function private.ibuild_order_is_forwarded(uuid) to authenticated;

create or replace function public.ibuild_route_action(p_order_id uuid,p_action text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r public.ibuild_order_routing%rowtype;
        o public.orders%rowtype;
        n text := trim(coalesce(p_note,''));
        a text := upper(trim(coalesce(p_action,'')));
        next_state text;
begin
  if not private.current_user_is_super_admin() then raise exception 'IBUILD_ACCESS_DENIED'; end if;
  if length(n)>500 then raise exception 'IBUILD_NOTE_TOO_LONG'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'IBUILD_ORDER_NOT_FOUND'; end if;
  if o.status='CANCELADO' then raise exception 'IBUILD_ORDER_CANCELLED'; end if;
  select * into r from public.ibuild_order_routing where order_id=p_order_id for update;
  if not found then raise exception 'IBUILD_ROUTING_NOT_FOUND'; end if;
  if a='APPROVE' and r.state='AGUARDANDO_CONFERENCIA' then
    next_state:='APROVADO';
    update public.ibuild_order_routing set state=next_state,approved_by=auth.uid(),approved_at=now(),admin_note=n,updated_at=now()
      where order_id=p_order_id;
  elsif a='REJECT' and r.state in ('AGUARDANDO_CONFERENCIA','APROVADO') then
    next_state:='REJEITADO';
    update public.ibuild_order_routing set state=next_state,admin_note=n,updated_at=now()
      where order_id=p_order_id;
    update public.orders set status='CANCELADO',seller_notes=coalesce(nullif(n,''),'Rejeitado pela iBuild')
      where id=p_order_id;
    update public.ibuild_notification_outbox set state='CANCELADA',updated_at=now()
      where order_id=p_order_id and state in ('AGUARDANDO_CONFIGURACAO','PENDENTE','FALHA_TEMPORARIA');
  elsif a='START_FORWARD' and r.state='APROVADO' then
    if not exists (select 1 from public.store_settings s
      where s.store_id=r.store_id and s.seller_whatsapp ~ '^[1-9][0-9]{9,14}$') then
      raise exception 'IBUILD_SELLER_PHONE_REQUIRED';
    end if;
    next_state:='ENCAMINHAMENTO_INICIADO';
    update public.ibuild_order_routing set state=next_state,updated_at=now() where order_id=p_order_id;
  elsif a='CONFIRM_FORWARD' and r.state='ENCAMINHAMENTO_INICIADO' then
    next_state:='ENCAMINHADO';
    update public.ibuild_order_routing set state=next_state,forwarded_by=auth.uid(),forwarded_at=now(),updated_at=now()
      where order_id=p_order_id;
    if o.status='NOVO' then update public.orders set status='EM_ATENDIMENTO' where id=p_order_id; end if;
  else
    raise exception 'IBUILD_INVALID_TRANSITION: %, %', r.state, a;
  end if;
  insert into public.ibuild_order_events(order_id,kind,actor_kind,actor_id,detail)
  values(p_order_id,a,'ADMIN',auth.uid(),case when n<>'' then jsonb_build_object('note',n) else '{}'::jsonb end);
  return jsonb_build_object('order_id',p_order_id,'state',next_state);
end $fn$;
revoke all on function public.ibuild_route_action(uuid,text,text) from public,anon;
grant execute on function public.ibuild_route_action(uuid,text,text) to authenticated;

create or replace function public.ibuild_mark_seen(p_order_id uuid)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
  if not private.current_user_is_super_admin() then raise exception 'IBUILD_ACCESS_DENIED'; end if;
  update public.ibuild_order_routing set opened_at=coalesce(opened_at,now())
    where order_id=p_order_id;
  return found;
end $fn$;
revoke all on function public.ibuild_mark_seen(uuid) from public,anon;
grant execute on function public.ibuild_mark_seen(uuid) to authenticated;

create or replace function private.ibuild_notification_config_changed() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
  if new.enabled and new.admin_phone is not null then
    update public.ibuild_notification_outbox n
       set state='PENDENTE',recipient_phone=new.admin_phone,updated_at=now(),next_attempt_at=now()
      from public.orders o
     where n.order_id=o.id and o.status<>'CANCELADO'
       and n.state='AGUARDANDO_CONFIGURACAO' and n.recipient_kind='ADMIN';
  end if;
  return new;
end $fn$;
drop trigger if exists ibuild_notification_config_touch on public.ibuild_notification_config;
create trigger ibuild_notification_config_touch
after update of admin_phone,enabled on public.ibuild_notification_config
for each row execute function private.ibuild_notification_config_changed();

create or replace function public.ibuild_retry_notification(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare cfg public.ibuild_notification_config%rowtype;
begin
 if not private.current_user_is_super_admin() then raise exception 'IBUILD_ACCESS_DENIED'; end if;
 select * into cfg from public.ibuild_notification_config where id=1;
 update public.ibuild_notification_outbox n
  set state=case when cfg.enabled and cfg.admin_phone is not null then 'PENDENTE' else 'AGUARDANDO_CONFIGURACAO' end,
      recipient_phone=cfg.admin_phone,attempts=0,locked_at=null,last_error=null,
      next_attempt_at=now(),updated_at=now()
  from public.orders o
  where n.id=p_notification_id and n.order_id=o.id and o.status<>'CANCELADO'
    and n.recipient_kind='ADMIN'
    and n.state in ('FALHA_TEMPORARIA','FALHA_PERMANENTE','RESULTADO_INCERTO','AGUARDANDO_CONFIGURACAO');
 return found;
end $fn$;
revoke all on function public.ibuild_retry_notification(uuid) from public,anon;
grant execute on function public.ibuild_retry_notification(uuid) to authenticated;

create or replace function public.ibuild_claim_notification_batch(p_limit integer default 5,p_order_id uuid default null)
returns table(id uuid,order_id uuid,recipient_phone text,attempts integer)
language sql security definer set search_path='' as $fn$
 with pending as (
   select n.id from public.ibuild_notification_outbox n
   join public.orders o on o.id=n.order_id
   join public.ibuild_order_routing r on r.order_id=o.id
   join public.ibuild_notification_config cfg on cfg.id=1
   where cfg.enabled and cfg.admin_phone is not null
     and (p_order_id is null or n.order_id=p_order_id)
     and n.state in ('PENDENTE','FALHA_TEMPORARIA')
     and n.attempts<5 and n.next_attempt_at<=now()
     and o.status not in ('CANCELADO','FINALIZADO')
     and r.state not in ('REJEITADO')
   order by n.created_at
   for update of n skip locked limit least(greatest(p_limit,1),20)
 )
 update public.ibuild_notification_outbox n set
   state='EM_PROCESSAMENTO',attempts=n.attempts+1,locked_at=now(),updated_at=now()
 from pending p where n.id=p.id
 returning n.id,n.order_id,n.recipient_phone,n.attempts;
$fn$;
revoke all on function public.ibuild_claim_notification_batch(integer,uuid) from public,anon,authenticated;
grant execute on function public.ibuild_claim_notification_batch(integer,uuid) to service_role;

create or replace function public.ibuild_finish_notification(
 p_id uuid,p_state text,p_provider_id text default null,p_error text default null,p_retry_seconds integer default 60)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
 if p_state not in ('ACEITO','FALHA_TEMPORARIA','FALHA_PERMANENTE','RESULTADO_INCERTO') then
   raise exception 'IBUILD_INVALID_MESSAGE_STATE'; end if;
 update public.ibuild_notification_outbox n
  set state=case when p_state='FALHA_TEMPORARIA' and n.attempts>=5 then 'FALHA_PERMANENTE' else p_state end,
      provider_message_id=coalesce(nullif(p_provider_id,''),provider_message_id),
      last_error=left(coalesce(p_error,''),400),
      locked_at=null,next_attempt_at=case when p_state='FALHA_TEMPORARIA' then
        now()+(least(greatest(p_retry_seconds,30),3600)||' seconds')::interval else now() end,
      updated_at=now()
 where n.id=p_id and n.state='EM_PROCESSAMENTO';
 return found;
end $fn$;
revoke all on function public.ibuild_finish_notification(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.ibuild_finish_notification(uuid,text,text,text,integer) to service_role;

create or replace function public.ibuild_record_meta_status(
  p_message_id text,p_status text,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare next_state text;
begin
 next_state:=case lower(coalesce(p_status,''))
   when 'sent' then 'ENVIADO'
   when 'delivered' then 'ENTREGUE'
   when 'read' then 'LIDO'
   when 'failed' then 'FALHA_PERMANENTE' else null end;
 if next_state is null then return false; end if;
 update public.ibuild_notification_outbox
  set state=case
    when state='LIDO' then 'LIDO'
    when state='ENTREGUE' and next_state in ('ENVIADO','FALHA_PERMANENTE') then state
    when state='ENVIADO' and next_state='FALHA_PERMANENTE' then next_state
    when state in ('ACEITO','ENVIADO','ENTREGUE','LIDO') then next_state
    else state end,
    last_error=case when next_state='FALHA_PERMANENTE' then left(coalesce(p_error,''),400) else last_error end,
    updated_at=now()
 where provider_message_id=p_message_id;
 return found;
end $fn$;
revoke all on function public.ibuild_record_meta_status(text,text,text) from public,anon,authenticated;
grant execute on function public.ibuild_record_meta_status(text,text,text) to service_role;

comment on table public.ibuild_notification_outbox is
 'Outbox da iBuild: resposta ACEITO não prova entrega. RESULTADO_INCERTO impede retry automático após timeout.';
commit;