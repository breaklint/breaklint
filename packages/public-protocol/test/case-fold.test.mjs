import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { foldPath } from "../dist/case-fold.js";

const root = resolve(import.meta.dirname, "../../..");
test("Unicode output is reproducible from the pinned input and historical notice", () => {
  execFileSync(process.execPath, ["scripts/generate-case-fold.mjs", "--check"], {
    cwd: root,
  });
});

test("every Unicode 13 full default mapping and its implicit identity target folds correctly", () => {
  let count = 0;
  const input = readFileSync(resolve(root, "unicode/13.0.0/CaseFolding.txt"), "utf8");
  for (const line of input.split("\n")) {
    const [source, status, target] = line
      .split("#")[0]
      .split(";")
      .map((s) => s.trim());
    if (status !== "C" && status !== "F") continue;
    const value = String.fromCodePoint(
      ...target.split(" ").map((c) => parseInt(c, 16)),
    );
    assert.equal(
      foldPath(String.fromCodePoint(parseInt(source, 16))),
      value.normalize("NFC"),
    );
    assert.equal(foldPath(value), value.normalize("NFC"));
    count++;
  }
  assert.equal(count, 1490);
});

test("path folding retains Cherokee, expansions, default Turkic handling, NFC and runtime fallback", () => {
  assert.equal(foldPath("Src/Straße.tsx"), "src/strasse.tsx");
  assert.equal(foldPath("\u13a0/\uab70"), "\u13a0/\u13a0");
  assert.equal(foldPath("İIı"), "i\u0307iı");
  assert.equal(foldPath("A\u030a/Σς"), "å/σσ");
  // Added after Unicode 13: retain the supported runtime's lowercase behavior.
  assert.equal(foldPath("\uA7D0"), "\uA7D0".toLowerCase().normalize("NFC"));
  assert.equal(foldPath("a\ud800B"), "a\ud800b");
});
