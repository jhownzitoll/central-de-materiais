# iBuild — Operação do agente noturno, ChatGPT normal

Data inicial: 21/11/2026. Fonte de verdade: projeto Supabase `pkpihrxucorfbniltdtk` e repositório `jhownzitoll/central-de-materiais`.

## Meta e critérios de aceite

**P0** permanece `PARTIAL/WAITING_EXTERNAL` até que um pedido **novo de teste, sem cobrança**, confirme: preços calculados no backend; um PDF privado por loja; notificação recebida na caixa do proprietário (Gmail ou WhatsApp comprovado). Um HTTP 200 do provedor, um link `wa.me`, ou apenas gerar PDF não prova entrega.

Não avançar para o catálogo da Casa do MDF sem concluir P0. Não duplicar 140 produtos já existentes. Não enviar mensagens a terceiros, não criar pedidos pagos, não repetir envios de resultado incerto, não contornar a Meta.

## Camadas realmente implementadas

1. **Supervisor determinístico (Supabase pg_cron):** `ibuild_nexus_supervisor_v1` observa Nexus, incidentes Meta e cron essenciais. `ibuild_night_work_queue_v1` alimenta a fila a cada 2 minutos. `ibuild_chat_supervisor_2min_v1` verifica **duas amostras reais de inatividade visual** no ChatGPT separadas por pelo menos 90 s; prepara uma tarefa, mas não a envia sem um executor local autenticado. O cron antigo `ibuild_night_chat_handoff_v1` foi desagendado para não gerar comandos duplicados. O cron `ibuild_chat_supervisor_2min_v1` permanece ativo e exige cliente Chrome v3. Essas rotinas NÃO são um modelo generativo e NÃO ligam um PC desligado.
2. **Executor cognitivo (automação ChatGPT NORMAL):** automação existente `6b0126701d908191b4c2028240dc5d17`, iterações horárias recorrentes (sem término pré-definido) a partir de 03h04 de 21/11, fuso São Paulo. Essa automação usa conectores e não exige Nexus, mas seu disparo é no máximo horário; o ciclo de observação visual de 2 minutos só funciona depois da instalação do companheiro Windows. Cada disparo deve chamar conectores reais, assumir UMA tarefa da fila, executar e registrar o resultado. Sem Work. Fora dos disparos, não há modelo pensando continuamente.
3. **Executor navegador original (Nexus v0.3):** device `175c11dc-055c-44ec-b7ec-06495a0b17c9`. Só disponível quando `last_seen_at >= now()-3 min`. O Supabase não possui shell para iniciar/reiniciar o processo no Windows. Se offline, registrar bloqueio, nunca declarar chat aberto.
4. **Nexus Autopilot Windows complementar (NOVO, instalação local pendente):** código em `nexus-autopilot/`, interface Edge Function `ibuild-nexus-autopilot`, autenticação por segredo local + hash privado em `public.ibuild_nexus_autopilot_keys`, sinais em `public.ibuild_chat_monitor_signals`, despachos em `public.ibuild_chat_dispatches`. O servidor continua verificando a cada 2 minutos mesmo sem o navegador; **nenhum prompt é enviado** enquanto não houver instalação, login e duas leituras estáveis (IDLE, autenticado, editor vazio, mesma conversa/resposta, sem BUSY intermediário). Ao confirmar duas amostras, prepara UM comando ligado à sessão; o executador local o reivindica uma única vez, abre um **novo ChatGPT normal** e confirma por mensagem do usuário na UI. Após HTTP/GUI incerto, estado UNKNOWN e sem repetição. Antes de emitir outra tarefa, exige que a anterior tenha um checkpoint real na fila. Limite: 24 comandos/dia, cooldown de 12 min, além dos limites do plano ChatGPT. O monitor não liga um PC desligado nem contorna login/CAPTCHA. Auto-restart via inicialização do Windows **somente após a instalação local**, com sessão de usuário aberta.
5. **Backend de pedidos:** Supabase Edge Functions `ibuild-order-document-init`, `ibuild-order-pdf`, `ibuild-owner-email-dispatch`, `ibuild-order-doc-link`. O cron `ibuild_owner_email_rescue_v1` verifica grupos recentes e processa PDFs + eventual notificação exclusivamente ao proprietário. Somente novos pedidos posteriores ao corte explícito. Outbox isolada para e-mail, idempotência, nenhuma repetição automática de estado incerto.

## Prioridade de recuperação atual — Nexus v3

**Desde 21/11/2026:** antes de qualquer trabalho Meta ou catálogo, validar o Nexus Autopilot Chrome **v3** pelo procedimento em [NEXUS_AUTOPILOT_V3_2026-11-21.md](./NEXUS_AUTOPILOT_V3_2026-11-21.md). O instalador privado foi disponibilizado na conversa; sua instalação no PC não pode ser executada pelo Supabase. `CLIENT_UPGRADE_REQUIRED` confirma cliente v2 ainda em execução. A fila `P0:CHROME_SEND_CONFIRMATION` tem prioridade 100; o envio antigo `UNKNOWN` de pedido de teste está isolado como `NEEDS_REVIEW` e jamais será reenviado automaticamente. A operação do novo cliente só é considerada comprovada com `SENT` + `claim_specific_work` + `finish_work` registrados.

