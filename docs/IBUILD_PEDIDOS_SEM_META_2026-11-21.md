# iBuild — recebimento de pedidos sem Meta

**Situação:** primeira etapa implantada em 21/11/2026. Não depende de WhatsApp ou e-mail para capturar pedidos.

## Fluxo

1. Cliente autenticado envia pedido por `public.create_multi_order_v1` (preço calculado no servidor; sem cobrança automática).
2. Cada subpedido é registrado na tabela `public.orders`.
3. Trigger `ibuild_orders_admin_inbox_v1` cria uma linha única por `order_id` em `public.ibuild_admin_order_alerts`. **Nenhum envio comercial para fornecedores**.
4. O proprietário autenticado como SUPER_ADMIN entra em `/admin/avisos` e vê pedidos novos; o aviso pode ser marcado como conferido via RPC `public.ibuild_acknowledge_order_alert`.
5. O site consulta novas notificações a cada ~20–25 segundos. Botão de avisos Chrome exige permissão do navegador, só funciona enquanto a página existir e o Chrome permitir tarefas em segundo plano; não é push nativo de servidor para celular.
6. O cron `ibuild_admin_inbox_reconcile_v1` reconcilia a cada 5 minutos somente pedidos novos após o corte `2026-11-21T17:40:00Z`. Não reenviar eventos antigos nem criar pedidos de teste automaticamente.
7. Para PDFs individuais usar a central `/admin/pedidos` e funções existentes `ibuild-order-pdf` e `ibuild-order-doc-link`. PDF no banco não prova que o proprietário recebeu e-mail.

## Controles

- RLS habilitado. `anon` não consulta a caixa; `authenticated` consulta exclusivamente se o usuário é SUPER_ADMIN confirmado e ativo.
- Nenhum usuário comum pode atualizar notificações; marcar conferido exige RPC com verificação explícita de SUPER_ADMIN.
- Não inserir e-mails de destinatários, números ou credenciais em tabela de alertas.
- Condição de idempotência `order_id PRIMARY KEY`; múltiplos fornecedores recebem uma linha por subpedido.
- Falha momentânea de alertas não cancela a compra; reconciliação recupera os avisos novos sem disparar mensagens.

## Limitações e próximo canal

Esse canal comprova **registro interno**, não entrega em Gmail ou WhatsApp. Para obter alertas remotos gratuitos sem Meta existem duas opções:

- **Google Apps Script + MailApp**: usa a conta Google do proprietário, sem domínio próprio; depende de autorização Google inicial e das cotas de envio. Requer uma ponte autenticada, com segredo privado e recibo idempotente, ANTES de colocar o e-mail em produção. Não copiar chave `service_role` para Apps Script.
- **Resend**: `ibuild-owner-email-dispatch` já implementado; ainda exige `IBUILD_RESEND_API_KEY`, `IBUILD_EMAIL_FROM` e remetente verificado. Não anunciar e-mail entregue antes de verificar inbox. Plano gratuito documentado em https://resend.com/pricing .

## Verificação da etapa

- `select count(*) from public.ibuild_admin_order_alerts;`
- `select jobname,active,schedule from cron.job where jobname='ibuild_admin_inbox_reconcile_v1';`
- `select ibuild_agent.reconcile_owner_inbox_v1();`
- Página publicada: `https://central-de-materiais.jonathan20014-jsdo.workers.dev/admin/avisos`.

**Aceite completo P0 ainda não comprovado:** uma nova compra de TESTE autenticada sem cobrança, PDFs por loja e evidência efetiva de recebimento externo continuam pendentes. Não alterar o estado P0 para PASS somente porque a caixa interna funciona.
