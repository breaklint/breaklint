import { test } from "node:test";
import assert from "node:assert/strict";
import { createPullRequestDiffIndex } from "../dist/diff.js";

for (const [name, file, expected] of [
  [
    "context and added lines",
    { patch: "@@ -10,4 +10,5 @@\n context\n-old\n+new" },
    [{ startLine: 10, endLine: 14 }],
  ],
  [
    "implicit single line",
    { patch: "@@ -3 +7 @@\n+one" },
    [{ startLine: 7, endLine: 7 }],
  ],
  [
    "multiple hunks",
    { patch: "@@ -1,2 +1,2 @@\n a\n b\n@@ -40,3 +40,3 @@" },
    [
      { startLine: 1, endLine: 2 },
      { startLine: 40, endLine: 42 },
    ],
  ],
  ["pure deletion", { patch: "@@ -1,3 +0,0 @@\n-a\n-b\n-c" }, []],
  ["omitted patch", {}, []],
  ["malformed header", { patch: "@@ invalid @@\n+new" }, []],
  ["removed file", { status: "removed", patch: "@@ -1 +1 @@" }, undefined],
  ["deleted file", { status: "deleted", patch: "@@ -1 +1 @@" }, undefined],
]) {
  test(`diff commentable ranges: ${name}`, () => {
    const index = createPullRequestDiffIndex([
      { filename: "card.css", status: "modified", ...file },
    ]);
    assert.deepEqual(index.get("card.css"), expected);
    assert.equal(index.get("unrelated.css"), undefined);
  });
}
