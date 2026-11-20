# iBuild Materiais — entrega técnica multiloja

## Implementado no Supabase

- Tabelas `order_groups` e `order_group_orders` (pedido consolidado e subpedidos de lojas), sem alterar os pedidos históricos.
- RPC `create_multi_order_v1`: operação transacional, validação pelo checkout existente, preço oficial, locks e idempotência por solicitação e fornecedor.
- RLS de grupos para comprador e superadministrador; execução não autorizada para `anon`.
- RPCs filtradas para pedidos do cliente e pedidos encaminhados à loja, com valores de fornecedor sem campos de taxa interna.
- Bloqueio por RLS da leitura das tabelas brutas `orders` e `order_items` pelos fornecedores. Administrador e proprietário do pedido continuam com acesso legado durante a transição.
- Migrações versionadas em `supabase/migrations/`.

## Implementado no frontend

- Carregamento das ofertas de todas as lojas ativas no catálogo.
- Carrinho identificado por `offer_id` (permite produtos com SKU igual em lojas distintas), organizado visualmente por fornecedor.
- Checkout com pedido único e vários subpedidos; chave de idempotência preservada em `sessionStorage` para a mesma sessão.
- Comprovante consolidado em `/pedido/grupo/:id` e histórico sem duplicar os subpedidos.
- Relatório administrativo consolidado com totais, valores-base de referência e taxas da plataforma.
- Relatório comercial por fornecedor; distribuição exclusiva pela central administrativa, com confirmação manual.
- WhatsApp por vendedor, verificação de telefone e alternativa de copiar textos grandes.
- Leitura dos dados de clientes e fornecedores via RPCs de escopo restrito.

## Verificações realizadas

- Executado teste de criação com dois fornecedores temporários dentro de subtransação revertida: verificadas duas partes, total reconciliado e repetição idempotente.
- Executados testes de consulta RPC para comprador autorizado e ID de comprador não autorizado; dados financeiros internos não foram retornados nas RPCs filtradas.
- Permissão de execução da criação para `authenticated` confirmada, e para `anon` negada.
- GitHub Actions executou `npm run build` com TypeScript e Vite com sucesso (consulte a execução mais recente).
- A segunda loja temporária não permanece cadastrada. No banco de produção somente uma loja está ativa atualmente.

## Pendências para go-live

1. **Publicação do frontend no Cloudflare Workers:** o GitHub Actions compila, mas pulou o deploy porque `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_API_TOKEN` não estão configurados como segredos do repositório. O pipeline já possui um passo condicional para deploy com Wrangler após o build.
2. **Corte final da consulta financeira do comprador:** após confirmar a publicação da interface que usa RPCs filtradas, executar `supabase/pending/POST_DEPLOY_private_order_read_rls.sql`. Não aplicar antes: a versão anterior do site consulta `orders` diretamente.
3. **Teste visual e operacional na versão publicada:** cadastro/login, carrinho, fluxo de pedido, histórico, painel, WhatsApp e permissões com contas reais de cliente e fornecedor. Não executar envio real sem autorização.
4. **Cadastro de outras lojas reais:** há uma única loja cadastrada; o segundo fornecedor do teste foi criado e revertido para não poluir dados comerciais.
5. **Observabilidade / segurança:** o Supabase Advisory reporta observações preexistentes de funções `SECURITY DEFINER`, extensão `pg_net` no schema `public`, e proteção de senhas vazadas não ativada. Revisar conforme a política de segurança do projeto.

A integração oficial com a Meta não foi removida; envio automático de WhatsApp não faz parte desta entrega. A abertura de conversa pelo link não comprova envio.
