import { escapeHtml as e } from "./model.mjs?v=report3";
import {
  groupMetrics,
  metrics,
  metricLabels,
  rawLines,
  isRto,
  ledgerColumns,
} from "./analytics.mjs?v=report3";
export const label = (k) =>
  ({
    order_id: "Order ID",
    awb: "AWB",
    recipient: "Customer name",
    master_courier: "Master Courier",
    courier: "Courier service",
    quantity: "Product quantity",
    buyer_type: "Buyer type",
    lm_bucket: "LM bucket",
    edd_age_days: "EDD age (days)",
    sla_days: "SLA days",
    customer_label: "Customer",
    dimension: "Group",
    share_pct: "Share %",
    ndr: "NDR orders",
    high_risk: "High-risk orders",
    average_age: "Average age (days)",
    max_age: "Maximum age (days)",
    source_status: "Source status",
    age_bucket: "EDD ageing",
    ...metricLabels,
  })[k] || k.replaceAll("_", " ");
const fmt = (v) =>
  v == null
    ? "—"
    : typeof v === "number"
      ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 })
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
export function table(rows, columns = Object.keys(rows[0] || {}), limit = 500) {
  return `<div class="table-wrap"><table><thead><tr>${columns.map((k) => `<th>${e(label(k))}</th>`).join("")}</tr></thead><tbody>${
    rows
      .slice(0, limit)
      .map(
        (r) =>
          `<tr>${columns.map((k) => `<td>${e(fmt(r[k]))}</td>`).join("")}</tr>`,
      )
      .join("") ||
    `<tr><td colspan="${columns.length}">No matching records.</td></tr>`
  }</tbody></table></div>${rows.length > limit ? `<p class="note">Showing ${limit} of ${rows.length} rows. Download includes all rows.</p>` : ""}`;
}
export function menu(key = "ledger") {
  return `<details class="table-menu"><summary aria-label="Table download options">⋮</summary><div><button type="button" data-computed="${e(key)}">Download computed data</button><button type="button" data-raw="${e(key)}">Download underlying raw data</button></div></details>`;
}
export function card(title, body, key, note = "") {
  return `<article class="card"><header class="card-head"><div><h3>${e(title)}</h3>${note ? `<p>${e(note)}</p>` : ""}</div>${key ? menu(key) : ""}</header>${body}</article>`;
}
const metricCols = [
  "dimension",
  "total",
  "delivered",
  "delivered_pct",
  "intransit",
  "intransit_pct",
  "rto",
  "rto_pct",
  "avg_transit",
  "p90",
  "p95",
  "sla_samples",
  "pickup_on_time",
  "pickup_known",
  "pickup_pct",
  "on_time",
  "sla_known",
  "on_time_pct",
];
export function chart(rows, x, y, type = "line") {
  const points = rows.filter(
      (r) => Number.isFinite(Number(r[y])) && r[y] != null,
    ),
    max = Math.max(1, ...points.map((r) => Number(r[y]))),
    w = Math.max(680, points.length * 65),
    h = 230,
    base = 180;
  if (!points.length)
    return '<p class="note">No measured values available for this chart.</p>';
  const title = `${label(y)} by ${label(x)}`;
  if (type === "donut") {
    const sum = points.reduce((s, r) => s + Math.max(0, Number(r[y])), 0);
    if (!sum) return '<p class="note">No positive values to plot.</p>';
    let offset = 0;
    const colors = [
      "#2563eb",
      "#0891b2",
      "#7c3aed",
      "#10b981",
      "#f59e0b",
      "#ef4444",
    ];
    return `<div class="custom-donut"><svg viewBox="0 0 120 120" role="img" aria-label="${e(title)}">${points
      .map((r, i) => {
        const len = (Math.max(0, r[y]) / sum) * 251.327,
          part = `<circle cx="60" cy="60" r="40" fill="none" stroke="${colors[i % 6]}" stroke-width="18" stroke-dasharray="${len} ${251.327 - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"><title>${e(r[x])}: ${e(fmt(r[y]))}</title></circle>`;
        offset += len;
        return part;
      })
      .join(
        "",
      )}</svg><div>${points.map((r, i) => `<p><span style="color:${colors[i % 6]}">●</span> ${e(r[x])} · ${e(fmt(r[y]))}</p>`).join("")}</div></div>`;
  }
  const xy = points.map((r, i) => [
    45 + (i * (w - 90)) / Math.max(1, points.length - 1),
    base - (Number(r[y]) / max) * 140,
  ]);
  return `<div class="chart-scroll"><svg width="${w}" height="${h}" role="img" aria-label="${e(title)}"><line x1="25" y1="${base}" x2="${w - 20}" y2="${base}" stroke="#cbd5e1"/><text x="5" y="28" fill="#64748b" font-size="11">${e(fmt(max))}</text>${["line", "area"].includes(type) ? `${type === "area" ? `<polygon points="${xy[0][0]},${base} ${xy.map((p) => p.join(",")).join(" ")} ${xy.at(-1)[0]},${base}" fill="#dbeafe"/>` : ""}<polyline points="${xy.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#2563eb" stroke-width="3"/>` : ""}${points
    .map((r, i) => {
      const [px, py] = xy[i];
      return `${type === "bar" ? `<rect x="${px - 14}" y="${py}" width="28" height="${Math.max(0, base - py)}" rx="3" fill="#2563eb"/>` : `<circle cx="${px}" cy="${py}" r="5" fill="#2563eb"><title>${e(r[x])}: ${e(fmt(r[y]))}</title></circle>`}<text x="${px}" y="${py - 10}" text-anchor="middle" font-size="11" fill="#334155">${e(fmt(r[y]))}</text><text x="${px}" y="203" text-anchor="middle" font-size="10" fill="#64748b">${e(String(r[x]).slice(0, 18))}</text>`;
    })
    .join("")}</svg></div>`;
}
export function performanceView(rows, dimension, tables, sources = {}) {
  const options = [
    "master_courier",
    "warehouse",
    "state",
    "city",
    "customer_label",
    "payment",
    "zone",
  ];
  const g = groupMetrics(rows, dimension);
  tables.performance = g;
  const m = metrics(rows);
  let html = `<div class="metric-strip">${[
    ["Average SLA", m.avg_transit],
    ["P90 SLA", m.p90],
    ["P95 SLA", m.p95],
  ]
    .map(
      ([k, v]) =>
        `<div><small>${k}</small><strong>${e(fmt(v))} <small>days</small></strong></div>`,
    )
    .join(
      "",
    )}<div><small>On-time pickup</small><strong>${e(fmt(m.pickup_pct))}%</strong><small>${m.pickup_on_time} / ${m.pickup_known} measured</small></div><div><small>On-time delivery</small><strong>${e(fmt(m.on_time_pct))}%</strong><small>${m.on_time} / ${m.sla_known} measured</small></div></div><div class="toolbar"><label>Compare by <select id="dimension">${options.map((k) => `<option value="${k}" ${dimension === k ? "selected" : ""}>${label(k)}</option>`).join("")}</select></label></div>`;
  html += card(
    `${label(dimension)} performance`,
    table(g, metricCols),
    "performance",
    "Rates use all shipments in each group. SLA uses delivered shipments with valid pickup and delivery timestamps.",
  );
  const zoneMaster = new Map();
  for (const r of rows) {
    if (!zoneMaster.has(r.master_courier)) zoneMaster.set(r.master_courier, []);
    zoneMaster.get(r.master_courier).push(r);
  }
  html += `<h2 class="section-title">Zone performance by Master Courier</h2><p class="note">Expand a Master Courier to compare individual services. Transit days = delivered timestamp − picked-up timestamp.</p>`;
  for (const [master, rs] of zoneMaster) {
    const z = groupMetrics(rs, "zone").sort((a, b) =>
      a.dimension.localeCompare(b.dimension),
    );
    const key = `zone-${master}`;
    tables[key] = z;
    sources[key] = rs;
    html += `<details class="card zone-detail"><summary><b>${e(master)}</b><span>${rs.length} shipments · expand courier services</span></summary>${chart(z, "dimension", "avg_transit")}${table(z, metricCols)}${menu(key)}<div class="service-grid">${[
      ...new Set(rs.map((r) => r.courier)),
    ]
      .map((c) => {
        const cg = groupMetrics(
          rs.filter((r) => r.courier === c),
          "zone",
        ).sort((a, b) => a.dimension.localeCompare(b.dimension));
        tables[`service-${c}`] = cg;
        sources[`service-${c}`] = rs.filter((r) => r.courier === c);
        return `<details><summary>${e(c || "Unknown service")}</summary>${chart(cg, "dimension", "avg_transit")}${table(cg, metricCols)}${menu(`service-${c}`)}</details>`;
      })
      .join("")}</div></details>`;
  }
  return (
    html +
    `<p class="note">On-time pickup: Shiprocket created date = pickup date. On-time delivery: delivery date ≤ EDD date. Calendar comparisons use Asia/Kolkata. P90/P95 use interpolated percentiles. In transit includes picked-up forward shipments not delivered, cancelled, lost, damaged or in RTO.</p>`
  );
}
export function queueAnalysis(rows, queue, tables, sources = {}) {
  if (queue === "fm") {
    const gs = groupMetrics(
      rows.map((r) => ({
        ...r,
        warehouse_carrier: `${r.warehouse || "Unknown"} / ${r.master_courier}`,
      })),
      "warehouse_carrier",
    );
    tables.fm = gs;
    return card(
      "Pickup attempted, awaiting pickup",
      table(gs, ["dimension", "total"]),
      "fm",
      "Grouped by warehouse and Master Courier. Requires a recorded pickup attempt and no pickup timestamp.",
    );
  }
  if (queue === "rto") {
    const reasons = groupMetrics(rows, "reason").map((g) => ({
      ...g,
      share_pct: rows.length ? (100 * g.total) / rows.length : 0,
    }));
    tables.rto = reasons;
    const lines = rows.flatMap((r) =>
      (r.lines?.length ? r.lines : [{}]).map((l) => ({
        order_id: r.order_id,
        awb: r.awb,
        master_courier: r.master_courier,
        status: r.status,
        product: l.product || r.product,
        sku: l.sku || r.sku,
        quantity: l.quantity ?? r.quantity,
        rto_reason: r.rto_reason || "Not provided",
        latest_ndr_reason: r.ndr_reason || "Not provided",
      })),
    );
    tables.rtoLines = lines;
    return (
      card(
        "RTO reasons",
        table(reasons, ["dimension", "total", "share_pct"]),
        "rto",
        "Missing RTO reasons are labelled Not provided. NDR reasons are shown separately, not inferred as RTO reasons.",
      ) + card("RTO product lines", table(lines), "rtoLines")
    );
  }
  const aged = ["1", "2", "3+"].map((b) => {
    const rs = rows.filter((r) => r.age_bucket === b);
    return {
      age_bucket: b,
      total: rs.length,
      share_pct: rows.filter((r) => r.edd_age_days > 0).length
        ? (100 * rs.length) / rows.filter((r) => r.edd_age_days > 0).length
        : 0,
      ndr: rs.filter((r) => r.status === "Undelivered").length,
      high_risk: rs.filter((r) => r.risk === "High").length,
      average_age: rs.length
        ? rs.reduce((s, r) => s + r.edd_age_days, 0) / rs.length
        : null,
      max_age: rs.length ? Math.max(...rs.map((r) => r.edd_age_days)) : null,
    };
  });
  tables.age = aged;
  const breakdown = groupMetrics(
    rows.map((r) => ({
      ...r,
      age_carrier: `${r.age_bucket || "NDR only"} / ${r.master_courier} / ${r.warehouse || "Unknown"}`,
    })),
    "age_carrier",
  );
  tables.lm = breakdown;
  const reasons = groupMetrics(
    rows
      .filter((r) => r.status === "Undelivered")
      .map((r) => ({ ...r, ndr_reason: r.ndr_reason || "Not provided" })),
    "ndr_reason",
  );
  tables.ndr = reasons;
  return (
    card(
      "EDD breach ageing",
      table(aged),
      "age",
      "Age = today − EDD, in India calendar days. Due today is not breached. Share % is among breached shipments.",
    ) +
    card(
      "Ageing by Master Courier and warehouse",
      table(breakdown, ["dimension", "total"]),
      "lm",
    ) +
    card("Undelivered reasons", table(reasons, ["dimension", "total"]), "ndr") +
    `<p class="note">Forward shipments only; excludes RTO statuses, a recorded RTO initiation, reverse orders, delivered, cancelled, lost and damaged. Risk: High for 3+ overdue days, 3+ attempts, or NDR plus breach; Mid for 2 days, 2 attempts, or NDR; Low otherwise.</p>`
  );
}
export function customRows(rows, source) {
  if (source === "raw") return rawLines(rows);
  if (source === "fm") return rows.filter((r) => r.fm_pending);
  if (source === "lm") return rows.filter((r) => r.lm_bucket);
  if (source === "rto") return rows.filter(isRto);
  return rows;
}
export function customResult(rows, d) {
  const base = customRows(rows, d.source);
  if (d.type === "table" && !d.grouped)
    return base.map((r) =>
      Object.fromEntries(
        (d.columns?.length ? d.columns : ledgerColumns).map((k) => [
          k,
          r[k] ?? null,
        ]),
      ),
    );
  if (d.source !== "raw")
    return groupMetrics(base, d.dimension || "master_courier");
  const groups = new Map();
  for (const r of base) {
    const k = String(r[d.dimension] || "Unknown");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups].map(([dimension, rs]) => {
    const nums = rs
      .map((r) => r[d.field])
      .filter((v) => v !== "" && v != null && Number.isFinite(Number(v)))
      .map(Number);
    return {
      dimension,
      value:
        d.aggregate === "sum"
          ? nums.reduce((a, b) => a + b, 0)
          : d.aggregate === "average"
            ? nums.length
              ? nums.reduce((a, b) => a + b, 0) / nums.length
              : null
            : rs.length,
    };
  });
}
export function customBuilder(rows, views, definition, tables, sources = {}) {
  const d = definition || {
      source: "shipments",
      type: "table",
      dimension: "master_courier",
      metric: "total",
      columns: ledgerColumns.slice(0, 12),
    },
    raw = d.source === "raw",
    fields = raw
      ? Object.keys(rawLines(rows)[0] || {})
      : [
          ...new Set([
            ...ledgerColumns,
            "warehouse",
            "payment",
            "zone",
            "product",
            "sku",
            "customer_label",
            "pickup_date",
            "delivered_date",
            "pickup_on_time",
            "delivery_on_time",
          ]),
        ];
  const opts = (vs, v) =>
    vs
      .map(
        (k) =>
          `<option value="${e(k)}" ${k === v ? "selected" : ""}>${e(raw ? k : label(k))}</option>`,
      )
      .join("");
  const result = customResult(rows, d);
  tables.custom = result;
  sources.custom = customRows(
    rows,
    d.source === "raw" ? "shipments" : d.source,
  );
  return `<div class="studio-grid"><article class="card"><header class="card-head"><h3>Build a custom view</h3></header><form id="viewForm" class="card-body view-form"><label>Saved view name<input name="name" required maxlength="80" value="${e(d.name || "")}" placeholder="My delivery review"></label><label>Base data<select name="source" id="customSource">${opts(["shipments", "raw", "fm", "lm", "rto"], d.source)}</select></label><label>View type<select name="type">${opts(["table", "bar", "line", "area", "donut", "dot"], d.type)}</select></label><label class="check-label"><input type="checkbox" name="grouped" ${d.grouped ? "checked" : ""}> Group table rows</label><label>Group / X axis<select name="dimension">${opts(fields, d.dimension)}</select></label><label>Metric / Y axis<select name="metric">${Object.keys(
    metricLabels,
  )
    .map(
      (k) =>
        `<option value="${k}" ${k === d.metric ? "selected" : ""}>${e(metricLabels[k])}</option>`,
    )
    .join(
      "",
    )}</select></label>${raw ? `<label>Raw aggregation<select name="aggregate">${opts(["count", "sum", "average"], d.aggregate)}</select></label><label>Numeric raw field<select name="field">${opts(fields, d.field)}</select></label>` : ""}<fieldset><legend>Table columns</legend><div class="column-picker">${fields.map((k) => `<label><input type="checkbox" name="columns" value="${e(k)}" ${d.columns?.includes(k) ? "checked" : ""}>${e(label(k))}</label>`).join("")}</div></fieldset><p class="note">Saves the selected source, columns, chart, grouping and current workspace filters. Results recalculate on opening.</p><div class="toolbar"><button type="button" id="previewCustom">Preview</button><button class="primary">Save view</button></div></form></article><article class="card"><header class="card-head"><h3>Your saved views</h3></header>${views.map((v) => `<div class="saved-item"><button data-view="${e(v.id)}">${e(v.name)} ↗</button><button data-delete-view="${e(v.id)}" aria-label="Delete ${e(v.name)}">×</button></div>`).join("") || '<p class="note">No saved views yet.</p>'}<p class="note">Repeat buyers are identified across all imported history using email or mobile. This is not a lifetime customer classification.</p></article></div>${card(d.name || "Custom view preview", d.type === "table" ? table(result) : chart(result, "dimension", raw ? "value" : d.metric, d.type), "custom", raw ? "Raw product rows; counts are line items, not orders." : "Computed shipment data with the active workspace filters.")}`;
}
