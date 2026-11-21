import { createClient } from "npm:@supabase/supabase-js@2.57.0"
const origin=Deno.env.get("IBUILD_PUBLIC_ORIGIN")||"https://central-de-materiais.jonathan20014-jsdo.workers.dev"
const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin","Cache-Control":"no-store"}
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...headers,"Content-Type":"application/json"}})
const env=(k:string)=>Deno.env.get(k)?.trim()||""
const isUUID=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers})
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405)
 const url=env("SUPABASE_URL"),anon=env("SUPABASE_ANON_KEY"),service=env("SUPABASE_SERVICE_ROLE_KEY")
 if(!url||!anon||!service)return reply({error:"not_configured"},503)
 const bearer=req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
 if(!bearer)return reply({error:"auth_required"},401)
 const session=createClient(url,anon,{global:{headers:{"Authorization":"Bearer "+bearer}},auth:{persistSession:false,autoRefreshToken:false}})
 const {data:identity,error:identityError}=await session.auth.getUser(bearer)
 if(identityError||!identity.user)return reply({error:"invalid_session"},401)
 let input:Record<string,unknown>
 try{input=await req.json()}catch{return reply({error:"invalid_json"},400)}
 if(!isUUID(input.group_id))return reply({error:"invalid_group"},400)
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:group,error:groupError}=await db.from("order_groups").select("id,user_id").eq("id",input.group_id).single()
 if(groupError||!group||group.user_id!==identity.user.id)return reply({error:"group_not_found"},404)
 const {data:linked,error:linksError}=await db.from("order_group_orders").select("order_id").eq("group_id",group.id)
 if(linksError||!linked?.length||linked.length>20)return reply({error:"invalid_suborders"},422)
 const {data:orders,error:orderError}=await db.from("orders").select("id,user_id,status").in("id",linked.map(x=>x.order_id))
 if(orderError||!orders||orders.length!==linked.length||orders.some(x=>x.user_id!==identity.user.id||x.status==="CANCELADO"))return reply({error:"invalid_group_orders"},409)
 let ready=0
 const failures:Array<{order_id:string;error:string}>=[]
 for(const entry of linked){
  try{
   const response=await fetch(url+"/functions/v1/ibuild-order-pdf",{
    method:"POST",headers:{"Authorization":"Bearer "+service,"Content-Type":"application/json"},
    body:JSON.stringify({order_id:entry.order_id}),signal:AbortSignal.timeout(25000)
   })
   const result=await response.json().catch(()=>({}))
   if(response.ok&&result.ok&&result.document?.order_id===entry.order_id)ready++
   else failures.push({order_id:entry.order_id,error:"pdf_http_"+response.status})
  }catch{failures.push({order_id:entry.order_id,error:"pdf_unavailable"})}
 }
 return reply({ok:failures.length===0,group_id:group.id,pdf_ready:ready,expected:linked.length,failures,delivery_status:"NOTIFICATION_NOT_CONFIRMED"},failures.length?207:200)
})
