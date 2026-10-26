import { createDemoShipments } from "./lib/demo.mjs";
import {
  escapeHtml as e,
  csv,
  TERMINAL,
  selectSourceRows,
} from "./lib/model.mjs";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const iconPaths = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  shipments:
    '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7 5.8l9 5"/>',
  exceptions: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  performance: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  studio:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>',
  spark:
    '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/>',
  filter:
    '<path d="M4 7h16M7 12h10M10 17h4"/><circle cx="8" cy="7" r="2"/><circle cx="16" cy="12" r="2"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  return: '<path d="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5M5.3 7a8 8 0 0 1 13-2L20 8M4 16l1.7 3A8 8 0 0 0 19 17"/>',
  logout: '<path d="M9 4H4v16h5M10 12h11m-5-5 5 5-5 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  folder: '<path d="M3 6V4h7l2 3h9v14H3V6Z"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.spark}</svg>`;
}

const config = window.SHARV_CONFIG || {};
const routes = {
  overview: [
    "Network overview",
    "A clear view of movement, outcomes, and what needs attention.",
  ],
  shipments: [
    "Shipment ledger",
    "Search, investigate, and export every authorized shipment.",
  ],
  exceptions: [
    "Action queue",
    "Recorded exceptions, missed promises, and repeated delivery attempts.",
  ],
  performance: [
    "Performance",
    "Compare outcomes across carriers, destinations, and accounts.",
  ],
  studio: [
    "Saved views",
    "Reusable definitions that recalculate with your latest data.",
  ],
  sharv: ["Ask SHARV", "Grounded answers from your authorized shipment data."],
};
const state = {
  client: null,
  user: null,
  primary: false,
  filter: {},
  route: "overview",
  summary: null,
  rows: [],
  after: 0,
  page: 0,
  cursors: [0],
  hasNext: false,
  dimension: "courier",
  generation: 0,
  sessionGeneration: 0,
  demo: false,
  views: [],
};
const n = (v) =>
  Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const pct = (a, b) => (b ? `${n((100 * a) / b)}%` : "—");
const date = (v) =>
  v
    ? new Date(v).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const status = (v) =>
  `<span class="pill ${v === "Delivered" ? "delivered" : TERMINAL.has(v) ? "bad" : /ndr|undeliver|rto/i.test(v) ? "risk" : ""}">${e(v)}</span>`;
const toast = (message) => {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(state.toast);
  state.toast = setTimeout(() => ($("#toast").hidden = true), 6500);
};
const modal = (html) => {
  $("#dialogContent").innerHTML = html;
  $("#dialog").showModal();
};
const errorView = (err) =>
  `<div class="error"><h2>We couldn’t load this view</h2><p>${e(err.message)}</p><button data-retry>Try again</button></div>`;
async function rpc(name, args = {}) {
  const { data, error } = await state.client.rpc(name, args);
  if (error) throw error;
  return data;
}
function currentFilter() {
  return {
    ...state.filter,
    ...(state.route === "exceptions" ? { exceptions: true } : {}),
  };
}
const demoShipments = createDemoShipments();
const demoData = () => demoShipments;
function demoScope(f) {
  return demoData().filter(
    (r) =>
      (!f.from || r.order_date.slice(0, 10) >= f.from) &&
      (!f.to || r.order_date.slice(0, 10) <= f.to) &&
      ["courier", "state", "status", "customer"].every(
        (k) => !f[k] || r[k] === f[k],
      ) &&
      (!f.q ||
        Object.values(r).join(" ").toLowerCase().includes(f.q.toLowerCase())) &&
      (!f.ids || f.ids.includes(r.awb) || f.ids.includes(r.order_id)) &&
      (!f.exceptions || isException(r)) &&
      (!f.overdue ||
        (!TERMINAL.has(r.status) && r.edd && new Date(r.edd) < new Date())),
  );
}
function isException(r) {
  return (
    ["Lost", "Damaged", "Undelivered"].includes(r.status) ||
    (!TERMINAL.has(r.status) &&
      ((r.edd && new Date(r.edd) < new Date()) || r.attempts >= 2))
  );
}
function demoSummary(f, dimension) {
  const rows = demoScope(f),
    count = (fn) => rows.filter(fn).length;
  const groups = new Map(),
    outcomes = new Map(),
    months = new Map(),
    days = new Map();
  for (const r of rows) {
    const dim =
      dimension === "month"
        ? r.order_date.slice(0, 7)
        : r[dimension] || "Unknown";
    if (!groups.has(dim))
      groups.set(dim, {
        dimension: dim,
        total: 0,
        delivered: 0,
        rto: 0,
        open: 0,
        freight: 0,
      });
    const g = groups.get(dim);
    g.total++;
    g.delivered += r.status === "Delivered";
    g.rto += r.status === "RTO Delivered";
    g.open += !TERMINAL.has(r.status);
    g.freight += r.freight || 0;
    outcomes.set(r.status, (outcomes.get(r.status) || 0) + 1);
    const m = r.order_date.slice(0, 7);
    months.set(m, (months.get(m) || 0) + 1);
    const d = r.order_date.slice(0, 10);
    days.set(d, (days.get(d) || 0) + 1);
  }
  return {
    kpi: {
      total: rows.length,
      delivered: count((r) => r.status === "Delivered"),
      rto: count((r) => r.status === "RTO Delivered"),
      open: count((r) => !TERMINAL.has(r.status)),
      exceptions: count(isException),
      sla_known: count(
        (r) => r.status === "Delivered" && r.edd && r.delivered_date,
      ),
      on_time: count(
        (r) =>
          r.status === "Delivered" &&
          r.edd &&
          r.delivered_date &&
          r.delivered_date <= r.edd,
      ),
      dates_known: rows.length,
      freight: rows.reduce((s, r) => s + r.freight, 0),
      freight_known: rows.length,
      updated: "2026-09-30T12:00:00Z",
    },
    groups: [...groups.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 100),
    outcomes: [...outcomes].map(([status, total]) => ({ status, total })),
    months: [...months].map(([month, total]) => ({ month, total })),
    days: [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, total]) => ({ day, total })),
  };
}
async function summary(filter = currentFilter(), dimension = state.dimension) {
  return state.demo
    ? demoSummary(filter, dimension)
    : rpc("next_summary", { p_filter: filter, p_dimension: dimension });
}
async function page(filter = currentFilter(), after = 0, limit = 50) {
  return state.demo
    ? demoScope(filter)
        .filter((r) => r.id > after)
        .slice(0, limit)
    : rpc("next_page", { p_filter: filter, p_after: after, p_limit: limit });
}
function kpis(k) {
  const cards = [
    [
      "Total shipments",
      n(k.total),
      "Distinct shipment records",
      "shipments",
      "blue",
    ],
    [
      "Delivered",
      pct(k.delivered, k.total),
      `${n(k.delivered)} successful deliveries`,
      "check",
      "teal",
    ],
    [
      "Open shipments",
      n(k.open),
      "Awaiting a terminal outcome",
      "clock",
      "amber",
    ],
    [
      "On-time delivery",
      pct(k.on_time, k.sla_known),
      `${n(k.sla_known)} deliveries with SLA evidence`,
      "performance",
      "blue",
    ],
    [
      "RTO delivered",
      pct(k.rto, k.total),
      `${n(k.rto)} completed returns`,
      "return",
      "red",
    ],
  ];
  return `<section class="kpis" aria-label="Shipment metrics">${cards.map(([label, value, note, symbol, tone]) => `<article class="kpi ${tone}"><div class="kpi-head"><label>${label}</label><span class="kpi-icon">${icon(symbol)}</span></div><strong>${value}</strong><p><span class="metric-dot"></span>${note}</p></article>`).join("")}</section>`;
}
function groupTable(groups, dimension, drill = true) {
  return `<div class="table-wrap"><table><thead><tr><th>${e(dimension)}</th><th>Shipments</th><th>Delivered</th><th>Delivery rate</th><th>RTO delivered</th><th>Open</th></tr></thead><tbody>${groups.map((g) => `<tr><td>${drill && ["courier", "state", "customer", "status"].includes(dimension) && g.dimension !== "Unknown" ? `<button data-drill="${e(dimension)}" data-value="${e(g.dimension)}">${e(g.dimension)} ↗</button>` : e(g.dimension)}</td><td>${n(g.total)}</td><td>${n(g.delivered)}</td><td>${pct(g.delivered, g.total)}</td><td>${n(g.rto)}</td><td>${n(g.open)}</td></tr>`).join("")}</tbody></table></div>`;
}
function overview(s) {
  const k = s.kpi,
    colors = ["#2f6fed", "#f0ad4e", "#0c8b75", "#d35e66", "#8f9bb4", "#7c6ad1"];
  let progress = 0;
  const stops = s.outcomes
    .map((o, i) => {
      const start = progress;
      progress += (100 * o.total) / (k.total || 1);
      return `${colors[i % colors.length]} ${start}% ${progress}%`;
    })
    .join(",");
  const daily = !!s.days?.length;
  const months = daily
      ? s.days
          .slice(-31)
          .map((x) => ({
            month:
              x.day.slice(8) +
              " " +
              new Date(x.day + "T12:00:00Z").toLocaleDateString("en-GB", {
                month: "short",
              }),
            total: x.total,
          }))
      : s.months.slice(-10),
    max = Math.max(1, ...months.map((m) => m.total));
  return `<div class="network-brief"><div class="brief-icon">${icon("spark")}</div><div><b>Your network at a glance</b><p>${n(k.total)} shipments in scope · ${n(k.exceptions)} need operational review</p></div><button data-go="exceptions">Review action queue ${icon("arrow")}</button></div>${kpis(k)}<div class="grid"><article class="card"><header class="card-head"><div><h3>Shipment volume</h3><p>${daily ? "Daily order volume · latest 31 available dates" : "Order-date volume · latest 10 available months"}</p></div><button data-export-summary="${daily ? "days" : "months"}" aria-label="Export shipment volume">↓ CSV</button></header><div class="card-body"><div class="chart-bars" role="img" aria-label="Shipment counts by order date">${months.map((m, i) => `<div class="chart-col" title="${e(m.month)}: ${n(m.total)} shipments"><b>${n(m.total)}</b><div class="bar" style="height:${Math.max(2, (125 * m.total) / max)}px"></div><small>${daily ? (i % 4 === 0 ? e(m.month) : "&nbsp;") : e(m.month)}</small></div>`).join("")}</div><p class="chart-caption">${n(k.dates_known)} of ${n(k.total)} records have an order date. Counts use the current filters.</p></div></article><article class="card"><header class="card-head"><div><h3>Delivery outcomes</h3><p>Current shipment status</p></div><button data-export-summary="outcomes" aria-label="Export delivery outcomes">↓ CSV</button></header><div class="card-body outcome"><div class="ring" style="background:conic-gradient(${stops || "#edf2ee 0% 100%"})"><div>${pct(k.delivered, k.total)}<small>DELIVERED</small></div></div><div class="legend">${s.outcomes.map((o, i) => `<p><span><i style="background:${colors[i % colors.length]}"></i>${e(o.status)}</span><b>${n(o.total)}</b></p>`).join("")}</div></div></article></div><div class="grid"><article class="card"><header class="card-head"><div><h3>Your operational brief</h3><p>Observed signals, with clear next steps</p></div><span class="badge">CURRENT SCOPE</span></header><div class="insight"><span>⚑</span><div><h3>${n(k.exceptions)} shipments need review</h3><p>Recorded loss, damage or non-delivery; overdue EDDs; or two-plus attempts on a nonterminal shipment.</p></div><button data-go="exceptions" aria-label="Open action queue">↗</button></div><div class="insight"><span>◷</span><div><h3>${pct(k.sla_known, k.delivered)} SLA evidence coverage</h3><p>On-time performance uses only delivered shipments with both promised and actual delivery dates. No target is guessed.</p></div></div><div class="insight"><span>↩</span><div><h3>${n(k.rto)} returns completed</h3><p>${pct(k.rto, k.total)} of this scope is RTO delivered. A recorded return reason is needed to explain why.</p></div></div></article><article class="card"><header class="card-head"><div><h3>Carrier snapshot</h3><p>Largest carriers by shipment volume</p></div><button data-go="performance">Explore ↗</button></header>${groupTable(s.groups.slice(0, 5), "courier")}<div class="table-footer">Delivery rate = delivered ÷ all shipments in scope</div></article></div>`;
}
function ledger(rows) {
  return `<div class="toolbar"><input id="ledgerSearch" aria-label="Search shipment ledger" placeholder="Search AWB, order, recipient, destination…" value="${e(state.filter.q || "")}"><button id="runSearch">Search</button>${state.route === "exceptions" ? '<span class="badge">Source-based action queue</span>' : ""}</div><article class="card"><header class="card-head"><div><h3>${state.route === "exceptions" ? "Shipments to review" : "Shipment records"}</h3><p>50 records per page · identifiers remain text</p></div><button id="exportPage">↓ This page</button></header><div class="table-wrap"><table><thead><tr><th>AWB / Order</th><th>Carrier</th><th>Destination</th><th>Status</th><th>Order date</th><th>Attempts</th>${state.route === "exceptions" ? "<th>Observed signal</th>" : ""}</tr></thead><tbody>${rows.map((r) => `<tr><td><button data-detail="${r.id}">${e(r.awb || r.order_id)} ↗</button><br><small>${e(r.order_id)}</small></td><td>${e(r.courier)}</td><td>${e(r.city)}<br><small>${e(r.state)}</small></td><td>${status(r.status)}</td><td>${date(r.order_date)}</td><td>${n(r.attempts)}</td>${state.route === "exceptions" ? `<td>${e(["Lost", "Damaged", "Undelivered"].includes(r.status) ? r.status : r.edd && new Date(r.edd) < new Date() ? "Promised date passed" : "Repeated attempts")}</td>` : ""}</tr>`).join("") || '<tr><td colspan="7">No records match this scope.</td></tr>'}</tbody></table></div><footer class="table-footer"><span>Page ${state.page + 1} · ${rows.length} records shown</span><div><button id="previous" ${state.page === 0 ? "disabled" : ""}>← Previous</button> <button id="next" ${!state.hasNext ? "disabled" : ""}>Next →</button></div></footer></article>`;
}
function performance(s) {
  return `${kpis(s.kpi)}<div class="toolbar"><label>Compare by<select id="dimension">${["courier", "state", "city", "customer", "month", "product", "warehouse", "payment", "status"].map((d) => `<option ${state.dimension === d ? "selected" : ""}>${d}</option>`).join("")}</select></label></div><article class="card"><header class="card-head"><div><h3>Performance scorecard</h3><p>Top 100 groups by volume · rates include all outcomes in each group</p></div><button data-export-summary="groups">↓ Computed CSV</button></header>${groupTable(s.groups, state.dimension)}<footer class="table-footer">Group totals are exact. Groups beyond the first 100 are excluded from this table.</footer></article>`;
}
async function loadViews() {
  if (state.demo) return state.views;
  const { data, error } = await state.client
    .from("next_views")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  state.views = data;
  return data;
}
async function studio() {
  await loadViews();
  return `<div class="studio-grid"><article class="card"><header class="card-head"><h3>Create a saved view</h3></header><form id="viewForm" class="card-body view-form"><label>Name<input name="name" maxlength="80" required placeholder="Weekly carrier review"></label><label>Group by<select name="dimension">${["courier", "state", "city", "customer", "month", "status", "product"].map((d) => `<option>${d}</option>`).join("")}</select></label><p class="muted">Saves current global filters and grouping. Results recalculate from current records each time.</p><button class="primary">Save current definition</button></form></article><article class="card"><header class="card-head"><div><h3>Your saved views</h3><p>Private to your signed-in user</p></div></header>${state.views.map((v) => `<div class="saved-item"><button data-view="${e(v.id)}">${e(v.name)} ↗</button><button data-delete-view="${e(v.id)}" aria-label="Delete ${e(v.name)}">×</button></div>`).join("") || '<div class="card-body"><p>No saved views yet. Start with a useful filtered comparison.</p></div>'}</article></div>`;
}
function sharv() {
  return `<section class="chat"><div class="chat-scroll" id="chatScroll"><div class="chat-intro"><span class="welcome-emblem">${icon("spark")}</span><p class="eyebrow">SHIPMENT & SLA INTELLIGENCE</p><h2>How can I help your<br>operations today?</h2><p class="muted">Investigate a shipment, compare performance,<br>or find what needs your attention.</p><div class="chat-prompts">${["Summarize this scope", "Compare carriers", "Which states have the most RTO?", "Show overdue shipments"].map((q) => `<button data-ask="${e(q)}">${e(q)}${icon("arrow")}</button>`).join("")}</div></div><div id="messages" role="log" aria-live="polite"></div></div><form id="askForm"><label class="sr-only" for="sharvQuestion">Ask SHARV</label><textarea id="sharvQuestion" name="question" rows="2" required placeholder="Ask about shipments, carriers, or SLA…"></textarea><button class="primary" aria-label="Send message">${icon("arrow")}</button></form><p class="composer-note">Answers use your selected data scope. Missing evidence is stated.</p></section>`;
}
function assistantScope() {
  const active = Object.entries(currentFilter()).filter(([, v]) => v);
  return state.demo
    ? "September 2026 demo · Current workspace filters"
    : active.length
      ? `Current scope · ${active.map(([k, v]) => `${k}: ${v}`).join(" · ")}`
      : "Current scope · All authorized shipments";
}
function openAssistant() {
  if (!state.user) return;
  if (!$("#assistantContent").hasChildNodes())
    $("#assistantContent").innerHTML = sharv();
  $("#assistantScope").textContent = assistantScope();
  $("#assistantPanel").hidden = false;
  $("#floatingSharv").setAttribute("aria-expanded", "true");
  $("#sidebar").classList.remove("open");
  $("#mobileNav").setAttribute("aria-expanded", "false");
  $("#sharvQuestion").focus();
}
function closeAssistant() {
  $("#assistantPanel").hidden = true;
  $("#floatingSharv").setAttribute("aria-expanded", "false");
  if (state.user) $("#floatingSharv").focus();
}
async function render() {
  if (!state.user) return;
  const generation = ++state.generation;
  state.route =
    location.hash.slice(1) in routes ? location.hash.slice(1) : "overview";
  if (state.route === "sharv") {
    state.route = "overview";
    openAssistant();
  }
  $("#assistantScope").textContent = assistantScope();
  const [title, subtitle] = routes[state.route];
  $("#routeTitle").textContent = title;
  $("#pageTitle").textContent = title;
  $("#pageSubtitle").textContent = subtitle;
  $$("nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.route === state.route),
  );
  $("#sidebar").classList.remove("open");
  $("#mobileNav").setAttribute("aria-expanded", "false");
  $("#content").innerHTML =
    '<div class="loading">Loading your current scope…</div>';
  $("#scope").textContent = state.demo
    ? "DEMO WORKSPACE · September 2026 · Synthetic shipments"
    : "Current scope · All metrics, answers, and exports use these filters";
  try {
    let html;
    if (state.route === "studio") html = await studio();
    else if (["shipments", "exceptions"].includes(state.route)) {
      const rows = await page(
        currentFilter(),
        state.cursors[state.page] || 0,
        51,
      );
      if (generation !== state.generation) return;
      state.hasNext = rows.length > 50;
      state.rows = rows.slice(0, 50);
      html = ledger(state.rows);
    } else {
      const s = await summary(
        currentFilter(),
        state.route === "overview" ? "courier" : state.dimension,
      );
      if (generation !== state.generation) return;
      state.summary = s;
      $("#queueCount").textContent = n(s.kpi.exceptions);
      $("#updated").textContent = s.kpi.updated
        ? `Data updated ${date(s.kpi.updated)}`
        : "No imported data";
      html = s.kpi.total
        ? state.route === "overview"
          ? overview(s)
          : performance(s)
        : `<div class="empty"><p class="eyebrow">YOUR WORKSPACE IS READY</p><h2>No shipments in this scope</h2><p>Widen the filters or ask a primary user to import a Shiprocket all-orders report.</p>${state.primary ? '<button data-upload class="primary">Import your first report</button>' : ""}</div>`;
    }
    if (generation !== state.generation) return;
    $("#content").innerHTML = html;
    $("#live").textContent = `${title} loaded`;
  } catch (err) {
    if (generation === state.generation)
      $("#content").innerHTML = errorView(err);
  }
}
function resetPage() {
  state.page = 0;
  state.cursors = [0];
}
function writeFilters() {
  const form = $("#filters");
  for (const key of ["from", "to", "courier", "state", "status", "customer"]) {
    if (
      key === "status" &&
      state.filter[key] &&
      !form.elements[key].querySelector(
        `option[value="${CSS.escape(state.filter[key])}"]`,
      )
    ) {
      const opt = new Option(state.filter[key], state.filter[key]);
      form.elements[key].add(opt);
    }
    form.elements[key].value = state.filter[key] || "";
  }
}
function download(content, filename, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function allRows(filter) {
  const rows = [];
  let after = 0;
  for (;;) {
    const batch = await page(filter, after, 1000);
    rows.push(...batch);
    if (!batch.length || batch.length < 1000) break;
    after = batch.at(-1).id;
  }
  return rows;
}
async function exportScope() {
  modal(
    '<h2>Export current scope</h2><p>Choose computed shipment fields or exact source files. All downloads require team access.</p><button id="exportNormalized" class="primary">Download normalized shipment CSV</button><button id="exportRaw">Download underlying raw rows</button><p class="note">CSV output neutralizes formula-leading cells. Original source archives preserve the exact workbook bytes, including all columns, rows and sheets.</p>',
  );
}
async function normalizedExport(button) {
  button.disabled = true;
  try {
    toast("Preparing all matching records in pages…");
    const rows = await allRows(currentFilter());
    download(csv(rows), "sharv-shipments.csv");
    toast(`${n(rows.length)} shipment records exported.`);
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
}
async function sourceFile(batch) {
  const { data, error } = await state.client.storage
    .from("shiprocket-sources")
    .download(batch.object_path);
  if (error) throw error;
  return new Response(
    data.stream().pipeThrough(new DecompressionStream("gzip")),
  ).blob();
}
async function history() {
  if (state.demo) {
    modal(
      "<h2>Source files & imports</h2><p>Synthetic preview has no stored source files.</p>",
    );
    return;
  }
  const { data, error } = await state.client
    .from("next_imports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  state.imports = data;
  modal(
    `<h2>Source files & imports</h2><p>Latest 100 imports · immutable private originals</p><div class="table-wrap"><table><thead><tr><th>File</th><th>Status</th><th>Rows</th><th>Stored size</th><th>Download</th></tr></thead><tbody>${data.map((b) => `<tr><td>${e(b.filename)}<br><small>${date(b.created_at)}</small></td><td>${e(b.status)}</td><td>${n(b.source_rows)}<br><small>${n(b.rejected_rows)} unmapped</small></td><td>${n(b.compressed_bytes / 1024)} KB<br><small>${pct(b.compressed_bytes, b.original_bytes)} of original</small></td><td><button data-source="${b.id}">Original file ↓</button>${b.status === "staging" && state.primary && b.owner_id === state.user.id ? `<button data-resume="${b.id}">Resume import</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`,
  );
}
async function rawExport(button) {
  if (state.demo) {
    toast("Synthetic preview has no raw source files.");
    return;
  }
  button.disabled = true;
  try {
    const rows = await allRows(currentFilter());
    const ids = [...new Set(rows.map((r) => r.import_id).filter(Boolean))];
    if (!ids.length) {
      toast(
        "No source workbook rows in this scope. Tracking-only records have event history in shipment details.",
      );
      return;
    }
    toast("Preparing raw rows from private originals…");
    await loadXlsx();
    const output = XLSX.utils.book_new();
    let sheetNo = 0;
    for (const id of ids) {
      const { data: b, error } = await state.client
        .from("next_imports")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      const blob = await sourceFile(b),
        book = XLSX.read(await blob.arrayBuffer(), {
          type: "array",
          cellDates: false,
        });
      const refs = new Map();
      for (const r of rows.filter((r) => r.import_id === id))
        for (const ref of r.source_refs || []) {
          if (!refs.has(ref.sheet)) refs.set(ref.sheet, []);
          refs.get(ref.sheet).push(ref);
        }
      for (const [name, numbers] of refs) {
        const original = book.Sheets[name],
          matrix = XLSX.utils.sheet_to_json(original, {
            header: 1,
            raw: true,
            defval: "",
            blankrows: true,
            range: 0,
          });
        const selected = selectSourceRows(matrix, numbers);
        const safe = selected.map((r) =>
          r.map((v) =>
            typeof v === "string" && /^[=+@-]/.test(v) ? "'" + v : v,
          ),
        );
        XLSX.utils.book_append_sheet(
          output,
          XLSX.utils.aoa_to_sheet(safe),
          `Source ${++sheetNo}`,
        );
      }
    }
    if (sheetNo) XLSX.writeFile(output, "sharv-filtered-source-rows.xlsx");
    toast(
      "Raw export includes original columns, source headings and matched line rows. Download the original file for byte-exact preservation.",
    );
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
}
let xlsxPromise;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return (xlsxPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./vendor/xlsx.full.min.js";
    script.onload = resolve;
    script.onerror = () => {
      xlsxPromise = null;
      reject(new Error("Workbook library could not load"));
    };
    document.head.append(script);
  }));
}
async function detail(id) {
  const row = state.rows.find((r) => String(r.id) === String(id));
  if (!row) return;
  modal(
    `<p class="eyebrow">SHIPMENT RECORD</p><h2>${e(row.awb || row.order_id)}</h2>${status(row.status)}<div class="detail-grid">${Object.entries(
      row,
    )
      .filter(([k]) => !["source_refs", "shipment_key", "id"].includes(k))
      .map(
        ([k, v]) =>
          `<div><small>${e(k.replaceAll("_", " "))}</small>${e(v)}</div>`,
      )
      .join(
        "",
      )}</div><p class="note">${TERMINAL.has(row.status) ? "Terminal status: automatic tracking updates cannot change this record." : "This shipment remains eligible for newer tracking updates."}</p><div id="eventHistory">Loading tracking history…</div>`,
  );
  if (state.demo) {
    $("#eventHistory").textContent = "Synthetic preview · no tracking events";
    return;
  }
  const { data, error } = await state.client
    .from("next_events")
    .select("event_at,status,outcome")
    .eq("awb", row.awb || "")
    .order("event_at", { ascending: false })
    .limit(50);
  if (!$("#eventHistory")) return;
  $("#eventHistory").innerHTML = error
    ? `<p>${e(error.message)}</p>`
    : `<h3>Latest tracking events</h3>${(data || []).map((ev) => `<p>${date(ev.event_at)} · ${e(ev.status)} · ${e(ev.outcome)}</p>`).join("") || "<p>No tracking webhook events recorded.</p>"}`;
}
function openUpload() {
  if (!state.primary) return;
  modal(
    `<p class="eyebrow">PRIMARY USER ACCESS</p><h2>Import Shiprocket all-orders report</h2><p>Reconcile shipments by exact AWB, or merchant order ID when no AWB exists. Reports never delete missing shipments.</p><input type="file" id="importFile" accept=".csv,.xlsx,.xls" aria-label="Shiprocket all-orders report"><div id="importReview"></div><p class="note">The exact source file is compressed privately. All sheets, columns and rows survive, including unmapped rows. Parsing runs off the main screen.</p>`,
  );
}
let pendingImport;
async function parseFile(file) {
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) {
    toast("Choose a file smaller than 100 MB.");
    return;
  }
  $("#importReview").innerHTML =
    '<div class="loading">Reading and compressing your report…</div>';
  const worker = new Worker("./workers/import.js");
  try {
    const bytes = await file.arrayBuffer();
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = (ev) =>
        ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data);
      worker.onerror = () =>
        reject(new Error("Workbook parser failed. Check the report format."));
      worker.postMessage({ bytes }, [bytes]);
    });
    pendingImport = { ...result, file };
    if (!$("#importReview")) return;
    $("#importReview").innerHTML =
      `<h3>Ready for review</h3><p>${n(result.sourceRows)} source lines → ${n(result.rows.length)} distinct shipments<br>${n(result.errors.length)} unmapped rows retained in the original archive</p><div class="upload-review">${e(result.sheets.map((s) => `${s.name}: ${s.rows} rows · ${s.recognized ? "mapped" : "archive only; no recognized header"}`).join("\n"))}${result.errors.length ? "\n\n" + e(result.errors.slice(0, 20).join("\n")) : ""}</div><p class="note">Check the mapped sample before confirming. Unknown dates remain empty; missing values are never inferred. Primary users can import valid rows while preserving unmapped source rows in the original.</p><div class="table-wrap"><table><thead><tr><th>AWB</th><th>Merchant order</th><th>Carrier</th><th>Status</th><th>Order date</th></tr></thead><tbody>${result.rows
        .slice(0, 5)
        .map(
          (r) =>
            `<tr><td>${e(r.awb)}</td><td>${e(r.order_id)}</td><td>${e(r.courier)}</td><td>${e(r.status)}</td><td>${date(r.order_date)}</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table></div><button id="commitImport" class="primary">Confirm & import ${n(result.rows.length)} shipments</button><p id="importProgress" role="status"></p>`;
  } catch (err) {
    if ($("#importReview")) $("#importReview").textContent = err.message;
  } finally {
    worker.terminate();
  }
}
async function commitImport(button, resumeBatch = null) {
  if (!pendingImport) return;
  if (state.demo) {
    toast(
      "Preview does not upload data. Configure Supabase to import a real report.",
    );
    return;
  }
  button.disabled = true;
  const item = pendingImport;
  try {
    let batch = resumeBatch;
    const path = `${state.user.id}/${item.hash}.gz`;
    if (!batch) {
      const { data: existing, error: readError } = await state.client
        .from("next_imports")
        .select("*")
        .eq("sha256", item.hash)
        .maybeSingle();
      if (readError) throw readError;
      if (existing?.status === "completed") {
        toast("This exact file has already been imported.");
        return;
      }
      if (existing && existing.owner_id !== state.user.id)
        throw new Error(
          "Another primary user started this file. Ask them to resume the import.",
        );
      batch = existing;
      if (!batch) {
        const { data, error } = await state.client
          .from("next_imports")
          .insert({
            filename: item.file.name,
            object_path: path,
            sha256: item.hash,
            original_bytes: item.file.size,
            compressed_bytes: item.zipped.byteLength,
            source_rows: item.sourceRows,
            rejected_rows: item.errors.length,
            expected_shipments: item.rows.length,
            report: { sheets: item.sheets, errors: item.errors.slice(0, 100) },
          })
          .select()
          .single();
        if (error) throw error;
        batch = data;
      }
    }
    const progress = (message) => {
      if ($("#importProgress")) $("#importProgress").textContent = message;
    };
    progress("Saving compressed original…");
    const { error: storageError } = await state.client.storage
      .from("shiprocket-sources")
      .upload(
        batch.object_path,
        new Blob([item.zipped], { type: "application/gzip" }),
        { upsert: false, contentType: "application/gzip" },
      );
    if (
      storageError &&
      String(storageError.statusCode) !== "409" &&
      !/already exists|duplicate/i.test(storageError.message)
    )
      throw storageError;
    // Two bounded in-flight chunks: small requests, retry-safe staging, less round-trip latency.
    for (let i = 0; i < item.rows.length; i += 600) {
      await Promise.all(
        [item.rows.slice(i, i + 300), item.rows.slice(i + 300, i + 600)]
          .filter((c) => c.length)
          .map((p_rows) => rpc("next_stage", { p_import: batch.id, p_rows })),
      );
      progress(
        `Staged ${n(Math.min(i + 600, item.rows.length))} / ${n(item.rows.length)} shipments`,
      );
    }
    progress("Finalizing atomically…");
    await rpc("next_finalize", { p_import: batch.id });
    pendingImport = null;
    $("#dialog").close();
    toast(
      "Import completed. All original bytes retained; current shipments reconciled.",
    );
    resetPage();
    await render();
  } catch (err) {
    toast(
      `Import incomplete: ${err.message}. Re-select the same file to resume safely.`,
    );
  } finally {
    button.disabled = false;
  }
}
async function ask(question) {
  if (state.asking || !state.user) return;
  state.asking = true;
  const scopedFilter = currentFilter(),
    sessionGeneration = state.sessionGeneration;
  const messages = $("#messages");
  messages.insertAdjacentHTML(
    "beforeend",
    `<div class="message user">${e(question)}</div><div class="message" id="answerPending">Calculating from the current scope…</div>`,
  );
  const button = $("#askForm button");
  button.disabled = true;
  $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight;
  try {
    const q = question.toLowerCase();
    let answer;
    const tokens = question.split(/[\s,;]+/).filter(Boolean);
    const ids = tokens.filter((t) => /\d/.test(t) && /^[a-z0-9_-]+$/i.test(t));
    if (ids.length) {
      const rows = await allRows({ ...scopedFilter, ids });
      answer = `<p>Found ${n(rows.length)} matching shipment records in the current scope.</p>${rows.map((r) => `<p><b>${e(r.awb || r.order_id)}</b> · ${e(r.status)} · ${e(r.courier)} · ${e(r.city)}<br><small>Order ${e(r.order_id)} · promised ${date(r.edd)} · delivered ${date(r.delivered_date)}</small></p>`).join("")}`;
    } else if (/overdue|delay|exception/.test(q)) {
      const rows = await page(
        {
          ...scopedFilter,
          ...(/overdue|delay/.test(q)
            ? { overdue: true }
            : { exceptions: true }),
        },
        0,
        20,
      );
      answer = `<p>Up to 20 matching records in your current scope:</p>${rows.map((r) => `<p>${e(r.awb || r.order_id)} · ${e(r.status)} · EDD ${date(r.edd)} · attempts ${n(r.attempts)}</p>`).join("") || "<p>No matching exceptions.</p>"}<p>I can identify the observed signal. A cause needs recorded remarks or further investigation.</p>`;
    } else if (
      /summari|summary|scope|sla|on.time|deliver|compare|carrier|state|city|customer|rto|return/.test(
        q,
      )
    ) {
      const dimension = /state/.test(q)
        ? "state"
        : /city/.test(q)
          ? "city"
          : /customer/.test(q)
            ? "customer"
            : "courier";
      const s = await summary(scopedFilter, dimension),
        k = s.kpi;
      answer = `<p>Current scope: <b>${n(k.total)}</b> shipments. ${n(k.delivered)} delivered (${pct(k.delivered, k.total)}), ${n(k.rto)} RTO delivered, and ${n(k.open)} nonterminal.</p><p>On-time delivery: ${pct(k.on_time, k.sla_known)} across ${n(k.sla_known)} delivered shipments with promised and actual dates. Missing promises are excluded.</p>`;
      if (/compare|carrier|state|city|customer|rto|return/.test(q)) {
        let groups = [...s.groups];
        if (/rto|return/.test(q)) groups.sort((a, b) => b.rto - a.rto);
        answer += groupTable(groups.slice(0, 10), dimension, false);
        answer +=
          '<p class="muted">Up to 10 groups from the 100 largest groups by shipment volume. Low-volume groups beyond that limit are not ranked.</p>';
      }
    } else
      answer =
        "<p>I can calculate a delivery/SLA summary, compare carriers, states, cities or customer accounts, list exceptions, or look up exact AWBs/order IDs. I could not map this question confidently. Please use one of those forms.</p>";
    if (sessionGeneration === state.sessionGeneration && $("#answerPending")) {
      $("#answerPending").innerHTML = answer;
      $("#answerPending").removeAttribute("id");
    }
  } catch (err) {
    if (sessionGeneration === state.sessionGeneration && $("#answerPending")) {
      $("#answerPending").textContent = err.message;
      $("#answerPending").removeAttribute("id");
    }
  } finally {
    state.asking = false;
    button.disabled = false;
    const scroll = $("#chatScroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }
}
async function establish(session) {
  const generation = ++state.sessionGeneration;
  state.user = session?.user || null;
  if (!state.user) {
    ++state.generation;
    $("#shell").hidden = true;
    $("#auth").hidden = false;
    state.primary = false;
    state.rows = [];
    state.summary = null;
    state.views = [];
    pendingImport = null;
    $("#floatingSharv").hidden = true;
    $("#assistantPanel").hidden = true;
    $("#assistantContent").replaceChildren();
    $("#content").innerHTML = "";
    if ($("#dialog").open) $("#dialog").close();
    return;
  }
  try {
    const primary = state.demo ? true : await rpc("next_is_primary");
    if (generation !== state.sessionGeneration) return;
    state.primary = primary;
    $("#auth").hidden = true;
    $("#shell").hidden = false;
    $("#floatingSharv").hidden = false;
    $("#upload").hidden = !state.primary;
    $("#userLabel").textContent = state.user.email;
    $("#roleLabel").textContent = state.primary
      ? "Primary user · upload access"
      : "Viewer · read & download";
    $("#mode").textContent = state.demo
      ? "Synthetic preview"
      : "Private team access";
    $("#connection").textContent = state.demo
      ? "● Synthetic preview"
      : "● Authenticated";
    if (state.demo) {
      for (const [selector, key] of [
        ["#carriers", "courier"],
        ["#states", "state"],
      ])
        $(selector).innerHTML = [...new Set(demoShipments.map((r) => r[key]))]
          .sort()
          .map((v) => `<option value="${e(v)}">`)
          .join("");
    }
    await render();
  } catch (err) {
    $("#authError").textContent = `Workspace setup incomplete: ${err.message}`;
    $("#shell").hidden = true;
    $("#auth").hidden = false;
  }
}
$("#login").onsubmit = async (ev) => {
  ev.preventDefault();
  const data = new FormData(ev.target),
    button = ev.target.querySelector("button");
  button.disabled = true;
  $("#authError").textContent = "";
  try {
    if (!state.client)
      throw new Error(
        "Connect the new Supabase project first. See SETUP.md.",
      );
    const { data: result, error } = await state.client.auth.signInWithPassword({
      email: data.get("email"),
      password: data.get("password"),
    });
    if (error) throw error;
    ev.target.reset();
    await establish(result.session);
  } catch (err) {
    $("#authError").textContent = err.message;
  } finally {
    button.disabled = false;
  }
};
$("#recover").onclick = async () => {
  const email = $("#login [name=email]").value;
  if (!state.client) {
    toast("Configure the new Supabase project first.");
    return;
  }
  if (!email) {
    toast("Enter your email above, then choose Forgot your password.");
    $("#login [name=email]").focus();
    return;
  }
  const redirect = new URL("./", location.href);
  redirect.hash = "";
  redirect.search = "?recovery=1";
  const { error } = await state.client.auth.resetPasswordForEmail(email, {
    redirectTo: redirect.href,
  });
  toast(
    error
      ? error.message
      : "If this account exists, a recovery email will arrive shortly.",
  );
};
$("#recovery").onsubmit = async (ev) => {
  ev.preventDefault();
  const data = new FormData(ev.target);
  if (data.get("password") !== data.get("confirm")) {
    $("#recoveryError").textContent = "Passwords do not match.";
    return;
  }
  const { error } = await state.client.auth.updateUser({
    password: data.get("password"),
  });
  if (error) {
    $("#recoveryError").textContent = error.message;
    return;
  }
  await state.client.auth.signOut();
  location.replace(location.pathname);
};
$("#logout").onclick = async () => {
  if (state.demo) {
    location.href = location.pathname;
    return;
  }
  const { error } = await state.client.auth.signOut();
  if (error) {
    toast(error.message);
    return;
  }
  state.filter = {};
  $("#filters").reset();
  await establish(null);
};
$("#filters").onsubmit = (ev) => {
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(ev.target));
  if (data.from && data.to && data.from > data.to) {
    toast("From date must be on or before To date.");
    return;
  }
  state.filter = Object.fromEntries(Object.entries(data).filter(([, v]) => v));
  resetPage();
  render();
};
$("#filters").onreset = () => {
  state.filter = {};
  resetPage();
  setTimeout(render, 0);
};
$("#refresh").onclick = () => render();
$("#upload").onclick = openUpload;
$("#export").onclick = exportScope;
$("#history").onclick = () => history().catch((err) => toast(err.message));
$("#closeDialog").onclick = () => $("#dialog").close();
$("#mobileNav").onclick = () => {
  const open = $("#sidebar").classList.toggle("open");
  $("#mobileNav").setAttribute("aria-expanded", String(open));
};
window.addEventListener("hashchange", () => {
  resetPage();
  render();
});
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  try {
    if (b.hasAttribute("data-retry")) await render();
    if (b.dataset.go) location.hash = b.dataset.go;
    if (b.hasAttribute("data-upload")) openUpload();
    if (b.dataset.drill) {
      state.filter[b.dataset.drill] = b.dataset.value;
      writeFilters();
      resetPage();
      if (state.route === "shipments") render();
      else location.hash = "shipments";
    }
    if (b.dataset.detail) await detail(b.dataset.detail);
    if (b.id === "next") {
      state.cursors[++state.page] = state.rows.at(-1).id;
      await render();
    }
    if (b.id === "previous") {
      state.page = Math.max(0, state.page - 1);
      await render();
    }
    if (b.id === "runSearch") {
      state.filter.q = $("#ledgerSearch").value.trim();
      resetPage();
      await render();
    }
    if (b.id === "exportPage")
      download(csv(state.rows), "sharv-current-page.csv");
    if (b.dataset.exportSummary)
      download(
        csv(
          b.dataset.exportSummary === "groups"
            ? state.summary.groups.map((g) => ({
                [state.dimension]: g.dimension,
                Shipments: g.total,
                Delivered: g.delivered,
                "Delivery rate": pct(g.delivered, g.total),
                "RTO delivered": g.rto,
                Open: g.open,
              }))
            : state.summary[b.dataset.exportSummary],
        ),
        `sharv-${b.dataset.exportSummary}.csv`,
      );
    if (b.id === "exportNormalized") await normalizedExport(b);
    if (b.id === "exportRaw") await rawExport(b);
    if (b.id === "commitImport") await commitImport(b);
    if (b.dataset.source) {
      b.disabled = true;
      const batch = state.imports.find((i) => i.id === b.dataset.source);
      download(await sourceFile(batch), batch.filename);
      b.disabled = false;
    }
    if (b.dataset.resume) {
      $("#dialog").close();
      openUpload();
      toast(
        "Re-select the same original file. Its checksum resumes the staged import.",
      );
    }
    if (b.dataset.ask) await ask(b.dataset.ask);
    if (b.dataset.view) {
      const v = state.views.find((v) => v.id === b.dataset.view);
      state.filter = v.definition.filter || {};
      state.dimension = v.definition.dimension || "courier";
      writeFilters();
      location.hash = "performance";
    }
    if (b.dataset.deleteView) {
      if (state.demo)
        state.views = state.views.filter((v) => v.id !== b.dataset.deleteView);
      else {
        const { error } = await state.client
          .from("next_views")
          .delete()
          .eq("id", b.dataset.deleteView);
        if (error) throw error;
      }
      await render();
    }
  } catch (err) {
    toast(err.message);
    b.disabled = false;
  }
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "dimension") {
    state.dimension = ev.target.value;
    render();
  }
  if (ev.target.id === "importFile") parseFile(ev.target.files[0]);
});
document.addEventListener("submit", async (ev) => {
  if (ev.target.id === "askForm") {
    ev.preventDefault();
    const q = ev.target.elements.question.value.trim();
    if (q) {
      ev.target.reset();
      await ask(q);
    }
  }
  if (ev.target.id === "viewForm") {
    ev.preventDefault();
    const form = new FormData(ev.target),
      view = {
        name: form.get("name").trim(),
        definition: {
          dimension: form.get("dimension"),
          filter: { ...state.filter },
        },
      };
    if (!view.name) return;
    try {
      if (state.demo) state.views.push({ ...view, id: crypto.randomUUID() });
      else {
        const { error } = await state.client.from("next_views").insert(view);
        if (error) throw error;
      }
      await render();
      toast("View definition saved.");
    } catch (err) {
      toast(err.message);
    }
  }
});

$("#floatingSharv").onclick = () =>
  $("#assistantPanel").hidden ? openAssistant() : closeAssistant();
$("#commandAssistant").onclick = openAssistant;
$("#closeAssistant").onclick = closeAssistant;
document
  .querySelector('[data-route="sharv"]')
  .addEventListener("click", (ev) => {
    ev.preventDefault();
    openAssistant();
  });
document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
    ev.preventDefault();
    openAssistant();
  }
  if (ev.key === "Escape" && !$("#assistantPanel").hidden) {
    closeAssistant();
  }
  if (
    ev.target.id === "sharvQuestion" &&
    ev.key === "Enter" &&
    !ev.shiftKey &&
    !ev.isComposing
  ) {
    ev.preventDefault();
    if (!state.asking) $("#askForm").requestSubmit();
  }
});
function setupIcons() {
  $$("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
  $$("nav a").forEach((el) => {
    const text = [...el.childNodes].find((n) => n.nodeType === 3);
    if (text) text.remove();
    el.insertAdjacentHTML(
      "afterbegin",
      icon(el.dataset.route === "sharv" ? "spark" : el.dataset.route),
    );
  });
  for (const [id, symbol, text] of [
    ["upload", "upload", "Import Shiprocket report"],
    ["history", "folder", "Source files & imports"],
    ["refresh", "refresh", "Refresh"],
    ["export", "download", "Export data"],
    ["mobileNav", "menu", ""],
    ["logout", "logout", ""],
  ]) {
    $("#" + id).innerHTML = icon(symbol) + (text ? `<span>${text}</span>` : "");
  }
}
setupIcons();

async function boot() {
  if (
    new URLSearchParams(location.search).get("preview") === "1" &&
    ["localhost", "127.0.0.1"].includes(location.hostname)
  ) {
    state.demo = true;
    await establish({ user: { email: "Preview workspace" } });
    return;
  }
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    $("#configNotice").textContent =
      "This new workspace is ready for Supabase configuration. No customer data is loaded. See the setup guide to connect your project.";
    $("#login button[type=submit]").disabled = true;
    return;
  }
  state.client = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
  );
  let recovery = new URLSearchParams(location.search).get("recovery") === "1";
  state.client.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      recovery = true;
      $("#shell").hidden = true;
      $("#floatingSharv").hidden = true;
      $("#assistantPanel").hidden = true;
      $("#auth").hidden = false;
      $("#login").hidden = true;
      $("#recovery").hidden = false;
      return;
    }
    if (event === "SIGNED_OUT") queueMicrotask(() => establish(null));
    if (event === "SIGNED_IN" && !recovery && !state.user)
      queueMicrotask(() => establish(session));
  });
  const { data, error } = await state.client.auth.getSession();
  if (error) {
    $("#authError").textContent = error.message;
    return;
  }
  if (recovery) {
    $("#login").hidden = true;
    $("#recovery").hidden = false;
  } else await establish(data.session);
}
boot().catch((err) => {
  $("#authError").textContent = err.message;
});
