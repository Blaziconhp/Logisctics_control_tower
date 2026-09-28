import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../app.js", import.meta.url), "utf8");

const requiredRoutes = ["overview", "performance", "exceptions", "shipments", "studio", "sharv"];
const requiredLabels = ["SHARV", "Download underlying raw data", "saved_views", "get_my_access"];

for (const route of requiredRoutes) {
  if (!html.includes(`data-route="${route}"`) && !script.includes(`route === "${route}"`)) throw new Error(`Missing route: ${route}`);
}
for (const label of requiredLabels) {
  if (!html.includes(label) && !script.includes(label)) throw new Error(`Missing required integration: ${label}`);
}
if (!html.includes('viewport-fit=cover')) throw new Error("Responsive viewport metadata is missing");
if (!script.includes('name: "lookup_shipments"') || !script.includes('name: "get_sla_insight"')) throw new Error("WebMCP tools are missing");

console.log("Static verification passed");
