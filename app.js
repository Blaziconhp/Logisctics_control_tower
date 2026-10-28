import {
  enrich,
  matches,
  summarize,
  metrics,
  groupMetrics,
  ledgerExport,
  rawLines,
  findIdentifiers,
  day,
} from "./lib/analytics.mjs?v=report4";
import {
  label,
  table,
  menu,
  performanceView,
  queueAnalysis,
  customBuilder,
  customRows,
} from "./lib/views.mjs?v=report4";
import { createDemoShipments } from "./lib/demo.mjs";
import {
  escapeHtml as e,
  csv,
  TERMINAL,
  selectSourceRows,
} from "./lib/model.mjs?v=report4";
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
    "Custom view",
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
  dimension: "master_courier",
  queue: "lm",
  tables: {},
  dataset: null,
  datasetPromise: null,
  customDefinition: null,
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
const dateTime = (v) =>
  v
    ? new Date(v).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
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
    ...(state.route === "exceptions" ? { queue: state.queue } : {}),
  };
}
const demoShipments = createDemoShipments().map((r) => ({
  ...r,
  details: {
    master_courier: r.courier,
    zone: ["z_a", "z_b", "z_c", "z_d"][r.id % 4],
    lines: [{ product: r.product, sku: r.sku, quantity: r.quantity }],
    pickup_attempt_date: r.pickup_date,
  },
}));
async function dataset() {
  if (state.dataset) return enrich(state.dataset);
  if (!state.datasetPromise) {
    const session = state.sessionGeneration;
    const promise = (async () => {
      let rows = [];
      if (state.demo) rows = demoShipments;
      else {
        let after = 0;
        for (;;) {
          const batch = await rpc("next_page", {
            p_filter: {},
            p_after: after,
            p_limit: 1000,
          });
          if (session !== state.sessionGeneration)
            throw new Error("Session changed. Please retry.");
          if (!Array.isArray(batch))
            throw new Error("Invalid shipment response");
          rows.push(...batch);
          if (batch.length < 1000) break;
          const next = batch.at(-1).id;
          if (next <= after) throw new Error("Shipment paging did not advance");
          after = next;
        }
      }
      if (session === state.sessionGeneration) state.dataset = rows;
      return rows;
    })();
    state.datasetPromise = promise;
    promise
      .finally(() => {
        if (state.datasetPromise === promise) state.datasetPromise = null;
      })
      .catch(() => {});
  }
  return enrich(await state.datasetPromise);
}
async function summary(filter = currentFilter(), dimension = state.dimension) {
  return summarize(
    (await dataset()).filter((r) => matches(r, filter)),
    dimension,
  );
}
async function page(filter = currentFilter(), after = 0, limit = 50) {
  return (await dataset())
    .filter((r) => r.id > after && matches(r, filter))
    .slice(0, limit);
}
function kpis(k) {
  const cards = [
    [
      "Total unique orders",
      n(k.total),
      "Merchant order ID is the counting key",
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
      "Open orders",
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
      "RTO orders",
      pct(k.rto, k.total),
      `${n(k.rto)} shipments in RTO`,
      "return",
      "red",
    ],
  ];
  return `<section class="kpis" aria-label="Shipment metrics">${cards.map(([label, value, note, symbol, tone]) => `<article class="kpi ${tone}"><div class="kpi-head"><label>${label}</label><span class="kpi-icon">${icon(symbol)}</span></div><strong>${value}</strong><p><span class="metric-dot"></span>${note}</p></article>`).join("")}</section>`;
}
function groupTable(groups, dimension, drill = true) {
  return `<div class="table-wrap"><table><thead><tr><th>${e(label(dimension))}</th><th>Unique orders</th><th>Delivered</th><th>Delivery rate</th><th>RTO orders</th><th>Open</th></tr></thead><tbody>${groups.map((g) => `<tr><td>${drill && ["master_courier", "courier", "state", "city", "customer", "status"].includes(dimension) && g.dimension !== "Unknown" ? `<button data-drill="${e(dimension)}" data-value="${e(g.dimension)}">${e(g.dimension)} ↗</button>` : e(g.dimension)}</td><td>${n(g.total)}</td><td>${n(g.delivered)}</td><td>${pct(g.delivered, g.total)}</td><td>${n(g.rto)}</td><td>${n(g.open)}</td></tr>`).join("")}</tbody></table></div>`;
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
      ? s.days.slice(-31).map((x) => ({
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
  return `<div class="network-brief"><div class="brief-icon">${icon("spark")}</div><div><b>Your network at a glance</b><p>${n(k.total)} unique orders in scope · ${n(k.exceptions)} need operational review · Latest order date ${k.latest_order_date ? e(date(k.latest_order_date)) : "unavailable"}</p></div><button data-go="exceptions">Review action queue ${icon("arrow")}</button></div>${kpis(k)}<div class="grid"><article class="card"><header class="card-head"><div><h3>Shipment volume</h3><p>${daily ? "Daily unique-order volume · latest 31 available dates" : "Order-date volume · latest 10 available months"}</p></div><button data-export-summary="${daily ? "days" : "months"}" aria-label="Export shipment volume">↓ CSV</button></header><div class="card-body chart-scroll"><div class="chart-bars" role="img" aria-label="Unique order counts by order date">${months.map((m) => `<div class="chart-col" title="${e(m.month)}: ${n(m.total)} unique orders"><b>${n(m.total)}</b><div class="bar" style="height:${Math.max(2, (125 * m.total) / max)}px"></div><small>${e(m.month)}</small></div>`).join("")}</div><p class="chart-caption">${n(k.dates_known)} of ${n(k.total)} unique orders have an order date. Counts use the current filters.</p></div></article><article class="card"><header class="card-head"><div><h3>Delivery outcomes</h3><p>Current order status</p></div><button data-export-summary="outcomes" aria-label="Export delivery outcomes">↓ CSV</button></header><div class="card-body outcome"><div class="ring" style="background:conic-gradient(${stops || "#edf2ee 0% 100%"})"><div>${pct(k.delivered, k.total)}<small>DELIVERED</small></div></div><div class="legend">${s.outcomes.map((o, i) => `<p><span><i style="background:${colors[i % colors.length]}"></i>${e(o.status)}</span><b>${n(o.total)}</b></p>`).join("")}</div></div></article></div><div class="grid"><article class="card"><header class="card-head"><div><h3>Your operational brief</h3><p>Observed signals, with clear next steps</p></div><span class="badge">CURRENT SCOPE</span></header><div class="insight"><span>⚑</span><div><h3>${n(k.exceptions)} orders need review</h3><p>Pickup pendency, forward NDR/EDD breaches, and RTO orders.</p></div><button data-go="exceptions" aria-label="Open action queue">↗</button></div><div class="insight"><span>◷</span><div><h3>${pct(k.sla_known, k.delivered)} SLA evidence coverage</h3><p>On-time performance uses only delivered orders with both promised and actual delivery dates. No target is guessed.</p></div></div><div class="insight"><span>↩</span><div><h3>${n(k.rto)} orders in RTO</h3><p>${pct(k.rto, k.total)} of this scope is in RTO. A recorded return reason is needed to explain why.</p></div></div></article><article class="card"><header class="card-head"><div><h3>Carrier snapshot</h3><p>Largest carriers by unique-order volume</p></div><button data-go="performance">Explore ↗</button></header>${groupTable(s.groups.slice(0, 5), "master_courier")}<div class="table-footer">Delivery rate = delivered ÷ all unique orders in scope</div></article></div>`;
}
function ledger(rows) {
  const cols = [
    "order_id",
    "awb",
    "recipient",
    "master_courier",
    "courier",
    "city",
    "state",
    "status",
    "order_date",
    "quantity",
    "attempts",
    "reason",
    "buyer_type",
    ...(state.route === "exceptions"
      ? ["lm_bucket", "risk", "edd_age_days"]
      : []),
  ];
  state.tables.ledger = rows.length
    ? state.scopeRows.map((r) =>
        Object.fromEntries(
          cols.map((k) => [
            label(k),
            k === "order_date" ? date(r[k]) : (r[k] ?? null),
          ]),
        ),
      )
    : [];
  return `<div class="toolbar"><input id="ledgerSearch" aria-label="Search shipment ledger" placeholder="Search order ID, AWB, customer, destination…" value="${e(state.filter.q || "")}"><button id="runSearch">Search</button></div><article class="card"><header class="card-head"><div><h3>Shipment records</h3><p>50 per page · product quantities summed per shipment · ${n(state.scopeRows.length)} in scope</p></div>${menu()}</header><div class="table-wrap"><table><thead><tr>${cols.map((k) => `<th>${e(label(k))}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((k) => `<td>${k === "order_id" ? `<button data-detail="${r.id}">${e(r.order_id || r.awb)} ↗</button>` : k === "status" ? status(r.status) : k === "order_date" ? date(r[k]) : e(k === "awb" && r.awb_issue ? "Source AWB needs correction" : (r[k] ?? "—"))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}">No matching records.</td></tr>`}</tbody></table></div><footer class="table-footer"><span>Page ${state.page + 1} · ${rows.length} shown</span><div><button id="previous" ${state.page === 0 ? "disabled" : ""}>← Previous</button><button id="next" ${!state.hasNext ? "disabled" : ""}>Next →</button></div></footer></article>`;
}
function performance() {
  return performanceView(
    state.scopeRows,
    state.dimension,
    state.tables,
    state.tableSources,
  );
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
  return customBuilder(
    state.scopeRows,
    state.views,
    state.customDefinition,
    state.tables,
    state.tableSources,
  );
}
function readCustom(form) {
  const f = new FormData(form);
  return {
    name: f.get("name"),
    source: f.get("source"),
    type: f.get("type"),
    dimension: f.get("dimension"),
    metric: f.get("metric"),
    aggregate: f.get("aggregate"),
    field: f.get("field"),
    columns: f.getAll("columns"),
    grouped: f.has("grouped"),
    filter: { ...state.filter },
  };
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
    const all = await dataset();
    if (generation !== state.generation) return;
    state.scopeRows = all.filter((r) => matches(r, currentFilter()));
    state.tables = { ledger: ledgerExport(state.scopeRows) };
    state.tableSources = {};
    writeFilters(all);
    $("#queueCount").textContent = n(
      all.filter((r) => r.fm_pending || r.lm_bucket).length,
    );
    $("#scope").textContent = state.demo
      ? "DEMO · September 2026 · Synthetic data"
      : `${n(state.scopeRows.length)} shipments · ${n(new Set(state.scopeRows.map((r) => r.order_id).filter(Boolean)).size)} unique orders · Shiprocket created date · Asia/Kolkata`;
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
      html =
        (state.route === "exceptions"
          ? `<div class="queue-tabs" role="group" aria-label="Action queue type">${[
              ["fm", "FM pendency"],
              ["lm", "LM pendency"],
              ["rto", "RTO Data"],
            ]
              .map(
                ([k, v]) =>
                  `<button data-queue="${k}" aria-pressed="${state.queue === k}">${v}</button>`,
              )
              .join("")}</div>` +
            queueAnalysis(
              state.scopeRows,
              state.queue,
              state.tables,
              state.tableSources,
            )
          : "") + ledger(state.rows);
    } else {
      const s = await summary(
        currentFilter(),
        state.route === "overview" ? "master_courier" : state.dimension,
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
    if (!state.demo && all.some((r) => r.details?.mapping_version !== 2))
      $("#content").insertAdjacentHTML(
        "afterbegin",
        '<div class="note migration-note">Some records use the earlier import mapping. A primary user should run the report-v2 database upgrade, then re-upload the original report to restore complete dates, products and destination fields.</div>',
      );
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
function writeFilters(all) {
  if (!all) {
    dataset()
      .then(writeFilters)
      .catch((err) => toast(err.message));
    return;
  }
  const keys = [
    "master_courier",
    "state",
    "city",
    "status",
    "warehouse",
    "risk",
    "reason",
  ];
  const active = Object.entries(state.filter).filter(([key, value]) => key !== "q" && value !== undefined && value !== "" && (!Array.isArray(value) || value.length));
  $("#filters").innerHTML =
    `<div class="filter-topline"><div><b>Refine network</b><span>${active.length ? `${active.length} filter${active.length === 1 ? "" : "s"} active` : "All unique orders"}</span></div><button type="reset" class="filter-clear" ${active.length ? "" : "disabled"}>Clear all</button></div><div class="filter-controls"><div class="date-range"><span>Order date</span><label>From<input name="from" type="date" value="${e(state.filter.from || "")}"></label><i>→</i><label>To<input name="to" type="date" value="${e(state.filter.to || "")}"></label></div>${keys
      .map((k) => {
        const choices = [
          ...new Set(all.map((r) => r[k] || "Unknown")),
          ...(k === "status" ? ["NDR", "EDD Breach", "NDR/EDD breach"] : []),
        ].sort();
        const chosen = state.filter[k],
          isAll = chosen === undefined || chosen === "";
        return `<details class="multi-filter" data-filter="${k}"><summary><span>${e(label(k))}</span><small>${isAll ? "All" : Array.isArray(chosen) ? chosen.length + " selected" : e(chosen)}</small></summary><div class="multi-options"><div class="option-title"><b>${e(label(k))}</b><small>Choose one or more</small></div><input type="search" class="option-search" placeholder="Search ${e(label(k)).toLowerCase()}…" aria-label="Search ${e(label(k))}"><label class="select-all"><input type="checkbox" data-select-all="${k}" ${isAll ? "checked" : ""}>Select all</label><div class="option-list">${choices.map((v) => `<label class="filter-option"><input type="checkbox" name="${k}" value="${e(v)}" ${isAll || (Array.isArray(chosen) ? chosen.includes(v) : chosen === v) ? "checked" : ""}><span>${e(v)}</span></label>`).join("")}</div></div></details>`;
      })
      .join(
        "",
      )}<button class="primary filter-apply">Apply filters</button></div>${active.length ? `<div class="active-filters">${active.map(([key, value]) => `<button type="button" data-remove-filter="${e(key)}"><span>${e(label(key))}</span>${e(Array.isArray(value) ? `${value.length} selected` : String(value))}<b>×</b></button>`).join("")}</div>` : ""}`;
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
async function allRows(filter = currentFilter()) {
  return (await dataset()).filter((r) => matches(r, filter));
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
    download(csv(ledgerExport(rows)), "sharv-shipments.csv");
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
    `<h2>Source files & imports</h2><p>Latest 100 imports · immutable private originals · India time</p><div class="table-wrap"><table><thead><tr><th>File</th><th>Import started</th><th>Imported into app</th><th>Order-date coverage</th><th>Status</th><th>Rows</th><th>Stored size</th><th>Download</th></tr></thead><tbody>${data.map((b) => `<tr><td>${e(b.filename)}<br><small>${b.report?.origin === "shiprocket-report" ? "Scheduled API report" : "Manual upload"}</small></td><td>${dateTime(b.created_at)}</td><td>${b.completed_at ? dateTime(b.completed_at) : "Pending"}</td><td>${b.report?.latest_order_date ? `${date(b.report.first_order_date)} → ${date(b.report.latest_order_date)}` : "Not recorded"}</td><td>${e(b.status)}</td><td>${n(b.source_rows)}<br><small>${n(b.rejected_rows)} unmapped</small></td><td>${n(b.compressed_bytes / 1024)} KB<br><small>${pct(b.compressed_bytes, b.original_bytes)} of original</small></td><td><button data-source="${b.id}">Original file ↓</button>${b.status === "staging" && state.primary && b.owner_id === state.user.id ? `<button data-resume="${b.id}">Resume import</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`,
  );
}
async function rawExport(button, selectedRows = null) {
  if (state.demo) {
    toast("Synthetic preview has no raw source files.");
    return;
  }
  button.disabled = true;
  try {
    const rows = selectedRows || (await allRows(currentFilter()));
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
          raw: true,
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
    `<p class="eyebrow">SHIPMENT RECORD</p><h2>${e(row.awb || row.order_id)}</h2>${status(row.status)}<h3>All products · ${n(row.quantity)} units</h3>${table(row.lines || [], ["product", "sku", "quantity"])}<div class="detail-grid">${Object.entries(
      row,
    )
      .filter(
        ([k, v]) =>
          !["source_refs", "shipment_key", "id"].includes(k) &&
          typeof v !== "object",
      )
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
  const worker = new Worker("./workers/import.js?v=report4");
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
      `<h3>Ready for review</h3><p>${n(result.sourceRows)} source lines → ${n(result.rows.length)} distinct shipments · ${n(new Set(result.rows.map((r) => r.order_id).filter(Boolean)).size)} unique orders<br>${n(result.errors.length)} unmapped rows retained in the original archive</p><p class="note">${n(result.rows.filter((r) => r.details?.awb_issue).length)} orders have scientific-notation AWBs. These remain separate by order ID. Re-export their original tracking numbers as text to restore AWB tracking.</p><div class="upload-review">${e(result.sheets.map((s) => `${s.name}: ${s.rows} rows · ${s.recognized ? "mapped" : "archive only; no recognized header"}`).join("\n"))}${result.errors.length ? "\n\n" + e(result.errors.slice(0, 20).join("\n")) : ""}</div><p class="note">Check the mapped sample before confirming. Unknown dates remain empty; missing values are never inferred. Primary users can import valid rows while preserving unmapped source rows in the original.</p><div class="table-wrap"><table><thead><tr><th>AWB</th><th>Merchant order</th><th>Carrier</th><th>Status</th><th>Order date</th></tr></thead><tbody>${result.rows
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
      if (
        existing?.status === "completed" ||
        (existing?.report?.mapping_version !== 2 && existing)
      ) {
        await rpc("next_reprocess", {
          p_import: existing.id,
          p_expected: item.rows.length,
          p_report: {
            mapping_version: 2,
            sheets: item.sheets,
            errors: item.errors.slice(0, 100),
            first_order_date: item.rows.map((r) => r.order_date).filter(Boolean).sort()[0] || null,
            latest_order_date: item.rows.map((r) => r.order_date).filter(Boolean).sort().at(-1) || null,
          },
        });
        existing.status = "staging";
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
            report: {
              mapping_version: 2,
              sheets: item.sheets,
              errors: item.errors.slice(0, 100),
              first_order_date: item.rows.map((r) => r.order_date).filter(Boolean).sort()[0] || null,
              latest_order_date: item.rows.map((r) => r.order_date).filter(Boolean).sort().at(-1) || null,
            },
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
    state.dataset = null;
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
    const q = question.toLowerCase(),
      all = await dataset();
    const exact = findIdentifiers(question, all);
    let answer;
    if (exact.length) {
      const outside = exact.some((r) => !matches(r, scopedFilter));
      answer =
        `<p>Found <b>${exact.length}</b> matching shipment${exact.length === 1 ? "" : "s"} across your authorized database.${outside ? " This ID lookup includes records outside the current workspace filters." : ""}</p>` +
        exact
          .map(
            (r) =>
              `<h3>Order ${e(r.order_id)} · ${e(r.status)}</h3><p>AWB ${e(r.awb)} · ${e(r.master_courier)} / ${e(r.courier)}<br>${e(r.recipient)} · ${e(r.city)}, ${e(r.state)}<br>Order date ${date(r.order_date)} · pickup ${date(r.pickup_date)} · EDD ${date(r.edd)} · delivered ${date(r.delivered_date)}<br>${n(r.quantity)} units · ${n(r.attempts)} attempts · ${e(r.buyer_type)}<br>Reason: ${e(r.reason || "Not provided")}<br>Delivery SLA: ${r.sla_days == null ? "Not available" : n(r.sla_days) + " days"}</p>${table(r.lines || [], ["product", "sku", "quantity"])}`,
          )
          .join("");
    } else {
      const filter = { ...scopedFilter };
      // Known entity names select data; user text is never treated as SQL or executable code.
      for (const key of [
        "master_courier",
        "courier",
        "state",
        "city",
        "warehouse",
        "payment",
        "recipient",
      ]) {
        const found = [
          ...new Set(all.map((r) => r[key]).filter(Boolean)),
        ].filter(
          (v) => String(v).length >= 3 && q.includes(String(v).toLowerCase()),
        );
        if (found.length && key !== "recipient") filter[key] = found;
      }
      const dates = question.match(/\b\d{4}-\d{2}-\d{2}\b/g);
      if (dates) {
        filter.from = dates[0];
        filter.to = dates[1] || dates[0];
      }
      if (/rto|return/.test(q)) filter.queue = "rto";
      else if (/first.mile|fm pend|pickup pend/.test(q)) filter.queue = "fm";
      else if (/ndr|undelivered/.test(q)) filter.status = ["Undelivered"];
      else if (/overdue|edd breach|late shipment/.test(q))
        filter.overdue = true;
      let rows = all.filter((r) => matches(r, filter));
      const dimension = /warehouse|pickup location/.test(q)
        ? "warehouse"
        : /state/.test(q)
          ? "state"
          : /city/.test(q)
            ? "city"
            : /customer|buyer/.test(q)
              ? "customer_label"
              : /payment|cod|prepaid/.test(q)
                ? "payment"
                : /zone/.test(q)
                  ? "zone"
                  : "master_courier";
      if (
        /summary|summari|scope|how many|count|total|sla|p90|p95|on.time|deliver|compare|carrier|courier|state|city|customer|rto|return|pickup|warehouse|zone|payment|ndr|breach|overdue/.test(
          q,
        )
      ) {
        const k = metrics(rows);
        answer = `<p><b>${n(k.total)} shipments</b> (${n(k.unique_orders)} unique orders) match this question and scope. ${n(k.delivered)} delivered (${pct(k.delivered, k.total)}), ${n(k.intransit)} in transit (${pct(k.intransit, k.total)}), ${n(k.rto)} RTO (${pct(k.rto, k.total)}).</p><p>Average delivery SLA: ${k.avg_transit == null ? "—" : n(k.avg_transit) + " days"}; P90 ${k.p90 == null ? "—" : n(k.p90)}; P95 ${k.p95 == null ? "—" : n(k.p95)} (${n(k.sla_samples)} measured deliveries).<br>On-time pickup: ${pct(k.pickup_on_time, k.pickup_known)} (${n(k.pickup_on_time)}/${n(k.pickup_known)}).<br>On-time delivery: ${pct(k.on_time, k.sla_known)} (${n(k.on_time)}/${n(k.sla_known)}).</p>`;
        if (/reason|why|list|show.*order|pending|overdue|breach|ndr/.test(q))
          answer += table(
            ledgerExport(rows),
            [
              "order_id",
              "awb",
              "status",
              "city",
              "reason",
              "lm_bucket",
              "edd_age_days",
            ],
            30,
          );
        else
          answer += table(
            groupMetrics(rows, dimension),
            [
              "dimension",
              "total",
              "delivered",
              "intransit",
              "rto",
              "avg_transit",
              "p90",
              "p95",
            ],
            30,
          );
        answer +=
          '<p class="muted">Calculated from all matching records, not just the visible table page. Missing dates are excluded from evidence-based rates.</p>';
      } else {
        const terms = q
          .replace(/[^a-z0-9 _-]/g, " ")
          .split(/\s+/)
          .filter(
            (t) =>
              t.length > 2 &&
              ![
                "find",
                "show",
                "details",
                "order",
                "about",
                "please",
                "the",
                "for",
              ].includes(t),
          );
        rows = all.filter(
          (r) =>
            terms.length &&
            terms.every((t) =>
              [
                r.order_id,
                r.awb,
                r.recipient,
                r.product,
                r.sku,
                r.city,
                r.state,
                r.master_courier,
              ]
                .join(" ")
                .toLowerCase()
                .includes(t),
            ),
        );
        answer = rows.length
          ? `<p>${rows.length} database matches:</p>` +
            table(
              ledgerExport(rows),
              [
                "order_id",
                "awb",
                "recipient",
                "status",
                "city",
                "quantity",
                "reason",
              ],
              30,
            )
          : "<p>No matching record found. Paste the complete order ID or AWB, or ask for a courier, destination, pickup, SLA, NDR, or RTO comparison. I will not guess missing records or reasons.</p>";
      }
    }
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
    state.dataset = null;
    state.datasetPromise = null;
    state.scopeRows = [];
    state.tables = {};
    state.tableSources = {};
    state.customDefinition = null;
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
      throw new Error("Connect the new Supabase project first. See SETUP.md.");
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
  const next = {
    ...state.filter,
    from: data.from || undefined,
    to: data.to || undefined,
  };
  for (const el of ev.target.querySelectorAll("[data-filter]")) {
    const k = el.dataset.filter;
    const inputs = [...el.querySelectorAll(`input[name="${k}"]`)];
    if (inputs.every((x) => x.checked)) delete next[k];
    else next[k] = inputs.filter((x) => x.checked).map((x) => x.value);
  }
  state.filter = next;
  resetPage();
  render();
};
$("#filters").onreset = () => {
  state.filter = {};
  resetPage();
  setTimeout(render, 0);
};
$("#refresh").onclick = () => {
  state.dataset = null;
  render();
};
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
    if (b.dataset.removeFilter) {
      delete state.filter[b.dataset.removeFilter];
      resetPage();
      writeFilters(await dataset());
      await render();
      return;
    }
    if (b.hasAttribute("data-retry")) await render();
    if (b.dataset.queue) {
      state.queue = b.dataset.queue;
      resetPage();
      await render();
    }
    if (b.dataset.raw)
      await rawExport(b, state.tableSources[b.dataset.raw] || state.scopeRows);
    if (b.dataset.computed)
      download(
        csv(state.tables[b.dataset.computed] || []),
        `sharv-${b.dataset.computed}.csv`,
      );
    if (b.id === "previewCustom") {
      state.customDefinition = readCustom($("#viewForm"));
      await render();
    }
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
                "RTO shipments": g.rto,
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
      state.customDefinition = {
        source: "shipments",
        type: "table",
        grouped: true,
        metric: "total",
        ...v.definition,
        name: v.name,
      };
      writeFilters();
      await render();
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
  if (ev.target.dataset.selectAll) {
    const el = ev.target.closest("[data-filter]");
    el.querySelectorAll("input[name]").forEach(
      (x) => (x.checked = ev.target.checked),
    );
  }
  if (ev.target.closest(".multi-options") && ev.target.name) {
    const el = ev.target.closest("[data-filter]"),
      checks = [...el.querySelectorAll("input[name]")],
      all = el.querySelector("[data-select-all]");
    all.checked = checks.every((x) => x.checked);
    all.indeterminate = checks.some((x) => x.checked) && !all.checked;
  }
  if (ev.target.id === "customSource") {
    state.customDefinition = readCustom($("#viewForm"));
    state.customDefinition.columns =
      state.customDefinition.source === "raw"
        ? Object.keys(rawLines(state.scopeRows)[0] || {}).slice(0, 10)
        : undefined;
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
        definition: readCustom(ev.target),
      };
    if (!view.name) return;
    try {
      if (state.demo) state.views.push({ ...view, id: crypto.randomUUID() });
      else {
        const { error } = await state.client.from("next_views").insert(view);
        if (error) throw error;
      }
      state.customDefinition = view.definition;
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

document.addEventListener("input", (ev) => {
  if (ev.target.classList.contains("option-search")) {
    const q = ev.target.value.toLowerCase();
    ev.target.parentElement
      .querySelectorAll(".filter-option")
      .forEach((l) => (l.hidden = !l.textContent.toLowerCase().includes(q)));
  }
});
