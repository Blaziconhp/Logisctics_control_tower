import test from "node:test";
import assert from "node:assert/strict";
import {
  enrich,
  matches,
  metrics,
  percentile,
  findIdentifiers,
  day,
} from "../lib/analytics.mjs";
import { normalizeRow } from "../lib/model.mjs";
import { runImport } from "./import-helper.mjs";
import { customResult } from "../lib/views.mjs";
const now = new Date("2026-10-26T09:00:00Z");
test("actual report headers map Shiprocket order date, destinations, master courier and products", () => {
  const r = normalizeRow(
    [
      "Order ID",
      "AWB Code",
      "Shiprocket Created At",
      "Channel Created At",
      "Address City",
      "Address State",
      "Master Courier",
      "Courier Company",
      "Pickedup Timestamp",
      "Order Delivered Date",
      "EDD",
      "Attempt Count",
      "Channel SKU",
      "Product Quantity",
      "Latest NDR Reason",
      "Status",
    ],
    [
      "ORDER#1",
      "N/A",
      "2026-10-23 23:00:00",
      "2025-01-01",
      "Pune",
      "MH",
      "Blue Dart",
      "Air",
      "2026-10-23 23:30:00",
      "2026-10-24 19:00:00",
      "2026-10-24 00:00:00",
      "2",
      "sku1",
      "4",
      "Closed",
      "UNDELIVERED-2nd Attempt",
    ],
    "Sheet",
    2,
  ).value;
  assert.equal(r.awb, null);
  assert.equal(r.shipment_key, "order:ORDER#1");
  assert.equal(day(r.order_date), "2026-10-23");
  assert.equal(r.city, "Pune");
  assert.equal(r.state, "MH");
  assert.equal(r.details.master_courier, "Blue Dart");
  assert.equal(r.attempts, 2);
  assert.equal(r.details.lines[0].sku, "sku1");
  assert.equal(r.status, "Undelivered");
});
test("multi-product quantities and long identifiers survive real worker parsing", async () => {
  const r = await runImport(
    Buffer.from(
      "Order ID,AWB Code,Product Name,Channel SKU,Product Quantity\nA,N/A,One,S1,2\nB,N/A,Two,S2,1\nC,000123456789012345,One,S1,2\nC,000123456789012345,Two,S2,2\n",
    ),
  );
  assert.equal(r.rows.length, 3);
  const c = r.rows.find((r) => r.order_id === "C");
  assert.equal(c.awb, "000123456789012345");
  assert.equal(c.quantity, 4);
  assert.equal(c.details.lines.length, 2);
  assert.equal(c.product, "One; Two");
  assert.equal(r.errors.length, 0);
});
test("on time comparisons use India dates; SLA retains elapsed timestamp and percentile interpolation", () => {
  const [r] = enrich(
    [
      {
        status: "Delivered",
        order_date: "2026-10-22T20:00:00Z",
        pickup_date: "2026-10-23T17:00:00Z",
        delivered_date: "2026-10-24T15:00:00Z",
        edd: "2026-10-23T18:30:00Z",
      },
    ],
    now,
  );
  assert.equal(r.pickup_on_time, true);
  assert.equal(r.delivery_on_time, true);
  assert.equal(r.sla_days, 22 / 24);
  assert.equal(metrics([r]).sla_known, 1);
  assert.equal(percentile([1, 2, 3, 4], 0.9), 3.7);
  assert.equal(percentile([], 0.95), null);
});
test("queues exclude return/terminal/reverse records and bucket breach calendar days", () => {
  const seed = {
    status: "Undelivered",
    edd: "2026-10-24T18:30:00Z",
    attempts: 1,
  };
  const rs = enrich(
    [
      seed,
      { ...seed, edd: "2026-10-25T18:30:00Z" },
      { ...seed, status: "RTO In Transit" },
      { ...seed, details: { rto_initiated_date: "2026-10-25" } },
      { ...seed, status: "Delivered" },
      { ...seed, details: { is_reverse: true } },
      { ...seed, edd: "2026-10-23T18:30:00Z" },
      { ...seed, edd: "2026-10-22T18:30:00Z" },
    ],
    now,
  );
  assert.equal(rs[0].lm_bucket, "NDR/EDD breach");
  assert.equal(rs[0].age_bucket, "1");
  assert.equal(rs[1].lm_bucket, "NDR");
  for (const i of [2, 3, 4, 5]) assert.equal(rs[i].lm_bucket, null);
  assert.equal(rs[6].age_bucket, "2");
  assert.equal(rs[7].age_bucket, "3+");
  assert.equal(rs[0].risk, "High");
  const [fm] = enrich(
    [
      {
        status: "Pickup Scheduled",
        details: { pickup_attempt_date: "2026-10-24" },
      },
    ],
    now,
  );
  assert.equal(fm.fm_pending, true);
});
test("all/none/multiple filters, dates, LM bucket and literal IDs are consistent", () => {
  const [r] = enrich(
    [
      {
        order_id: "HP-ABC/123",
        awb: "001234",
        city: "Pune",
        state: "MH",
        status: "Undelivered",
        order_date: "2026-10-22T20:00:00Z",
        edd: "2026-10-23",
        details: { master_courier: "Blue Dart" },
      },
    ],
    now,
  );
  assert(
    matches(r, {
      from: "2026-10-23",
      to: "2026-10-23",
      master_courier: ["Blue Dart", "Delhivery"],
      city: ["Pune", "Mumbai"],
      status: ["NDR/EDD breach"],
    }),
  );
  assert(!matches(r, { city: [] }));
  assert(!matches(r, { to: "2026-10-22" }));
  assert.equal(findIdentifiers("Details for #HP-ABC/123?", [r]).length, 1);
  assert.equal(findIdentifiers("Tracking 001234.", [r]).length, 1);
  assert.equal(findIdentifiers("0012345", [r]).length, 0);
});
test("repeat buyer uses distinct orders across history; raw custom views aggregate line items", () => {
  const rs = enrich(
    [
      {
        order_id: "1",
        recipient: "A",
        details: {
          customer_email: "a@test",
          lines: [{ raw: { SKU: "x", Quantity: "2" } }],
        },
      },
      {
        order_id: "2",
        recipient: "A",
        details: {
          customer_email: "a@test",
          lines: [{ raw: { SKU: "x", Quantity: "3" } }],
        },
      },
      { order_id: "3", recipient: "B" },
    ],
    now,
  );
  assert.equal(rs[0].buyer_type, "Repeat customer");
  assert.equal(rs[2].buyer_type, "Unknown");
  assert.deepEqual(
    customResult(rs, {
      source: "raw",
      type: "bar",
      dimension: "SKU",
      aggregate: "sum",
      field: "Quantity",
    }),
    [{ dimension: "x", value: 5 }],
  );
});

test("rounded scientific AWBs never merge distinct order IDs; short report dates are India time", async () => {
  const r = await runImport(
    Buffer.from(
      "Order ID,AWB Code,Shiprocket Created At,Product Quantity\nA,1.23E+11,16/10/26 17:55,1\nB,1.23E+11,16/10/26 17:55,2\n",
    ),
  );
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].awb, null);
  assert.match(r.rows[0].details.awb_issue, /Scientific/);
  assert.equal(r.rows[0].order_date, "2026-10-16T12:25:00.000Z");
});
