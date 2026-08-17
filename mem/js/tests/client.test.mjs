import assert from "node:assert/strict";
import { chmod, copyFile, link, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test, { after } from "node:test";

import { MEMORY_TOO_LARGE_EXIT_CODE, forget, history, recall, remember, supersede } from "../index.mjs";

test("JS client exports the too-large process exit contract", () => {
  assert.equal(MEMORY_TOO_LARGE_EXIT_CODE, 65);
});

let sharedWindowsFixture;

async function windowsFixture() {
  if (sharedWindowsFixture) return sharedWindowsFixture;
  const directory = await mkdtemp(join(tmpdir(), "cavemem-js-"));
  const fixture = `
const { readFileSync } = require("node:fs");
const args = process.argv.slice(2);
const input = args[0] === "remember" && args[1] === "--stdin" ? readFileSync(0, "utf8") : "";
if (args.includes("__fail__") || input.includes("__fail__")) process.exit(17);
if (Buffer.byteLength(input) > 256 * 1024) process.exit(65);
if (args.includes("__invalid_json__") || input.includes("__invalid_json__")) process.stdout.write("not json");
else process.stdout.write(JSON.stringify({ args, basis: "inferred" }));
`;

  const bootstrap = join(directory, "fixture.cjs");
  const path = join(directory, "cavemem.exe");
  await writeFile(bootstrap, `${fixture.replace(
    "const args = process.argv.slice(2);",
    "const args = [require(\"node:path\").basename(process.argv[1]), ...process.argv.slice(2)];",
  )}\nprocess.exit(0);\n`);
  try {
    await link(process.execPath, path);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EXDEV") throw error;
    await copyFile(process.execPath, path);
  }
  sharedWindowsFixture = { directory, path, nodeOptions: `--require=${JSON.stringify(bootstrap)}` };
  return sharedWindowsFixture;
}

after(async () => {
  if (sharedWindowsFixture) {
    await rm(sharedWindowsFixture.directory, { recursive: true, force: true });
  }
});

async function fakeBinary(t) {
  if (process.platform === "win32") return windowsFixture();

  const directory = await mkdtemp(join(tmpdir(), "cavemem-js-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = `
const { readFileSync } = require("node:fs");
const args = process.argv.slice(2);
const input = args[0] === "remember" && args[1] === "--stdin" ? readFileSync(0, "utf8") : "";
if (args.includes("__fail__") || input.includes("__fail__")) process.exit(17);
if (Buffer.byteLength(input) > 256 * 1024) process.exit(65);
if (args.includes("__invalid_json__") || input.includes("__invalid_json__")) process.stdout.write("not json");
else process.stdout.write(JSON.stringify({ args, basis: "inferred" }));
`;

  const path = join(directory, "cavemem");
  await writeFile(path, `#!/usr/bin/env node${fixture}`, { mode: 0o700 });
  await chmod(path, 0o700);
  return { directory, path, nodeOptions: undefined };
}

function activateFixture(t, fixture, { viaPath = false } = {}) {
  const previousBinary = process.env.CAVEMEM_BIN;
  const previousNodeOptions = process.env.NODE_OPTIONS;
  const previousPath = process.env.PATH;
  if (viaPath) {
    delete process.env.CAVEMEM_BIN;
    process.env.PATH = `${fixture.directory}${delimiter}${previousPath}`;
  } else {
    process.env.CAVEMEM_BIN = fixture.path;
  }
  if (fixture.nodeOptions) {
    process.env.NODE_OPTIONS = previousNodeOptions
      ? `${previousNodeOptions} ${fixture.nodeOptions}`
      : fixture.nodeOptions;
  }
  t.after(() => {
    if (previousBinary === undefined) delete process.env.CAVEMEM_BIN;
    else process.env.CAVEMEM_BIN = previousBinary;
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    process.env.PATH = previousPath;
  });
}

test("JS client forwards every command and preserves JSON response", async (t) => {
  const fixture = await fakeBinary(t);
  activateFixture(t, fixture);

  assert.deepEqual(await remember("raw memory"), { args: ["remember", "--stdin"], basis: "inferred" });
  assert.deepEqual(await recall("billing"), { args: ["recall", "billing"], basis: "inferred" });
  assert.deepEqual(await recall("billing", 4), { args: ["recall", "billing", "4"], basis: "inferred" });
  assert.deepEqual(await recall("billing", 4, 900), { args: ["recall", "billing", "4", "900"], basis: "inferred" });
  assert.deepEqual(await recall("billing", undefined, 0), { args: ["recall", "billing", "0", "0"], basis: "inferred" });
  assert.deepEqual(await supersede("mem_1", "replacement"), { args: ["supersede", "mem_1", "replacement"], basis: "inferred" });
  assert.deepEqual(await history("mem_1"), { args: ["history", "mem_1"], basis: "inferred" });
  assert.deepEqual(await forget("mem_1"), { args: ["forget", "mem_1"], basis: "inferred" });
});

test("JS client propagates binary and JSON failures", async (t) => {
  const fixture = await fakeBinary(t);
  activateFixture(t, fixture);

  await assert.rejects(remember("__fail__"), (error) => error.code === 17);
  await assert.rejects(remember("__invalid_json__"), SyntaxError);
  await assert.rejects(
    remember("x".repeat(256 * 1024 + 1)),
    (error) => error.code === MEMORY_TOO_LARGE_EXIT_CODE,
  );
});

test("explicit missing CAVEMEM_BIN fails instead of silently executing PATH binary", async (t) => {
  const previousBinary = process.env.CAVEMEM_BIN;
  const previousPath = process.env.PATH;
  const directory = await mkdtemp(join(tmpdir(), "cavemem-js-missing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  process.env.CAVEMEM_BIN = join(directory, "missing-cavemem");
  process.env.PATH = `${directory}${delimiter}${previousPath}`;
  t.after(() => {
    if (previousBinary === undefined) delete process.env.CAVEMEM_BIN;
    else process.env.CAVEMEM_BIN = previousBinary;
    process.env.PATH = previousPath;
  });

  await assert.rejects(remember("must not reach PATH"), (error) => error.code === "ENOENT");
});

test("unset CAVEMEM_BIN resolves cavemem from PATH", async (t) => {
  const fixture = await fakeBinary(t);
  activateFixture(t, fixture, { viaPath: true });

  assert.deepEqual(await remember("path memory"), {
    args: ["remember", "--stdin"],
    basis: "inferred",
  });
});
