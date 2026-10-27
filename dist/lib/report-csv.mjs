import { importMatrices } from './import-matrix.mjs';
export function reportURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'report-sr-mum.shiprocket.in' || url.port || url.username || url.password || !url.pathname.toLowerCase().endsWith('.csv')) throw new Error('Report URL is not allowed');
  return url.href;
}
// CSV state machine preserves quoted commas, escaped quotes, line breaks and IDs as text.
export function parseReport(text) {
  text = text.replace(/^\uFEFF/, '');
  const matrix = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (c !== ',') { matrix.push(row); row = []; if(c === '\r' && text[i+1] === '\n') i++; }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('Malformed CSV'); cell += c; }
    if (matrix.length > 20000 || row.length > 500) throw new Error('Report exceeds processing limits');
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length || closed) { row.push(cell); matrix.push(row); }
  const result = importMatrices([{name:'Report',matrix}]);
  if (result.errors.length) throw new Error('Report contains unmapped rows; import stopped for review');
  return result;
}
export async function boundedBytes(response, maximum) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty body');
  const chunks = []; let size = 0;
  try { for (;;) { const {done,value} = await reader.read(); if(done) break; size += value.length; if(size > maximum) throw new Error('Size limit exceeded'); chunks.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset += chunk.length;}
  if(!size) throw new Error('Empty body');
  return bytes;
}
