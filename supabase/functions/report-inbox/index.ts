import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { reportURL, parseReport, boundedBytes } from '../../../lib/report-csv.mjs';
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const digest = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const hex = (bytes: Uint8Array) => Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
Deno.serve(async request => {
  if(request.method !== 'POST') return reply(405,{error:'POST required'});
  const expected = Deno.env.get('REPORT_WEBHOOK_TOKEN');
  if(!expected || expected.length<32) return reply(503,{error:'Receiver not configured'});
  const supplied = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i,'') || '';
  const encoder = new TextEncoder();
  const [a,b] = await Promise.all([digest(encoder.encode(expected)),digest(encoder.encode(supplied))]);
  if(a.reduce((diff,value,i)=>diff | (value^b[i]),0)) return reply(401,{error:'Unauthorized'});
  const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  let delivery: string | undefined; let step = 'read_request';
  const rpc = async (name: string,args: Record<string,unknown>) => {const {data,error} = await client.rpc(name,args);if(error) throw new Error('Database operation failed');return data;};
  try {
    const bytes = await boundedBytes(request,1048576);
    const payload = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(payload.action === 'process_pending') {
      step='find_pending';
      const pending = await rpc('report_pending',{});
      if(!pending) return reply(200,{pending:false});
      delivery = pending.id;
      const stored = Uint8Array.from(atob(pending.body_base64),(c:string)=>c.charCodeAt(0));
      Object.assign(payload,JSON.parse(new TextDecoder().decode(stored)));
    } else {
      step='capture';
      let binary=''; for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      delivery = await rpc('capture_report_delivery',{p_fingerprint:hex(await digest(bytes)),p_content_type:request.headers.get('content-type')||'application/json',p_body_base64:btoa(binary),p_byte_length:bytes.length});
      const pending = await rpc('report_pending',{p_id:delivery});
      if(!pending) return reply(200,{received:true,already_completed:true});
    }
    step='validate_report_url';
    const url = reportURL(payload.report_file);
    step='download_report';
    const download = await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!download.ok) throw new Error('Report download failed');
    const original = await boundedBytes(download,10*1024*1024);
    step='parse_csv';
    const parsed = parseReport(new TextDecoder('utf-8',{fatal:true}).decode(original));
    step='archive_report';
    const hash = hex(await digest(original));
    const zipped = new Uint8Array(await new Response(new Blob([original]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const path = `reports/${hash}.gz`;
    const {error:uploadError} = await client.storage.from('shiprocket-sources').upload(path,zipped,{contentType:'application/gzip',upsert:false});
    if(uploadError) {
      // A duplicate upload must really exist; do not swallow other storage failures.
      const {data:archived,error} = await client.storage.from('shiprocket-sources').download(path);
      if(error || !archived || hex(await digest(new Uint8Array(await new Response(archived.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()))) !== hash) throw new Error('Archive failed');
    }
    step='import_shipments';
    const result = await rpc('report_import',{p_delivery:delivery,p_hash:hash,p_bytes:original.length,p_compressed:zipped.length,p_source_rows:parsed.sourceRows,p_rows:parsed.rows});
    return reply(200,{received:true,imported:true,delivery_id:delivery,source_rows:parsed.sourceRows,shipments:parsed.rows.length,...result});
  } catch {
    if(delivery) await client.rpc('report_failed',{p_id:delivery});
    // Never log a signed report URL, raw report, customer data or token.
    console.error('Report processing failed at',step);
    return reply(500,{received:!!delivery,imported:false,step,error:'Processing failed; retry after checking this step'});
  }
});
