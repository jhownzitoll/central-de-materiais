import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const e=(k:string)=>Deno.env.get(k)?.trim()||"";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const email=(v:unknown)=>typeof v==="string"&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const safe=(v:unknown,n=130)=>String(v??"").replace(/[\r\n\t\u0000-\u001f]/g," ").trim().slice(0,n);
async function digest(s:string){
  const bytes=new TextEncoder().encode(s);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
    .map(x=>x.toString(16).padStart(2,"0")).join("");
}
function sameHash(a:string,b:string){
  if(a.length!==b.length)return false;
  let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
function money(n:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(n)}
type Db=ReturnType<typeof createClient>;
async function ownerEmail(db:Db):Promise<string>{
  const {data:profiles,error}=await db.from("profiles").select("id,email").eq("platform_role","SUPER_ADMIN").eq("active",true);
  if(error||!profiles||profiles.length!==1||!email(profiles[0].email))return "";
  const {data,error:err}=await db.auth.admin.getUserById(profiles[0].id);
  if(err||!data.user?.email_confirmed_at||data.user.email?.toLowerCase()!==profiles[0].email.toLowerCase())return "";
  return profiles[0].email.toLowerCase();
}
Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const base=e("SUPABASE_URL"),service=e("SUPABASE_SERVICE_ROLE_KEY");
  if(!base||!service)return json({error:"backend_unavailable"},503);
  const token=req.headers.get("x-ibuild-gmail-token")||"";
  if(token.length<48||token.length>256)return json({error:"unauthorized"},401);
  const db=createClient(base,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:config,error:ce}=await db.from("ibuild_gmail_bridge_config").select("enabled,token_sha256,first_eligible_at").eq("id",1).maybeSingle();
  if(ce||!config?.enabled||!sameHash(await digest(token),config.token_sha256))
    return json({error:"unauthorized"},401);
  let request:Record<string,unknown>;
  try{request=await req.json();if(!request||typeof request!=="object"||Array.isArray(request))throw Error();}
  catch{return json({error:"invalid_json"},400);}
  const action=request.action,recipient=await ownerEmail(db);
  if(!recipient)return json({error:"owner_admin_email_not_verified"},503);
  if(action==="status"){
    const {count}=await db.from("ibuild_gmail_outbox").select("group_id",{count:"exact",head:true}).eq("state","PENDING");
    return json({ok:true,service:"ibuild-gmail-bridge",recipient,ready:true,pending:count??0,
      historical_orders_eligible:false,delivery_proven:false});
  }
  if(action==="report"){
    if(!uuid(request.group_id)||!uuid(request.claim_id))return json({error:"invalid_claim"},400);
    const state=request.status;
    if(!["ACCEPTED","FAILED","UNKNOWN"].includes(String(state)))return json({error:"invalid_result"},400);
    if(state==="FAILED"&&request.phase!=="BEFORE_SEND")return json({error:"failed_requires_pre_send_phase"},400);
    const code=safe(request.error_code||"NONE",115).replace(/[^A-Z0-9_-]/ig,"_");
    const current=new Date().toISOString();
    const {data,error}=await db.from("ibuild_gmail_outbox").update({
      state,detail_code:code,finished_at:current,updated_at:current,
      accepted_at:state==="ACCEPTED"?current:null
    }).eq("group_id",request.group_id).eq("claim_id",request.claim_id).eq("state","CLAIMED")
      .select("group_id,state").maybeSingle();
    if(error)return json({error:"report_failed"},503);
    if(!data)return json({error:"not_claimed_or_already_reported"},409);
    return json({ok:true,state:data.state,delivery_proven:false});
  }
  if(action!=="claim")return json({error:"unsupported_action"},400);

  // Exactly one consolidated order email per group; never select UNKNOWN,
  // FAILED or ACCEPTED entries, even across multiple Google executions.
  const {data:candidates,error:queueError}=await db.from("ibuild_gmail_outbox")
    .select("group_id").eq("state","PENDING").order("created_at",{ascending:true}).limit(4);
  if(queueError)return json({error:"queue_unavailable"},503);
  if(!candidates?.length)return json({ok:true,status:"EMPTY"});

  for(const candidate of candidates){
    const id=candidate.group_id;
    const {data:group,error:ge}=await db.from("order_groups").select("id,public_number,total,created_at,user_id").eq("id",id).maybeSingle();
    if(ge||!group||Date.parse(group.created_at)<Date.parse(config.first_eligible_at)
      ||Date.now()-Date.parse(group.created_at)<60_000)continue;
    const {data:links,error:le}=await db.from("order_group_orders").select("order_id,store_id").eq("group_id",id);
    if(le||!links?.length||links.length>12)continue;
    const {data:orders,error:oe}=await db.from("orders")
      .select("id,store_id,user_id,public_number,store_snapshot,total,status")
      .in("id",links.map(x=>x.order_id));
    if(oe||!orders||orders.length!==links.length
       ||orders.some(o=>o.user_id!==group.user_id||o.status==="CANCELADO")
       ||new Set(orders.map(o=>o.store_id)).size!==links.length)continue;

    const docs:Array<{url:string;file_name:string;size_bytes:number;sha256:string;store_name:string;number:string}>=[];
    let ready=true,totalSize=0;
    for(const order of orders){
      let {data:doc,error:de}=await db.from("ibuild_order_documents")
        .select("order_id,store_id,storage_path,file_name,size_bytes,sha256").eq("order_id",order.id).maybeSingle();
      if(de){ready=false;break;}
      if(!doc){
        try{
          const response=await fetch(base+"/functions/v1/ibuild-order-pdf",{
            method:"POST",
            headers:{"Authorization":"Bearer "+service,"apikey":service,"Content-Type":"application/json"},
            body:JSON.stringify({order_id:order.id}),
            signal:AbortSignal.timeout(30000)
          });
          const result=await response.json().catch(()=>({}));
          if(!response.ok||result?.ok!==true||result?.document?.order_id!==order.id){ready=false;break;}
          doc=result.document;
        }catch{ready=false;break;}
      }
      if(!doc||doc.store_id!==order.store_id||!Number.isSafeInteger(doc.size_bytes)
          ||doc.size_bytes<100||doc.size_bytes>8_000_000){ready=false;break;}
      totalSize+=doc.size_bytes;
      if(totalSize>15_000_000){ready=false;break;}
      const {data:signed,error:se}=await db.storage.from("ibuild-order-pdfs").createSignedUrl(doc.storage_path,900);
      if(se||!signed?.signedUrl){ready=false;break;}
      docs.push({url:signed.signedUrl,file_name:safe(doc.file_name,130),size_bytes:doc.size_bytes,
        sha256:String(doc.sha256||""),store_name:safe(order.store_snapshot?.store_name||"Fornecedor",100),
        number:safe(order.public_number,35)});
    }
    if(!ready||docs.length!==orders.length)continue;
    const claimId=crypto.randomUUID();
    const claimed=new Date().toISOString();
    const {data:claim,error:claimError}=await db.from("ibuild_gmail_outbox")
      .update({state:"CLAIMED",claim_id:claimId,claimed_at:claimed,updated_at:claimed})
      .eq("group_id",id).eq("state","PENDING").select("group_id").maybeSingle();
    if(claimError)return json({error:"claim_database_unavailable"},503);
    if(!claim)continue;
    const lines=docs.map((d,i)=>String(i+1)+". "+d.store_name+" | "+d.number+" | PDF em anexo");
    return json({ok:true,status:"CLAIMED",group_id:id,claim_id:claimId,
      recipient,
      subject:"iBuild | Novo pedido "+safe(group.public_number,44),
      text:"iBuild Materiais — pedido consolidado "+safe(group.public_number,44)+
        "\nTotal de referência: "+money(Number(group.total))+
        "\nFornecedores ("+orders.length+"):\n"+lines.join("\n")+
        "\n\nPedido sem cobrança automática. Os PDFs individuais seguem anexados.\n"+
        "Confira e encaminhe aos fornecedores somente depois da validação administrativa.",
      attachments:docs,
      delivery_proven:false
    });
  }
  return json({ok:true,status:"NO_READY_PDF_GROUP"});
});
