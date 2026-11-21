import {createClient} from "npm:@supabase/supabase-js@2.57.0"
const env=(k:string)=>Deno.env.get(k)?.trim()||""
const origin=env("IBUILD_PUBLIC_ORIGIN")||"https://central-de-materiais.jonathan20014-jsdo.workers.dev"
const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store","Vary":"Origin"}
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,"Content-Type":"application/json"}})
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
const html=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c))
const money=(n:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(n)
const formatEmail=(v:string)=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers})
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405)
 const dbUrl=env("SUPABASE_URL"),anon=env("SUPABASE_ANON_KEY"),service=env("SUPABASE_SERVICE_ROLE_KEY")
 if(!dbUrl||!anon||!service)return reply({error:"backend_missing"},503)
 // Cron is independently HMAC-authenticated; no public or service-role bearer bypass.
 const db=createClient(dbUrl,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const cronTs=req.headers.get("x-ibuild-cron-ts")||""
 const cronSig=req.headers.get("x-ibuild-cron-signature")||""
 let cronAllowed=false
 if(cronTs||cronSig){
   const {data:verified,error:cronError}=await db.rpc("ibuild_verify_cron",{p_ts:cronTs,p_sig:cronSig})
   if(cronError||verified!==true)return reply({error:"cron_unauthorized"},403)
   cronAllowed=true
 }
 let customerId:string|null=null
 if(!cronAllowed){
   const jwt=req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]||""
   if(!jwt)return reply({error:"auth_required"},401)
   const scoped=createClient(dbUrl,anon,{global:{headers:{Authorization:"Bearer "+jwt}},auth:{persistSession:false,autoRefreshToken:false}})
   const {data:identity,error:authError}=await scoped.auth.getUser(jwt)
   if(authError||!identity.user)return reply({error:"invalid_session"},401)
   customerId=identity.user.id
 }
 let body:Record<string,unknown>
 try{body=await req.json()}catch{return reply({error:"invalid_json"},400)}
 if(body.action==="readiness"){
   if(!cronAllowed)return reply({error:"cron_only"},403)
   const apiConfigured=!!env("IBUILD_RESEND_API_KEY")
   const senderConfigured=!!env("IBUILD_EMAIL_FROM")
   const recipient=env("IBUILD_OWNER_EMAIL")
   const {data:owners,error:ownerError}=await db.from("profiles").select("email").eq("platform_role","SUPER_ADMIN").eq("active",true)
   const recipientVerified=!ownerError&&!!recipient&&!!owners?.some(x=>String(x.email||"").toLowerCase()===recipient.toLowerCase())
   return reply({ok:true,provider:"email",api_configured:apiConfigured,sender_configured:senderConfigured,
     owner_recipient_configured:!!recipient,owner_recipient_verified:recipientVerified,
     dispatch_ready:apiConfigured&&senderConfigured&&recipientVerified,
     delivery_proven:false,previous_orders_eligible:false})
 }
 if(!uuid(body.group_id))return reply({error:"invalid_group_id"},400)
 const {data:group}=await db.from("order_groups").select("id,user_id,created_at").eq("id",body.group_id).maybeSingle()
 if(!group||(!cronAllowed&&group.user_id!==customerId))return reply({error:"group_not_found"},404)
 if(cronAllowed&&Date.parse(group.created_at)<Date.parse("2026-11-21T05:11:18Z"))
   return reply({error:"cron_only_new_groups"},403)
 const {data:links,error:linksError}=await db.from("order_group_orders").select("order_id,store_id").eq("group_id",group.id)
 if(linksError||!links?.length||links.length>12)return reply({error:"group_links_invalid"},422)
 const {data:orders,error:ordersError}=await db.from("orders").select("id,store_id,public_number,store_snapshot,status,user_id").in("id",links.map(x=>x.order_id))
 if(ordersError||!orders||orders.length!==links.length||orders.some(o=>o.user_id!==group.user_id||o.status==="CANCELADO"))return reply({error:"orders_not_eligible"},409)
 // Recover from browser/session interruption: private PDFs are created server-side.
 let pdfReady=0
 for(const order of orders){
   const {data:prior,error:priorError}=await db.from("ibuild_order_documents").select("order_id").eq("order_id",order.id).maybeSingle()
   if(priorError)return reply({error:"pdf_lookup_failed",pdf_ready:pdfReady},503)
   if(prior){pdfReady++;continue}
   try{
     const generated=await fetch(dbUrl+"/functions/v1/ibuild-order-pdf",{
       method:"POST",headers:{"Authorization":"Bearer "+service,"Content-Type":"application/json"},
       body:JSON.stringify({order_id:order.id}),signal:AbortSignal.timeout(30000)
     })
     const result=await generated.json().catch(()=>({}))
     if(!generated.ok||result?.ok!==true||result?.document?.order_id!==order.id)
       return reply({error:"pdf_generation_incomplete",pdf_ready:pdfReady},503)
     pdfReady++
   }catch{return reply({error:"pdf_generation_unavailable",pdf_ready:pdfReady},503)}
 }
 const key=env("IBUILD_RESEND_API_KEY"),sender=env("IBUILD_EMAIL_FROM"),recipient=env("IBUILD_OWNER_EMAIL")
 if(!key||!sender||!formatEmail(recipient))return reply({configured:false,accepted:0,pdf_ready:pdfReady,expected:orders.length,reason:"owner_email_transport_not_configured"})
 const {data:owners,error:ownerError}=await db.from("profiles").select("id,email").eq("platform_role","SUPER_ADMIN").eq("active",true)
 if(ownerError||!owners?.some(o=>String(o.email||"").toLowerCase()===recipient.toLowerCase()))
   return reply({configured:false,accepted:0,pdf_ready:pdfReady,expected:orders.length,reason:"owner_recipient_not_verified"})
 const config=await db.from("ibuild_notification_config").select("admin_phone").eq("id",1).maybeSingle()
 const ownerPhone=String(config.data?.admin_phone||"").replace(/\D/g,"")
 const permittedWhatsApp=/^[1-9][0-9]{9,14}$/.test(ownerPhone)
 const outcomes:Array<{order_id:string;state:string}>=[]
 for(const order of orders){
  const {data:existing,error:lookupError}=await db.from("ibuild_email_outbox").select("id,state").eq("order_id",order.id).maybeSingle()
  if(lookupError){outcomes.push({order_id:order.id,state:"LOOKUP_FAILED"});continue}
  let row=existing
  if(!row){
   const {data:inserted,error:insertError}=await db.from("ibuild_email_outbox").insert({order_id:order.id,store_id:order.store_id,state:"PENDENTE"}).select("id,state").single()
   if(insertError){
    if(insertError.code!=="23505"){outcomes.push({order_id:order.id,state:"QUEUE_CREATE_FAILED"});continue}
    const retry=await db.from("ibuild_email_outbox").select("id,state").eq("order_id",order.id).single()
    row=retry.data
   }else row=inserted
  }
  if(!row){outcomes.push({order_id:order.id,state:"QUEUE_UNAVAILABLE"});continue}
  if(row.state!=="PENDENTE"){outcomes.push({order_id:order.id,state:row.state});continue}
  const {data:claimed,error:claimError}=await db.from("ibuild_email_outbox")
   .update({state:"EM_PROCESSAMENTO",locked_at:new Date().toISOString(),attempts:1,updated_at:new Date().toISOString()})
   .eq("id",row.id).eq("state","PENDENTE").select("id").maybeSingle()
  if(claimError||!claimed){outcomes.push({order_id:order.id,state:"OTHER_WORKER_OR_ERROR"});continue}
  let postAttempted=false
  let nextState="RESULTADO_INCERTO",providerId:string|null=null,errorCode:string|null=null
  try{
   const {data:doc,error:docError}=await db.from("ibuild_order_documents").select("order_id,storage_path,store_id").eq("order_id",order.id).single()
   if(docError||!doc||doc.store_id!==order.store_id)throw new Error("PDF_NOT_READY")
   const {data:signed,error:signError}=await db.storage.from("ibuild-order-pdfs").createSignedUrl(doc.storage_path,86400)
   if(signError||!signed?.signedUrl)throw new Error("PDF_LINK_NOT_READY")
   const {data:items,error:itemsError}=await db.from("order_items").select("quantity,base_unit_price_snapshot,unit_price_snapshot").eq("order_id",order.id)
   if(itemsError||!items?.length)throw new Error("ITEMS_NOT_READY")
   const count=items.reduce((n,i)=>n+Number(i.quantity),0)
   const subtotal=items.reduce((n,i)=>n+Math.round(Number(i.base_unit_price_snapshot??i.unit_price_snapshot)*100)*Number(i.quantity),0)/100
   const store=String(order.store_snapshot?.store_name||"Loja").slice(0,85)
   const msg="iBuild — Pedido "+order.public_number+" | "+store+" | "+count+" unidades | "+money(subtotal)+" | PDF privado: "+signed.signedUrl
   const wa=permittedWhatsApp?"https://wa.me/"+ownerPhone+"?text="+encodeURIComponent(msg):""
   const subject="iBuild | Pedido "+order.public_number+" | "+store
   const plain=msg+"\n\nO WhatsApp requer clique em Enviar. Nenhum pedido foi pago. Link temporário válido por 24 horas."
   const page="<p>Solicitação recebida pelo iBuild. Pedido <strong>"+html(order.public_number)+"</strong>.</p><p>Loja: "+html(store)+" · "+count+" unidades · Total de referência: "+html(money(subtotal))+"</p><p><a href=\""+html(signed.signedUrl)+"\">Abrir/baixar PDF individual (24 horas)</a></p>"+
     (wa?"<p><a href=\""+html(wa)+"\">Abrir WhatsApp com mensagem pronta (envio manual)</a></p>":"")+
     "<p>Sem cobrança. Este e-mail informa o pedido; o clique no WhatsApp não envia a mensagem automaticamente.</p>"
   postAttempted=true
   const response=await fetch("https://api.resend.com/emails",{
    method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":"ibuild-owner-"+order.id+"-v1"},
    body:JSON.stringify({from:sender,to:[recipient],subject,html:page,text:plain}),signal:AbortSignal.timeout(12000)
   })
   const payload=await response.json().catch(()=>({}))
   if(response.ok&&typeof payload.id==="string"){
    nextState="ACEITO";providerId=payload.id
   }else{
    nextState=response.status===429?"FALHA":response.status>=500?"RESULTADO_INCERTO":"FALHA"
    errorCode="provider_http_"+response.status
   }
  }catch(err){
   const tag=err instanceof Error?err.message:"unexpected"
   errorCode=tag.startsWith("PDF_")||tag==="ITEMS_NOT_READY"?tag:"PROVIDER_RESULT_UNCERTAIN"
   nextState=postAttempted?"RESULTADO_INCERTO":"FALHA"
  }
  const {error:finishError}=await db.from("ibuild_email_outbox").update({
   state:nextState,provider_message_id:providerId,last_error_code:errorCode,
   accepted_at:nextState==="ACEITO"?new Date().toISOString():null,
   locked_at:null,updated_at:new Date().toISOString()
  }).eq("id",row.id).eq("state","EM_PROCESSAMENTO")
  outcomes.push({order_id:order.id,state:finishError?"RESULT_SAVE_FAILED":nextState})
 }
 return reply({configured:true,expected:orders.length,accepted:outcomes.filter(x=>x.state==="ACEITO").length,outcomes,delivery_proven:false})
})
