import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mockupPreviewPlugin } from "../mockupPreviewPlugin.ts";

test("mockup discovery preserves nested TSX targets and excludes private files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mockup-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = mockupPreviewPlugin();
  plugin.configResolved({ root });
  const generated = path.join(root, "src/.generated/mockup-components.ts");

  // A new sandbox need not contain the mockups directory yet.
  await plugin.buildStart();
  assert.match(await readFile(generated, "utf8"), /modules: ModuleMap = \{\n\n\};/);

  for (const file of [
    "Card.tsx",
    "nested/Panel.tsx",
    "_Hidden.tsx",
    "_private/Secret.tsx",
    "nested/_internal/Secret.tsx",
    "nested/_Helper.tsx",
    ".hidden/Secret.tsx",
    "notes.ts",
  ]) {
    const target = path.join(root, "src/components/mockups", file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "export default function Component() { return null; }\n");
  }

  await plugin.buildStart();
  const source = await readFile(generated, "utf8");
  const entries = [...source.matchAll(/"(\.\/components\/mockups\/[^"]+)": \(\) => import\("([^"]+)"\)/g)]
    .map((match) => [match[1], match[2]])
    .sort();
  assert.deepEqual(entries, [
    ["./components/mockups/Card.tsx", "../components/mockups/Card.tsx"],
    ["./components/mockups/nested/Panel.tsx", "../components/mockups/nested/Panel.tsx"],
  ]);
  assert.equal((source.match(/=> import\(/g) ?? []).length, 2);

  await rm(path.join(root, "src/components/mockups/Card.tsx"));
  await plugin.buildStart();
  const refreshed = await readFile(generated, "utf8");
  assert.doesNotMatch(refreshed, /Card\.tsx/);
  assert.match(refreshed, /nested\/Panel\.tsx/);
});
