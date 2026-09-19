import { test } from "node:test";
import assert from "node:assert/strict";
import { createGitHubProvider } from "../dist/github-provider.js";
import { resolveContext } from "../dist/context.js";
import { publishResult } from "../dist/publication.js";
import { fixture, finding } from "../../public-protocol/test/fixtures.mjs";
function providerFixture() {
  const f = fixture();
  const result = structuredClone(f.result);
  result.findings = [finding(f)];
  result.findings[0].inline = {
    eligible: true,
    side: "raw-head",
    target: result.findings[0].locations[0],
  };
  result.outcome = {
    status: "complete",
    conclusion: "fail",
    reason: "GATING_FINDINGS",
  };
  const pr = {
    number: 12,
    state: "open",
    base: {
      sha: f.request.comparison.base.commit,
      repo: { id: 70001, full_name: "owner/repo" },
    },
    head: { sha: f.request.comparison.rawHead.commit, repo: { id: 70001 } },
  };
  const context = resolveContext("owner/repo", "pull_request", {
    repository: pr.base.repo,
    pull_request: pr,
  });
  const checks = [],
    reviews = [],
    calls = [];
  const fetcher = async (url, init) => {
    assert.ok(url.startsWith("https://api.github.com/"));
    assert.ok(init.headers.authorization.includes("publication-only"));
    assert.ok(!JSON.stringify(init).includes("service-credential"));
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = new URL(url).pathname;
    calls.push({ method: init.method, path, body });
    if (path.endsWith("/actions/runs/123"))
      return Response.json({
        id: 123,
        created_at: "2026-09-19T12:00:00Z",
        event: "pull_request",
        repository: { full_name: "owner/repo" },
      });
    if (path.endsWith("/pulls/12")) return Response.json(pr);
    if (path.endsWith("/check-runs") && init.method === "GET")
      return Response.json({ total_count: checks.length, check_runs: checks });
    if (path.endsWith("/check-runs") && init.method === "POST") {
      const c = { id: 42, app: { slug: "github-actions" }, ...body };
      checks.push(c);
      return Response.json(c, { status: 201 });
    }
    if (path.endsWith("/check-runs/42") && init.method === "PATCH") {
      Object.assign(checks[0], body);
      return Response.json(checks[0]);
    }
    if (path.endsWith("/files"))
      return Response.json([
        { filename: "card.css", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" },
      ]);
    if (path.endsWith("/reviews") && init.method === "GET")
      return Response.json(reviews);
    if (path.endsWith("/reviews") && init.method === "POST") {
      const r = { id: 1, user: { login: "github-actions[bot]" }, ...body };
      reviews.push(r);
      return Response.json(r, { status: 201 });
    }
    throw new Error(`Unexpected provider request ${init.method} ${path}`);
  };
  return { result, context, checks, reviews, calls, fetcher };
}
test("real Octokit adapter uses one durable Check and pinned inline review across fresh-process replay", async () => {
  const h = providerFixture();
  const first = createGitHubProvider("publication-only", true, h.fetcher);
  assert.deepEqual(await first.run("owner", "repo", 123), {
    id: "123",
    createdAt: "2026-09-19T12:00:00Z",
  });
  assert.equal(
    await publishResult(first, h.context, h.result, "a".repeat(64), true),
    "published",
  );
  assert.equal(h.checks.length, 1);
  assert.equal(h.reviews.length, 1);
  assert.equal(h.reviews[0].commit_id, h.context.head);
  assert.equal(h.checks[0].head_sha, h.context.head);
  assert.equal(h.checks[0].conclusion, "failure");
  const writes = h.calls.filter((c) => c.method !== "GET").length;
  const replay = createGitHubProvider("publication-only", false, h.fetcher);
  assert.equal(
    await publishResult(replay, h.context, h.result, "a".repeat(64), true),
    "published",
  );
  assert.equal(h.calls.filter((c) => c.method !== "GET").length, writes);
});
test("rerun without visible durable Check refuses to repeat an ambiguous creation", async () => {
  const h = providerFixture();
  const replay = createGitHubProvider("publication-only", false, h.fetcher);
  assert.equal(
    await publishResult(replay, h.context, h.result, "a".repeat(64), true),
    "failed",
  );
  assert.equal(h.calls.filter((c) => c.method !== "GET").length, 0);
});
test("untrusted marker authors and duplicate check records fail closed", async () => {
  const h = providerFixture();
  const p = createGitHubProvider("publication-only", false, h.fetcher);
  const key = "a".repeat(64);
  h.reviews.push({
    commit_id: h.context.head,
    body: `<!-- breaklint-hosted-v1:${key} -->`,
    user: { login: "contributor" },
  });
  assert.equal(await p.hasReview(h.context, key), false);
  const check = {
    id: 42,
    external_id: `breaklint-hosted-v1:${key}`,
    app: { slug: "github-actions" },
    output: { summary: `<!-- breaklint-journal:${"b".repeat(64)}:published -->` },
  };
  h.checks.push(check, { ...check, id: 43 });
  await assert.rejects(p.find(h.context, key), /DUPLICATE_DELIVERY/);
});
