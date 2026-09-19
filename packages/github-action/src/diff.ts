export interface DiffFileInput {
  readonly filename: string;
  readonly status: string;
  readonly patch?: string | undefined;
}

interface CommentableRange {
  readonly startLine: number;
  readonly endLine: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u;

export function createPullRequestDiffIndex(
  files: readonly DiffFileInput[],
): ReadonlyMap<string, readonly CommentableRange[]> {
  const byPath = new Map<string, CommentableRange[]>();
  for (const file of files) {
    // Removed files and omitted patches have no commentable Head lines.
    if (file.status === "removed" || file.status === "deleted") continue;
    const ranges: CommentableRange[] = [];
    for (const line of (file.patch ?? "").split("\n")) {
      const hunk = HUNK_HEADER.exec(line);
      if (!hunk) continue;
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) continue;
      // GitHub accepts both added and context lines within the Head hunk span.
      ranges.push({ startLine: start, endLine: start + count - 1 });
    }
    byPath.set(file.filename, ranges);
  }
  return byPath;
}
