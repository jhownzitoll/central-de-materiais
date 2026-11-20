import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Order, OrderItem } from '../types'
import { formatMoney } from './money'

const WIDTH = 595.28
const HEIGHT = 841.89
const LEFT = 42
const RIGHT = WIDTH - LEFT
const BODY_WIDTH = RIGHT - LEFT
const DARK = rgb(0.12, 0.17, 0.22)
const TEAL = rgb(0.08, 0.42, 0.38)
const MUTED = rgb(0.42, 0.48, 0.51)
const LIGHT = rgb(0.94, 0.96, 0.96)

// Standard PDF fonts use WinAnsi. Keep Portuguese accents, but normalize unsupported glyphs.
const safe = (value: unknown) => String(value ?? '')
  .replace(/[\u2010-\u2015\u2212]/g, '-')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/\u2026/g, '...')
  .replace(/[\u2022\u25cf]/g, '-')
  .replace(/\u00a0/g, ' ')
  .replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, '?')

const display = (v: unknown) => {
  const s = safe(v).trim()
  return s || '-'
}

function wrap(value: unknown, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(value).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return ['-']
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    let rest = word
    while (rest.length > 0) {
      const candidate = line ? line + ' ' + rest : rest
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate
        break
      }
      if (line) {
        lines.push(line)
        line = ''
        continue
      }
      let length = 1
      while (length < rest.length && font.widthOfTextAtSize(rest.slice(0, length + 1), size) <= maxWidth) length++
      lines.push(rest.slice(0, length))
      rest = rest.slice(length)
    }
  }
  if (line) lines.push(line)
  return lines
}

const dateText = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? display(value)
    : date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}
const filenamePart = (s: unknown) => safe(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 52)

