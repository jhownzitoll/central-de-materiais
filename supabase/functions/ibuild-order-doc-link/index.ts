import { createClient } from "npm:@supabase/supabase-js@2.57.0"
const env=(k:string)=>Deno.env.get(k)?.trim()||""
const origin=env("IBUILD_PUBLIC_ORIGIN")||"https://central-de-materiais.jonathan20014-jsdo.workers.dev"
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin","Cache-Control":"no-store"}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}})
const validId=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors})
 if(req.method!=="POST")return json({error:"method_not_allowed"},405)
 const url=env("SUPABASE_URL"),anon=env("SUPABASE_ANON_KEY"),service=env("SUPABASE_SERVICE_ROLE_KEY")
 if(!url||!anon||!service)return json({error:"service_not_configured"},503)
 const token=req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]||""
 if(!token)return json({error:"unauthorized"},401)
 const session=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}})
 const {data:identity,error:authErr}=await session.auth.getUser(token)
 if(authErr||!identity.user)return json({error:"unauthorized"},401)
 const {data:profile,error:profErr}=await session.from("profiles").select("platform_role,active").eq("id",identity.user.id).single()
 if(profErr||!profile?.active||profile.platform_role!=="SUPER_ADMIN")return json({error:"admin_only"},403)
 let body:Record<string,unknown>
 try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
 if(!validId(body.order_id))return json({error:"invalid_order_id"},400)
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:order,error:orderErr}=await db.from("orders").select("id,public_number,store_id,store_snapshot,status").eq("id",body.order_id).single()
 if(orderErr||!order)return json({error:"order_not_found"},404)
 if(order.status==="CANCELADO")return json({error:"cancelled"},409)
 let {data:doc,error:docErr}=await db.from("ibuild_order_documents").select("order_id,store_id,storage_path,size_bytes,sha256").eq("order_id",order.id).maybeSingle()
 if(docErr)return json({error:"document_lookup_failed"},503)
 if(!doc){
  const response=await fetch(url+"/functions/v1/ibuild-order-pdf",{method:"POST",headers:{"Authorization":"Bearer "+service,"Content-Type":"application/json"},body:JSON.stringify({order_id:order.id}),signal:AbortSignal.timeout(30000)}).catch(()=>null)
  if(!response||!response.ok)return json({error:"document_generation_failed",status:response?.status||0},503)
  const result=await response.json().catch(()=>({}))
  if(!result.ok||!result.document)return json({error:"document_generation_unconfirmed"},503)
  doc=result.document
 }
 if(!doc||doc.store_id!==order.store_id||!Number.isInteger(doc.size_bytes)||doc.size_bytes<100)return json({error:"invalid_document"},503)
 const {data:link,error:linkErr}=await db.storage.from("ibuild-order-pdfs").createSignedUrl(doc.storage_path,3600)
 if(linkErr||!link?.signedUrl)return json({error:"signed_url_failed"},503)
 const {data:cfg}=await db.from("ibuild_notification_config").select("admin_phone").eq("id",1).maybeSingle()
 const phone=String(cfg?.admin_phone||"").replace(/\D/g,"")
 const ownerVerified=phone==="5547920032476"
 const store=String(order.store_snapshot?.store_name||"Fornecedor").slice(0,85)
 const message=["iBuild Materiais — pedido para conferência", "Pedido: "+order.public_number,"Loja: "+store,"PDF privado (válido por 1 hora): "+link.signedUrl,"O link abre o PDF; esta mensagem NÃO foi enviada automaticamente."].join("\n")
 return json({ok:true,order_id:order.id,public_number:order.public_number,store_name:store,pdf_url:link.signedUrl,expires_in_seconds:3600,sha256:doc.sha256,size_bytes:doc.size_bytes,whatsapp_url:ownerVerified?"https://wa.me/"+phone+"?text="+encodeURIComponent(message):null,mode:"ASSISTED_OWNER_ONLY",auto_sent:false})
})
