import {createClient} from "npm:@supabase/supabase-js@2.57.0"
const env=(key:string)=>Deno.env.get(key)?.trim()||''
const reply=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
const TEST_KEY='ibuild_owner_graph_probe_20261120_v2'
Deno.serve(async(req)=>{
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405)
 const dbUrl=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY')
 if(!dbUrl||!service)return reply({error:'server_unconfigured'},503)
 const db=createClient(dbUrl,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const timestamp=req.headers.get('x-ibuild-cron-ts')||''
 const signature=req.headers.get('x-ibuild-cron-signature')||''
 const {data:verified,error:checkError}=await db.rpc('ibuild_verify_cron',{p_ts:timestamp,p_sig:signature})
 if(checkError||verified!==true)return reply({error:'unauthorized'},403)
 let input:Record<string,unknown>
 try{input=await req.json()}catch{return reply({error:'invalid_json'},400)}
 if(input.test_key!==TEST_KEY)return reply({error:'invalid_test_key'},400)
 const token=env('IBUILD_META_SYSTEM_USER_TOKEN')||env('IBUILD_META_ACCESS_TOKEN')
 const phoneId=env('IBUILD_META_PHONE_NUMBER_ID')
 const version=env('IBUILD_META_GRAPH_VERSION')||'v26.0'
 if(!token||!phoneId||!/^v\d+\.\d+$/.test(version))return reply({error:'meta_not_configured'},503)
 const {data:cfg,error:configError}=await db.from('ibuild_notification_config')
  .select('admin_phone,environment').eq('id',1).single()
 if(configError||cfg?.environment!=='TESTE'||cfg.admin_phone!=='5547920032476')
  return reply({error:'owner_destination_not_confirmed'},409)
 // Unique test key is the concurrency/idempotency lock: never resend this key.
 const {data:locked,error:lockErr}=await db.from('ibuild_whatsapp_one_shot_tests')
  .insert({test_key:TEST_KEY,state:'INICIADO',recipient_phone:cfg.admin_phone,template_name:'hello_world'})
  .select('test_key').single()
 if(lockErr){
   if(lockErr.code==='23505')return reply({status:'previous_attempt_exists',test_key:TEST_KEY},409)
   return reply({error:'lock_failed',db_code:lockErr.code},503)
 }
 if(!locked)return reply({error:'lock_missing'},503)
 let state='RESULTADO_INCERTO'
 let code:string|null=null, httpStatus:number|null=null, providerId:string|null=null
 try{
   const result=await fetch('https://graph.facebook.com/'+version+'/'+phoneId+'/messages',{
     method:'POST',
     headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
     body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:cfg.admin_phone,
       type:'template',template:{name:'hello_world',language:{code:'en_US'}}}),
     signal:AbortSignal.timeout(17000)
   })
   httpStatus=result.status
   const data=await result.json().catch(()=>({}))
   providerId=typeof data?.messages?.[0]?.id==='string'?data.messages[0].id:null
   code=data?.error?.code==null?null:String(data.error.code).slice(0,25)
   state=result.ok&&providerId?'ACEITO':'REJEITADO'
 }catch(e){code=e instanceof Error?e.name:'network'}
 const {error:saveErr}=await db.from('ibuild_whatsapp_one_shot_tests').update({
   state,http_status:httpStatus,provider_message_id:providerId,error_code:code,
   error_description:state==='RESULTADO_INCERTO'?'Transmissao inconclusiva; NAO reenviar automaticamente.':null,
   completed_at:new Date().toISOString()
 }).eq('test_key',TEST_KEY)
 if(saveErr)return reply({status:state,save_error_code:saveErr.code,has_message_id:!!providerId},503)
 return reply({status:state,meta_http_status:httpStatus,meta_error_code:code,provider_message_id:providerId,recipient_last4:cfg.admin_phone.slice(-4)})
})