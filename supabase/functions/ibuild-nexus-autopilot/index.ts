import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const env=(k:string)=>Deno.env.get(k)?.trim()||"";
const validId=(s:unknown)=>typeof s==="string"&&/^[a-zA-Z0-9_.:-]{8,120}$/.test(s);
const isChat=(s:string)=>/^https:\/\/chatgpt\.com(?:\/[\w/?=&%.:-]*)?$/.test(s);
const guid=(s:unknown)=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function timingSafeHex(a:string,b:string){
 if(a.length!==b.length)return false;
 let different=0;
 for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);
 return different===0;
}
async function sha256(t:string){
 const bytes=new TextEncoder().encode(t);
 return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async request=>{
 if(request.method!=="POST")return json({error:"method_not_allowed"},405);
 const url=env("SUPABASE_URL"),service=env("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!service)return json({error:"backend_unavailable"},503);
 const token=request.headers.get("x-nexus-autopilot-token")||"";
 if(token.length<40||token.length>200)return json({error:"unauthorized"},401);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:key,error:keyError}=await db.from("ibuild_nexus_autopilot_keys").select("token_sha256,enabled").eq("id",1).maybeSingle();
 if(keyError||!key?.enabled||!timingSafeHex(await sha256(token),key.token_sha256))return json({error:"unauthorized"},401);
 let body:Record<string,unknown>;
 try{body=await request.json();if(!body||Array.isArray(body)||typeof body!=="object")throw Error();}
 catch{return json({error:"invalid_body"},400);}
 const action=body.action,session=body.session_id;
 if(!validId(session))return json({error:"invalid_session_id"},400);
 if(action==="observe"){
   const state=body.state,chatUrl=body.browser_url;
   if(!["BUSY","IDLE","UNKNOWN","BLOCKED"].includes(String(state))||typeof chatUrl!=="string"||!isChat(chatUrl))
     return json({error:"invalid_observation"},400);
   const authenticated=body.authenticated===true,composerReady=body.composer_ready===true;
   const composerEmpty=body.composer_empty===true;
   const fingerprint=String(body.last_response_fingerprint||"").slice(0,149);
   const note=String(body.note||"").slice(0,250);
   const {error}=await db.from("ibuild_chat_monitor_signals").insert({session_id:session,browser_url:chatUrl,
     state,authenticated,composer_ready:composerReady,composer_empty:composerEmpty,
     last_response_fingerprint:fingerprint,note});
   if(error)return json({error:"observation_rejected"},503);
   return json({ok:true,stored:true});
 }
 if(action==="poll"){
   // A fresh, specific local observation is mandatory even if another session is idle.
   const {data:signal}=await db.from("ibuild_chat_monitor_signals")
     .select("state,authenticated,composer_ready,composer_empty,observed_at")
     .eq("session_id",session).order("observed_at",{ascending:false}).limit(1).maybeSingle();
   if(!signal||signal.state!=="IDLE"||!signal.authenticated||!signal.composer_ready||!signal.composer_empty
      ||Date.now()-Date.parse(signal.observed_at)>75_000)return json({ok:true,status:"NOT_READY"});
   const {data:dispatch,error:findErr}=await db.from("ibuild_chat_dispatches")
     .select("id,prompt_text,work_id").eq("state","PREPARED").order("created_at",{ascending:true}).limit(1).maybeSingle();
   if(findErr)return json({error:"queue_unavailable"},503);
   if(!dispatch)return json({ok:true,status:"NO_COMMAND"});
   // Atomic conditional claim. If the response times out, the command becomes UNKNOWN, never retried.
   const {data:claimed,error:claimError}=await db.from("ibuild_chat_dispatches")
     .update({state:"CLAIMED",session_id:session,claimed_at:new Date().toISOString()})
     .eq("id",dispatch.id).eq("state","PREPARED").select("id,prompt_text,work_id").maybeSingle();
   if(claimError)return json({error:"claim_failed"},503);
   if(!claimed)return json({ok:true,status:"CLAIMED_ELSEWHERE"});
   return json({ok:true,status:"CLAIMED",dispatch_id:claimed.id,work_id:claimed.work_id,prompt:claimed.prompt_text});
 }
 if(action==="report"){
   if(!guid(body.dispatch_id))return json({error:"invalid_dispatch_id"},400);
   const state=body.status==="SENT"?"SENT":body.status==="FAILED"?"FAILED":"UNKNOWN";
   const safeUrl=typeof body.chat_url==="string"&&isChat(body.chat_url)?body.chat_url:null;
   const error=String(body.error||"").slice(0,1100)||null;
   const {data,error:reportError}=await db.from("ibuild_chat_dispatches")
     .update({state,chat_url:safeUrl,finished_at:new Date().toISOString(),
       sent_at:state==="SENT"?new Date().toISOString():null,error})
     .eq("id",body.dispatch_id).eq("session_id",session).eq("state","CLAIMED").select("id,state").maybeSingle();
   if(reportError)return json({error:"report_failed"},503);
   if(!data)return json({error:"not_claimed_or_already_reported"},409);
   return json({ok:true,status:data.state});
 }
 if(action==="status"){
   return json({ok:true,service:"nexus-autopilot",authenticated:true});
 }
 return json({error:"unsupported_action"},400);
});
