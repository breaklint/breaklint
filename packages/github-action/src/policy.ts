import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectPolicy } from "@breaklint/public-config";
const execute = promisify(execFile);
/** Only declarative policy at exact trusted Base. Never import checkout configuration. */
export async function readBasePolicy(repositoryRoot: string, base: string) {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("INVALID_CONTEXT");
  const git = async (...args: string[]) =>
    (
      await execute(
        "git",
        ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args],
        {
          cwd: repositoryRoot,
          maxBuffer: 262144,
          timeout: 30000,
          env: {
            PATH: process.env["PATH"],
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
          },
        },
      )
    ).stdout;
  const entry = await git("ls-tree", base, "--", "breaklint.policy.json");
  if (!entry) return projectPolicy();
  if (!/^100644 blob [a-f0-9]{40}\tbreaklint\.policy\.json\n$/.test(entry))
    throw new Error("INVALID_POLICY");
  return projectPolicy(await git("show", `${base}:breaklint.policy.json`));
}
