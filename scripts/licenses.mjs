import {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, "..");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const names = [
  "public-protocol",
  "public-config",
  "hosted-client",
  "cli",
  "github-action",
];
const meta = json(join(root, "packages/github-action/dist-bundle/metafile.json"));
function packageRoot(file, wanted) {
  let dir = dirname(file);
  for (;;) {
    const path = join(dir, "package.json");
    if (existsSync(path)) {
      const m = json(path);
      if (m.name && (!wanted || m.name === wanted)) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw Error("Package origin unavailable");
    dir = parent;
  }
}
const bundled = new Set(
  Object.keys(meta.inputs)
    .filter((p) => p.includes("node_modules/"))
    .map((p) => realpathSync(packageRoot(resolve(root, p)))),
);
const inventory = new Map();
function resolvePackage(req, name) {
  for (const dir of req.resolve.paths(name + "/package.json") ?? []) {
    const manifest = join(dir, name, "package.json");
    if (existsSync(manifest)) return manifest;
  }
  throw Error("Unresolved dependency: " + name);
}
function visit(dir, scope) {
  dir = realpathSync(dir);
  const m = json(join(dir, "package.json"));
  const key = m.name + "@" + m.version;
  const prior = inventory.get(key);
  if (prior) {
    prior.scopes.add(scope);
    return;
  }
  const notices = readdirSync(dir).filter((n) =>
    /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(n),
  );
  const item = {
    name: m.name,
    version: m.version,
    license: m.license ?? "UNKNOWN",
    scopes: new Set([scope]),
    bundledInAction: bundled.has(dir),
    dependencies: m.dependencies ?? {},
    noticeFiles: notices.map((n) => ({
      name: n,
      sha256: createHash("sha256")
        .update(readFileSync(join(dir, n)))
        .digest("hex"),
    })),
    dir,
  };
  inventory.set(key, item);
  const req = createRequire(join(dir, "package.json"));
  for (const dep of Object.keys(m.dependencies ?? {})) {
    const entry = resolvePackage(req, dep);
    visit(packageRoot(entry, dep), scope);
  }
}
const direct = [];
for (const name of names) {
  const dir = join(root, "packages", name);
  const m = json(join(dir, "package.json"));
  for (const [dep, version] of Object.entries(m.dependencies ?? {})) {
    direct.push({ owner: m.name, name: dep, version });
    if (dep.startsWith("@breaklint/")) continue;
    const req = createRequire(join(dir, "package.json"));
    const entry = resolvePackage(req, dep);
    visit(packageRoot(entry, dep), "runtime");
  }
}
const req = createRequire(join(root, "package.json"));
for (const dep of Object.keys(json(join(root, "package.json")).devDependencies)) {
  const entry = resolvePackage(req, dep);
  visit(packageRoot(entry, dep), "development");
}
// Account for every third-party bundle input independently of manifest traversal.
for (const dir of bundled) visit(dir, "runtime");
const items = [...inventory.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const publicItems = items.map((item) => {
  const i = { ...item, scopes: [...item.scopes].sort() };
  delete i.dir;
  return i;
});
const unknown = publicItems.filter(
  (i) => i.license === "UNKNOWN" || i.noticeFiles.length === 0,
);
const out = {
  schemaVersion: 1,
  scope: "Resolved public runtime and development graph; Action input closure",
  direct,
  packages: publicItems,
  unknownOrMissingNotices: unknown.map((i) => i.name + "@" + i.version),
  projectLicenseDecision:
    "Pending; inherited CLI MIT metadata is not a repository-wide grant",
  unicodeData: {
    source: "https://www.unicode.org/license.txt",
    notice: "Unicode-License.txt",
    provenance:
      "Case-fold table comment identifies Unicode 13.0.0 generated through Python; historical generation inputs and license applicability require owner review",
  },
};
writeFileSync(join(root, "DEPENDENCIES.json"), JSON.stringify(out, null, 2) + "\n");
let text =
  "# Third-party dependency inventory and notices\n\nGenerated from the installed lockfile graph and Action bundler inputs. No legal clearance is asserted. Preserve these notices with bundled distributions. Breaklint licensing and Unicode generation provenance remain owner review gates.\n\n| Package | Version | License | Action bundle | Scope |\n| --- | --- | --- | --- | --- |\n";
for (const i of items)
  text += `| ${i.name} | ${i.version} | ${i.license} | ${i.bundledInAction ? "yes" : "no"} | ${[...i.scopes].join(", ")} |\n`;
for (const i of items) {
  text += `\n## ${i.name}@${i.version}\n\n`;
  for (const notice of i.noticeFiles)
    text += `### ${notice.name}\n\n\`\`\`text\n${readFileSync(join(i.dir, notice.name), "utf8")}\n\`\`\`\n`;
}
text +=
  "\n## Unicode data\n\nSee Unicode-License.txt for the retrieved Unicode permission notice. Confirm historical generation provenance and applicable license before publication.\n";
writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), text);
for (const name of names) {
  const dest = join(root, "packages", name, "THIRD_PARTY_NOTICES.md");
  // A full notice set is intentionally retained; no attribution pruning by size.
  writeFileSync(dest, text);
  const p = join(root, "packages", name, "package.json");
  const m = json(p);
  if (!m.files.includes("THIRD_PARTY_NOTICES.md")) {
    m.files.push("THIRD_PARTY_NOTICES.md", "Unicode-License.txt");
    writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  }
  if (existsSync(join(root, "Unicode-License.txt")))
    writeFileSync(
      join(root, "packages", name, "Unicode-License.txt"),
      readFileSync(join(root, "Unicode-License.txt")),
    );
}
writeFileSync(join(root, "action/THIRD_PARTY_NOTICES.md"), text);
if (existsSync(join(root, "Unicode-License.txt")))
  writeFileSync(
    join(root, "action/Unicode-License.txt"),
    readFileSync(join(root, "Unicode-License.txt")),
  );
console.log(
  JSON.stringify({
    packages: items.length,
    bundled: items.filter((i) => i.bundledInAction).length,
    unknownOrMissingNotices: out.unknownOrMissingNotices,
  }),
);
