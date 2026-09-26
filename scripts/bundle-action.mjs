#!/usr/bin/env node
/** Bundle only the public source-native Action graph. */
import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageRoot = path.join(root, "packages", "github-action");
const outDir = path.join(packageRoot, "dist-bundle");
const outFile = path.join(outDir, "index.js");

const EXTERNAL = [];

const banner = `// Breaklint GitHub Action — generated bundle, do not edit.
// Copyright © 2026 Breaklint. Apache-2.0; see LICENSE.md and NOTICE.
// Built from packages/github-action. Regenerate with \`pnpm action:bundle\`.
import { createRequire as breaklintCreateRequire } from "node:module";
import { dirname as breaklintDirname } from "node:path";
import { fileURLToPath as breaklintFileURLToPath } from "node:url";
const require = breaklintCreateRequire(import.meta.url);
const __filename = breaklintFileURLToPath(import.meta.url);
const __dirname = breaklintDirname(__filename);
`;

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await build({
  entryPoints: [path.join(packageRoot, "src", "action-main.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: { js: banner },
  external: EXTERNAL,
  // The action is read by humans when it misbehaves on a runner; a readable
  // bundle costs a few hundred kilobytes of an artifact nobody downloads.
  minify: false,
  sourcemap: false,
  legalComments: "eof",
  metafile: true,
  logLevel: "warning",
});

const approved = new Set([
  "github-action",
  "hosted-client",
  "public-config",
  "public-protocol",
]);
for (const input of Object.keys(result.metafile.inputs)) {
  const match = /(?:^|\/)packages\/([^/]+)\//.exec(input);
  if (match && !approved.has(match[1]))
    throw new Error(`Private bundle input: ${input}`);
  if (/playwright|chromium/i.test(input))
    throw new Error(`Browser bundle input: ${input}`);
}
await writeFile(
  path.join(outDir, "metafile.json"),
  JSON.stringify(result.metafile, null, 2),
);
const bytes = Object.values(result.metafile.outputs).reduce(
  (total, output) => total + output.bytes,
  0,
);

// Root Action distribution is committed and runs without package installation.
const distribution = path.join(root, "action");
await mkdir(path.join(distribution, "dist"), { recursive: true });
const { copyFile } = await import("node:fs/promises");
await copyFile(outFile, path.join(distribution, "dist/index.js"));
await writeFile(
  path.join(distribution, "package.json"),
  JSON.stringify(
    {
      type: "module",
      private: true,
      version: "0.1.0",
      license: "Apache-2.0",
      repository: {
        type: "git",
        url: "git+https://github.com/breaklint/breaklint.git",
        directory: "action",
      },
      homepage: "https://github.com/breaklint/breaklint#readme",
      bugs: { url: "https://github.com/breaklint/breaklint/issues" },
    },
    null,
    2,
  ) + "\n",
);
await copyFile(
  path.join(packageRoot, "action.yml"),
  path.join(distribution, "action.yml"),
);

console.log(
  `Bundled the Breaklint action: ${(bytes / 1024).toFixed(0)} KB at ${path.relative(root, outFile)}`,
);
console.log("No external runtime dependencies; no browser installation.");
