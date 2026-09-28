import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ["index.html", "styles.css", "app.js", "config.js"]) {
  await cp(resolve(root, file), resolve(dist, file));
}

await cp(resolve(root, "vendor"), resolve(dist, "vendor"), { recursive: true });

console.log(`Built static site in ${dist}`);
