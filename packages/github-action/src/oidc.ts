import type { RevisionContext } from "./context.js";
/** No service-secret fallback. Forks never request an identity token. */
export async function sameRepoCredential(
  context: RevisionContext,
  audience: string,
  getIDToken: (audience: string) => Promise<string>,
  setSecret: (token: string) => void,
): Promise<{ token: string; forkAuthorized: false } | undefined> {
  if (context.fork || !audience || audience.length > 256) return undefined;
  try {
    const token = await getIDToken(audience);
    if (!token || token.length > 16384) return undefined;
    setSecret(token);
    return { token, forkAuthorized: false };
  } catch {
    return undefined;
  }
}
/** Runner-provided GitHub endpoint only. Credentials stay in headers and are never
 * forwarded on redirects. No toolkit debug output, retries or unbounded bodies. */
export async function requestGitHubIdToken(
  audience: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  try {
    const url = new URL(env["ACTIONS_ID_TOKEN_REQUEST_URL"] ?? "");
    const token = env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"];
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".actions.githubusercontent.com") ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !token ||
      !audience ||
      audience.length > 256
    )
      throw new Error();
    url.searchParams.set("audience", audience);
    const response = await fetcher(url.href, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (response.status !== 200 || !response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const bytes: unknown = next.value;
        if (!(bytes instanceof Uint8Array)) throw new Error();
        length += bytes.length;
        if (length > 32768) throw new Error();
        chunks.push(bytes);
      }
    } finally {
      await reader.cancel();
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      value?: unknown;
    };
    if (typeof value.value !== "string" || !value.value || value.value.length > 16384)
      throw new Error();
    return value.value;
  } catch {
    throw new Error("ACCESS_UNAVAILABLE");
  }
}
