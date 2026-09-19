import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  parseJson,
  parsePolicy,
  parseManifest,
  parseSourcePackage,
  parseRequest,
  parseResult,
  parseFinding,
  parseError,
  validateSubmission,
  policyDigest,
  manifestDigest,
  requestDigest,
  transferPolicyDigest,
  sha256,
  V1_LIMITS,
  RULE_IDS,
} from "../dist/internal.js";
import { fixture, finding } from "./fixtures.mjs";

test("RFC 8785 primitive, number and recursive UTF-16 ordering vectors", () => {
  assert.equal(
    canonicalize({
      numbers: [Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27],
      literals: [null, true, false],
    }),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}',
  );
  assert.equal(
    canonicalize('\u000f\b\t\n\f\r"\\/'),
    '"\\u000f\\b\\t\\n\\f\\r\\"\\\\/"',
  );
  assert.equal(
    canonicalize({ "\ufb33": 7, "😀": 6, "€": 5, ö: 4, "\u0080": 3, 1: 2, "\r": 1 }),
    '{"\\r":1,"1":2,"\u0080":3,"ö":4,"€":5,"😀":6,"דּ":7}',
  );
  assert.equal(
    canonicalize({ 2: 2, 10: 10, a: [{ z: 0, a: 1 }] }),
    '{"10":10,"2":2,"a":[{"a":1,"z":0}]}',
  );
  assert.notEqual(canonicalize("é"), canonicalize("e\u0301"));
  assert.equal(canonicalize(-0), "0");
  for (const n of [NaN, Infinity, -Infinity]) assert.throws(() => canonicalize(n));
});

test("strict JSON rejects duplicate decoded keys, rounding, surrogates, malformed UTF-8 and depth", () => {
  for (const s of [
    '{"a":1,"\\u0061":2}',
    '{"a":undefined}',
    "[1,]",
    "-0",
    "-1",
    "0.1",
    "9007199254740991.1",
    "9007199254740992",
    '"\\ud800"',
    "[ ".repeat(34) + "0" + "]".repeat(34),
  ])
    assert.throws(() => parseJson(s, 8192));
  assert.throws(() => parseJson(new Uint8Array([0xc0, 0xaf]), 10));
  assert.throws(() => parseJson("\ufeff{}", 10));
  assert.equal(parseJson("10e-1", 10), 1);
  assert.equal(parseJson("9007199254740991", 32), Number.MAX_SAFE_INTEGER);
  let invoked = false;
  for (const v of [
    undefined,
    () => {},
    new Date(),
    { a: undefined },
    { a: BigInt(1) },
    {
      get x() {
        invoked = true;
        return 1;
      },
    },
    Object.assign([], { x: 1 }),
    Array(2),
    { a: -0 },
    { a: -1 },
    { a: 0.5 },
  ])
    assert.throws(() => canonicalize(v, true));
  assert.equal(invoked, false);
  const cyclic = {};
  cyclic.x = cyclic;
  assert.throws(() => canonicalize(cyclic));
});

test("fixed domain-separated SHA-256 vectors", () => {
  const f = fixture();
  const actual = [
    policyDigest(f.policy),
    transferPolicyDigest(f.policy),
    manifestDigest(f.manifest),
    requestDigest(f.request),
    sha256(Buffer.from("abc")),
  ];
  assert.deepEqual(actual, DIGEST_VECTORS);
  assert.equal(new Set(actual).size, 5);
});

test("synthetic descendant and fork preserve complete repository identity and immutable values", () => {
  for (const fork of [false, true]) {
    const f = fixture(fork);
    validateSubmission(f.request, f.sourcePackage);
    assert.deepEqual(parseResult(f.result, f.request), f.result);
    assert.ok(Object.isFrozen(parseRequest(f.request).policy.rules));
    const bad = structuredClone(f.request);
    bad.comparison.rawHead.repository = f.request.repository;
    if (fork) assert.throws(() => validateSubmission(bad, f.sourcePackage));
  }
});

test("closed schemas reject unknown versions, fields, discriminants and private fields", () => {
  const f = fixture();
  for (const [input, parse, key, value] of [
    [f.request, parseRequest, "requestSchemaVersion", "2.0"],
    [f.policy, parsePolicy, "policySchemaVersion", "4.0"],
    [f.manifest, parseManifest, "gitObjectFormat", "sha256"],
    [f.result, (v) => parseResult(v, f.request), "resultSchemaVersion", "2.0"],
    [f.result, (v) => parseResult(v, f.request), "state", "done"],
    ...[
      "runtime",
      "ai",
      "repair",
      "evidence",
      "engine",
      "credentials",
      "root",
      "provider",
      "diagnostics",
    ].map((k) => [f.policy, parsePolicy, k, {}]),
  ]) {
    assert.throws(() => parse({ ...input, [key]: value }));
  }
  assert.throws(() =>
    parsePolicy({
      ...f.policy,
      rules: [{ ruleId: "unknown", enabled: true, severity: "default" }],
    }),
  );
  const result = structuredClone(f.result);
  result.provenance.method = "client-asserted";
  assert.throws(() => parseResult(result, f.request));
  assert.throws(() => parseRequest({ ...f.request, requestId: "req1" }));
});

