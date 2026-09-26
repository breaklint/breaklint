import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, "..");
const installedStore = JSON.parse(
  readFileSync(join(root, "node_modules/.modules.yaml"), "utf8"),
).storeDir;
const out = join(root, ".release/packs");
mkdirSync(out, { recursive: true });
const consumer = mkdtempSync(join(tmpdir(), "breaklint-consumer-"));
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CI: "true",
  npm_config_userconfig: "/dev/null",
  npm_config_registry: "https://registry.npmjs.org/",
};
const run = (cmd, args, cwd = consumer) =>
  execFileSync(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120000,
  });
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
try {
  const archives = [];
  const receipts = [];
  for (const name of [
    "public-protocol",
    "public-config",
    "hosted-client",
    "cli",
    "github-action",
  ]) {
    const tar = join(out, name + ".tgz");
    run("pnpm", ["pack", "--out", tar], join(root, "packages", name));
    const paths = run("tar", ["-tzf", tar]).trim().split("\n");
    assert(
      paths.every((p) =>
        /^package\/(?:package.json|README.md|THIRD_PARTY_NOTICES.md|Unicode-License.txt|dist\/[a-z-]+\.(?:js|d.ts)|bin\/breaklint.js)$/.test(
          p,
        ),
      ),
      "Archive file outside allowlist",
    );
    const dest = join(consumer, "inspection", name);
    mkdirSync(dest, { recursive: true });
    run("tar", ["-xzf", tar, "--strip-components=1", "-C", dest]);
    const manifest = JSON.parse(readFileSync(join(dest, "package.json"), "utf8"));
    assert.equal(manifest.name, `@breaklint/${name}`);
    if (name === "cli") assert.equal(manifest.bin.breaklint, "./bin/breaklint.js");
    assert.equal(
      readFileSync(join(dest, "Unicode-License.txt"), "utf8"),
      readFileSync(join(root, "Unicode-License.txt"), "utf8"),
    );
    for (const file of files(dest)) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(
        text,
        /@breaklint\/(?:core|browser|source-analysis|responsive-domain|responsive-analyzers|responsive-solver|finding-intelligence|pr-causality|source-attribution|confidence-model|noise-suppression|repair|source-repair|incremental-analysis|worker|platform|database|storage|queue)(?:["/'\s]|$)/,
      );
      assert.doesNotMatch(
        text,
        /\/Users\/|\/private\/tmp\/|sourceMappingURL|workspace:\*/,
      );
    }
    receipts.push({
      package: name,
      sha256: createHash("sha256").update(readFileSync(tar)).digest("hex"),
      files: paths,
    });
    if (name !== "github-action") archives.push(tar);
  }
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "synthetic-public-consumer",
      private: true,
      type: "module",
    }),
  );
  writeFileSync(
    join(consumer, "pnpm-workspace.yaml"),
    "overrides:\n" +
      ["public-protocol", "public-config", "hosted-client"]
        .map((name) => `  '@breaklint/${name}': 'file:${join(out, name + ".tgz")}'`)
        .join("\n") +
      "\n",
  );
  run("pnpm", [
    "add",
    "--offline",
    "--ignore-scripts",
    "--store-dir",
    installedStore,
    ...archives,
  ]);
  run("pnpm", [
    "add",
    "--offline",
    "--ignore-scripts",
    "--save-dev",
    "--store-dir",
    installedStore,
    "@types/node@22.20.1",
  ]);
  const cli = join(consumer, "node_modules/@breaklint/cli/bin/breaklint.js");
  assert.match(run(process.execPath, [cli, "--help"]), /--base/);
  assert.equal(
    run(process.execPath, [cli, "--version"]).trim(),
    JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).version,
  );
  assert.match(
    run("npx", ["--offline", "--no-install", "breaklint", "--help"]),
    /--repository/,
  );
  writeFileSync(
    join(consumer, "consumer.mjs"),
    `import assert from 'node:assert/strict';import * as protocol from '@breaklint/public-protocol';import {defineConfig,projectPolicy} from '@breaklint/cli';import * as config from '@breaklint/public-config';import * as client from '@breaklint/hosted-client';assert.deepEqual(Object.keys(protocol),[]);assert.equal(projectPolicy(defineConfig({})).scope.kind,'repository');assert.equal(typeof client.prepareAnalysis,'function');assert.deepEqual(Object.keys(config).sort(),['defineConfig','projectPolicy','validateConfig']);try{await import('@breaklint/public-protocol/dist/schemas.js');assert.fail('deep import accepted')}catch(e){assert.equal(e.code,'ERR_PACKAGE_PATH_NOT_EXPORTED')}`,
  );
  run(process.execPath, ["consumer.mjs"]);
  writeFileSync(
    join(consumer, "consumer.ts"),
    `import {defineConfig,projectPolicy,type UserConfig} from '@breaklint/cli';import type {AnalysisRequest,AnalysisResult,PublicFinding,PublicAnalysisPolicy} from '@breaklint/public-protocol';import {createHostedClient,prepareAnalysis} from '@breaklint/hosted-client';const config:UserConfig=defineConfig({});const policy:PublicAnalysisPolicy=projectPolicy(config);void policy;void createHostedClient;void prepareAnalysis;export type Result=[AnalysisRequest,AnalysisResult,PublicFinding];\n// @ts-expect-error no wire helper at public root\nimport type {RevisionSourcePackage} from '@breaklint/public-protocol';\n// @ts-expect-error no private deep-import promise\nimport type {HostedResponse} from '@breaklint/hosted-client/dist/client.js';`,
  );
  run(process.execPath, [
    join(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2023",
    "--types",
    "node",
    "consumer.ts",
  ]);
  copyFileSync(
    join(root, "examples/define-config.mjs"),
    join(consumer, "define-config.mjs"),
  );
  run(process.execPath, ["define-config.mjs"]);
  assert.equal(
    JSON.parse(readFileSync(join(consumer, "breaklint.policy.json"))).gate
      .minimumSeverity,
    "warning",
  );
  run("git", ["init", "-q"]);
  run("git", ["config", "user.name", "Synthetic fixture"]);
  run("git", ["config", "user.email", "synthetic@example.invalid"]);
  writeFileSync(
    join(consumer, "App.tsx"),
    "export const App = () => <div>synthetic</div>;\n",
  );
  run("git", ["add", "App.tsx"]);
  run("git", ["commit", "-qm", "Synthetic base"]);
  const base = run("git", ["rev-parse", "HEAD"]).trim();
  run("git", ["commit", "--allow-empty", "-qm", "Synthetic head"]);
  writeFileSync(
    join(consumer, "transport.mjs"),
    `import {CAPABILITIES} from '@breaklint/hosted-client';import {requestDigest,RULE_IDS} from '@breaklint/public-protocol/internal';globalThis.fetch=async(url,init)=>{if(new URL(url).pathname==='/capabilities')return Response.json({versions:[CAPABILITIES]});const {request:q}=JSON.parse(init.body);const time=Math.floor(Date.now()/1000)*1000;const iso=t=>new Date(t).toISOString().replace('.000Z','Z');return Response.json({missingBlobs:[],result:{protocolVersion:'1.0',resultSchemaVersion:'1.0',runId:'synthetic',binding:{requestId:q.requestId,requestDigest:requestDigest(q),manifestDigest:q.source.manifestDigest,policyDigest:q.policyDigest,repository:q.repository,requested:{base:q.comparison.base,rawHead:q.comparison.rawHead}},acceptedAt:iso(time),deadlineAt:iso(time+1800000),idempotencyExpiresAt:iso(time+86400000),state:'terminal',completedAt:iso(time),outcome:{status:'complete',conclusion:'pass',reason:'NO_GATING_FINDINGS'},provenance:{state:'verified',method:'descendant',association:'client-submitted',base:q.comparison.base,effectiveHead:q.comparison.rawHead},analyzed:{base:q.comparison.base,effectiveHead:q.comparison.rawHead},scope:{declared:q.policy.scope,coverage:'complete',enabledRules:RULE_IDS,baseFilesAnalyzed:1,effectiveHeadFilesAnalyzed:1},findings:[],findingsComplete:true,limitations:[]}})};`,
  );
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "./transport.mjs",
      cli,
      "--base",
      base,
      "--repository",
      "synthetic",
      "--service",
      "https://fixture.invalid",
      "--config",
      "breaklint.policy.json",
      "--json",
    ],
    {
      cwd: consumer,
      encoding: "utf8",
      env: { ...env, BREAKLINT_TOKEN: "synthetic" },
      stdio: "pipe",
    },
  );
  assert.equal(JSON.parse(output).outcome.conclusion, "pass");
  const npxOutput = execFileSync(
    "npx",
    [
      "--offline",
      "--no-install",
      "breaklint",
      "--base",
      base,
      "--repository",
      "synthetic",
      "--service",
      "https://fixture.invalid",
      "--json",
    ],
    {
      cwd: consumer,
      encoding: "utf8",
      env: {
        ...env,
        BREAKLINT_TOKEN: "synthetic",
        NODE_OPTIONS: "--import=" + join(consumer, "transport.mjs"),
      },
      stdio: "pipe",
    },
  );
  assert.equal(JSON.parse(npxOutput).outcome.conclusion, "pass");
  writeFileSync(
    join(root, ".release/artifacts.json"),
    JSON.stringify(
      {
        node: process.version,
        archives: receipts,
        consumer: {
          installed: true,
          js: true,
          types: true,
          defineConfig: true,
          npx: true,
          syntheticHostedFlow: true,
        },
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Five archives inspected; four installed into an empty consumer. JS, declarations, defineConfig, npx help and synthetic hosted CLI/npx passed on ${process.version}.`,
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
