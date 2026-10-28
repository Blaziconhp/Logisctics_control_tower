import { readFile, writeFile } from "node:fs/promises";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/build-pincode-directory.mjs <official-csv>");

function csvRows(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell); cell = "";
      if (c !== ",") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const title = (value) => String(value || "").trim().toLowerCase()
  .replace(/\b\w/g, (character) => character.toUpperCase());
const rows = csvRows(await readFile(source, "utf8"));
const headings = rows.shift().map((value) => value.toLowerCase().trim());
const pinIndex = headings.indexOf("pincode"), districtIndex = headings.indexOf("district"), stateIndex = headings.indexOf("statename");
if ([pinIndex, districtIndex, stateIndex].includes(-1)) throw new Error("Official directory headings changed");

const candidates = new Map();
for (const row of rows) {
  const pin = String(row[pinIndex] || "").replace(/\D/g, "");
  const district = title(row[districtIndex]), state = title(row[stateIndex]);
  if (pin.length !== 6 || !district || !state) continue;
  const key = `${district}\u0000${state}`;
  if (!candidates.has(pin)) candidates.set(pin, new Map());
  const counts = candidates.get(pin);
  counts.set(key, (counts.get(key) || 0) + 1);
}
const directory = Object.fromEntries([...candidates].sort(([a], [b]) => a.localeCompare(b)).map(([pin, counts]) => {
  const [best] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return [pin, best.split("\u0000")];
}));
const header = `// Generated from the Department of Posts All India Pincode Directory.\n// Source: https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month\n// Do not edit by hand; regenerate with scripts/build-pincode-directory.mjs.\n`;
await writeFile(new URL("../lib/pincode-directory.mjs", import.meta.url), `${header}export const PIN_DIRECTORY = ${JSON.stringify(directory)};\n`);
console.log(`Generated ${Object.keys(directory).length.toLocaleString("en-IN")} PIN mappings.`);
