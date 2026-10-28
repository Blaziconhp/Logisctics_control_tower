import { TERMINAL } from "./model.mjs?v=report3";
import { cleanDestinations } from "./locations.mjs?v=report3";
export const day = (value) =>
  value && Number.isFinite(+new Date(value))
    ? new Date(+new Date(value) + 19800000).toISOString().slice(0, 10)
    : null;
export const dayDiff = (a, b) =>
  a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 86400000) : null;
export const isRto = (r) =>
  /^rto\b/i.test(r.status) || Boolean(r.rto_initiated_date);
export const isForward = (r) =>
  !isRto(r) &&
  !r.is_reverse &&
  !TERMINAL.has(r.status) &&
  r.status !== "Cancelled";
export const transitDays = (r) =>
  r.status === "Delivered" &&
  r.delivered_date &&
  r.pickup_date &&
  +new Date(r.delivered_date) >= +new Date(r.pickup_date)
    ? (+new Date(r.delivered_date) - +new Date(r.pickup_date)) / 86400000
    : null;
const present = (value) => value !== null && value !== undefined && value !== "" && value !== "Unknown";
const richness = (row) => ["awb", "provider_shipment_id", "courier", "recipient", "city", "state", "pincode", "order_date", "pickup_date", "delivered_date", "edd", "status_at"].filter((key) => present(row[key])).length;
function canonicalOrders(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.order_id ? `order:${String(row.order_id).trim().toLowerCase()}` : row.shipment_key || `row:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((records) => {
    const ranked = [...records].sort((a, b) => Number(Boolean(b.awb)) - Number(Boolean(a.awb)) || richness(b) - richness(a) || (+new Date(b.status_at || b.updated_at || 0) - +new Date(a.status_at || a.updated_at || 0)));
    const merged = { ...ranked[0], details: { ...(ranked[0].details || {}) } };
    for (const row of [...ranked].reverse()) {
      for (const [key, value] of Object.entries(row)) if (present(value)) merged[key] = value;
      merged.details = { ...merged.details, ...(row.details || {}) };
    }
    const perRecord = records.map((row) => {
      const lines = row.details?.lines || [];
      const totals = new Map();
      for (const line of lines) {
        const key = `${String(line.sku || "").trim().toLowerCase()}|${String(line.product || "").trim().toLowerCase()}`;
        const old = totals.get(key) || { ...line, quantity: 0 };
        old.quantity += Number(line.quantity) || 0; totals.set(key, old);
      }
      return totals;
    });
    const lineMap = new Map();
    for (const totals of perRecord) for (const [key, line] of totals) {
      const old = lineMap.get(key);
      if (!old || Number(line.quantity) > Number(old.quantity)) lineMap.set(key, line);
    }
    const lines = [...lineMap.values()];
    merged.details.lines = lines;
    merged.lines = lines;
    merged.quantity = lines.length ? lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0) : Math.max(...records.map((row) => Number(row.quantity) || 0));
    merged.product = [...new Set(lines.map((line) => line.product).filter(Boolean))].join("; ") || merged.product;
    merged.sku = [...new Set(lines.map((line) => line.sku).filter(Boolean))].join("; ") || merged.sku;
    merged.awbs = [...new Set(records.map((row) => row.awb).filter(Boolean))];
    merged.awb = merged.awbs.join(", ") || null;
    merged.source_refs = records.flatMap((row) => row.source_refs || []);
    merged.duplicate_records_merged = records.length - 1;
    return merged;
  });
}
export function enrich(rows, now = new Date()) {
  const identities = new Map();
  const expanded = cleanDestinations(canonicalOrders(rows)).map((r) => {
    const d = r.details || {};
    const x = {
      ...r,
      ...d,
      master_courier: d.master_courier || r.master_courier || "Unknown",
      zone: d.zone || r.zone || "Unknown",
      month: day(r.order_date)?.slice(0, 7) || "Unknown",
    };
    x.customer_identity =
      d.customer_email?.toLowerCase() ||
      d.customer_mobile?.replace(/\D/g, "") ||
      null;
    if (x.customer_identity) {
      if (!identities.has(x.customer_identity))
        identities.set(x.customer_identity, new Set());
      identities.get(x.customer_identity).add(x.order_id || x.shipment_key);
    }
    x.sla_days = transitDays(x);
    x.pickup_on_time =
      r.order_date && r.pickup_date
        ? day(r.order_date) === day(r.pickup_date)
        : null;
    x.delivery_on_time =
      r.status === "Delivered" && r.edd && r.delivered_date
        ? day(r.delivered_date) <= day(r.edd)
        : null;
    x.edd_age_days =
      isForward(x) && r.edd ? Math.max(0, dayDiff(day(now), day(r.edd))) : 0;
    const ndr = isForward(x) && /^undelivered/i.test(r.status),
      breach = x.edd_age_days > 0;
    x.lm_bucket =
      ndr && breach
        ? "NDR/EDD breach"
        : ndr
          ? "NDR"
          : breach
            ? "EDD Breach"
            : null;
    x.age_bucket = breach
      ? x.edd_age_days >= 3
        ? "3+"
        : String(x.edd_age_days)
      : null;
    x.fm_pending = isForward(x) && !!x.pickup_attempt_date && !r.pickup_date;
    x.risk =
      x.lm_bucket || x.fm_pending
        ? x.edd_age_days >= 3 || r.attempts >= 3 || (ndr && breach)
          ? "High"
          : x.edd_age_days >= 2 || r.attempts >= 2 || ndr
            ? "Mid"
            : "Low"
        : null;
    x.reason = isRto(x)
      ? x.rto_reason || "Not provided"
      : ndr
        ? x.ndr_reason || "Not provided"
        : x.fm_pending
          ? x.pickup_reason || "Not provided"
          : r.remark || "";
    x.customer_label = r.recipient || "Unknown";
    return x;
  });
  return expanded.map((r) => ({
    ...r,
    buyer_type: !r.customer_identity
      ? "Unknown"
      : identities.get(r.customer_identity).size > 1
        ? "Repeat customer"
        : "New buyer",
  }));
}
const selected = (value, filter) =>
  filter === undefined ||
  filter === null ||
  filter === "" ||
  (Array.isArray(filter)
    ? filter.includes(value ?? "Unknown")
    : filter === (value ?? "Unknown"));
export function matches(r, f = {}) {
  if (
    (f.from && (!day(r.order_date) || day(r.order_date) < f.from)) ||
    (f.to && (!day(r.order_date) || day(r.order_date) > f.to))
  )
    return false;
  for (const k of [
    "master_courier",
    "courier",
    "city",
    "state",
    "customer",
    "warehouse",
    "payment",
    "zone",
    "risk",
    "reason",
    "buyer_type",
    "age_bucket",
  ])
    if (!selected(r[k], f[k])) return false;
  if (
    f.status !== undefined &&
    f.status !== "" &&
    !selected(r.status, f.status) &&
    !selected(r.lm_bucket, f.status)
  )
    return false;
  if (
    (f.queue === "fm" && !r.fm_pending) ||
    (f.queue === "lm" && !r.lm_bucket) ||
    (f.queue === "rto" && !isRto(r))
  )
    return false;
  if (f.exceptions && !r.fm_pending && !r.lm_bucket && !isRto(r)) return false;
  if (f.overdue && !r.edd_age_days) return false;
  if (
    f.ids &&
    !f.ids.some((id) =>
      [r.order_id, r.awb, r.provider_order_id].some(
        (v) => String(v || "").toLowerCase() === String(id).toLowerCase(),
      ),
    )
  )
    return false;
  if (
    f.q &&
    ![
      r.order_id,
      r.awb,
      r.recipient,
      r.customer,
      r.master_courier,
      r.courier,
      r.city,
      r.state,
      r.status,
      r.product,
      r.sku,
      r.reason,
    ]
      .join(" ")
      .toLowerCase()
      .includes(f.q.toLowerCase())
  )
    return false;
  return true;
}
export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b),
    i = (s.length - 1) * p,
    lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}
export function metrics(rows) {
  const count = (fn) => rows.filter(fn).length,
    sla = rows
      .map((r) => r.sla_days)
      .filter((v) => v !== null && v !== undefined);
  const total = rows.length,
    delivered = count((r) => r.status === "Delivered"),
    rto = count(isRto),
    intransit = count((r) => isForward(r) && !!r.pickup_date);
  const pickup_known = count((r) => r.pickup_on_time !== null),
    pickup_on_time = count((r) => r.pickup_on_time === true),
    sla_known = count((r) => r.delivery_on_time !== null),
    on_time = count((r) => r.delivery_on_time === true);
  return {
    total,
    unique_orders: new Set(rows.map((r) => r.order_id).filter(Boolean)).size,
    delivered,
    rto,
    intransit,
    open: count((r) => !TERMINAL.has(r.status) && r.status !== "Cancelled"),
    exceptions: count((r) => r.fm_pending || r.lm_bucket || isRto(r)),
    delivered_pct: total ? (100 * delivered) / total : null,
    rto_pct: total ? (100 * rto) / total : null,
    intransit_pct: total ? (100 * intransit) / total : null,
    pickup_known,
    pickup_on_time,
    pickup_pct: pickup_known ? (100 * pickup_on_time) / pickup_known : null,
    sla_known,
    on_time,
    on_time_pct: sla_known ? (100 * on_time) / sla_known : null,
    sla_samples: sla.length,
    avg_transit: sla.length
      ? sla.reduce((a, b) => a + b, 0) / sla.length
      : null,
    p90: percentile(sla, 0.9),
    p95: percentile(sla, 0.95),
    dates_known: count((r) => !!r.order_date),
    latest_order_date: rows.map((r) => day(r.order_date)).filter(Boolean).sort().at(-1) || null,
    freight: rows.reduce((s, r) => s + (Number(r.freight) || 0), 0),
    freight_known: count((r) => r.freight !== null),
    updated:
      rows
        .map((r) => r.updated_at)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
  };
}
export function groupMetrics(rows, dimension) {
  const g = new Map();
  for (const r of rows) {
    const k = r[dimension] || "Unknown";
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  return [...g]
    .map(([dimension, rs]) => ({ dimension, ...metrics(rs) }))
    .sort(
      (a, b) => b.total - a.total || a.dimension.localeCompare(b.dimension),
    );
}
export function summarize(rows, dimension = "master_courier") {
  const counts = (key) => {
    const m = new Map();
    for (const r of rows) {
      const k = key === "day" ? day(r.order_date) : r[key];
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([v, total]) => ({ [key]: v, total }));
  };
  return {
    kpi: metrics(rows),
    groups: groupMetrics(rows, dimension),
    outcomes: counts("status"),
    months: counts("month"),
    days: counts("day").slice(-31),
  };
}
export const ledgerColumns = [
  "order_id",
  "awb",
  "recipient",
  "master_courier",
  "courier",
  "city",
  "state",
  "pincode",
  "status",
  "order_date",
  "quantity",
  "attempts",
  "reason",
  "buyer_type",
  "lm_bucket",
  "risk",
  "edd",
  "edd_age_days",
  "sla_days",
];
export function ledgerExport(rows) {
  return rows.map((r) =>
    Object.fromEntries(ledgerColumns.map((k) => [k, r[k] ?? null])),
  );
}
export function rawLines(rows) {
  return rows.flatMap((r) => (r.lines || []).map((l) => ({ ...l.raw })));
}
export function findIdentifiers(question, rows) {
  const normalize = (v) =>
      String(v || "")
        .toLowerCase()
        .replace(/^#/, ""),
    q = normalize(question);
  return rows.filter((r) =>
    [r.order_id, r.awb, r.provider_order_id].some((id) => {
      if (!id) return false;
      const s = normalize(id),
        start = q.indexOf(s);
      return (
        start >= 0 &&
        !/[\w-]/.test(q[start - 1] || "") &&
        !/[\w-]/.test(q[start + s.length] || "")
      );
    }),
  );
}
export const metricLabels = {
  total: "Unique orders",
  unique_orders: "Unique orders",
  delivered: "Delivered",
  delivered_pct: "Delivered %",
  intransit: "In transit",
  intransit_pct: "In transit %",
  rto: "RTO",
  rto_pct: "RTO %",
  avg_transit: "Average SLA days",
  p90: "P90 days",
  p95: "P95 days",
  sla_samples: "SLA samples",
  pickup_on_time: "On-time pickups",
  pickup_known: "Pickup evidence",
  pickup_pct: "On-time pickup %",
  on_time: "On-time deliveries",
  sla_known: "Delivery evidence",
  on_time_pct: "On-time delivery %",
  freight: "Freight",
};
