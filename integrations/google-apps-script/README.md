# iBuild — entrega de pedidos por Gmail (SEM META)

Infraestrutura (21/11/2026): Supabase `pkpihrxucorfbniltdtk`, Edge `ibuild-gmail-bridge` ACTIVE, script `integrations/google-apps-script/Code.gs`. A credencial pessoal não está no GitHub.

## Funcionamento

1. Cliente autenticado faz um **pedido consolidado novo**, sem pagamento automático.
2. Trigger em `public.order_group_orders` registra **uma** notificação do grupo em `public.ibuild_gmail_outbox`, exclusivamente para grupos criados após a ativação. Cron `ibuild_gmail_bridge_maintenance_v1` reconcilia a cada 5 minutos.
3. Apps Script, autorizado pelo proprietário (Gmail), roda `processarPedidos` com trigger de 5 minutos e consulta a Edge Function com token privado.
4. Antes de permitir envio, servidor comprova destinatário: perfil ativo SUPER_ADMIN e email confirmado; o script compara `Session.getEffectiveUser().getEmail()` com esse endereço.
5. Backend prepara todos os PDFs individuais por loja usando `ibuild-order-pdf`, cria URLs privadas de 15 minutos e só então assume um comando (`CLAIMED`); o script baixa anexos, verifica tamanho, cabeçalho PDF e SHA-256.
6. `MailApp.sendEmail` envia **um único e-mail ao proprietário por pedido consolidado**, com PDFs individuais anexados.
7. Status `ACCEPTED` significa que o MailApp retornou sem erro, **não prova caixa de entrada**. O proprietário verifica o Gmail para comprovar entrega. Em crash/timeout, estado `UNKNOWN`, sem retransmissão automática.

## Instalação de uso pessoal (uma vez)

1. Baixe o **pacote privado ZIP** entregue na conversa. Não distribua (contém o token do servidor).
2. No Windows, execute `GERAR_SCRIPT_GMAIL.bat`: ele baixa o código da revisão fixa do GitHub e substitui o marcador pelo token local.
3. Abra `https://script.google.com/home`, entre na **mesma conta Google do SUPER_ADMIN**, crie **Novo projeto** privado e cole o conteúdo integral do `Code_PRIVADO_PRONTO.gs` como `Code.gs`.
4. Salve e execute a função `instalar` uma única vez. Confirme as permissões do Google para UrlFetchApp, MailApp e acionadores automáticos. **Não publicar como Web App e não tornar o projeto público.**
5. Execute `verificarConexao` e confirme o log `GMAIL_OK`; então os acionadores enviam e-mails para pedidos futuros. O Chrome pode ser fechado após autorização.
6. Faça um pedido novo de **TESTE autenticado sem cobrança**, verifique `/admin/avisos`, seus PDFs e a **mensagem realmente recebida** na caixa Gmail. Não reutilizar pedidos de resultado incerto.

## Limitações

- Não envia pedidos antigos: os pedidos anteriores à migração permanecem intactos.
- Requer conceder autorização Google uma única vez; nenhum conector de chat pode conceder permissões em seu lugar.
- Consome cotas gratuitas da sua conta Gmail; limite publicado para contas pessoais pelo Google: **100 destinatários/dia**, sujeito à alteração.
- O script roda no Google, não depende do Nexus ou de um PC ligado depois da ativação.
- Nenhum e-mail é enviado para clientes ou fornecedores: o único destinatário é o proprietário ativo confirmado.
- A caixa interna `/admin/avisos` funciona independentemente desse e-mail.
- `UNKNOWN` não é repetido automaticamente. Uma falha antes da chamada ao MailApp fica `FAILED` e requer revisão.
- No painel GitHub, nunca salvar `TOKEN_PRIVADO`, `service_role` ou as URLs assinadas dos PDFs em commits.
- O remetente Gmail pode gerar restrições de envio se exceder cotas ou políticas; o script usa somente pedidos transacionais legítimos.

## Operação e auditoria (admin SQL)

```sql
select state,count(*) from public.ibuild_gmail_outbox group by state;
select ibuild_agent.gmail_bridge_maintenance_v1();
select jobname,active,schedule from cron.job where jobname='ibuild_gmail_bridge_maintenance_v1';
```

Para pausar automação, executar `pausar` no Apps Script; para revogar também a chave, definir `public.ibuild_gmail_bridge_config.enabled=false` no Supabase.

**Estado no momento da implantação:** função/filas prontas e leitura anônima negada, mas Gmail OAuth/acionador ainda dependem da instalação do proprietário. Sem prova de e-mail enviado ou entregue até autorização.
