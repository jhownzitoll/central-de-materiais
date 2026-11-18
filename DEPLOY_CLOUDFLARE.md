# Deploy no Cloudflare Pages

## Pré-requisitos

- código em um repositório GitHub;
- projeto Supabase configurado;
- build `npm run build` aprovado.

## Pages

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → conectar GitHub.
2. Escolha o repositório `jhownzitoll/central-de-materiais`.
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Adicione variáveis de ambiente:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
6. Publique.

O arquivo `public/_redirects` garante que rotas da SPA retornem o `index.html`.

## Depois do deploy

- atualize Site URL/Redirect URLs no Supabase para o endereço `pages.dev`;
- teste cadastro, confirmação de e-mail, login, carrinho e pedido;
- depois conecte o domínio próprio ao mesmo projeto Pages.
