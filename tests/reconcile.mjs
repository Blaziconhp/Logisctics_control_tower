// Local, opt-in reconciliation. Never copies private source data into the repository.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { runImport } from "./import-helper.mjs";
import { enrich, metrics, day } from "../lib/analytics.mjs";
const path = process.argv[2];
if (!path) throw new Error("Provide a local Shiprocket report path");
const result = await runImport(readFileSync(path));
assert(!result.error, result.error);
const rows = enrich(result.rows, new Date("2026-10-26T12:00:00+05:30"));
assert.equal(result.sourceRows, 911);
assert.equal(result.rows.length, 691);
assert.equal(new Set(rows.map((r) => r.order_id)).size, 691);
assert.equal(result.errors.length, 0);
assert.equal(
  rows.reduce((s, r) => s + r.lines.length, 0),
  911,
);
assert(rows.every((r) => r.order_date && r.city && r.state));
assert.equal(
  rows.reduce((s, r) => s + r.quantity, 0),
  rows.flatMap((r) => r.lines).reduce((s, r) => s + r.quantity, 0),
);
console.log(
  JSON.stringify(
    {
      sourceRows: result.sourceRows,
      shipments: rows.length,
      uniqueOrders: new Set(rows.map((r) => r.order_id)).size,
      errors: result.errors.length,
      firstOrderDate: rows.map((r) => day(r.order_date)).sort()[0],
      lastOrderDate: rows
        .map((r) => day(r.order_date))
        .sort()
        .at(-1),
      productUnits: rows.reduce((s, r) => s + r.quantity, 0),
      metrics: metrics(rows),
      queues: {
        fm: rows.filter((r) => r.fm_pending).length,
        lm: rows.filter((r) => r.lm_bucket).length,
        rto: rows.filter((r) => /^RTO/.test(r.status)).length,
      },
    },
    null,
    2,
  ),
);
