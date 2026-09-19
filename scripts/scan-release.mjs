import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
const root = resolve(import.meta.dirname, "..");
const approved = new Set([
  "public-protocol",
  "public-config",
  "hosted-client",
  "cli",
  "github-action",
]);
const categories = [
  "core",
  "browser",
  "source-analysis",
  "responsive-domain",
  "responsive-analyzers",
  "responsive-solver",
  "finding-intelligence",
  "pr-causality",
  "source-attribution",
  "confidence-model",
  "noise-suppression",
  "repair",
  "source-repair",
  "incremental-analysis",
  "worker",
  "platform",
  "database",
  "storage",
  "queue",
];
const findings = [];
const inventory = [];
const reviewed = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", ".release"].includes(e.name)) continue;
    const f = join(dir, e.name),
      p = relative(root, f);
    assert(!lstatSync(f).isSymbolicLink(), "Public file symlink");
    if (e.isDirectory()) {
      walk(f);
      continue;
    }
    const content = readFileSync(f),
      s = content.toString("utf8");
    inventory.push({
      path: p,
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    const flag = (code) => findings.push({ path: p, code });
    if (/\.map$/.test(p) || (/sourceMappingURL/.test(s) && !p.startsWith("scripts/")))
      flag("source-map");
    if (/\/(?:Users|home)\/[\w.-]+\/|\/private\/(?:tmp|var)\/|[A-Z]:\\Users\\/i.test(s))
      flag("absolute-local-path");
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,})/.test(
        s,
      )
    )
      flag("credential-pattern");
    if (/https?:\/\/[^\s/"'<>]+:[^\s/"'<>]+@/.test(s) && !p.includes("/test/"))
      flag("credential-url");
    if (/https?:\/\/smee\.io\//i.test(s)) flag("development-relay");
    if (
      /(?:apps\/(?:api|worker|dashboard)|benchmarks\/calibration|docs\/phase-11)/.test(
        s,
      )
    )
      flag("private-area");
    for (const match of s.matchAll(/@breaklint\/([a-z][a-z-]*)/g)) {
      if (!approved.has(match[1])) {
        // Literal negative assertions are intentionally retained in synthetic tests.
        if (p.includes("/test/") || p === "scripts/verify-consumer.mjs")
          reviewed.push({ path: p, kind: "negative-dependency-assertion" });
        else flag("private-package-reference");
      }
    }
  }
}
walk(root);
for (const p of inventory.filter((i) => i.path.endsWith("package.json"))) {
  const m = JSON.parse(readFileSync(join(root, p.path), "utf8"));
  for (const dep of Object.keys({
    ...m.dependencies,
    ...m.devDependencies,
    ...m.optionalDependencies,
    ...m.peerDependencies,
  }))
    if (dep.startsWith("@breaklint/"))
      assert(approved.has(dep.split("/")[1]), "Private manifest dependency");
  if (m.exports)
    assert(
      Object.keys(m.exports).every((k) => !k.includes("*")),
      "Wildcard exports",
    );
}
const meta = JSON.parse(
  readFileSync(join(root, "packages/github-action/dist-bundle/metafile.json"), "utf8"),
);
for (const input of Object.keys(meta.inputs)) {
  assert(
    !input.startsWith("/") && !input.startsWith("../"),
    "Bundle input escapes public checkout",
  );
  const m = /(?:^|\/)packages\/([^/]+)\//.exec(input);
  if (m) assert(approved.has(m[1]), "Private bundle input");
  assert(!/playwright|chromium/i.test(input), "Unexpected runtime dependency");
}
for (const output of Object.values(meta.outputs))
  for (const dep of output.imports)
    assert(
      dep.path.startsWith("node:") || builtinModules.includes(dep.path),
      "External bundle dependency",
    );
const counts = Object.fromEntries(
  categories.map((c) => [
    c,
    inventory.filter((i) => readFileSync(join(root, i.path), "utf8").includes(c))
      .length,
  ]),
);
mkdirSync(join(root, ".release"), { recursive: true });
writeFileSync(
  join(root, ".release/scan.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      files: inventory,
      bundleInputs: Object.keys(meta.inputs).length,
      categoryFileCounts: counts,
      reviewedNegativeAssertions: reviewed,
      findings,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    files: inventory.length,
    bundleInputs: Object.keys(meta.inputs).length,
    findings,
  }),
);
assert.equal(
  findings.length,
  0,
  "Release content scan failed; findings contain paths/codes only",
);
