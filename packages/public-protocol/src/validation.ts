import { createHash } from "node:crypto";
import type { z } from "zod";
import { canonicalize, check, invalid, parseJson } from "./json.js";
import { foldPath } from "./case-fold.js";
import { V1_LIMITS as L } from "./limits.js";
import {
  errorSchema,
  findingSchema,
  manifestSchema,
  packageSchema,
  policySchema,
  requestSchema,
  resultSchema,
  RULE_IDS,
} from "./schemas.js";
import type {
  AnalysisRequest,
  AnalysisResult,
  PublicAnalysisPolicy,
  PublicFinding,
  ReadonlyJson,
} from "./schemas.js";

function freeze<T>(v: T): ReadonlyJson<T> {
  if (v && typeof v === "object") {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v as ReadonlyJson<T>;
}
function validate<T>(schema: z.ZodType<T>, input: unknown, maxBytes: number): T {
  try {
    const value =
      typeof input === "string" || input instanceof Uint8Array
        ? parseJson(input, maxBytes)
        : input;
    canonicalize(value, true, maxBytes);
    const result = schema.safeParse(value);
    check(result.success);
    return result.data;
  } catch {
    return invalid();
  }
}
function same(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}
function ordered(keys: readonly string[]): void {
  for (let i = 1; i < keys.length; i++)
    check(
      Buffer.compare(Buffer.from(keys[i - 1] ?? ""), Buffer.from(keys[i] ?? "")) < 0,
    );
}
function aliases(paths: readonly string[]): void {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      const folded = foldPath(prefix);
      check(!seen.has(folded) || seen.get(folded) === prefix);
      seen.set(folded, prefix);
    }
  }
}
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function structured(domain: string, value: unknown, maxBytes: number): string {
  return createHash("sha256")
    .update(domain, "ascii")
    .update("\0")
    .update(canonicalize(value, true, maxBytes), "utf8")
    .digest("hex");
}
export function parsePolicy(input: unknown): PublicAnalysisPolicy {
  const p = validate(policySchema, input, L.policyBytes);
  ordered(p.rules.map((r) => r.ruleId));
  ordered(p.transferExclusions.map((e) => `${e.kind}\0${e.path}`));
  aliases(p.transferExclusions.map((e) => e.path));
  check(p.rules.filter((r) => !r.enabled).length < RULE_IDS.length);
  return freeze(p);
}
export function policyDigest(input: unknown): string {
  return structured("breaklint-analysis-policy-1", parsePolicy(input), L.policyBytes);
}
export function transferPolicyDigest(input: unknown): string {
  const p = parsePolicy(input);
  return structured(
    "breaklint-transfer-policy-1",
    { scope: p.scope, transferExclusions: p.transferExclusions },
    L.policyBytes,
  );
}
export function parseManifest(
  input: unknown,
): ReadonlyJson<z.infer<typeof manifestSchema>> {
  const m = validate(manifestSchema, input, L.manifestBytes);
  check(same(m.repository, m.requested.base.repository));
  const purposes = ["base", "raw-head", "merge-input", "effective-candidate"];
  ordered(m.snapshots.map((s) => String(purposes.indexOf(s.purpose))));
  const base = m.snapshots.find((s) => s.purpose === "base");
  const head = m.snapshots.find((s) => s.purpose === "raw-head");
  check(
    base &&
      head &&
      same(base.revision, m.requested.base) &&
      same(head.revision, m.requested.rawHead),
  );
  const candidate = m.snapshots.find((s) => s.purpose === "effective-candidate");
  check(Boolean(candidate) === Boolean(m.effectiveCandidate));
  if (candidate)
    check(
      same(candidate.revision, m.effectiveCandidate) &&
        same(candidate.revision.repository, m.repository),
    );
  ordered(m.blobs.map((b) => b.sha256));
  ordered(m.proof.objects.map((o) => `${o.kind}\0${o.gitObject}`));
  ordered(
    m.changeHints.map(
      (h) => `${h.kind}\0${h.oldPath}\0${h.kind === "rename" ? h.newPath : ""}`,
    ),
  );
  const descriptors = new Map<string, number>();
  const source = new Map<string, number>();
  const paths: string[] = [];
  let memberships = 0;
  let logicalBytes = 0;
  let proofBytes = 0;
  let commits = 0;
  const add = (b: { sha256: string; byteLength: number }) => {
    check(!descriptors.has(b.sha256) || descriptors.get(b.sha256) === b.byteLength);
    descriptors.set(b.sha256, b.byteLength);
  };
  for (const s of m.snapshots) {
    ordered(s.files.map((f) => f.path));
    const leaves = new Set(s.files.map((f) => f.path));
    for (const f of s.files) {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++)
        check(!leaves.has(parts.slice(0, i).join("/")));
    }
    let included = 0;
    let excluded = 0;
    let unavailable = 0;
    let bytes = 0;
    for (const f of s.files) {
      paths.push(f.path);
      if (f.state === "included") {
        included++;
        bytes += f.content.byteLength;
        add(f.content);
        source.set(f.content.sha256, f.content.byteLength);
      } else if (f.state === "excluded") excluded++;
      else unavailable++;
    }
    check(
      s.accounting.enumeratedLeaves === s.files.length &&
        s.accounting.includedFiles === included &&
        s.accounting.excludedFiles === excluded &&
        s.accounting.unavailableFiles === unavailable &&
        s.accounting.includedBytes === bytes,
    );
    check(bytes <= L.sourceBytesPerSnapshot);
    memberships += s.files.length;
    logicalBytes += bytes;
    check(
      m.proof.objects.some(
        (o) => o.kind === "commit" && o.gitObject === s.revision.commit,
      ),
    );
    check(m.proof.objects.some((o) => o.kind === "tree" && o.gitObject === s.rootTree));
  }
  for (const h of m.changeHints) {
    paths.push(h.oldPath);
    if (h.kind === "rename") {
      check(h.oldPath !== h.newPath);
      paths.push(h.newPath);
    }
  }
  aliases(paths);
  for (const o of m.proof.objects) {
    add(o.content);
    proofBytes += o.content.byteLength;
    if (o.kind === "commit") {
      commits++;
      check(o.content.byteLength <= L.commitBytes);
    }
  }
  check(
    commits <= L.commits &&
      proofBytes <= L.proofBytes &&
      memberships <= L.memberships &&
      logicalBytes <= L.sourceBytes &&
      source.size <= L.sourceBlobs,
  );
  check([...source.values()].reduce((a, b) => a + b, 0) <= L.sourceBytes);
  check(
    descriptors.size === m.blobs.length &&
      m.blobs.every((b) => descriptors.get(b.sha256) === b.byteLength),
  );
  return freeze(m);
}
export function manifestDigest(input: unknown): string {
  return structured(
    "breaklint-source-package-1",
    parseManifest(input),
    L.manifestBytes,
  );
}
export function parseSourcePackage(
  input: unknown,
): ReadonlyJson<z.infer<typeof packageSchema>> {
  const p = validate(packageSchema, input, L.manifestBytes + 128);
  check(manifestDigest(p.manifest) === p.manifestDigest);
  return freeze(p);
}
export function parseRequest(input: unknown): AnalysisRequest {
  const r = validate(requestSchema, input, L.requestBytes);
  check(policyDigest(r.policy) === r.policyDigest);
  check(same(r.repository, r.comparison.base.repository));
  if (r.comparison.pullRequest) check(r.repository.kind === "github");
  return freeze(r);
}
export function requestDigest(input: unknown): string {
  return structured(
    "breaklint-analysis-request-1",
    parseRequest(input),
    L.requestBytes,
  );
}
export function validateSubmission(request: unknown, sourcePackage: unknown): void {
  const r = parseRequest(request);
  const p = parseSourcePackage(sourcePackage);
  const m = p.manifest;
  // Both version fields were independently validated as the exact v1 literal.
  check(r.source.manifestDigest === p.manifestDigest);
  check(
    same(r.repository, m.repository) &&
      same(r.comparison.base, m.requested.base) &&
      same(r.comparison.rawHead, m.requested.rawHead),
  );
  check(
    same(r.policy.scope, m.scope) &&
      transferPolicyDigest(r.policy) === m.transferPolicyDigest,
  );
  check(
    Buffer.byteLength(canonicalize(r)) +
      Buffer.byteLength(canonicalize(m)) +
      m.blobs.reduce((sum, b) => sum + b.byteLength, 0) <=
      L.aggregateBytes,
  );
}
export function parseFinding(input: unknown): PublicFinding {
  const f = validate(findingSchema, input, L.resultBytes);
  if (f.gating === "blocking")
    check(
      f.qualification === "proven" &&
        ["introduced", "worsened"].includes(f.disposition) &&
        f.severity !== "info",
    );
  if (
    ["existing", "improved", "resolved"].includes(f.disposition) ||
    f.severity === "info"
  )
    check(f.gating === "nonblocking");
  return freeze(f);
}
export function parseResult(input: unknown, expectedRequest: unknown): AnalysisResult {
  const r = validate(resultSchema, input, L.resultBytes);
  const request = parseRequest(expectedRequest);
  check(
    same(r.binding, {
      requestId: request.requestId,
      requestDigest: requestDigest(request),
      manifestDigest: request.source.manifestDigest,
      policyDigest: request.policyDigest,
      repository: request.repository,
      requested: { base: request.comparison.base, rawHead: request.comparison.rawHead },
    }),
  );
  const accepted = Date.parse(r.acceptedAt);
  check(
    Date.parse(r.deadlineAt) > accepted &&
      Date.parse(r.deadlineAt) <= accepted + L.lifecycleSeconds * 1000 &&
      Date.parse(r.idempotencyExpiresAt) === accepted + L.idempotencySeconds * 1000,
  );
  if (r.state !== "terminal") return freeze(r);
  check(
    Date.parse(r.completedAt) >= accepted &&
      Date.parse(r.completedAt) <= Date.parse(r.deadlineAt),
  );
  const enabled = RULE_IDS.filter(
    (id) => !request.policy.rules.some((o) => o.ruleId === id && !o.enabled),
  );
  check(
    same(r.scope.enabledRules, enabled) && same(r.scope.declared, request.policy.scope),
  );
  ordered(r.findings.map((f) => f.findingId));
  const p = r.provenance;
  if (p.state === "verified") {
    check(same(p.base, request.comparison.base));
    if (p.method === "descendant")
      check(same(p.effectiveHead, request.comparison.rawHead));
    else check(same(p.effectiveHead.repository, request.repository));
    if (p.association === "provider-confirmed")
      check(
        request.repository.kind === "github" &&
          request.comparison.rawHead.repository.kind === "github",
      );
    if (p.method === "provider-verified-merge")
      check(p.association === "provider-confirmed");
    if (r.analyzed)
      check(same(r.analyzed, { base: p.base, effectiveHead: p.effectiveHead }));
  } else check(!r.analyzed && r.findings.length === 0 && !r.findingsComplete);
  if (!r.analyzed)
    check(
      r.scope.coverage === "none" &&
        r.scope.baseFilesAnalyzed === 0 &&
        r.scope.effectiveHeadFilesAnalyzed === 0 &&
        r.findings.length === 0 &&
        !r.findingsComplete,
    );
  if (r.scope.coverage === "none")
    check(
      r.scope.baseFilesAnalyzed === 0 &&
        r.scope.effectiveHeadFilesAnalyzed === 0 &&
        r.findings.length === 0,
    );
  for (const f of r.findings) {
    parseFinding(f);
    check(enabled.includes(f.ruleId));
    const override = request.policy.rules.find((o) => o.ruleId === f.ruleId);
    const severity =
      override && override.severity !== "default"
        ? override.severity
        : f.ruleId === "responsive.scroll-contained-structural-pressure"
          ? "info"
          : "warning";
    check(f.severity === severity);
    const above =
      f.severity === "error" ||
      (f.severity === "warning" && request.policy.gate.minimumSeverity === "warning");
    const regressed = f.disposition === "introduced" || f.disposition === "worsened";
    const blocking = above && regressed && f.qualification === "proven";
    const unresolved = above && (regressed || f.disposition === "unknown") && !blocking;
    check(
      f.gating === (blocking ? "blocking" : unresolved ? "unresolved" : "nonblocking"),
    );
    for (const l of f.locations)
      check(
        r.analyzed &&
          (same(l.revision, r.analyzed.base) ||
            same(l.revision, r.analyzed.effectiveHead)),
      );
    if (f.inline.eligible)
      check(
        p.state === "verified" &&
          p.association === "provider-confirmed" &&
          request.repository.kind === "github" &&
          request.comparison.pullRequest &&
          same(
            f.inline.target.revision,
            f.inline.side === "base"
              ? request.comparison.base
              : request.comparison.rawHead,
          ),
      );
  }
  aliases(
    r.findings.flatMap((f) => [
      ...f.locations.map((l) => l.path),
      ...(f.inline.eligible ? [f.inline.target.path] : []),
    ]),
  );
  const blocking = r.findings.some((f) => f.gating === "blocking");
  const unresolved = r.findings.some((f) => f.gating === "unresolved");
  const incomplete =
    r.scope.coverage !== "complete" ||
    !r.findingsComplete ||
    unresolved ||
    r.limitations.some((l) => l.impact !== "presentation");
  const o = r.outcome;
  if (o.status === "complete")
    check(
      !incomplete &&
        p.state === "verified" &&
        r.analyzed &&
        o.conclusion === (blocking ? "fail" : "pass") &&
        o.reason === (blocking ? "GATING_FINDINGS" : "NO_GATING_FINDINGS"),
    );
  if (o.status === "limited") {
    check(
      p.state === "verified" &&
        r.analyzed &&
        (r.scope.coverage === "partial" ||
          !r.findingsComplete ||
          unresolved ||
          r.limitations.some((l) => l.code === "FINDING_QUALIFICATION_UNRESOLVED")),
    );
    check(o.conclusion === (blocking ? "fail" : "inconclusive"));
    check(blocking ? o.reason === "GATING_FINDINGS" : o.reason !== "GATING_FINDINGS");
    if (o.reason === "OUTPUT_LIMIT")
      check(
        !r.findingsComplete && r.limitations.some((l) => l.code === "OUTPUT_LIMIT"),
      );
  }
  if (o.status === "indeterminate") {
    check(p.state === "unproven");
    const reasons = {
      ANCESTRY_INCOMPLETE: ["ancestry-incomplete"],
      MERGE_CONFLICT: ["merge-conflict"],
      REPOSITORY_ASSOCIATION_UNPROVEN: ["association-unproven"],
      EFFECTIVE_HEAD_UNPROVEN: ["not-established", "effective-candidate-invalid"],
    };
    check(reasons[o.reason].includes(p.reason));
  }
  if (!["complete", "limited"].includes(o.status)) {
    check(!r.findingsComplete);
    if (r.findings.length)
      check(
        ["failed", "cancelled"].includes(o.status) && r.scope.coverage === "partial",
      );
  }
  if (o.status === "failed" && o.reason === "INTEGRITY_MISMATCH")
    check(!r.analyzed && r.findings.length === 0);
  if (r.limitations.some((l) => l.code === "OUTPUT_LIMIT"))
    check(
      o.status === "limited" &&
        !r.findingsComplete &&
        (blocking ? o.reason === "GATING_FINDINGS" : o.reason === "OUTPUT_LIMIT"),
    );
  return freeze(r);
}
export function parseError(input: unknown): ReadonlyJson<z.infer<typeof errorSchema>> {
  return freeze(validate(errorSchema, input, L.requestBytes));
}
