import {
  createHostedClient,
  prepareAnalysis,
  HostedClientError,
} from "@breaklint/hosted-client";
import { sha256 } from "@breaklint/public-protocol/internal";
import { matches, resolveContext } from "./context.js";
import type { RevisionContext } from "./context.js";
import { readBasePolicy } from "./policy.js";
import { publishResult, renderResult, checkConclusion } from "./publication.js";
import type { PublicationProvider, TerminalResult, Delivery } from "./publication.js";
export interface ActionRuntime {
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  setSecret(value: string): void;
  writeSummary(markdown: string): Promise<void>;
}
export interface ActionDependencies {
  readonly runtime: ActionRuntime;
  readonly provider: PublicationProvider;
  readonly repository: string;
  readonly eventName: string;
  readonly event: unknown;
  readonly repositoryRoot: string;
  readonly endpoint: string;
  /** Provider workflow-run identity and original creation time; unchanged by reruns. */
  readonly run: {
    readonly id: string;
    readonly job: string;
    readonly createdAt: string;
  };
  /** Trusted composition only, never read from Head policy or event fields. */
  readonly credential: (
    context: RevisionContext,
  ) => Promise<{ token: string; forkAuthorized: boolean } | undefined>;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly inline?: boolean;
}
export interface ActionRunSummary {
  readonly result?: TerminalResult;
  readonly delivery: Delivery | "unavailable";
}
export async function runAction(input: ActionDependencies): Promise<ActionRunSummary> {
  const runtime = input.runtime;
  const unavailable = async (
    status: "unavailable" | "failed",
    reason: string,
  ): Promise<ActionRunSummary> => {
    runtime.setOutput("status", status);
    runtime.setOutput("conclusion", "inconclusive");
    runtime.setOutput("delivery", "unavailable");
    runtime.setFailed(`Breaklint ${status}: ${reason}`);
    await runtime.writeSummary(
      `Breaklint: **${status} / inconclusive**. ${reason}. No clean result is claimed.`,
    );
    return { delivery: "unavailable" };
  };
  let result: TerminalResult;
  let context: RevisionContext;
  let key: string;
  try {
    context = resolveContext(input.repository, input.eventName, input.event);
    if (!matches(context, await input.provider.current(context))) {
      runtime.setOutput("status", "unavailable");
      runtime.setOutput("conclusion", "inconclusive");
      runtime.setOutput("delivery", "superseded");
      runtime.setFailed("Breaklint delivery superseded: PR revisions changed.");
      await runtime.writeSummary(
        "Breaklint: superseded before analysis; no current PR verdict.",
      );
      return { delivery: "superseded" };
    }
    const credential = await input.credential(context);
    if (!credential?.token || (context.fork && !credential.forkAuthorized))
      return await unavailable("unavailable", "ACCESS_UNAVAILABLE");
    runtime.setSecret(credential.token);
    if (
      !/^\d+$/.test(input.run.id) ||
      !input.run.job ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.run.createdAt)
    )
      throw new Error("INVALID_CONTEXT");
    key = sha256(
      Buffer.from(
        `${context.repository.repositoryId}:${context.number}:${input.run.id}:${input.run.job}`,
      ),
    );
    const requestId = `${input.run.createdAt.replace(/[-:]/g, "")}_${key.slice(0, 32)}`;
    const policy = await readBasePolicy(input.repositoryRoot, context.base);
    const prepared = await prepareAnalysis({
      repositoryRoot: input.repositoryRoot,
      repository: context.repository,
      rawHeadRepository: context.rawHeadRepository,
      base: context.base,
      head: context.head,
      pullRequest: { number: context.number },
      policy,
      requestId,
    });
    const response = await createHostedClient({
      endpoint: input.endpoint,
      token: credential.token,
      ...(input.fetch ? { fetch: input.fetch } : {}),
    }).analyze(prepared, input.signal);
    if (response.state !== "terminal") throw new Error("INVALID_PAYLOAD");
    result = response;
  } catch (error) {
    const access =
      error instanceof HostedClientError &&
      [
        "UNAUTHENTICATED",
        "FORBIDDEN",
        "ACCESS_UNAVAILABLE",
        "SERVICE_UNAVAILABLE",
      ].includes(error.code);
    return unavailable(
      access ? "unavailable" : "failed",
      access ? "ACCESS_UNAVAILABLE" : "Input, provider, or protocol validation failed",
    );
  }
  // Delivery is separate from the immutable service result, including failures and reruns.
  runtime.setOutput("status", result.outcome.status);
  runtime.setOutput("conclusion", result.outcome.conclusion);
  runtime.setOutput("run-id", result.runId);
  const delivery = await publishResult(
    input.provider,
    context,
    result,
    key,
    input.inline ?? false,
  );
  let summaryFailed = false;
  try {
    await runtime.writeSummary(renderResult(result) + `\n\nDelivery: **${delivery}**.`);
  } catch {
    summaryFailed = true;
  }
  runtime.setOutput("delivery", summaryFailed ? "failed" : delivery);
  if (
    checkConclusion(result) !== "success" ||
    delivery !== "published" ||
    summaryFailed ||
    result.provenance.state !== "verified" ||
    result.provenance.association !== "provider-confirmed"
  )
    runtime.setFailed(
      `Breaklint ${result.outcome.status}/${result.outcome.conclusion}; delivery ${summaryFailed ? "failed" : delivery}.`,
    );
  return { result, delivery: summaryFailed ? "failed" : delivery };
}
