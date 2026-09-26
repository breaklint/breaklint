import ignore from "ignore";

/** Rules captured from immutable revision blobs, never checkout/global Git config. */
export function revisionIgnoreMatcher(
  controls: readonly { path: string; contents: string }[],
) {
  const rules = controls
    .filter((c) => /(^|\/)(?:\.gitignore|\.breaklintignore)$/.test(c.path))
    .map((c) => ({
      directory: c.path.slice(0, c.path.lastIndexOf("/") + 1),
      matcher: ignore().add(c.contents),
    }));
  return (path: string): boolean =>
    rules.some(
      (r) =>
        path.startsWith(r.directory) &&
        r.matcher.ignores(path.slice(r.directory.length)),
    );
}
