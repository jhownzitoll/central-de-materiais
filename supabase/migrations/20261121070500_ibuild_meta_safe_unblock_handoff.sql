-- Read-only Meta issue classification. Does not change business accounts or send messages.
create or replace function ibuild_agent.meta_remediation_triage_tick()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_response jsonb;
 v_diag jsonb;
 v_audit_age interval;
 v_graph integer;
 v_errors jsonb;
 v_payment boolean := false;
 v_inactive boolean := false;
 v_verify boolean := false;
 v_phone_pending boolean := false;
 v_mismatch boolean := false;
 v_missing_template boolean := false;
 v_token_ok boolean := false;
 v_configured_phone_banned boolean := false;
begin
 if not pg_try_advisory_xact_lock(47910213630::bigint) then
   return jsonb_build_object('status','BUSY');
 end if;

 select now()-s.last_waba_probe_at, r.status_code, r.content::jsonb
 into v_audit_age,v_graph,v_response
 from ibuild_agent.supervisor_state s
 left join net._http_response r on r.id=s.last_waba_probe_request
 where s.id=1 and r.status_code=200;
 if v_graph<>200 or v_response is null or v_audit_age>interval '40 minutes' then
   return jsonb_build_object('status','AUDIT_MISSING_OR_STALE');
 end if;

 v_errors:=coalesce(v_response->'health_entities','[]'::jsonb);
 v_payment:=v_errors @> '[{"entity_type":"WABA","errors":[{"code":141006}]}]'::jsonb;
 v_inactive:=v_errors @> '[{"entity_type":"WABA","errors":[{"code":141008}]}]'::jsonb;
 v_verify:=v_errors @> '[{"entity_type":"BUSINESS","errors":[{"code":141010}]}]'::jsonb;
 v_phone_pending:=v_response->'phones' @> '[{"status":"PENDING"}]'::jsonb;

 perform ibuild_agent.observe_issue('META','PAYMENT_METHOD_ERROR','CRITICAL',
   'Meta health_status: codigo 141006 — metodo de pagamento WABA com erro; conversas iniciadas pela empresa bloqueadas.',
   'Abrir WhatsApp Manager > Pagamentos e vincular/regularizar metodo valido da WABA IBuild; envolve proprietario e potencial custo, nunca automatizar cartao.',v_payment);
 perform ibuild_agent.observe_issue('META','WABA_NOT_ACTIVE','CRITICAL',
   'Meta health_status: codigo 141008 — WABA ONBOARDING/nao ativa.',
   'Examinar Account Quality e Business Support Home. Se REJECTED, solicitar revisao/atendimento oficial com evidencias.',v_inactive);
 perform ibuild_agent.observe_issue('META','BUSINESS_VERIFICATION_REQUIRED','WARN',
   'Meta health_status: codigo 141010 — portfolio empresarial nao verificado.',
   'Abrir Security Center no Business Manager, iniciar verificacao com dados/documentos reais do proprietario.',v_verify);
 perform ibuild_agent.observe_issue('META','PHONE_NOT_ACTIVE','WARN',
   'O telefone da WABA selecionada continua PENDING, embora a verificacao do codigo esteja concluida.',
   'Conferir numero exibido no WhatsApp Manager e sua ativacao somente apos WABA liberada; nao registrar numero diferente automaticamente.',v_phone_pending);

 -- The latest signed diagnostic probe is read-only and never contains access token values.
 select r.content::jsonb into v_diag
 from net._http_response r
 where r.status_code=200 and r.created>now()-interval '40 minutes'
   and r.content like '%"selected_waba_contains_current_phone"%'
   and r.content like '%"token_issued_for_expected_app"%'
 order by r.created desc,r.id desc limit 1;
 if v_diag is not null then
   v_mismatch:=coalesce((v_diag->>'selected_waba_contains_current_phone')::boolean,false)=false
               and v_diag->>'selected_waba_phones_http_status'='200';
   v_missing_template:=(v_diag->>'selected_waba_template_count')='0';
   v_token_ok:=(v_diag->>'token_valid')='true';
   if v_diag ? 'configured_phone_status' then
     v_configured_phone_banned:=v_diag->>'configured_phone_status'='BANNED';
     perform ibuild_agent.observe_issue('META','CONFIGURED_PHONE_BANNED','CRITICAL',
       'Graph API: remetente Meta configurado (final 5006) esta BANNED. A WABA IBuild lista outro numero, final 8724, que segue PENDING.',
       'Solicitar revisao do banimento pelo Business Support Home da Meta; nao gerar token ou trocar numero para escapar da restricao.',v_configured_phone_banned);
   end if;
   perform ibuild_agent.observe_issue('META','PHONE_ID_MISMATCH','WARN',
     'IBUILD_META_PHONE_NUMBER_ID nao pertence a WABA IBuild atualmente selecionada. O id atual pode ser de um numero de TESTE diferente.',
     'Nao trocar automaticamente remetente: conferir qual dos dois numeros a Meta autorizou para envio e ajustar secret somente apos confirmacao.',v_mismatch);
   perform ibuild_agent.observe_issue('META','ORDER_TEMPLATE_NOT_CREATED','WARN',
     'WABA selecionada nao possui template de pedido aprovado; contado 0 modelos.',
     'Criar e aprovar modelo UTILITY de pedido somente apos recuperar elegibilidade da WABA.',v_missing_template);
   perform ibuild_agent.observe_issue('META','TOKEN_AUTH_INVALID','CRITICAL',
     'O token da Meta falhou autenticacao em diagnostico assinado.',
     'Verificar escopos e app correto, so regenerar quando necessario.',v_diag ? 'token_valid' and not v_token_ok);
 end if;
 -- Resume Meta engineering only after the provider has lifted the WABA restriction
 -- AND the configured phone is valid and belongs to that exact WABA. No message sent here.
 if v_response->>'health_can_send'='AVAILABLE'
    and v_response->>'waba_review_status' is distinct from 'REJECTED'
    and v_diag is not null
    and v_token_ok and not v_configured_phone_banned and not v_mismatch
    and v_diag->>'configured_phone_status' not in ('BANNED','PENDING')
 then
   update ibuild_agent.work_queue
   set state='READY',next_review_at=now(),
       diagnosis='Meta health AVAILABLE e numero configurado na WABA sem bloqueio; validar template e envio de teste unico.',
       updated_at=now()
   where dedupe_key='P0:META_RECOVERY' and state in ('WAITING_HUMAN','WAITING_EXTERNAL');
 end if;
 return jsonb_build_object('status','OK','audit_fresh',true,
   'payment_problem',v_payment,'waba_inactive',v_inactive,'business_verify',v_verify,
   'phone_pending',v_phone_pending,'phone_id_mismatch',v_mismatch,
   'template_missing',v_missing_template,'token_valid',v_token_ok,
   'configured_phone_banned',v_configured_phone_banned);
end;$$;
revoke all on function ibuild_agent.meta_remediation_triage_tick() from PUBLIC,anon,authenticated;
