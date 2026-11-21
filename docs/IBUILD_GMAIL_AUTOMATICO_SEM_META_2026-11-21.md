# iBuild — envio automático de relatórios por Gmail sem Meta

Atualizado em 21/11/2026. Instruções operacionais para os dois canais que compartilham uma única fila idempotente por pedido consolidado.

## Evidências já verificadas

- O conector Gmail da conta Google do proprietário é o mesmo e-mail confirmado do único SUPER_ADMIN ativo no Supabase.
- Um e-mail real de diagnóstico foi enviado à própria caixa Gmail do proprietário; mensagem Gmail ID `1a1ffa1a3fcb94b6` com etiquetas `INBOX` e `SENT` e anexo PDF `IBUILD_TESTE_EMAIL_PDF_2026-11-21.pdf`. **Isso não prova entrega automática de pedidos.**
- Banco contém `ibuild_gmail_outbox` (uma única linha por `group_id`), gatilho de inserção em `order_group_orders` e cron de manutenção a cada 5 minutos.
- `ibuild_gmail_bridge_config.enabled=true`. Nenhum grupo novo estava pendente em 21/11/2026 às 16h40 aproximadamente. Pedidos anteriores ao início da fila não são elegíveis.

## Canal A — Google Apps Script (primário, 5 minutos)

- Em `integrations/google-apps-script/Code.gs` ficam `instalar`, `verificarConexao` e `processarPedidos`.
- O pacote privado do proprietário já contém `Code_PRIVADO_PRONTO.gs`, com token privado inserido localmente. Nunca colocar esse código final com token no GitHub.
- Instalador Nexus para Windows usa Playwriter conectado ao **Chrome existente**: `CONFIGURAR_GMAIL_PELO_NEXUS.bat`, fornecido em pacote privado separado.
- **Ainda falta a autorização Google OAuth pelo titular**: sem ela não existe acionador Apps Script operacional. Não confundir preparação de código, conexão do Nexus ou `GMAIL_OK` com entrega de um pedido de ponta a ponta.

## Canal B — ChatGPT + Gmail conectado (contingência, 1 hora)

- Foi criada automação `iBuild: pedidos no Gmail` id `6b01f53a7c50819182b992ab3fd7eaae`, agenda horária, fuso `America/Sao_Paulo`.
- Usa o Gmail conectado ao ChatGPT, **sem OAuth Apps Script adicional**, apenas se o e-mail da conexão coincidir exatamente com o SUPER_ADMIN confirmado.
- O banco disponibiliza `ibuild_agent.claim_gmail_connector_fallback_v1()` e `ibuild_agent.finish_gmail_connector_fallback_v1(uuid,uuid,text,text,boolean)`. Ambas possuem EXECUTE revogado para `anon`, `authenticated` e `service_role`; o ChatGPT chama via conector Supabase do proprietário. 
- O `claim` examina somente grupos PENDING novos e elegíveis, com pedidos completos, não cancelados, até 12 fornecedores, com itens reais; retorna dados de relatório e marca como CLAIMED atomicamente. A automação gera PDFs individuais, envia **um** Gmail ao próprio proprietário e confirma ACCEPTED apenas depois do retorno da API Gmail.
- O `finish` restringe transições a ACCEPTED, FAILED (antes da tentativa de envio) ou UNKNOWN. Resultado incerto nunca reenviado. Se a automação cair depois de CLAIMED, cron existente move para UNKNOWN após 12 minutos e exige revisão, evitando duplicidades.
- Ambos os canais consomem **a mesma fila**: um `CLAIMED` impede o outro de enviar o mesmo pedido.
- Limitação: automações do ChatGPT não têm cadência de 5 minutos; o máximo é execução **uma vez por hora**, sujeito à disponibilidade da ferramenta e à conectividade do Gmail. O processamento de um pedido real por essa automação ainda **não foi demonstrado**.
- Um acionamento manual inicial encontrou `EMPTY_OR_NOT_READY`, não enviou pedidos antigos e não gerou emails comerciais.

## Aceite final pendente

Criar **um novo pedido de TESTE autenticado sem cobrança**, verificar registro de grupo e subpedidos, a entrada em `ibuild_gmail_outbox`, um PDF individual por fornecedor, status ACCEPTED no canal escolhido e a presença do email com anexos na caixa do proprietário. Não repetir tentativa em UNKNOWN e não disparar mensagem a terceiros.
