import { z } from "zod";
import { foldPath } from "./case-fold.js";
import { V1_LIMITS as L } from "./limits.js";
import { sensitiveContent } from "./selection.js";

const integer = (max = Number.MAX_SAFE_INTEGER, min = 0) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .refine((n) => !Object.is(n, -0));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const gitId = z.string().regex(/^[a-f0-9]{40}$/);
const opaque = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  .refine(
    (s) =>
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString() === s.replace("Z", ".000Z"),
  );
const requestId = z
  .string()
  .regex(/^\d{8}T\d{6}Z_[a-f0-9]{32}$/)
  .refine(
    (s) =>
      timestamp.safeParse(
        `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`,
      ).success,
  );
export const path = z
  .string()
  .min(1)
  .refine((s) => {
    if (
      s !== s.normalize("NFC") ||
      Buffer.byteLength(s) > L.pathBytes ||
      /[\\:\p{Cc}]/u.test(s)
    )
      return false;
    const parts = s.split("/");
    return (
      parts.length <= L.pathComponents &&
      parts.every(
        (p) =>
          p.length > 0 &&
          Buffer.byteLength(p) <= L.componentBytes &&
          p !== "." &&
          p !== ".." &&
          foldPath(p) !== ".git" &&
          !/[. ]$/.test(p) &&
          !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p),
      )
    );
  });
const repository = z.union([
  z.strictObject({
    kind: z.literal("github"),
    host: z.literal("github.com"),
    repositoryId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  }),
  z.strictObject({ kind: z.literal("registered"), repositoryId: opaque }),
]);
const revision = z.strictObject({ repository, commit: gitId });
export const scope = z.strictObject({
  kind: z.literal("repository"),
  selectionProfile: z.literal("authored-source-1"),
});
export const RULE_IDS = [
  "responsive.automatic-minimum-content-pressure",
  "responsive.clipped-layout-pressure",
  "responsive.dynamic-nowrap-control",
  "responsive.media-width-resilience",
  "responsive.scroll-contained-structural-pressure",
  "responsive.uncontained-layout-pressure",
  "responsive.unresolved-layout-pressure-consequence",
  "responsive.unsatisfiable-sizing",
] as const;
const ruleId = z.enum(RULE_IDS);
const severity = z.enum(["info", "warning", "error"]);
export const exclusion = z.strictObject({ kind: z.enum(["file", "directory"]), path });
export const override = z
  .strictObject({
    ruleId,
    enabled: z.boolean(),
    severity: z.enum(["default", "info", "warning", "error"]),
  })
  .refine((r) => r.enabled || r.severity === "default");
export const gate = z.strictObject({
  changes: z.literal("introduced-or-worsened"),
  minimumSeverity: z.enum(["warning", "error"]),
});
export const policySchema = z.strictObject({
  policySchemaVersion: z.literal("1.0"),
  scope,
  transferExclusions: z.array(exclusion).max(L.exclusions),
  rules: z.array(override).max(L.ruleOverrides),
  gate,
});
const blob = z.strictObject({ sha256: digest, byteLength: integer(L.sourceBlobBytes) });
const membership = z.union([
  z.strictObject({
    state: z.literal("included"),
    path,
    mode: z.enum(["100644", "100755"]),
    gitObject: gitId,
    content: blob,
  }),
  z.strictObject({
    state: z.literal("excluded"),
    path,
    mode: z.string().regex(/^[0-7]{1,6}$/),
    gitObject: gitId,
    reason: z.enum([
      "sensitive",
      "user-excluded",
      "revision-ignored",
      "profile-excluded",
      "unsupported-extension",
      "binary",
      "symlink",
      "submodule",
      "lfs-pointer",
      "nonregular",
    ]),
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    path,
    mode: z.string().regex(/^[0-7]{1,6}$/),
    gitObject: gitId,
    reason: z.enum(["object-missing", "read-denied"]),
  }),
]);
const snapshot = z.strictObject({
  revision,
  purpose: z.enum(["base", "raw-head", "merge-input", "effective-candidate"]),
  rootTree: gitId,
  files: z.array(membership).max(L.leavesPerSnapshot),
  accounting: z.strictObject({
    enumeratedLeaves: integer(L.leavesPerSnapshot),
    includedFiles: integer(L.leavesPerSnapshot),
    includedBytes: integer(L.sourceBytesPerSnapshot),
    excludedFiles: integer(L.leavesPerSnapshot),
    unavailableFiles: integer(L.leavesPerSnapshot),
  }),
});
export const manifestSchema = z.strictObject({
  packageSchemaVersion: z.literal("1.0"),
  gitObjectFormat: z.literal("sha1"),
  repository,
  requested: z.strictObject({ base: revision, rawHead: revision }),
  scope,
  transferPolicyDigest: digest,
  snapshots: z.array(snapshot).min(2).max(L.snapshots),
  blobs: z.array(blob).max(L.sourceBlobs + L.proofObjects),
  proof: z.strictObject({
    encoding: z.literal("git-object-bodies-1"),
    objects: z
      .array(
        z.strictObject({
          kind: z.enum(["commit", "tree"]),
          gitObject: gitId,
          content: blob,
        }),
      )
      .max(L.proofObjects),
  }),
  effectiveCandidate: revision.optional(),
  changeHints: z
    .array(
      z.union([
        z.strictObject({ kind: z.literal("deletion"), oldPath: path }),
        z.strictObject({ kind: z.literal("rename"), oldPath: path, newPath: path }),
      ]),
    )
    .max(L.changeHints),
});
export const packageSchema = z.strictObject({
  manifest: manifestSchema,
  manifestDigest: digest,
});
export const requestSchema = z.strictObject({
  protocolVersion: z.literal("1.0"),
  requestSchemaVersion: z.literal("1.0"),
  resultSchemaVersion: z.literal("1.0"),
  requestId,
  repository,
  comparison: z.strictObject({
    base: revision,
    rawHead: revision,
    pullRequest: z.strictObject({ number: integer(2147483647, 1) }).optional(),
  }),
  source: z.strictObject({
    packageSchemaVersion: z.literal("1.0"),
    manifestDigest: digest,
  }),
  policy: policySchema,
  policyDigest: digest,
});
const position = z.strictObject({
  line: integer(L.position, 1),
  column: integer(L.position, 1),
});
const location = z
  .strictObject({ revision, path, start: position, end: position })
  .refine(
    (l) =>
      l.start.line < l.end.line ||
      (l.start.line === l.end.line && l.start.column <= l.end.column),
  );
