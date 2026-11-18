# Central de Materiais — R4 MultiLoja

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
