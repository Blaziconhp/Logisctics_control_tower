import { normalizeRow, header } from "./model.mjs";
export function importMatrices(sheetsInput) {
    const groups = new Map(),
      errors = [],
      sheets = [];
    let sourceRows = 0;
    for (const { name, matrix } of sheetsInput) {
      const hi = matrix.findIndex((r) =>
        r.some((c) =>
          [
            "awb",
            "awbcode",
            "awbnumber",
            "awbno",
            "orderid",
            "channelorderid",
          ].includes(header(c)),
        ),
      );
      if (hi < 0) {
        sheets.push({ name, recognized: false, rows: matrix.length });
        continue;
      }
      const headers = matrix[hi];
      let count = 0;
      for (let i = hi + 1; i < matrix.length; i++) {
        const cells = matrix[i];
        if (!cells.some((c) => String(c).trim())) continue;
        sourceRows++;
        count++;
        const result = normalizeRow(headers, cells, name, i + 1);
        if (result.error) {
          errors.push(result.error);
          continue;
        }
        result.value.source_refs[0].header_row = hi + 1;
        const row = result.value,
          existing = groups.get(row.shipment_key);
        if (existing) {
          existing.source_refs.push(...row.source_refs);
          existing.details.lines.push(...row.details.lines);
          existing.quantity = (existing.quantity || 0) + (row.quantity || 0);
        } else groups.set(row.shipment_key, row);
      }
      sheets.push({ name, recognized: true, rows: count });
    }
    const orderAwbs = new Map();
    for (const row of groups.values()) {
      if (row.order_id && row.awb) {
        if (!orderAwbs.has(row.order_id))
          orderAwbs.set(row.order_id, new Set());
        orderAwbs.get(row.order_id).add(row.awb);
      }
    }
    for (const [key, row] of groups) {
      if (!row.awb && orderAwbs.get(row.order_id)?.size === 1) {
        const awb = [...orderAwbs.get(row.order_id)][0],
          target = groups.get(`awb:${awb}`);
        target.source_refs.push(...row.source_refs);
        target.details.lines.push(...row.details.lines);
        target.quantity = (target.quantity || 0) + (row.quantity || 0);
        groups.delete(key);
      }
    }
    // One merchant order is one dashboard shipment. Keep its richest AWB row
    // and fold sparse order-only records and line items into it.
    const orderGroups = new Map();
    for (const [key, row] of groups) {
      const orderKey = row.order_id ? String(row.order_id).trim().toLowerCase() : key;
      if (!orderGroups.has(orderKey)) orderGroups.set(orderKey, []);
      orderGroups.get(orderKey).push([key, row]);
    }
    for (const records of orderGroups.values()) {
      if (records.length < 2) continue;
      records.sort((a, b) => Number(Boolean(b[1].awb)) - Number(Boolean(a[1].awb)));
      const [targetKey, target] = records[0];
      for (const [key, row] of records.slice(1)) {
        target.source_refs.push(...row.source_refs);
        target.details.lines.push(...row.details.lines);
        target.details.additional_awbs = [...new Set([...(target.details.additional_awbs || []), row.awb].filter(Boolean))];
        for (const field of ["courier", "customer", "recipient", "city", "state", "pincode", "payment", "warehouse", "order_date", "pickup_date", "delivered_date", "edd", "status_at", "freight", "attempts", "remark"])
          if ((target[field] === null || target[field] === "" || target[field] === "Unknown") && row[field] !== null && row[field] !== "") target[field] = row[field];
        groups.delete(key);
      }
      groups.set(targetKey, target);
    }
    for (const row of groups.values()) {
      row.quantity = row.details.lines.reduce(
        (sum, line) => sum + (Number(line.quantity) || 0),
        0,
      );
      row.product = [
        ...new Set(row.details.lines.map((l) => l.product).filter(Boolean)),
      ].join("; ");
      row.sku = [
        ...new Set(row.details.lines.map((l) => l.sku).filter(Boolean)),
      ].join("; ");
    }
    if (!groups.size)
      throw new Error(
        "No shipment rows found. Use a Shiprocket all-orders report with AWB or Order ID headers.",
      );

return { rows: [...groups.values()], errors, sheets, sourceRows };
}
