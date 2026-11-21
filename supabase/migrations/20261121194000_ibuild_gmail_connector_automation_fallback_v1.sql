-- iBuild Gmail fallback: GPT automation -> already connected Gmail plugin (no Meta and no Google Apps Script authorization).
-- Processes exactly one existing PENDING consolidated group per claim; shares same state machine with Apps Script.
-- No historical orders are inserted and no emails are sent by this migration.

create or replace function ibuild_agent.claim_gmail_connector_fallback_v1()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_candidate record;
  v_owner_email text;
  v_owner_count integer;
  v_count integer;
  v_orders jsonb;
  v_claim uuid;
  v_changed uuid;
begin
  select count(*), max(p.email)
    into v_owner_count,v_owner_email
  from public.profiles p join auth.users u on u.id=p.id
  where p.active and p.platform_role='SUPER_ADMIN'
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until < now())
    and lower(u.email)=lower(p.email);
  if v_owner_count<>1 or v_owner_email is null then
    return jsonb_build_object('ok',false,'status','OWNER_NOT_VERIFIED');
  end if;

  for v_candidate in
    select q.group_id,g.public_number,g.total,g.user_id
    from public.ibuild_gmail_outbox q
      join public.order_groups g on g.id=q.group_id
      join public.ibuild_gmail_bridge_config c on c.id=1
    where c.enabled and q.state='PENDING'
      and g.created_at>=c.first_eligible_at
      and g.created_at<now()-interval '2 minutes'
    order by q.created_at limit 8
    for update of q skip locked
  loop
    select count(*) into v_count
    from public.order_group_orders l where l.group_id=v_candidate.group_id;
    if v_count<1 or v_count>12 then continue; end if;
    if exists (
      select 1 from public.order_group_orders l
      left join public.orders o on o.id=l.order_id
      where l.group_id=v_candidate.group_id
        and (o.id is null or o.user_id<>v_candidate.user_id
          or o.status='CANCELADO'
          or o.store_id<>l.store_id
          or not exists (select 1 from public.order_items i where i.order_id=o.id)
          or exists (select 1 from public.order_items i where i.order_id=o.id
                     and (i.quantity<1 or i.quantity>100000 or
                       coalesce(i.base_unit_price_snapshot,i.unit_price_snapshot)<0)))
    ) then continue; end if;

    select jsonb_agg(jsonb_build_object(
        'order_id',o.id,'public_number',o.public_number,
        'created_at',o.created_at,'store_name',left(coalesce(o.store_snapshot->>'store_name','Fornecedor'),100),
        'customer_snapshot',o.customer_snapshot,'delivery_method',o.delivery_method,
        'notes',left(coalesce(o.notes,''),500),'total',o.total,
        'items',(select jsonb_agg(jsonb_build_object(
          'product',left(i.product_name_snapshot,180),
          'code',left(coalesce(i.store_product_code_snapshot,i.sku_snapshot,''),75),
          'quantity',i.quantity,'unit',i.unit_snapshot,
          'unit_price',coalesce(i.base_unit_price_snapshot,i.unit_price_snapshot),
          'total',coalesce(i.base_unit_price_snapshot,i.unit_price_snapshot)*i.quantity
        ) order by i.id) from public.order_items i where i.order_id=o.id)
      ) order by o.public_number) into v_orders
    from public.order_group_orders l
    join public.orders o on o.id=l.order_id
    where l.group_id=v_candidate.group_id;

    if coalesce(jsonb_array_length(v_orders),0)<>v_count then continue; end if;
    v_claim:=gen_random_uuid();
    update public.ibuild_gmail_outbox
      set state='CLAIMED',claim_id=v_claim,claimed_at=now(),updated_at=now()
      where group_id=v_candidate.group_id and state='PENDING'
      returning group_id into v_changed;
    if v_changed is null then continue; end if;
    return jsonb_build_object(
      'ok',true,'status','CLAIMED',
      'group_id',v_candidate.group_id,'claim_id',v_claim,
      'public_number',v_candidate.public_number,'group_total',v_candidate.total,
      'recipient',v_owner_email,'orders',v_orders,
      'delivery_proven',false,'channel','gmail_connector_automation'
    );
  end loop;
  return jsonb_build_object('ok',true,'status','EMPTY_OR_NOT_READY');
end; $$;
revoke all on function ibuild_agent.claim_gmail_connector_fallback_v1()
  from public,anon,authenticated,service_role;

create or replace function ibuild_agent.finish_gmail_connector_fallback_v1(
 p_group_id uuid,p_claim_id uuid,p_state text,p_detail text default null,p_pre_send boolean default false
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_updated uuid;
begin
 if p_state not in ('ACCEPTED','UNKNOWN','FAILED') then
  return jsonb_build_object('ok',false,'status','INVALID_STATE');
 end if;
 if p_state='FAILED' and not p_pre_send then
  return jsonb_build_object('ok',false,'status','FAILED_MUST_BE_PRE_SEND');
 end if;
 update public.ibuild_gmail_outbox set
  state=p_state,
  accepted_at=case when p_state='ACCEPTED' then now() else null end,
  finished_at=now(),
  detail_code=left(regexp_replace(coalesce(p_detail,'NONE'),'[^a-zA-Z0-9_-]','','g'),110),
  updated_at=now()
 where group_id=p_group_id and claim_id=p_claim_id and state='CLAIMED'
 returning group_id into v_updated;
 return jsonb_build_object('ok',v_updated is not null,
   'status',case when v_updated is null then 'NOT_CLAIMED_OR_ALREADY_FINISHED' else p_state end);
end; $$;
revoke all on function ibuild_agent.finish_gmail_connector_fallback_v1(uuid,uuid,text,text,boolean)
  from public,anon,authenticated,service_role;
