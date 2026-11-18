# Supabase — estado atual

O projeto Supabase real já foi criado e recebeu o schema multi-loja, Casa do MDF, 8 categorias, 140 produtos e 140 ofertas.

## Frontend

Use apenas variáveis públicas:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Nunca coloque senha do banco, secret key ou `service_role` no frontend/repositório.

## Autenticação

- login por e-mail/senha;
- confirmação de e-mail;
- cadastro CPF/CNPJ;
- recuperação de senha;
- `SUPER_ADMIN` controla a plataforma;
- `STORE_ADMIN` é vinculado a uma loja através de `store_members`.

Antes da publicação final, configure em **Authentication → URL Configuration** as URLs do Cloudflare Pages e do domínio próprio.
