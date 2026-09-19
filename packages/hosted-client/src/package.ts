import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import ignore from "ignore";
import type { AnalysisRequest, PublicAnalysisPolicy } from "@breaklint/public-protocol";
import {
  parsePolicy,
  parseSourcePackage,
  parseRequest,
  manifestDigest,
  policyDigest,
  transferPolicyDigest,
  sha256,
  validateSubmission,
  V1_LIMITS as L,
  authoredPath,
  sensitivePath,
  sensitiveContent,
  generatedPath,
} from "@breaklint/public-protocol/internal";
const execute = promisify(execFile);
type Package = ReturnType<typeof parseSourcePackage>;
type File = Package["manifest"]["snapshots"][number]["files"][number];
export interface PreparedAnalysis {
  readonly request: AnalysisRequest;
  readonly sourcePackage: Package;
  readonly bodies: ReadonlyMap<string, Uint8Array>;
}
export async function prepareAnalysis(input: {
  repositoryRoot: string;
  repository: AnalysisRequest["repository"];
  base: string;
  head: string;
  policy: PublicAnalysisPolicy;
  requestId?: string;
  effectiveCandidate?: string;
  rawHeadRepository?: AnalysisRequest["repository"];
  pullRequest?: { readonly number: number };
}): Promise<PreparedAnalysis> {
  try {
    const policy = parsePolicy(input.policy);
    const git = async (...args: string[]) =>
      (
        await execute(
          "git",
          ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args],
          {
            cwd: input.repositoryRoot,
            encoding: "buffer",
            maxBuffer: L.manifestBytes,
            timeout: L.operationSeconds * 1000,
            env: {
              PATH: process.env["PATH"],
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_TERMINAL_PROMPT: "0",
              GIT_OPTIONAL_LOCKS: "0",
            },
          },
        )
      ).stdout;
    if ((await git("rev-parse", "--show-object-format")).toString().trim() !== "sha1")
      throw new Error("UNSUPPORTED_OBJECT_FORMAT");
    const exact = async (ref: string) => {
      if (!ref || ref.startsWith("-") || ref.length > 256)
        throw new Error("INVALID_INPUT");
      const id = (
        await git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`)
      )
        .toString()
        .trim();
      if (!/^[a-f0-9]{40}$/.test(id)) throw new Error("INVALID_INPUT");
      return id;
    };
    const base = { repository: input.repository, commit: await exact(input.base) };
    const rawHead = {
      repository: input.rawHeadRepository ?? input.repository,
      commit: await exact(input.head),
    };
    const effectiveCandidate = input.effectiveCandidate
      ? { repository: input.repository, commit: await exact(input.effectiveCandidate) }
      : undefined;
    const bodies = new Map<string, Uint8Array>();
    let total = 0;
    const blob = (bytes: Buffer) => {
      if (bytes.length > L.sourceBlobBytes) throw new Error("LIMIT_EXCEEDED");
      const hash = sha256(bytes);
      if (!bodies.has(hash)) {
        total += bytes.length;
        if (total > L.aggregateBytes) throw new Error("LIMIT_EXCEEDED");
        bodies.set(hash, bytes);
      }
      return { sha256: hash, byteLength: bytes.length };
    };
    const proof = new Map<string, Package["manifest"]["proof"]["objects"][number]>();
    const commits = new Set<string>();
    let proofBytes = 0;
    const addObject = async (kind: "commit" | "tree", id: string): Promise<Buffer> => {
      if (proof.size >= L.proofObjects && !proof.has(id))
        throw new Error("LIMIT_EXCEEDED");
      const bytes = await git("cat-file", kind, id);
      if (sensitiveContent(bytes.toString("utf8")))
        throw new Error("PROOF_PRIVACY_BLOCKED");
      if (bytes.length > (kind === "commit" ? L.commitBytes : L.treeBytes))
        throw new Error("LIMIT_EXCEEDED");
      if (!proof.has(id)) proofBytes += bytes.length;
      if (proofBytes > L.proofBytes) throw new Error("LIMIT_EXCEEDED");
      proof.set(id, { kind, gitObject: id, content: blob(bytes) });
      return bytes;
    };
    const visitCommit = async (id: string, depth: number): Promise<void> => {
      if (commits.has(id)) return;
      if (depth > L.ancestryEdges || commits.size >= L.commits)
        throw new Error("LIMIT_EXCEEDED");
      commits.add(id);
      const text = (await addObject("commit", id)).toString("utf8");
      if (id === base.commit) return;
      const parents = [
        ...(text.split("\n\n")[0] ?? "").matchAll(/^parent ([a-f0-9]{40})$/gm),
      ].map((m) => m[1] ?? "");
      for (const parent of parents) await visitCommit(parent, depth + 1);
    };
    await visitCommit(base.commit, 0);
    await visitCommit(rawHead.commit, 0);
    if (effectiveCandidate) await visitCommit(effectiveCandidate.commit, 0);
    const snapshots: Package["manifest"]["snapshots"][number][] = [];
    for (const [revision, purpose] of [
      [base, "base"],
      [rawHead, "raw-head"],
      ...(effectiveCandidate
        ? [[effectiveCandidate, "effective-candidate"] as const]
        : []),
    ] as const) {
      const rootTree = (await git("rev-parse", `${revision.commit}^{tree}`))
        .toString()
        .trim();
      const treeIds = new Set<string>([rootTree]);
      const entries = (await git("ls-tree", "-rzt", "--full-tree", revision.commit))
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
      if (entries.length > L.expandedTreeEntries) throw new Error("LIMIT_EXCEEDED");
      const leaves: { path: string; mode: string; id: string }[] = [];
      for (const entry of entries) {
        const match = /^(\d+) (blob|tree|commit) ([a-f0-9]{40})\t(.+)$/s.exec(entry);
        if (!match?.[1] || !match[3] || !match[4]) throw new Error("INVALID_INPUT");
        if (match[2] === "tree") treeIds.add(match[3]);
        else leaves.push({ mode: match[1], id: match[3], path: match[4] });
      }
      if (leaves.length > L.leavesPerSnapshot) throw new Error("LIMIT_EXCEEDED");
      for (const id of treeIds) await addObject("tree", id);
      // Immutable per-revision ignore rules. Never read working-tree rules/config.
      const rules: { directory: string; matcher: ReturnType<typeof ignore> }[] = [];
      for (const leaf of leaves)
        if (/(^|\/)(?:\.gitignore|\.breaklintignore)$/.test(leaf.path)) {
          if (leaf.mode !== "100644" && leaf.mode !== "100755")
            throw new Error("PROOF_PRIVACY_BLOCKED");
          const text = (await git("cat-file", "blob", leaf.id)).toString("utf8");
          if (Buffer.byteLength(text) > L.sourceBlobBytes)
            throw new Error("LIMIT_EXCEEDED");
          rules.push({
            directory: leaf.path.slice(0, leaf.path.lastIndexOf("/") + 1),
            matcher: ignore().add(text),
          });
        }
      const files: File[] = [];
      let includedBytes = 0;
      for (const leaf of leaves) {
        const { path, mode, id: gitObject } = leaf;
        let reason: Extract<File, { state: "excluded" }>["reason"] | undefined;
        if (sensitivePath(path)) reason = "sensitive";
        else if (
          policy.transferExclusions.some(
            (e) =>
              path === e.path ||
              (e.kind === "directory" && path.startsWith(e.path + "/")),
          )
        )
          reason = "user-excluded";
        else if (
          rules.some(
            (r) =>
              path.startsWith(r.directory) &&
              r.matcher.ignores(path.slice(r.directory.length)),
          )
        )
          reason = "revision-ignored";
        else if (mode === "120000") reason = "symlink";
        else if (mode === "160000") reason = "submodule";
        else if (mode !== "100644" && mode !== "100755") reason = "nonregular";
        else if (generatedPath(path)) reason = "profile-excluded";
        else if (!authoredPath(path)) reason = "unsupported-extension";
        let bytes: Buffer | undefined;
        if (!reason) {
          bytes = await git("cat-file", "blob", gitObject);
          if (bytes.length > L.sourceBlobBytes) throw new Error("LIMIT_EXCEEDED");
          let text: string;
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            reason = "binary";
            text = "";
          }
          if (text.includes("\0")) reason = "binary";
          else if (
            /^version https:\/\/git-lfs.github.com\/spec\/v1(?:\r?\n|$)/.test(text)
          )
            reason = "lfs-pointer";
          else if (sensitiveContent(text)) reason = "sensitive";
        }
        if (reason) files.push({ state: "excluded", path, mode, gitObject, reason });
        else if (bytes && (mode === "100644" || mode === "100755")) {
          includedBytes += bytes.length;
          if (includedBytes > L.sourceBytesPerSnapshot)
            throw new Error("LIMIT_EXCEEDED");
          files.push({
            state: "included",
            path,
            mode,
            gitObject,
            content: blob(bytes),
          });
        }
      }
      files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
      snapshots.push({
        revision,
        purpose,
        rootTree,
        files,
        accounting: {
          enumeratedLeaves: files.length,
          includedFiles: files.filter((f) => f.state === "included").length,
          excludedFiles: files.filter((f) => f.state === "excluded").length,
          unavailableFiles: 0,
          includedBytes,
        },
      });
    }
    const manifest = {
      packageSchemaVersion: "1.0",
      gitObjectFormat: "sha1",
      repository: input.repository,
      requested: { base, rawHead },
      ...(effectiveCandidate ? { effectiveCandidate } : {}),
      scope: policy.scope,
      transferPolicyDigest: transferPolicyDigest(policy),
      snapshots,
      blobs: [...bodies]
        .map(([sha256, b]) => ({ sha256, byteLength: b.length }))
        .sort((a, b) => a.sha256.localeCompare(b.sha256)),
      proof: {
        encoding: "git-object-bodies-1",
        objects: [...proof.values()].sort((a, b) =>
          Buffer.compare(
            Buffer.from(a.kind + "\0" + a.gitObject),
            Buffer.from(b.kind + "\0" + b.gitObject),
          ),
        ),
      },
      changeHints: [],
    };
    const sourcePackage = parseSourcePackage({
      manifest,
      manifestDigest: manifestDigest(manifest),
    });
    const requestId =
      input.requestId ??
      new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z") +
        "_" +
        randomBytes(16).toString("hex");
    const request = parseRequest({
      protocolVersion: "1.0",
      requestSchemaVersion: "1.0",
      resultSchemaVersion: "1.0",
      requestId,
      repository: input.repository,
      comparison: {
        base,
        rawHead,
        ...(input.pullRequest ? { pullRequest: input.pullRequest } : {}),
      },
      source: {
        packageSchemaVersion: "1.0",
        manifestDigest: sourcePackage.manifestDigest,
      },
      policy,
      policyDigest: policyDigest(policy),
    });
    validateSubmission(request, sourcePackage);
    return { request, sourcePackage, bodies };
  } catch (error) {
    const safe =
      error instanceof Error &&
      ["LIMIT_EXCEEDED", "PROOF_PRIVACY_BLOCKED", "UNSUPPORTED_OBJECT_FORMAT"].includes(
        error.message,
      )
        ? error.message
        : "INVALID_INPUT";
    // eslint-disable-next-line preserve-caught-error -- Public errors must not retain raw Git stderr, paths or source.
    throw new Error(safe);
  }
}
