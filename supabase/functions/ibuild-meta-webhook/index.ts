import { createClient } from "npm:@supabase/supabase-js@2.57.0"
const env=(k:string)=>Deno.env.get(k)?.trim()||''
const respond=(s:string,status=200)=>new Response(s,{status,headers:{'Content-Type':'text/plain; charset=utf-8'}})
const hex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer)).map(b=>b.toString(16).padStart(2,'0')).join('')
const constantEqual=(a:string,b:string)=>{
 if(a.length!==b.length)return false
 let c=0;for(let i=0;i<a.length;i++)c|=a.charCodeAt(i)^b.charCodeAt(i)
 return c===0
}
async function validSignature(raw:string,signature:string,secret:string){
 if(!signature.startsWith('sha256='))return false
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))
 return constantEqual('sha256='+hex(signed),signature)
}
Deno.serve(async(req)=>{
 const secret=env('IBUILD_META_APP_SECRET'),verifyToken=env('IBUILD_META_VERIFY_TOKEN')
 if(req.method==='GET'){
   if(!verifyToken)return respond('not_configured',503)
   const p=new URL(req.url).searchParams
   if(p.get('hub.mode')==='subscribe'&&p.get('hub.verify_token')===verifyToken)
     return respond(p.get('hub.challenge')||'')
   return respond('forbidden',403)
 }
 if(req.method!=='POST')return respond('method_not_allowed',405)
 if(!secret)return respond('not_configured',503)
 const raw=await req.text()
 if(!await validSignature(raw,req.headers.get('x-hub-signature-256')||'',secret))return respond('invalid_signature',401)
 const url=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY')
 if(!url||!service)return respond('database_unavailable',503)
 let data:Record<string,unknown>
 try{data=JSON.parse(raw)}catch{return respond('invalid_json',400)}
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const entry=Array.isArray(data.entry)?data.entry:[]
 for(const e of entry){
   for(const change of Array.isArray(e.changes)?e.changes:[]){
     const statuses=Array.isArray(change.value?.statuses)?change.value.statuses:[]
     for(const status of statuses){
       if(typeof status.id!=='string'||typeof status.status!=='string')continue
       const info=Array.isArray(status.errors)?status.errors[0]:null
       const {error}=await admin.rpc('ibuild_record_meta_status',{
         p_message_id:status.id,p_status:status.status,p_error:info?String(info.code||'meta_error'):''
       })
       if(error){console.error('ibuild_webhook_db_failure');return respond('persistence_failed',500)}
     }
   }
 }
 return respond('ok')
})
