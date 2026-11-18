# Changelog

## R4 — multi-loja

- evolução do catálogo para plataforma multi-loja;
- Casa do MDF cadastrada como primeira loja e fonte dos preços principais;
- catálogo global separado de `store_offers`;
- perfis CLIENTE, STORE_ADMIN, SELLER e SUPER_ADMIN;
- RLS por loja;
- checkout seguro com revalidação de oferta e preço;
- painel de administração por loja;
- estrutura preparada para comparação futura de preços;
- imagens permanecem desacopladas por SKU.

## R3 — site independente

- migração arquitetural Apps Script/Sheets → React/Supabase/Cloudflare Pages;
- preservação do catálogo de 140 SKUs e 8 categorias;
- catálogo e preços públicos;
- carrinho persistente;
- cadastro CPF/CNPJ e confirmação de e-mail preparada;
- idempotência e snapshots históricos;
- remoção da dependência visível do Lovable/Apps Script.
