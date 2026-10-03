(() => {
  "use strict";

  const CONFIG = window.SHARV_CONFIG || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const formatNumber = (value, digits = 0) => hasNumber(value) ? Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits }) : "—";
  const formatPercent = (value, digits = 1) => hasNumber(value) ? `${(Number(value) * 100).toFixed(digits)}%` : "—";
  const formatCurrency = (value) => hasNumber(value) ? `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—";
  const formatDate = (value, options = {}) => value ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: options.short ? undefined : "numeric" }).format(new Date(value)) : "Not available";
  const slugify = (value) => String(value || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  async function boundedFetch(request, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Supabase request timed out after 60 seconds.")), 60000);
    const abort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", abort, { once: true });
    try { return await fetch(request, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timeout); init.signal?.removeEventListener("abort", abort); }
  }

  const PALETTE = {
    blue: "#2f6fed",
    teal: "#0c8b75",
    amber: "#c96d12",
    red: "#c4373f",
    slate: "#667085",
    lightBlue: "#9bb7f4",
    lightTeal: "#8ac9bc"
  };

  const ROUTES = {
    overview: { kicker: "Network operations", title: "Control tower overview" },
    performance: { kicker: "Courier intelligence", title: "Performance" },
    exceptions: { kicker: "Action queue", title: "Exceptions" },
    shipments: { kicker: "Shipment ledger", title: "Shipments" },
    insights: { kicker: "Network intelligence", title: "Insights & suggestions" },
    studio: { kicker: "Personal analytics", title: "Custom studio" },
    sharv: { kicker: "Operations copilot", title: "Ask SHARV" }
  };

  const state = {
    supabase: null,
    user: null,
    role: "viewer",
    demo: false,
    route: "overview",
    shipments: [],
    lineItems: [],
    filtered: [],
    filters: { couriers: [], states: [], statuses: [], customers: [], from: "", to: "" },
    charts: new Map(),
    currentTable: null,
    savedViews: [],
    selectedViewId: null,
    chat: [],
    chatScope: "all",
    lastSharvRows: [],
    dataUpdatedAt: null,
    uploadSource: "ITL",
    uploadFile: null,
    exports: new Map(),
    slaRules: [],
    tableQuery: "",
    tablePage: 1,
    builder: {
      id: null,
      name: "Courier service scorecard",
      viewType: "table",
      rowDimension: "courier",
      columnDimension: "none",
      metric: "onTimeRate",
      sort: "desc",
      limit: 10,
      useGlobalFilters: true
    }
  };

  function icon(name, className = "") {
    const paths = {
      more: '<circle cx="12" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
      trend: '<path d="m4 16 5-5 4 4 7-8"/><path d="M15 7h5v5"/>',
      alert: '<path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3v.01"/>',
      package: '<path d="m4 7 8-4 8 4v10l-8 4-8-4V7Z"/><path d="m4 7 8 4 8-4M12 11v10"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M7.5 16.5 16.5 7.5"/>',
      download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/>',
      copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
      image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 20"/>',
      chevron: '<path d="m9 18 6-6-6-6"/>',
      spark: '<path d="m12 2 1.4 5.2L18 10l-4.6 2.8L12 18l-1.4-5.2L6 10l4.6-2.8L12 2Z"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      filter: '<path d="M4 5h16M7 12h10m-7 7h4"/>',
      file: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'
    };
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.package}</svg>`;
  }

  function seededRandom(seed = 19) {
    let value = seed % 2147483647;
    return () => (value = value * 16807 % 2147483647) / 2147483647;
  }

  function generateDemoShipments(count = 640) {
    const random = seededRandom(20260928);
    const couriers = ["Delhivery", "Blue Dart", "Xpressbees", "Ecom Express", "Blitz"];
    const locations = [
      ["Bengaluru", "Karnataka"], ["Mumbai", "Maharashtra"], ["Pune", "Maharashtra"],
      ["Delhi", "Delhi"], ["Hyderabad", "Telangana"], ["Chennai", "Tamil Nadu"],
      ["Jaipur", "Rajasthan"], ["Ahmedabad", "Gujarat"], ["Kolkata", "West Bengal"],
      ["Lucknow", "Uttar Pradesh"], ["Gurugram", "Haryana"], ["Kochi", "Kerala"]
    ];
    const customers = ["Aarav Retail", "Blue Mango", "Cedar & Co.", "D2C Labs", "Earthful", "Fable Street", "Good Glamm", "House of Masaba", "Inde Wild", "Jade Wellness"];
    const recipients = ["Aarav Mehta", "Ananya Rao", "Diya Kapoor", "Ishaan Verma", "Kabir Singh", "Maya Iyer", "Neha Shah", "Reyansh Das", "Sara Khan", "Vihaan Joshi"];
    const records = [];
    const today = new Date();
    for (let index = 0; index < count; index += 1) {
      const orderDate = new Date(today);
      orderDate.setDate(today.getDate() - Math.floor(random() * 125));
      const courier = couriers[Math.floor(random() * couriers.length)];
      const [city, region] = locations[Math.floor(random() * locations.length)];
      const customer = customers[Math.floor(random() * customers.length)];
      const recipientName = recipients[Math.floor(random() * recipients.length)];
      const serviceTarget = [2, 3, 4][Math.floor(random() * 3)];
      const roll = random();
      const statusGroup = roll < .715 ? "Delivered" : roll < .805 ? "In Transit" : roll < .87 ? "NDR / Undelivered" : roll < .948 ? "RTO In Progress" : roll < .978 ? "Cancelled" : "Lost / Damaged";
      const pickup = new Date(orderDate); pickup.setDate(orderDate.getDate() + (random() > .16 ? 1 : 2));
      const tat = statusGroup === "Delivered" ? Math.max(1, Math.round(serviceTarget + (random() - .54) * 4)) : null;
      const delivered = tat ? new Date(pickup.getTime() + tat * 864e5) : null;
      const edd = new Date(pickup.getTime() + serviceTarget * 864e5);
      const age = ["In Transit", "NDR / Undelivered", "RTO In Progress"].includes(statusGroup) ? Math.max(1, Math.floor((today - pickup) / 864e5)) : null;
      const attempts = statusGroup === "Delivered" ? (random() < .78 ? 1 : random() < .94 ? 2 : 3) : statusGroup === "Cancelled" ? 0 : Math.floor(random() * 4);
      const orderId = `ORD${String(870000 + index).padStart(7, "0")}`;
      const awb = `${courier === "Blitz" ? "GS" : ""}${12378495000 + index}`;
      records.push({
        id: `demo-${index + 1}`, source: courier === "Blitz" ? "Blitz" : "ITL", awb, orderId,
        customer, recipientName, courier, city, state: region, pincode: String(100000 + Math.floor(random() * 899999)),
        warehouse: ["Bengaluru WH", "Mumbai WH", "Delhi NCR WH"][Math.floor(random() * 3)],
        payment: random() > .48 ? "Prepaid" : "COD", mode: random() > .16 ? "Surface" : "Air",
        direction: statusGroup.startsWith("RTO") ? "RTO" : "Forward", status: statusGroup === "Delivered" ? "Delivered" : statusGroup,
        statusGroup, orderDate: orderDate.toISOString(), pickupDate: pickup.toISOString(), deliveredDate: delivered?.toISOString() || null,
        edd: edd.toISOString(), tat, serviceTarget, age, attempts,
        freight: courier === "Blitz" ? null : Math.round(56 + random() * 176),
        ndrStatus: statusGroup === "NDR / Undelivered" ? ["Customer unavailable", "Address issue", "Reschedule requested"][Math.floor(random() * 3)] : "",
        remark: statusGroup.startsWith("RTO") ? ["Customer refused", "Three failed attempts", "Address incomplete"][Math.floor(random() * 3)] : statusGroup === "Lost / Damaged" ? "Exception raised with courier" : "",
        onTime: delivered ? delivered <= edd : null,
        uploadBatch: index < 420 ? "September import" : "August import"
      });
    }
    Object.assign(records[0], { awb: "12378495599", orderId: "ORD-DEMO-599", customer: "Aarav Retail", recipientName: "Aarav Mehta", courier: "Delhivery", city: "Pune", state: "Maharashtra", status: "In Transit", statusGroup: "In Transit", age: 5, attempts: 1, tat: null, deliveredDate: null, onTime: null });
    Object.assign(records[1], { awb: "GS12374995", orderId: "ORD-DEMO-995", customer: "Blue Mango", recipientName: "Ananya Rao", courier: "Blitz", city: "Bengaluru", state: "Karnataka", status: "NDR / Undelivered", statusGroup: "NDR / Undelivered", age: 8, attempts: 2, tat: null, deliveredDate: null, onTime: null, freight: null, ndrStatus: "Customer requested reattempt" });
    return records;
  }

  function groupRows(rows, key) {
    const map = new Map();
    rows.forEach((row) => {
      const label = typeof key === "function" ? key(row) : row[key];
      if (!map.has(label || "Unknown")) map.set(label || "Unknown", []);
      map.get(label || "Unknown").push(row);
    });
    return map;
  }

  function percentile(values, quantile) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * quantile;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  }

  function metrics(rows) {
    const delivered = rows.filter((row) => row.statusGroup === "Delivered");
    const rto = rows.filter((row) => row.statusGroup.startsWith("RTO"));
    const open = rows.filter((row) => ["In Transit", "NDR / Undelivered", "RTO In Progress"].includes(row.statusGroup));
    const exception = rows.filter((row) => row.statusGroup !== "Delivered" && row.statusGroup !== "Cancelled" && ((row.age || 0) > 4 || row.attempts > 1 || ["Lost / Damaged", "NDR / Undelivered"].includes(row.statusGroup)));
    const withSla = delivered.filter((row) => row.onTime !== null);
    const tatus = delivered.map((row) => row.tat).filter(Number.isFinite);
    return {
      total: rows.length, delivered: delivered.length, deliveryRate: delivered.length / (rows.length || 1),
      rto: rto.length, rtoRate: rto.length / (rows.length || 1), open: open.length, exceptions: exception.length,
      onTimeRate: withSla.filter((row) => row.onTime).length / (withSla.length || 1),
      slaCoverage: withSla.length / (delivered.length || 1), avgTat: tatus.length ? tatus.reduce((a, b) => a + b, 0) / tatus.length : null,
      p90Tat: percentile(tatus, .9), freight: rows.reduce((sum, row) => sum + (Number(row.freight) || 0), 0)
    };
  }

  function destroyCharts() {
    state.charts.forEach((chart) => chart?.destroy?.());
    state.charts.clear();
  }

  function chartOptions({ percent = false, stacked = false, legend = true } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      animation: { duration: 450 },
      plugins: {
        legend: { display: legend, position: "top", align: "start", labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, color: "#667085", font: { size: 11, family: "Inter, sans-serif" }, padding: 14 } },
        tooltip: { padding: 10, backgroundColor: "#121c2f", titleFont: { size: 12 }, bodyFont: { size: 11 }, cornerRadius: 7, callbacks: percent ? { label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%` } : {} }
      },
      scales: {
        x: { stacked, grid: { display: false }, border: { display: false }, ticks: { color: "#667085", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { stacked, beginAtZero: true, suggestedMax: percent ? 100 : undefined, max: percent ? 100 : undefined, grid: { color: "#edf0f3" }, border: { display: false }, ticks: { color: "#667085", font: { size: 10 }, callback: percent ? (value) => `${value}%` : undefined } }
      }
    };
  }

  function createChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === "undefined") return;
    const chart = new Chart(canvas, config);
    state.charts.set(id, chart);
  }

  function metricCard(label, value, delta, tone = "blue", foot = "vs previous period") {
    const colors = { blue: "var(--blue)", teal: "var(--teal)", amber: "var(--amber)", red: "var(--red)" };
    return `<article class="metric-card" style="--metric-accent:${colors[tone]}">
      <div class="metric-head"><span class="metric-label">${escapeHtml(label)}</span><span class="metric-info" title="Based on the current dashboard scope">ⓘ</span></div>
      <strong class="metric-value">${escapeHtml(value)}</strong>
      <div class="metric-foot"><span class="delta ${delta.startsWith("+") ? "up" : delta.startsWith("−") ? "down" : "warn"}">${escapeHtml(delta)}</span><span>${escapeHtml(foot)}</span></div>
    </article>`;
  }

  function kebabButton(label, exportKey) {
    return `<button class="kebab" type="button" aria-label="${escapeHtml(label)} options" data-menu="${escapeHtml(exportKey)}" aria-haspopup="menu">${icon("more")}</button>`;
  }

  function insightRow(type, title, copy, route) {
    const map = {
      risk: ["alert", "var(--red)", "var(--red-soft)"],
      opportunity: ["trend", "var(--teal)", "var(--teal-soft)"],
      watch: ["clock", "var(--amber)", "var(--amber-soft)"]
    };
    const [iconName, color, background] = map[type] || map.watch;
    return `<li class="insight-item"><span class="insight-icon" style="--insight-color:${color};--insight-bg:${background}">${icon(iconName)}</span><div><b>${escapeHtml(title)}</b><p>${escapeHtml(copy)}</p>${route ? `<button class="text-button" type="button" data-route="${route}">Investigate →</button>` : ""}</div></li>`;
  }

  function statusClass(group) {
    if (group === "Delivered") return "good";
    if (["Lost / Damaged", "RTO In Progress"].includes(group)) return "bad";
    if (["NDR / Undelivered", "In Transit"].includes(group)) return "warn";
    return "neutral";
  }

  function renderOverview() {
    const rows = state.filtered;
    const kpi = metrics(rows);
    if (!rows.length) return renderNoData();
    const courierGroups = [...groupRows(rows, "courier")].map(([name, items]) => ({ name, rows: items, ...metrics(items) })).sort((a, b) => b.total - a.total);
    const statusGroups = [...groupRows(rows, "statusGroup")].map(([name, items]) => ({ name, value: items.length })).sort((a, b) => b.value - a.value);
    const riskyStates = [...groupRows(rows, "state")].map(([name, items]) => ({ name, ...metrics(items) })).filter((row) => row.total >= 12).sort((a, b) => a.onTimeRate - b.onTimeRate);
    const oldest = rows.filter((row) => row.age).sort((a, b) => b.age - a.age).slice(0, 6);
    const best = [...courierGroups].filter((row) => row.total >= 20).sort((a, b) => b.onTimeRate - a.onTimeRate)[0];
    const worstState = riskyStates[0];
    const multiAttempt = rows.filter((row) => row.statusGroup === "Delivered" && row.attempts > 1).length;
    const productMovement = new Map();
    rows.forEach((row) => (row.productItems || []).forEach((line) => {
      const key = line.productName || line.sku || "Unspecified product";
      const product = productMovement.get(key) || { Product: key, SKU: line.sku || "—", Units: 0, Lines: 0 };
      product.Units += Number(line.quantity || 0); product.Lines++; productMovement.set(key, product);
    }));
    const topProducts = [...productMovement.values()].sort((a, b) => b.Units - a.Units).slice(0, 8);
    const topCities = aggregateDimension(rows, "city").slice(0, 10);

    $("#page").innerHTML = `
      <div class="page-intro"><div><p class="eyebrow">Today at a glance</p><h2>Network health, without the noise.</h2><p>See service performance, cost exposure, and the exceptions that need an owner under the current scope.</p></div><span class="update-stamp"><span class="live-dot"></span>Updated ${formatDate(state.dataUpdatedAt, { short: true })}</span></div>
      <section class="metric-grid" aria-label="Key logistics metrics">
        ${metricCard("Total shipments", formatNumber(kpi.total), "Unique shipments in scope", "blue")}
        ${metricCard("Delivery rate", formatPercent(kpi.deliveryRate), "Observed status mix", "teal")}
        ${metricCard("SLA compliance", formatPercent(kpi.onTimeRate), "Observed vs EDD", kpi.onTimeRate > .8 ? "teal" : "amber")}
        ${metricCard("RTO rate", formatPercent(kpi.rtoRate), "Observed status mix", kpi.rtoRate < .1 ? "teal" : "red")}
        ${metricCard("Open exceptions", formatNumber(kpi.exceptions), "Need operational attention", kpi.exceptions > 30 ? "red" : "amber")}
      </section>
      <section class="card-grid">
        <article class="card">
          <header class="card-head"><div><h3>Shipment flow</h3><p>Weekly volume with delivered and exception outcomes</p></div><div class="card-actions">${kebabButton("Shipment flow", "flow")}</div></header>
          <div class="card-body"><div class="legend-row"><span class="legend-key"><i class="legend-swatch" style="--legend-color:${PALETTE.blue}"></i>Delivered</span><span class="legend-key"><i class="legend-swatch" style="--legend-color:${PALETTE.amber}"></i>Open</span><span class="legend-key"><i class="legend-swatch" style="--legend-color:${PALETTE.red}"></i>RTO / exceptions</span></div><div class="chart-wrap"><canvas id="shipmentFlowChart" aria-label="Shipment flow chart" role="img"></canvas></div></div>
          <div class="pulse-row"><div class="pulse-cell"><span>Open shipments</span><b>${formatNumber(kpi.open)}</b></div><div class="pulse-cell"><span>Avg TAT</span><b>${formatNumber(kpi.avgTat, 1)} days</b></div><div class="pulse-cell"><span>P90 TAT</span><b>${formatNumber(kpi.p90Tat, 1)} days</b></div><div class="pulse-cell"><span>Freight exposure</span><b>${formatCurrency(kpi.freight)}</b></div></div>
        </article>
        <article class="card">
          <header class="card-head"><div><h3>SHARV insights</h3><p>Prioritized from the current data scope</p></div><span class="sharv-spark">${icon("spark")}</span></header>
          <div class="card-body"><ul class="insight-list">
            ${insightRow("opportunity", `${best?.name || "Top courier"} leads on SLA`, `${formatPercent(best?.onTimeRate)} on-time across ${formatNumber(best?.total)} shipments.`, "performance")}
            ${insightRow("risk", `${worstState?.name || "Regional"} performance needs review`, `On-time delivery is ${formatPercent(worstState?.onTimeRate)} with ${formatNumber(worstState?.exceptions)} flagged exceptions.`, "exceptions")}
            ${insightRow("watch", `${formatNumber(multiAttempt)} multi-attempt deliveries`, `${formatPercent(multiAttempt / (kpi.delivered || 1))} of delivered orders required more than one attempt.`, "exceptions")}
          </ul></div>
        </article>
      </section>
      <section class="card-grid equal">
        <article class="card">
          <header class="card-head"><div><h3>Courier SLA scorecard</h3><p>On-time delivery and RTO rate by courier</p></div>${kebabButton("Courier SLA scorecard", "courier")}</header>
          <div class="card-body"><div class="chart-wrap small"><canvas id="courierChart" aria-label="Courier SLA scorecard chart" role="img"></canvas></div></div>
        </article>
        <article class="card">
          <header class="card-head"><div><h3>Status mix</h3><p>Network distribution across shipment stages</p></div>${kebabButton("Status mix", "status")}</header>
          <div class="card-body"><div class="chart-wrap small"><canvas id="statusChart" aria-label="Shipment status mix chart" role="img"></canvas></div></div>
        </article>
      </section>
      <article class="card table-card">
        <header class="card-head"><div><h3>Priority exception queue</h3><p>Oldest unresolved shipments under the current filters</p></div><div class="card-actions"><button class="text-button" type="button" data-route="exceptions">View all</button>${kebabButton("Priority exception queue", "exceptions")}</div></header>
        <div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>AWB / order</th><th>Courier</th><th>Destination</th><th>Status</th><th class="right">Age</th><th class="right">Attempts</th><th>Customer</th></tr></thead><tbody>${oldest.map((row) => `<tr><td><span class="link-cell mono" data-shipment="${escapeHtml(row.id)}">${escapeHtml(row.awb)}</span><br><span class="subtle mono">${escapeHtml(row.orderId)}</span></td><td>${escapeHtml(row.courier)}</td><td>${escapeHtml(row.city)}, ${escapeHtml(row.state)}</td><td><span class="status ${statusClass(row.statusGroup)}">${escapeHtml(row.statusGroup)}</span></td><td class="right strong">${row.age}d</td><td class="right">${row.attempts}</td><td>${escapeHtml(row.customer)}</td></tr>`).join("")}</tbody></table></div></div>
        <footer class="table-footer"><span>Showing ${oldest.length} of ${kpi.exceptions} exceptions</span><button class="text-button" type="button" data-route="exceptions">Open action queue →</button></footer>
      </article>`;

    const weekly = buildWeeklySeries(rows, 10);
    createChart("shipmentFlowChart", {
      type: "bar",
      data: { labels: weekly.labels, datasets: [
        { label: "Delivered", data: weekly.delivered, backgroundColor: PALETTE.blue, borderRadius: 3, maxBarThickness: 22, stack: "flow" },
        { label: "Open", data: weekly.open, backgroundColor: PALETTE.amber, borderRadius: 3, maxBarThickness: 22, stack: "flow" },
        { label: "RTO / exceptions", data: weekly.exceptions, backgroundColor: PALETTE.red, borderRadius: 3, maxBarThickness: 22, stack: "flow" }
      ] },
      options: chartOptions({ stacked: true, legend: false })
    });
    createChart("courierChart", {
      type: "bar",
      data: { labels: courierGroups.map((item) => item.name), datasets: [
        { label: "On-time %", data: courierGroups.map((item) => item.onTimeRate * 100), backgroundColor: PALETTE.teal, borderRadius: 4, maxBarThickness: 19 },
        { label: "RTO %", data: courierGroups.map((item) => item.rtoRate * 100), backgroundColor: PALETTE.red, borderRadius: 4, maxBarThickness: 19 }
      ] }, options: chartOptions({ percent: true, legend: true })
    });
    createChart("statusChart", {
      type: "doughnut",
      data: { labels: statusGroups.map((item) => item.name), datasets: [{ data: statusGroups.map((item) => item.value), backgroundColor: [PALETTE.teal, PALETTE.blue, PALETTE.amber, PALETTE.red, PALETTE.slate, PALETTE.lightBlue], borderWidth: 0, hoverOffset: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "66%", plugins: { legend: { display: true, position: "right", labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, color: "#667085", font: { size: 10 }, padding: 11 } }, tooltip: { backgroundColor: "#121c2f", padding: 10, cornerRadius: 7 } } }
    });
    state.currentTable = { name: "priority-exception-queue", rows: oldest };
    state.exports.clear();
    registerExport("flow", { title: "Shipment flow", type: "chart", chartId: "shipmentFlowChart", rows: weekly.labels.map((week, index) => ({ Week: week, Delivered: weekly.delivered[index], Open: weekly.open[index], "RTO / exceptions": weekly.exceptions[index] })), raw: rows });
    registerExport("courier", { title: "Courier SLA scorecard", type: "chart", chartId: "courierChart", rows: courierGroups.map((item) => ({ Courier: item.name, Shipments: item.total, "On-time %": item.onTimeRate * 100, "RTO %": item.rtoRate * 100, "Avg TAT": item.avgTat })), raw: rows });
    registerExport("status", { title: "Status mix", type: "chart", chartId: "statusChart", rows: statusGroups.map((item) => ({ Status: item.name, Shipments: item.value })), raw: rows });
    registerExport("exceptions", { title: "Priority exception queue", type: "table", rows: oldest, raw: oldest });
    $("#page").insertAdjacentHTML("beforeend", '<section class="card-grid equal"><article class="card"><header class="card-head"><div><h3>Product movement · units</h3><p>Ranked by item quantity; source line detail retained</p></div>' + kebabButton("Product movement by units", "overview-products") + '</header><div class="card-body">' + (topProducts.length ? '<div class="legend-row"><span class="legend-key"><i class="legend-swatch" style="--legend-color:' + PALETTE.blue + '"></i>Units</span></div><div class="chart-wrap small"><canvas id="overviewProductChart" role="img" aria-label="Product quantities by product"></canvas></div>' : '<p class="subtle">Product/SKU and quantity columns were not found in this source.</p>') + '</div></article><article class="card table-card"><header class="card-head"><div><h3>City service performance</h3><p>Order volume, delivery, and SLA by top destinations</p></div>' + kebabButton("City service performance", "overview-cities") + '</header><div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>City</th><th class="right">Orders</th><th class="right">Delivered</th><th class="right">Delivery %</th><th class="right">SLA %</th></tr></thead><tbody>' + topCities.map((item) => '<tr><td>' + escapeHtml(item.name) + '</td><td class="right">' + formatNumber(item.total) + '</td><td class="right">' + formatNumber(item.delivered) + '</td><td class="right">' + formatPercent(item.deliveryRate) + '</td><td class="right">' + formatPercent(item.onTimeRate) + '</td></tr>').join('') + '</tbody></table></div></div></article></section>');
    if (topProducts.length) createChart("overviewProductChart", { type: "bar", data: { labels: topProducts.map((item) => item.Product), datasets: [{ label: "Units", data: topProducts.map((item) => item.Units), backgroundColor: PALETTE.blue, borderRadius: 4 }] }, options: { ...chartOptions({ legend: true }), indexAxis: "y" } });
    registerExport("overview-products", { title: "Product movement by units", type: topProducts.length ? "chart" : "table", chartId: "overviewProductChart", rows: topProducts, raw: rows });
    registerExport("overview-cities", { title: "City service performance", type: "table", rows: topCities.map(exportAggregateRow), raw: rows });
  }

  function buildWeeklySeries(rows, weeks = 10) {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const buckets = Array.from({ length: weeks }, (_, reverseIndex) => {
      const index = weeks - 1 - reverseIndex;
      const start = new Date(end); start.setDate(end.getDate() - index * 7 - 6);
      const stop = new Date(start); stop.setDate(start.getDate() + 6); stop.setHours(23, 59, 59, 999);
      const scoped = rows.filter((row) => new Date(row.orderDate) >= start && new Date(row.orderDate) <= stop);
      return { label: start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), rows: scoped };
    });
    return {
      labels: buckets.map((item) => item.label),
      delivered: buckets.map((item) => item.rows.filter((row) => row.statusGroup === "Delivered").length),
      open: buckets.map((item) => item.rows.filter((row) => ["In Transit", "NDR / Undelivered"].includes(row.statusGroup)).length),
      exceptions: buckets.map((item) => item.rows.filter((row) => row.statusGroup.startsWith("RTO") || row.statusGroup === "Lost / Damaged").length)
    };
  }

  const DIMENSIONS = {
    courier: "Courier",
    state: "State",
    city: "City",
    pincode: "Pincode",
    customer: "Customer account",
    warehouse: "Pickup warehouse",
    payment: "Payment type",
    mode: "Transport mode",
    statusGroup: "Status",
    month: "Order month"
  };

  const MEASURES = {
    total: { label: "Shipments", format: (value) => formatNumber(value) },
    deliveryRate: { label: "Delivery rate", format: (value) => formatPercent(value) },
    onTimeRate: { label: "SLA compliance", format: (value) => formatPercent(value) },
    rtoRate: { label: "RTO rate", format: (value) => formatPercent(value) },
    avgTat: { label: "Average TAT", format: (value) => `${formatNumber(value, 1)} d` },
    p90Tat: { label: "P90 TAT", format: (value) => `${formatNumber(value, 1)} d` },
    exceptions: { label: "Exceptions", format: (value) => formatNumber(value) },
    freight: { label: "Freight exposure", format: (value) => formatCurrency(value) }
  };

  function dimensionValue(row, dimension) {
    if (dimension === "month") return row.orderDate ? row.orderDate.slice(0, 7) : "Unknown";
    return row[dimension] || "Unknown";
  }

  function aggregateDimension(rows, dimension) {
    return [...groupRows(rows, (row) => dimensionValue(row, dimension))].map(([name, items]) => ({ name, raw: items, ...metrics(items) }));
  }

  function metricDisplay(metric, value) {
    return (MEASURES[metric]?.format || formatNumber)(value);
  }

  function performanceTable(rows, dimension = "courier") {
    const data = aggregateDimension(rows, dimension).sort((a, b) => b.total - a.total);
    return { data, html: `<div class="table-scroll"><table class="data-table"><thead><tr><th>${escapeHtml(DIMENSIONS[dimension] || dimension)}</th><th class="right">Shipments</th><th class="right">Delivered</th><th class="right">Delivery %</th><th class="right">SLA %</th><th class="right">RTO %</th><th class="right">Avg TAT</th><th class="right">P90 TAT</th><th class="right">Exceptions</th></tr></thead><tbody>${data.map((item) => `<tr><td class="strong">${escapeHtml(item.name)}</td><td class="right">${formatNumber(item.total)}</td><td class="right">${formatNumber(item.delivered)}</td><td class="right">${formatPercent(item.deliveryRate)}</td><td class="right"><span class="status ${item.onTimeRate >= .84 ? "good" : item.onTimeRate >= .7 ? "warn" : "bad"}">${formatPercent(item.onTimeRate)}</span></td><td class="right">${formatPercent(item.rtoRate)}</td><td class="right">${formatNumber(item.avgTat, 1)}d</td><td class="right">${formatNumber(item.p90Tat, 1)}d</td><td class="right strong">${formatNumber(item.exceptions)}</td></tr>`).join("")}</tbody></table></div>` };
  }

  function renderPerformance() {
    const rows = state.filtered;
    if (!rows.length) return renderNoData();
    const courier = aggregateDimension(rows, "courier").sort((a, b) => b.total - a.total);
    const states = aggregateDimension(rows, "state").filter((item) => item.total >= 5).sort((a, b) => a.onTimeRate - b.onTimeRate);
    const cities = aggregateDimension(rows, "city").sort((a, b) => b.total - a.total);
    const months = aggregateDimension(rows, "month").filter((item) => item.name !== "Unknown").sort((a, b) => a.name.localeCompare(b.name));
    const scorecard = performanceTable(rows, "courier");
    const kpi = metrics(rows);
    const highestVolume = courier[0];
    const bestSla = [...courier].sort((a, b) => b.onTimeRate - a.onTimeRate)[0];
    const mostRisk = states[0];
    $("#page").innerHTML = `
      <div class="page-intro"><div><p class="eyebrow">Carrier and lane intelligence</p><h2>Measure service where it matters.</h2><p>Compare couriers, regions, and promise performance using the same scope applied across the dashboard.</p></div><div class="segmented" aria-label="Performance view"><button type="button" class="active">Couriers</button><button type="button" data-route="studio">Build another cut</button></div></div>
      <section class="metric-grid">
        ${metricCard("SLA compliance", formatPercent(kpi.onTimeRate), "Observed vs EDD", kpi.onTimeRate >= .8 ? "teal" : "amber")}
        ${metricCard("Average TAT", `${formatNumber(kpi.avgTat, 1)}d`, "Delivered shipments with TAT", "teal")}
        ${metricCard("P90 TAT", `${formatNumber(kpi.p90Tat, 1)}d`, "Delivered shipment percentile", "blue")}
        ${metricCard("Best SLA courier", bestSla?.name || "—", formatPercent(bestSla?.onTimeRate), "teal", "on-time delivery")}
        ${metricCard("At-risk region", mostRisk?.name || "—", formatPercent(mostRisk?.onTimeRate), "red", "on-time delivery")}
      </section>
      <section class="card-grid equal">
        <article class="card"><header class="card-head"><div><h3>SLA trend</h3><p>On-time performance and RTO rate by month</p></div>${kebabButton("SLA trend", "sla-trend")}</header><div class="card-body"><div class="chart-wrap"><canvas id="slaTrendChart" role="img" aria-label="Monthly SLA trend"></canvas></div></div></article>
        <article class="card"><header class="card-head"><div><h3>Courier performance</h3><p>Shipment scale, service, and return risk</p></div>${kebabButton("Courier performance", "courier-performance")}</header><div class="card-body"><div class="chart-wrap"><canvas id="courierPerformanceChart" role="img" aria-label="Courier performance"></canvas></div></div></article>
      </section>
      <section class="card-grid equal">
        <article class="card"><header class="card-head"><div><h3>Regional SLA risk</h3><p>Lowest on-time states with meaningful volume</p></div>${kebabButton("Regional SLA risk", "regional-risk")}</header><div class="card-body"><div class="chart-wrap small"><canvas id="regionalRiskChart" role="img" aria-label="Regional SLA risk"></canvas></div></div></article>
        <article class="card"><header class="card-head"><div><h3>Service signals</h3><p>What SHARV sees in this performance scope</p></div><span class="sharv-spark">${icon("spark")}</span></header><div class="card-body"><ul class="insight-list">
          ${insightRow("opportunity", `${bestSla?.name || "Leading courier"} sets the benchmark`, `${formatPercent(bestSla?.onTimeRate)} of eligible deliveries met promise.`, "sharv")}
          ${insightRow("watch", `${highestVolume?.name || "Top carrier"} handles the most volume`, `${formatNumber(highestVolume?.total)} shipments, ${formatPercent(highestVolume?.rtoRate)} RTO.`, "sharv")}
          ${insightRow("risk", `${mostRisk?.name || "A region"} is below network SLA`, `${formatPercent(mostRisk?.onTimeRate)} on-time across ${formatNumber(mostRisk?.total)} shipments.`, "exceptions")}
        </ul></div></article>
      </section>
      <article class="card table-card"><header class="card-head"><div><h3>Courier scorecard</h3><p>All service measures under the current filters</p></div>${kebabButton("Courier scorecard", "courier-scorecard")}</header><div class="card-body">${scorecard.html}</div><footer class="table-footer"><span>${courier.length} courier${courier.length === 1 ? "" : "s"} · ${formatNumber(rows.length)} shipments</span><button class="text-button" type="button" data-route="studio">Save as a custom view →</button></footer></article>`;

    createChart("slaTrendChart", { type: "line", data: { labels: months.map((item) => item.name), datasets: [
      { label: "SLA compliance", data: months.map((item) => item.onTimeRate * 100), borderColor: PALETTE.blue, backgroundColor: PALETTE.blue, pointRadius: 3, pointHoverRadius: 5, tension: .32 },
      { label: "RTO rate", data: months.map((item) => item.rtoRate * 100), borderColor: PALETTE.red, backgroundColor: PALETTE.red, pointRadius: 3, pointHoverRadius: 5, tension: .32 }
    ] }, options: chartOptions({ percent: true, legend: true }) });
    createChart("courierPerformanceChart", { type: "bar", data: { labels: courier.map((item) => item.name), datasets: [
      { label: "Delivery %", data: courier.map((item) => item.deliveryRate * 100), backgroundColor: PALETTE.blue, borderRadius: 4 },
      { label: "SLA %", data: courier.map((item) => item.onTimeRate * 100), backgroundColor: PALETTE.teal, borderRadius: 4 }
    ] }, options: chartOptions({ percent: true, legend: true }) });
    const bottomStates = states.slice(0, 8).reverse();
    createChart("regionalRiskChart", { type: "bar", data: { labels: bottomStates.map((item) => item.name), datasets: [{ label: "SLA compliance", data: bottomStates.map((item) => item.onTimeRate * 100), backgroundColor: bottomStates.map((item) => item.onTimeRate < .7 ? PALETTE.red : PALETTE.amber), borderRadius: 4 }] }, options: { ...chartOptions({ percent: true }), indexAxis: "y" } });
    state.exports.clear();
    registerExport("sla-trend", { title: "SLA trend", type: "chart", chartId: "slaTrendChart", rows: months.map((item) => ({ Month: item.name, Shipments: item.total, "SLA compliance %": item.onTimeRate * 100, "RTO %": item.rtoRate * 100 })), raw: rows });
    registerExport("courier-performance", { title: "Courier performance", type: "chart", chartId: "courierPerformanceChart", rows: courier.map(exportAggregateRow), raw: rows });
    registerExport("regional-risk", { title: "Regional SLA risk", type: "chart", chartId: "regionalRiskChart", rows: bottomStates.map(exportAggregateRow), raw: rows });
    registerExport("courier-scorecard", { title: "Courier scorecard", type: "table", rows: courier.map(exportAggregateRow), raw: rows });
    state.currentTable = { name: "courier-scorecard", rows: courier.map(exportAggregateRow) };
    const cityTable = performanceTable(rows, "city");
    const stateTable = performanceTable(rows, "state");
    const pincodeAggregates = aggregateDimension(rows, "pincode").filter((item) => item.name && item.name !== "Unknown" && item.total >= 3).sort((a, b) => a.onTimeRate - b.onTimeRate);
    const pincodeRows = pincodeAggregates.slice(0, 30).map(exportAggregateRow);
    const eligiblePincodes = new Set(pincodeAggregates.map((item) => item.name));
    const openRows = rows.filter((row) => ["In Transit", "NDR / Undelivered", "RTO In Progress"].includes(row.statusGroup)).sort((a, b) => (b.age || 0) - (a.age || 0)).slice(0, 100);
    const attemptNames = ["Delivered · ≤1 attempt", "Delivered · multiple attempts", "RTO · after attempt", "RTO · no attempt", "Open · attempted", "Open · no attempt"];
    const attemptRows = courier.map((item) => {
      const scoped = rows.filter((row) => normalizeText(row.courier) === normalizeText(item.name));
      return { Courier: item.name,
        [attemptNames[0]]: scoped.filter((row) => row.statusGroup === "Delivered" && row.attempts <= 1).length,
        [attemptNames[1]]: scoped.filter((row) => row.statusGroup === "Delivered" && row.attempts > 1).length,
        [attemptNames[2]]: scoped.filter((row) => row.statusGroup.startsWith("RTO") && row.attempts > 0).length,
        [attemptNames[3]]: scoped.filter((row) => row.statusGroup.startsWith("RTO") && row.attempts === 0).length,
        [attemptNames[4]]: scoped.filter((row) => ["In Transit", "NDR / Undelivered"].includes(row.statusGroup) && row.attempts > 0).length,
        [attemptNames[5]]: scoped.filter((row) => ["In Transit", "NDR / Undelivered"].includes(row.statusGroup) && row.attempts === 0).length };
    });
    const rtoRows = rows.filter((row) => row.statusGroup.startsWith("RTO"));
    const rawPreview = normalizedExportRows(rows).slice(0, 40);
    const rawColumns = rawPreview.length ? Object.keys(rawPreview[0]).slice(0, 9) : [];
    const rtoReasons = [...groupRows(rtoRows, (row) => row.remark || row.ndrStatus || "No carrier reason recorded")].map(([Reason, items]) => ({ Reason, Orders: items.length, "Freight exposure": items.reduce((sum, row) => sum + (Number(row.freight) || 0), 0), Courier: aggregateDimension(items, "courier").sort((a, b) => b.total - a.total)[0]?.name || "—" })).sort((a, b) => b.Orders - a.Orders).slice(0, 10);
    const monthRows = months.map((item) => ({ Month: item.name, Shipments: item.total, Delivered: item.delivered, "Delivery %": item.deliveryRate * 100, "SLA %": item.onTimeRate * 100, "RTO %": item.rtoRate * 100 }));
    const openHtml = openRows.slice(0, 25).map((row) => '<tr><td>' + escapeHtml(row.courier) + '</td><td class="mono">' + escapeHtml(row.awb) + '</td><td class="mono">' + escapeHtml(row.orderId) + '</td><td>' + escapeHtml(row.city) + ', ' + escapeHtml(row.state) + '</td><td>' + escapeHtml(row.statusGroup) + '</td><td class="right">' + formatNumber(row.attempts) + '</td><td class="right">' + formatNumber(row.age) + 'd</td><td>' + escapeHtml(row.remark || row.ndrStatus || '—') + '</td></tr>').join('');
    $("#page").insertAdjacentHTML("beforeend", '<section class="card-grid equal"><article class="card table-card"><header class="card-head"><div><h3>State performance</h3><p>Service and return measures by state (minimum five orders)</p></div>' + kebabButton("State performance", "state-performance") + '</header><div class="card-body">' + stateTable.html + '</div></article><article class="card table-card"><header class="card-head"><div><h3>City performance</h3><p>Service and return measures by destination city</p></div>' + kebabButton("City performance", "city-performance") + '</header><div class="card-body">' + cityTable.html + '</div></article></section><section class="card-grid equal"><article class="card table-card"><header class="card-head"><div><h3>Monthly trend detail</h3><p>Monthly count and delivery outcomes</p></div>' + kebabButton("Monthly trend detail", "month-detail") + '</header><div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Month</th><th class="right">Orders</th><th class="right">Delivered</th><th class="right">Delivery %</th><th class="right">SLA %</th><th class="right">RTO %</th></tr></thead><tbody>' + monthRows.map((item) => '<tr><td>' + escapeHtml(item.Month) + '</td><td class="right">' + formatNumber(item.Shipments) + '</td><td class="right">' + formatNumber(item.Delivered) + '</td><td class="right">' + formatNumber(item["Delivery %"], 1) + '%</td><td class="right">' + formatNumber(item["SLA %"], 1) + '%</td><td class="right">' + formatNumber(item["RTO %"], 1) + '%</td></tr>').join('') + '</tbody></table></div></div></article><article class="card table-card"><header class="card-head"><div><h3>Delivery attempts</h3><p>Outcome × courier attempt matrix</p></div>' + kebabButton("Delivery attempt matrix", "attempt-matrix") + '</header><div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Courier</th>' + attemptNames.map((name) => '<th class="right">' + escapeHtml(name) + '</th>').join('') + '</tr></thead><tbody>' + attemptRows.map((item) => '<tr><td>' + escapeHtml(item.Courier) + '</td>' + attemptNames.map((name) => '<td class="right">' + formatNumber(item[name]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div><p class="field-hint">Attempt groupings are inferred from status and attempt count supplied in the source.</p></div></article></section><section class="card-grid equal"><article class="card table-card"><header class="card-head"><div><h3>RTO analysis</h3><p>' + formatNumber(rtoRows.length) + ' return-to-origin orders in scope</p></div>' + kebabButton("RTO analysis", "rto-analysis") + '</header><div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Reason</th><th class="right">Orders</th><th class="right">Freight exposure</th><th>Leading courier</th></tr></thead><tbody>' + (rtoReasons.map((item) => '<tr><td>' + escapeHtml(item.Reason) + '</td><td class="right">' + formatNumber(item.Orders) + '</td><td class="right">' + formatCurrency(item["Freight exposure"]) + '</td><td>' + escapeHtml(item.Courier) + '</td></tr>').join('') || '<tr><td colspan="4">No RTO orders in this scope.</td></tr>') + '</tbody></table></div></div></article><article class="card table-card"><header class="card-head"><div><h3>Open shipment queue</h3><p>Oldest in-transit, NDR, and RTO-in-progress orders</p></div>' + kebabButton("Open shipment queue", "open-queue") + '</header><div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Courier</th><th>AWB</th><th>Order</th><th>Destination</th><th>Status</th><th class="right">Attempts</th><th class="right">Age</th><th>Carrier remark</th></tr></thead><tbody>' + (openHtml || '<tr><td colspan="8">No open shipments in this scope.</td></tr>') + '</tbody></table></div></div></article></section><article class="card table-card"><header class="card-head"><div><h3>Raw shipment data</h3><p>Source rows within scope, preview limited to 40; export menu downloads the complete scoped raw data</p></div>' + kebabButton("Raw shipment data", "performance-raw") + '</header><div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr>' + rawColumns.map((name) => '<th>' + escapeHtml(name) + '</th>').join('') + '</tr></thead><tbody>' + rawPreview.map((row) => '<tr>' + rawColumns.map((name) => '<td>' + escapeHtml(row[name] == null ? '' : String(row[name])) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div></article>');
    registerExport("state-performance", { title: "State performance", type: "table", rows: stateTable.data.map(exportAggregateRow), raw: rows });
    registerExport("city-performance", { title: "City performance", type: "table", rows: cityTable.data.map(exportAggregateRow), raw: rows });
    registerExport("month-detail", { title: "Monthly trend detail", type: "table", rows: monthRows, raw: rows });
    registerExport("attempt-matrix", { title: "Delivery attempt matrix", type: "table", rows: attemptRows, raw: rows });
    registerExport("rto-analysis", { title: "RTO analysis", type: "table", rows: rtoReasons, raw: rtoRows });
    registerExport("open-queue", { title: "Open shipment queue", type: "table", rows: openRows, raw: openRows });
    registerExport("performance-raw", { title: "Raw shipment data", type: "table", rows: rawPreview, raw: rows });
    $("#page").insertAdjacentHTML("beforeend", '<article class="card table-card"><header class="card-head"><div><h3>Pincode performance</h3><p>Lowest observed SLA first · only pins with at least three shipments</p></div>' + kebabButton("Pincode performance", "pincode-performance") + '</header><div class="card-body"><div class="table-scroll">' + performanceTable(rows.filter((row) => eligiblePincodes.has(row.pincode)), "pincode").html + '</div></div></article>');
    registerExport("pincode-performance", { title: "Pincode performance", type: "table", rows: pincodeRows, raw: rows });
  }

  function renderInsights() {
    const rows = state.filtered;
    if (!rows.length) return renderNoData();
    const grouped = new Map();
    rows.forEach((row) => {
      if (!row.customerKey || row.customerClass === "Unknown") return;
      const item = grouped.get(row.customerKey) || { Customer: row.recipientName, Address: row.customerAddress || "Not in source", rows: [] };
      item.rows.push(row); grouped.set(row.customerKey, item);
    });
    const customerRows = [...grouped.values()].map((item) => {
      const courier = aggregateDimension(item.rows, "courier").sort((a, b) => b.total - a.total)[0];
      return { Customer: item.Customer, Address: item.Address, Orders: item.rows.length, Classification: item.rows.length > 1 ? "Repeat Customer" : "New Customer", Quantity: item.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0), "On-time %": metrics(item.rows).onTimeRate * 100, Courier: courier?.name || "—", sourceRows: item.rows };
    }).sort((a, b) => b.Orders - a.Orders);
    const products = new Map();
    rows.forEach((row) => (row.productItems || []).forEach((line) => {
      const name = line.productName || line.sku || "Unspecified product";
      const item = products.get(name) || { Product: name, SKU: line.sku || "—", Quantity: 0, Lines: 0 };
      item.Quantity += Number(line.quantity || 0); item.Lines++; products.set(name, item);
    }));
    const productRows = [...products.values()].sort((a, b) => b.Quantity - a.Quantity);
    const customerExport = customerRows.map(({ sourceRows, ...item }) => item);
    const customerHtml = customerRows.slice(0, 100).map((row) => '<tr><td>' + escapeHtml(row.Customer) + '</td><td>' + escapeHtml(row.Address) + '</td><td class="right">' + formatNumber(row.Orders) + '</td><td>' + escapeHtml(row.Classification) + '</td><td class="right">' + formatNumber(row.Quantity) + '</td><td class="right">' + formatNumber(row["On-time %"], 1) + '%</td><td>' + escapeHtml(row.Courier) + '</td></tr>').join("");
    const productHtml = productRows.slice(0, 12).map((row) => '<tr><td>' + escapeHtml(row.Product) + '</td><td>' + escapeHtml(row.SKU) + '</td><td class="right strong">' + formatNumber(row.Quantity) + '</td><td class="right">' + formatNumber(row.Lines) + '</td></tr>').join("");
    const risks = aggregateDimension(rows, "courier").filter((item) => item.total >= 5 && item.onTimeRate < .85).sort((a, b) => a.onTimeRate - b.onTimeRate);
    const findings = risks.length ? risks.slice(0, 3).map((item) => item.name + ': ' + formatPercent(item.onTimeRate) + ' observed on-time across ' + item.total + ' shipments; request a lane-level corrective-action plan.').join(' ') : 'No courier is below the 85% review threshold among couriers with at least five shipments in this scope.';
    $("#page").innerHTML = '<div class="page-intro"><div><p class="eyebrow">Active-data findings</p><h2>Insights &amp; suggestions</h2><p>Calculated from the active shipment scope. Missing fields and small samples are called out rather than guessed.</p></div></div>' +
      '<section class="metric-grid">' + metricCard("Unique customers", formatNumber(customerRows.length), "Name + address", "blue") + metricCard("Repeat customers", formatNumber(customerRows.filter((row) => row.Classification === "Repeat Customer").length), "2+ consolidated orders", "teal") + metricCard("New customers", formatNumber(customerRows.filter((row) => row.Classification === "New Customer").length), "1 observed order", "blue") + metricCard("Product units", formatNumber(rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)), formatNumber(productRows.length) + " product groups", "amber") + metricCard("Courier reviews", formatNumber(risks.length), "SLA <85% · n≥5", risks.length ? "red" : "teal") + '</section>' +
      '<section class="card-grid equal"><article class="card"><header class="card-head"><div><h3>Recommended action</h3><p>Evidence-led courier review</p></div></header><div class="card-body"><p>' + escapeHtml(findings) + '</p></div></article><article class="card"><header class="card-head"><div><h3>Product movement</h3><p>Ranked by units, not shipment count</p></div>' + kebabButton("Product movement", "insight-products") + '</header><div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Product</th><th>SKU</th><th class="right">Units</th><th class="right">Lines</th></tr></thead><tbody>' + (productHtml || '<tr><td colspan="4">No product line detail in this dataset.</td></tr>') + '</tbody></table></div></div></article></section>' +
      '<article class="card table-card"><header class="card-head"><div><h3>Customer analytics</h3><p>Classification after order consolidation using normalized customer name + address</p></div>' + kebabButton("Customer analytics", "customer-analytics") + '</header><div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Customer</th><th>Address</th><th class="right">Orders</th><th>Classification</th><th class="right">Units</th><th class="right">On-time</th><th>Courier</th></tr></thead><tbody>' + (customerHtml || '<tr><td colspan="7">Customer name/address was not available in the source.</td></tr>') + '</tbody></table></div></div><footer class="table-footer"><span>' + formatNumber(customerRows.length) + ' customer identities · showing up to 100</span><span>Computed and raw line-level exports are available</span></footer></article>';
    state.exports.clear();
    registerExport("customer-analytics", { title: "Customer analytics", type: "table", rows: customerExport, raw: customerRows.flatMap((row) => row.sourceRows) });
    registerExport("insight-products", { title: "Product movement", type: "table", rows: productRows, raw: rows });
    state.currentTable = { name: "customer-analytics", rows: customerExport };
  }

  function exportAggregateRow(item) {
    return { Group: item.name, Shipments: item.total, Delivered: item.delivered, "Delivery %": item.deliveryRate * 100, "SLA %": item.onTimeRate * 100, "RTO %": item.rtoRate * 100, "Average TAT": item.avgTat, "P90 TAT": item.p90Tat, Exceptions: item.exceptions, "Freight exposure": item.freight };
  }

  function exceptionRows(rows = state.filtered) {
    return rows.filter((row) => row.statusGroup !== "Delivered" && row.statusGroup !== "Cancelled" && ((row.age || 0) > 4 || row.attempts > 1 || ["Lost / Damaged", "NDR / Undelivered", "RTO In Progress"].includes(row.statusGroup)));
  }

  function priorityFor(row) {
    if ((row.age || 0) > 7 || row.statusGroup === "Lost / Damaged") return "High";
    if ((row.age || 0) > 4 || row.attempts > 1) return "Medium";
    return "Normal";
  }

  function recommendedExceptionAction(row) {
    if (row.statusGroup === "Lost / Damaged") return "Escalate carrier claim; request scan trail and proof of condition";
    if (row.statusGroup === "NDR / Undelivered") return "Validate address/customer availability; book next attempt";
    if (row.statusGroup.startsWith("RTO")) return "Confirm return reason and reconcile inventory/refund";
    if ((row.age || 0) > 7) return "Escalate aged shipment with courier control tower";
    if (row.attempts > 1) return "Review failed-attempt notes; arrange customer-confirmed reattempt";
    return "Track next scan and contact courier if no movement";
  }

  function renderExceptions() {
    const rows = exceptionRows();
    const query = state.tableQuery.trim().toLowerCase();
    const visible = (query ? rows.filter((row) => [row.awb, row.orderId, row.customer, row.recipientName, row.courier, row.city, row.state, row.statusGroup, row.remark, row.ndrStatus].some((value) => String(value || "").toLowerCase().includes(query))) : rows).sort((a, b) => (b.age || 0) - (a.age || 0));
    const high = rows.filter((row) => priorityFor(row) === "High");
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const breach = rows.filter((row) => row.edd && new Date(row.edd) < today && row.statusGroup !== "Delivered");
    const reattempt = rows.filter((row) => row.attempts > 1);
    const rto = rows.filter((row) => row.statusGroup.startsWith("RTO"));
    const reasons = [...groupRows(rows.filter((row) => row.remark || row.ndrStatus), (row) => row.remark || row.ndrStatus || "No reason")].map(([name, items]) => ({ name, value: items.length })).sort((a, b) => b.value - a.value).slice(0, 7);
    const courierActions = aggregateDimension(rows, "courier").map((item) => {
      const primaryReason = [...groupRows(item.raw.filter((row) => row.remark || row.ndrStatus), (row) => row.remark || row.ndrStatus)].map(([name, items]) => ({ name, count: items.length })).sort((a, b) => b.count - a.count)[0];
      const sample = item.raw.sort((a, b) => (b.age || 0) - (a.age || 0))[0];
      return { Courier: item.name, Exceptions: item.total, High: item.raw.filter((row) => priorityFor(row) === "High").length, "Most common recorded signal": primaryReason?.name || "No reason supplied", "Recommended action": sample ? recommendedExceptionAction(sample) : "Review carrier lane" };
    }).sort((a, b) => b.Exceptions - a.Exceptions);
    const ageingLabels = ["0–2d", "3–4d", "5–7d", "8–14d", "15d+"];
    const ageing = [
      rows.filter((row) => (row.age || 0) <= 2).length,
      rows.filter((row) => row.age >= 3 && row.age <= 4).length,
      rows.filter((row) => row.age >= 5 && row.age <= 7).length,
      rows.filter((row) => row.age >= 8 && row.age <= 14).length,
      rows.filter((row) => row.age >= 15).length
    ];
    $("#page").innerHTML = `
      <div class="page-intro"><div><p class="eyebrow">Prioritized action queue</p><h2>Resolve the exceptions that move the number.</h2><p>Sorted by ageing, failed attempts, and terminal risk. Open any shipment for full context.</p></div><button class="button secondary" type="button" data-route="sharv">${icon("spark")} Ask SHARV about this queue</button></div>
      ${high.length ? `<div class="risk-banner">${icon("alert")}<div><b>${formatNumber(high.length)} high-priority shipments need an owner</b><span>${formatNumber(breach.length)} are past EDD; the oldest open item is ${formatNumber(Math.max(...rows.map((row) => row.age || 0)))} days.</span></div><button class="text-button" type="button" data-focus-table>Review queue →</button></div>` : ""}
      <section class="metric-grid">
        ${metricCard("Open exceptions", formatNumber(rows.length), "In current scope", rows.length > 30 ? "red" : "amber")}
        ${metricCard("High priority", formatNumber(high.length), `${formatPercent(high.length / (rows.length || 1))}`, "red", "of exception queue")}
        ${metricCard("Past EDD", formatNumber(breach.length), "Open shipments", "amber")}
        ${metricCard("Multiple attempts", formatNumber(reattempt.length), "Need intervention", "amber")}
        ${metricCard("RTO in progress", formatNumber(rto.length), formatPercent(rto.length / (state.filtered.length || 1)), "red", "of scoped shipments")}
      </section>
      <section class="card-grid equal">
        <article class="card"><header class="card-head"><div><h3>Exception ageing</h3><p>Unresolved shipments by days since pickup</p></div>${kebabButton("Exception ageing", "exception-ageing")}</header><div class="card-body"><div class="chart-wrap small"><canvas id="exceptionAgeingChart" role="img" aria-label="Exception ageing"></canvas></div></div></article>
        <article class="card"><header class="card-head"><div><h3>Top failure signals</h3><p>NDR and return reasons recorded by carriers</p></div>${kebabButton("Top failure signals", "failure-signals")}</header><div class="card-body"><div class="chart-wrap small"><canvas id="failureSignalsChart" role="img" aria-label="Top failure signals"></canvas></div></div></article>
      </section>
      <article class="card table-card" id="exceptionTable"><header class="card-head"><div><h3>Exception worklist</h3><p>Click an AWB to inspect all available shipment context</p></div>${kebabButton("Exception worklist", "exception-worklist")}</header>
        <div class="table-tools"><label class="table-search">${icon("search")}<input id="exceptionSearch" type="search" value="${escapeHtml(state.tableQuery)}" placeholder="Search AWB, order, customer, city…" aria-label="Search exception worklist"></label><div class="table-meta">${formatNumber(visible.length)} matching · ${formatNumber(rows.length)} total exceptions</div></div>
        <div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Priority / AWB</th><th>Order</th><th>Courier</th><th>Customer</th><th>Destination</th><th>Status</th><th class="right">Age</th><th class="right">Attempts</th><th>EDD</th><th>Reason</th><th>Recommended next action</th></tr></thead><tbody>${visible.slice(0, 120).map((row) => `<tr><td><span class="priority ${priorityFor(row).toLowerCase()}">${priorityFor(row)}</span><br><button class="text-button mono" type="button" data-shipment="${escapeHtml(row.id)}">${escapeHtml(row.awb)}</button></td><td class="mono">${escapeHtml(row.orderId)}</td><td>${escapeHtml(row.courier)}</td><td>${escapeHtml(row.customer)}</td><td>${escapeHtml(row.city)}, ${escapeHtml(row.state)} · ${escapeHtml(row.pincode || "pin unavailable")}</td><td><span class="status ${statusClass(row.statusGroup)}">${escapeHtml(row.statusGroup)}</span></td><td class="right strong">${formatNumber(row.age)}d</td><td class="right">${formatNumber(row.attempts)}</td><td>${formatDate(row.edd, { short: true })}</td><td title="${escapeHtml(row.remark || row.ndrStatus || "No carrier reason")}">${escapeHtml((row.remark || row.ndrStatus || "—").slice(0, 38))}</td><td>${escapeHtml(recommendedExceptionAction(row))}</td></tr>`).join("") || `<tr><td colspan="11">No exceptions match this search.</td></tr>`}</tbody></table></div></div>
        <footer class="table-footer"><span>Showing up to 120 rows · exports include all ${formatNumber(visible.length)} matching rows</span><button class="text-button" type="button" data-route="shipments">Open shipment ledger →</button></footer></article>`;

    $("#page").insertAdjacentHTML("beforeend", '<article class="card table-card"><header class="card-head"><div><h3>Courier action plan</h3><p>Exception volume, severity, recorded signal, and next step for each courier</p></div>' + kebabButton("Courier action plan", "courier-action-plan") + '</header><div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Courier</th><th class="right">Exceptions</th><th class="right">High</th><th>Most common signal</th><th>Recommended action</th></tr></thead><tbody>' + courierActions.map((item) => '<tr><td class="strong">' + escapeHtml(item.Courier) + '</td><td class="right">' + formatNumber(item.Exceptions) + '</td><td class="right">' + formatNumber(item.High) + '</td><td>' + escapeHtml(item["Most common recorded signal"]) + '</td><td>' + escapeHtml(item["Recommended action"]) + '</td></tr>').join('') + '</tbody></table></div></div></article>');
    createChart("exceptionAgeingChart", { type: "bar", data: { labels: ageingLabels, datasets: [{ label: "Exceptions", data: ageing, backgroundColor: ageingLabels.map((_, index) => index < 2 ? PALETTE.amber : PALETTE.red), borderRadius: 4, maxBarThickness: 34 }] }, options: chartOptions() });
    createChart("failureSignalsChart", { type: "bar", data: { labels: reasons.map((item) => item.name), datasets: [{ label: "Shipments", data: reasons.map((item) => item.value), backgroundColor: PALETTE.red, borderRadius: 4, maxBarThickness: 20 }] }, options: { ...chartOptions(), indexAxis: "y" } });
    state.exports.clear();
    registerExport("exception-ageing", { title: "Exception ageing", type: "chart", chartId: "exceptionAgeingChart", rows: ageingLabels.map((label, index) => ({ "Age bucket": label, Exceptions: ageing[index] })), raw: rows });
    registerExport("failure-signals", { title: "Top failure signals", type: "chart", chartId: "failureSignalsChart", rows: reasons.map((item) => ({ Reason: item.name, Shipments: item.value })), raw: rows });
    registerExport("courier-action-plan", { title: "Courier action plan", type: "table", rows: courierActions, raw: rows });
    registerExport("exception-worklist", { title: "Exception worklist", type: "table", rows: visible, raw: visible });
    state.currentTable = { name: "exception-worklist", rows: visible };
    $("#exceptionSearch")?.addEventListener("input", debounce((event) => { state.tableQuery = event.target.value; renderExceptions(); }, 220));
  }

  function renderShipments() {
    const query = state.tableQuery.trim().toLowerCase();
    const rows = query ? state.filtered.filter((row) => [row.awb, row.orderId, row.customer, row.recipientName, row.courier, row.city, row.state, row.statusGroup, row.pincode].some((value) => String(value || "").toLowerCase().includes(query))) : state.filtered;
    const pageSize = 25;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.tablePage = Math.min(state.tablePage, pages);
    const pageRows = rows.slice((state.tablePage - 1) * pageSize, state.tablePage * pageSize);
    const pageButtons = Array.from({ length: Math.min(5, pages) }, (_, index) => index + Math.max(1, Math.min(state.tablePage - 2, pages - 4))).filter((value) => value <= pages);
    $("#page").innerHTML = `
      <div class="page-intro"><div><p class="eyebrow">Authorized shipment ledger</p><h2>Every shipment, one searchable record.</h2><p>Search by AWB, order ID, customer, recipient, courier, city, or status. Downloads always respect the current scope.</p></div>${state.role === "upload_admin" ? `<button class="button primary" type="button" data-open-upload>${icon("package")} Upload shipment data</button>` : ""}</div>
      <article class="card table-card"><header class="card-head"><div><h3>Shipment data</h3><p>${formatNumber(rows.length)} records match the current scope and search</p></div>${kebabButton("Shipment data", "shipment-ledger")}</header>
        <div class="table-tools"><label class="table-search">${icon("search")}<input id="shipmentSearch" type="search" value="${escapeHtml(state.tableQuery)}" placeholder="Search shipment records…" aria-label="Search shipments"></label><button class="button secondary compact" type="button" id="columnInfo">12 visible columns</button><div class="table-meta">Page ${state.tablePage} of ${pages}</div></div>
        <div class="card-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>AWB / order</th><th>Customer</th><th>Recipient</th><th>Courier</th><th>Destination</th><th>Payment</th><th>Status</th><th>Order date</th><th>EDD</th><th class="right">TAT</th><th class="right">Attempts</th><th class="right">Freight</th></tr></thead><tbody>${pageRows.map((row) => `<tr><td><button class="text-button mono" type="button" data-shipment="${escapeHtml(row.id)}">${escapeHtml(row.awb)}</button><br><span class="subtle mono">${escapeHtml(row.orderId)}</span></td><td>${escapeHtml(row.customer)}</td><td>${escapeHtml(row.recipientName)}</td><td>${escapeHtml(row.courier)}</td><td>${escapeHtml(row.city)}, ${escapeHtml(row.state)}</td><td>${escapeHtml(row.payment)}</td><td><span class="status ${statusClass(row.statusGroup)}">${escapeHtml(row.statusGroup)}</span></td><td>${formatDate(row.orderDate, { short: true })}</td><td>${formatDate(row.edd, { short: true })}</td><td class="right">${row.tat == null ? "—" : `${formatNumber(row.tat, 1)}d`}</td><td class="right">${formatNumber(row.attempts)}</td><td class="right">${row.freight == null ? "—" : formatCurrency(row.freight)}</td></tr>`).join("") || `<tr><td colspan="12">No shipments match this search.</td></tr>`}</tbody></table></div></div>
        <footer class="table-footer"><span>Rows ${(state.tablePage - 1) * pageSize + (pageRows.length ? 1 : 0)}–${Math.min(state.tablePage * pageSize, rows.length)} of ${formatNumber(rows.length)}</span><div class="pagination"><button type="button" data-page="${Math.max(1, state.tablePage - 1)}" aria-label="Previous page">‹</button>${pageButtons.map((page) => `<button type="button" class="${page === state.tablePage ? "active" : ""}" data-page="${page}">${page}</button>`).join("")}<button type="button" data-page="${Math.min(pages, state.tablePage + 1)}" aria-label="Next page">›</button></div></footer>
      </article>`;
    state.exports.clear();
    registerExport("shipment-ledger", { title: "Shipment ledger", type: "table", rows, raw: rows });
    state.currentTable = { name: "shipment-ledger", rows };
    $("#shipmentSearch")?.addEventListener("input", debounce((event) => { state.tableQuery = event.target.value; state.tablePage = 1; renderShipments(); }, 220));
    $$('[data-page]').forEach((button) => button.addEventListener("click", () => { state.tablePage = Number(button.dataset.page); renderShipments(); }));
  }

  function openShipmentDetail(id) {
    const row = state.shipments.find((item) => item.id === id);
    if (!row) return;
    openModal(`
      <header class="modal-head"><div><p class="eyebrow">Shipment detail</p><h2 id="modalTitle" class="mono">${escapeHtml(row.awb)}</h2><p>${escapeHtml(row.orderId)} · ${escapeHtml(row.source)}</p></div><button class="icon-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button></header>
      <div class="modal-body"><div class="answer-summary"><span class="chip ${row.statusGroup === "Delivered" ? "status-good" : row.statusGroup.startsWith("RTO") ? "status-bad" : "status-warn"}">${escapeHtml(row.statusGroup)}</span><span class="chip neutral">${escapeHtml(row.courier)}</span><span class="chip neutral">${escapeHtml(row.payment)}</span></div>
        <div class="builder-grid">
          ${detailField("Customer account", row.customer)}${detailField("Recipient", row.recipientName)}${detailField("Destination", `${row.city}, ${row.state} ${row.pincode || ""}`)}${detailField("Pickup warehouse", row.warehouse)}
          ${detailField("Ordered", formatDate(row.orderDate))}${detailField("Picked up", formatDate(row.pickupDate))}${detailField("Promised / EDD", formatDate(row.edd))}${detailField("Delivered", formatDate(row.deliveredDate))}
          ${detailField("Transit time", row.tat == null ? "In progress" : `${formatNumber(row.tat, 1)} days`)}${detailField("Configured SLA", `${formatNumber(row.serviceTarget, 1)} days`)}${detailField("Attempts", formatNumber(row.attempts))}${detailField("Freight", row.freight == null ? "Not present in source" : formatCurrency(row.freight))}
        </div>
        ${(row.ndrStatus || row.remark) ? `<div class="risk-banner" style="margin:14px 0 0">${icon("alert")}<div><b>${escapeHtml(row.ndrStatus || "Carrier remark")}</b><span>${escapeHtml(row.remark || "No additional carrier remark.")}</span></div></div>` : ""}
      </div><footer class="modal-actions"><button class="button secondary" type="button" data-close-modal>Close</button><button class="button primary" type="button" data-ask-shipment="${escapeHtml(row.awb)}">Ask SHARV about this</button></footer>`);
  }

  function detailField(label, value) {
    return `<div class="result-field" style="padding:10px 0"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  }

  function ensureDemoViews() {
    if (!state.demo || state.savedViews.length) return;
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem("sharv-demo-views") || "[]"); } catch (_) { stored = []; }
    state.savedViews = stored.length ? stored : [
      { id: "demo-view-1", name: "Courier SLA scorecard", updatedAt: "2026-09-28T09:30:00+05:30", definition: { version: 1, viewType: "table", rowDimension: "courier", columnDimension: "none", metric: "onTimeRate", sort: "desc", limit: 10, useGlobalFilters: true } },
      { id: "demo-view-2", name: "State × status pivot", updatedAt: "2026-09-27T16:10:00+05:30", definition: { version: 1, viewType: "pivot", rowDimension: "state", columnDimension: "statusGroup", metric: "total", sort: "desc", limit: 10, useGlobalFilters: true } }
    ];
  }

  function customViewRows(definition) {
    const rows = definition.useGlobalFilters ? state.filtered : state.shipments;
    const aggregated = aggregateDimension(rows, definition.rowDimension);
    const metric = definition.metric;
    const direction = definition.sort === "asc" ? 1 : -1;
    aggregated.sort((a, b) => direction * ((a[metric] ?? -Infinity) - (b[metric] ?? -Infinity)));
    const limited = Number(definition.limit) > 0 ? aggregated.slice(0, Number(definition.limit)) : aggregated;
    if (definition.viewType !== "pivot" || definition.columnDimension === "none") {
      return {
        rows,
        columns: [DIMENSIONS[definition.rowDimension], MEASURES[metric]?.label || metric],
        computed: limited.map((item) => ({ [DIMENSIONS[definition.rowDimension] || definition.rowDimension]: item.name, [MEASURES[metric]?.label || metric]: item[metric] })),
        aggregated: limited,
        columnValues: []
      };
    }
    const columnValues = [...new Set(rows.map((row) => dimensionValue(row, definition.columnDimension)))].sort().slice(0, 12);
    const computed = limited.map((item) => {
      const output = { [DIMENSIONS[definition.rowDimension]]: item.name };
      columnValues.forEach((column) => {
        const scoped = item.raw.filter((row) => dimensionValue(row, definition.columnDimension) === column);
        output[column] = metrics(scoped)[metric];
      });
      return output;
    });
    return { rows, computed, aggregated: limited, columns: [DIMENSIONS[definition.rowDimension], ...columnValues], columnValues };
  }

  function renderStudio() {
    ensureDemoViews();
    const definition = { ...state.builder };
    const view = customViewRows(definition);
    const measure = MEASURES[definition.metric] || MEASURES.total;
    const activeId = definition.id;
    $("#page").innerHTML = `
      <div class="page-intro"><div><p class="eyebrow">Saved to your user ID</p><h2>Build once. Refresh with every upload.</h2><p>Save a reusable table, pivot, or chart definition. SHARV recalculates it against the newest authorized shipment data whenever you return.</p></div><button class="button primary" type="button" id="newCustomView">+ New view</button></div>
      <div class="studio-layout">
        <aside class="card views-panel"><header class="card-head"><div><h3>My views</h3><p>${state.savedViews.length} saved for this account</p></div></header><div class="views-list">${state.savedViews.map((saved) => `<button class="view-item ${saved.id === activeId ? "active" : ""}" type="button" data-view-id="${escapeHtml(saved.id)}"><span class="view-icon">${icon(saved.definition.viewType === "table" || saved.definition.viewType === "pivot" ? "package" : "trend")}</span><span><b>${escapeHtml(saved.name)}</b><small>${escapeHtml(saved.definition.viewType)} · updated ${formatDate(saved.updatedAt, { short: true })}</small></span>${icon("chevron")}</button>`).join("") || `<div class="empty-state" style="min-height:180px;padding:20px"><div><p>No saved views yet.</p></div></div>`}</div></aside>
        <section class="builder">
          <article class="card"><header class="card-head"><div><h3>View definition</h3><p>Saved settings, not a frozen data snapshot</p></div></header><div class="builder-fields">
            <label class="field"><span>View name</span><input id="builderName" value="${escapeHtml(definition.name)}" maxlength="80"></label>
            <div class="builder-grid">
              <label class="field"><span>Display</span><select id="builderType"><option value="table" ${definition.viewType === "table" ? "selected" : ""}>Data table</option><option value="pivot" ${definition.viewType === "pivot" ? "selected" : ""}>Pivot table</option><option value="bar" ${definition.viewType === "bar" ? "selected" : ""}>Bar chart</option><option value="line" ${definition.viewType === "line" ? "selected" : ""}>Line chart</option></select></label>
              <label class="field"><span>Rows / X-axis</span><select id="builderRow">${dimensionOptions(definition.rowDimension)}</select></label>
              <label class="field"><span>Columns</span><select id="builderColumn"><option value="none">No column split</option>${dimensionOptions(definition.columnDimension, definition.rowDimension)}</select></label>
              <label class="field"><span>Value</span><select id="builderMetric">${Object.entries(MEASURES).map(([key, item]) => `<option value="${key}" ${key === definition.metric ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
              <label class="field"><span>Sort</span><select id="builderSort"><option value="desc" ${definition.sort === "desc" ? "selected" : ""}>Highest first</option><option value="asc" ${definition.sort === "asc" ? "selected" : ""}>Lowest first</option></select></label>
              <label class="field"><span>Result limit</span><select id="builderLimit">${[10,20,50,0].map((value) => `<option value="${value}" ${Number(definition.limit) === value ? "selected" : ""}>${value || "All groups"}</option>`).join("")}</select></label>
            </div>
            <label class="check-row"><input id="builderGlobal" type="checkbox" ${definition.useGlobalFilters ? "checked" : ""}> Use the dashboard's active filters and date range</label>
            <p class="field-hint">The saved definition recalculates automatically when new shipments are uploaded.</p>
            <div class="builder-actions">${activeId ? `<button class="button danger" type="button" id="deleteCustomView">Delete</button>` : ""}<button class="button primary" type="button" id="saveCustomView">${activeId ? "Update view" : "Save to my account"}</button></div>
          </div></article>
          <article class="card builder-preview"><header class="card-head"><div><h3>Live preview</h3><p>${formatNumber(view.rows.length)} underlying rows · ${view.computed.length} computed results</p></div>${kebabButton("Custom view preview", "custom-preview")}</header><div class="card-body" id="customPreview">${renderCustomPreview(definition, view, measure)}</div><footer class="table-footer"><span>Computed from ${definition.useGlobalFilters ? "the current dashboard scope" : "all authorized shipments"}</span><span>Auto-refreshes after upload</span></footer></article>
        </section>
      </div>`;
    if (["bar", "line"].includes(definition.viewType)) renderCustomChart(definition, view, measure);
    state.exports.clear();
    registerExport("custom-preview", { title: definition.name || "Custom view", type: ["bar", "line"].includes(definition.viewType) ? "chart" : "table", chartId: ["bar", "line"].includes(definition.viewType) ? "customViewChart" : null, rows: view.computed, raw: view.rows });
    state.currentTable = { name: slugify(definition.name || "custom-view"), rows: view.computed };
    ["builderName", "builderType", "builderRow", "builderColumn", "builderMetric", "builderSort", "builderLimit", "builderGlobal"].forEach((id) => {
      $("#" + id)?.addEventListener(id === "builderName" ? "input" : "change", debounce(readBuilderAndRender, id === "builderName" ? 280 : 20));
    });
    $("#newCustomView")?.addEventListener("click", newCustomView);
    $("#saveCustomView")?.addEventListener("click", saveCustomView);
    $("#deleteCustomView")?.addEventListener("click", deleteCustomView);
    $$('[data-view-id]').forEach((button) => button.addEventListener("click", () => loadCustomView(button.dataset.viewId)));
  }

  function dimensionOptions(selected, exclude = "") {
    return Object.entries(DIMENSIONS).filter(([key]) => key !== exclude).map(([key, label]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  }

  function renderCustomPreview(definition, view, measure) {
    if (["bar", "line"].includes(definition.viewType)) return `<div class="chart-wrap"><canvas id="customViewChart" role="img" aria-label="${escapeHtml(definition.name)} chart"></canvas></div>`;
    const columns = view.computed.length ? Object.keys(view.computed[0]) : view.columns;
    return `<div class="table-scroll"><table class="data-table"><thead><tr>${columns.map((column) => `<th class="${column === columns[0] ? "" : "right"}">${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${view.computed.map((row) => `<tr>${columns.map((column, index) => `<td class="${index ? "right" : "strong"}">${index ? escapeHtml(measure.format(row[column])) : escapeHtml(row[column])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length || 1}">No data for this configuration.</td></tr>`}</tbody></table></div>`;
  }

  function renderCustomChart(definition, view, measure) {
    const label = DIMENSIONS[definition.rowDimension];
    createChart("customViewChart", { type: definition.viewType, data: { labels: view.aggregated.map((item) => item.name), datasets: [{ label: measure.label, data: view.aggregated.map((item) => definition.metric.endsWith("Rate") ? item[definition.metric] * 100 : item[definition.metric]), backgroundColor: definition.viewType === "bar" ? PALETTE.blue : PALETTE.blue, borderColor: PALETTE.blue, borderRadius: 4, tension: .3, pointRadius: 3 }] }, options: chartOptions({ percent: definition.metric.endsWith("Rate"), legend: true }) });
  }

  function readBuilderAndRender() {
    state.builder = {
      ...state.builder,
      name: $("#builderName")?.value.trim() || "Untitled view",
      viewType: $("#builderType")?.value || "table",
      rowDimension: $("#builderRow")?.value || "courier",
      columnDimension: $("#builderColumn")?.value || "none",
      metric: $("#builderMetric")?.value || "total",
      sort: $("#builderSort")?.value || "desc",
      limit: Number($("#builderLimit")?.value || 10),
      useGlobalFilters: $("#builderGlobal")?.checked ?? true
    };
    renderStudio();
  }

  function newCustomView() {
    state.builder = { id: null, name: "Untitled analytics view", viewType: "table", rowDimension: "courier", columnDimension: "none", metric: "onTimeRate", sort: "desc", limit: 10, useGlobalFilters: true };
    renderStudio();
  }

  function loadCustomView(id) {
    const saved = state.savedViews.find((item) => item.id === id);
    if (!saved) return;
    state.builder = { id: saved.id, name: saved.name, ...saved.definition };
    renderStudio();
  }

  async function saveCustomView() {
    const name = state.builder.name.trim();
    if (!name) { toast("Name this view", "A short name helps you find it next time.", "warning"); return; }
    const definition = { version: 1, viewType: state.builder.viewType, rowDimension: state.builder.rowDimension, columnDimension: state.builder.columnDimension, metric: state.builder.metric, sort: state.builder.sort, limit: state.builder.limit, useGlobalFilters: state.builder.useGlobalFilters };
    const now = new Date().toISOString();
    if (state.demo) {
      if (state.builder.id) {
        const index = state.savedViews.findIndex((item) => item.id === state.builder.id);
        state.savedViews[index] = { ...state.savedViews[index], name, definition, updatedAt: now };
      } else {
        const id = `demo-view-${Date.now()}`;
        state.savedViews.unshift({ id, name, definition, updatedAt: now });
        state.builder.id = id;
      }
      localStorage.setItem("sharv-demo-views", JSON.stringify(state.savedViews));
      toast("View saved", "It will recalculate when the shipment data changes.");
      renderStudio();
      return;
    }
    const payload = { name, definition, owner_id: state.user.id };
    const query = state.builder.id ? state.supabase.from("saved_views").update(payload).eq("id", state.builder.id).select().single() : state.supabase.from("saved_views").insert(payload).select().single();
    const { data, error } = await query;
    if (error) { toast("Could not save view", error.message, "error"); return; }
    const saved = { id: data.id, name: data.name, definition: data.definition, updatedAt: data.updated_at };
    const index = state.savedViews.findIndex((item) => item.id === saved.id);
    if (index >= 0) state.savedViews[index] = saved; else state.savedViews.unshift(saved);
    state.builder.id = saved.id;
    toast("View saved", "Your layout is now linked to your user ID.");
    renderStudio();
  }

  async function deleteCustomView() {
    if (!state.builder.id) return;
    if (!confirm(`Delete “${state.builder.name}”? This removes the saved definition only.`)) return;
    if (!state.demo) {
      const { error } = await state.supabase.from("saved_views").delete().eq("id", state.builder.id);
      if (error) { toast("Could not delete view", error.message, "error"); return; }
    }
    state.savedViews = state.savedViews.filter((item) => item.id !== state.builder.id);
    if (state.demo) localStorage.setItem("sharv-demo-views", JSON.stringify(state.savedViews));
    toast("View deleted", "The underlying shipment data was not changed.");
    newCustomView();
  }

  function sharvWelcome() {
    return `<p><b>Good morning — I’m SHARV.</b> I can investigate one shipment or hundreds, compare courier and customer performance, and explain SLA risk using the data you are allowed to see.</p><div class="answer-summary"><span class="chip neutral">AWB or order ID</span><span class="chip neutral">Customer lookup</span><span class="chip neutral">City / state SLA</span><span class="chip neutral">Courier comparison</span></div><p>Try pasting <span class="mono">12378495599, GS12374995</span> or ask “What is Delhivery’s SLA in Pune for Aarav Retail?”</p>`;
  }

  function renderSharv() {
    if (!state.chat.length) state.chat = [{ role: "assistant", html: sharvWelcome() }];
    $("#page").innerHTML = `
      <div class="sharv-layout">
        <section class="chat-panel" aria-label="SHARV conversation">
          <header class="chat-head"><div class="assistant-id"><span class="sharv-spark">${icon("spark")}</span><div><h2>SHARV</h2><p>Shipment & SLA intelligence</p></div></div><span class="assistant-status">Ready · ${formatNumber(state.chatScope === "filtered" ? state.filtered.length : state.shipments.length)} rows in scope</span></header>
          <div class="chat-messages" id="chatMessages">${state.chat.map(renderChatMessage).join("")}</div>
          <form class="chat-composer" id="sharvForm"><div class="composer-box"><textarea id="sharvInput" rows="1" placeholder="Ask about AWBs, orders, customers, couriers, cities, or SLA…" aria-label="Message SHARV"></textarea><button class="send-button" type="submit" aria-label="Send message">${icon("chevron")}</button></div><div class="composer-note"><span>Enter to send · Shift + Enter for a new line</span><span>Answers cite the current data scope</span></div></form>
        </section>
        <aside class="sharv-side">
          <article class="card"><header class="card-head"><div><h3>Analysis scope</h3><p>Choose what SHARV is allowed to consider</p></div></header><div class="scope-toggle"><button type="button" class="${state.chatScope === "all" ? "active" : ""}" data-chat-scope="all">All authorized data</button><button type="button" class="${state.chatScope === "filtered" ? "active" : ""}" data-chat-scope="filtered">Dashboard filters</button></div></article>
          <article class="card"><header class="card-head"><div><h3>Ask a useful question</h3><p>SHARV understands these query patterns</p></div></header><div class="starter-list">
            ${starterPrompt("Track multiple shipments", "Status of 12378495599, GS12374995")}
            ${starterPrompt("Investigate a customer", "Show performance for Aarav Retail")}
            ${starterPrompt("Check a courier + city SLA", "What is Delhivery SLA in Pune?")}
            ${starterPrompt("Find regional risk", "Which state has the most SLA breaches?")}
            ${starterPrompt("Compare couriers", "Compare all couriers by on-time delivery and RTO")}
          </div></article>
          <article class="card"><header class="card-head"><div><h3>How answers are calculated</h3><p>Transparent logistics definitions</p></div></header><div class="card-body"><ul class="insight-list"><li class="insight-item"><span class="insight-icon">${icon("clock")}</span><div><b>SLA compliance</b><p>Delivered on or before EDD, or against an effective configured SLA rule.</p></div></li><li class="insight-item"><span class="insight-icon" style="--insight-color:var(--teal);--insight-bg:var(--teal-soft)">${icon("trend")}</span><div><b>Transit time</b><p>Calendar days from pickup to delivery; open shipments are excluded.</p></div></li><li class="insight-item"><span class="insight-icon" style="--insight-color:var(--amber);--insight-bg:var(--amber-soft)">${icon("route")}</span><div><b>Scope first</b><p>Every answer includes its sample size and active data scope.</p></div></li></ul></div></article>
        </aside>
      </div>`;
    const messages = $("#chatMessages");
    messages.scrollTop = messages.scrollHeight;
    $("#sharvForm").addEventListener("submit", (event) => { event.preventDefault(); submitSharv(); });
    $("#sharvInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitSharv(); } });
    $$('[data-starter-prompt]').forEach((button) => button.addEventListener("click", () => askSharv(button.dataset.starterPrompt)));
    $$('[data-chat-scope]').forEach((button) => button.addEventListener("click", () => { state.chatScope = button.dataset.chatScope; renderSharv(); }));
    setTimeout(() => $("#sharvInput")?.focus(), 0);
  }

  function starterPrompt(label, prompt) {
    return `<button class="starter-prompt" type="button" data-starter-prompt="${escapeHtml(prompt)}">${icon("spark")}<span><b>${escapeHtml(label)}</b><br>${escapeHtml(prompt)}</span></button>`;
  }

  function renderChatMessage(message) {
    if (message.role === "user") return `<div class="chat-message user"><div class="message-bubble">${escapeHtml(message.text).replace(/\n/g, "<br>")}</div></div>`;
    return `<div class="chat-message assistant"><span class="message-avatar">S</span><div class="message-bubble">${message.html}</div></div>`;
  }

  function submitSharv() {
    const input = $("#sharvInput");
    const question = input?.value.trim();
    if (!question) return;
    askSharv(question);
  }

  async function askSharv(question) {
    state.chat.push({ role: "user", text: question });
    if (state.route !== "sharv") { state.route = "sharv"; renderSharv(); }
    else renderSharv();
    const messages = $("#chatMessages");
    const thinking = document.createElement("div");
    thinking.className = "chat-message assistant";
    thinking.innerHTML = '<span class="message-avatar">S</span><div class="message-bubble"><span class="subtle">Reading the shipment scope…</span></div>';
    messages.append(thinking); messages.scrollTop = messages.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 280));
    const answer = analyzeSharv(question);
    state.chat.push({ role: "assistant", html: answer });
    renderSharv();
  }

  function analyzeSharv(question) {
    const source = state.chatScope === "filtered" ? state.filtered : state.shipments;
    const lower = question.toLowerCase();
    const scopeLabel = state.chatScope === "filtered" ? `current dashboard filters (${formatNumber(source.length)} shipments)` : `all authorized data (${formatNumber(source.length)} shipments)`;
    if (!source.length) return `<p>I don’t have any shipment rows in ${escapeHtml(scopeLabel)}. Ask a primary user to upload data or widen the filters.</p>`;

    const awbMap = new Map();
    const orderMap = new Map();
    source.forEach((row) => {
      const awb = String(row.awb || "").toLowerCase();
      const order = String(row.orderId || "").toLowerCase();
      if (awb) awbMap.set(awb, [...(awbMap.get(awb) || []), row]);
      if (order) orderMap.set(order, [...(orderMap.get(order) || []), row]);
    });
    const candidates = [...new Set((question.match(/\b(?=[A-Za-z0-9_-]{5,}\b)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g) || []).map((token) => token.replace(/[.,;:]+$/, "")))];
    const matched = [];
    const unmatched = [];
    candidates.forEach((token) => {
      const rows = awbMap.get(token.toLowerCase()) || orderMap.get(token.toLowerCase());
      if (rows?.length) matched.push({ token, rows }); else unmatched.push(token);
    });
    if (matched.length) {
      const resultRows = matched.flatMap((match) => match.rows);
      state.lastSharvRows = resultRows;
      return `<p>I found <b>${formatNumber(resultRows.length)} shipment${resultRows.length === 1 ? "" : "s"}</b> for ${matched.length} matched identifier${matched.length === 1 ? "" : "s"} in ${escapeHtml(scopeLabel)}.</p><div class="answer-summary"><span class="chip status-good">${matched.length} matched</span>${unmatched.length ? `<span class="chip status-bad">${unmatched.length} not found</span>` : ""}</div>${matched.map((match) => match.rows.map((row) => shipmentResultHtml(row, match.token)).join("")).join("")}${unmatched.length ? `<p><b>Not found:</b> <span class="mono">${unmatched.map(escapeHtml).join(", ")}</span>. Check the full AWB/order ID or switch the analysis scope.</p>` : ""}`;
    }

    if (/which (one|shipment)|the (first|second|third)|those|them/i.test(lower) && state.lastSharvRows.length) {
      const relevant = /delay|late|breach/i.test(lower) ? state.lastSharvRows.filter((row) => row.statusGroup !== "Delivered" && row.edd && new Date(row.edd) < new Date()) : state.lastSharvRows;
      if (!relevant.length) return `<p>None of the ${state.lastSharvRows.length} shipments from the previous answer are currently past their promised date.</p>`;
      return `<p>${relevant.length} shipment${relevant.length === 1 ? " is" : "s are"} relevant to that follow-up.</p>${relevant.map((row) => shipmentResultHtml(row, row.awb)).join("")}`;
    }

    const dimensions = detectQuestionDimensions(question, source);
    if (/compare/i.test(lower)) {
      const normalizedQuestion = normalizeText(question);
      const mentionedStates = [...new Set(source.map((row) => row.state).filter(Boolean))].filter((name) => normalizedQuestion.includes(normalizeText(name)));
      if (mentionedStates.length >= 2) {
        const compared = source.filter((row) => mentionedStates.includes(row.state) && (!dimensions.courier || normalizeText(row.courier) === normalizeText(dimensions.courier)));
        return '<p>State comparison based on observed shipments' + (dimensions.courier ? ' for ' + escapeHtml(dimensions.courier) : '') + ':</p>' + miniComparisonTable(aggregateDimension(compared, "state").sort((a, b) => b.total - a.total), "State");
      }
    }
    let cohort = source;
    if (dimensions.courier) cohort = cohort.filter((row) => normalizeText(row.courier) === normalizeText(dimensions.courier));
    if (dimensions.state) cohort = cohort.filter((row) => normalizeText(row.state) === normalizeText(dimensions.state));
    if (dimensions.city) cohort = cohort.filter((row) => normalizeText(row.city) === normalizeText(dimensions.city));
    if (dimensions.customer) cohort = cohort.filter((row) => normalizeText(row.customer).includes(normalizeText(dimensions.customer)) || normalizeText(row.recipientName).includes(normalizeText(dimensions.customer)));
    if (dimensions.pincode) cohort = cohort.filter((row) => String(row.pincode || "") === dimensions.pincode);
    if (dimensions.product || /product|sku|quantity|units|movement/i.test(lower)) {
      const productMap = new Map();
      cohort.forEach((row) => (row.productItems || []).forEach((line) => {
        const name = line.productName || line.sku || "Unspecified product";
        if (dimensions.product && !normalizeText(name).includes(normalizeText(dimensions.product)) && !normalizeText(line.sku).includes(normalizeText(dimensions.product))) return;
        const item = productMap.get(name) || { Product: name, SKU: line.sku || "—", Units: 0, Lines: 0 };
        item.Units += Number(line.quantity || 0); item.Lines++; productMap.set(name, item);
      }));
      const ranked = [...productMap.values()].sort((a, b) => b.Units - a.Units).slice(0, 10);
      if (!ranked.length) return '<p>Product/SKU line details are not available in this data slice, so I cannot calculate product movement.</p>';
      state.lastSharvRows = cohort;
      return '<p>Product movement for ' + escapeHtml([dimensions.city, dimensions.state, dimensions.courier].filter(Boolean).join(' · ') || scopeLabel) + ' is ranked by quantity units:</p>' + miniComparisonTable(ranked.map((item) => ({ name: item.Product + ' · ' + item.SKU, total: item.Units })), 'Product / SKU');
    }
    if (/repeat customer|new customer|customer count/i.test(lower)) {
      const customerSet = new Map();
      cohort.forEach((row) => {
        if (!row.customerKey) return;
        const item = customerSet.get(row.customerKey) || { orders: 0 };
        item.orders++; customerSet.set(row.customerKey, item);
      });
      const repeat = [...customerSet.values()].filter((item) => item.orders > 1).length;
      const newCount = [...customerSet.values()].filter((item) => item.orders === 1).length;
      return '<p>In ' + escapeHtml([dimensions.state, dimensions.city].filter(Boolean).join(' · ') || scopeLabel) + ', I found <b>' + formatNumber(repeat) + ' repeat customers</b> and ' + formatNumber(newCount) + ' customers with one observed order. This uses normalized name + address and only records with both fields populated (' + formatNumber(customerSet.size) + ' identities).</p>';
    }
    if (/worst|lowest|risk|breach/i.test(lower) && /pincode|pin code|postal/i.test(lower)) {
      const pins = aggregateDimension(cohort, 'pincode').filter((item) => item.name && item.name !== 'Unknown' && item.total >= 3).sort((a, b) => a.onTimeRate - b.onTimeRate);
      if (!pins.length) return '<p>No pincode has the minimum three shipments needed for a directional performance ranking.</p>';
      state.lastSharvRows = pins[0].raw;
      return '<p>Lowest observed pincode SLA' + (dimensions.courier ? ' for ' + escapeHtml(dimensions.courier) : '') + ' (minimum three shipments per pin):</p>' + miniComparisonTable(pins.slice(0, 8).map((item) => ({ name: item.name, total: item.total, deliveryRate: item.deliveryRate, onTimeRate: item.onTimeRate, rtoRate: item.rtoRate, exceptions: item.exceptions })), 'Pincode');
    }
    if (/why.*(delay|late)|delay.*why|cause.*delay/i.test(lower)) {
      const delayed = cohort.filter((row) => row.statusGroup !== 'Delivered' && row.edd && new Date(row.edd) < new Date());
      if (!delayed.length) return '<p>No open shipment past its EDD was found in this slice. The source data does not support a delay-cause claim.</p>';
      const reasons = [...groupRows(delayed.filter((row) => row.remark || row.ndrStatus), (row) => row.remark || row.ndrStatus)].map(([name, items]) => ({ name, value: items.length })).sort((a, b) => b.value - a.value).slice(0, 5);
      const carriers = aggregateDimension(delayed, 'courier').sort((a, b) => b.total - a.total);
      return '<p>There are <b>' + formatNumber(delayed.length) + ' open shipments past EDD</b> in this slice. ' + (carriers.length ? escapeHtml(carriers[0].name) + ' is responsible for the largest count (' + formatNumber(carriers[0].total) + '). ' : '') + 'Recorded carrier signals: ' + (reasons.length ? reasons.map((item) => escapeHtml(item.name) + ' (' + formatNumber(item.value) + ')').join(', ') : 'no delay reason was present in the source') + '.</p>';
    }
    if (/sla|service level|on.?time|tat|turnaround|delivery time|performance/i.test(lower) && (dimensions.courier || dimensions.state || dimensions.city || dimensions.customer)) {
      state.lastSharvRows = cohort.slice(0, 50);
      return slaAnswer(cohort, dimensions, scopeLabel);
    }

    if (dimensions.customer) {
      if (!cohort.length) return `<p>I couldn’t find a customer or recipient matching <b>${escapeHtml(dimensions.customer)}</b> in ${escapeHtml(scopeLabel)}.</p>`;
      const accounts = [...new Set(cohort.map((row) => row.customer))];
      if (accounts.length > 1 && !accounts.some((name) => normalizeText(name) === normalizeText(dimensions.customer))) return `<p>“${escapeHtml(dimensions.customer)}” matches ${accounts.length} customer accounts. Choose one so I don’t guess:</p><div class="chat-suggestions">${accounts.slice(0, 8).map((name) => `<button type="button" data-starter-prompt="Show performance for ${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>`;
      state.lastSharvRows = cohort.slice(0, 50);
      return cohortSummaryAnswer(cohort, accounts[0] || dimensions.customer, scopeLabel);
    }

    if (/compare.*courier|best courier|courier.*performance|highest.*rto|lowest.*sla/i.test(lower)) {
      const courierRows = aggregateDimension(cohort, "courier").sort((a, b) => b.onTimeRate - a.onTimeRate);
      const highestRto = [...courierRows].sort((a, b) => b.rtoRate - a.rtoRate)[0];
      return `<p>Here is the courier comparison for ${escapeHtml(scopeLabel)}. <b>${escapeHtml(courierRows[0]?.name || "—")}</b> leads SLA at ${formatPercent(courierRows[0]?.onTimeRate)}, while <b>${escapeHtml(highestRto?.name || "—")}</b> has the highest RTO rate at ${formatPercent(highestRto?.rtoRate)}.</p>${miniComparisonTable(courierRows, "Courier")}`;
    }

    if (/which state|state.*breach|regional risk|worst state/i.test(lower)) {
      const stateRows = aggregateDimension(cohort, "state").filter((item) => item.total >= 5).sort((a, b) => a.onTimeRate - b.onTimeRate);
      return `<p><b>${escapeHtml(stateRows[0]?.name || "No state")}</b> has the lowest observed on-time rate in ${escapeHtml(scopeLabel)} at ${formatPercent(stateRows[0]?.onTimeRate)} across ${formatNumber(stateRows[0]?.total)} shipments.</p>${miniComparisonTable(stateRows.slice(0, 8), "State")}`;
    }

    const partialCustomers = findPartialCustomers(question, source);
    if (partialCustomers.length) {
      if (partialCustomers.length > 1) return `<p>I found several customer matches. Choose the intended account:</p><div class="chat-suggestions">${partialCustomers.map((name) => `<button type="button" data-starter-prompt="Show performance for ${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>`;
      const rows = source.filter((row) => normalizeText(row.customer) === normalizeText(partialCustomers[0]));
      return cohortSummaryAnswer(rows, partialCustomers[0], scopeLabel);
    }

    const summary = metrics(source);
    return `<p>I couldn’t resolve a shipment identifier or a specific customer/location from that message. For ${escapeHtml(scopeLabel)}, the network is at <b>${formatPercent(summary.deliveryRate)} delivery</b>, <b>${formatPercent(summary.onTimeRate)} on-time</b>, and <b>${formatPercent(summary.rtoRate)} RTO</b>.</p><p>Try including an exact AWB/order ID, or ask with a combination like courier + city/state + customer.</p><div class="chat-suggestions"><button type="button" data-starter-prompt="Compare all couriers by on-time delivery and RTO">Compare couriers</button><button type="button" data-starter-prompt="Which state has the most SLA breaches?">Find state risk</button></div>`;
  }

  function normalizeText(value) {
    return String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function detectQuestionDimensions(question, source) {
    const normalized = normalizeText(question);
    const padded = ` ${normalized} `;
    const find = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => String(b).length - String(a).length).find((value) => padded.includes(` ${normalizeText(value)} `));
    const courier = find(source.map((row) => row.courier));
    const city = find(source.map((row) => row.city));
    let stateName = find(source.map((row) => row.state));
    if (city && !stateName) stateName = source.find((row) => normalizeText(row.city) === normalizeText(city))?.state || null;
    const customer = find([...source.map((row) => row.customer), ...source.map((row) => row.recipientName)]);
    const product = find(source.flatMap((row) => (row.productItems || []).flatMap((item) => [item.productName, item.sku])));
    const pinCandidate = question.match(/\b\d{5,6}\b/)?.[0];
    const pincode = pinCandidate && source.some((row) => String(row.pincode || "") === pinCandidate) ? pinCandidate : null;
    return { courier, city, state: stateName, customer, product, pincode };
  }

  function findPartialCustomers(question, source) {
    const terms = normalizeText(question).split(" ").filter((term) => term.length >= 4 && !["show", "find", "customer", "performance", "orders", "order", "shipments", "shipment", "about", "what", "status"].includes(term));
    const names = [...new Set(source.map((row) => row.customer).filter(Boolean))];
    return names.filter((name) => terms.some((term) => normalizeText(name).includes(term))).slice(0, 8);
  }

  function shipmentResultHtml(row, matchedToken) {
    const late = row.statusGroup !== "Delivered" && row.edd && new Date(row.edd) < new Date();
    return `<details class="shipment-result" open><summary><span class="status ${statusClass(row.statusGroup)}"></span><b>${escapeHtml(row.orderId)} · <span class="mono">${escapeHtml(row.awb)}</span></b><span class="priority ${late ? "high" : priorityFor(row).toLowerCase()}">${late ? "Late" : escapeHtml(row.statusGroup)}</span></summary><div class="result-grid">${detailField("Matched", matchedToken)}${detailField("Courier", row.courier)}${detailField("Customer", row.customer)}${detailField("Recipient", row.recipientName)}${detailField("Destination", `${row.city}, ${row.state}`)}${detailField("Status", row.status)}${detailField("Promised date", formatDate(row.edd))}${detailField("Delivered", formatDate(row.deliveredDate))}${detailField("Attempts", formatNumber(row.attempts))}${detailField("Freight", row.freight == null ? "Not in source" : formatCurrency(row.freight))}${(row.ndrStatus || row.remark) ? detailField("Carrier signal", row.ndrStatus || row.remark) : ""}</div></details>`;
  }

  function matchSlaRule(dimensions) {
    const candidates = state.slaRules.filter((rule) => (!rule.courier || normalizeText(rule.courier) === normalizeText(dimensions.courier)) && (!rule.customer || normalizeText(rule.customer) === normalizeText(dimensions.customer)) && (!rule.state || normalizeText(rule.state) === normalizeText(dimensions.state)) && (!rule.city || normalizeText(rule.city) === normalizeText(dimensions.city)));
    return candidates.sort((a, b) => [b.customer, b.city, b.state, b.courier].filter(Boolean).length - [a.customer, a.city, a.state, a.courier].filter(Boolean).length)[0] || null;
  }

  function slaAnswer(rows, dimensions, scopeLabel) {
    const label = [dimensions.customer, dimensions.courier, dimensions.city, dimensions.state].filter(Boolean).join(" · ") || "selected scope";
    if (!rows.length) return `<p>There are no shipments for <b>${escapeHtml(label)}</b> in ${escapeHtml(scopeLabel)}. I won’t infer an SLA from a zero-row sample.</p>`;
    const delivered = rows.filter((row) => row.statusGroup === "Delivered" && Number.isFinite(row.tat));
    const promised = delivered.filter((row) => row.edd && row.deliveredDate);
    const rule = matchSlaRule(dimensions);
    const target = rule?.targetDays ?? percentile(rows.map((row) => Number(row.serviceTarget)).filter(Number.isFinite), .5);
    const compliant = delivered.filter((row) => rule ? row.tat <= target : row.onTime).length;
    const denominator = rule ? delivered.length : promised.length;
    const compliance = denominator ? compliant / denominator : null;
    const kpi = metrics(rows);
    const confidence = delivered.length < 10 ? "Low sample" : delivered.length < 30 ? "Directional" : "Reliable";
    const definition = rule ? `Configured contractual target: ${formatNumber(target, 1)} calendar days (${escapeHtml(rule.serviceLevel || "standard service")}).` : `No matching contractual rule is configured; compliance below is observed against each shipment’s promised EDD.`;
    return `<p>For <b>${escapeHtml(label)}</b>, I analysed <b>${formatNumber(rows.length)} shipments</b> in ${escapeHtml(scopeLabel)}.</p><div class="answer-summary"><span class="chip ${compliance == null ? "neutral" : compliance >= .8 ? "status-good" : "status-warn"}">${compliance == null ? "SLA not measurable" : `${formatPercent(compliance)} SLA compliance`}</span><span class="chip neutral">Avg TAT ${formatNumber(kpi.avgTat, 1)}${kpi.avgTat == null ? "" : "d"}</span><span class="chip neutral">P90 ${formatNumber(kpi.p90Tat, 1)}${kpi.p90Tat == null ? "" : "d"}</span><span class="chip ${kpi.rtoRate > .1 ? "status-bad" : "neutral"}">RTO ${formatPercent(kpi.rtoRate)}</span></div><p>${definition}</p>${denominator ? `<p><b>Evidence:</b> ${formatNumber(compliant)} of ${formatNumber(denominator)} eligible delivered shipments met the measure; ${formatNumber(delivered.length)} delivered, ${formatNumber(kpi.open)} still open. Coverage is ${formatPercent(denominator / (rows.length || 1))}. Confidence: ${confidence}.</p>` : `<p><b>Evidence:</b> There are no eligible delivered shipments in this slice yet. ${formatNumber(kpi.open)} shipment${kpi.open === 1 ? " is" : "s are"} still open, so a compliance rate would be misleading.</p>`}${delivered.length < 5 ? `<p class="subtle">This sample is too small for a stable operational conclusion.</p>` : ""}`;
  }

  function cohortSummaryAnswer(rows, label, scopeLabel) {
    const kpi = metrics(rows);
    const byCourier = aggregateDimension(rows, "courier").sort((a, b) => b.total - a.total);
    return `<p><b>${escapeHtml(label)}</b> has ${formatNumber(rows.length)} shipments in ${escapeHtml(scopeLabel)}.</p><div class="answer-summary"><span class="chip status-good">Delivery ${formatPercent(kpi.deliveryRate)}</span><span class="chip neutral">SLA ${formatPercent(kpi.onTimeRate)}</span><span class="chip ${kpi.rtoRate > .1 ? "status-bad" : "neutral"}">RTO ${formatPercent(kpi.rtoRate)}</span><span class="chip neutral">Avg TAT ${formatNumber(kpi.avgTat, 1)}d</span></div>${miniComparisonTable(byCourier, "Courier")}`;
  }

  function miniComparisonTable(rows, label) {
    return `<div class="shipment-result" style="overflow:auto"><table class="data-table"><thead><tr><th>${escapeHtml(label)}</th><th class="right">Shipments</th><th class="right">SLA</th><th class="right">RTO</th><th class="right">Avg TAT</th></tr></thead><tbody>${rows.slice(0, 10).map((item) => `<tr><td class="strong">${escapeHtml(item.name)}</td><td class="right">${formatNumber(item.total)}</td><td class="right">${formatPercent(item.onTimeRate)}</td><td class="right">${formatPercent(item.rtoRate)}</td><td class="right">${formatNumber(item.avgTat, 1)}d</td></tr>`).join("")}</tbody></table></div>`;
  }

  function registerExport(key, definition) {
    state.exports.set(key, definition);
  }

  function sanitizedCell(value) {
    if (value instanceof Date) return value;
    if (typeof value === "string" && /^[=+\-@]/.test(value)) return `'${value}`;
    return value ?? "";
  }

  function normalizedExportRows(rows) {
    return rows.map((row) => ({
      "Source": row.source,
      "AWB": row.awb,
      "Order ID": row.orderId,
      "Customer account": row.customer,
      "Recipient name": row.recipientName,
      "Courier": row.courier,
      "Warehouse": row.warehouse,
      "City": row.city,
      "State": row.state,
      "Pincode": row.pincode,
      "Payment": row.payment,
      "Transport mode": row.mode,
      "Direction": row.direction,
      "Status": row.status,
      "Status group": row.statusGroup,
      "Order date": row.orderDate ? new Date(row.orderDate) : "",
      "Pickup date": row.pickupDate ? new Date(row.pickupDate) : "",
      "EDD": row.edd ? new Date(row.edd) : "",
      "Delivered date": row.deliveredDate ? new Date(row.deliveredDate) : "",
      "TAT days": row.tat,
      "SLA target days": row.serviceTarget,
      "On time": row.onTime == null ? "" : row.onTime ? "Yes" : "No",
      "Ageing days": row.age,
      "Attempts": row.attempts,
      "Freight INR": row.freight,
      "NDR status": row.ndrStatus,
      "Remark / RTO reason": row.remark,
      "Upload batch": row.uploadBatch
    }));
  }

  function prepareExportRows(rows) {
    const source = rows.every((row) => row && ("awb" in row || "orderId" in row)) ? normalizedExportRows(rows) : rows;
    return source.map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => typeof value !== "object" || value instanceof Date).map(([key, value]) => [key, sanitizedCell(value)])));
  }

  function downloadWorkbook(rows, filename, sheetName = "Data", preserveColumns = false) {
    const cleanRows = preserveColumns ? rows.map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => typeof value !== "object" || value instanceof Date).map(([key, value]) => [key, sanitizedCell(value)]))) : prepareExportRows(rows);
    const safeName = `${slugify(filename)}-${new Date().toISOString().slice(0, 10)}`;
    if (window.XLSX) {
      const workbook = XLSX.utils.book_new();
      const worksheet = cleanRows.length ? XLSX.utils.json_to_sheet(cleanRows, { cellDates: true }) : XLSX.utils.aoa_to_sheet([["No rows in current scope"]]);
      XLSX.utils.book_append_sheet(workbook, worksheet, String(sheetName).slice(0, 31));
      XLSX.writeFile(workbook, `${safeName}.xlsx`, { cellDates: true });
    } else {
      const columns = cleanRows.length ? Object.keys(cleanRows[0]) : ["No rows in current scope"];
      const csv = [columns, ...cleanRows.map((row) => columns.map((column) => row[column] ?? ""))].map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
      downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `${safeName}.csv`);
    }
    toast("Download ready", `${formatNumber(rows.length)} row${rows.length === 1 ? "" : "s"} exported.`);
  }

  function rawExportRows(rows) {
    const lines = rows.flatMap((row) => {
      const original = row.rawPayload?.__lineItems;
      if (Array.isArray(original) && original.length) return original.map((line) => ({ ...line, "Consolidated order ID": row.orderId, "Mapped AWB": row.awb, "Courier": row.courier, "Customer": row.recipientName, "Customer address": row.customerAddress || "" }));
      return normalizedExportRows([row]);
    });
    return lines;
  }

  function downloadRawWorkbook(rows, filename, sheetName = "Raw data") {
    downloadWorkbook(rawExportRows(rows), filename, sheetName, true);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadChart(chartId, filename) {
    const chart = state.charts.get(chartId);
    if (!chart) { toast("Chart unavailable", "Open the visual again before downloading it.", "error"); return; }
    const source = chart.canvas;
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = source.width * scale; canvas.height = (source.height + 70) * scale;
    const context = canvas.getContext("2d");
    context.scale(scale, scale); context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#121c2f"; context.font = "600 18px Inter, sans-serif"; context.fillText(filename, 20, 30);
    context.fillStyle = "#667085"; context.font = "12px Inter, sans-serif"; context.fillText(`${formatNumber(state.filtered.length)} shipments · exported ${new Date().toLocaleDateString("en-IN")}`, 20, 51);
    context.drawImage(source, 0, 70, source.width, source.height);
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${slugify(filename)}-${new Date().toISOString().slice(0, 10)}.png`); }, "image/png");
    toast("Chart image ready", "The PNG includes the title, scope, and visible legend.");
  }

  async function copyExportSummary(definition) {
    const text = `${definition.title}\nScope: ${state.filtered.length} of ${state.shipments.length} shipments\nComputed rows: ${definition.rows.length}\nExported: ${new Date().toLocaleString("en-IN")}`;
    try { await navigator.clipboard.writeText(text); toast("Summary copied", "Paste it into email, chat, or a review note."); }
    catch (_) { toast("Copy unavailable", "Your browser blocked clipboard access.", "error"); }
  }

  function exportMenuItems(definition) {
    return [
      ...(definition.type === "chart" ? [{ label: "Download chart image", hint: "PNG with title and legend", action: "download-image", icon: "image" }] : []),
      { label: definition.type === "chart" ? "Download summarized data" : "Download this computed table", hint: `${formatNumber(definition.rows.length)} exact result rows`, action: "download-view", icon: "download" },
      { label: "Download underlying raw data", hint: `${formatNumber(definition.raw.length)} shipment rows`, action: "download-raw", icon: "file" },
      { separator: true },
      { label: "Copy export summary", action: "copy-summary", icon: "copy" }
    ];
  }

  function handleMenuAction(action, context) {
    const definition = state.exports.get(context);
    if (action === "noop") { closeMenu(); return; }
    if (action === "sign-out") { signOut(); closeMenu(); return; }
    if (action === "global-filtered") { downloadRawWorkbook(state.filtered, "SHARV-filtered-raw-data", "Filtered raw"); closeMenu(); return; }
    if (action === "global-complete") { downloadRawWorkbook(state.shipments, "SHARV-complete-raw-data", "Complete raw"); closeMenu(); return; }
    if (action === "global-current") {
      const rows = state.currentTable?.rows || [];
      downloadWorkbook(rows, `SHARV-${state.currentTable?.name || "current-table"}`, "Computed table"); closeMenu(); return;
    }
    if (!definition) return;
    if (action === "download-image") downloadChart(definition.chartId, definition.title);
    if (action === "download-view") downloadWorkbook(definition.rows, `SHARV-${definition.title}`, definition.type === "chart" ? "Chart data" : "Computed table");
    if (action === "download-raw") downloadRawWorkbook(definition.raw, `SHARV-${definition.title}-raw`, "Underlying raw");
    if (action === "copy-summary") copyExportSummary(definition);
    closeMenu();
  }

  function openModal(content, wide = false) {
    const modal = $("#modal");
    modal.className = `modal${wide ? " wide" : ""}`;
    modal.innerHTML = content;
    $("#modalBackdrop").hidden = false;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => $("button, input, select, textarea", modal)?.focus(), 0);
  }

  function closeModal() {
    $("#modalBackdrop").hidden = true;
    $("#modal").hidden = true;
    $("#modal").innerHTML = "";
    document.body.style.overflow = "";
    state.uploadFile = null;
  }

  function openFilters() {
    const options = {
      couriers: [...new Set(state.shipments.map((row) => row.courier).filter(Boolean))].sort(),
      states: [...new Set(state.shipments.map((row) => row.state).filter(Boolean))].sort(),
      statuses: [...new Set(state.shipments.map((row) => row.statusGroup).filter(Boolean))].sort(),
      customers: [...new Set(state.shipments.map((row) => row.customer).filter(Boolean))].sort()
    };
    const lists = Object.entries(options).map(([key, values]) => `<div><span class="field-label">${escapeHtml({ couriers: "Courier", states: "State", statuses: "Status", customers: "Customer" }[key])}</span><div class="multi-list">${values.length ? `<label class="check-row select-all-row"><input type="checkbox" data-select-all="${key}" ${values.length && values.every((value) => state.filters[key].includes(value)) ? "checked" : ""}> Select all</label>${values.map((value) => `<label class="check-row"><input type="checkbox" data-filter-key="${key}" value="${escapeHtml(value)}" ${state.filters[key].includes(value) ? "checked" : ""}> ${escapeHtml(value)}</label>`).join("")}` : '<span class="subtle">No values available</span>'}</div></div>`).join("");
    openModal(`<header class="modal-head"><div><p class="eyebrow">Global scope</p><h2 id="modalTitle">Filter dashboard data</h2><p>These selections apply to every tab, SHARV’s filtered scope, and filtered downloads.</p></div><button class="icon-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button></header><div class="modal-body"><div class="filter-grid">${lists}</div><div class="builder-grid" style="margin-top:16px"><label class="field"><span>Order date from</span><input id="filterFrom" type="date" value="${escapeHtml(state.filters.from)}"></label><label class="field"><span>Order date to</span><input id="filterTo" type="date" value="${escapeHtml(state.filters.to)}"></label></div></div><footer class="modal-actions"><button class="button secondary" type="button" id="modalClearFilters">Clear all</button><button class="button primary" type="button" id="applyFilters">Apply filters</button></footer>`, true);
    $$('[data-select-all]', $("#modal")).forEach((toggle) => toggle.addEventListener("change", () => {
      $$(`[data-filter-key="${toggle.dataset.selectAll}"]`, $("#modal")).forEach((input) => { input.checked = toggle.checked; });
    }));
    $$('[data-filter-key]', $("#modal")).forEach((input) => input.addEventListener("change", () => {
      const key = input.dataset.filterKey;
      const all = $$(`[data-filter-key="${key}"]`, $("#modal"));
      const toggle = $(`[data-select-all="${key}"]`, $("#modal"));
      if (toggle) toggle.checked = all.length > 0 && all.every((item) => item.checked);
    }));
    $("#modalClearFilters").addEventListener("click", () => { closeModal(); clearFilters(); });
    $("#applyFilters").addEventListener("click", () => {
      ["couriers", "states", "statuses", "customers"].forEach((key) => { state.filters[key] = $$(`[data-filter-key="${key}"]:checked`, $("#modal")).map((input) => input.value); });
      state.filters.from = $("#filterFrom").value; state.filters.to = $("#filterTo").value;
      closeModal(); applyFilters(); renderRoute(); toast("Filters applied", `${formatNumber(state.filtered.length)} shipments remain in scope.`);
    });
  }

  function openUploadModal() {
    if (state.role !== "upload_admin") { toast("Upload restricted", "Only the two primary users can add or replace shipment data.", "error"); return; }
    openModal(`<header class="modal-head"><div><p class="eyebrow">Primary user access</p><h2 id="modalTitle">Upload shipment data</h2><p>Base Raw Data replaces the active dataset only after validation and atomic cloud finalization.</p></div><button class="icon-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button></header><div class="modal-body"><label class="field"><span>Data source</span><select id="uploadSource"><option value="Base Raw Data">Base Raw Data · replace active dataset</option><option value="ITL">ITL courier export · merge</option><option value="Blitz">Blitz courier export · merge</option><option value="Other">Other / normalized template · merge</option></select></label><div class="drop-zone" id="dropZone" role="button" tabindex="0">${icon("package")}<b>Drop an XLSX, XLS, or CSV file here</b><span>or click to choose a file · up to 25 MB</span></div><div id="selectedFile"></div><div class="risk-banner" style="margin:14px 0 0">${icon("check")}<div><b>Cloud access is policy-controlled</b><span>Only two UUID-based primary slots can write. All authenticated users can view and download.</span></div></div></div><footer class="modal-actions"><button class="button secondary" type="button" data-close-modal>Cancel</button><button class="button primary" type="button" id="startUpload" disabled>Validate & upload</button></footer>`);
    const zone = $("#dropZone");
    const choose = () => $("#fileInput").click();
    zone.addEventListener("click", choose);
    zone.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); choose(); } });
    zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("dragging"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
    zone.addEventListener("drop", (event) => { event.preventDefault(); zone.classList.remove("dragging"); selectUploadFile(event.dataTransfer.files[0]); });
    $("#startUpload").addEventListener("click", processUpload);
  }

  function selectUploadFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { toast("Unsupported file", "Choose an XLSX, XLS, or CSV workbook.", "error"); return; }
    if (file.size > 25 * 1024 * 1024) { toast("File is too large", "The current upload limit is 25 MB.", "error"); return; }
    state.uploadFile = file;
    const target = $("#selectedFile");
    if (target) target.innerHTML = `<div class="upload-file">${icon("file")}<div><b>${escapeHtml(file.name)}</b><small>${formatNumber(file.size / 1024 / 1024, 2)} MB · ready for validation</small></div></div>`;
    if ($("#startUpload")) $("#startUpload").disabled = false;
  }

  function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/[\n\r]+/g, " ").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  }

  function readAlias(row, ...aliases) {
    for (const alias of aliases) {
      const value = row[normalizeHeader(alias)];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return null;
  }

  function toIso(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0))).toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function titleCase(value) {
    return String(value || "").trim().toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\bNcr\b/g, "NCR");
  }

  function classifyStatus(status, remark = "") {
    const value = `${status} ${remark}`;
    if (/lost|damag/i.test(value)) return "Lost / Damaged";
    if (/cancel/i.test(value)) return "Cancelled";
    if (/rto/i.test(value)) return /deliver/i.test(value) ? "RTO Delivered" : "RTO In Progress";
    if (/^delivered$|successfully delivered/i.test(String(status).trim())) return "Delivered";
    if (/ndr|undeliver|failed attempt/i.test(value)) return "NDR / Undelivered";
    return "In Transit";
  }

  function normalizeUploadedRow(row, source, index) {
    const awbRaw = readAlias(row, "awb", "awb no", "awb number", "tracking id", "tracking number", "waybill") || row.__mapped_awb;
    const orderRaw = readAlias(row, "order id", "order number", "order no", "reference id", "client order id");
    if (!awbRaw && !orderRaw) return { error: `Row ${index + 1}: AWB and order ID are both missing.` };
    const status = String(readAlias(row, "order status", "status", "shipment status", "current status") || "In Transit").trim();
    const remark = String(readAlias(row, "remark", "remarks", "rto reason", "latest remark", "latest_remark", "reason") || "").trim();
    const pickupDate = toIso(readAlias(row, "pickup date", "order pickup date", "pickuptime", "picked up date"));
    const deliveredDate = toIso(readAlias(row, "delivered date", "order delivered date", "delivertime", "delivery date"));
    const edd = toIso(readAlias(row, "edd", "expected delivery date", "promised date", "sla date"));
    const orderDate = toIso(readAlias(row, "order date", "created at", "created date", "booking date")) || pickupDate || new Date().toISOString();
    const tatRaw = Number(readAlias(row, "tat", "tat days", "transit days"));
    const tat = Number.isFinite(tatRaw) && tatRaw >= 0 ? tatRaw : pickupDate && deliveredDate ? Math.max(0, (new Date(deliveredDate) - new Date(pickupDate)) / 864e5) : null;
    const targetRaw = Number(readAlias(row, "sla target", "sla days", "target days", "service target days"));
    const serviceTarget = Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : pickupDate && edd ? Math.max(1, Math.round((new Date(edd) - new Date(pickupDate)) / 864e5)) : null;
    const ageRaw = Number(readAlias(row, "ageing", "aging", "age", "ageing days"));
    const attemptsRaw = Number(readAlias(row, "attempt count", "delivery attempts", "delivery_attempts", "attempts"));
    const freightRaw = Number(readAlias(row, "freight charge (inr)", "total freight charge", "freight", "shipping charge", "freight inr"));
    const cityAliases = { Bangalore: "Bengaluru", "New Delhi": "Delhi", Gurgaon: "Gurugram", Bombay: "Mumbai" };
    const cityOriginal = titleCase(readAlias(row, "customer city", "shipping city", "shipping_city", "city", "destination city"));
    const city = cityAliases[cityOriginal] || cityOriginal || "Unknown";
    const fallbackStates = { Bengaluru: "Karnataka", Mysore: "Karnataka", Mumbai: "Maharashtra", Pune: "Maharashtra", Delhi: "Delhi", Gurugram: "Haryana", Hyderabad: "Telangana", Chennai: "Tamil Nadu", Kochi: "Kerala", Ahmedabad: "Gujarat", Kolkata: "West Bengal", Jaipur: "Rajasthan", Lucknow: "Uttar Pradesh" };
    const statusGroup = classifyStatus(status, remark);
    const direction = /rvp|dto|reverse|return pickup/i.test(`${status} ${remark}`) ? "RVP / DTO" : statusGroup.startsWith("RTO") ? "RTO" : "Forward";
    return { value: {
      id: `${source}-${String(awbRaw || orderRaw).trim()}`,
      source, awb: String(awbRaw || orderRaw).trim(), orderId: String(orderRaw || "").trim(),
      customer: titleCase(readAlias(row, "customer account", "merchant", "brand", "account", "client", "customer brand")) || "Unassigned customer",
      recipientName: titleCase(readAlias(row, "customer name", "recipient name", "shipping name", "consignee", "buyer name")) || "Not provided",
      customerAddress: String(readAlias(row, "customer address", "shipping address", "address", "delivery address") || "").trim(),
      courier: titleCase(readAlias(row, "courier company", "courier", "carrier", "logistics partner")) || source,
      city, state: titleCase(readAlias(row, "customer state", "shipping state", "state", "destination state")) || fallbackStates[city] || "Unknown",
      pincode: String(readAlias(row, "customer pincode", "shipping pincode", "shipping_pincode", "pincode", "postal code", "zip") || "").replace(/\.0$/, ""),
      warehouse: String(readAlias(row, "origin warehouse", "warehouse nick name", "warehouse name", "warehouse_name", "pickup warehouse") || "Unknown"),
      payment: titleCase(readAlias(row, "payment method", "payment type", "cod prepaid", "payment mode")) || "Unknown",
      mode: /air|flight/i.test(String(readAlias(row, "transport mode", "mode", "shipping mode") || status + remark)) ? "Air" : "Surface",
      direction, status, statusGroup, orderDate, pickupDate, deliveredDate, edd, tat, serviceTarget,
      age: Number.isFinite(ageRaw) && ageRaw >= 0 ? ageRaw : pickupDate && statusGroup !== "Delivered" ? Math.max(0, Math.floor((Date.now() - new Date(pickupDate)) / 864e5)) : null,
      attempts: Number.isFinite(attemptsRaw) && attemptsRaw >= 0 ? attemptsRaw : 0,
      freight: Number.isFinite(freightRaw) && freightRaw >= 0 ? freightRaw : null,
      ndrStatus: String(readAlias(row, "ndr status", "ndr", "delivery exception") || ""), remark,
      onTime: deliveredDate && edd ? new Date(deliveredDate) <= new Date(edd) : null,
      productName: String(readAlias(row, "product name", "product", "item name", "description", "product title") || "").trim(),
      sku: String(readAlias(row, "sku", "product sku", "seller sku", "item sku") || "").trim(),
      quantity: Math.max(0, Number(readAlias(row, "quantity", "qty", "item quantity", "units")) || 0),
      customerAddress: String(readAlias(row, "customer address", "shipping address", "address", "delivery address") || "").trim(),
      uploadBatch: null, rawPayload: row
    } };
  }

  async function parseWorkbook(file, source) {
    if (!window.XLSX) throw new Error("The workbook reader did not load. Check your connection and try again.");
    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true, dense: false });
    const accepted = [];
    const rawLines = [];
    const rejected = [];
    for (const sheetName of workbook.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
      const headerIndex = matrix.findIndex((row) => row?.some((cell) => /^(awb( no| number)?|tracking( id| number)?|waybill|order( id| no| number)?)$/i.test(String(cell).trim())));
      if (headerIndex < 0) continue;
      const headers = matrix[headerIndex].map(normalizeHeader);
      matrix.slice(headerIndex + 1).forEach((cells, rowIndex) => {
        if (!cells.some((cell) => String(cell).trim())) return;
        const raw = Object.fromEntries(headers.map((header, columnIndex) => [header, cells[columnIndex]]));
        rawLines.push({ ...raw, __sourceSheet: sheetName, __sourceRow: rowIndex + headerIndex + 2 });
      });
    }
    const orderAwbs = new Map();
    rawLines.forEach((line) => {
      const order = normalizeText(readAlias(line, "order id", "order number", "order no", "reference id", "client order id"));
      const awb = String(readAlias(line, "awb", "awb no", "awb number", "tracking id", "tracking number", "waybill") || "").trim();
      if (order && awb && !orderAwbs.has(order)) orderAwbs.set(order, awb);
    });
    const groups = new Map();
    let acceptedLineCount = 0;
    rawLines.forEach((line) => {
      const order = String(readAlias(line, "order id", "order number", "order no", "reference id", "client order id") || "").trim();
      const orderKey = normalizeText(order);
      const normalized = normalizeUploadedRow({ ...line, __mapped_awb: orderAwbs.get(orderKey) || "" }, source, Number(line.__sourceRow || 1));
      if (normalized.error) { rejected.push(normalized.error); return; }
      acceptedLineCount++;
      const row = normalized.value;
      const key = `${normalizeText(row.orderId || row.awb)}::${normalizeText(row.awb)}`;
      const group = groups.get(key);
      const rawRecord = Object.fromEntries(Object.entries(line).filter(([name]) => !name.startsWith("__")));
      if (!group) groups.set(key, { ...row, productItems: [], rawPayload: { ...row.rawPayload, __lineItems: [] } });
      const target = groups.get(key);
      target.productItems.push({ productName: row.productName, sku: row.sku, quantity: row.quantity });
      target.rawPayload.__lineItems.push(rawRecord);
      target.quantity = (target.quantity || 0) + row.quantity;
      if (row.productName || row.sku) target.products = [...new Set([...(target.products || []), row.productName || row.sku])];
    });
    if (!groups.size) throw new Error(rejected[0] || "No rows with an AWB or order ID were found. Check the workbook headers.");
    const rows = classifyCustomerOrders([...groups.values()]);
    const duplicateOrders = acceptedLineCount - rows.length;
    return { rows, rawLines, rejected, duplicates: duplicateOrders };
  }

  function toDbShipment(row, batchId = null) {
    return {
      source_system: row.source, awb: String(row.awb), order_id: String(row.orderId || ""),
      customer_account: row.customer, recipient_name: row.recipientName, courier: row.courier,
      city: row.city, state: row.state, pincode: row.pincode, warehouse: row.warehouse,
      payment_type: row.payment, transport_mode: row.mode, direction: row.direction,
      status: row.status, status_group: row.statusGroup, order_date: row.orderDate,
      pickup_date: row.pickupDate, delivered_date: row.deliveredDate, edd: row.edd,
      tat_days: row.tat, sla_target_days: row.serviceTarget, ageing_days: row.age,
      attempts: row.attempts, freight_inr: row.freight, ndr_status: row.ndrStatus,
      remark: row.remark, on_time: row.onTime, upload_batch_id: batchId, raw_payload: row.rawPayload || {}
    };
  }

  function fromDbShipment(row) {
    const sourceLines = row.raw_payload?.__lineItems || [];
    const productItems = sourceLines.map((line) => ({ productName: readAlias(line, "product name", "product", "item name", "description", "product title") || "", sku: readAlias(line, "sku", "product sku", "seller sku", "item sku") || "", quantity: Number(readAlias(line, "quantity", "qty", "item quantity", "units")) || 0 }));
    return classifyCustomerOrders([{
      id: row.id, source: row.source_system, awb: String(row.awb), orderId: String(row.order_id || ""),
      customer: row.customer_account || "Unassigned customer", recipientName: row.recipient_name || "Not provided",
      customerAddress: readAlias(sourceLines[0] || row.raw_payload || {}, "customer address", "shipping address", "address", "delivery address") || "",
      courier: row.courier || row.source_system, city: row.city || "Unknown", state: row.state || "Unknown", pincode: row.pincode || "",
      warehouse: row.warehouse || "Unknown", payment: row.payment_type || "Unknown", mode: row.transport_mode || "Surface",
      direction: row.direction || "Forward", status: row.status || "In Transit", statusGroup: row.status_group || classifyStatus(row.status, row.remark),
      orderDate: row.order_date, pickupDate: row.pickup_date, deliveredDate: row.delivered_date, edd: row.edd,
      tat: row.tat_days == null ? null : Number(row.tat_days), serviceTarget: row.sla_target_days == null ? null : Number(row.sla_target_days),
      age: row.ageing_days == null ? null : Number(row.ageing_days), attempts: Number(row.attempts || 0), freight: row.freight_inr == null ? null : Number(row.freight_inr),
      ndrStatus: row.ndr_status || "", remark: row.remark || "", onTime: row.on_time, uploadBatch: row.upload_batch_id, rawPayload: row.raw_payload,
      productItems, quantity: productItems.reduce((sum, item) => sum + item.quantity, 0), products: [...new Set(productItems.map((item) => item.productName || item.sku).filter(Boolean))]
    }])[0];
  }

  function classifyCustomerOrders(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      const address = row.customerAddress || readAlias(row.rawPayload || {}, "customer address", "shipping address", "address", "delivery address") || "";
      const key = row.recipientName && address ? normalizeText(`${row.recipientName} ${address}`) : "";
      row.customerKey = key;
      if (!key || key.includes("not provided")) { row.customerClass = "Unknown"; return; }
      groups.set(key, [...(groups.get(key) || []), row]);
    });
    groups.forEach((items) => {
      items.sort((a, b) => new Date(a.orderDate || 0) - new Date(b.orderDate || 0));
      items.forEach((row, index) => { row.customerClass = index === 0 ? "New Customer" : "Repeat Customer"; });
    });
    return rows;
  }

  async function processUpload() {
    if (!state.uploadFile) return;
    const button = $("#startUpload");
    button.disabled = true; button.textContent = "Validating workbook…";
    try {
      const source = $("#uploadSource")?.value || "ITL";
      const result = await parseWorkbook(state.uploadFile, source);
      if (state.demo) {
        if (source === "Base Raw Data") {
          state.shipments = classifyCustomerOrders(result.rows.map((row) => ({ ...row, uploadBatch: `Demo upload · ${state.uploadFile.name}` })));
          applyFilters(); closeModal(); renderRoute();
          toast("Base Raw Data replaced", `${formatNumber(result.rows.length)} consolidated orders now define the active demo dataset.`);
          return;
        }
        const map = new Map(state.shipments.map((row) => [`${row.source}::${row.awb}`, row]));
        result.rows.forEach((row) => map.set(`${row.source}::${row.awb}`, { ...row, uploadBatch: `Demo upload · ${state.uploadFile.name}` }));
        state.shipments = [...map.values()]; state.dataUpdatedAt = new Date(); applyFilters(); closeModal(); renderRoute();
        toast("Upload complete", `${formatNumber(result.rows.length)} accepted, ${formatNumber(result.duplicates)} duplicate${result.duplicates === 1 ? "" : "s"} replaced, ${formatNumber(result.rejected.length)} rejected.`);
        return;
      }
      let oldBasePaths = [];
      let staleRawFileWarning = false;
      if (source === "Base Raw Data") {
        const { data: oldBatches, error: oldBatchError } = await state.supabase.from("upload_batches").select("object_path").eq("source_system", "Base Raw Data").eq("status", "completed");
        if (oldBatchError) throw new Error("Could not verify the active Base Raw Data version before replacement: " + oldBatchError.message);
        oldBasePaths = (oldBatches || []).map((item) => item.object_path).filter(Boolean);
      }
      button.textContent = "Saving original file…";
      const { data: batch, error: batchError } = await state.supabase.from("upload_batches").insert({ source_system: source, original_filename: state.uploadFile.name, file_size_bytes: state.uploadFile.size, status: "processing", uploaded_by: state.user.id }).select().single();
      if (batchError) throw batchError;
      const safeFilename = state.uploadFile.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const objectPath = `${state.user.id}/${batch.id}/${safeFilename}`;
      const { error: storageError } = await state.supabase.storage.from("raw-uploads").upload(objectPath, state.uploadFile, { upsert: false, contentType: state.uploadFile.type || "application/octet-stream" });
      if (storageError) throw storageError;
      if (source === "Base Raw Data") {
        button.textContent = "Staging replacement data…";
        for (let index = 0; index < result.rows.length; index += 300) {
          const chunk = result.rows.slice(index, index + 300).map((row) => toDbShipment(row, batch.id));
          const { error } = await state.supabase.rpc("stage_shipment_upload", { p_batch_id: batch.id, p_rows: chunk });
          if (error) throw new Error(`Base Raw Data replacement needs the current Supabase upload migration: ${error.message}`);
          button.textContent = `Staging ${Math.min(index + 300, result.rows.length)} of ${result.rows.length}…`;
        }
        button.textContent = "Finalizing replacement…";
        const { error } = await state.supabase.rpc("finalize_base_raw_upload", { p_batch_id: batch.id, p_accepted: result.rows.length, p_rejected: result.rejected.length, p_duplicates: result.duplicates, p_object_path: objectPath });
        if (error) throw new Error(`Base Raw Data could not be atomically replaced: ${error.message}`);
        if (oldBasePaths.length) {
          const { error: removeError } = await state.supabase.storage.from("raw-uploads").remove(oldBasePaths);
          if (removeError) { staleRawFileWarning = true; console.warn("Base dataset replaced, but an older private source file could not be purged", removeError); }
        }
        state.shipments = result.rows.map((row) => ({ ...row, uploadBatch: batch.id }));
      } else {
        for (let index = 0; index < result.rows.length; index += 500) {
          const chunk = result.rows.slice(index, index + 500).map((row) => toDbShipment(row, batch.id));
          const { error } = await state.supabase.from("shipments").upsert(chunk, { onConflict: "source_system,awb" });
          if (error) throw error;
          button.textContent = `Saving ${Math.min(index + 500, result.rows.length)} of ${result.rows.length}…`;
        }
        button.textContent = "Finalizing upload…";
        const { error } = await state.supabase.from("upload_batches").update({ status: "completed", object_path: objectPath, accepted_rows: result.rows.length, rejected_rows: result.rejected.length, duplicate_rows: result.duplicates, completed_at: new Date().toISOString(), error_summary: result.rejected.slice(0, 50) }).eq("id", batch.id);
        if (error) throw error;
        const map = new Map(state.shipments.map((row) => [`${row.source}::${row.awb}`, row]));
        result.rows.forEach((row) => map.set(`${row.source}::${row.awb}`, { ...row, uploadBatch: batch.id }));
        state.shipments = classifyCustomerOrders([...map.values()]);
      }
      state.dataUpdatedAt = new Date(); applyFilters(); closeModal(); renderRoute();
      toast("Upload complete", `${formatNumber(result.rows.length)} consolidated shipments saved; ${formatNumber(result.rawLines.length)} source lines retained. Refreshing shared data in the background.`);
      if (staleRawFileWarning) toast("Prior source file cleanup needs review", "The new Base Raw Data is active, but Supabase did not remove every previous file. Review private raw-uploads storage.", "error");
      loadCloudState().then(() => renderRoute()).catch((refreshError) => {
        console.warn("Upload succeeded; dashboard refresh is pending", refreshError);
        toast("Upload saved", "The upload completed. Shared data refresh is still pending; reload the page if the latest rows do not appear.", "error");
      });
    } catch (error) {
      console.error(error); if (button?.isConnected) { button.disabled = false; button.textContent = "Validate & upload"; }
      toast("Upload failed", error.message || "The workbook could not be processed.", "error");
    }
  }

  async function loadCloudState() {
    const access = await state.supabase.rpc("get_my_access");
    if (access.error) throw access.error;
    const accessRow = Array.isArray(access.data) ? access.data[0] : access.data;
    state.role = accessRow?.is_upload_admin ? "upload_admin" : "viewer";
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await state.supabase.from("shipments").select("id,source_system,awb,order_id,customer_account,recipient_name,courier,city,state,pincode,warehouse,payment_type,transport_mode,direction,status,status_group,order_date,pickup_date,delivered_date,edd,tat_days,sla_target_days,ageing_days,attempts,freight_inr,ndr_status,remark,on_time,upload_batch_id,raw_payload").order("order_date", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 999);
      if (error) throw error;
      rows.push(...data.map(fromDbShipment));
      if (data.length < 1000) break;
    }
    state.shipments = classifyCustomerOrders(rows);
    const [{ data: views, error: viewsError }, { data: rules, error: rulesError }, { data: batches }] = await Promise.all([
      state.supabase.from("saved_views").select("id,name,definition,is_default,updated_at").order("updated_at", { ascending: false }),
      state.supabase.from("sla_rules").select("*").eq("active", true),
      state.supabase.from("upload_batches").select("completed_at").eq("status", "completed").order("completed_at", { ascending: false }).limit(1)
    ]);
    if (viewsError) throw viewsError;
    if (rulesError) throw rulesError;
    state.savedViews = (views || []).map((view) => ({ id: view.id, name: view.name, definition: view.definition, updatedAt: view.updated_at, isDefault: view.is_default }));
    state.slaRules = (rules || []).map((rule) => ({ courier: rule.courier, customer: rule.customer_account, state: rule.state, city: rule.city, targetDays: Number(rule.target_days), serviceLevel: rule.service_level, effectiveFrom: rule.effective_from, effectiveTo: rule.effective_to }));
    state.dataUpdatedAt = batches?.[0]?.completed_at ? new Date(batches[0].completed_at) : new Date();
    applyFilters();
    $("#exceptionBadge").textContent = metrics(state.shipments).exceptions;
  }

  async function signOut() {
    if (state.supabase) await state.supabase.auth.signOut();
    location.reload();
  }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool || window.__sharvWebMcpRegistered) return;
    window.__sharvWebMcpRegistered = true;
    const register = (tool) => {
      try { void Promise.resolve(context.registerTool(tool)).catch((error) => console.warn("WebMCP registration failed", error)); }
      catch (error) { console.warn("WebMCP registration failed", error); }
    };
    register({
      name: "lookup_shipments",
      title: "Look up shipments",
      description: "Find multiple shipments by exact AWB or order ID in the data currently authorized for the signed-in SHARV user.",
      inputSchema: { type: "object", properties: { identifiers: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", minLength: 1 } } }, required: ["identifiers"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        if (!input || !Array.isArray(input.identifiers) || !input.identifiers.length || input.identifiers.length > 50) throw new Error("identifiers must contain 1–50 AWBs or order IDs");
        const results = input.identifiers.map((identifier) => {
          const key = normalizeText(identifier).replace(/ /g, "");
          const matches = state.shipments.filter((row) => normalizeText(row.awb).replace(/ /g, "") === key || normalizeText(row.orderId).replace(/ /g, "") === key);
          return { identifier, matches: matches.map((row) => ({ awb: row.awb, orderId: row.orderId, status: row.statusGroup, courier: row.courier, customer: row.customer, city: row.city, state: row.state, edd: row.edd, attempts: row.attempts })) };
        });
        return { requested: input.identifiers.length, matched: results.filter((item) => item.matches.length).length, results };
      }
    });
    register({
      name: "get_sla_insight",
      title: "Get SLA insight",
      description: "Calculate observed SLA compliance, TAT, RTO, and sample size for an optional courier, customer, state, and city scope.",
      inputSchema: { type: "object", properties: { courier: { type: "string" }, customer: { type: "string" }, state: { type: "string" }, city: { type: "string" }, useDashboardFilters: { type: "boolean" } }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input = {}) {
        let rows = input.useDashboardFilters ? state.filtered : state.shipments;
        for (const [key, field] of [["courier", "courier"], ["customer", "customer"], ["state", "state"], ["city", "city"]]) if (input[key]) rows = rows.filter((row) => normalizeText(row[field]).includes(normalizeText(input[key])));
        const result = metrics(rows);
        return { shipments: rows.length, delivered: result.delivered, slaCompliance: result.onTimeRate, averageTatDays: result.avgTat, p90TatDays: result.p90Tat, rtoRate: result.rtoRate, openShipments: result.open, definition: "On or before EDD unless a matching contractual SLA rule is configured." };
      }
    });
    register({
      name: "open_custom_studio",
      title: "Open Custom Studio",
      description: "Navigate the visible SHARV workspace to Custom Studio so the user can configure and save a reusable table, pivot, or chart.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() { navigate("studio"); return { opened: true, route: "studio" }; }
    });
  }

  function renderNoData() {
    $("#page").innerHTML = `<article class="card empty-state"><div><span class="empty-icon">${icon("package")}</span><h3>No shipments in this scope</h3><p>Clear the active filters or ask a primary user to upload the latest courier file.</p><button class="button secondary" type="button" id="emptyClear">Clear filters</button></div></article>`;
    $("#emptyClear")?.addEventListener("click", clearFilters);
  }

  function renderPlaceholder(route) {
    $("#page").innerHTML = `<div class="page-intro"><div><p class="eyebrow">${escapeHtml(ROUTES[route].kicker)}</p><h2>${escapeHtml(ROUTES[route].title)}</h2><p>This workspace is being connected to the current shipment scope.</p></div></div><article class="card empty-state"><div><span class="empty-icon">${icon(route === "sharv" ? "spark" : "trend")}</span><h3>${escapeHtml(ROUTES[route].title)} is next</h3><p>The core control-tower shell is live. This view will keep the same filters, exports, and role rules.</p><button class="button secondary" type="button" data-route="overview">Back to overview</button></div></article>`;
  }

  function applyFilters() {
    const f = state.filters;
    state.filtered = state.shipments.filter((row) =>
      (!f.couriers.length || f.couriers.includes(row.courier)) &&
      (!f.states.length || f.states.includes(row.state)) &&
      (!f.statuses.length || f.statuses.includes(row.statusGroup)) &&
      (!f.customers.length || f.customers.includes(row.customer)) &&
      (!f.from || (row.orderDate || "").slice(0, 10) >= f.from) &&
      (!f.to || (row.orderDate || "").slice(0, 10) <= f.to)
    );
    updateScopeBar();
  }

  function activeFilterCount() {
    return ["couriers", "states", "statuses", "customers"].reduce((sum, key) => sum + state.filters[key].length, 0) + Number(Boolean(state.filters.from)) + Number(Boolean(state.filters.to));
  }

  function updateScopeBar() {
    const count = activeFilterCount();
    const chips = [];
    ["couriers", "states", "statuses", "customers"].forEach((key) => state.filters[key].forEach((value) => chips.push(`<span class="chip">${escapeHtml(value)}</span>`)));
    if (state.filters.from || state.filters.to) chips.push(`<span class="chip">${escapeHtml(state.filters.from || "Start")} → ${escapeHtml(state.filters.to || "Today")}</span>`);
    $("#filterChips").innerHTML = chips.length ? chips.join("") : '<span class="chip neutral">All shipments</span>';
    $("#scopeCount").textContent = `${formatNumber(state.filtered.length)} of ${formatNumber(state.shipments.length)} shipments`;
    $("#scopeDate").textContent = state.filters.from || state.filters.to ? `${state.filters.from || "Start"} – ${state.filters.to || "Today"}` : "All dates";
    $("#filterCount").hidden = count === 0;
    $("#filterCount").textContent = count;
    $("#clearFilters").hidden = count === 0;
  }

  function clearFilters() {
    state.filters = { couriers: [], states: [], statuses: [], customers: [], from: "", to: "" };
    applyFilters();
    renderRoute();
  }

  function navigate(route, push = true) {
    if (!ROUTES[route]) return;
    if (state.route !== route && ["exceptions", "shipments"].includes(route)) { state.tableQuery = ""; state.tablePage = 1; }
    state.route = route;
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.route === route));
    $("#pageKicker").textContent = ROUTES[route].kicker;
    $("#pageTitle").textContent = ROUTES[route].title;
    $("#sidebar").classList.remove("open");
    $("#sidebarScrim").hidden = true;
    if (push) history.replaceState(null, "", `#${route}`);
    renderRoute();
    $("#page").focus({ preventScroll: true });
  }

  function renderRoute() {
    destroyCharts();
    if (state.route === "overview") renderOverview();
    else if (state.route === "performance") renderPerformance();
    else if (state.route === "exceptions") renderExceptions();
    else if (state.route === "shipments") renderShipments();
    else if (state.route === "insights") renderInsights();
    else if (state.route === "studio") renderStudio();
    else if (state.route === "sharv") renderSharv();
    else renderPlaceholder(state.route);
  }

  function openMenu(anchor, items, context = anchor.dataset.menu || "") {
    const menu = $("#menuPopover");
    menu.innerHTML = items.map((item) => item.separator ? '<div class="menu-separator"></div>' : `<button class="menu-item ${item.danger ? "danger" : ""}" role="menuitem" type="button" data-action="${escapeHtml(item.action)}">${icon(item.icon || "download")}<span>${escapeHtml(item.label)}${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ""}</span></button>`).join("");
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = 235;
    const left = Math.min(window.innerWidth - width - 10, Math.max(10, rect.right - width));
    const top = Math.min(window.innerHeight - menu.offsetHeight - 10, rect.bottom + 6);
    Object.assign(menu.style, { left: `${left}px`, top: `${Math.max(10, top)}px` });
    menu.dataset.context = context;
    menu.querySelector("button")?.focus();
  }

  function closeMenu() {
    $("#menuPopover").hidden = true;
    $("#menuPopover").innerHTML = "";
  }

  function toast(title, message, type = "success") {
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.innerHTML = `${icon(type === "success" ? "check" : type === "error" ? "alert" : "clock")}<div><b>${escapeHtml(title)}</b><span>${escapeHtml(message)}</span></div><button aria-label="Dismiss">${icon("close")}</button>`;
    $("#toastRegion").append(item);
    const remove = () => item.remove();
    $("button", item).addEventListener("click", remove);
    setTimeout(remove, 4400);
  }

  function setupEvents() {
    document.addEventListener("click", (event) => {
      const menuAction = event.target.closest("#menuPopover [data-action]");
      if (menuAction) { handleMenuAction(menuAction.dataset.action, $("#menuPopover").dataset.context); return; }
      const closeButton = event.target.closest("[data-close-modal]");
      if (closeButton) { closeModal(); return; }
      const shipmentButton = event.target.closest("[data-shipment]");
      if (shipmentButton) { openShipmentDetail(shipmentButton.dataset.shipment); return; }
      const uploadTrigger = event.target.closest("[data-open-upload]");
      if (uploadTrigger) { openUploadModal(); return; }
      const askShipment = event.target.closest("[data-ask-shipment]");
      if (askShipment) { const awb = askShipment.dataset.askShipment; closeModal(); navigate("sharv"); setTimeout(() => askSharv(`Tell me everything about ${awb}`), 50); return; }
      const routeButton = event.target.closest("[data-route]");
      if (routeButton) { navigate(routeButton.dataset.route); return; }
      const menuButton = event.target.closest("[data-menu]");
      if (menuButton) {
        const definition = state.exports.get(menuButton.dataset.menu);
        if (definition) openMenu(menuButton, exportMenuItems(definition));
        event.stopPropagation(); return;
      }
      if (!event.target.closest("#menuPopover")) closeMenu();
    });
    $("#mobileMenu").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#sidebarScrim").hidden = false; });
    $("#sidebarClose").addEventListener("click", () => { $("#sidebar").classList.remove("open"); $("#sidebarScrim").hidden = true; });
    $("#sidebarScrim").addEventListener("click", () => { $("#sidebar").classList.remove("open"); $("#sidebarScrim").hidden = true; });
    $("#clearFilters").addEventListener("click", clearFilters);
    $("#commandButton").addEventListener("click", () => navigate("sharv"));
    $("#filterButton").addEventListener("click", openFilters);
    $("#uploadButton").addEventListener("click", openUploadModal);
    $("#exportButton").addEventListener("click", (event) => openMenu(event.currentTarget, [
      { label: activeFilterCount() ? "Download filtered raw data" : "Download complete raw data", hint: `${formatNumber(state.filtered.length)} shipment rows`, action: activeFilterCount() ? "global-filtered" : "global-complete", icon: "file" },
      ...(activeFilterCount() ? [{ label: "Download complete raw data", hint: `${formatNumber(state.shipments.length)} authorized rows`, action: "global-complete", icon: "file" }] : []),
      { label: "Download current computed table", hint: `${formatNumber(state.currentTable?.rows?.length || 0)} result rows`, action: "global-current", icon: "download" }
    ], "global"));
    $("#userMenuButton").addEventListener("click", (event) => openMenu(event.currentTarget, [
      { label: state.user?.email || "Current account", hint: state.role === "upload_admin" ? "Primary · Upload access" : "Viewer · Download access", action: "noop", icon: "package" },
      { separator: true },
      { label: "Sign out", action: "sign-out", icon: "close", danger: true }
    ], "user"));
    $("#modalBackdrop").addEventListener("click", closeModal);
    $("#fileInput").addEventListener("change", (event) => selectUploadFile(event.target.files[0]));
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); navigate("sharv"); }
      if (event.key === "Escape") { if (!$("#modal").hidden) closeModal(); else closeMenu(); }
    });
  }

  function showApp() {
    $("#authScreen").hidden = true;
    $("#appShell").hidden = false;
    $("#floatingSharv").hidden = false;
    const displayName = state.user?.user_metadata?.full_name || state.user?.email?.split("@")[0] || "Demo user";
    const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    $("#userName").textContent = displayName;
    $("#userAvatar").textContent = initials || "DU";
    $("#userRole").textContent = state.role === "upload_admin" ? "Primary · Upload access" : "Viewer · Download access";
    $("#uploadButton").hidden = state.role !== "upload_admin";
    $("#sidebarSync").textContent = state.demo ? "Demo data" : `Updated ${formatDate(state.dataUpdatedAt, { short: true })}`;
    const route = location.hash.slice(1);
    navigate(ROUTES[route] ? route : "overview", false);
    registerWebMcpTools();
  }

  async function boot() {
    setupEvents();
    state.dataUpdatedAt = new Date();
    const hasSupabaseConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
    if (!hasSupabaseConfig) {
      state.demo = true;
      state.role = "upload_admin";
      state.user = { email: "demo@sharv.local", user_metadata: { full_name: "Demo User" } };
      state.shipments = generateDemoShipments();
      state.slaRules = [
        { courier: "Delhivery", city: "Pune", state: "Maharashtra", customer: "Aarav Retail", targetDays: 3, serviceLevel: "standard surface" },
        { courier: "Blitz", city: "Bengaluru", state: "Karnataka", customer: "Blue Mango", targetDays: 2, serviceLevel: "priority local" },
        { courier: "Blue Dart", targetDays: 3, serviceLevel: "national standard" }
      ];
      ensureDemoViews();
      state.filtered = [...state.shipments];
      $("#exceptionBadge").textContent = metrics(state.shipments).exceptions;
      updateScopeBar();
      showApp();
      return;
    }
    if (!window.supabase?.createClient) {
      $("#authScreen").hidden = false;
      $("#authError").textContent = "The secure sign-in service could not load. Check your connection and try again.";
      return;
    }
    state.supabase = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { global: { fetch: boundedFetch } });
    const { data } = await state.supabase.auth.getSession();
    if (!data.session) {
      $("#authScreen").hidden = false;
      return;
    }
    state.user = data.session.user;
    try {
      await loadCloudState();
      showApp();
    } catch (error) {
      console.error(error);
      $("#authScreen").hidden = false;
      $("#authError").textContent = "You are signed in, but the cloud data could not be loaded. Confirm the database setup and try again.";
    }
  }

  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.supabase) return;
    $("#authError").textContent = "";
    const submit = event.submitter;
    submit.disabled = true;
    const { data, error } = await state.supabase.auth.signInWithPassword({ email: $("#authEmail").value.trim(), password: $("#authPassword").value });
    submit.disabled = false;
    if (error) { $("#authError").textContent = error.message; return; }
    state.user = data.user;
    try {
      await loadCloudState();
      showApp();
    } catch (loadError) {
      console.error(loadError);
      $("#authError").textContent = "Sign-in succeeded, but the workspace data could not be loaded. Ask an administrator to verify the Supabase schema.";
    }
  });

  boot().catch((error) => {
    console.error(error);
    $("#authScreen").hidden = false;
    $("#authError").textContent = "SHARV could not start. Refresh the page or contact your administrator.";
  });
})();
