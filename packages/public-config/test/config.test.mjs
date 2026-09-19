import { test } from "node:test";
import assert from "node:assert/strict";
import { defineConfig, validateConfig, projectPolicy } from "../dist/index.js";

test("default policy expands every required wire field", () => {
  assert.deepEqual(projectPolicy(), {
    policySchemaVersion: "1.0",
    scope: { kind: "repository", selectionProfile: "authored-source-1" },
    transferExclusions: [],
    rules: [],
    gate: { changes: "introduced-or-worsened", minimumSeverity: "warning" },
  });
  assert.deepEqual(projectPolicy("{}"), projectPolicy());
  assert.ok(Object.isFrozen(defineConfig({}).gate));
});
test("independent config accepts only declarative user choices", () => {
  const config = {
    rules: [
      {
        ruleId: "responsive.clipped-layout-pressure",
        enabled: true,
        severity: "error",
      },
    ],
  };
  assert.deepEqual(validateConfig(config).rules, config.rules);
  for (const key of [
    "root",
    "env",
    "credentials",
    "providers",
    "solver",
    "thresholds",
    "scheduler",
    "runtime",
    "ai",
    "repair",
    "extends",
    "module",
    "policySchemaVersion",
  ])
    assert.throws(() => projectPolicy({ [key]: "x" }));
  let executed = false;
  assert.throws(() =>
    projectPolicy({
      get rules() {
        executed = true;
        return [];
      },
    }),
  );
  assert.equal(executed, false);
  assert.throws(() => projectPolicy('{"rules":[],"rules":[]}'));
  assert.throws(() =>
    projectPolicy({
      rules: [
        {
          ruleId: "responsive.clipped-layout-pressure",
          enabled: false,
          severity: "error",
        },
      ],
    }),
  );
});
