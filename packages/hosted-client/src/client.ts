import type { AnalysisResult } from "@breaklint/public-protocol";
import {
  parseResult,
  parseError,
  parseJson,
  canonicalize,
  requestDigest,
  validateSubmission,
  sha256,
  V1_LIMITS as L,
} from "@breaklint/public-protocol/internal";
import type { PreparedAnalysis } from "./package.js";
export const CAPABILITIES = Object.freeze({
  protocolVersion: "1.0",
  requestSchemaVersion: "1.0",
  resultSchemaVersion: "1.0",
  packageSchemaVersion: "1.0",
  policySchemaVersion: "1.0",
  selectionProfile: "authored-source-1",
});
export interface HostedResponse {
  readonly result: AnalysisResult;
  readonly missingBlobs: readonly string[];
}
export class HostedClientError extends Error {
  constructor(
    readonly code: string,
    readonly runId?: string,
  ) {
    super(code);
  }
}
export function validateHostedResponse(
  value: unknown,
  prepared: PreparedAnalysis,
  runId?: string,
): HostedResponse {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HostedClientError("INVALID_PAYLOAD");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join() !== "missingBlobs,result" ||
    !Array.isArray(v["missingBlobs"])
  )
    throw new HostedClientError("INVALID_PAYLOAD");
  const result = parseResult(v["result"], prepared.request);
  if (runId && result.runId !== runId) throw new HostedClientError("INVALID_PAYLOAD");
  const missing = v["missingBlobs"] as unknown[];
  const declared = new Set(prepared.sourcePackage.manifest.blobs.map((b) => b.sha256));
  if (
    missing.length > declared.size ||
    new Set(missing).size !== missing.length ||
    missing.some((b) => typeof b !== "string" || !declared.has(b)) ||
    (result.state !== "uploading" && missing.length)
  )
    throw new HostedClientError("INVALID_PAYLOAD");
  return { result, missingBlobs: missing as string[] };
}
export function createHostedClient(options: {
  endpoint: string;
  token: string;
  fetch?: typeof fetch;
}) {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new HostedClientError("INVALID_INPUT");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new HostedClientError("INVALID_INPUT");
  const fetcher = options.fetch ?? fetch;
  const observed = new Map<string, AnalysisResult>();
  const requestRuns = new Map<string, string>();
  const accept = (value: unknown, p: PreparedAnalysis, id?: string): HostedResponse => {
    const digest = requestDigest(p.request);
    const response = validateHostedResponse(value, p, id ?? requestRuns.get(digest));
    requestRuns.set(digest, response.result.runId);
    const result = response.result,
      previous = observed.get(result.runId);
    if (
      previous &&
      (previous.acceptedAt !== result.acceptedAt ||
        previous.deadlineAt !== result.deadlineAt ||
        previous.idempotencyExpiresAt !== result.idempotencyExpiresAt ||
        (previous.state === "terminal" &&
          canonicalize(previous) !== canonicalize(result)))
    )
      throw new HostedClientError("INVALID_PAYLOAD");
    observed.set(result.runId, result);
    return response;
  };
  const url = endpoint.href.replace(/\/$/, "");
  async function call(
    path: string,
    method: string,
    body: string | Uint8Array | undefined,
    deadline: number,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      if (Date.now() >= deadline) throw new HostedClientError("DEADLINE_EXCEEDED");
      let retryAfter = 0;
      try {
        const response = await fetcher(url + path, {
          method,
          redirect: "error",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type":
              body instanceof Uint8Array
                ? "application/octet-stream"
                : "application/json",
          },
          ...(body === undefined
            ? {}
            : { body: typeof body === "string" ? body : Buffer.from(body) }),
          signal: AbortSignal.timeout(
            Math.min(L.operationSeconds * 1000, deadline - Date.now()),
          ),
        });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        if (reader)
          try {
            for (;;) {
              const part = (await reader.read()) as {
                done: boolean;
                value?: Uint8Array;
              };
              if (part.done) break;
              if (!part.value) throw new HostedClientError("INVALID_PAYLOAD");
              bytes += part.value.length;
              if (bytes > L.manifestBytes)
                throw new HostedClientError("LIMIT_EXCEEDED");
              chunks.push(part.value);
            }
          } finally {
            await reader.cancel();
          }
        const value = parseJson(Buffer.concat(chunks), L.manifestBytes);
        if (response.ok) return value;
        const error = parseError(value);
        if (error.retry !== "same-request") throw new HostedClientError(error.code);
        retryAfter = "retryAfterSeconds" in error ? (error.retryAfterSeconds ?? 0) : 0;
      } catch (error) {
        if (error instanceof HostedClientError) throw error;
        // Invalid control JSON is never retried as a network failure.
        if (error instanceof Error && error.message === "INVALID_PAYLOAD")
          throw new HostedClientError("INVALID_PAYLOAD");
      }
      if (attempt >= L.mutationRetries)
        throw new HostedClientError("SERVICE_UNAVAILABLE");
      const delay = Math.max(
        retryAfter * 1000,
        Math.min(60000, 1000 * 2 ** attempt + Math.random() * 500),
      );
      if (Date.now() + delay >= deadline)
        throw new HostedClientError("DEADLINE_EXCEEDED");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  const bound = (p: PreparedAnalysis, id: string) =>
    `/runs/${encodeURIComponent(id)}?requestDigest=${requestDigest(p.request)}`;
  return {
    async begin(p: PreparedAnalysis): Promise<HostedResponse> {
      validateSubmission(p.request, p.sourcePackage);
      const deadline = Date.now() + L.operationSeconds * 1000;
      const capabilities = await call("/capabilities", "GET", undefined, deadline);
      if (
        !capabilities ||
        typeof capabilities !== "object" ||
        Array.isArray(capabilities) ||
        Object.keys(capabilities).join() !== "versions"
      )
        throw new HostedClientError("INVALID_PAYLOAD");
      const versions = (capabilities as { versions: unknown }).versions;
      if (
        !Array.isArray(versions) ||
        versions.length < 1 ||
        versions.length > L.versionTuples
      )
        throw new HostedClientError("INVALID_PAYLOAD");
      for (const version of versions as unknown[]) {
        if (
          !version ||
          typeof version !== "object" ||
          Array.isArray(version) ||
          Object.keys(version).sort().join() !==
            Object.keys(CAPABILITIES).sort().join() ||
          Object.values(version).some((v) => typeof v !== "string" || v.length > 64)
        )
          throw new HostedClientError("INVALID_PAYLOAD");
      }
      if (
        !versions.some(
          (version) => canonicalize(version) === canonicalize(CAPABILITIES),
        )
      )
        throw new HostedClientError("UNSUPPORTED_PROTOCOL");
      return accept(
        await call(
          "/runs",
          "POST",
          JSON.stringify({ request: p.request, sourcePackage: p.sourcePackage }),
          deadline,
        ),
        p,
      );
    },
    async upload(
      p: PreparedAnalysis,
      state: HostedResponse,
      signal?: AbortSignal,
    ): Promise<HostedResponse> {
      let current = state;
      for (const digest of state.missingBlobs) {
        if (signal?.aborted) return this.cancel(p, state.result.runId);
        if (current.result.state !== "uploading") break;
        const bytes = p.bodies.get(digest);
        if (!bytes || bytes.length > L.sourceBlobBytes || sha256(bytes) !== digest)
          throw new HostedClientError("INTEGRITY_MISMATCH");
        current = accept(
          await call(
            bound(p, state.result.runId).replace("?", `/blobs/${digest}?`),
            "PUT",
            bytes,
            Math.min(
              Date.parse(state.result.deadlineAt),
              Date.parse(state.result.acceptedAt) + L.uploadSeconds * 1000,
            ),
          ),
          p,
          state.result.runId,
        );
      }
      return current;
    },
    async read(
      p: PreparedAnalysis,
      id: string,
      deadline = Date.now() + L.operationSeconds * 1000,
    ): Promise<HostedResponse> {
      return accept(await call(bound(p, id), "GET", undefined, deadline), p, id);
    },
    async cancel(p: PreparedAnalysis, id: string): Promise<HostedResponse> {
      return accept(
        await call(
          bound(p, id),
          "DELETE",
          undefined,
          Date.now() + L.cancelSeconds * 1000,
        ),
        p,
        id,
      );
    },
    async analyze(p: PreparedAnalysis, signal?: AbortSignal): Promise<AnalysisResult> {
      let state = await this.begin(p);
      try {
        if (signal?.aborted) return (await this.cancel(p, state.result.runId)).result;
        state = await this.upload(p, state, signal);
        while (state.result.state !== "terminal") {
          if (signal?.aborted) state = await this.cancel(p, state.result.runId);
          else {
            const delay = state.result.pollAfterSeconds * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            state = await this.read(
              p,
              state.result.runId,
              Date.parse(state.result.deadlineAt),
            );
          }
        }
        return state.result;
      } catch (error) {
        throw new HostedClientError(
          error instanceof HostedClientError ? error.code : "SERVICE_UNAVAILABLE",
          state.result.runId,
        );
      }
    },
  };
}
