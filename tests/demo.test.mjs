import test from "node:test";
import assert from "node:assert/strict";
import { createDemoShipments } from "../lib/demo.mjs";
import { csv } from "../lib/model.mjs";
test("the working demo contains exactly one month of complete, consistent records", () => {
  const rows = createDemoShipments();
  assert.equal(rows.length, 192);
  for (const row of rows) {
    for (const key of [
      "order_date",
      "pickup_date",
      "delivered_date",
      "edd",
      "updated_at",
    ]) {
      if (row[key])
        assert.equal(
          row[key].slice(0, 7),
          "2026-09",
          `${key} must stay in September`,
        );
    }
    assert(row.awb && row.order_id && row.courier && row.state);
    assert(new Date(row.pickup_date) >= new Date(row.order_date));
    if (row.status === "Delivered") {
      assert(row.delivered_date);
      assert(new Date(row.delivered_date) >= new Date(row.pickup_date));
    } else assert.equal(row.delivered_date, null);
  }
  assert.equal(new Set(rows.map((r) => r.awb)).size, rows.length);
  const delivered = rows.filter((r) => r.status === "Delivered");
  assert(delivered.some((r) => r.delivered_date <= r.edd));
  assert(delivered.some((r) => r.delivered_date > r.edd));
  const carrier = rows.filter((r) => r.courier === "Delhivery");
  assert(carrier.length > 0 && carrier.length < rows.length);
  assert.equal(csv(carrier).split("\r\n").length, carrier.length + 1);
  assert(new Set(rows.map((r) => r.order_date.slice(0, 10))).size > 20);
});
