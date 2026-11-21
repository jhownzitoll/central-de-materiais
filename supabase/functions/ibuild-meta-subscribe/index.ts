import {createClient} from "npm:@supabase/supabase-js@2.57.0"
const env=(k:string)=>Deno.env.get(k)?.trim()||''
const out=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}})
const appId='1118878157422771'
const wabaId='3030795093945086'
const phoneId='1427333740468343'
Deno.serve(async(req)=>{
 if(req.method!=='POST')return out({error:'method_not_allowed'},405)
 const url=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY')
 if(!url||!service)return out({error:'server_environment_missing'},503)
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const ts=req.headers.get('x-ibuild-cron-ts')||''
 const sig=req.headers.get('x-ibuild-cron-signature')||''
 const {data:valid,error:err}=await db.rpc('ibuild_verify_cron',{p_ts:ts,p_sig:sig})
 if(err||valid!==true)return out({error:'unauthorized'},403)
 const token=env('IBUILD_META_SYSTEM_USER_TOKEN')||env('IBUILD_META_ACCESS_TOKEN')
 const appSecret=env('IBUILD_META_APP_SECRET'),verifyToken=env('IBUILD_META_VERIFY_TOKEN')
 const version=env('IBUILD_META_GRAPH_VERSION')||'v26.0'
 if(!token||!appSecret||!verifyToken||!/^v\d+\.\d+$/.test(version))return out({error:'meta_env_incomplete'},503)
 const head={Authorization:'Bearer '+token}
 const endpoint='https://graph.facebook.com/'+version+'/'+wabaId+'/subscribed_apps'
 const owned=await fetch('https://graph.facebook.com/'+version+'/'+wabaId+'/phone_numbers?fields=id&limit=50',{headers:head,signal:AbortSignal.timeout(12000)})
 const ownedData=await owned.json().catch(()=>({}))
 if(!owned.ok||!Array.isArray(ownedData.data)||!ownedData.data.some((v:any)=>String(v.id)===phoneId))
  return out({error:'phone_not_in_waba',status:owned.status},409)
 const source=await fetch('https://graph.facebook.com/'+version+'/app?fields=id',{headers:head,signal:AbortSignal.timeout(12000)})
 const app=await source.json().catch(()=>({}))
 if(!source.ok||String(app?.id)!==appId)return out({error:'unexpected_token_app'},409)
 const callback=url+'/functions/v1/ibuild-meta-webhook'
 const challenge='ibuild'+crypto.randomUUID().replace(/-/g,'').slice(0,14)
 const checkUrl=new URL(callback)
 checkUrl.searchParams.set('hub.mode','subscribe')
 checkUrl.searchParams.set('hub.verify_token',verifyToken)
 checkUrl.searchParams.set('hub.challenge',challenge)
 const check=await fetch(checkUrl,{signal:AbortSignal.timeout(12000)})
 const answer=await check.text()
 if(!check.ok||answer!==challenge)return out({error:'webhook_challenge_failed',status:check.status},409)
 const before=await fetch(endpoint,{headers:head,signal:AbortSignal.timeout(12000)})
 const existing=await before.json().catch(()=>({}))
 if(before.ok&&Array.isArray(existing?.data)&&existing.data.some((x:any)=>String(x.id)===appId)){
  return out({status:'already_subscribed',waba_id:wabaId,app_id:appId,webhook_challenge_valid:true})
 }
 const registration=await fetch(endpoint,{
  method:'POST',
  headers:{...head,'Content-Type':'application/json'},
  body:JSON.stringify({override_callback_uri:callback,verify_token:verifyToken}),
  signal:AbortSignal.timeout(22000)
 })
 const result=await registration.json().catch(()=>({}))
 return out({
  status:registration.ok&&result.success===true?'subscribed':'subscription_failed',
  waba_id:wabaId,app_id:appId,
  webhook_challenge_valid:true,
  meta_http_status:registration.status,
  meta_success:result.success===true,
  meta_error_code:result?.error?.code??null,
  meta_error_type:result?.error?.type??null,
  meta_error_message:typeof result?.error?.message==='string'?result.error.message.slice(0,260):null
 })
})