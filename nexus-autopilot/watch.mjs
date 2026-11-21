import { connectViaExtension } from "playwriter";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, shouldPoll, safePromptSendConfirmation } from "./state.mjs";

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
const SESSION="nexus-local-"+randomUUID();
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
  note:chat?"playwriter-existing-chrome":"outside-chatgpt-or-login"
 };
}
async function report(dispatch,status,chatUrl,error){
 try{const r=await api({action:"report",dispatch_id:dispatch.dispatch_id,status,chat_url:chatUrl,error});
  console.log("Relatório do envio:",r.status);
 }catch(err){console.error("Não foi possível confirmar o resultado; NÃO reenviar.",String(err.message).slice(0,110));}
}
async function sendOnce(dispatch){
 let pressed=false;
 try{
  // A separate new NORMAL ChatGPT conversation is created for each task.
  // Never type into an existing user's composer or interrupt active generation.
  await page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded",timeout:40000});
  await page.waitForTimeout(1300);
  const state=await observe();
  if(!shouldPoll(state))throw Error("ChatGPT unavailable, login required, or busy");
  const composer=editor(page);
  const before=await page.locator('[data-message-author-role="user"]').count();
  await composer.fill(dispatch.prompt,{timeout:15000});
  const contents=(await composer.innerText()).trim();
  if(!contents.startsWith(dispatch.prompt.slice(0,45)))throw Error("Composer content mismatch");
  // Exactly ONE submit attempt. Never repeat after an uncertain UI/network result.
  pressed=true;
  await composer.press("Enter",{timeout:8000});
  await page.waitForTimeout(2300);
  const after=await page.locator('[data-message-author-role="user"]').count();
  if(!safePromptSendConfirmation(before,after,dispatch.prompt.slice(0,45)))
    throw Error("No confirmed new user message after submit");
  const last=await page.locator('[data-message-author-role="user"]').last().innerText().catch(()=>"");
  if(!last.startsWith(dispatch.prompt.slice(0,45)))throw Error("Submitted message not confirmed");
  await report(dispatch,"SENT",page.url(),"");
 }catch(err){
  await report(dispatch,pressed?"UNKNOWN":"FAILED",urlIsChat(page.url())?page.url():null,
    String(err.message).slice(0,160));
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
