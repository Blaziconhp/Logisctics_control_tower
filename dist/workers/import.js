importScripts("../vendor/xlsx.full.min.js");
self.onmessage = async ({ data }) => {
  try {
    const { normalizeRow, header } = await import("../lib/model.mjs");
    const bytes = data.bytes;
    const workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: false,
      cellText: true,
    });
    const groups = new Map(),
      errors = [],
      sheets = [];
    let sourceRows = 0;
    for (const name of workbook.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
        raw: false,
        defval: "",
        blankrows: true,
        range: 0,
      });
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
        target.quantity = (target.quantity || 0) + (row.quantity || 0);
        groups.delete(key);
      }
    }
    if (!groups.size)
      throw new Error(
        "No shipment rows found. Use a Shiprocket all-orders report with AWB or Order ID headers.",
      );
    // Archive the exact original bytes. Unknown sheets, duplicate headings, blank cells and rejected rows survive unchanged.
    const zipped = await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    postMessage(
      { rows: [...groups.values()], errors, sheets, sourceRows, hash, zipped },
      [zipped],
    );
  } catch (e) {
    postMessage({ error: e.message });
  }
};
