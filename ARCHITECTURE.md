# Arquitetura

## Fluxo público

`Visitante → Catálogo → Busca/filtro → Carrinho`

Catálogo e preços são públicos. Produtos inativos não aparecem.

## Fluxo do cliente

`Carrinho → Login/Cadastro → Confirmação de e-mail → create_order() → Pedido salvo → Relatório → WhatsApp`

O carrinho permanece no `localStorage` durante autenticação.

## Fluxo de pedido

A função PostgreSQL `create_order`:

1. exige `auth.uid()`;
2. exige perfil ativo;
3. recebe ofertas/SKUs, quantidades e o preço que o cliente visualizou;
4. relê a oferta ativa no banco;
5. detecta mudança de preço;
6. recalcula subtotais e total;
7. usa chave de idempotência;
8. salva snapshots do cliente, da loja, do produto e do preço;
9. devolve número, total oficial e dados para o relatório.

## Administração

`SUPER_ADMIN` controla toda a plataforma. `STORE_ADMIN` administra apenas a loja à qual está vinculado. A proteção principal está nas políticas RLS e não na navegação React.

## Modelo multi-loja

- `products`: catálogo global.
- `stores`: lojas participantes.
- `store_offers`: preço/disponibilidade por loja.
- `store_members`: vínculo de usuários com lojas.
- `orders` / `order_items`: pedidos e snapshots históricos.

## Evolução

A Casa do MDF é a primeira loja. A mesma estrutura aceita novas lojas e comparação de preços sem duplicar produtos globais.
