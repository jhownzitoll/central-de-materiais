import { connectViaExtension } from "playwriter";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, shouldPoll, hasConfirmedSubmission, CLIENT_VERSION } from "./state.mjs";

const BASE=path.dirname(fileURLToPath(import.meta.url));
const ENVFILE=path.join(BASE,".env");
if(existsSync(ENVFILE)){
 for(const line of readFileSync(ENVFILE,"utf8").split(/\r?\n/)){
  const match=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if(match&&!process.env[match[1]])process.env[match[1]]=match[2].trim();
 }
}
const ENDPOINT=process.env.SUPABASE_EDGE_URL;
const TOKEN=process.env.NEXUS_AUTOPILOT_TOKEN;
// Stable ID across watchdog restarts: safe reuse of an unclaimed prepared command.
const sessionFile=path.join(BASE,'.session-id');
function getSessionId(){
 try{const x=readFileSync(sessionFile,'utf8').trim();if(/^nexus-local-[a-f0-9-]{36}$/i.test(x))return x;}catch{}
 const x='nexus-local-'+randomUUID();writeFileSync(sessionFile,x,{mode:0o600});return x;
}
const SESSION=getSessionId();
if(!ENDPOINT?.startsWith("https://pkpihrxucorfbniltdtk.supabase.co/functions/v1/ibuild-nexus-autopilot")
  ||!TOKEN||TOKEN.length<40){
 console.error("Configuração local ausente/inválida: copie o arquivo privado para .env.");
 process.exit(2);
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const urlIsChat=(url)=>/^https:\/\/chatgpt\.com(?:\/|$)/.test(url);
let connection=null,context=null,page=null;
async function api(data){
 const res=await fetch(ENDPOINT,{method:"POST",headers:{
   "content-type":"application/json","x-nexus-autopilot-token":TOKEN
  },body:JSON.stringify({...data,session_id:SESSION}),signal:AbortSignal.timeout(18000)});
 if(!res.ok)throw Error("Broker HTTP "+res.status);
 return res.json();
}
async function visible(locator){return locator.first().isVisible().catch(()=>false);}
function editor(p){
 return p.locator('#prompt-textarea, [data-testid="composer-input"][contenteditable="true"], [contenteditable="true"][role="textbox"]').first();
}
async function observe(){
 const current=page.url();
 const chat=urlIsChat(current);
 const composer=editor(page);
 const composerVisible=chat&&await visible(composer);
 const stopVisible=chat&&await visible(page.locator(
  '[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="Parar"],button[aria-label*="Interromper"]'));
 const loginVisible=await visible(page.getByRole("button",{name:/^log in$|^entrar$/i}));
 let composerEmpty=false;
 if(composerVisible){
  const text=await composer.innerText().catch(()=>"");
  composerEmpty=text.trim().length===0;
 }
 const state=classify({stopVisible,composerVisible,composerEmpty,
   authenticated:chat&&composerVisible,loginVisible});
 let response="";
 if(chat){
  const last=page.locator('[data-message-author-role="assistant"]').last();
  if(await last.count().catch(()=>0))response=await last.innerText().catch(()=>"");
 }
 const fingerprint=createHash("sha256").update(response||"empty-last-response").digest("hex").slice(0,40);
 return {
  action:"observe",state,authenticated:chat&&composerVisible,
  composer_ready:composerVisible,composer_empty:composerEmpty,
  browser_url:chat?current:"https://chatgpt.com/",
  last_response_fingerprint:fingerprint,
  note:CLIENT_VERSION
 };
}
async function report(dispatch,status,chatUrl,error){
 try{const r=await api({action:"report",dispatch_id:dispatch.dispatch_id,status,chat_url:chatUrl,error});
  console.log("Relatório do envio:",r.status);
 }catch(err){console.error("Não foi possível confirmar o resultado; NÃO reenviar.",String(err.message).slice(0,110));}
}
// Wait for an actual new user message in the DOM, up to 75s. A click or
// changing URL is never sufficient proof and is NEVER followed by a retry.
async function awaitConfirmedSubmission(before,prompt){
 const expires=Date.now()+75_000;
 while(Date.now()<expires){
  if(page.isClosed())return false;
  const messages=page.locator('[data-message-author-role="user"]');
  const after=await messages.count().catch(()=>0);
  if(after>before){
   const last=await messages.last().innerText().catch(()=>'');
   if(hasConfirmedSubmission({before,after,lastText:last,prompt}))return true;
  }
  await page.waitForTimeout(1200);
 }
 return false;
}
async function sendOnce(dispatch){
 let attempted=false;
 try{
  // Navigate the agent-owned tab only. Never take control of personal tabs.
  await page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded",timeout:45000});
  let ok=false;
  const start=Date.now();
  while(Date.now()-start<35000){
   if(shouldPoll(await observe())){ok=true;break;}
   await page.waitForTimeout(1200);
  }
  if(!ok)throw Error("ChatGPT indisponivel, sem login ou geracao em andamento");
  const field=editor(page);
  const before=await page.locator('[data-message-author-role="user"]').count();
  await field.fill(dispatch.prompt,{timeout:15000});
  const contents=(await field.innerText()).trim();
  if(!contents.startsWith(dispatch.prompt.slice(0,45)))throw Error("O editor nao contem a tarefa autorizada");
  const button=page.locator('[data-testid="send-button"],[data-testid="composer-send-button"],button[aria-label="Send message"],button[aria-label="Enviar mensagem"],button[aria-label="Enviar"]').first();
  attempted=true;
  if(await visible(button) && await button.isEnabled().catch(()=>false))await button.click({timeout:9000});
  else await field.press("Enter",{timeout:9000});
  if(!await awaitConfirmedSubmission(before,dispatch.prompt)){
   throw Error("Nenhuma mensagem nova foi comprovada no ChatGPT em 75 segundos");
  }
  await report(dispatch,"SENT",page.url(),"");
  console.log("Nexus v3: envio confirmado na interface, sem verificar ainda a conclusao da tarefa.");
 }catch(e){
  await report(dispatch,attempted?"UNKNOWN":"FAILED",urlIsChat(page.url())?page.url():null,String(e?.message||e).slice(0,250));
  console.error("Nexus v3: envio "+(attempted?"INCERTO":"NAO INICIADO")+". Nao repetir automaticamente.");
 }
}
async function boot(){
 // Connect via user-enabled Playwriter extension to the user's EXISTING Chrome profile.
 // Never start Chromium, Chrome for Testing, CDP port, copy cookies or touch personal tabs.
 connection=await connectViaExtension({
  tabGroup:"ibuild",
  tabGroupColor:"blue",
  selectBrowser:(browsers)=>{
   const chromeProfiles=browsers.filter(b=>/chrome/i.test(String(b.browser))&&!/chromium/i.test(String(b.browser)));
   if(chromeProfiles.length!==1)throw Error("Abra o Chrome correto e ative o Playwriter somente nesse perfil (icone verde).");
   return chromeProfiles[0];
  }
 });
 context=connection.browser.contexts()[0];
 if(!context)throw Error("Playwriter nao devolveu contexto do Chrome.");
 // Always create one managed tab, never take over an existing personal tab.
 page=await context.newPage();
 await page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded",timeout:45000});
 console.log("Nexus conectado ao CHROME existente, via Playwriter. Nenhum Chromium paralelo.");
}
async function shutdown(){
 try{await connection?.close()}catch{}
 process.exit(0);
}
process.once("SIGINT",shutdown);
process.once("SIGTERM",shutdown);
await boot();
let consecutiveErrors=0;
while(true){
 try{
  const observation=await observe();
  consecutiveErrors=0;
  await api(observation);
  if(shouldPoll(observation)){
   const command=await api({action:"poll"});
   if(command.status==="CLAIMED"&&typeof command.prompt==="string"
      &&command.prompt.length>=60){
     console.log("Tarefa autorizada recebida:",String(command.work_id).slice(0,40));
     await sendOnce(command);
   }
  }
 }catch(err){
  console.error("Observação falhou; nenhuma mensagem será reenviada:",String(err.message).slice(0,170));
  consecutiveErrors++;
  if(consecutiveErrors>=5)throw Error("Playwriter desconectado ou Chrome indisponivel; solicitando reinicio do supervisor Windows.");
  if(page?.isClosed()){
   page=await context.newPage();
   await page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded",timeout:45000});
  }
 }
 await wait(24000);
}
