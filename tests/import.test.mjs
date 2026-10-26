import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
const workerURL = new URL("../workers/import.js", import.meta.url);
async function runImport(input) {
  return new Promise(async (resolve, reject) => {
    const context = vm.createContext({
      console,
      Blob,
      Response,
      CompressionStream,
      crypto,
      postMessage: resolve,
      Uint8Array,
      ArrayBuffer,
      TextDecoder,
      TextEncoder,
    });
    context.self = context;
    context.importScripts = (relative) =>
      vm.runInContext(
        readFileSync(new URL(relative, workerURL), "utf8"),
        context,
      );
    try {
      new vm.Script(readFileSync(workerURL, "utf8"), {
        filename: workerURL.pathname,
        importModuleDynamically: (specifier) =>
          import(new URL(specifier, workerURL)),
      }).runInContext(context);
      await context.onmessage({
        data: {
          bytes: input.buffer.slice(
            input.byteOffset,
            input.byteOffset + input.byteLength,
          ),
        },
      });
    } catch (err) {
      reject(err);
    }
  });
}
test("worker archives every original byte, groups source lines, retains rejected rows", async () => {
  const bytes = Buffer.from(
    "AWB Code,Order ID,Shipment Status,Quantity,Unknown Column\r\n001234,ORD1,IN TRANSIT,2,alpha\r\n001234,ORD1,IN TRANSIT,3,beta\r\n,,,,unmapped\r\n",
  );
  const result = await runImport(bytes);
  assert(!result.error, result.error);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].awb, "001234");
  assert.equal(result.rows[0].quantity, 5);
  assert.equal(result.rows[0].source_refs.length, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.sourceRows, 3);
  assert.equal(result.hash, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(gunzipSync(Buffer.from(result.zipped)), bytes);
});

test("unambiguous missing-AWB product lines join their known AWB", async () => {
  const result = await runImport(
    Buffer.from("AWB Code,Order ID,Quantity\n00123,ORD1,1\n,ORD1,2\n"),
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].quantity, 3);
  assert.equal(result.rows[0].source_refs.length, 2);
});