## Fila persistente e protocolo de recuperação

Tabelas privadas (RLS ativo, sem acesso anônimo): `ibuild_agent.work_queue`, `ibuild_agent.work_log`, `ibuild_agent.chat_handoffs`. Fonte do executor: `public.ibuild_agent_checkpoints_v1`. Ocorrências: `ibuild_agent.supervisor_issues` e `ibuild_agent.supervisor_events`.

Antes de trabalhar, executar com conector Supabase:

```sql
select ibuild_agent.work_queue_tick();
select ibuild_agent.claim_work('chatgpt-normal-<identificador-unico-deste-turno>');
```

Se `CLAIMED`, só o dono desse lease pode atuar na tarefa. Se `WORKER_BUSY`, não executar escrita concorrente. Lease 25 min, expiração passa a `NEEDS_REVIEW`, sem replay. Após tentar diagnosticar/corrigir, sempre persistir:

```sql
select ibuild_agent.finish_work(
  '<uuid-da-tarefa>'::uuid, '<mesmo-identificador>',
  'READY', 'resultado objetivo, testes e próximo passo',
  '{"commit":"SHA","tests":"passed/failed","delivery_received":false}'::jsonb
);
```

Estados finais válidos: `READY`, `WAITING_EXTERNAL`, `WAITING_NEXUS`, `WAITING_HUMAN`, `NEEDS_REVIEW`, `DONE`. `DONE` **não significa** P0 concluído: só alterar gate principal após prova E2E. Sem credenciais, registrar `WAITING_EXTERNAL`, não gerar token improvisado.

## Novas conversas no ChatGPT normal

`chat_resume_enabled=true` autoriza o monitor, **não comprova navegador funcional nem envio de prompt**. O protocolo antigo `ibuild_agent.chat_handoffs` foi preservado como histórico, mas o cron automático antigo foi desativado. O fluxo novo consulta `public.ibuild_chat_monitor_signals` e `public.ibuild_chat_dispatches`, exige duas observações estáveis da MESMA sessão e confirmação de checkpoint da tarefa anterior antes de liberar a próxima. O programa local somente poderá executar após instalação no Windows e login do proprietário. Nenhum script remoto é autorizado a contornar CAPTCHA/MFA, assumir pedidos reais, gerar cobrança ou repetir efeitos incertos. Se o dispositivo estiver offline, monitorar e registrar bloqueio enquanto a automação horária continua tarefas via conectores.

## Estado externo bloqueado no último teste

- **Meta:** WABA bloqueada, revisão rejeitada e verificação empresarial pendente. Despacho automático Meta permanece desativado.
- **E-mail:** destinatário identificado e confirmado pela única conta `SUPER_ADMIN` ativa; `IBUILD_RESEND_API_KEY` e `IBUILD_EMAIL_FROM` ausentes na Edge Function. Mesmo após configurar, provar chegada ao Gmail; aceite da API não equivale a entrega.
- **Nexus:** último heartbeat observado às 05:02:52 UTC de 21/11. Precisa de processo local ativo; instalação de inicialização automática não foi comprovada.
- **P0:** 3 pedidos históricos, 2 grupos, 1 PDF histórico e 0 e-mails em outbox no fechamento anterior; não reprocessar pedidos históricos.

## Verificações em cada iteração

1. Estado do projeto Supabase e dos crons; ordem e razão das falhas.
2. Se Nexus offline, não enfileirar navegação e trabalhar via GitHub/Supabase.
3. Se API de envio não configurada, procurar apenas alternativas lícitas e autorizadas, sem criar conta externa fictícia nem expor chave.
4. Antes de editar GitHub, conferir HEAD e SHA do arquivo; limitar alterações; executar CI build e `npm test`.
5. `npm test` valida apenas rejeição de endpoints não autenticados, assinatura cron inválida e disponibilidade do site, **não** valida pedidos ou entregas.
6. Após duas falhas iguais, trocar estratégia e registrar diagnóstico.
7. Registrar evidência no checkpoint e na fila com exatidão; não afirmar execução autônoma contínua fora das tarefas programadas.

## Sobre custos, identidade e limites

Não criar assinaturas, pagar por provedores ou usar OpenAI API sem autorização e credenciais próprias. O ChatGPT normal via automação agendada é independente de Work, mas seu disparo não equivale a um processo de IA ativo 24/7 e pode ser afetado por limites da plataforma. A fila e os crons do Supabase continuam rodando sem depender de uma conversa aberta.
