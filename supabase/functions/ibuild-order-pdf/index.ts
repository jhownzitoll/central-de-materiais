import { createClient } from "npm:@supabase/supabase-js@2.57.0"
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1"

const bucket = "ibuild-order-pdfs"
const origin = Deno.env.get("IBUILD_PUBLIC_ORIGIN") || "https://central-de-materiais.jonathan20014-jsdo.workers.dev"
const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" }
const reply = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } })
const env = (k: string) => Deno.env.get(k)?.trim() || ""
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(v)
const safe = (v: unknown, max = 150) => String(v ?? "").normalize("NFC").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"").replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, "?").slice(0, max)
const part = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "pedido"
const reais = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)
const digest = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b)))).map(x => x.toString(16).padStart(2, "0")).join("")

type Order = {
  id: string; store_id: string; public_number: string; status: string; total: number; notes?: string;
  created_at: string; delivery_method?: string;
  customer_snapshot: Record<string, any>; store_snapshot: Record<string, any>;
}
type Item = {
  order_id: string; product_name_snapshot: string; store_product_code_snapshot?: string;
  sku_snapshot?: string; quantity: number; unit_snapshot?: string;
  base_unit_price_snapshot?: number | null; unit_price_snapshot: number;
}

async function generate(order: Order, items: Item[]): Promise<Uint8Array> {
  if (items.length === 0 || items.some(i => i.order_id !== order.id)) throw new Error("PDF_ITEMS_INVALID")
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const WIDTH = 595.28, HEIGHT = 841.89, LEFT = 42, RIGHT = 553, BOTTOM = 68
  const ink = rgb(0.1, 0.17, 0.2), muted = rgb(0.35, 0.39, 0.42), accent = rgb(0.05, 0.43, 0.35)
  let page = pdf.addPage([WIDTH, HEIGHT]), y = HEIGHT - 145
  const header = () => {
    page.drawRectangle({ x: 0, y: HEIGHT - 102, width: WIDTH, height: 102, color: ink })
    page.drawText("iBUILD MATERIAIS", { x: LEFT, y: HEIGHT - 43, font: bold, size: 18, color: rgb(1, 1, 1) })
    page.drawText("PEDIDO INDIVIDUAL PARA FORNECEDOR", { x: LEFT, y: HEIGHT - 67, font: regular, size: 10, color: rgb(0.85, 0.95, 0.9) })
    page.drawText(safe(order.public_number, 48), { x: LEFT, y: HEIGHT - 86, font: bold, size: 9, color: rgb(1, 1, 1) })
    y = HEIGHT - 137
  }
  const next = () => { page = pdf.addPage([WIDTH, HEIGHT]); header() }
  const wrap = (text: string, font: typeof regular, size: number, maxWidth: number) => {
    const words = text.trim().split(/\s+/).filter(Boolean)
    const rows: string[] = []
    let row = ""
    for (let word of words) {
      while (word.length && font.widthOfTextAtSize(word, size) > maxWidth) {
        let i = 1
        while (i < word.length && font.widthOfTextAtSize(word.slice(0, i + 1), size) <= maxWidth) i++
        if (row) { rows.push(row); row = "" }
        rows.push(word.slice(0, i)); word = word.slice(i)
      }
      if (!word) continue
      const candidate = row ? row + " " + word : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) row = candidate
      else { if (row) rows.push(row); row = word }
    }
    if (row) rows.push(row)
    return rows.length ? rows : ["-"]
  }
  const line = (text: unknown, opts: { size?: number; emph?: boolean; color?: typeof ink; indent?: number; space?: number } = {}) => {
    const size = opts.size ?? 9, font = opts.emph ? bold : regular
    const max = RIGHT - LEFT - (opts.indent ?? 0)
    const rows = wrap(safe(text, 600), font, size, max)
    for (const row of rows) {
      if (y < BOTTOM + size + 5) next()
      page.drawText(row, { x: LEFT + (opts.indent ?? 0), y, font, size, color: opts.color ?? ink })
      y -= (size + 5)
    }
    y -= opts.space ?? 1
  }
  const section = (title: string) => { if (y < BOTTOM + 45) next(); y -= 8; line(title, { size: 11, emph: true, color: accent, space: 7 }) }
  header()
  section("FORNECEDOR")
  line("Loja: " + safe(order.store_snapshot?.store_name || "-", 90))
  line("Pedido: " + safe(order.public_number))
  line("Data: " + new Date(order.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))
  section("COMPRADOR")
  const buyer = order.customer_snapshot || {}
  line("Cliente: " + safe(buyer.trade_name || buyer.full_name || "-", 120))
  if (buyer.responsible_name) line("Responsavel: " + safe(buyer.responsible_name, 120))
  if (buyer.phone) line("Contato: " + safe(buyer.phone, 35))
  line("Modalidade: " + (order.delivery_method === "PICKUP" ? "Retirada" : "Entrega"))
  if (order.delivery_method !== "PICKUP") {
    const a = buyer.delivery_address
    if (a && typeof a === "object" && !Array.isArray(a)) {
      line("Endereco: " + [a.street, a.number, a.complement, a.district, a.city, a.state, a.postal_code].filter(Boolean).map(x => safe(x, 90)).join(", "))
    }
  }
  section("MATERIAIS SOLICITADOS")
  let baseCents = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const quantity = Number(item.quantity)
    const unit = Number(item.base_unit_price_snapshot ?? item.unit_price_snapshot)
    if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unit) || unit < 0) throw new Error("PDF_INVALID_ITEM")
    const cents = Math.round(unit * 100) * quantity
    baseCents += cents
    line(String(i + 1) + ". " + safe(item.product_name_snapshot, 190), { size: 9.5, emph: true })
    line("Codigo: " + safe(item.store_product_code_snapshot || item.sku_snapshot || "-") + " | " + quantity + " " + safe(item.unit_snapshot || "un", 12) + " x " + reais(unit) + " = " + reais(cents / 100), { size: 8.5, color: muted, indent: 10, space: 9 })
  }
  section("TOTAL DE REFERENCIA PARA A LOJA")
  line(reais(baseCents / 100), { size: 15, emph: true, color: accent, space: 9 })
  if (order.notes) { section("OBSERVACOES"); line(order.notes, { size: 9 }) }
  line("Solicitacao comercial intermediada pelo iBuild Materiais.", { size: 8, color: muted })
  line("Nao e nota fiscal nem comprovante de pagamento.", { size: 8, color: muted })
  const pages = pdf.getPages()
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: LEFT, y: 53 }, end: { x: RIGHT, y: 53 }, color: muted, thickness: 0.4 })
    p.drawText("iBuild Materiais - Pedido por loja", { x: LEFT, y: 38, font: regular, color: muted, size: 8 })
    p.drawText(String(index + 1) + " / " + pages.length, { x: RIGHT - 34, y: 38, font: regular, color: muted, size: 8 })
  })
  pdf.setTitle("Pedido " + safe(order.public_number) + " - " + safe(order.store_snapshot?.store_name || "Loja"))
  pdf.setAuthor("iBuild Materiais")
  return pdf.save()
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405)
  const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY"), service = env("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !anon || !service) return reply({ error: "server_not_configured" }, 503)
  const auth = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || ""
  if (!auth) return reply({ error: "auth_required" }, 401)
  const internal = auth === service
  if (!internal) {
    const scoped = createClient(url, anon, { global: { headers: { Authorization: "Bearer " + auth } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: identity, error: idError } = await scoped.auth.getUser(auth)
    if (idError || !identity.user) return reply({ error: "unauthorized" }, 401)
    const { data: profile, error: roleError } = await scoped.from("profiles").select("platform_role,active").eq("id", identity.user.id).single()
    if (roleError || !profile?.active || profile.platform_role !== "SUPER_ADMIN") return reply({ error: "admin_only" }, 403)
  }
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return reply({ error: "invalid_json" }, 400) }
  if (!uuid(body.order_id)) return reply({ error: "invalid_order_id" }, 400)
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const orderId = body.order_id
  const { data: old, error: oldErr } = await admin.from("ibuild_order_documents").select("order_id,store_id,storage_path,file_name,size_bytes,sha256").eq("order_id", orderId).maybeSingle()
  if (oldErr) return reply({ error: "document_query_failed" }, 503)
  if (old) return reply({ ok: true, document: old, created: false })
  const [orderResult, itemsResult] = await Promise.all([
    admin.from("orders").select("id,store_id,public_number,status,total,notes,created_at,delivery_method,customer_snapshot,store_snapshot").eq("id", orderId).single(),
    admin.from("order_items").select("order_id,product_name_snapshot,store_product_code_snapshot,sku_snapshot,quantity,unit_snapshot,base_unit_price_snapshot,unit_price_snapshot").eq("order_id", orderId).order("id"),
  ])
  if (orderResult.error || itemsResult.error || !orderResult.data || !itemsResult.data?.length) return reply({ error: "order_or_items_not_found" }, 404)
  const order = orderResult.data as Order
  if (order.status === "CANCELADO") return reply({ error: "order_cancelled" }, 409)
  let generated: Uint8Array
  try { generated = await generate(order, itemsResult.data as Item[]) } catch { return reply({ error: "pdf_generation_failed" }, 422) }
  if (generated.length < 100 || generated.length > 10000000) return reply({ error: "pdf_size_invalid" }, 422)
  const fileName = "iBuild_" + part(order.public_number) + "_" + part(order.store_snapshot?.store_name) + ".pdf"
  const storagePath = order.id + "/" + fileName
  const { error: uploadErr } = await admin.storage.from(bucket).upload(storagePath, new Blob([new Uint8Array(generated)], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false, cacheControl: "3600" })
  let finalBytes = generated
  if (uploadErr) {
    const { data: prior } = await admin.storage.from(bucket).download(storagePath)
    if (!prior) return reply({ error: "pdf_private_upload_failed" }, 503)
    finalBytes = new Uint8Array(await prior.arrayBuffer())
  }
  const document = { order_id: order.id, store_id: order.store_id, storage_path: storagePath, file_name: fileName, size_bytes: finalBytes.byteLength, sha256: await digest(finalBytes) }
  const { error: insertErr } = await admin.from("ibuild_order_documents").insert(document)
  if (insertErr) {
    const { data: again } = await admin.from("ibuild_order_documents").select("order_id,store_id,storage_path,file_name,size_bytes,sha256").eq("order_id", orderId).maybeSingle()
    if (again) return reply({ ok: true, document: again, created: false })
    return reply({ error: "document_metadata_failed" }, 503)
  }
  return reply({ ok: true, document, created: true })
})