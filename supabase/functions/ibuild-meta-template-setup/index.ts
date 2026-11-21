import {createClient} from "npm:@supabase/supabase-js@2.57.0"
import {PDFDocument, StandardFonts, rgb} from "npm:pdf-lib@1.17.1"

const APP_ID='1118878157422771'
const WABA_ID='3030795093945086'
const TEMPLATE_NAME='ibuild_novo_pedido'
const env=(key:string)=>Deno.env.get(key)?.trim()||''
const reply=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
const code=(x:any)=>x?.error?.code??null
const desc=(x:any)=>typeof x?.error?.message==='string'?x.error.message.slice(0,280):null

async function makeSample():Promise<Uint8Array>{
 const pdf=await PDFDocument.create()
 const page=pdf.addPage([595,842])
 const bold=await pdf.embedFont(StandardFonts.HelveticaBold)
 const regular=await pdf.embedFont(StandardFonts.Helvetica)
 page.drawText('iBUILD MATERIAIS', {x:40,y:788,font:bold,size:23,color:rgb(0.08,0.32,0.29)})
 page.drawText('EXEMPLO FICTICIO DE PEDIDO POR LOJA', {x:40,y:750,font:bold,size:13})
 page.drawText('Pedido IB-EXEMPLO-001', {x:40,y:705,font:regular,size:12})
 page.drawText('Fornecedor: Loja Exemplo', {x:40,y:678,font:regular,size:12})
 page.drawText('Cliente: Cliente Exemplo', {x:40,y:651,font:regular,size:12})
 page.drawText('Produto: MDF branco, 2 unidades, R$ 75,00 cada', {x:40,y:612,font:regular,size:11})
 page.drawText('Total: R$ 150,00', {x:40,y:583,font:bold,size:12})
 page.drawText('Somente um exemplo para aprovacao do modelo WhatsApp.',{x:40,y:115,font:regular,size:10})
 page.drawText('Nenhum dado de pedido ou cliente real foi utilizado.',{x:40,y:95,font:regular,size:10})
 pdf.setTitle('Exemplo ficticio iBuild de pedido')
 return pdf.save()
}

Deno.serve(async(req)=>{
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405)
 const url=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY')
 if(!url||!service)return reply({error:'backend_missing'},503)
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const ts=req.headers.get('x-ibuild-cron-ts')||'',sig=req.headers.get('x-ibuild-cron-signature')||''
 const {data:valid,error:verifyError}=await db.rpc('ibuild_verify_cron',{p_ts:ts,p_sig:sig})
 if(verifyError||valid!==true)return reply({error:'unauthorized'},403)
 const token=env('IBUILD_META_SYSTEM_USER_TOKEN')||env('IBUILD_META_ACCESS_TOKEN')
 const version=env('IBUILD_META_GRAPH_VERSION')||'v26.0'
 if(!token||!/^v\d+\.\d+$/.test(version))return reply({error:'meta_auth_not_configured'},503)
 const base='https://graph.facebook.com/'+version
 const headers={Authorization:'Bearer '+token}
 const current=await fetch(base+'/'+WABA_ID+'/message_templates?fields=name,status,language,components&limit=100',{headers,signal:AbortSignal.timeout(12000)})
 const found=await current.json().catch(()=>({}))
 if(!current.ok)return reply({error:'read_templates_failed',http_status:current.status,meta_code:code(found),meta_message:desc(found)},502)
 const existing=(found.data||[]).find((v:any)=>v.name===TEMPLATE_NAME&&v.language==='pt_BR')
 if(existing){
   return reply({template_name:TEMPLATE_NAME,template_state:existing.status,already_exists:true,
    header_format:existing.components?.find((x:any)=>x.type==='HEADER')?.format||null})
 }
 const bytes=await makeSample()
 const query=new URLSearchParams({file_name:'ibuild_exemplo_pedido.pdf',file_length:String(bytes.length),file_type:'application/pdf'})
 const begin=await fetch(base+'/'+APP_ID+'/uploads?'+query.toString(),{method:'POST',headers,signal:AbortSignal.timeout(16000)})
 const beginData=await begin.json().catch(()=>({}))
 if(!begin.ok||typeof beginData.id!=='string')return reply({error:'sample_upload_session_failed',status:begin.status,code:code(beginData),message:desc(beginData)},502)
 const upload=await fetch(base+'/'+beginData.id,{method:'POST',headers:{Authorization:'OAuth '+token,'file_offset':'0','Content-Type':'application/pdf'},
  body:new Uint8Array(bytes),signal:AbortSignal.timeout(18000)})
 const uploadData=await upload.json().catch(()=>({}))
 if(!upload.ok||typeof uploadData.h!=='string')return reply({error:'sample_upload_failed',status:upload.status,code:code(uploadData),message:desc(uploadData)},502)
 const components=[
   {type:'HEADER',format:'DOCUMENT',example:{header_handle:[uploadData.h]}},
   {type:'BODY',
    text:'Novo pedido {{1}} registrado por {{2}} para {{3}}. Total de referencia: {{4}}. Quantidade: {{5}}. Consulte o pedido em {{6}}.',
    example:{body_text:[['IB-EXEMPLO-001','Cliente Exemplo','Loja Exemplo','R$ 150,00','2','https://central-de-materiais.jonathan20014-jsdo.workers.dev/admin/pedidos']]}},
   {type:'FOOTER',text:'iBuild Materiais - pedido para conferencia'}
 ]
 const payload={name:TEMPLATE_NAME,language:'pt_BR',category:'UTILITY',allow_category_change:true,components}
 const create=await fetch(base+'/'+WABA_ID+'/message_templates',{method:'POST',
  headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(19000)})
 const result=await create.json().catch(()=>({}))
 return reply({
   template_name:TEMPLATE_NAME,
   template_state:create.ok?result.status||'PENDING':'ERROR',
   created:create.ok,
   meta_http_status:create.status,
   meta_template_id:typeof result.id==='string'?result.id:null,
   meta_error_code:code(result),
   meta_error_message:desc(result),
   meta_error_subcode:result?.error?.error_subcode??null,
   meta_error_details:typeof result?.error?.error_data?.details==='string'?result.error.error_data.details.slice(0,300):null,
   meta_error_user_message:typeof result?.error?.error_user_msg==='string'?result.error.error_user_msg.slice(0,200):null
 })
})