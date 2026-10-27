import test from 'node:test';
import assert from 'node:assert/strict';
import {reportURL,parseReport,boundedBytes} from '../lib/report-csv.mjs';
test('report download permits only verified HTTPS CSV host',()=>{
 assert.equal(reportURL('https://report-sr-mum.shiprocket.in/a.csv?token=private'),'https://report-sr-mum.shiprocket.in/a.csv?token=private');
 for(const url of ['http://report-sr-mum.shiprocket.in/a.csv','https://evil.test/a.csv','https://report-sr-mum.shiprocket.in.evil.test/a.csv','https://user@report-sr-mum.shiprocket.in/a.csv','https://report-sr-mum.shiprocket.in:444/a.csv','https://report-sr-mum.shiprocket.in/a.html']) assert.throws(()=>reportURL(url));
});
test('CSV retains quoted products, quantities and long AWBs',()=>{
 const data=parseReport('\uFEFFOrder ID,AWB,Product Name,Product Quantity\r\n001,123456789012345678,"Name, with ""quotes""\nand newline",2\r\n001,123456789012345678,Second,3');
 assert.equal(data.rows.length,1); assert.equal(data.rows[0].awb,'123456789012345678');assert.equal(data.rows[0].details.lines.length,2); assert.equal(data.rows[0].quantity,5);
 assert.throws(()=>parseReport('Order ID,Product Name\n001,"unclosed'));
 assert.throws(()=>parseReport('<html>Not a report</html>'));
});
test('body read is bounded',async()=>{await assert.rejects(()=>boundedBytes(new Response('abcdef'),3));assert.equal((await boundedBytes(new Response('abc'),3)).length,3);});
