import { z } from "zod";
import type { PublicAnalysisPolicy } from "@breaklint/public-protocol";
import {
  canonicalize,
  parseJson,
  parsePolicy,
  scope,
  exclusion,
  override,
  gate,
  V1_LIMITS,
} from "@breaklint/public-protocol/internal";

/** Declarative analysis choices only. Local behavior and authentication use separate channels. */
export interface UserConfig {
  readonly scope?: PublicAnalysisPolicy["scope"];
  readonly transferExclusions?: PublicAnalysisPolicy["transferExclusions"];
  readonly rules?: PublicAnalysisPolicy["rules"];
  readonly gate?: PublicAnalysisPolicy["gate"];
}
const config = z.strictObject({
  scope: scope.optional(),
  transferExclusions: z.array(exclusion).max(V1_LIMITS.exclusions).optional(),
  rules: z.array(override).max(V1_LIMITS.ruleOverrides).optional(),
  gate: gate.optional(),
});
export function projectPolicy(input: unknown = {}): PublicAnalysisPolicy {
  try {
    const data =
      typeof input === "string" || input instanceof Uint8Array
        ? parseJson(input, V1_LIMITS.policyBytes)
        : input;
    canonicalize(data, true, V1_LIMITS.policyBytes);
    const parsed = config.parse(data);
    return parsePolicy({
      policySchemaVersion: "1.0",
      scope: parsed.scope ?? {
        kind: "repository",
        selectionProfile: "authored-source-1",
      },
      transferExclusions: parsed.transferExclusions ?? [],
      rules: parsed.rules ?? [],
      gate: parsed.gate ?? {
        changes: "introduced-or-worsened",
        minimumSeverity: "warning",
      },
    });
  } catch {
    throw new Error("INVALID_POLICY");
  }
}
export function defineConfig(input: UserConfig): UserConfig {
  return validateConfig(input);
}
export function validateConfig(input: unknown): UserConfig {
  const policy = projectPolicy(input);
  return Object.freeze({
    scope: policy.scope,
    transferExclusions: policy.transferExclusions,
    rules: policy.rules,
    gate: policy.gate,
  });
}
