import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertPublicImports,
  exportedNames,
} from "../../public-protocol/test/public-boundary.mjs";
const packages = resolve(import.meta.dirname, "../..");
test("hosted client and CLI source and declarations use only public dependencies", () => {
  const allowed = new Set([
    "@breaklint/public-protocol",
    "@breaklint/public-protocol/internal",
    "@breaklint/public-config",
    "@breaklint/hosted-client",
    "commander",
    "ignore",
    "zod",
    "typescript",
    "@types/node",
  ]);
  for (const name of ["hosted-client", "cli"]) {
    const root = resolve(packages, name);
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest.exports), ["."]);
    for (const group of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ])
      for (const dep of Object.keys(manifest[group] ?? {}))
        assert.ok(allowed.has(dep), dep);
    assertPublicImports(root, allowed, ["src", "dist"]);
  }
});
test("hosted client and CLI supported exports match the API snapshot", () => {
  const snapshots = {
    "hosted-client": [
      "CAPABILITIES",
      "HostedClientError",
      "HostedResponse",
      "PreparedAnalysis",
      "createHostedClient",
      "prepareAnalysis",
      "validateHostedResponse",
    ],
    cli: [
      "AnalysisRequest",
      "AnalysisResult",
      "PublicAnalysisPolicy",
      "PublicFinding",
      "UserConfig",
      "defineConfig",
      "projectPolicy",
    ],
  };
  for (const [name, expected] of Object.entries(snapshots)) {
    const entry = resolve(packages, name, "dist/index.d.ts");
    assert.deepEqual(exportedNames(entry), expected);
  }
});