export async function createSupplierPdfFile(order: Order, items: OrderItem[]): Promise<File> {
  if (!items.length || items.some(item => item.order_id !== order.id)) {
    throw new Error('PDF_ITEMS_INVALID')
  }
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const sellerName = display(order.store_snapshot?.store_name)
  const buyer = order.customer_snapshot || {}
  const buyerName = display(buyer.trade_name || buyer.full_name)
  const receiving = order.delivery_method === 'PICKUP' ? 'Retirada na loja' : 'Entrega'
  let page: PDFPage = pdf.addPage([WIDTH, HEIGHT])
  let y = 0
  const minY = 75
  const drawText = (text: unknown, x: number, atY: number, size = 10, useBold = false,
    color = DARK, align: 'left' | 'right' = 'left') => {
    const value = safe(text)
    if (!value) return
    const usedFont = useBold ? bold : font
    const px = align === 'right' ? x - usedFont.widthOfTextAtSize(value, size) : x
    page.drawText(value, { x: px, y: atY, size, font: usedFont, color })
  }
  const header = (continued = false) => {
    if (continued) page = pdf.addPage([WIDTH, HEIGHT])
    page.drawRectangle({ x: 0, y: HEIGHT - 117, width: WIDTH, height: 117, color: DARK })
    page.drawRectangle({ x: 0, y: HEIGHT - 121, width: WIDTH, height: 4, color: TEAL })
    drawText('iBUILD MATERIAIS', LEFT, HEIGHT - 47, 18, true, rgb(1, 1, 1))
    drawText('PEDIDO PARA FORNECEDOR' + (continued ? ' - CONTINUAÇÃO' : ''),
      LEFT, HEIGHT - 71, 10.5, true, rgb(0.83, 0.92, 0.88))
    drawText('Pedido ' + order.public_number, LEFT, HEIGHT - 95, 9, false, rgb(1, 1, 1))
    drawText(dateText(order.created_at), RIGHT, HEIGHT - 95, 9, false, rgb(1, 1, 1), 'right')
    y = HEIGHT - 152
  }
  const ensure = (height: number) => {
    if (y - height < minY) header(true)
  }
  const section = (title: string) => {
    ensure(36)
    y -= 9
    drawText(title.toLocaleUpperCase('pt-BR'), LEFT, y, 10, true, TEAL)
    y -= 12
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.8, color: LIGHT })
    y -= 16
  }
  const detail = (label: string, value: unknown) => {
    const text = safe(label) + ': ' + display(value)
    const lines = wrap(text, font, 10, BODY_WIDTH)
    ensure(lines.length * 15 + 3)
    for (const line of lines) {
      drawText(line, LEFT, y, 10)
      y -= 15
    }
    y -= 2
  }
  const tableHead = () => {
    ensure(40)
    page.drawRectangle({ x: LEFT, y: y - 20, width: BODY_WIDTH, height: 26, color: LIGHT })
    drawText('MATERIAL / CÓDIGO', LEFT + 8, y - 11, 9, true)
    drawText('QTD.', 364, y - 11, 9, true, DARK, 'right')
    drawText('UNITÁRIO', 453, y - 11, 9, true, DARK, 'right')
    drawText('TOTAL', RIGHT - 8, y - 11, 9, true, DARK, 'right')
    y -= 31
  }
  header()
  section('Fornecedor')
  detail('Loja', sellerName)
  section('Comprador')
  detail('Cliente', buyerName)
  if (buyer.responsible_name && buyer.responsible_name !== buyerName) detail('Responsável', buyer.responsible_name)
  detail('Contato', buyer.phone)
  detail('Recebimento', receiving)
  if (order.delivery_method === 'DELIVERY' && buyer.delivery_address && typeof buyer.delivery_address === 'object'
    && !Array.isArray(buyer.delivery_address)) {
    const a = buyer.delivery_address as Record<string, unknown>
    detail('Endereço', [a.street, a.number, a.complement, a.district, a.city, a.state, a.postal_code]
      .filter(Boolean).map(safe).join(', '))
  }
  section('Materiais solicitados')
  tableHead()

  let totalCents = 0
  for (const item of items) {
    const unit = Number(item.base_unit_price_snapshot ?? item.unit_price_snapshot)
    if (!Number.isFinite(unit) || unit < 0 || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error('PDF_PRICE_INVALID')
    }
    const cents = Math.round(unit * 100)
    const sum = cents * item.quantity
    totalCents += sum
    const nameLines = wrap(item.product_name_snapshot, font, 9.5, 245)
    const codeLines = wrap('Cód.: ' + display(item.store_product_code_snapshot || item.sku_snapshot),font,8,245)
    const height = Math.max(36, 12 + nameLines.length * 13 + codeLines.length * 11)
    if (y - height < minY + 58) {
      header(true)
      tableHead()
    }
    const rowTop = y + 8
    page.drawRectangle({ x: LEFT, y: rowTop - height, width: BODY_WIDTH, height,
      color: rgb(0.985, 0.99, 0.99) })
    let at = rowTop - 14
    for (const name of nameLines) {
      drawText(name, LEFT + 8, at, 9.5, true)
      at -= 13
    }
    for (const code of codeLines) {
      drawText(code, LEFT + 8, at, 8, false, MUTED)
      at -= 11
    }
    drawText(item.quantity + ' ' + display(item.unit_snapshot), 364, rowTop - 16, 9, false,DARK,'right')
    drawText(formatMoney(cents / 100), 453, rowTop - 16, 9, false,DARK,'right')
    drawText(formatMoney(sum / 100), RIGHT - 8, rowTop - 16, 9, true,DARK,'right')
    y = rowTop - height - 6
  }

  ensure(77)
  y -= 12
  page.drawRectangle({ x: LEFT, y: y - 42, width: BODY_WIDTH, height: 47, color: LIGHT })
  drawText('TOTAL DE REFERÊNCIA PARA A LOJA', LEFT + 12, y - 17, 10, true, DARK)
  drawText(formatMoney(totalCents / 100), RIGHT - 12, y - 18, 14, true, TEAL, 'right')
  y -= 64

  if (order.notes?.trim()) {
    section('Observações do comprador')
    const notes = wrap(order.notes, font, 9, BODY_WIDTH)
    for (const note of notes) {
      ensure(14)
      drawText(note, LEFT, y, 9)
      y -= 14
    }
    y -= 8
  }
  ensure(52)
  const disclaimer = 'Solicitação comercial intermediada pelo iBuild Materiais. Valores sujeitos a confirmação.'
  for (const line of wrap(disclaimer, font, 8.4, BODY_WIDTH)) {
    ensure(13)
    drawText(line, LEFT, y, 8.4, false, MUTED)
    y -= 12
  }
  ensure(16)
  drawText('Este documento não é nota fiscal nem comprovante de pagamento.', LEFT, y, 8.4, false, MUTED)

  const pages = pdf.getPages()
  for (let idx = 0; idx < pages.length; idx++) {
    const current = pages[idx]
    current.drawLine({ start: { x: LEFT, y: 55 }, end: { x: RIGHT, y: 55 }, thickness: 0.5, color: LIGHT })
    current.drawText('iBuild Materiais - Pedido para fornecedor', {
      x: LEFT, y: 39, size: 8, font, color: MUTED,
    })
    const count = (idx + 1) + ' / ' + pages.length
    current.drawText(count, {
      x: RIGHT - font.widthOfTextAtSize(count, 8), y: 39, size: 8, font, color: MUTED,
    })
  }
  pdf.setTitle('Pedido ' + safe(order.public_number) + ' - ' + sellerName)
  pdf.setAuthor('iBuild Materiais')
  pdf.setSubject('Solicitação comercial individual para fornecedor')
  const bytes = await pdf.save()
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const fileName = ['iBuild',filenamePart(order.public_number),filenamePart(sellerName)].filter(Boolean).join('_') + '.pdf'
  return new File([buffer], fileName, { type: 'application/pdf', lastModified: Date.now() })
}

/** Opens the standard browser download dialog. No PDF data is uploaded to a third party. */
export function downloadSupplierPdf(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/**
 * Native share opens Android's chooser (WhatsApp, email, etc.), not a specific chat.
 * Caller must confirm send manually; on unsupported browsers, download instead.
 */
export async function shareSupplierPdf(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
    downloadSupplierPdf(file)
    return 'downloaded'
  }
  try {
    await navigator.share({ files: [file], title: 'Pedido iBuild - ' + file.name, text: 'Pedido de materiais em PDF para conferência.' })
    return 'shared'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    downloadSupplierPdf(file)
    return 'downloaded'
  }
}
