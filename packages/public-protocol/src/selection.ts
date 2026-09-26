/** Public transfer safety only; no semantic relevance or analyzer decisions. */
export const authoredPath = (path: string): boolean =>
  /\.(?:tsx?|jsx?|mjs|cjs|css|scss|sass|json|yaml|yml)$/.test(path) ||
  /(?:^|\/)(?:\.gitignore|\.breaklintignore|\.gitattributes)$/.test(path);
export const sensitivePath = (path: string): boolean =>
  path
    .split("/")
    .some((p) =>
      /^(?:\.env(?:\..*)?|\.npmrc|\.yarnrc(?:\.yml)?|\.gitconfig|\.netrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx))$/i.test(
        p,
      ),
    );
export const generatedPath = (path: string): boolean =>
  path
    .split("/")
    .some((p) =>
      [
        "node_modules",
        ".next",
        ".nuxt",
        ".svelte-kit",
        ".turbo",
        ".cache",
        "dist",
        "build",
        "out",
        "coverage",
        "vendor",
        "generated",
        "__generated__",
        ".yarn",
        ".pnpm-store",
      ].includes(p),
    );
export const sensitiveContent = (text: string): boolean =>
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,})|(?:password|secret|token|api[_-]?key)\s*[=:]\s*["'][^"'\n]{8,}["']/i.test(
    text,
  );
