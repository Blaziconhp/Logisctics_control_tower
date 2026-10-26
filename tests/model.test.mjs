import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRow,
  normalizeStatus,
  parseDate,
  csv,
  TERMINAL,
  escapeHtml,
} from "../lib/model.mjs";
test("exact four terminal statuses, numeric and text normalization", () => {
  for (const [code, status] of [
    [7, "Delivered"],
    [10, "RTO Delivered"],
    [12, "Lost"],
    [25, "Damaged"],
  ]) {
    assert.equal(normalizeStatus(code), status);
    assert(TERMINAL.has(status));
  }
  assert(!TERMINAL.has("Cancelled"));
  assert(!TERMINAL.has("Destroyed"));
  assert.equal(normalizeStatus("rto_delivered"), "RTO Delivered");
  assert.equal(normalizeStatus("Undelivered"), "Undelivered");
});
test("Shiprocket columns preserve identifiers, no invented dates or destinations", () => {
  const { value: r } = normalizeRow(
    [
      "AWB Code",
      "Channel Order ID",
      "Shiprocket Order ID",
      "Shipping City",
      "Shipment Status",
      "Product Quantity",
      "Unexpected Column",
    ],
    ["001234567890123456", "00079", "54321", "Pune", "7", "2", "keep me"],
    "Orders",
    8,
  );
  assert.equal(r.awb, "001234567890123456");
  assert.equal(r.order_id, "00079");
  assert.equal(r.provider_order_id, "54321");
  assert.equal(r.status, "Delivered");
  assert.equal(r.state, null);
  assert.equal(r.order_date, null);
  assert.deepEqual(r.source_refs, [{ sheet: "Orders", row: 8 }]);
});
test("missing AWB uses distinct order key; missing identifiers returns a visible rejection", () => {
  assert.equal(
    normalizeRow(["Order ID"], ["0001"], "Orders", 2).value.shipment_key,
    "order:0001",
  );
  assert.match(normalizeRow(["foo"], ["bar"], "Orders", 4).error, /row 4/);
});
test("dates have explicit India timezone and ambiguous formats are not guessed", () => {
  assert.equal(parseDate("26/10/2026 10:00"), "2026-10-26T04:30:00.000Z");
  assert.equal(parseDate("2026-10-26"), "2026-10-25T18:30:00.000Z");
  assert.equal(parseDate("2026-10-26T10:00:00Z"), "2026-10-26T10:00:00.000Z");
  assert.equal(parseDate("10/26/26"), null);
  assert.equal(parseDate("not a date"), null);
});
test("CSV quotes raw values and neutralizes executable spreadsheet cells", () => {
  const out = csv([
    { awb: "00001", name: '=HYPERLINK("bad")', city: "Pune, MH" },
  ]);
  assert(out.includes('"00001"'));
  assert(out.includes('"\'=HYPERLINK(""bad"")"'));
  assert(out.includes('"Pune, MH"'));
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
});

test("documented tracking timestamp and uppercase statuses", () => {
  assert.equal(parseDate("23 05 2023 11:43:52"), "2023-05-23T06:13:52.000Z");
  assert.equal(normalizeStatus("IN TRANSIT"), "In Transit");
  assert.equal(normalizeStatus("RTO INITIATED"), "RTO Initiated");
});

test("impossible calendar dates are rejected", () => {
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseDate("2026-02-30"), null);
});

test("filtered raw export includes headings and matched rows only", async () => {
  const { selectSourceRows } = await import("../lib/model.mjs");
  const matrix = [
    ["Report"],
    ["AWB", "Raw"],
    ["0001", "unmatched"],
    ["0002", "matched"],
  ];
  assert.deepEqual(selectSourceRows(matrix, [{ row: 4, header_row: 2 }]), [
    matrix[0],
    matrix[1],
    matrix[3],
  ]);
  assert.throws(
    () => selectSourceRows(matrix, [{ row: 4 }]),
    /heading reference missing/,
  );
});
