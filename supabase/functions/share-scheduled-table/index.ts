import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Shipment = Record<string, any>;
type Schedule = Record<string, any>;

const headers = { "content-type": "application/json; charset=utf-8" };
const OPEN = new Set(["In Transit", "NDR / Undelivered", "RTO In Progress"]);

Deno.serve(async (request) => {
  if (request.method !== "POST") return response(405, { error: "POST required" });
  const cronSecret = Deno.env.get("SHARV_CRON_SECRET");
  if (!cronSecret || request.headers.get("x-sharv-cron-secret") !== cronSecret) return response(401, { error: "Unauthorized" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
  if (!url || !serviceKey || !slackToken) return response(500, { error: "Scheduled sharing secrets are incomplete" });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const { data: due, error: dueError } = await admin.from("slack_share_schedules").select("*").eq("enabled", true).lte("next_run_at", now.toISOString()).limit(25);
  if (dueError) return response(500, { error: "Could not load due Slack schedules" });

  const results: Array<{ id: string; status: string }> = [];
  for (const schedule of due || []) {
    const nextRun = nextRunAt(schedule, now);
    const { data: claimed, error: claimError } = await admin.from("slack_share_schedules")
      .update({ next_run_at: nextRun, last_error: null })
      .eq("id", schedule.id).eq("enabled", true).lte("next_run_at", now.toISOString()).select("id").maybeSingle();
    if (claimError || !claimed) continue;
    try {
      const shipments = await fetchShipments(admin, schedule.filters || {});
      const table = buildTable(schedule.table_key, shipments, schedule.search_query || "");
      await sendTable(slackToken, schedule.channel_id, schedule.title, table.columns, table.rows);
      await admin.from("slack_share_schedules").update({ last_sent_at: new Date().toISOString(), last_error: null }).eq("id", schedule.id);
      results.push({ id: schedule.id, status: "sent" });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 500);
      await admin.from("slack_share_schedules").update({ next_run_at: now.toISOString(), last_error: message }).eq("id", schedule.id);
      results.push({ id: schedule.id, status: "failed" });
    }
  }
  return response(200, { processed: results.length, results });
});

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function fetchShipments(admin: ReturnType<typeof createClient>, filters: Record<string, any>): Promise<Shipment[]> {
  const fields = "source_system,awb,order_id,customer_account,recipient_name,courier,city,state,pincode,warehouse,payment_type,transport_mode,direction,status,status_group,order_date,pickup_date,delivered_date,edd,tat_days,sla_target_days,ageing_days,attempts,freight_inr,ndr_status,remark,on_time,raw_payload";
  const all: Shipment[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from("shipments").select(fields).order("order_date", { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error("Could not read the current shipment dataset.");
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const { data: rules, error: rulesError } = await admin.from("sla_rules").select("courier,customer_account,state,city,target_days,effective_from,effective_to").eq("active", true);
  if (rulesError) throw new Error("Could not read configured SLA targets.");
  const today = new Date().toISOString().slice(0, 10);
  all.forEach((row) => {
    if (row.sla_target_days != null) return;
    const onDate = String(row.order_date || today).slice(0, 10);
    const match = (rules || []).filter((rule) =>
      (!rule.courier || String(rule.courier).toLowerCase() === String(row.courier || "").toLowerCase()) &&
      (!rule.customer_account || String(rule.customer_account).toLowerCase() === String(row.customer_account || "").toLowerCase()) &&
      (!rule.state || String(rule.state).toLowerCase() === String(row.state || "").toLowerCase()) &&
      (!rule.city || String(rule.city).toLowerCase() === String(row.city || "").toLowerCase()) &&
      (!rule.effective_from || rule.effective_from <= onDate) && (!rule.effective_to || rule.effective_to >= onDate)
    ).sort((a, b) => [b.customer_account, b.city, b.state, b.courier].filter(Boolean).length - [a.customer_account, a.city, a.state, a.courier].filter(Boolean).length)[0];
    if (match) row.sla_target_days = Number(match.target_days);
  });
  const selected = all.filter((row) =>
    (!(filters.couriers || []).length || filters.couriers.includes(row.courier)) &&
    (!(filters.states || []).length || filters.states.includes(row.state)) &&
    (!(filters.statuses || []).length || filters.statuses.includes(row.status_group)) &&
    (!(filters.customers || []).length || filters.customers.includes(row.customer_account)) &&
    (!filters.from || String(row.order_date || "").slice(0, 10) >= filters.from) &&
    (!filters.to || String(row.order_date || "").slice(0, 10) <= filters.to)
  );
  return selected;
}

function cleanStatus(row: Shipment) { return String(row.status_group || row.status || "Unknown"); }
function isDelivered(row: Shipment) { return cleanStatus(row) === "Delivered"; }
function isRto(row: Shipment) { return cleanStatus(row).startsWith("RTO"); }
function isOpen(row: Shipment) { return OPEN.has(cleanStatus(row)); }
function deliveredOnTime(row: Shipment): boolean | null {
  if (typeof row.on_time === "boolean") return row.on_time;
  if (!isDelivered(row)) return null;
  if (row.delivered_date && row.edd) return new Date(row.delivered_date) <= new Date(row.edd);
  if (Number(row.sla_target_days) > 0 && row.tat_days !== null && row.tat_days !== undefined && Number.isFinite(Number(row.tat_days))) return Number(row.tat_days) <= Number(row.sla_target_days);
  return null;
}
function percentile(values: number[], q: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const fraction = position - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + fraction * (sorted[base + 1] - sorted[base]);
}
function metrics(rows: Shipment[]) {
  const delivered = rows.filter(isDelivered);
  const onTime = delivered.map(deliveredOnTime).filter((value): value is boolean => value !== null);
  const tat = delivered.map((row) => row.tat_days == null ? null : Number(row.tat_days)).filter((value): value is number => value !== null && Number.isFinite(value));
  const exceptions = rows.filter((row) => !isDelivered(row) && cleanStatus(row) !== "Cancelled" && (Number(row.ageing_days || 0) > 4 || Number(row.attempts || 0) > 1 || ["Lost / Damaged", "NDR / Undelivered"].includes(cleanStatus(row))));
  return {
    total: rows.length,
    delivered: delivered.length,
    deliveryRate: rows.length ? delivered.length / rows.length : null,
    slaRate: onTime.length ? onTime.filter(Boolean).length / onTime.length : null,
    rto: rows.filter(isRto).length,
    rtoRate: rows.length ? rows.filter(isRto).length / rows.length : null,
    open: rows.filter(isOpen).length,
    exceptions: exceptions.length,
    avgTat: tat.length ? tat.reduce((sum, value) => sum + value, 0) / tat.length : null,
    p90Tat: percentile(tat, .9),
    freight: rows.reduce((sum, row) => sum + (Number(row.freight_inr) || 0), 0)
  };
}
function groups<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  rows.forEach((row) => { const label = key(row) || "Unknown"; map.set(label, [...(map.get(label) || []), row]); });
  return map;
}
function metricRow(label: string, rows: Shipment[]) {
  const m = metrics(rows);
  return { [label]: label, Shipments: m.total, Delivered: m.delivered, "Delivery %": percent(m.deliveryRate), "SLA %": percent(m.slaRate), "RTO %": percent(m.rtoRate), "Avg TAT (days)": m.avgTat, "P90 TAT (days)": m.p90Tat, Exceptions: m.exceptions };
}
function percent(value: number | null) { return value == null ? null : value * 100; }
function payloadLines(row: Shipment) { return Array.isArray(row.raw_payload?.__lineItems) ? row.raw_payload.__lineItems : []; }
function lineValue(line: Record<string, any>, ...keys: string[]) {
  for (const key of keys) {
    const normalized = key.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const value = line[normalized];
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }
  return null;
}
function buildTable(key: string, allRows: Shipment[], query: string) {
  const dimensionKey = key.includes("state") ? "state" : key.includes("city") ? "city" : key.includes("pincode") ? "pincode" : "courier";
  const aggregateKeys = new Set(["perf-courier", "perf-state", "perf-city", "perf-pincode", "courier-scorecard", "courier", "overview-cities", "state-performance", "city-performance", "pincode-performance"]);
  let columns: string[];
  let rows: Record<string, unknown>[];
  if (key === "overview-cities") {
    columns = ["City", "Orders", "Delivered", "Delivery %", "SLA %"];
    rows = [...groups(allRows, (row) => String(row.city || "Unknown"))]
      .map(([City, bucket]) => { const m = metrics(bucket); return { City, Orders: m.total, Delivered: m.delivered, "Delivery %": percent(m.deliveryRate), "SLA %": percent(m.slaRate) }; })
      .sort((a, b) => Number(b.Orders) - Number(a.Orders)).slice(0, 10);
  } else if (aggregateKeys.has(key)) {
    columns = ["Name", "Shipments", "Delivered", "Delivery %", "SLA %", "RTO %", "Avg TAT (days)", "P90 TAT (days)", "Exceptions"];
    rows = [...groups(allRows, (row) => String(row[dimensionKey] || "Unknown"))]
      .map(([name, bucket]) => ({ Name: name, ...metricRow(name, bucket) }))
      .sort((a, b) => Number(b.Shipments) - Number(a.Shipments));
    if (["perf-courier", "perf-state", "perf-city", "courier-scorecard", "state-performance", "city-performance", "pincode-performance"].includes(key)) {
      columns = ["Group", "Shipments", "Delivered", "Delivery %", "SLA %", "RTO %", "Average TAT", "P90 TAT", "Exceptions"];
      rows = rows.map((row) => ({ Group: row.Name, Shipments: row.Shipments, Delivered: row.Delivered, "Delivery %": row["Delivery %"], "SLA %": row["SLA %"], "RTO %": row["RTO %"], "Average TAT": row["Avg TAT (days)"], "P90 TAT": row["P90 TAT (days)"], Exceptions: row.Exceptions }));
    }
  } else if (["perf-month", "month-detail", "sla-trend"].includes(key)) {
    columns = ["Month", "Shipments", "Delivered", "Delivery %", "SLA %", "RTO %"];
    const monthRows = [...groups(allRows, (row) => String(row.order_date || "").slice(0, 7) || "Unknown")];
    rows = monthRows.map(([Month, bucket]) => { const m = metrics(bucket); return { Month, Shipments: m.total, Delivered: m.delivered, "Delivery %": percent(m.deliveryRate), "SLA %": percent(m.slaRate), "RTO %": percent(m.rtoRate) }; }).sort((a, b) => String(a.Month).localeCompare(String(b.Month)));
  } else if (["perf-attempts", "attempt-matrix"].includes(key)) {
    columns = ["Courier", "Delivered · 1 or fewer", "Delivered · multiple", "RTO · attempted", "RTO · no attempt", "Open · attempted", "Open · no attempt"];
    rows = [...groups(allRows, (row) => String(row.courier || "Unknown"))].map(([Courier, bucket]) => ({
      Courier,
      "Delivered · 1 or fewer": bucket.filter((row) => isDelivered(row) && Number(row.attempts || 0) <= 1).length,
      "Delivered · multiple": bucket.filter((row) => isDelivered(row) && Number(row.attempts || 0) > 1).length,
      "RTO · attempted": bucket.filter((row) => isRto(row) && Number(row.attempts || 0) > 0).length,
      "RTO · no attempt": bucket.filter((row) => isRto(row) && Number(row.attempts || 0) === 0).length,
      "Open · attempted": bucket.filter((row) => isOpen(row) && Number(row.attempts || 0) > 0).length,
      "Open · no attempt": bucket.filter((row) => isOpen(row) && Number(row.attempts || 0) === 0).length
    }));
  } else if (["perf-rto-reasons", "rto-analysis"].includes(key)) {
    columns = ["Reason", "Orders", "Freight exposure", "Leading courier"];
    rows = [...groups(allRows.filter(isRto), (row) => String(row.remark || row.ndr_status || "No carrier reason recorded"))]
      .map(([Reason, bucket]) => ({ Reason, Orders: bucket.length, "Freight exposure": bucket.reduce((sum, row) => sum + (Number(row.freight_inr) || 0), 0), "Leading courier": [...groups(bucket, (row) => String(row.courier || "Unknown"))].sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "—" }))
      .sort((a, b) => Number(b.Orders) - Number(a.Orders));
  } else if (["perf-rto-courier"].includes(key)) {
    columns = ["Courier", "Orders", "RTO % of network", "Freight exposure", "Avg attempts"];
    const rto = allRows.filter(isRto);
    rows = [...groups(rto, (row) => String(row.courier || "Unknown"))].map(([Courier, bucket]) => ({ Courier, Orders: bucket.length, "RTO % of network": percent(allRows.length ? bucket.length / allRows.length : null), "Freight exposure": bucket.reduce((sum, row) => sum + (Number(row.freight_inr) || 0), 0), "Avg attempts": bucket.length ? bucket.reduce((sum, row) => sum + Number(row.attempts || 0), 0) / bucket.length : 0 }));
  } else if (key === "shipment-ledger") {
    columns = ["AWB / order", "Customer", "Recipient", "Courier", "Destination", "Payment", "Status", "Order date", "EDD", "TAT", "Attempts", "Freight"];
    rows = allRows.map((row) => ({ "AWB / order": `${row.awb}\n${row.order_id || ""}`, Customer: row.customer_account, Recipient: row.recipient_name, Courier: row.courier, Destination: `${row.city}, ${row.state}`, Payment: row.payment_type, Status: cleanStatus(row), "Order date": row.order_date, EDD: row.edd, TAT: row.tat_days, Attempts: row.attempts, Freight: row.freight_inr }));
  } else if (["perf-open", "open-queue"].includes(key)) {
    columns = ["Courier", "AWB", "Order ID", "Destination", "Status", "Attempts", "Age (days)", "Carrier remark"];
    const bucket = allRows.filter(isOpen).sort((a, b) => Number(b.ageing_days || 0) - Number(a.ageing_days || 0));
    rows = bucket.map((row) => ({ Courier: row.courier, AWB: row.awb, "Order ID": row.order_id, Destination: `${row.city}, ${row.state}`, Status: cleanStatus(row), Attempts: row.attempts, "Age (days)": row.ageing_days, "Carrier remark": row.remark || row.ndr_status || "—" }));
  } else if (key === "exceptions" || key === "exception-worklist") {
    const bucket = key === "exceptions"
      ? allRows.filter((row) => Number(row.ageing_days || 0) > 0).sort((a, b) => Number(b.ageing_days || 0) - Number(a.ageing_days || 0)).slice(0, 6)
      : allRows.filter((row) => !isDelivered(row) && cleanStatus(row) !== "Cancelled" && (Number(row.ageing_days || 0) > 4 || Number(row.attempts || 0) > 1 || ["Lost / Damaged", "NDR / Undelivered"].includes(cleanStatus(row)))).sort((a, b) => Number(b.ageing_days || 0) - Number(a.ageing_days || 0));
    if (key === "exceptions") {
      columns = ["AWB", "Order ID", "Courier", "Destination", "Status", "Age (days)", "Attempts", "Customer"];
      rows = bucket.slice(0, 6).map((row) => ({ AWB: row.awb, "Order ID": row.order_id, Courier: row.courier, Destination: `${row.city}, ${row.state}`, Status: cleanStatus(row), "Age (days)": row.ageing_days, Attempts: row.attempts, Customer: row.customer_account }));
    } else {
      columns = ["AWB", "Order ID", "Courier", "Customer", "Destination", "Status", "Age (days)", "Attempts", "EDD", "Carrier reason", "Recommended action"];
      rows = bucket.slice(0, 120).map((row) => ({ AWB: row.awb, "Order ID": row.order_id, Courier: row.courier, Customer: row.customer_account, Destination: `${row.city}, ${row.state} · ${row.pincode || "pin unavailable"}`, Status: cleanStatus(row), "Age (days)": row.ageing_days, Attempts: row.attempts, EDD: row.edd, "Carrier reason": row.remark || row.ndr_status || "—", "Recommended action": row.remark || row.ndr_status ? "Request courier update and confirm next delivery attempt." : "Contact carrier for a delivery scan and next action." }));
    }
  } else if (key === "customer-analytics") {
    columns = ["Customer", "Address", "Orders", "Classification", "Units", "On-time %", "Courier"];
    const identities = allRows.map((row) => {
      const lines = payloadLines(row);
      const address = String(lineValue(lines[0] || {}, "customer address", "shipping address", "address", "delivery address") || "").trim();
      const name = row.customer_account && row.customer_account !== "Unassigned customer" ? row.customer_account : row.recipient_name && row.recipient_name !== "Not provided" ? row.recipient_name : "";
      return { row, name, address };
    }).filter((item) => item.name && item.address);
    rows = [...groups(identities, (item) => `${item.name} ${item.address}`)].map(([, bucket]) => {
      const shipments = bucket.map((item) => item.row);
      const kpi = metrics(shipments);
      return { Customer: bucket[0].name, Address: bucket[0].address, Orders: shipments.length, Classification: shipments.length > 1 ? "Repeat Customer" : "New Customer", Units: shipments.reduce((sum, row) => sum + payloadLines(row).reduce((subtotal, line) => subtotal + (Number(lineValue(line, "quantity", "qty", "item quantity", "units")) || 0), 0), 0), "On-time %": percent(kpi.slaRate), Courier: [...groups(shipments, (row) => String(row.courier || "Unknown"))].sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "—" };
    });
  } else if (["overview-products", "insight-products", "product-geography"].includes(key)) {
    const products = new Map<string, Record<string, any>>();
    const geography = new Map<string, Record<string, any>>();
    allRows.forEach((row) => payloadLines(row).forEach((line) => {
      const productName = String(lineValue(line, "product name", "product", "item name", "description", "product title") || lineValue(line, "product sku", "sku", "seller sku", "item sku") || "Unspecified product");
      const sku = String(lineValue(line, "product sku", "sku", "seller sku", "item sku") || "—");
      const quantity = Number(lineValue(line, "quantity", "qty", "item quantity", "units")) || 0;
      const item = products.get(productName) || { Product: productName, SKU: sku, Quantity: 0, Lines: 0 };
      item.Quantity += quantity; item.Lines += 1; products.set(productName, item);
      if (key === "product-geography") for (const [place, Level] of [[row.city, "City"], [row.state, "State"]]) {
        if (!place || place === "Unknown") continue;
        const mapKey = `${productName} ${place}`;
        const geo = geography.get(mapKey) || { Level, Product: productName, Geography: place, Units: 0, Lines: 0 };
        geo.Units += quantity; geo.Lines += 1; geography.set(mapKey, geo);
      }
    }));
    if (["overview-products", "insight-products"].includes(key)) {
      columns = ["Product", "SKU", "Units", "Lines"];
      rows = [...products.values()].map((item) => ({ Product: item.Product, SKU: item.SKU, Units: item.Quantity, Lines: item.Lines })).sort((a, b) => Number(b.Units) - Number(a.Units)).slice(0, key === "overview-products" ? 8 : 12);
    } else {
      columns = ["Level", "Product", "Geography", "Units"];
      rows = [...geography.values()].sort((a, b) => Number(b.Units) - Number(a.Units)).slice(0, 20);
    }
  } else if (key === "courier-action-plan") {
    columns = ["Courier", "Exceptions", "High", "Most common recorded signal", "Recommended action"];
    const exceptions = allRows.filter((row) => !isDelivered(row) && cleanStatus(row) !== "Cancelled" && (Number(row.ageing_days || 0) > 4 || Number(row.attempts || 0) > 1 || ["Lost / Damaged", "NDR / Undelivered"].includes(cleanStatus(row))));
    rows = [...groups(exceptions, (row) => String(row.courier || "Unknown"))].map(([Courier, bucket]) => ({ Courier, Exceptions: bucket.length, High: bucket.filter((row) => Number(row.ageing_days || 0) > 7 || cleanStatus(row) === "Lost / Damaged").length, "Most common recorded signal": [...groups(bucket.filter((row) => row.remark || row.ndr_status), (row) => String(row.remark || row.ndr_status))].sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "No reason supplied", "Recommended action": "Review lane performance and request a dated corrective-action plan." }));
  } else {
    throw new Error("This table type cannot be rebuilt by the scheduled Slack service yet.");
  }
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery) rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(normalizedQuery));
  return { columns, rows };
}

async function sendTable(token: string, channel: string, title: string, columns: string[], rows: Record<string, unknown>[]) {
  const csv = [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
  if (rows.length <= 25 && csv.length < 3500) {
    const table = [columns.join(" | "), ...rows.map((row) => columns.map((column) => String(row[column] ?? "—")).join(" | "))].join("\n");
    const result = await slackApi(token, "chat.postMessage", { channel, text: `*${title}* · ${rows.length} rows\n\n\`${table}\`` });
    if (!result.ok) throw new Error(result.error || "Slack rejected the message");
    return;
  }
  const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sharv-table"}.csv`;
  const upload = await slackApi(token, "files.getUploadURLExternal", { filename, length: new TextEncoder().encode(csv).length });
  if (!upload.ok || !upload.upload_url || !upload.file_id) throw new Error(upload.error || "Slack could not prepare the table file");
  const uploaded = await fetch(upload.upload_url, { method: "POST", headers: { "content-type": "text/csv" }, body: csv });
  if (!uploaded.ok) throw new Error("Slack rejected the table file upload");
  const complete = await slackApi(token, "files.completeUploadExternal", { files: [{ id: upload.file_id, title }], channel_id: channel, initial_comment: `*${title}* · ${rows.length} rows, rebuilt from the latest shipment data.` });
  if (!complete.ok) throw new Error(complete.error || "Slack could not share the table file");
}

async function slackApi(token: string, method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://slack.com/api/${method}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(payload) });
  return await response.json();
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}
function fromZonedLocal(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(target);
  for (let index = 0; index < 3; index += 1) {
    const parts = zonedParts(guess, timezone);
    guess = new Date(guess.getTime() + target - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  }
  return guess;
}
function nextRunAt(schedule: Schedule, after: Date) {
  const [hour, minute] = String(schedule.schedule_time).slice(0, 5).split(":").map(Number);
  const local = zonedParts(after, schedule.timezone);
  for (let offset = 0; offset < (schedule.frequency === "daily" ? 400 : schedule.frequency === "monthly" ? 72 : 30); offset += 1) {
    let year = local.year, month = local.month, day = local.day;
    if (schedule.frequency === "daily") {
      const candidate = new Date(Date.UTC(year, month - 1, day + offset)); year = candidate.getUTCFullYear(); month = candidate.getUTCMonth() + 1; day = candidate.getUTCDate();
    } else if (schedule.frequency === "monthly") {
      const candidate = new Date(Date.UTC(year, month - 1 + offset, 1)); year = candidate.getUTCFullYear(); month = candidate.getUTCMonth() + 1; day = Math.min(Number(schedule.schedule_day), new Date(Date.UTC(year, month, 0)).getUTCDate());
    } else {
      year += offset; month = Number(schedule.schedule_month); day = Math.min(Number(schedule.schedule_day), new Date(Date.UTC(year, month, 0)).getUTCDate());
    }
    const next = fromZonedLocal(year, month, day, hour, minute, schedule.timezone);
    if (next > after) return next.toISOString();
  }
  throw new Error("Could not calculate the next scheduled run.");
}
