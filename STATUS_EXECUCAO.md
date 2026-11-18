# Status de execução — R4 multi-loja

## Concluído no Supabase real
- Projeto `central-de-materiais` ativo.
- Modelo multi-loja criado com RLS.
- Casa do MDF cadastrada como primeira loja e loja principal.
- 8 categorias importadas.
- 140 produtos globais importados.
- 140 ofertas/preços cadastrados para Casa do MDF.
- Checkout seguro por RPC com revalidação de preço, idempotência e snapshots.
- Função privilegiada isolada em schema privado; endpoint público usa wrapper SECURITY INVOKER.
- Supabase Security Advisor: 0 alertas.

## Concluído no frontend
- Catálogo combina `products + store_offers`.
- Casa do MDF aparece como loja/preço principal.
- Carrinho envia `offer_id`, `store_id` e `expected_price`.
- Painel distingue `SUPER_ADMIN` e `STORE_ADMIN`.
- Produtos/preços e configurações são editáveis por loja.
- Build Vite/TypeScript validado no Cloudflare em 18/11/2026.

## Cloudflare
- Variáveis públicas de build do Supabase configuradas pelo proprietário.
- Arquivo `_redirects` incompatível com o modo Workers removido.
- Novo deploy disparado por commit em `main`.

## Pendente
- Confirmar implantação pública concluída.
- Configurar redirects de autenticação para o domínio publicado.
- Criar/vincular a conta STORE_ADMIN da Casa do MDF.
- Adicionar imagens M001.webp…M140.webp em etapa posterior.
