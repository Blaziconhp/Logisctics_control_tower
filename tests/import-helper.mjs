import vm from "node:vm";
import { readFileSync } from "node:fs";
const workerURL = new URL("../workers/import.js", import.meta.url);
export async function runImport(input) {
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
