# iBuild Materiais — Plataforma iBuild (R4 MultiLoja)

Plataforma B2B de materiais para marcenaria, preparada para operar como catálogo multi-loja. A Casa do MDF é a primeira loja cadastrada e fornece os preços principais exibidos nesta versão.

## Perfis

- `CLIENTE`: consulta catálogo, carrinho e pedidos próprios.
- `STORE_ADMIN`: administra somente sua loja, ofertas e pedidos.
- `SELLER`: perfil previsto para operação comercial da loja.
- `SUPER_ADMIN`: controla a plataforma, lojas, catálogo global, ofertas, usuários e configurações.

## Modelo de dados

- `products`: catálogo global.
- `stores`: lojas participantes.
- `store_offers`: preço e disponibilidade de um produto em cada loja.
- `store_members`: vínculo de usuários com lojas.
- `orders` / `order_items`: pedidos com snapshot de preço e dados.

A Casa do MDF está cadastrada como loja padrão e os 140 preços iniciais foram migrados para `store_offers`.

## Stack

- Vite + React + TypeScript
- Supabase PostgreSQL + Auth + RLS
- GitHub como fonte oficial
- Cloudflare Pages como hospedagem-alvo

## Desenvolvimento

```bash
npm install
cp .env.example .env.local
npm run dev
```

Nunca use `service_role` no frontend.

## Imagens

Os produtos usam `public/images/products/<SKU>.webp`. Até as imagens serem adicionadas, a interface utiliza placeholders.

## Acesso e autenticação (R4)

- Login de e-mail/senha, botão de mostrar/ocultar senha, opção de link de acesso por e-mail e controles de Google/Facebook na tela `/login`.
- A criação de perfis é realizada pelo Supabase Auth; nunca crie usuários diretamente via INSERT em `auth.users`.
- A loja tem uma lista privada de bootstrap do primeiro superadministrador. Confirme a posse do e-mail pelo link recebido e verifique `profiles.platform_role` antes de acessar `/admin`.
- Quem entrar por link de e-mail pode estabelecer uma senha em **Minha conta → Definir ou alterar minha senha**.
- Google e Facebook são provedores opcionais. Para habilitá-los, crie as credenciais OAuth no Google Cloud e na Meta for Developers, configure cada provedor no **Supabase → Authentication → Providers** e autorize a URL de callback: `https://pkpihrxucorfbniltdtk.supabase.co/auth/v1/callback`.
- Autorize também a URL do site em **Authentication → URL Configuration**: `https://central-de-materiais.jonathan20014-jsdo.workers.dev` e seu padrão de retorno conforme necessário.
- A interface consulta `GET /auth/v1/settings` com chave pública para detectar provedores ativos. Se a detecção estiver indisponível, os botões ficam em modo "em configuração". Após ativá-los no backend, podem ser usados os flags de build `VITE_GOOGLE_OAUTH_ENABLED=true` e `VITE_FACEBOOK_OAUTH_ENABLED=true` para permitir a navegação OAuth (somente depois de validar a configuração do servidor).
- Instagram não é um provedor de login pessoal genérico integrado nativamente ao Supabase Auth. Não simule autenticação pelo Instagram.
- Nunca grave `service_role`, Client Secret OAuth ou senhas no código do cliente, repositório ou planilhas compartilhadas.
