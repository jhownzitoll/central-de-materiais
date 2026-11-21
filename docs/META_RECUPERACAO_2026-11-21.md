# iBuild — Meta WhatsApp Cloud API: diagnóstico e recuperação verificáveis

Última confirmação real: **21/11/2026 às 03h21 BRT** (Graph API v26, consultas com assinatura HMAC pelo Supabase). Projeto Supabase: `pkpihrxucorfbniltdtk`. Não usar Work. Este documento não substitui aprovação da Meta.

## Resultado operacional

O erro atual é **restrição da conta/número Meta**, não simplesmente autenticação OAuth. Não reexecutar `hello_world` antes de regularizar a conta. Não trocar um número BANNED por outro para burlar restrições.

| Componente | Verificado via API |
|---|---|
| Token do sistema | válido, debug_token HTTP 200, escopos `whatsapp_business_messaging` e `whatsapp_business_management` |
| App de origem | `1118878157422771` — **iBuild Materiais**, app secret correspondente e app auth HTTP 200 |
| Número *configurado para envio* | Meta test sender com final **5006**; status `BANNED`, código de verificação `VERIFIED`. ID do projeto legado: `1430165213516684` |
| WABA do portfólio iBuild | `3030795093945086`; `status=ONBOARDING`, `account_review_status=REJECTED`, `health.can_send_message=BLOCKED` |
| Outro número listado nessa WABA | ID `1427333740468343`, final **8724**, `status=PENDING`, `code_verification_status=VERIFIED` |
| Business Portfolio | `1137445162104025`; `business_verification_status=pending_submission` |
| App no health_status | `AVAILABLE` (não é bloqueio do aplicativo) |
| Templates no WABA auditado | zero — inclusive `ibuild_novo_pedido` |
| Últimos envios históricos | HTTP 401 / código 190 (tentativa antiga); duas tentativas HTTP 400 / código 100; nenhuma entrega provada |
| Fila automática Meta | `ibuild_notification_config.enabled=false`; dois eventos antigos `CANCELADA`; não reenviar |

## Erros do `health_status`, confirmados na resposta da Meta

- **141006** — problema com forma de pagamento da WABA. O retorno oficial orienta adicionar/regularizar um método válido na própria conta WhatsApp.
- **141008** — WABA não ativa. O retorno orienta acionar suporte WhatsApp para ativar, sujeito ao resultado de revisão.
- **141010** — empresa não passou pela verificação. O retorno orienta abrir configurações empresariais e concluir a verificação.
- Não houve erro de saúde para a entidade **APP**. O token funcionou em requisições GET com HTTP 200.

## Passos que exigem a sessão Meta do responsável

1. Abrir o [Business Support Home / Qualidade da conta](https://business.facebook.com/accountquality/), selecionar o portfólio `1137445162104025` e a WABA `3030795093945086`; examinar o motivo da revisão **REJECTED** e a disponibilidade de **Solicitar revisão** / contato com suporte. **Somente a Meta** pode reverter a restrição da conta/número.
2. Abrir [WhatsApp Manager](https://business.facebook.com/wa/manage/home/) e [Faturamento e pagamentos](https://business.facebook.com/billing_hub). Conferir, no contexto dessa WABA, o erro 141006. Informações de cartão, cobranças e eventual aceite de custos são decisões do dono: **nenhum agente cadastra cartão ou paga automaticamente**.
3. Abrir [Meta Business Settings](https://business.facebook.com/settings/) > Central de segurança / Verificação da empresa, escolher portfólio correto e seguir as etapas oficiais com documentos verdadeiros. Não inventar CNPJ ou dados comerciais.
4. Conferir no WhatsApp Manager a situação exata dos dois remetentes de teste (**5006** BANNED e **8724** PENDING). Não substituir `IBUILD_META_PHONE_NUMBER_ID` até definir remetente **autorizado** e confirmar que pertence à WABA/aplicativo corretos. Se o banimento foi engano, pedir revisão pelo processo oficial.
5. Quando a Meta liberar a WABA (saúde `AVAILABLE`), alinhar os IDs de aplicativo/WABA/telefone e confirmar `status` ativo, `templates`, app subscription e webhook. Se o template de pedido não existir, criar o `UTILITY` com exemplo fictício e aguardar aprovação.
6. Fazer **uma** tentativa nova controlada para o telefone do proprietário (terminação 2476), com chave de idempotência própria e sem cobranças nem terceiros. Confirmar primeiro aceitação da Graph API e depois evento de entrega `delivered`/recebimento efetivo no WhatsApp. Nunca reaproveitar tentativas com resultado incerto.

## Correções técnicas já aplicadas

- Edge `ibuild-integration-diagnostics` versão **10**: usa o APP ID real `1118878157422771` e valida corretamente token/app secret com o Graph `debug_token`; reporta o status do remetente configurado sem vazar token.
- Função privada `ibuild_agent.meta_remediation_triage_tick()` + cron `ibuild_meta_remediation_triage_v1` a cada 10 minutos: persiste erros 141006/141008/141010, ausência de template, diferença de phone ID, número BANIDO e status PENDING.
- `ibuild_nexus_supervisor_v1` consulta a Meta por Edge `ibuild-waba-recovery-audit` aproximadamente a cada 15 minutos, sem fazer alterações externas.
- Fila `ibuild_agent.work_queue` e automação existente **Supervisão Nexus iBuild** recebem prioridades e bloqueios. A automação é ChatGPT normal, não Work, mas não executa continuamente entre os disparos.

## Critério de retomada automática

O supervisor pode detectar a mudança de `health_can_send=BLOCKED` para `AVAILABLE` e atualizar incidentes. Isso NÃO autoriza automaticamente disparos de mensagens de resultado incerto nem reenvios de teste. A retomada da Cloud API exige verificação de número, webhook/template e um teste idempotente autorizado, com prova da entrega final.

## Fontes externas oficiais

- Meta Graph API: https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account
- Meta Graph API error 190: https://developers.facebook.com/docs/graph-api/guides/error-handling
- Meta Account Quality: https://business.facebook.com/accountquality/
