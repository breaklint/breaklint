import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertPublicImports, exportedNames } from "./public-boundary.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("public source, synthetic tests and emitted declarations have only allowlisted dependencies", () => {
  // No monorepo configuration, paths, project references or private test utilities.
  // This test runs from the two-package tree without a proprietary checkout.
  for (const name of ["public-protocol", "public-config"]) {
    const dir = resolve(root, "..", name);
    const manifest = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
    const allowed = new Set([
      "zod",
      "typescript",
      "@types/node",
      ...(name === "public-config"
        ? ["@breaklint/public-protocol", "@breaklint/public-protocol/internal"]
        : []),
    ]);
    for (const group of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ])
      for (const dep of Object.keys(manifest[group] ?? {}))
        assert.ok(allowed.has(dep), dep);
    const config = JSON.parse(readFileSync(resolve(dir, "tsconfig.json"), "utf8"));
    assert.equal(config.extends, undefined);
    assert.equal(config.references, undefined);
    assert.equal(config.compilerOptions.paths, undefined);
    assert.deepEqual(
      Object.keys(manifest.exports),
      name === "public-protocol" ? [".", "./internal"] : ["."],
    );
    assertPublicImports(dir, allowed, ["src", "dist", "test"]);
    const entryPath = resolve(dir, "dist/index.d.ts");
    assert.deepEqual(
      exportedNames(entryPath),
      name === "public-protocol"
        ? ["AnalysisRequest", "AnalysisResult", "PublicAnalysisPolicy", "PublicFinding"]
        : ["UserConfig", "defineConfig", "projectPolicy", "validateConfig"],
    );
    const entry = readFileSync(entryPath, "utf8");
    if (name === "public-protocol") {
      const ast = ts.createSourceFile(
        "index.d.ts",
        entry,
        ts.ScriptTarget.Latest,
        true,
      );
      assert.ok(
        ast.statements.every(
          (declaration) =>
            ts.isExportDeclaration(declaration) &&
            declaration.isTypeOnly &&
            ts.isNamedExports(declaration.exportClause),
        ),
      );
    }
  }
});
