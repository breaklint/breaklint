import type { AnalysisResult } from "@breaklint/public-protocol";
import { canonicalize, sha256 } from "@breaklint/public-protocol/internal";
import { createPullRequestDiffIndex } from "./diff.js";
import type { DiffFileInput } from "./diff.js";
import { matches } from "./context.js";
import type { RevisionContext } from "./context.js";
export type TerminalResult = Extract<AnalysisResult, { state: "terminal" }>;
export type Delivery = "published" | "superseded" | "failed";
export interface InlineComment {
  readonly path: string;
  readonly line: number;
  readonly side: "RIGHT";
  readonly body: string;
}
export interface Journal {
  readonly id: number;
  readonly digest: string;
  readonly state:
    "reserved" | "review-pending" | "reviewed" | "published" | "superseded";
}
export interface PublicationProvider {
  current(context: RevisionContext): Promise<RevisionContext>;
  files(context: RevisionContext): Promise<readonly DiffFileInput[]>;
  /** Durable provider record; implementations must serialize writers for the logical key. */
  find(context: RevisionContext, key: string): Promise<Journal | undefined>;
  reserve(context: RevisionContext, key: string, digest: string): Promise<Journal>;
  save(
    context: RevisionContext,
    journal: Journal,
    summary: string,
    conclusion?: "success" | "failure" | "cancelled" | "neutral",
  ): Promise<void>;
  hasReview(context: RevisionContext, key: string): Promise<boolean>;
  review(
    context: RevisionContext,
    key: string,
    comments: readonly InlineComment[],
  ): Promise<void>;
}
const escape = (text: string) =>
  text.replace(/[&<>`[\]*_]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/@/g, "&#64;");
export function renderResult(result: TerminalResult): string {
  const lines = [
    `Breaklint: **${result.outcome.status} / ${result.outcome.conclusion}** (${result.outcome.reason})`,
    `Base: \`${result.binding.requested.base.commit}\`; raw Head: \`${result.binding.requested.rawHead.commit}\`.`,
    `Coverage: ${result.scope.coverage}; findings complete: ${result.findingsComplete}.`,
  ];
  if (!result.findings.length)
    lines.push(
      result.outcome.status === "complete"
        ? "No gating findings in the supported analyzed scope."
        : "No findings reported; analysis is incomplete. No clean result is claimed.",
    );
  for (const f of result.findings.slice(0, 50))
    lines.push(
      `- ${escape(f.title)} — ${f.severity}, ${f.disposition}, ${f.gating}: ${escape(f.message).slice(0, 500)}`,
    );
  if (result.findings.length > 50)
    lines.push("Summary truncated; analysis outcome is unchanged.");
  return lines.join("\n\n").slice(0, 55000);
}
export function checkConclusion(
  result: TerminalResult,
): "success" | "failure" | "cancelled" {
  return result.outcome.status === "cancelled"
    ? "cancelled"
    : result.outcome.status === "complete" && result.outcome.conclusion === "pass"
      ? "success"
      : "failure";
}
export async function publishResult(
  provider: PublicationProvider,
  context: RevisionContext,
  result: TerminalResult,
  key: string,
  inline: boolean,
): Promise<Delivery> {
  try {
    if (
      result.binding.requested.base.commit !== context.base ||
      result.binding.requested.rawHead.commit !== context.head ||
      canonicalize(result.binding.repository) !== canonicalize(context.repository) ||
      canonicalize(result.binding.requested.rawHead.repository) !==
        canonicalize(context.rawHeadRepository)
    )
      throw new Error("BINDING_MISMATCH");
    const digest = sha256(Buffer.from(canonicalize(result)));
    let journal = await provider.find(context, key);
    if (journal && journal.digest !== digest) throw new Error("DELIVERY_CONFLICT");
    if (journal?.state === "superseded") return "superseded";
    const current = () =>
      provider.current(context).then((value) => matches(context, value));
    if (!(await current())) {
      if (journal)
        await provider.save(
          context,
          { ...journal, state: "superseded" },
          "Superseded: PR Base or raw Head changed.",
          "neutral",
        );
      return "superseded";
    }
    if (journal?.state === "published") return "published";
    // Provider association is service-owned, never inferred from the event or a client claim.
    const confirmed =
      result.provenance.state === "verified" &&
      result.provenance.association === "provider-confirmed";
    const summary = renderResult(result);
    journal ??= await provider.reserve(context, key, digest);
    if (inline && confirmed && journal.state !== "reviewed") {
      if (await provider.hasReview(context, key)) {
        journal = { ...journal, state: "reviewed" };
      } else if (journal.state === "review-pending") {
        // A prior non-idempotent POST may have committed even when its response was lost.
        // Never blindly repeat it. Retry reconciliation after GitHub exposes the review.
        return "failed";
      } else {
        const diff = createPullRequestDiffIndex(await provider.files(context));
        const comments: InlineComment[] = [];
        for (const finding of result.findings) {
          if (!finding.inline.eligible || finding.inline.side !== "raw-head") continue;
          const target = finding.inline.target;
          if (
            canonicalize(target.revision) !==
            canonicalize(result.binding.requested.rawHead)
          )
            continue;
          const line = target.start.line;
          // Match the service-approved path exactly; never infer a rename.
          if (
            !Number.isInteger(line) ||
            line < 1 ||
            !diff
              .get(target.path)
              ?.some((r) => line >= r.startLine && line <= r.endLine)
          )
            continue;
          comments.push({
            path: target.path,
            line,
            side: "RIGHT",
            body: `${escape(finding.title)}\n\n${escape(finding.message)}`,
          });
          if (comments.length === 50) break;
        }
        if (comments.length) {
          journal = { ...journal, state: "review-pending" };
          await provider.save(context, journal, summary);
          if (!(await current())) {
            await provider.save(
              context,
              { ...journal, state: "superseded" },
              "Superseded before inline publication.",
              "neutral",
            );
            return "superseded";
          }
          await provider.review(context, key, comments);
        }
        journal = { ...journal, state: "reviewed" };
      }
      await provider.save(context, journal, summary);
    }
    if (!(await current())) {
      await provider.save(
        context,
        { ...journal, state: "superseded" },
        "Superseded before final publication.",
        "neutral",
      );
      return "superseded";
    }
    await provider.save(
      context,
      { ...journal, state: "published" },
      summary +
        (confirmed
          ? ""
          : "\n\nProvider association unavailable; this is not an authoritative PR verdict."),
      confirmed ? checkConclusion(result) : "failure",
    );
    return "published";
  } catch {
    return "failed";
  }
}