test("paths reject traversal, aliases, nonportable components and normalization", () => {
  const f = fixture();
  for (const path of [
    "../x",
    "a/../b",
    "/root",
    "a//b",
    "a/",
    "a\\b",
    "C:x",
    ".git/config",
    "x/.GIT/config",
    "con.txt",
    "a/COM1",
    "a.",
    "a ",
    "e\u0301.css",
    "x\0.css",
    "a".repeat(129),
    Array(33).fill("a").join("/"),
    "a".repeat(128) + "/".repeat(1) + "b".repeat(128) + "/c/".repeat(100),
  ]) {
    assert.throws(
      () => parsePolicy({ ...f.policy, transferExclusions: [{ kind: "file", path }] }),
      path,
    );
  }
  for (const [a, b] of [
    ["A/x", "a/y"],
    ["straße.css", "strasse.css"],
    ["Σ.css", "ς.css"],
    ["ﬀ.css", "ff.css"],
  ])
    assert.throws(() =>
      parsePolicy({
        ...f.policy,
        transferExclusions: [
          { kind: "file", path: a },
          { kind: "file", path: b },
        ].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))),
      }),
    );
  assert.doesNotThrow(() =>
    parsePolicy({ ...f.policy, transferExclusions: [{ kind: "file", path: "é.css" }] }),
  );
});

test("digest and Base/raw-Head binding mismatches fail closed", () => {
  const f = fixture();
  assert.throws(() => parseRequest({ ...f.request, policyDigest: "0".repeat(64) }));
  assert.throws(() =>
    parseSourcePackage({ ...f.sourcePackage, manifestDigest: "0".repeat(64) }),
  );
  for (const key of ["requestDigest", "manifestDigest", "policyDigest"])
    assert.throws(() =>
      parseResult(
        { ...f.result, binding: { ...f.result.binding, [key]: "0".repeat(64) } },
        f.request,
      ),
    );
  for (const side of ["base", "rawHead"]) {
    const r = structuredClone(f.request);
    r.comparison[side].commit = "0".repeat(40);
    assert.throws(() => validateSubmission(r, f.sourcePackage));
  }
  const r = structuredClone(f.request);
  r.policy.transferExclusions = [{ kind: "file", path: "private.css" }];
  r.policyDigest = policyDigest(r.policy);
  assert.throws(() => validateSubmission(r, f.sourcePackage));
});

test("manifest validates exact descriptor union, accounting, ordering and candidate binding", () => {
  const f = fixture();
  const mutations = [
    (m) => m.blobs.pop(),
    (m) => m.blobs.push({ ...m.blobs[0] }),
    (m) => m.snapshots[0].accounting.includedBytes++,
    (m) => m.snapshots.reverse(),
    (m) => m.proof.objects.reverse(),
    (m) => m.snapshots[0].files.push({ ...m.snapshots[0].files[0] }),
    (m) => (m.effectiveCandidate = m.requested.rawHead),
    (m) => (m.blobs[0] = { ...m.blobs[0], byteLength: m.blobs[0].byteLength + 1 }),
    (m) => (m.proof.objects = []),
  ];
  for (const mutate of mutations) {
    const m = structuredClone(f.manifest);
    mutate(m);
    assert.throws(() => parseManifest(m));
  }
});

test("empty findings are clean only with all completeness conditions", () => {
  const f = fixture();
  const mutations = [
    (r) => (r.findingsComplete = false),
    (r) => (r.scope.coverage = "partial"),
    (r) => delete r.analyzed,
    (r) => (r.provenance = { state: "unproven", reason: "not-established" }),
    (r) =>
      r.limitations.push({
        code: "SOURCE_UNAVAILABLE",
        impact: "coverage",
        affectedCount: 1,
      }),
    (r) => r.scope.enabledRules.pop(),
    (r) => (r.outcome.reason = "GATING_FINDINGS"),
  ];
  for (const mutate of mutations) {
    const r = structuredClone(f.result);
    mutate(r);
    assert.throws(() => parseResult(r, f.request));
  }
});

