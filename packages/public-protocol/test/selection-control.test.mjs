import { test } from "node:test";
import assert from "node:assert/strict";
import { authoredPath } from "../dist/internal.js";
test("authored-source-1 includes non-executable control metadata without widening document transfer", () => {
  for (const name of [".gitignore", ".breaklintignore", ".gitattributes"]) {
    assert.equal(authoredPath(name), true);
    assert.equal(authoredPath("src/" + name), true);
    assert.equal(authoredPath(name + ".bak"), false);
  }
  assert.equal(authoredPath("README.md"), false);
  assert.equal(authoredPath("unknown.xyz"), false);
});
