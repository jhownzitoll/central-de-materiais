-- Execute apenas depois de a conta administrativa existir em auth.users.
-- Prefira o bootstrap seguro já configurado no banco; este arquivo é apenas uma alternativa manual.
update public.profiles
set platform_role='SUPER_ADMIN'
where id=(select id from auth.users where lower(email)=lower('ADMIN_EMAIL_AQUI') limit 1);

select id,email,platform_role,active
from public.profiles
where platform_role='SUPER_ADMIN';
