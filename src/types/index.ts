export type PlatformRole = 'CLIENTE' | 'SUPER_ADMIN'
export type StoreMemberRole = 'STORE_ADMIN' | 'SELLER'
export type PersonType = 'CPF' | 'CNPJ'
export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING_REVIEW' | 'MERGED'
export type OrderStatus = 'NOVO' | 'EM_ATENDIMENTO' | 'ORCAMENTO' | 'CONFIRMADO' | 'CANCELADO' | 'FINALIZADO'

export interface Store { id:string; slug:string; name:string; legal_name:string|null; cnpj:string|null; email:string|null; phone:string|null; description:string|null; logo_key:string|null; logo_url:string|null; active:boolean; featured:boolean; display_order:number }
export interface StoreSettings { store_id:string; subtitle:string|null; seller_name:string|null; seller_whatsapp:string|null; seller_email:string|null; price_notice:string; order_instructions:string|null; pickup_info:string|null; delivery_info:string|null }
export interface StoreMembership { id:string; store_id:string; user_id:string; role:StoreMemberRole; active:boolean; stores?:Store }
export interface Product { id:string; sku:string; category_id:string|null; owner_store_id?:string|null; category_name?:string; name:string; unit:string; brand:string|null; description:string|null; image_key:string|null; image_url:string|null; display_order:number; status?:ProductStatus; internal_code?:string|null; active?:boolean; created_at?:string; updated_at?:string; offer_id?:string; store_id?:string; store_name?:string; store_slug?:string; store_product_code?:string|null; custom_name?:string|null; custom_description?:string|null; custom_brand?:string|null; section_label?:string|null; price:number; promotional_price?:number|null; offer_active?:boolean; availability_note?:string|null; effective_price?:number }
export interface Category { id:string; name:string; slug:string; display_order:number; active:boolean }
export interface Profile { id:string; email:string; platform_role:PlatformRole; person_type:PersonType|null; document:string|null; full_name:string|null; trade_name:string|null; phone:string|null; active:boolean; created_at?:string; updated_at?:string }
export interface PlatformConfig { id?:number; site_name:string; site_subtitle:string; default_store_id:string|null; primary_color:string; public_price_notice:string }
export interface CartLine { sku:string; qty:number }
export interface Order { id:string; public_number:string; user_id:string; store_id:string; customer_snapshot:Record<string,unknown>; store_snapshot:Record<string,unknown>; subtotal:number; total:number; status:OrderStatus; idempotency_key:string; notes:string|null; seller_notes:string|null; created_at:string }
export interface OrderItem { id:string; order_id:string; product_id:string|null; offer_id:string|null; sku_snapshot:string; store_product_code_snapshot:string|null; product_name_snapshot:string; unit_snapshot:string; quantity:number; unit_price_snapshot:number; subtotal:number }
export interface CreateOrderResult { order_id:string; public_number:string; total:number; seller_name:string; seller_whatsapp:string; duplicate:boolean; report?:string }
