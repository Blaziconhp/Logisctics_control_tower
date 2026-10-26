export const TERMINAL = new Set([
  "Delivered",
  "RTO Delivered",
  "Lost",
  "Damaged",
]);
export const STATUS_CODES = {
  7: "Delivered",
  10: "RTO Delivered",
  12: "Lost",
  25: "Damaged",
  6: "Shipped",
  17: "Out For Delivery",
  18: "In Transit",
  21: "Undelivered",
  9: "RTO Initiated",
  8: "Cancelled",
};
export function normalizeStatus(value) {
  const text = String(value ?? "").trim();
  if (STATUS_CODES[text]) return STATUS_CODES[text];
  if (/^rto[ _-]*delivered$/i.test(text)) return "RTO Delivered";
  if (/^delivered$/i.test(text)) return "Delivered";
  if (/^lost$/i.test(text)) return "Lost";
  if (/^damaged$/i.test(text)) return "Damaged";
  const labels = {
    "in transit": "In Transit",
    "out for delivery": "Out For Delivery",
    undelivered: "Undelivered",
    "rto initiated": "RTO Initiated",
    "rto in transit": "RTO In Transit",
    cancelled: "Cancelled",
    destroyed: "Destroyed",
    shipped: "Shipped",
    "picked up": "Picked Up",
  };
  return labels[text.toLowerCase().replace(/[_-]/g, " ")] || text || "Unknown";
}
export const header = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function normalizeRow(headers, cells, sheet, rowNumber) {
  const source = new Map(headers.map((h, i) => [header(h), cells[i]]));
  const get = (...keys) => {
    for (const key of keys) {
      const v = source.get(header(key));
      if (v !== undefined && v !== null && String(v).trim() !== "")
        return String(v).trim();
    }
    return null;
  };
  const number = (...keys) => {
    const v = get(...keys);
    const n = v === null ? null : Number(v.replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const date = (...keys) => parseDate(get(...keys));
  const awb = get("awb", "awb code", "awb number", "awb no", "tracking number");
  const order_id = get(
    "channel order id",
    "order id",
    "order number",
    "channel order number",
  );
  if (!awb && !order_id)
    return {
      error: `${sheet}, row ${rowNumber}: missing AWB and merchant order ID`,
    };
  const status = normalizeStatus(
    get("shipment status", "current status", "status", "order status"),
  );
  return {
    value: {
      shipment_key: awb ? `awb:${awb}` : `order:${order_id}`,
      awb,
      order_id,
      provider_order_id: get("shiprocket order id"),
      provider_shipment_id: get("shiprocket shipment id", "shipment id"),
      courier: get("courier company", "courier name", "courier"),
      customer: get("customer account", "channel name", "brand", "merchant"),
      recipient: get("customer name", "recipient name", "shipping name"),
      city: get("shipping city", "customer city", "city"),
      state: get("shipping state", "customer state", "state"),
      pincode: get("shipping pincode", "customer pincode", "pincode"),
      payment: get("payment method", "payment type"),
      warehouse: get("pickup address name", "warehouse name", "warehouse"),
      status,
      order_date: date("order date", "created at", "created date"),
      pickup_date: date("pickup date", "shipped date"),
      delivered_date: date("delivered date", "delivery date"),
      edd: date("edd", "estimated delivery date", "expected delivery date"),
      status_at: date("status updated at", "last updated at", "updated at"),
      freight: number(
        "total shipping charge",
        "freight charge",
        "shipping charges",
        "freight",
      ),
      attempts: number("delivery attempts", "attempts"),
      product: get("product name", "product names"),
      sku: get("sku", "product sku"),
      quantity: number("quantity", "product quantity", "qty"),
      remark: get("rto reason", "ndr reason", "remarks", "remark"),
      source_refs: [{ sheet, row: rowNumber }],
    },
  };
}
// Shiprocket reports are interpreted in India time; ambiguous free-form dates are rejected.
export function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date)
    return Number.isNaN(+value) ? null : value.toISOString();
  const s = String(value).trim();
  if (/^\d{5}(\.\d+)?$/.test(s))
    return new Date((Number(s) - 25569) * 86400000).toISOString();
  let iso = s;
  const indian = s.match(
    /^(\d{2})[ /-](\d{2})[ /-](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (indian)
    iso = `${indian[3]}-${indian[2]}-${indian[1]}T${indian[4] || "00"}:${indian[5] || "00"}:${indian[6] || "00"}+05:30`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s + "T00:00:00+05:30";
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s))
    iso = s.replace(" ", "T") + "+05:30";
  else if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const parts = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (parts) {
    const probe = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
    if (
      probe.getUTCFullYear() !== +parts[1] ||
      probe.getUTCMonth() !== +parts[2] - 1 ||
      probe.getUTCDate() !== +parts[3]
    )
      return null;
  }
  const d = new Date(iso);
  return Number.isNaN(+d) ? null : d.toISOString();
}
export const escapeHtml = (v) =>
  String(v ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function csv(rows, columns = Object.keys(rows[0] || {})) {
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  return (
    "\ufeff" +
    [
      columns,
      ...rows.map((r) =>
        columns.map((c) =>
          typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c],
        ),
      ),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}

export function selectSourceRows(matrix, refs) {
  const selected = new Set(refs.map((r) => r.row));
  const headerRow = refs[0]?.header_row;
  if (!Number.isInteger(headerRow) || headerRow < 1)
    throw new Error(
      "Source heading reference missing; download the original file instead.",
    );
  return matrix.filter((_, i) => i < headerRow || selected.has(i + 1));
}