test("limited, unsupported, indeterminate and operational states remain distinguishable", () => {
  const f = fixture();
  const r = structuredClone(f.result);
  r.outcome = {
    status: "limited",
    conclusion: "inconclusive",
    reason: "COVERAGE_INCOMPLETE",
  };
  r.scope.coverage = "partial";
  r.findingsComplete = false;
  r.limitations = [
    { code: "SOURCE_UNAVAILABLE", impact: "coverage", affectedCount: 1 },
  ];
  assert.equal(parseResult(r, f.request).outcome.status, "limited");
  r.findings = [finding(f)];
  r.outcome = { status: "limited", conclusion: "fail", reason: "GATING_FINDINGS" };
  assert.doesNotThrow(() => parseResult(r, f.request));
  r.findings = [];
  assert.throws(() => parseResult(r, f.request));
  for (const [status, reason] of [
    ["unsupported", "UNSUPPORTED_SOURCE"],
    ["indeterminate", "ANCESTRY_INCOMPLETE"],
    ["unavailable", "SERVICE_UNAVAILABLE"],
    ["failed", "INTEGRITY_MISMATCH"],
    ["cancelled", "CANCELLED"],
  ]) {
    const v = structuredClone(f.result);
    delete v.analyzed;
    v.provenance = {
      state: "unproven",
      reason: status === "indeterminate" ? "ancestry-incomplete" : "not-established",
    };
    v.scope.coverage = "none";
    v.scope.baseFilesAnalyzed = 0;
    v.scope.effectiveHeadFilesAnalyzed = 0;
    v.findingsComplete = false;
    v.outcome = { status, conclusion: "inconclusive", reason };
    assert.doesNotThrow(() => parseResult(v, f.request));
    v.outcome.conclusion = "pass";
    assert.throws(() => parseResult(v, f.request));
  }
});

test("gating qualification, enabled rules, severity and raw-Head inline eligibility", () => {
  const f = fixture(true);
  const r = structuredClone(f.result);
  r.findings = [finding(f)];
  r.outcome = { status: "complete", conclusion: "fail", reason: "GATING_FINDINGS" };
  assert.doesNotThrow(() => parseResult(r, f.request));
  r.findings[0].qualification = "supported";
  assert.throws(() => parseResult(r, f.request));
  r.findings[0].gating = "unresolved";
  r.outcome = {
    status: "limited",
    conclusion: "inconclusive",
    reason: "COVERAGE_INCOMPLETE",
  };
  assert.doesNotThrow(() => parseResult(r, f.request));
  r.findings[0].inline = {
    eligible: true,
    side: "raw-head",
    target: r.findings[0].locations[0],
  };
  assert.doesNotThrow(() => parseResult(r, f.request));
  r.findings[0].inline.target.revision = f.request.comparison.base;
  assert.throws(() => parseResult(r, f.request));
  const bad = finding(f);
  bad.locations[0].end.column = 0;
  assert.throws(() => parseFinding(bad));
});

test("finite scalar, array, byte and lifecycle ceilings", () => {
  const f = fixture();
  const badPolicy = [
    {
      ...f.policy,
      rules: RULE_IDS.map((ruleId) => ({
        ruleId,
        enabled: false,
        severity: "default",
      })),
    },
    { ...f.policy, transferExclusions: Array(129).fill({ kind: "file", path: "x" }) },
  ];
  for (const p of badPolicy) assert.throws(() => parsePolicy(p));
  for (const n of [NaN, Infinity, -0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, 2147483648])
    assert.throws(() =>
      parseRequest({
        ...f.request,
        comparison: { ...f.request.comparison, pullRequest: { number: n } },
      }),
    );
  for (const mutate of [
    (v) => (v.title = "é".repeat(81)),
    (v) => (v.message = "x".repeat(2049)),
    (v) => (v.locations[0].end.line = 1048578),
    (v) => (v.locations = Array(9).fill(v.locations[0])),
  ]) {
    const v = finding(f);
    mutate(v);
    assert.throws(() => parseFinding(v));
  }
  const m = structuredClone(f.manifest);
  m.snapshots[0].files = Array(10001).fill(m.snapshots[0].files[0]);
  assert.throws(() => parseManifest(m));
  const m2 = structuredClone(f.manifest);
  m2.blobs[0].byteLength = 1048577;
  assert.throws(() => parseManifest(m2));
  assert.throws(() =>
    parseResult({ ...f.result, findings: Array(1001).fill(finding(f)) }, f.request),
  );
  assert.throws(() =>
    parseResult({ ...f.result, deadlineAt: "2026-09-19T12:30:01Z" }, f.request),
  );
  assert.throws(() => parsePolicy(" ".repeat(V1_LIMITS.policyBytes) + "{}"));
});

