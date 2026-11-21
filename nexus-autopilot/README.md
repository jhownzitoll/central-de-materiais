# iBuild Nexus Autopilot — Google Chrome autenticado (Windows)

**Status:** código e infraestrutura implantados; instalação, ativação da extensão Playwriter e sessão autenticada no Chrome do proprietário ainda não comprovadas. Sem Work nem API OpenAI paga. O Supabase verifica a cada 2 minutos; o programa Windows observa a interface local ~24 s e só tenta uma tarefa previamente preparada com duas amostras idle estáveis. O programa NÃO liga um PC desligado.

## Erro da instalação de 21/11 (corrigido)

O primeiro instalador usava `node --input-type=module -e` com aspas JavaScript embutidas no PowerShell. O Windows eliminava as aspas e retornava `SyntaxError: Unexpected identifier 'playwriter'`, **depois** de instalar Node e Playwriter. A correção é executar `node check-playwriter.mjs` diretamente: o export foi testado de verdade em GitHub Actions com Node 24 e `playwriter@0.12.0`. O pacote de reparo contém `CORRIGIR_INSTALACAO.bat` que reutiliza a instalação no AppData e preserva o Chrome e a chave existente. Não confundir os seis testes locais com verificação da sessão Chrome em tempo real.

## Instalação em uma única máquina

1. Extraia o instalador completo com os scripts e o arquivo privado `nexus_autopilot_private.env`; execute o BAT da raiz. Alternativamente instale manualmente a pasta com `install-windows.ps1`.
2. Abra o **seu Google Chrome já autenticado**, em `https://chatgpt.com/`. Instale a extensão [Playwriter](https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe) somente se ainda não estiver instalada.
3. Clique no ícone **Playwriter** nessa aba; ele deve ficar **verde**. Esta ação de autorização precisa ser feita no Chrome, não pode ser forçada pelo instalador.
4. O agente conecta ao Chrome existente por meio da extensão e abre apenas uma aba própria no grupo `ibuild`, preservando suas outras abas e contas. Não baixa o Chromium do Playwright nem copia cookies.
5. O atalho de inicialização do Windows reinicia o processo depois do login. O computador e o Chrome precisam estar funcionando e a extensão conectada.
6. Para pausar, retire o atalho `iBuild Nexus Autopilot.lnk` de `shell:startup`, encerre o supervisor e desative a chave do broker no Supabase se desejar revogar o acesso.

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
