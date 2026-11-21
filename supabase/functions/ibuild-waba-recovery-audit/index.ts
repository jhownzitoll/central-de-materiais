import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const env = (key: string) => Deno.env.get(key)?.trim() || "";
const WABA_ID = "3030795093945086";
const BUSINESS_ID = "1137445162104025";
const APP_ID = "1118878157422771";
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const summarizeError = (error: any) => ({
  code: typeof error?.code === "number" ? error.code : null,
  subcode: typeof error?.error_subcode === "number" ? error.error_subcode : null,
  type: typeof error?.type === "string" ? error.type.slice(0, 60) : null,
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const dbUrl = env("SUPABASE_URL");
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!dbUrl || !service) return reply({ error: "backend_not_ready" }, 503);

  const db = createClient(dbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const timestamp = req.headers.get("x-ibuild-cron-ts") || "";
  const signature = req.headers.get("x-ibuild-cron-signature") || "";
  const { data: permitted, error: authError } = await db.rpc("ibuild_verify_cron", {
    p_ts: timestamp, p_sig: signature,
  });
  if (authError || permitted !== true) return reply({ error: "unauthorized" }, 403);

  const token = env("IBUILD_META_SYSTEM_USER_TOKEN") || env("IBUILD_META_ACCESS_TOKEN");
  const version = env("IBUILD_META_GRAPH_VERSION") || "v26.0";
  if (!token || !/^v\d+\.\d+$/.test(version)) return reply({ error: "meta_credentials_not_ready" }, 503);

  const request = async (path: string, fields?: string): Promise<any> => {
    const url = new URL("https://graph.facebook.com/" + version + "/" + path);
    if (fields) url.searchParams.set("fields", fields);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(16000),
      });
      const data = await response.json().catch(() => ({}));
      return response.ok
        ? { http: response.status, data }
        : { http: response.status, error: summarizeError(data?.error) };
    } catch (error) {
      return { http: null, error: { type: error instanceof Error ? error.name : "network" } };
    }
  };

  const account = await request(
    WABA_ID,
    "id,name,status,account_review_status,business_verification_status,ownership_type,primary_funding_id,health_status"
  );
  const numberList = await request(
    WABA_ID + "/phone_numbers",
    "id,status,code_verification_status,platform_type,display_phone_number,verified_name"
  );
  const payments = await request(WABA_ID + "/payment_configurations");
  const apps = await request(WABA_ID + "/subscribed_apps");
  const business = await request(BUSINESS_ID, "id,name,verification_status");
  const app = await request(APP_ID, "id,name");

  const phones = Array.isArray(numberList?.data?.data)
    ? numberList.data.data.slice(0, 10).map((p: any) => ({
        id: typeof p.id === "string" ? p.id : null,
        status: typeof p.status === "string" ? p.status : null,
        verification: typeof p.code_verification_status === "string" ? p.code_verification_status : null,
        platform_type: typeof p.platform_type === "string" ? p.platform_type : null,
        display_number_last4:
          typeof p.display_phone_number === "string" ? p.display_phone_number.replace(/\D/g, "").slice(-4) : null,
      }))
    : [];

  const health = account?.data?.health_status;
  const healthEntities = Array.isArray(health?.entities)
    ? health.entities.slice(0, 8).map((entity: any) => ({
        entity_type: String(entity.entity_type || "").slice(0, 30),
        can_send_message: String(entity.can_send_message || "").slice(0, 30),
        errors: Array.isArray(entity.errors) ? entity.errors.slice(0, 6).map((e: any) => ({
          code: typeof e.error_code === "number" ? e.error_code : null,
          description: typeof e.error_description === "string" ? e.error_description.slice(0, 175) : null,
        })) : [],
      }))
    : [];

  return reply({
    checked_at: new Date().toISOString(),
    graph_version: version,
    business_id: BUSINESS_ID,
    waba_id: WABA_ID,
    waba_http: account.http,
    waba_error: account.error || null,
    waba_status: account?.data?.status || null,
    waba_review_status: account?.data?.account_review_status || null,
    business_verification_status: account?.data?.business_verification_status || null,
    ownership_type: account?.data?.ownership_type || null,
    waba_name: account?.data?.name || null,
    primary_funding_id_present: !!account?.data?.primary_funding_id,
    health_can_send: health?.can_send_message || null,
    health_entities: healthEntities,
    phones_http: numberList.http,
    phones_error: numberList.error || null,
    phones,
    payment_configurations_http: payments.http,
    payment_configurations_error: payments.error || null,
    payment_configurations_count: Array.isArray(payments?.data?.data) ? payments.data.data.length : null,
    subscribed_apps_http: apps.http,
    subscribed_apps_error: apps.error || null,
    subscribed_apps_count: Array.isArray(apps?.data?.data) ? apps.data.data.length : null,
    business_http: business.http,
    business_error: business.error || null,
    business_verification_direct: business?.data?.verification_status || null,
    app_http: app.http,
    app_error: app.error || null,
    app_name: app?.data?.name || null,
  });
});
