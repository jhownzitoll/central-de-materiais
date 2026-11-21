# iBuild — Supervisor Nexus (v1, 21/11/2026)

## Missão e limites
Supervisionar, independentemente do chat, a integridade do Nexus PC, a fila `public.nexus_jobs_v1`, o agendador de pedidos e a WABA IBuild. Não utilizar o modo Work. Proteger contra tentativas de envio duplicado, alterações em dados reais e bloqueios da Meta.

**Duas camadas já ativadas:**
1. Supabase `pg_cron`, função privada `ibuild_agent.nexus_supervisor_tick()` em `ibuild_nexus_supervisor_v1`, a cada 2 minutos. Outro agendamento `ibuild_agent_watchdog_v1` registra ausência de progresso do agente.
2. Automação do ChatGPT **Supervisão Nexus iBuild**, uma avaliação por hora em 10 ocorrências, com acesso aos conectores que o ambiente da automação efetivamente disponibilizar. Nem o monitor SQL nem a automação garantem que um processo local possa ser reiniciado.

## Verificações e ações autônomas testadas
- Nexus device `175c11dc-055c-44ec-b7ec-06495a0b17c9`: online/offline por heartbeat, fila em andamento, falhas repetidas.
- Prova `LOCAL_SMOKE_TEST`: teste enfileirado pelo próprio supervisor e confirmado como `SUCCEEDED / NEXUS_OK`.
- Marcação como `FAILED` apenas de jobs **PENDING**, expirados e **nunca assumidos** (`claimed_at is null`), sem reexecutar seus efeitos.
- Detecção de RUNNING prolongado, que é **resultado incerto** e nunca deve ser repetido automaticamente.
- Verificação automática somente leitura via função `ibuild-waba-recovery-audit` com assinatura privada no servidor; monitoramento dos estados `BLOCKED`, `REJECTED` e `pending_submission`.
- Verificação de crons de despacho/recuperação, modo de notificações e estados de falha na outbox.
- Persistência de incidentes em `ibuild_agent.supervisor_issues` e histórico em `ibuild_agent.supervisor_events`.

## Consultas operacionais (Supabase SQL Editor)
```sql
select * from ibuild_agent.supervisor_state where id=1;
select component,code,severity,state,message,proposed_fix,last_seen_at
from ibuild_agent.supervisor_issues where state='OPEN'
order by last_seen_at desc;
select happened_at,component,action,result,details
from ibuild_agent.supervisor_events order by happened_at desc limit 30;
select id,status,phase,checkpoint,next_action,blocker,heartbeat_at
from ibuild_agent.runs order by created_at desc limit 5;
select jobname,schedule,active from cron.job where jobname like 'ibuild_%';
```

## Resolução segura de incidentes
- `NEXUS.DEVICE_OFFLINE`: detectar e aguardar recuperação local. A fila do Supabase não reinicia o Windows/CMD por si mesma. O dispositivo precisa ter um serviço independente de reinicialização instalado no PC para recuperação remota total. Nunca reiniciar processos indiscriminadamente.
- `NEXUS.STUCK_RUNNING_JOB`: resultado desconhecido; não duplicar ação, não forçar novo clique ou envio. Inspecionar logs/captura local e reiniciar o runner apenas depois de ter certeza de que a operação não está em andamento.
- `NEXUS.RECENT_FAILURE_BURST`: alternar localizadores e estratégia; máximo 2 falhas equivalentes.
- `META.WABA_BLOCKED` e `META.WABA_REVIEW_REJECTED`: recuperação oficial; não contornar por criação de contas. Em paralelo usar e-mail transacional autorizado para entregar pedidos, se já configurado e testado.
- `IBUILD.META_DISPATCH_DISABLED`: não ligar até o canal de produção estar validado.
- `AGENT.NO_CHECKPOINT`: verifique se a conversa de execução está realmente ociosa antes de mandar uma mensagem de retomada. Não interpretar só ausência de heartbeat como travamento.
- `IBUILD.NOTIFICATION_REQUIRES_REVIEW`: não reenviar quando o resultado do provedor for incerto. Confirmar evento de entrega/erro primeiro.

## Recuperação automática de conversa — situação honesta
O servidor está configurado com `chat_resume_enabled=true`, mas isso **não prova que o navegador esteja online**. O novo supervisor `ibuild_chat_supervisor_2min_v1` somente prepara prompts depois de duas observações IDLE estáveis vindas do Nexus Autopilot Windows; a Edge Function `ibuild-nexus-autopilot` entrega cada prompt uma única vez à mesma sessão autenticada. Um envio duvidoso vira UNKNOWN sem repetição. O programa Windows precisa ser instalado e autenticado na máquina; o Runner antigo permanece independente e seu último heartbeat pode continuar offline. A automação ChatGPT normal via conectores é horária e não deve ser confundida com o ciclo de observação de 2 minutos.

## Objetivo do agente e fases
- P0: comprovar pedido real de teste SEM cobrança, PDF individual por loja, notificação recebida ao proprietário, link/arquivo disponível, logs de recebimento.
- P1: acabamento, publicação, segurança, testes E2E e canal alternativo funcional.
- P2: catálogo Casa do MDF somente após evidências de P0; preservar 140 produtos/ofertas preexistentes.
- Executor: https://chatgpt.com/c/6b012364-b5a4-83e9-a514-a93ae4ffd489
- Repo: `jhownzitoll/central-de-materiais`, Supabase: `pkpihrxucorfbniltdtk`.

## Infraestrutura de referência
Migração aplicada: `supabase/migrations/20261121052000_ibuild_nexus_supervisor_v1.sql`. Controles e tabelas estão no schema privado `ibuild_agent`, com RLS e sem permissões para `anon` ou `authenticated`. Não salvar tokens Meta, service_role, credenciais Nexus ou dados privados em relatórios.
