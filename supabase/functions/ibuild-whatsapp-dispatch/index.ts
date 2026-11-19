import { createClient } from "npm:@supabase/supabase-js@2.57.0"

const origin=Deno.env.get('IBUILD_PUBLIC_ORIGIN')||'https://central-de-materiais.jonathan20014-jsdo.workers.dev'
const cors={ 'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin' }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}})
const env=(key:string)=>Deno.env.get(key)?.trim()||''
const money=(amount:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(amount)||0)
const isUUID=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const safe=(s:unknown,max=75)=>String(s??'').slice(0,max)

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
 if(req.method!=='POST')return json({error:'method_not_allowed'},405)
 const url=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),service=env('SUPABASE_SERVICE_ROLE_KEY')
 const token=req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
 if(!url||!anon||!service)return json({error:'supabase_not_configured'},503)
 if(!token)return json({error:'auth_required'},401)
 const client=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}})
 const {data:identity,error:authError}=await client.auth.getUser(token)
 if(authError||!identity.user)return json({error:'unauthorized'},401)
 const {data:profile,error:profileError}=await client.from('profiles').select('platform_role,active').eq('id',identity.user.id).single()
 if(profileError||!profile?.active)return json({error:'access_denied'},403)
 const superAdmin=profile.platform_role==='SUPER_ADMIN'
 let body:Record<string,unknown>
 try {body=await req.json()}catch{return json({error:'invalid_json'},400)}
 const orderId=body.order_id
 if(orderId!==undefined&&!isUUID(orderId))return json({error:'invalid_order_id'},400)
 if(!superAdmin){
   if(!isUUID(orderId))return json({error:'admin_only'},403)
   const {data:order}=await client.from('orders').select('id,user_id').eq('id',orderId).maybeSingle()
   if(!order||order.user_id!==identity.user.id)return json({error:'not_your_order'},403)
 }
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:config,error:configError}=await admin.from('ibuild_notification_config').select('*').eq('id',1).single()
 if(configError||!config)return json({error:'config_unavailable'},503)
 const accessToken=env('IBUILD_META_ACCESS_TOKEN'),phoneId=env('IBUILD_META_PHONE_NUMBER_ID')
 const version=env('IBUILD_META_GRAPH_VERSION')||'v26.0'
 if(!config.enabled||!config.admin_phone||!accessToken||!phoneId)return json({configured:false,reason:'meta_or_recipient_pending',processed:0})
 if(!/^v\d+\.\d+$/.test(version)||!/^\d+$/.test(phoneId))return json({error:'meta_identifiers_invalid'},503)
 const {data:claimed,error:claimError}=await admin.rpc('ibuild_claim_notification_batch',{p_limit:superAdmin?8:1,p_order_id:orderId||null})
 if(claimError)return json({error:'queue_unavailable'},503)
 const results:Array<{id:string;state:string}>=[]
 for(const job of claimed||[]){
   const finish=async(state:string,providerId:string|null=null,problem:string|null=null,retrySeconds=60)=>{
     const {error}=await admin.rpc('ibuild_finish_notification',{p_id:job.id,p_state:state,p_provider_id:providerId,p_error:problem,p_retry_seconds:retrySeconds})
     if(error)throw Error('queue_finish_failed')
     results.push({id:job.id,state})
   }
   try{
     const [orderResult,itemsResult]=await Promise.all([
       admin.from('orders').select('id,public_number,status,total,customer_snapshot,store_snapshot').eq('id',job.order_id).single(),
       admin.from('order_items').select('id,quantity').eq('order_id',job.order_id)
     ])
     const order=orderResult.data
     if(orderResult.error||itemsResult.error||!order||order.status==='CANCELADO'){
       await finish('FALHA_PERMANENTE',null,'Pedido não elegível para notificação.')
       continue
     }
     const buyer=safe(order.customer_snapshot?.trade_name||order.customer_snapshot?.full_name||'Comprador',60)
     const store=safe(order.store_snapshot?.store_name||'Fornecedor',60)
     const itemCount=(itemsResult.data||[]).reduce((sum,item)=>sum+Number(item.quantity||0),0)
     const isMetaHello=String(config.template_name)==='hello_world'
     const template=isMetaHello
       ? {name:'hello_world',language:{code:'en_US'}}
       : {name:config.template_name,language:{code:config.template_language},components:[{type:'body',parameters:[
           {type:'text',text:order.public_number},
           {type:'text',text:buyer},
           {type:'text',text:store},
           {type:'text',text:money(order.total)},
           {type:'text',text:String(itemCount)},
           {type:'text',text:origin+'/admin/pedidos'}
         ]}]}
     const response=await fetch('https://graph.facebook.com/'+version+'/'+phoneId+'/messages',{
       method:'POST',
       headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json'},
       body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:job.recipient_phone,type:'template',template}),
       signal:AbortSignal.timeout(18000)
     })
     const data=await response.json().catch(()=>({}))
     if(response.ok&&typeof data?.messages?.[0]?.id==='string'){
       await finish('ACEITO',data.messages[0].id)
       continue
     }
     const errorCode=safe(data?.error?.code??response.status,30)
     const errorType=safe(data?.error?.type??'meta_http_error',45)
     if(response.status===429||response.status>=500){
       await finish('FALHA_TEMPORARIA',null,'Meta HTTP '+response.status+' '+errorType+' '+errorCode,Math.min(3600,60*2**Math.min(Number(job.attempts),5)))
     }else{
       await finish('FALHA_PERMANENTE',null,'Meta HTTP '+response.status+' '+errorType+' '+errorCode)
     }
   }catch(error){
     // Tempo esgotado ou rede interrompida: não podemos provar que a mensagem não foi enviada.
     // Não reenviar automaticamente; decisão humana na fila.
     try{await finish('RESULTADO_INCERTO',null,'Resposta da Meta inconclusiva; verificar antes de reenviar.')}catch{
       results.push({id:job.id,state:'ERRO_AO_REGISTRAR_RESULTADO'})
     }
     console.warn('ibuild_message_uncertain',safe(error instanceof Error?error.name:'error',40))
   }
 }
 return json({configured:true,processed:results.length,results})
})