test("pending envelopes and public error retry vocabulary are closed", () => {
  const f = fixture();
  const pending = {
    protocolVersion: f.result.protocolVersion,
    resultSchemaVersion: f.result.resultSchemaVersion,
    runId: f.result.runId,
    binding: f.result.binding,
    acceptedAt: f.result.acceptedAt,
    deadlineAt: f.result.deadlineAt,
    idempotencyExpiresAt: f.result.idempotencyExpiresAt,
    state: "queued",
    pollAfterSeconds: 2,
  };
  assert.doesNotThrow(() => parseResult(pending, f.request));
  assert.throws(() => parseResult({ ...pending, findings: [] }, f.request));
  assert.deepEqual(
    parseError({
      errorSchemaVersion: "1.0",
      code: "RATE_LIMITED",
      retry: "same-request",
      retryAfterSeconds: 60,
    }),
    {
      errorSchemaVersion: "1.0",
      code: "RATE_LIMITED",
      retry: "same-request",
      retryAfterSeconds: 60,
    },
  );
  for (const v of [
    { code: "FORBIDDEN", retry: "same-request" },
    { code: "INVALID_INPUT", retry: "never", retryAfterSeconds: 1 },
    { code: "UNKNOWN", retry: "never" },
    { code: "INTERNAL_FAILURE", retry: "new-attempt", stack: "secret" },
  ])
    assert.throws(() => parseError({ errorSchemaVersion: "1.0", ...v }));
});

// Independently computed with Python hashlib and compact sorted JSON (ASCII fixture keys).
const DIGEST_VECTORS = [
  "80bb4509fb008b60b8eed43cdd28052ce34fa0b3acbdf1fb474a3181a0351d38",
  "389a6c0ee8946a455405b13194382a319031239eaa1dc8cd0915bd38577df6b1",
  "f8afc6206e01021c7d35e66f6dea2bd0a815179e9831fe4783170ccab335e7c4",
  "6e4aa34dcec5825ef9f101324070ccc9f15eeaf5cf36f597b83d13c0279165ae",
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
];

test("logical deduplicated bytes, proof and control-body ceilings cannot be bypassed", () => {
  const f = fixture();
  const m = structuredClone(f.manifest);
  const member = m.snapshots[0].files[0];
  member.content.byteLength = V1_LIMITS.sourceBlobBytes;
  m.snapshots[0].files = Array.from({ length: 65 }, (_, i) => ({
    ...member,
    path: `file-${String(i).padStart(3, "0")}.css`,
  }));
  m.snapshots[0].accounting = {
    enumeratedLeaves: 65,
    includedFiles: 65,
    includedBytes: 65 * V1_LIMITS.sourceBlobBytes,
    excludedFiles: 0,
    unavailableFiles: 0,
  };
  assert.throws(() => parseManifest(m));
  const proof = structuredClone(f.manifest);
  proof.proof.objects[0].content.byteLength = V1_LIMITS.commitBytes + 1;
  assert.throws(() => parseManifest(proof));
  const body = JSON.stringify(f.result);
  assert.throws(() =>
    parseResult(" ".repeat(V1_LIMITS.resultBytes - body.length + 1) + body, f.request),
  );
  const manifest = JSON.stringify(f.manifest);
  assert.throws(() =>
    parseManifest(" ".repeat(V1_LIMITS.manifestBytes - manifest.length + 1) + manifest),
  );
  assert.throws(() =>
    parseRequest(" ".repeat(V1_LIMITS.requestBytes) + JSON.stringify(f.request)),
  );
  assert.throws(() =>
    parsePolicy({
      ...f.policy,
      transferExclusions: Array.from({ length: 128 }, (_, i) => ({
        kind: "file",
        path: `${String(i).padStart(3, "0")}/${"a".repeat(128)}/${"b".repeat(128)}`,
      })),
    }),
  );
});

test("lifecycle deadline is a ceiling; registered local identities do not assert provider trust", () => {
  const f = fixture();
  assert.doesNotThrow(() =>
    parseResult({ ...f.result, deadlineAt: "2026-09-19T12:05:00Z" }, f.request),
  );
  const request = structuredClone(f.request);
  request.comparison.rawHead.repository = {
    kind: "registered",
    repositoryId: "local_submission",
  };
  assert.doesNotThrow(() => parseRequest(request));
  request.repository = { kind: "registered", repositoryId: "local_target" };
  request.comparison.base.repository = request.repository;
  assert.throws(() => parseRequest(request));
  delete request.comparison.pullRequest;
  assert.doesNotThrow(() => parseRequest(request));
});
