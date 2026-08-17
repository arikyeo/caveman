import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const generator = join(root, "packages", "cli", "scripts", "gen-wedge-installer.mjs");
const outputs = [
  join(root, "packages", "shared", "binary-installer", "release.generated.mjs"),
  join(root, "mcp", "bin", "binary-installer.generated.mjs"),
  join(root, "mcp", "bin", "release.generated.mjs"),
  join(root, "shrink", "bin", "binary-installer.generated.mjs"),
  join(root, "shrink", "bin", "release.generated.mjs"),
  join(root, "browse", "bin", "binary-installer.generated.mjs"),
  join(root, "browse", "bin", "release.generated.mjs"),
];

function generate() {
  const result = spawnSync(process.execPath, [generator], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("wedge generation leaves matching outputs untouched", async () => {
  generate();
  const before = outputs.map((path) => statSync(path).mtimeMs);
  await new Promise((resolve) => setTimeout(resolve, 25));
  generate();
  const after = outputs.map((path) => statSync(path).mtimeMs);
  assert.deepEqual(after, before);
});
