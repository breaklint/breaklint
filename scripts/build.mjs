import { execFileSync } from "node:child_process";
const check = process.argv.includes("--check");
for (const name of [
  "public-protocol",
  "public-config",
  "hosted-client",
  "cli",
  "github-action",
]) {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      `packages/${name}/tsconfig.json`,
      ...(check ? ["--noEmit"] : []),
    ],
    { stdio: "inherit" },
  );
}
if (check)
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "packages/public-protocol/tsconfig.tests.json",
    ],
    { stdio: "inherit" },
  );
else
  execFileSync(process.execPath, ["scripts/bundle-action.mjs"], { stdio: "inherit" });
