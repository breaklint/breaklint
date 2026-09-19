import { createHash } from "node:crypto";
import {
  policyDigest,
  transferPolicyDigest,
  manifestDigest,
  requestDigest,
  sha256,
  RULE_IDS,
} from "../dist/internal.js";
export function fixture(fork = false) {
  const repository = { kind: "github", host: "github.com", repositoryId: "70001" };
  const headRepository = { ...repository, repositoryId: fork ? "70002" : "70001" };
  const policy = {
    policySchemaVersion: "1.0",
    scope: { kind: "repository", selectionProfile: "authored-source-1" },
    transferExclusions: [],
    rules: [],
    gate: { changes: "introduced-or-worsened", minimumSeverity: "warning" },
  };
  const bodies = new Map();
  const object = (kind, body) => {
    const bytes = Buffer.from(body);
    const id = createHash("sha1")
      .update(`${kind} ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    const content = { sha256: sha256(bytes), byteLength: bytes.length };
    bodies.set(content.sha256, bytes);
    return { kind, gitObject: id, content };
  };
  const file = object("blob", "a { width: 1px; }\n");
  const tree = object(
    "tree",
    Buffer.concat([
      Buffer.from("100644 card.css\0"),
      Buffer.from(file.gitObject, "hex"),
    ]),
  );
  const commit = (parent) =>
    object(
      "commit",
      `tree ${tree.gitObject}\n${parent ? `parent ${parent}\n` : ""}author Example <example@example.invalid> 0 +0000\ncommitter Example <example@example.invalid> 0 +0000\n\nSynthetic\n`,
    );
  const b = commit();
  const h = commit(b.gitObject);
  const base = { repository, commit: b.gitObject };
  const rawHead = { repository: headRepository, commit: h.gitObject };
  const snapshot = (revision, purpose) => ({
    revision,
    purpose,
    rootTree: tree.gitObject,
    files: [
      {
        state: "included",
        path: "card.css",
        mode: "100644",
        gitObject: file.gitObject,
        content: file.content,
      },
    ],
    accounting: {
      enumeratedLeaves: 1,
      includedFiles: 1,
      includedBytes: file.content.byteLength,
      excludedFiles: 0,
      unavailableFiles: 0,
    },
  });
  const proof = [b, h, tree].sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.kind + "\0" + a.gitObject),
      Buffer.from(b.kind + "\0" + b.gitObject),
    ),
  );
  const manifest = {
    packageSchemaVersion: "1.0",
    gitObjectFormat: "sha1",
    repository,
    requested: { base, rawHead },
    scope: policy.scope,
    transferPolicyDigest: transferPolicyDigest(policy),
    snapshots: [snapshot(base, "base"), snapshot(rawHead, "raw-head")],
    blobs: [file.content, ...proof.map((o) => o.content)].sort((a, b) =>
      a.sha256.localeCompare(b.sha256),
    ),
    proof: { encoding: "git-object-bodies-1", objects: proof },
    changeHints: [],
  };
  const sourcePackage = { manifest, manifestDigest: manifestDigest(manifest) };
  const request = {
    protocolVersion: "1.0",
    requestSchemaVersion: "1.0",
    resultSchemaVersion: "1.0",
    requestId: "20260919T120000Z_0123456789abcdef0123456789abcdef",
    repository,
    comparison: { base, rawHead, pullRequest: { number: 12 } },
    source: {
      packageSchemaVersion: "1.0",
      manifestDigest: sourcePackage.manifestDigest,
    },
    policy,
    policyDigest: policyDigest(policy),
  };
  const result = {
    protocolVersion: "1.0",
    resultSchemaVersion: "1.0",
    runId: "run_1",
    binding: {
      requestId: request.requestId,
      requestDigest: requestDigest(request),
      manifestDigest: request.source.manifestDigest,
      policyDigest: request.policyDigest,
      repository,
      requested: { base, rawHead },
    },
    acceptedAt: "2026-09-19T12:00:00Z",
    deadlineAt: "2026-09-19T12:30:00Z",
    idempotencyExpiresAt: "2026-09-20T12:00:00Z",
    state: "terminal",
    completedAt: "2026-09-19T12:01:00Z",
    outcome: { status: "complete", conclusion: "pass", reason: "NO_GATING_FINDINGS" },
    provenance: {
      state: "verified",
      method: "descendant",
      association: "provider-confirmed",
      base,
      effectiveHead: rawHead,
    },
    analyzed: { base, effectiveHead: rawHead },
    scope: {
      declared: policy.scope,
      coverage: "complete",
      enabledRules: [...RULE_IDS],
      baseFilesAnalyzed: 1,
      effectiveHeadFilesAnalyzed: 1,
    },
    findings: [],
    findingsComplete: true,
    limitations: [],
  };
  return { policy, manifest, sourcePackage, request, result, bodies };
}
export function finding(f) {
  return {
    findingId: "finding_1",
    ruleId: "responsive.clipped-layout-pressure",
    severity: "warning",
    title: "Synthetic clipping",
    message: "Authored content exceeds its container.",
    qualification: "proven",
    disposition: "introduced",
    gating: "blocking",
    locations: [
      {
        revision: f.request.comparison.rawHead,
        path: "card.css",
        start: { line: 1, column: 1 },
        end: { line: 1, column: 2 },
      },
    ],
    inline: { eligible: false, reason: "unproven-mapping" },
  };
}
