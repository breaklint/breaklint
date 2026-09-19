import { getOctokit } from "@actions/github";
import { resolveContext } from "./context.js";
import type { RevisionContext } from "./context.js";
import type { Journal, PublicationProvider } from "./publication.js";
const prefix = "breaklint-hosted-v1:";
/** GitHub Actions serializes each logical run/job; reruns use the same durable key.
 * Writes are not automatically retried: reconcile provider state on the next attempt.
 */
export function createGitHubProvider(
  token: string,
  allowCreate: boolean,
  fetcher?: typeof fetch,
): PublicationProvider & {
  run(
    owner: string,
    repo: string,
    id: number,
  ): Promise<{ id: string; createdAt: string }>;
} {
  const github = getOctokit(token, {
    request: { timeout: 30000, ...(fetcher ? { fetch: fetcher } : {}) },
  });
  const target = (c: RevisionContext) => ({ owner: c.owner, repo: c.repo });
  const reviewMarker = (key: string) => `<!-- ${prefix}${key} -->`;
  return {
    async run(owner, repo, id) {
      const { data } = await github.rest.actions.getWorkflowRun({
        owner,
        repo,
        run_id: id,
      });
      if (
        data.repository.full_name !== `${owner}/${repo}` ||
        data.event !== "pull_request"
      )
        throw new Error("INVALID_CONTEXT");
      return { id: String(data.id), createdAt: data.created_at };
    },
    async current(c) {
      const { data } = await github.rest.pulls.get({
        ...target(c),
        pull_number: c.number,
      });
      if (data.state !== "open") throw new Error("PR_CLOSED");
      return resolveContext(`${c.owner}/${c.repo}`, "pull_request", {
        repository: data.base.repo,
        pull_request: data,
      });
    },
    async files(c) {
      const files = await github.paginate(github.rest.pulls.listFiles, {
        ...target(c),
        pull_number: c.number,
        per_page: 100,
      });
      // GitHub caps this endpoint at 3,000 files. An incomplete diff cannot grant placement.
      if (files.length >= 3000) return [];
      return files.map((f) => ({
        filename: f.filename,
        status: f.status,
        ...(f.patch ? { patch: f.patch } : {}),
      }));
    },
    async find(c, key) {
      const checks = await github.paginate(github.rest.checks.listForRef, {
        ...target(c),
        ref: c.head,
        check_name: "Breaklint source",
        filter: "all",
        per_page: 100,
      });
      const found = checks.filter(
        (check) =>
          check.external_id === prefix + key && check.app?.slug === "github-actions",
      );
      if (found.length > 1) throw new Error("DUPLICATE_DELIVERY");
      const check = found[0];
      if (!check) return undefined;
      const match =
        /^<!-- breaklint-journal:([a-f0-9]{64}):(reserved|review-pending|reviewed|published|superseded) -->/.exec(
          check.output.summary ?? "",
        );
      if (!match?.[1] || !match[2]) throw new Error("INVALID_JOURNAL");
      return { id: check.id, digest: match[1], state: match[2] as Journal["state"] };
    },
    async reserve(c, key, digest) {
      if (!allowCreate) throw new Error("UNCONFIRMED_PRIOR_DELIVERY");
      const { data } = await github.rest.checks.create({
        ...target(c),
        name: "Breaklint source",
        head_sha: c.head,
        external_id: prefix + key,
        status: "in_progress",
        output: {
          title: "Breaklint source",
          summary: `<!-- breaklint-journal:${digest}:reserved -->\nPublication reserved.`,
        },
      });
      return { id: data.id, digest, state: "reserved" };
    },
    async save(c, journal, summary, conclusion) {
      await github.rest.checks.update({
        ...target(c),
        check_run_id: journal.id,
        ...(conclusion
          ? { status: "completed" as const, conclusion }
          : { status: "in_progress" as const }),
        output: {
          title:
            journal.state === "superseded"
              ? "Breaklint: superseded"
              : "Breaklint source",
          summary: `<!-- breaklint-journal:${journal.digest}:${journal.state} -->\n${summary}`,
        },
      });
    },
    async hasReview(c, key) {
      const reviews = await github.paginate(github.rest.pulls.listReviews, {
        ...target(c),
        pull_number: c.number,
        per_page: 100,
      });
      return reviews.some(
        (r) =>
          r.user?.login === "github-actions[bot]" &&
          r.commit_id === c.head &&
          r.body.includes(reviewMarker(key)),
      );
    },
    async review(c, key, comments) {
      await github.rest.pulls.createReview({
        ...target(c),
        pull_number: c.number,
        commit_id: c.head,
        event: "COMMENT",
        body: reviewMarker(key),
        comments: [...comments],
      });
    },
  };
}
