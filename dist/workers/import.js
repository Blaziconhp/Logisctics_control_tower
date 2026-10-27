importScripts("../vendor/xlsx.full.min.js");
self.onmessage = async ({ data }) => {
  try {
    const bytes = data.bytes;
    const workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: false,
      cellText: true,
      raw: true,
    });
    const { importMatrices } = await import("../lib/import-matrix.mjs?v=report2");
    const { rows, errors, sheets, sourceRows } = importMatrices(workbook.SheetNames.map(name => ({name, matrix: XLSX.utils.sheet_to_json(workbook.Sheets[name], {header:1,raw:true,defval:"",blankrows:true,range:0})})));
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
      { rows, errors, sheets, sourceRows, hash, zipped },
      [zipped],
    );
  } catch (e) {
    postMessage({ error: e.message });
  }
};
