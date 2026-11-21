# Nexus iBuild Autopilot v3 — Chrome existente, supervisor 24h

Última revisão: 21/11/2026. Projeto Supabase `pkpihrxucorfbniltdtk`. **Proibido Work.** Este documento não comprova instalação no PC.

## Objetivo e ciclo de operação

O companion local de Windows (`nexus-autopilot/watch.mjs`) conecta pelo Playwriter ao **Chrome já autenticado**. Não inicia Chromium, não copia cookies e não utiliza o Chrome do usuário para digitar em abas pessoais. O servidor agenda `ibuild_chat_supervisor_2min_v1` a cada 2 min e verifica amostras `IDLE` coerentes, com 90 segundos de intervalo, após confirmar autenticação, editor vazio, mesma URL/resposta e inexistência de `BUSY` intermediário.

Somente o cliente v3 envia `note=playwriter-existing-chrome-v3`. O estado `CLIENT_UPGRADE_REQUIRED` significa que **o processo v2 ainda está rodando** e não é uma falha de credenciais. Atualize usando o ZIP privado `Nexus_iBuild_Autopilot_Chrome_24h_v3_ATUALIZAR.zip` entregue na conversa, com `INSTALAR_NEXUS_AUTOPILOT.bat`. Nunca publicar o ZIP, pois contém token privado. O servidor não possui acesso para executar o instalador Windows remotamente.

## Corrigido em v3

- Cliente aguarda até **75 s** por um novo elemento `[data-message-author-role=user]` com conteúdo correspondente ao prompt, em vez do limite anterior de 2,4 s. Um clique isolado ou mudança de URL não prova envio.
- Interação de envio acontece **uma vez**; se a confirmação falhar, `UNKNOWN` e nenhuma repetição automática. O modelo nunca registra `DONE` antes de comprovar tarefa no banco.
- `.session-id` local persiste entre reinícios do watchdog e preserva a sessão vinculada a um comando `PREPARED`.
- Instalação usa Node 24 existente, para e substitui **somente** os processos `watch.mjs` e `supervise-windows.ps1` associados ao Nexus, sem encerrar o Chrome, verifica pacote, 14 testes locais e conexão autenticada do broker.
- A fila respeita `ibuild_agent.claim_specific_work(p_worker text)`. O worker incorpora o UUID da tarefa, impedindo que o ChatGPT reivindique tarefa diferente daquela preparada. `anon` e `authenticated` sem permissão.
- O supervisor pode sair de um `UNKNOWN` antigo após 15 min de segurança e inatividade comprovada, mas nunca reinsere/reexecuta **aquele mesmo trabalho**. A tarefa original `P0:TEST_ORDER` com envio incerto foi isolada como `NEEDS_REVIEW`.

## Ordem de prioridades

1. `P0:CHROME_SEND_CONFIRMATION` (100): uma conversa nova no ChatGPT normal, despacho único confirmado na interface, reivindicação do trabalho certo, execução e `ibuild_agent.finish_work` com evidência.
2. Após confirmação `DONE`, retomar a fila P0 de pedidos sem cobrança, PDFs privados por loja, e notificação recebida.
3. Meta: token válido, porém WABA rejeitada/sem capacidade de envio, remetente BANNED. **Não** contornar bloqueio nem reenviar históricos.

## Verificações no Supabase (sem escrita externa)

```sql
select ibuild_agent.chat_supervisor_2min_tick();
select observed_at,state,note,authenticated,composer_ready,composer_empty
from public.ibuild_chat_monitor_signals order by observed_at desc limit 6;
select id,created_at,state,chat_url,error from public.ibuild_chat_dispatches order by created_at desc limit 6;
select dedupe_key,state,attempt_count,last_result from ibuild_agent.work_queue
where dedupe_key in ('P0:CHROME_SEND_CONFIRMATION','P0:TEST_ORDER');
select jobname,schedule,active from cron.job where jobname='ibuild_chat_supervisor_2min_v1';
```

**Aceite técnico para 'Nexus funcionando':** sinal recente do cliente v3, comando `SENT` e comprovante da nova mensagem no Chrome, seguido de um `claim_specific_work` `CLAIMED` e `finish_work` `RECORDED`. Sem esse ciclo, classificação é `DEPLOYED / WAITING_LOCAL_INSTALL`, jamais '24h comprovado'.

O computador precisa permanecer ligado, com internet, sessão Windows iniciada e Playwriter verde. Limites do ChatGPT, login, CAPTCHA e indisponibilidade do serviço podem interromper o navegador; o watchdog só reinicia o processo local, não força o ChatGPT a responder.
