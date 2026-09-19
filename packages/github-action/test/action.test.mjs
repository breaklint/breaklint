import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fixture, finding } from "../../public-protocol/test/fixtures.mjs";
import { requestDigest } from "../../public-protocol/dist/internal.js";
import { CAPABILITIES } from "../../hosted-client/dist/index.js";
import { runAction } from "../dist/index.js";
import { resolveContext } from "../dist/context.js";
import { publishResult } from "../dist/publication.js";
import { readBasePolicy } from "../dist/policy.js";
function harness(t, options = {}) {
  const f = fixture(options.fork);
  const dir = mkdtempSync(join(tmpdir(), "breaklint-action-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "--bare", "--quiet");
  for (const object of f.manifest.proof.objects)
    execFileSync("git", ["hash-object", "-w", "-t", object.kind, "--stdin"], {
      cwd: dir,
      input: f.bodies.get(object.content.sha256),
    });
  for (const s of f.manifest.snapshots)
    for (const file of s.files)
      execFileSync("git", ["hash-object", "-w", "--stdin"], {
        cwd: dir,
        input: f.bodies.get(file.content.sha256),
      });
  // The checkout ref is a different commit; source identity must come only from PR context.
  git("update-ref", "HEAD", f.request.comparison.base.commit);
  const event = {
    repository: { id: 70001 },
    pull_request: {
      number: 12,
      base: {
        sha: f.request.comparison.base.commit,
        repo: { id: 70001, full_name: "owner/repo" },
      },
      head: {
        sha: f.request.comparison.rawHead.commit,
        repo: {
          id: options.fork ? 70002 : 70001,
          full_name: options.fork ? "fork/repo" : "owner/repo",
        },
      },
    },
  };
  let context = resolveContext("owner/repo", "pull_request", event);
  const records = new Map(),
    reviews = new Set(),
    writes = [],
    outputs = {},
    failures = [],
    summaries = [],
    requests = [];
  let terminal;
  let missing = [];
  const provider = {
    current: async () => context,
    files: async () => [
      { filename: "card.css", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" },
    ],
    find: async (_, key) => records.get(key),
    reserve: async (_, key, digest) => {
      const j = { id: 1, digest, state: "reserved" };
      records.set(key, j);
      writes.push("reserve");
      return j;
    },
    save: async (_, j, summary, conclusion) => {
      const key = [...records.keys()][0];
      records.set(key, structuredClone(j));
      writes.push({ state: j.state, conclusion, summary });
    },
    hasReview: async (_, key) => reviews.has(key),
    review: async (_, key, comments) => {
      reviews.add(key);
      writes.push({ comments });
    },
  };
  const input = {
    runtime: {
      setOutput: (k, v) => {
        outputs[k] = v;
      },
      setFailed: (m) => failures.push(m),
      setSecret: () => {},
      writeSummary: async (m) => {
        summaries.push(m);
      },
    },
    provider,
    repository: "owner/repo",
    eventName: "pull_request",
    event,
    repositoryRoot: dir,
    endpoint: "https://service.invalid",
    run: { id: "123", job: "review", createdAt: "2026-09-19T12:00:00Z" },
    credential: async () =>
      options.noAuth
        ? undefined
        : {
            token: "dedicated-service-credential",
            forkAuthorized: Boolean(options.safeFork),
          },
    inline: true,
    fetch: async (url, init) => {
      requests.push({ url, init });
      assert.equal(init.headers.authorization, "Bearer dedicated-service-credential");
      if (url.endsWith("/capabilities"))
        return Response.json({ versions: [CAPABILITIES] });
      if (init.method === "POST") {
        const { request, sourcePackage } = JSON.parse(init.body);
        assert.equal(
          JSON.stringify({ request, sourcePackage }).includes(
            "dedicated-service-credential",
          ),
          false,
        );
        assert.deepEqual(request.comparison, f.request.comparison);
        terminal = structuredClone(f.result);
        terminal.binding = {
          ...terminal.binding,
          requestId: request.requestId,
          requestDigest: requestDigest(request),
          manifestDigest: request.source.manifestDigest,
          policyDigest: request.policyDigest,
        };
        options.modify?.(terminal, f);
        if (options.stale) context = { ...context, base: "a".repeat(40) };
        if (options.upload) {
          const now = Math.floor(Date.now() / 1000) * 1000;
          const stamp = (time) => new Date(time).toISOString().replace(".000Z", "Z");
          terminal.acceptedAt = stamp(now);
          terminal.completedAt = stamp(now);
          terminal.deadlineAt = stamp(now + 1800000);
          terminal.idempotencyExpiresAt = stamp(now + 86400000);
          missing = sourcePackage.manifest.blobs.map((b) => b.sha256);
        }
      } else if (init.method === "PUT") {
        const digest = new URL(url).pathname.split("/").at(-1);
        assert.equal(digest, missing.shift());
        assert.ok(Buffer.isBuffer(init.body));
      } else {
        throw new Error("Unexpected request");
      }
      if (!missing.length) return Response.json({ result: terminal, missingBlobs: [] });
      const {
        binding,
        acceptedAt,
        deadlineAt,
        idempotencyExpiresAt,
        protocolVersion,
        resultSchemaVersion,
        runId,
      } = terminal;
      return Response.json({
        result: {
          binding,
          acceptedAt,
          deadlineAt,
          idempotencyExpiresAt,
          protocolVersion,
          resultSchemaVersion,
          runId,
          state: "uploading",
          pollAfterSeconds: 2,
        },
        missingBlobs: [...missing],
      });
    },
  };
  return {
    f,
    dir,
    git,
    input,
    provider,
    outputs,
    failures,
    summaries,
    requests,
    writes,
    records,
    reviews,
    get terminal() {
      return terminal;
    },
    setContext: (c) => {
      context = c;
    },
    get context() {
      return context;
    },
  };
}
const blocking = (r, f) => {
  r.findings = [finding(f)];
  r.outcome = { status: "complete", conclusion: "fail", reason: "GATING_FINDINGS" };
};
const inlineFinding = (r, f) => {
  blocking(r, f);
  r.findings[0].inline = {
    eligible: true,
    target: r.findings[0].locations[0],
    side: "raw-head",
  };
};
test("same-repository PR uses exact endpoints and the shared HTTPS client; complete/pass", async (t) => {
  const h = harness(t);
  const result = await runAction(h.input);
  assert.equal(result.result.outcome.conclusion, "pass");
  assert.equal(result.delivery, "published");
  assert.equal(h.failures.length, 0);
  assert.deepEqual(
    h.requests.map((r) => new URL(r.url).pathname),
    ["/capabilities", "/runs"],
  );
  assert.equal(h.git("rev-parse", "HEAD").trim(), h.context.base);
});
test("trusted Base policy ignores executable Head and working-tree config", async (t) => {
  const h = harness(t, { fork: true, safeFork: true });
  writeFileSync(
    join(h.dir, "breaklint.config.ts"),
    'throw new Error("HEAD CONFIG EXECUTED")',
  );
  writeFileSync(
    join(h.dir, "breaklint.policy.json"),
    '{"gate":{"minimumSeverity":"error"}}',
  );
  assert.deepEqual(await readBasePolicy(h.dir, h.context.base), h.f.policy);
  assert.equal((await runAction(h.input)).delivery, "published");
});
for (const opts of [{ fork: true }, { fork: true, noAuth: true }, { noAuth: true }])
  test(`missing safe authorization ${JSON.stringify(opts)} is unavailable`, async (t) => {
    const h = harness(t, opts);
    await runAction(h.input);
    assert.equal(h.outputs.status, "unavailable");
    assert.equal(h.outputs.conclusion, "inconclusive");
    assert.equal(h.requests.length, 0);
    assert.equal(h.failures.length, 1);
  });
test("missing raw Head never falls back to checkout merge SHA; privileged event rejected", (t) => {
  const h = harness(t);
  delete h.input.event.pull_request.head.sha;
  assert.throws(() => resolveContext("owner/repo", "pull_request", h.input.event));
  assert.throws(() =>
    resolveContext("owner/repo", "pull_request_target", h.input.event),
  );
});
test("introduced blocking finding fails; summary-only stays summary-only", async (t) => {
  const h = harness(t, { modify: blocking });
  await runAction(h.input);
  assert.equal(h.outputs.conclusion, "fail");
  assert.equal(h.reviews.size, 0);
  assert.equal(h.failures.length, 1);
});
test("finding text is escaped in summaries and inline comments", async (t) => {
  const h = harness(t, {
    modify: (r, f) => {
      inlineFinding(r, f);
      r.findings[0].title = "<script>@everyone</script>";
      r.findings[0].message = "[link](relative-target) `code` *bold* & text";
    },
  });
  assert.equal((await runAction(h.input)).delivery, "published");
  const comment = h.writes.find((write) => write.comments).comments[0].body;
  for (const text of [h.summaries[0], comment]) {
    assert.doesNotMatch(text, /<script>|@everyone|\[link\]|`code`|\*bold\*/);
    assert.match(text, /&#60;script&#62;&#64;everyone/);
    assert.match(text, /&#38; text/);
  }
});
for (const status of [
  "limited",
  "unsupported",
  "indeterminate",
  "unavailable",
  "failed",
  "cancelled",
])
  test(`${status} with no findings is never clean`, async (t) => {
    const h = harness(t, {
      modify: (r) => {
        r.findingsComplete = false;
        if (status === "limited") {
          r.scope.coverage = "partial";
          r.outcome = {
            status,
            conclusion: "inconclusive",
            reason: "COVERAGE_INCOMPLETE",
          };
        } else {
          delete r.analyzed;
          r.provenance = {
            state: "unproven",
            reason: status === "indeterminate" ? "merge-conflict" : "not-established",
          };
          r.scope.coverage = "none";
          r.scope.baseFilesAnalyzed = 0;
          r.scope.effectiveHeadFilesAnalyzed = 0;
          r.outcome = {
            status,
            conclusion: "inconclusive",
            reason: {
              unsupported: "UNSUPPORTED_SOURCE",
              indeterminate: "MERGE_CONFLICT",
              unavailable: "SERVICE_UNAVAILABLE",
              failed: "INTERNAL_FAILURE",
              cancelled: "CANCELLED",
            }[status],
          };
        }
      },
    });
    await runAction(h.input);
    assert.equal(h.outputs.status, status);
    assert.equal(h.outputs.conclusion, "inconclusive");
    assert.equal(h.failures.length, 1);
    assert.match(h.summaries[0], /No clean result/);
  });
test("stale Base after analysis suppresses check and inline; source truth preserved", async (t) => {
  const h = harness(t, { stale: true, modify: inlineFinding });
  const out = await runAction(h.input);
  assert.equal(out.delivery, "superseded");
  assert.equal(out.result.outcome.conclusion, "fail");
  assert.equal(h.writes.length, 0);
});
test("service-approved raw Head in current diff is inline; durable replay has no duplicate writes", async (t) => {
  const h = harness(t, { modify: inlineFinding });
  const first = await runAction(h.input);
  const count = h.writes.length;
  assert.equal(h.reviews.size, 1);
  assert.equal(h.writes.find((w) => w.comments).comments[0].line, 1);
  const second = await runAction({ ...h.input, provider: { ...h.provider } });
  assert.deepEqual(second.result, first.result);
  assert.equal(h.writes.length, count);
});
test("effective merge source location is never guessed onto raw Head", async (t) => {
  const h = harness(t, {
    modify: (r, f) => {
      blocking(r, f);
      const effective = { ...r.binding.requested.base, commit: "c".repeat(40) };
      r.analyzed.effectiveHead = effective;
      r.provenance.effectiveHead = effective;
      r.provenance.method = "service-derived-merge";
      r.findings[0].locations[0].revision = effective;
    },
  });
  await runAction(h.input);
  assert.equal(h.outputs.status, "complete");
  assert.equal(h.reviews.size, 0);
});
test("provider-unconfirmed result cannot grant authoritative pass or inline", async (t) => {
  const h = harness(t, {
    modify: (r) => {
      r.provenance.association = "client-submitted";
    },
  });
  await runAction(h.input);
  assert.equal(h.outputs.conclusion, "pass");
  assert.equal(h.failures.length, 1);
  assert.equal(h.writes.at(-1).conclusion, "failure");
});
test("publication failure and safe retry preserve immutable source result", async (t) => {
  const h = harness(t, { modify: inlineFinding });
  const save = h.provider.save;
  let fail = true;
  h.provider.save = async (...args) => {
    if (args[1].state === "published" && fail) {
      fail = false;
      throw new Error("transient publication error");
    }
    return save(...args);
  };
  const first = await runAction(h.input);
  assert.equal(first.delivery, "failed");
  const snapshot = JSON.stringify(first.result);
  const second = await runAction(h.input);
  assert.equal(second.delivery, "published");
  assert.equal(JSON.stringify(second.result), snapshot);
  assert.equal(h.reviews.size, 1);
});
test("lost review POST response reconciles durably without repeating inline review", async (t) => {
  const h = harness(t, { modify: inlineFinding });
  const review = h.provider.review;
  h.provider.review = async (...args) => {
    await review(...args);
    throw new Error("response lost");
  };
  assert.equal((await runAction(h.input)).delivery, "failed");
  assert.equal((await runAction(h.input)).delivery, "published");
  assert.equal(h.writes.filter((w) => w.comments).length, 1);
});
test("ambiguous missing review is not posted again", async (t) => {
  const h = harness(t, { modify: inlineFinding });
  let attempts = 0;
  h.provider.review = async () => {
    attempts++;
    throw new Error("unknown outcome");
  };
  await runAction(h.input);
  await runAction(h.input);
  assert.equal(attempts, 1);
  assert.equal(h.outputs.delivery, "failed");
});
test("stale Head immediately before inline has no review", async (t) => {
  const h = harness(t, { modify: inlineFinding });
  const save = h.provider.save;
  h.provider.save = async (...args) => {
    await save(...args);
    if (args[1].state === "review-pending")
      h.setContext({ ...h.context, head: "d".repeat(40) });
  };
  assert.equal((await runAction(h.input)).delivery, "superseded");
  assert.equal(h.reviews.size, 0);
});
test("outside current diff, base-side, and renamed locations remain summary-only", async (t) => {
  for (const kind of ["outside", "base", "rename"]) {
    const h = harness(t, {
      modify: (r, f) => {
        inlineFinding(r, f);
        if (kind === "base") {
          r.findings[0].inline.side = "base";
          r.findings[0].inline.target = {
            ...r.findings[0].inline.target,
            revision: r.binding.requested.base,
          };
        }
      },
    });
    h.provider.files = async () => [
      {
        filename: kind === "rename" ? "new.css" : "card.css",
        previousFilename: "card.css",
        status: "modified",
        patch: kind === "outside" ? "@@ -10 +10 @@" : "@@ -1 +1 @@",
      },
    ];
    await runAction(h.input);
    assert.equal(h.reviews.size, 0);
  }
});
test("publication rejects a result bound to other revisions", async (t) => {
  const h = harness(t);
  assert.equal(
    await publishResult(
      h.provider,
      { ...h.context, base: "b".repeat(40) },
      h.f.result,
      "key",
      true,
    ),
    "failed",
  );
  assert.equal(h.writes.length, 0);
});

test("Action uploads exact immutable blobs through shared client lifecycle", async (t) => {
  const h = harness(t, { upload: true });
  assert.equal((await runAction(h.input)).delivery, "published");
  assert.equal(
    h.requests.filter((r) => r.init.method === "PUT").length,
    h.f.manifest.blobs.length,
  );
});
test("immutable Base JSON policy wins over malicious fork Head policy and executable config", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "breaklint-base-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Synthetic");
  git("config", "user.email", "synthetic@example.invalid");
  const trusted = {
    gate: { changes: "introduced-or-worsened", minimumSeverity: "warning" },
    transferExclusions: [{ kind: "directory", path: "restricted" }],
  };
  writeFileSync(join(dir, "breaklint.policy.json"), JSON.stringify(trusted));
  git("add", ".");
  git("commit", "-qm", "Trusted policy");
  const base = git("rev-parse", "HEAD");
  writeFileSync(
    join(dir, "breaklint.policy.json"),
    JSON.stringify({
      transferExclusions: [],
      gate: { changes: "introduced-or-worsened", minimumSeverity: "error" },
      rules: [
        {
          ruleId: "responsive.clipped-layout-pressure",
          enabled: false,
          severity: "default",
        },
      ],
    }),
  );
  writeFileSync(
    join(dir, "breaklint.config.ts"),
    'throw new Error("must never execute Head config")',
  );
  writeFileSync(join(dir, "package.json"), '{"scripts":{"postinstall":"exit 99"}}');
  git("add", ".");
  git("commit", "-qm", "Hostile Head policy");
  const policy = await readBasePolicy(dir, base);
  assert.equal(policy.gate.minimumSeverity, "warning");
  assert.deepEqual(policy.transferExclusions, trusted.transferExclusions);
  assert.deepEqual(policy.rules, []);
});
test("response bound to a different raw Head is rejected before publication", async (t) => {
  const h = harness(t, {
    modify: (r) => {
      r.binding.requested.rawHead.commit = "e".repeat(40);
    },
  });
  await runAction(h.input);
  assert.equal(h.outputs.status, "failed");
  assert.equal(h.writes.length, 0);
});
test("service authorization rejection is unavailable and never leaks raw response or credentials", async (t) => {
  const h = harness(t);
  h.input.fetch = async () =>
    Response.json(
      { errorSchemaVersion: "1.0", code: "FORBIDDEN", retry: "never" },
      { status: 403 },
    );
  await runAction(h.input);
  assert.equal(h.outputs.status, "unavailable");
  assert.equal(h.writes.length, 0);
  assert.doesNotMatch(
    JSON.stringify(h.outputs) + h.summaries.join() + h.failures.join(),
    /dedicated-service-credential/,
  );
});
test("job summary failure leaves source pass intact and fails delivery separately", async (t) => {
  const h = harness(t);
  h.input.runtime.writeSummary = async () => {
    throw new Error("disk full");
  };
  const out = await runAction(h.input);
  assert.equal(out.result.outcome.conclusion, "pass");
  assert.equal(out.delivery, "failed");
  assert.equal(h.outputs.conclusion, "pass");
  assert.equal(h.outputs.delivery, "failed");
});
