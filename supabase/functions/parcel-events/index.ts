import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
// Use the same pure status/date rules as the browser import mapper.
import { normalizeStatus, parseDate } from "../../../lib/model.mjs";
const reply = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
Deno.serve(async (request) => {
  if (request.method !== "POST") return reply(405, { error: "POST required" });
  const secret = Deno.env.get("PARCEL_WEBHOOK_TOKEN");
  if (!secret || secret.length < 32)
    return reply(503, { error: "Receiver is not configured" });
  // Hash both values before comparing so header length/content do not leak the expected token.
  const digest = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [a, b] = await Promise.all([
    digest(secret),
    digest(request.headers.get("x-api-key") || ""),
  ]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return reply(401, { error: "Unauthorized" });
  try {
    // Bound streamed body, not just an attacker-supplied Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: "Body required" });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) {
        await reader.cancel();
        return reply(413, { error: "Payload too large" });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || Array.isArray(payload) || typeof payload !== "object")
      return reply(422, { error: "Tracking object required" });
    const awb = String(payload.awb || payload.awb_code || "").trim();
    const status = normalizeStatus(
      payload.shipment_status ??
        payload.current_status ??
        payload.shipment_status_id,
    );
    const at = parseDate(
      payload.current_timestamp ??
        payload.status_updated_at ??
        payload.timestamp,
    );
    if (
      !awb ||
      awb.length > 100 ||
      status === "Unknown" ||
      !at ||
      new Date(at).getTime() > Date.now() + 300000
    )
      return reply(422, {
        error: "AWB, status and valid event timestamp required",
      });
    // Canonical semantic key prevents duplicate deliveries with reordered JSON fields.
    const key = Array.from(await digest(JSON.stringify([awb, status, at])))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await admin.rpc("next_apply_event", {
      p_key: key,
      p_awb: awb,
      p_status: status,
      p_at: at,
      p_payload: payload,
      p_courier: payload.courier_name || null,
    });
    if (error) {
      console.error("Event transaction failed", error.code);
      return reply(500, { error: "Event could not be persisted; retry" });
    }
    return reply(200, { result: data });
  } catch {
    return reply(400, { error: "Invalid JSON or tracking payload" });
  }
});
