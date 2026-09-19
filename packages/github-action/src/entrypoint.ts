import * as core from "@actions/core";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createGitHubProvider } from "./github-provider.js";
import { runAction } from "./main.js";
export async function main(): Promise<void> {
  const serviceToken = core.getInput("service-token");
  const githubToken = core.getInput("github-token");
  if (serviceToken) core.setSecret(serviceToken);
  if (githubToken) core.setSecret(githubToken);
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    if (
      !githubToken ||
      process.env["GITHUB_SERVER_URL"] !== "https://github.com" ||
      serviceToken === githubToken
    )
      throw new Error("ACCESS_UNAVAILABLE");
    const repository = process.env["GITHUB_REPOSITORY"] ?? "";
    const [owner, repo] = repository.split("/");
    const id = process.env["GITHUB_RUN_ID"] ?? "";
    if (!owner || !repo || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))
      throw new Error("INVALID_CONTEXT");
    const provider = createGitHubProvider(
      githubToken,
      process.env["GITHUB_RUN_ATTEMPT"] === "1",
    );
    const run = await provider.run(owner, repo, Number(id));
    await runAction({
      runtime: {
        setOutput: core.setOutput,
        setFailed: core.setFailed,
        setSecret: core.setSecret,
        writeSummary: async (markdown) => {
          await core.summary.addRaw(markdown).write();
        },
      },
      provider,
      repository,
      eventName: process.env["GITHUB_EVENT_NAME"] ?? "",
      event: JSON.parse(
        await readFile(process.env["GITHUB_EVENT_PATH"] ?? "", "utf8"),
      ) as unknown,
      repositoryRoot: resolve(
        process.env["GITHUB_WORKSPACE"] ?? process.cwd(),
        core.getInput("working-directory") || ".",
      ),
      endpoint: core.getInput("service-url"),
      run: { ...run, job: process.env["GITHUB_JOB"] ?? "" },
      // A supplied token alone never grants fork access.
      credential: (context) =>
        Promise.resolve(
          !context.fork && serviceToken
            ? { token: serviceToken, forkAuthorized: false }
            : undefined,
        ),
      signal: controller.signal,
      inline: core.getInput("inline") === "true",
    });
  } catch {
    core.setOutput("status", "unavailable");
    core.setOutput("conclusion", "inconclusive");
    core.setOutput("delivery", "unavailable");
    core.setFailed(
      "Breaklint unavailable: trusted provider context or credentials unavailable.",
    );
    try {
      await core.summary
        .addRaw(
          "Breaklint: **unavailable / inconclusive**. No clean result is claimed.",
        )
        .write();
    } catch {
      /* Output and step failure remain visible. */
    }
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
