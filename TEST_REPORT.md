# Relatório de testes — R4

## Executados
- Base original auditada e reaproveitada.
- Supabase real com 1 loja, 8 categorias, 140 produtos e 140 ofertas.
- Security Advisor do Supabase sem alertas após endurecimento do checkout.
- Código sem senha de banco, service_role ou segredo administrativo.
- Convenção de imagens por SKU preparada.

## Ainda pendentes
- build remoto completo;
- cadastro/login/confirmar e-mail no domínio publicado;
- teste de RLS com contas reais CLIENTE, STORE_ADMIN e SUPER_ADMIN;
- teste ponta a ponta de pedido e WhatsApp;
- publicação Cloudflare Pages;
- validação mobile final.
