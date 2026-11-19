# iBuild Materiais — Integração Meta Cloud API

## Funcionamento implementado
- Pedido novo cria, na mesma transação, rota da loja, evento auditável e registro na outbox.
- Cliente recebe confirmação no site sem acesso ao WhatsApp direto do fornecedor.
- O frontend solicita despacho imediato pelo Edge Function \`ibuild-whatsapp-dispatch\` após a RPC de checkout. A outbox retém a notificação caso essa tentativa não ocorra.
- O SUPER_ADMIN pode consultar, conferir, aprovar, iniciar encaminhamento, abrir WhatsApp com relatório da loja e **confirmar manualmente** o envio.
- \`ibuild-meta-webhook\` valida HMAC SHA-256 e grava os estados da Meta.
- **Não há envio automático aos vendedores**, conforme decisão comercial.

## Segredos exigidos no Supabase → Edge Functions → Secrets
- \`IBUILD_META_ACCESS_TOKEN\`: token da conta Meta habilitada.
- \`IBUILD_META_PHONE_NUMBER_ID\`: identificador do número remetente.
- \`IBUILD_META_GRAPH_VERSION\`: versão compatível vigente, ex. \`v26.0\`.
- \`IBUILD_META_APP_SECRET\`: assinatura do webhook (não compartilhar).
- \`IBUILD_META_VERIFY_TOKEN\`: string aleatória gerada de forma privada para o webhook.
- \`IBUILD_PUBLIC_ORIGIN\`: origem do aplicativo, por padrão URL Cloudflare atual.

Não colocar segredos no GitHub nem em mensagens no chat. \`SUPABASE_URL\`, \`SUPABASE_ANON_KEY\` e \`SUPABASE_SERVICE_ROLE_KEY\` devem permanecer fornecidos de forma segura pelo Supabase.

## Primeira homologação
1. Adicionar seu número real como destinatário de teste autorizado na Meta.
2. Configurar os segredos pelo painel privado do Supabase.
3. Configurar o Webhook: \`https://pkpihrxucorfbniltdtk.supabase.co/functions/v1/ibuild-meta-webhook\`.
4. Aprovar um template contendo exatamente seis parâmetros \`{{1}}\` pedido, \`{{2}}\` comprador, \`{{3}}\` loja, \`{{4}}\` total, \`{{5}}\` quantidade, \`{{6}}\` link administrativo. Alternativamente, para o primeiro teste usar \`hello_world\` com idioma \`en_US\` quando disponível.
5. Em /admin/whatsapp, configurar destino, template e habilitar avisos.
6. Simular nova compra com dados explicitamente de homologação, sem pagamento, e verificar a resposta da API e eventos de entrega.

## Entrega confiável
- Aceito pela Meta ≠ entregue ao aparelho.
- Timeout ou falha de rede após transmitir gera \`RESULTADO_INCERTO\`, sem retry automático para reduzir duplicação.
- Erros HTTP 429/5xx podem ser reprocessados conforme próximo prazo; erros permanentes requerem intervenção.
- O checkout solicita envio imediato. **Um processamento agendado de recuperação pelo Supabase Cron ainda deve ser ativado com credenciais de invocação guardadas no Vault**, depois de confirmar a infraestrutura Meta. Sem Cron, notificações pendentes por falha na invocação do navegador são recuperadas pelo botão administrativo.
- Nenhum pedido cancelado de teste é enfileirado automaticamente.
- Mensagens enviadas manualmente no WhatsApp pessoal não são rastreadas pela Meta; confirmação é responsabilidade do operador.

## Aplicação das migrações
Execute os scripts em ordem:
1. \`20261119030000_ibuild_intermediacao.sql\` — adiciona tabelas, triggers e RPC.
2. \`20261119031000_ibuild_catalog_public_view.sql\` — view segura de catálogo.
3. Publicar frontend compatível.
4. \`20261119032000_ibuild_store_gate.sql\` — apenas depois do frontend em produção; revoga acesso público ao contato do fornecedor e restringe acesso da loja a pedidos encaminhados.

## Controles existentes
- Serviço \`ibuild-whatsapp-dispatch\` exige JWT de cliente com pedido próprio ou usuário SUPER_ADMIN.
- Serviço \`ibuild-meta-webhook\` não exige JWT, mas verifica assinatura Meta obrigatoriamente.
- Os segredos ficam fora do frontend.
- A taxa de 1% continua no servidor e não é adicionada novamente.
