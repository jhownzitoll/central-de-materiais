# iBuild Nexus Autopilot — companheiro local Windows

**Status:** código e infraestrutura implantados; instalação e sessão autenticada no PC do proprietário ainda não comprovadas. Sem Work nem API OpenAI paga. O Supabase verifica a cada 2 minutos; o programa Windows observa a interface local ~24 s e só tenta uma tarefa previamente preparada com duas amostras idle estáveis. O programa NÃO liga um PC desligado.

## Instalação em uma única máquina

1. Baixe a pasta `nexus-autopilot` do repositório e coloque o arquivo privado `nexus_autopilot_private.env` ao lado do `install-windows.ps1`.
2. Abra PowerShell na pasta e execute `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1`.
3. A nova janela Chromium aparecerá; entre em `chatgpt.com` com sua conta se solicitado. É um perfil separado do Chrome pessoal.
4. Não feche o processo Windows; ele tem auto-restart. O atalho na pasta Inicializar reinicia depois do próximo login no Windows. O computador precisa ficar ligado e a sessão do Windows iniciada.
5. Para pausar, retire temporariamente o atalho `iBuild Nexus Autopilot.lnk` de `shell:startup`, encerre o processo supervisor e desative a chave `ibuild_nexus_autopilot_keys.enabled` pelo Supabase; isso não revoga o navegador existente.

## Limitações

- A sessão ChatGPT pode exigir verificação/CAPTCHA, ser bloqueada por automação ou ter limites do plano. A rotina NÃO contorna esses desafios.
- Os seletores da página podem mudar. Se a conclusão não for comprovada, status é UNKNOWN/FAILED e o servidor **não reenviará** o prompt automaticamente.
- O agente local não é o antigo Nexus Runner v0.3: é um complemento independente e não reativa seu heartbeat antigo. Nenhuma promessa de controlar o navegador pessoal ou o Work.
- O supervisor NÃO executa raciocínio entre respostas: ele só prepara próxima tarefa, enquanto cada conversa do ChatGPT realiza raciocínio conforme estiver disponível, com conectores reais e autorização.
- Primeiro P0: teste sem cobrança + PDFs privados + notificação RECEBIDA; sem catálogo antes disso.

## Segurança

A chave privada deve existir apenas no PC do proprietário (não no GitHub, em screenshots ou no ChatGPT). O servidor guarda somente SHA-256 do segredo; acesso ao endpoint é verificado e revogável. A função só aceita observações, reivindicações de prompts pré-autorizados e relatórios de envio. Não expõe SQL nem possibilita criar mensagens arbitrárias. Um comando reivindicado sem confirmação torna-se UNKNOWN e exige revisão.

## Evidência de operação

- `select ibuild_agent.chat_supervisor_2min_tick();` e cron `ibuild_chat_supervisor_2min_v1`.
- `select observed_at,state,authenticated,composer_ready from public.ibuild_chat_monitor_signals order by observed_at desc limit 5;`
- `select created_at,work_id,state,chat_url from public.ibuild_chat_dispatches order by created_at desc limit 10;`
- `select state,attempt_count,last_result from ibuild_agent.work_queue where dedupe_key='P0:CODE_AUDIT';`
- `select * from ibuild_agent.supervisor_issues where code='DEVICE_OFFLINE';` (antigo Runner independente).

Todos os comandos devem ser executados no SQL Editor pelo administrador, nunca no frontend.
