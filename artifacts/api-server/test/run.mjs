// Bundles test/*.test.ts with esbuild (so extension-less TS imports resolve)
// and runs them with Node's built-in test runner. No database required.
import { spawnSync } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const files = (await readdir(testDir)).filter((f) => f.endsWith(".test.ts")).map((f) => path.join(testDir, f));
// Inside the package so externals resolve from its node_modules.
const outDir = path.join(testDir, "..", ".test-dist");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: files,
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: outDir,
  outExtension: { ".js": ".mjs" },
  external: ["pino", "pino-pretty", "pg", "drizzle-orm", "zod"],
  sourcemap: "inline",
  logLevel: "warning",
  banner: { js: "import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);" },
});

const result = spawnSync(
  process.execPath,
  ["--enable-source-maps", "--test", ...files.map((f) => path.join(outDir, path.basename(f).replace(/\.ts$/, ".mjs")))],
  { stdio: "inherit" },
);
await rm(outDir, { recursive: true, force: true });
process.exit(result.status ?? 1);
