import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
test('standalone receiver authenticates, downloads, archives and imports scheduled CSV',async()=>{
 let handler, downloaded=0, completed=false, imported, archive;
 const token='test-only-secret-'.repeat(4);
 const csv='Order ID,AWB,Product Name,Product Quantity\n001,123456789012345678,One,2\n001,123456789012345678,Two,2';
 const client={rpc:async(name,args)=>{
  if(name==='capture_report_delivery')return {data:'delivery'};
  if(name==='report_pending')return {data:completed?null:{id:'delivery',body_base64:Buffer.from(JSON.stringify({report_file:'https://report-sr-mum.shiprocket.in/report.csv'})).toString('base64')}};
  if(name==='report_import'){imported=args;completed=true;return {data:{import_id:'import'}};}
  return {data:null};
 },storage:{from:()=>({upload:async(path,bytes)=>{archive=bytes;return {};}})}};
 const source=stripTypeScriptTypes((await readFile(new URL('../supabase/bundles/report-inbox.ts',import.meta.url),'utf8')).replace(/^import .*createClient.*;$/m,''));
 const context=vm.createContext({createClient:()=>client,Deno:{env:{get:name=>name==='REPORT_WEBHOOK_TOKEN'?token:'unused'},serve:fn=>{handler=fn;}},crypto,TextEncoder,TextDecoder,Response,Blob,CompressionStream,DecompressionStream,URL,Uint8Array,AbortSignal,atob,btoa,console,fetch:async(url,options)=>{assert.equal(options.redirect,'error');downloaded++;return new Response(csv);}});
 vm.runInContext(source,context);
 const call=(body,secret=token)=>handler(new Request('https://example.test',{method:'POST',headers:{'x-api-key':secret},body:JSON.stringify(body)}));
 assert.equal((await call({},'wrong')).status,401);assert.equal(downloaded,0);
 const response=await call({action:'process_pending'});assert.equal(response.status,200);assert.equal((await response.json()).shipments,1);assert.equal(imported.p_rows[0].quantity,4);
 assert.equal(await new Response(new Blob([archive]).stream().pipeThrough(new DecompressionStream('gzip'))).text(),csv);
 assert.equal((await call({report_file:'https://report-sr-mum.shiprocket.in/report.csv'})).status,200);assert.equal(downloaded,1);
});