const text = (max: number) =>
  z
    .string()
    .min(1)
    .refine(
      (s) =>
        Buffer.byteLength(s) <= max &&
        !sensitiveContent(s) &&
        !/(?:https?:|file:|s3:|gs:)\/\/|(?:\/Users\/|\/home\/|\/(?:private\/)?tmp\/|[A-Za-z]:[\\/])|(?:^|\n)\s*at \S+.*\([^)]*:\d+:\d+\)/i.test(
          s,
        ) &&
        Array.from(s).every(
          (c) =>
            (c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) ||
            ["\t", "\n", "\r"].includes(c),
        ),
    );
export const findingSchema = z.strictObject({
  findingId: opaque,
  ruleId,
  severity,
  title: text(L.titleBytes),
  message: text(L.messageBytes),
  qualification: z.enum(["proven", "supported", "uncertain"]),
  disposition: z.enum([
    "introduced",
    "worsened",
    "existing",
    "improved",
    "resolved",
    "unknown",
  ]),
  gating: z.enum(["blocking", "nonblocking", "unresolved"]),
  locations: z.array(location).max(L.locations),
  inline: z.union([
    z.strictObject({
      eligible: z.literal(false),
      reason: z.enum([
        "unproven-mapping",
        "outside-diff",
        "no-location",
        "not-provider-confirmed",
      ]),
    }),
    z.strictObject({
      eligible: z.literal(true),
      target: location,
      side: z.enum(["base", "raw-head"]),
    }),
  ]),
});
const outcome = z.union([
  z.strictObject({
    status: z.literal("complete"),
    conclusion: z.enum(["pass", "fail"]),
    reason: z.enum(["NO_GATING_FINDINGS", "GATING_FINDINGS"]),
  }),
  z.strictObject({
    status: z.literal("limited"),
    conclusion: z.enum(["inconclusive", "fail"]),
    reason: z.enum(["COVERAGE_INCOMPLETE", "GATING_FINDINGS", "OUTPUT_LIMIT"]),
  }),
  z.strictObject({
    status: z.literal("unsupported"),
    conclusion: z.literal("inconclusive"),
    reason: z.enum(["UNSUPPORTED_SOURCE", "REQUIRED_SOURCE_EXCLUDED"]),
  }),
  z.strictObject({
    status: z.literal("indeterminate"),
    conclusion: z.literal("inconclusive"),
    reason: z.enum([
      "EFFECTIVE_HEAD_UNPROVEN",
      "ANCESTRY_INCOMPLETE",
      "MERGE_CONFLICT",
      "REPOSITORY_ASSOCIATION_UNPROVEN",
    ]),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    conclusion: z.literal("inconclusive"),
    reason: z.enum(["SERVICE_UNAVAILABLE", "ACCESS_UNAVAILABLE"]),
  }),
  z.strictObject({
    status: z.literal("failed"),
    conclusion: z.literal("inconclusive"),
    reason: z.enum([
      "INVALID_INPUT",
      "INTEGRITY_MISMATCH",
      "LIMIT_EXCEEDED",
      "DEADLINE_EXCEEDED",
      "INTERNAL_FAILURE",
    ]),
  }),
  z.strictObject({
    status: z.literal("cancelled"),
    conclusion: z.literal("inconclusive"),
    reason: z.literal("CANCELLED"),
  }),
]);
const pair = { base: revision, effectiveHead: revision };
const provenance = z.union([
  z.strictObject({
    state: z.literal("unproven"),
    reason: z.enum([
      "not-established",
      "ancestry-incomplete",
      "merge-conflict",
      "association-unproven",
      "effective-candidate-invalid",
    ]),
  }),
  z.strictObject({
    state: z.literal("verified"),
    method: z.enum(["descendant", "service-derived-merge", "provider-verified-merge"]),
    association: z.enum(["provider-confirmed", "client-submitted"]),
    ...pair,
  }),
]);
const envelope = {
  protocolVersion: z.literal("1.0"),
  resultSchemaVersion: z.literal("1.0"),
  runId: opaque,
  binding: z.strictObject({
    requestId,
    requestDigest: digest,
    manifestDigest: digest,
    policyDigest: digest,
    repository,
    requested: z.strictObject({ base: revision, rawHead: revision }),
  }),
  acceptedAt: timestamp,
  deadlineAt: timestamp,
  idempotencyExpiresAt: timestamp,
};
export const resultSchema = z.union([
  z.strictObject({
    ...envelope,
    state: z.enum(["uploading", "queued", "running", "cancelling"]),
    pollAfterSeconds: integer(L.pollMaxSeconds, L.pollMinSeconds),
  }),
  z.strictObject({
    ...envelope,
    state: z.literal("terminal"),
    completedAt: timestamp,
    outcome,
    provenance,
    analyzed: z.strictObject(pair).optional(),
    scope: z.strictObject({
      declared: scope,
      coverage: z.enum(["complete", "partial", "none"]),
      enabledRules: z.array(ruleId).min(1).max(8),
      baseFilesAnalyzed: integer(L.leavesPerSnapshot),
      effectiveHeadFilesAnalyzed: integer(L.leavesPerSnapshot),
    }),
    findings: z.array(findingSchema).max(L.findings),
    findingsComplete: z.boolean(),
    limitations: z
      .array(
        z.strictObject({
          code: z.enum([
            "REQUIRED_SOURCE_EXCLUDED",
            "SOURCE_UNAVAILABLE",
            "UNSUPPORTED_SOURCE",
            "UNSUPPORTED_METADATA",
            "PROOF_INCOMPLETE",
            "MERGE_UNPROVEN",
            "FINDING_QUALIFICATION_UNRESOLVED",
            "OUTPUT_LIMIT",
          ]),
          impact: z.enum(["coverage", "comparison", "presentation"]),
          revision: revision.optional(),
          path: path.optional(),
          affectedCount: integer(),
        }),
      )
      .max(L.limitations),
  }),
]);
const neverCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "ACCESS_UNAVAILABLE",
  "INVALID_PAYLOAD",
  "INVALID_POLICY",
  "INVALID_PATH",
  "INVALID_INPUT",
  "INTEGRITY_MISMATCH",
  "IDEMPOTENCY_CONFLICT",
  "UNSUPPORTED_PROTOCOL",
  "UNSUPPORTED_SCHEMA",
  "UNSUPPORTED_OBJECT_FORMAT",
  "UNSUPPORTED_PROOF",
  "LIMIT_EXCEEDED",
  "PROOF_PRIVACY_BLOCKED",
  "RUN_NOT_FOUND",
  "REQUEST_EXPIRED",
] as const;
export const errorSchema = z.union([
  z.strictObject({
    errorSchemaVersion: z.literal("1.0"),
    code: z.enum(neverCodes),
    retry: z.literal("never"),
  }),
  z.strictObject({
    errorSchemaVersion: z.literal("1.0"),
    code: z.enum(["RATE_LIMITED", "SERVICE_UNAVAILABLE"]),
    retry: z.literal("same-request"),
    retryAfterSeconds: integer(60, 1).optional(),
  }),
  z.strictObject({
    errorSchemaVersion: z.literal("1.0"),
    code: z.enum(["DEADLINE_EXCEEDED", "INTERNAL_FAILURE"]),
    retry: z.literal("new-attempt"),
    retryAfterSeconds: integer(60, 1).optional(),
  }),
]);
export type ReadonlyJson<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyJson<Exclude<T[K], undefined>> }
  : T;
export type PublicAnalysisPolicy = ReadonlyJson<z.infer<typeof policySchema>>;
export type AnalysisRequest = ReadonlyJson<z.infer<typeof requestSchema>>;
export type AnalysisResult = ReadonlyJson<z.infer<typeof resultSchema>>;
export type PublicFinding = ReadonlyJson<z.infer<typeof findingSchema>>;
