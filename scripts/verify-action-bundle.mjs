#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const action = path.join(root, "packages/github-action");
const approved = new Set([
  "@breaklint/github-action",
  "@breaklint/hosted-client",
  "@breaklint/public-config",
  "@breaklint/public-protocol",
]);
const visited = new Set();
function inspect(name) {
  if (visited.has(name)) return;
  visited.add(name);
  assert.ok(approved.has(name), `Unapproved dependency: ${name}`);
  const pkg = JSON.parse(
    readFileSync(
      path.join(root, "packages", name.split("/")[1], "package.json"),
      "utf8",
    ),
  );
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    assert.doesNotMatch(dep, /playwright|chromium/);
    if (dep.startsWith("@breaklint/")) inspect(dep);
  }
}
inspect("@breaklint/github-action");
const meta = JSON.parse(
  readFileSync(path.join(action, "dist-bundle/metafile.json"), "utf8"),
);
for (const input of Object.keys(meta.inputs)) {
  const match = /(?:^|\/)packages\/([^/]+)\//.exec(input);
  if (match) assert.ok(approved.has(`@breaklint/${match[1]}`), input);
  assert.doesNotMatch(input, /playwright|chromium/);
}
for (const output of Object.values(meta.outputs))
  for (const item of output.imports)
    assert.ok(
      item.path.startsWith("node:") ||
        (await import("node:module")).builtinModules.includes(item.path),
      `External dependency: ${item.path}`,
    );
assert.equal(
  readFileSync(path.join(root, "action/dist/index.js"), "utf8"),
  readFileSync(path.join(action, "dist-bundle/index.js"), "utf8"),
);
assert.match(
  readFileSync(path.join(root, "action/action.yml"), "utf8"),
  /using: node24/,
);
const dir = mkdtempSync(path.join(tmpdir(), "breaklint-public-action-"));
try {
  copyFileSync(path.join(root, "action/dist/index.js"), path.join(dir, "index.mjs"));
  writeFileSync(path.join(dir, "summary.md"), "");
  const result = spawnSync(process.execPath, [path.join(dir, "index.mjs")], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
    env: {
      PATH: "/nonexistent",
      GITHUB_ACTIONS: "true",
      GITHUB_STEP_SUMMARY: path.join(dir, "summary.md"),
    },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unavailable/);
  assert.match(readFileSync(path.join(dir, "summary.md"), "utf8"), /No clean result/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /Cannot find module|ERR_MODULE_NOT_FOUND|preview|Chromium|Playwright/,
  );
  console.log(
    `Isolated Action passed without node_modules, browser, preview, deployment or application credentials. ${Object.keys(meta.inputs).length} bundle inputs inspected; public graph: ${[...visited].join(", ")}.`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
