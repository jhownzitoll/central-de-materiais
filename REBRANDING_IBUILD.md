# Rebranding iBuild Materiais

Nome comercial visível ao cliente: **iBuild Materiais**.
Nome institucional: **iBuild**. Identificador para novas configurações: `ibuild`.

## Compatibilidade

- O Worker Cloudflare e a URL atual conservam o identificador `central-de-materiais` para preservar deploy e retornos OAuth. Alterar somente mediante migração de domínio e configuração de redirecionamento.
- A chave de carrinho `central-materiais-cart:v3` e a chave de confirmação `central-materiais:pending-email` continuam legíveis; renomeá-las sem migração perderia o estado dos usuários.
- Números históricos `CM-*`, snapshots e contas permanecem intocados.
- O e-mail de notificação e os templates ativos no Supabase requerem atualização externa; editar o arquivo de template no GitHub não atualiza automaticamente o painel do Supabase.
- A integração da Cloud API WhatsApp fica fora desta etapa.
- Atualizar o nome do site no `public.platform_config.site_name` após validar o deploy.

## Testes

Abrir PR para disparar workflow `Build` (Node 22, npm install, npm run build) antes do merge.
