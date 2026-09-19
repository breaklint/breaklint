import type {
  AnalysisRequest,
  AnalysisResult,
  PublicFinding,
  PublicAnalysisPolicy,
} from "../src/index.js";
// @ts-expect-error Wire helpers are not supported imports.
import type { RevisionSourcePackage } from "../src/index.js";
declare const policy: PublicAnalysisPolicy;
declare const request: AnalysisRequest;
declare const result: AnalysisResult;
declare const finding: PublicFinding;
// @ts-expect-error Nested policy collections are readonly.
policy.rules[0] = {
  ruleId: "responsive.clipped-layout-pressure",
  enabled: true,
  severity: "default",
};
// @ts-expect-error Revisions cannot be mutated.
request.comparison.base.commit = "0".repeat(40);
// @ts-expect-error Locations are readonly.
finding.locations[0].start.line = 5;
// @ts-expect-error Optional fields must be omitted, not explicitly undefined.
const comparison: AnalysisRequest["comparison"] = {
  base: request.comparison.base,
  rawHead: request.comparison.rawHead,
  pullRequest: undefined,
};
// @ts-expect-error No runtime fields in v1.
void result.runtime;
void comparison;
export type UnsupportedImportMustFail = RevisionSourcePackage;
