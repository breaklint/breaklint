import { test } from "node:test";
import assert from "node:assert/strict";
import { createHostedClient, validateHostedResponse } from "../dist/index.js";
import { projectPolicy } from "../../public-config/dist/index.js";
import { fixture, finding } from "../../public-protocol/test/fixtures.mjs";

test("URL and policy rejections do not retain rejected credentials or local paths", () => {
  const marker = "synthetic-sensitive-marker";
  for (const endpoint of [
    `invalid:${marker}:\\`,
    `https://user:${marker}@fixture.invalid`,
    `https://fixture.invalid/?token=${marker}`,
    `https://fixture.invalid/#${marker}`,
  ]) {
    assert.throws(
      () => createHostedClient({ endpoint, token: marker }),
      (error) =>
        !JSON.stringify(error).includes(marker) && !error.message.includes(marker),
    );
  }
  for (const config of [
    { token: marker },
    { transferExclusions: [{ kind: "file", path: "/" + "Users/synthetic/secret" }] },
    `{"gate":{},"gate":{"token":"${marker}"}}`,
  ])
    assert.throws(
      () => projectPolicy(config),
      (error) =>
        error.message === "INVALID_POLICY" && !JSON.stringify(error).includes(marker),
    );
});
test("adversarial result text and paths are rejected before CLI or Action rendering", () => {
  for (const hostile of [
    "https://user:synthetic-password@fixture.invalid/a",
    "/" + "Users/synthetic/private.ts",
    "/" + "tmp/synthetic/file.ts",
    "C:" + "\\synthetic\\file.ts",
    "ghp_" + "S".repeat(30),
    "-----BEGIN " + "PRIVATE KEY-----",
    "Error\n    at call (synthetic.ts:1:2)",
  ]) {
    for (const field of ["title", "message"]) {
      const f = fixture();
      const item = finding(f);
      item[field] = hostile;
      f.result.findings = [item];
      f.result.outcome = {
        status: "complete",
        conclusion: "fail",
        reason: "GATING_FINDINGS",
      };
      assert.throws(
        () =>
          validateHostedResponse(
            { result: f.result, missingBlobs: [] },
            { request: f.request, sourcePackage: f.sourcePackage, bodies: f.bodies },
          ),
        (error) => error.message === "INVALID_PAYLOAD",
      );
    }
  }
  for (const path of [
    "../secret.ts",
    "/" + "Users/synthetic/source.ts",
    "C:" + "\\synthetic\\source.ts",
  ]) {
    const f = fixture();
    const item = finding(f);
    item.locations[0].path = path;
    f.result.findings = [item];
    f.result.outcome = {
      status: "complete",
      conclusion: "fail",
      reason: "GATING_FINDINGS",
    };
    assert.throws(() =>
      validateHostedResponse(
        { result: f.result, missingBlobs: [] },
        { request: f.request, sourcePackage: f.sourcePackage, bodies: f.bodies },
      ),
    );
  }
});
