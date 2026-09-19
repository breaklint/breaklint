import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import {
  assertPublicImports,
  exportedNames,
} from "../../public-protocol/test/public-boundary.mjs";
const root = resolve(import.meta.dirname, "../../..");
test("Action exports only its runner and composition types", async () => {
  assert.deepEqual(Object.keys(await import("../dist/index.js")), ["runAction"]);
  assert.deepEqual(
    exportedNames(join(root, "packages/github-action/dist/index.d.ts")),
    ["ActionDependencies", "ActionRunSummary", "ActionRuntime", "runAction"],
  );
});
const forbidden =
  /@breaklint\/(?:core|browser|ci|configuration|reporting|source-analysis|responsive-[\w-]+|finding-intelligence|pr-causality|source-attribution|confidence-model|noise-suppression|repair[\w-]*|incremental-analysis)|playwright|chromium/i;
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
test("Action source and emitted declarations contain only the approved public dependency graph", () => {
  const allowed = new Set([
    "@actions/core",
    "@actions/github",
    "@breaklint/hosted-client",
    "@breaklint/public-config",
    "@breaklint/public-protocol",
    "@breaklint/public-protocol/internal",
    "ignore",
    "zod",
    "typescript",
    "@types/node",
  ]);
  for (const name of [
    "github-action",
    "hosted-client",
    "public-config",
    "public-protocol",
  ]) {
    const base = join(root, "packages", name);
    const pkg = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
    for (const group of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ])
      for (const dep of Object.keys(pkg[group] ?? {})) assert.ok(allowed.has(dep), dep);
    assertPublicImports(base, allowed, ["src", "dist"]);
  }
  const action = readFileSync(join(root, "packages/github-action/action.yml"), "utf8");
  assert.doesNotMatch(action, /preview|deployment|playwright|login|application.env/i);
});
test("packed declarations and isolated bundled Action load with zero browser or private dependencies", () => {
  const dir = mkdtempSync(join(tmpdir(), "breaklint-packed-action-"));
  try {
    const tar = join(dir, "action.tgz");
    execFileSync("pnpm", ["pack", "--out", tar], {
      cwd: join(root, "packages/github-action"),
      stdio: "pipe",
      env: { ...process.env, pnpm_config_verify_deps_before_run: "false" },
    });
    const dest = join(dir, "package");
    mkdirSync(dest);
    execFileSync("tar", ["-xzf", tar, "--strip-components=1", "-C", dest]);
    for (const file of files(join(dest, "dist")))
      assert.doesNotMatch(readFileSync(file, "utf8"), forbidden, file);
    const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8"));
    assert.deepEqual(
      Object.keys(pkg.dependencies)
        .filter((d) => d.startsWith("@breaklint/"))
        .sort(),
      [
        "@breaklint/hosted-client",
        "@breaklint/public-config",
        "@breaklint/public-protocol",
      ],
    );
    // Published Action layout uses the self-contained bundle, not the library entry.
    copyFileSync(
      join(root, "packages/github-action/dist-bundle/index.js"),
      join(dest, "dist/index.js"),
    );
    writeFileSync(join(dir, "summary"), "");
    const child = spawnSync(process.execPath, [join(dest, "dist/index.js")], {
      cwd: dir,
      encoding: "utf8",
      timeout: 30000,
      env: { PATH: "/no-executables", GITHUB_STEP_SUMMARY: join(dir, "summary") },
    });
    assert.equal(child.status, 1);
    assert.match(child.stdout, /unavailable/);
    assert.doesNotMatch(
      child.stdout + child.stderr,
      /ERR_MODULE_NOT_FOUND|Cannot find module|Chromium|Playwright/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
