import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Pass the shipment workbook path as the first argument.");
const root = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const XLSX = require(resolve(root, "vendor/xlsx.full.min.js"));
const app = await readFile(resolve(root, "app.js"), "utf8");
const start = app.indexOf("  function normalizeHeader(");
const end = app.indexOf("  function toDbShipment(", start);
const customerStart = app.indexOf("  function classifyCustomerOrders(");
const customerEnd = app.indexOf("  async function processUpload(", customerStart);
assert(start >= 0 && end > start && customerStart >= 0 && customerEnd > customerStart, "Could not locate the application upload parser.");

const normalizeText = `function normalizeText(value) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim(); }`;
const context = { XLSX, window: { XLSX } };
vm.runInNewContext(`${normalizeText}\n${app.slice(start, end)}\n${app.slice(customerStart, customerEnd)}\nglobalThis.parseWorkbook = parseWorkbook;`, context);

const input = await readFile(inputPath);
const arrayBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
const result = await context.parseWorkbook({ arrayBuffer: async () => arrayBuffer }, "Base Raw Data");
const rows = result.rows;
const statuses = Object.fromEntries([...new Set(rows.map((row) => row.statusGroup))].sort().map((status) => [status, rows.filter((row) => row.statusGroup === status).length]));
const delivered = rows.filter((row) => row.statusGroup === "Delivered");
const open = rows.filter((row) => ["In Transit", "NDR / Undelivered", "RTO In Progress"].includes(row.statusGroup));
const rto = rows.filter((row) => row.statusGroup.startsWith("RTO"));
const tat = delivered.map((row) => row.tat).filter(Number.isFinite);
const freight = rows.map((row) => row.freight).filter((value) => value != null && Number.isFinite(value));
const quantity = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
const uniqueAwb = new Set(rows.map((row) => row.awb)).size;

assert(rows.length > 0, "The uploader did not accept any shipment records.");
assert.equal(uniqueAwb, rows.length, "The workbook has duplicate AWBs that need review before replacing the base dataset.");
assert(delivered.length > 0, "Delivered status mapping did not recognize this workbook.");
assert(open.length > 0, "Open shipment statuses did not map into the dashboard queue.");
assert(rto.length > 0, "RTO statuses did not map into the RTO analysis.");
assert(tat.length > 0, "D2D/TAT values did not map into transit-time metrics.");
assert(freight.length > 0, "Freight values did not map into freight metrics.");

console.log(JSON.stringify({
  shipmentRows: rows.length,
  uniqueAwb,
  sourceRowsConsolidated: result.duplicates,
  statuses,
  delivered: delivered.length,
  open: open.length,
  rto: rto.length,
  tatRows: tat.length,
  averageTatDays: Number((tat.reduce((sum, value) => sum + value, 0) / (tat.length || 1)).toFixed(2)),
  freightRows: freight.length,
  productQuantityUnits: quantity,
  deliveredWithMeasurableSla: delivered.filter((row) => row.onTime !== null).length,
  customerNamesAvailable: rows.some((row) => row.customer !== "Unassigned customer" || row.recipientName !== "Not provided")
}, null, 2));
