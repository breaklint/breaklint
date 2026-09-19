import type { AnalysisRequest } from "@breaklint/public-protocol";
export interface RevisionContext {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly repository: AnalysisRequest["repository"];
  readonly rawHeadRepository: AnalysisRequest["repository"];
  readonly base: string;
  readonly head: string;
  readonly fork: boolean;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_CONTEXT");
  return value as Record<string, unknown>;
};
const sha = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value))
    throw new Error("INVALID_CONTEXT");
  return value;
};
const id = (value: unknown): string => {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error("INVALID_CONTEXT");
  return String(value);
};
/** Provider metadata is checked independently; event claims never grant service authority. */
export function resolveContext(
  repository: string,
  eventName: string,
  event: unknown,
): RevisionContext {
  if (eventName !== "pull_request") throw new Error("UNSUPPORTED_EVENT");
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!match?.[1] || !match[2]) throw new Error("INVALID_CONTEXT");
  const payload = object(event),
    pr = object(payload["pull_request"]);
  const base = object(pr["base"]),
    head = object(pr["head"]);
  const target = object(base["repo"]),
    source = object(head["repo"]);
  if (
    target["full_name"] !== repository ||
    object(payload["repository"])["id"] !== target["id"]
  )
    throw new Error("INVALID_CONTEXT");
  const targetId = id(target["id"]),
    sourceId = id(source["id"]);
  const number = Number(pr["number"]);
  if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647)
    throw new Error("INVALID_CONTEXT");
  return {
    owner: match[1],
    repo: match[2],
    number,
    repository: { kind: "github", host: "github.com", repositoryId: targetId },
    rawHeadRepository: { kind: "github", host: "github.com", repositoryId: sourceId },
    base: sha(base["sha"]),
    head: sha(head["sha"]),
    fork: targetId !== sourceId,
  };
}
export function matches(a: RevisionContext, b: RevisionContext): boolean {
  return (
    a.owner === b.owner &&
    a.repo === b.repo &&
    a.number === b.number &&
    a.base === b.base &&
    a.head === b.head &&
    a.repository.repositoryId === b.repository.repositoryId &&
    a.rawHeadRepository.repositoryId === b.rawHeadRepository.repositoryId
  );
}
