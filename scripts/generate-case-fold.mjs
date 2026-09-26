import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const provenance = JSON.parse(
  readFileSync(resolve(root, "unicode/13.0.0/provenance.json"), "utf8"),
);
for (const [file, hash] of [
  [provenance.input, provenance.sha256],
  [provenance.licenseFile, provenance.licenseSha256],
]) {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(resolve(root, file)))
      .digest("hex"),
    hash,
    `Pinned Unicode input changed: ${file}`,
  );
}
const mappings = new Map();
for (const line of readFileSync(resolve(root, provenance.input), "utf8").split("\n")) {
  const record = line.split("#")[0].trim();
  if (!record) continue;
  const [source, status, target] = record.split(";").map((part) => part.trim());
  if (status !== "C" && status !== "F") continue;
  const codePoint = parseInt(source, 16);
  assert(!mappings.has(codePoint), "Duplicate full mapping");
  mappings.set(
    codePoint,
    String.fromCodePoint(...target.split(" ").map((c) => parseInt(c, 16))),
  );
}
assert.equal(mappings.size, provenance.mappingCount);
// CaseFolding.txt specifies identity for omitted characters. Pin identity for
// mapping targets too: Cherokee folds to uppercase, which runtime lowercase
// would otherwise undo. Other characters retain the existing runtime fallback.
for (const value of [...mappings.values()]) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (!mappings.has(codePoint)) mappings.set(codePoint, character);
  }
}
// Escape UTF-16 code units, including surrogate pairs, without using host case data.
const quote = (value) =>
  '"' +
  Array.from(
    { length: value.length },
    (_, i) => "\\u" + value.charCodeAt(i).toString(16).padStart(4, "0"),
  ).join("") +
  '"';
const output = `// Generated from Unicode 13.0.0 CaseFolding.txt; do not edit.
// © 2019 Unicode®, Inc. See Unicode-License.txt and PROVENANCE.md.
// Modified representation: C/F mappings and target identities; lowercase fallback and NFC retained.
// Regenerate: node scripts/generate-case-fold.mjs
const mappings: Readonly<Record<string, string>> = {
${[...mappings]
  .sort(([a], [b]) => a - b)
  .map(([c, v]) => `  ${quote(String.fromCodePoint(c))}: ${quote(v)},`)
  .join("\n")}
};
export function foldPath(path: string): string {
  return Array.from(path, (c) => mappings[c] ?? c.toLowerCase())
    .join("")
    .normalize("NFC");
}
`;
const target = resolve(root, "packages/public-protocol/src/case-fold.ts");
if (process.argv[2] === "--check") {
  assert.equal(readFileSync(target, "utf8"), output, "Regenerate Unicode output");
} else {
  writeFileSync(process.argv[2] ? resolve(process.argv[2]) : target, output);
}
console.log(
  `Verified Unicode ${provenance.unicodeVersion}: ${provenance.mappingCount} C/F mappings, ${mappings.size} table entries`,
);
