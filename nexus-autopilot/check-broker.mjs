// Verify the actual Supabase broker with the private local token, without opening a browser, sending messages, or logging tokens.
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const file=path.join(base,'.env');
if(!existsSync(file)){console.error('Nexus broker: arquivo .env nao encontrado.');process.exit(2);}
const env={};
for(const line of readFileSync(file,'utf8').split(/\r?\n/)){
 const m=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
 if(m)env[m[1]]=m[2].trim();
}
const expected='https://pkpihrxucorfbniltdtk.supabase.co/functions/v1/ibuild-nexus-autopilot';
if(env.SUPABASE_EDGE_URL!==expected||!env.NEXUS_AUTOPILOT_TOKEN||env.NEXUS_AUTOPILOT_TOKEN.length<40){
 console.error('Nexus broker: configuracao privada incorreta.');process.exit(3);
}
try{
 const r=await fetch(expected,{method:'POST',headers:{'Content-Type':'application/json','x-nexus-autopilot-token':env.NEXUS_AUTOPILOT_TOKEN},body:JSON.stringify({action:'status',session_id:'nexus-check-local-v3'}),signal:AbortSignal.timeout(16000)});
 const result=await r.json().catch(()=>({}));
 if(r.ok&&result.ok===true&&result.authenticated===true){
  console.log('OK: token do Nexus autenticado no Supabase. Sem enviar mensagens.');
 }else{console.error('Nexus broker recusou autenticacao: HTTP '+r.status);process.exitCode=4;}
}catch(e){
 console.error('Nexus broker sem resposta (rede ou bloqueio local): '+String(e?.name||'network'));process.exitCode=5;
}
