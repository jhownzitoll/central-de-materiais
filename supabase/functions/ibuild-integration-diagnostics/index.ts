import {createClient} from "npm:@supabase/supabase-js@2.57.0"

const env=(key:string)=>Deno.env.get(key)?.trim()||''
const res=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
})
const isUuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isValidPhoneId=(v:string)=>/^[0-9]{8,25}$/.test(v)
const sanitizeCode=(v:unknown)=>typeof v==='number'?v:typeof v==='string'?v.slice(0,30):null

Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return res({error:'method_not_allowed'},405)
 const url=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY')
 if(!url||!key)return res({error:'backend_environment_incomplete'},503)
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const ts=req.headers.get('x-ibuild-cron-ts')||''
 const sig=req.headers.get('x-ibuild-cron-signature')||''
 const {data:approved,error:authError}=await db.rpc('ibuild_verify_cron',{p_ts:ts,p_sig:sig})
 if(authError||approved!==true)return res({error:'unauthorized'},403)
 let body:Record<string,unknown>
 try{body=await req.json()}catch{return res({error:'invalid_json'},400)}
 const token=env('IBUILD_META_SYSTEM_USER_TOKEN')||env('IBUILD_META_ACCESS_TOKEN')
 const phoneId=env('IBUILD_META_PHONE_NUMBER_ID')
 const apiVersion=env('IBUILD_META_GRAPH_VERSION')||'v26.0'
 const summary:Record<string,unknown>={
  meta_token_configured:!!token,meta_phone_id_configured:isValidPhoneId(phoneId),
  webhook_app_secret_configured:!!env('IBUILD_META_APP_SECRET'),
  webhook_verify_token_configured:!!env('IBUILD_META_VERIFY_TOKEN'),
  meta_graph_version:apiVersion
 }
 // Validate that the server token belongs to the intended Meta app and has messaging scope.
 const appSecret=env('IBUILD_META_APP_SECRET')
 const appId=env('IBUILD_META_APP_ID')||'2586212028565530'
 if(token&&appSecret&&/^\d+$/.test(appId)){
   try{
     const debugUrl='https://graph.facebook.com/'+apiVersion+'/debug_token?input_token='+encodeURIComponent(token)
     const debugRes=await fetch(debugUrl,{
       headers:{'Authorization':'Bearer '+appId+'|'+appSecret},signal:AbortSignal.timeout(15000)
     })
     const dbg=await debugRes.json().catch(()=>({}))
     summary.token_debug_http_status=debugRes.status
     if(debugRes.ok&&dbg?.data){
       summary.token_valid=dbg.data.is_valid===true
       summary.token_matches_app=String(dbg.data.app_id)===appId
       summary.token_has_messaging=(dbg.data.scopes||[]).includes('whatsapp_business_messaging')
       summary.token_has_management=(dbg.data.scopes||[]).includes('whatsapp_business_management')
       summary.token_expires_at=typeof dbg.data.expires_at==='number'?dbg.data.expires_at:null
     }else{
       summary.token_debug_error_code=sanitizeCode(dbg?.error?.code)
     }
   }catch(e){summary.token_debug_failure=e instanceof Error?e.name:'network'}
 }
 if(token&&isValidPhoneId(phoneId)&&/^v\d+\.\d+$/.test(apiVersion)){
   try{
     const response=await fetch('https://graph.facebook.com/'+apiVersion+'/'+phoneId+'?fields=id,verified_name',{
       headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)
     })
     const result=await response.json().catch(()=>({}))
     summary.meta_phone_auth_ok=response.ok
     summary.meta_http_status=response.status
     if(!response.ok){
       summary.meta_error_code=sanitizeCode(result?.error?.code)
       summary.meta_error_subcode=sanitizeCode(result?.error?.error_subcode)
       summary.meta_error_type=sanitizeCode(result?.error?.type)
     }
   }catch(e){
     summary.meta_phone_auth_ok=false
     summary.meta_probe_failure=e instanceof Error?e.name:'network'
   }
 }
 if(token){
   try{
     const permissionsRes=await fetch('https://graph.facebook.com/'+apiVersion+'/me/permissions',{
       headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)
     })
     const result=await permissionsRes.json().catch(()=>({}))
     summary.token_permissions_http_status=permissionsRes.status
     if(permissionsRes.ok&&Array.isArray(result.data)){
       summary.me_messaging_granted=result.data.some((p:any)=>p.permission==='whatsapp_business_messaging'&&p.status==='granted')
       summary.me_management_granted=result.data.some((p:any)=>p.permission==='whatsapp_business_management'&&p.status==='granted')
     }else summary.token_permissions_error_code=sanitizeCode(result?.error?.code)
   }catch(e){summary.token_permissions_failure=e instanceof Error?e.name:'network'}
 }
 if(appSecret&&/^\d+$/.test(appId)){
   try{
     const appRes=await fetch('https://graph.facebook.com/'+apiVersion+'/'+appId+'?fields=id',{
       headers:{Authorization:'Bearer '+appId+'|'+appSecret},signal:AbortSignal.timeout(12000)
     })
     const result=await appRes.json().catch(()=>({}))
     summary.app_id_secret_valid=appRes.ok&&String(result?.id)===appId
     summary.app_auth_http_status=appRes.status
     if(!appRes.ok)summary.app_auth_error_code=sanitizeCode(result?.error?.code)
   }catch(e){summary.app_auth_failure=e instanceof Error?e.name:'network'}
 }
 if(token){
   try{
     const appRes=await fetch('https://graph.facebook.com/'+apiVersion+'/app?fields=id,name',{
       headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)
     })
     const result=await appRes.json().catch(()=>({}))
     summary.token_app_query_status=appRes.status
     if(appRes.ok&&typeof result?.id==='string'){
       summary.token_issued_for_expected_app=result.id===appId
       summary.token_app_id=result.id
       summary.token_app_name=typeof result.name==='string'?result.name.slice(0,80):null
       if(appSecret){
         const pairRes=await fetch('https://graph.facebook.com/'+apiVersion+'/'+result.id+'?fields=id',{
           headers:{Authorization:'Bearer '+result.id+'|'+appSecret},signal:AbortSignal.timeout(12000)
         })
         const pair=await pairRes.json().catch(()=>({}))
         summary.stored_app_secret_matches_token_app=pairRes.ok&&String(pair?.id)===result.id
         summary.stored_app_secret_pair_status=pairRes.status
       }
     }else summary.token_app_query_code=sanitizeCode(result?.error?.code)
   }catch(e){summary.token_app_query_failure=e instanceof Error?e.name:'network'}
 }
 if(token){
   const businessId='1137445162104025'
   try{
     const wabasRes=await fetch('https://graph.facebook.com/'+apiVersion+'/'+businessId+'/owned_whatsapp_business_accounts?fields=id,name&limit=50',{
       headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(13000)
     })
     const wabasData=await wabasRes.json().catch(()=>({}))
     summary.business_wa_accounts_status=wabasRes.status
     if(wabasRes.ok&&Array.isArray(wabasData.data)){
       summary.business_wa_accounts_count=wabasData.data.length
       summary.business_wa_ids=wabasData.data.slice(0,6).map((a:any)=>a.id)
       let phoneMatched=false
       const inspected=[]
       for(const account of wabasData.data.slice(0,3)){
         const phonesRes=await fetch('https://graph.facebook.com/'+apiVersion+'/'+account.id+'/phone_numbers?fields=id&limit=60',{
           headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(13000)
         })
         const phones=await phonesRes.json().catch(()=>({}))
         inspected.push({waba_id:account.id,phones_readable:phonesRes.ok,includes_expected_phone:phonesRes.ok&&Array.isArray(phones.data)&&phones.data.some((x:any)=>String(x.id)===phoneId)})
         if(phonesRes.ok&&Array.isArray(phones.data)&&phones.data.some((x:any)=>String(x.id)===phoneId))phoneMatched=true
       }
       summary.phone_id_matches_business_waba=phoneMatched
       summary.business_waba_checks=inspected
     }else summary.business_waba_error_code=sanitizeCode(wabasData?.error?.code)
   }catch(e){summary.business_waba_probe_error=e instanceof Error?e.name:'network'}
 }
 // WABA selected in the authenticated Meta Business Suite portfolio.
 if(token){
   const selectedWaba='3030795093945086'
   try{
     const phonesResponse=await fetch('https://graph.facebook.com/'+apiVersion+'/'+selectedWaba+'/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status&limit=40',{
       headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(13000)
     })
     const phones=await phonesResponse.json().catch(()=>({}))
     summary.selected_waba_phones_http_status=phonesResponse.status
     if(phonesResponse.ok&&Array.isArray(phones.data)){
       summary.selected_waba_phone_count=phones.data.length
       summary.selected_waba_contains_current_phone=phones.data.some((v:any)=>String(v.id)===phoneId)
       summary.selected_waba_phone_ids=phones.data.slice(0,10).map((v:any)=>String(v.id))
       summary.selected_waba_phone_code_status=phones.data.find((v:any)=>String(v.id)===phoneId)?.code_verification_status||null
     }else summary.selected_waba_phones_error_code=sanitizeCode(phones?.error?.code)
   }catch(e){summary.selected_waba_phones_failure=e instanceof Error?e.name:'network'}
   try{
     const templatesRes=await fetch('https://graph.facebook.com/'+apiVersion+'/'+selectedWaba+'/message_templates?fields=name,status,language,components&limit=100',{
       headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(14000)
     })
     const t=await templatesRes.json().catch(()=>({}))
     summary.selected_waba_templates_status=templatesRes.status
     if(templatesRes.ok&&Array.isArray(t.data)){
       summary.selected_waba_template_count=t.data.length
       summary.selected_waba_test_template=t.data.filter((x:any)=>x.name==='hello_world')
          .map((x:any)=>({name:x.name,status:x.status,language:x.language}))
       summary.selected_waba_order_template=t.data.filter((x:any)=>x.name==='ibuild_novo_pedido')
          .map((x:any)=>({name:x.name,status:x.status,language:x.language,
             header_format:Array.isArray(x.components)?x.components.find((c:any)=>c.type==='HEADER')?.format:null}))
     }else summary.selected_waba_template_error_code=sanitizeCode(t?.error?.code)
   }catch(e){summary.selected_waba_template_failure=e instanceof Error?e.name:'network'}
   try{
     const appsResponse=await fetch('https://graph.facebook.com/'+apiVersion+'/'+selectedWaba+'/subscribed_apps?fields=id,name&limit=40',{
       headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(13000)
     })
     const apps=await appsResponse.json().catch(()=>({}))
     summary.selected_waba_apps_http_status=appsResponse.status
     if(appsResponse.ok&&Array.isArray(apps.data)){
       summary.selected_waba_app_count=apps.data.length
       summary.selected_waba_app_ids=apps.data.slice(0,12).map((v:any)=>String(v.id||v.whatsapp_business_api_data?.id||''))
     }else summary.selected_waba_apps_error_code=sanitizeCode(apps?.error?.code)
   }catch(e){summary.selected_waba_apps_failure=e instanceof Error?e.name:'network'}
 }

 const probeId='3030795093945086'
 const probePhone='1427333740468343'
 if(token){
   for (const probe of [
     {name:'waba_status',url:'https://graph.facebook.com/'+apiVersion+'/'+probeId+'?fields=id,name,account_review_status,health_status'},
     {name:'waba_minimal',url:'https://graph.facebook.com/'+apiVersion+'/'+probeId+'?fields=id,name'},
     {name:'phone_status',url:'https://graph.facebook.com/'+apiVersion+'/'+probePhone+'?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,status'},
     {name:'phone_minimal',url:'https://graph.facebook.com/'+apiVersion+'/'+probePhone+'?fields=id,display_phone_number,verified_name'}
   ]){
      try{
        const rr=await fetch(probe.url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)})
        const body=await rr.json().catch(()=>({}))
        if(rr.ok){
          summary[probe.name]={status:rr.status,details:body}
        }else{
          summary[probe.name]={status:rr.status,code:sanitizeCode(body?.error?.code),subcode:sanitizeCode(body?.error?.error_subcode),message:typeof body?.error?.message==='string'?body.error.message.slice(0,180):null}
        }
      }catch(e){summary[probe.name]={error:e instanceof Error?e.name:'network'}}
   }
 }
 if(body.pdf_order_id!==undefined){
   if(!isUuid(body.pdf_order_id))return res({error:'invalid_pdf_order_id'},400)
   const {data:order,error:oErr}=await db.from('orders').select('id,status').eq('id',body.pdf_order_id).maybeSingle()
   if(oErr||!order||order.status==='CANCELADO')return res({error:'pdf_order_not_eligible'},404)
   try{
     const response=await fetch(url+'/functions/v1/ibuild-order-pdf',{
       method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
       body:JSON.stringify({order_id:order.id}),signal:AbortSignal.timeout(30000)
     })
     const pdf=await response.json().catch(()=>({}))
     summary.pdf_created_or_existing=response.ok&&pdf?.ok===true
     summary.pdf_http_status=response.status
     summary.pdf_error=pdf?.error||null
     if(pdf?.document){
       summary.pdf_size_bytes=pdf.document.size_bytes||null
       summary.pdf_has_sha256=typeof pdf.document.sha256==='string'&&pdf.document.sha256.length===64
     }
   }catch(e){summary.pdf_created_or_existing=false;summary.pdf_probe_failure=e instanceof Error?e.name:'network'}
 }
 return res(summary)
})