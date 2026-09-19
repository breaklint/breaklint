import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { projectPolicy } from "@breaklint/public-config";
import {
  prepareAnalysis,
  createHostedClient,
  HostedClientError,
} from "@breaklint/hosted-client";
export interface CliInput {
  readonly argv: readonly string[];
  readonly version: string;
  readonly workingDirectory: string;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}
export async function runCli(input: CliInput): Promise<number> {
  let exit = 3;
  const controller = new AbortController();
  const command = new Command("breaklint").version(input.version).exitOverride();
  command.configureOutput({
    writeOut: (text) => {
      input.stdout.write(text);
    },
    writeErr: () => undefined,
  });
  command
    .description("Review committed source revisions with the hosted Breaklint service")
    .requiredOption("--base <revision>", "Exact baseline commit or trusted local ref")
    .option("--head <revision>", "Raw Head commit or local ref", "HEAD")
    .requiredOption("--repository <id>", "Service-registered repository ID")
    .requiredOption("--service <https-url>", "Authenticated Breaklint service endpoint")
    .option("--config <path>", "Explicit trusted declarative JSON policy file")
    .option("--request-id <id>", "Replay the same frozen request")
    .option("--json", "Print the public result as JSON")
    .action(
      async (options: {
        base: string;
        head: string;
        repository: string;
        service: string;
        config?: string;
        requestId?: string;
        json?: boolean;
      }) => {
        const token = process.env["BREAKLINT_TOKEN"];
        if (!token) throw new HostedClientError("UNAUTHENTICATED");
        const policy = projectPolicy(
          options.config
            ? await readFile(resolve(input.workingDirectory, options.config), "utf8")
            : {},
        );
        const prepared = await prepareAnalysis({
          repositoryRoot: input.workingDirectory,
          repository: { kind: "registered", repositoryId: options.repository },
          base: options.base,
          head: options.head,
          policy,
          ...(options.requestId ? { requestId: options.requestId } : {}),
        });
        const counts = prepared.sourcePackage.manifest.snapshots
          .map(
            (s) =>
              `${s.purpose}: ${s.accounting.includedFiles} included, ${s.accounting.excludedFiles} excluded`,
          )
          .join("; ");
        input.stderr.write(
          `Committed source only; uncommitted edits are outside this review. ${counts}.\n`,
        );
        input.stderr.write(
          `Request: ${prepared.request.requestId}\nBase: ${prepared.request.comparison.base.commit}\nHead: ${prepared.request.comparison.rawHead.commit}\n`,
        );
        const interrupt = () => {
          controller.abort();
        };
        process.once("SIGINT", interrupt);
        try {
          const result = await createHostedClient({
            endpoint: options.service,
            token,
          }).analyze(prepared, controller.signal);
          input.stdout.write(
            options.json
              ? JSON.stringify(result) + "\n"
              : result.state === "terminal"
                ? `${result.outcome.status}: ${result.outcome.conclusion} (${result.outcome.reason})\nRun: ${result.runId}\n`
                : `${result.state}\nRun: ${result.runId}\n`,
          );
          exit = controller.signal.aborted
            ? 130
            : result.state !== "terminal"
              ? 3
              : result.outcome.conclusion === "fail"
                ? 1
                : result.outcome.status === "complete"
                  ? 0
                  : result.outcome.status === "cancelled"
                    ? 130
                    : ["limited", "unsupported", "indeterminate"].includes(
                          result.outcome.status,
                        )
                      ? 2
                      : 3;
        } finally {
          process.removeListener("SIGINT", interrupt);
        }
      },
    );
  try {
    await command.parseAsync([...input.argv], { from: "user" });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "commander.helpDisplayed" || code === "commander.version") return 0;
    input.stderr.write(
      error instanceof HostedClientError
        ? `${error.code}${error.runId ? `; remote state unconfirmed; run ${error.runId}` : ""}\n`
        : "Input or protocol failure. Check revisions, trusted JSON config, and service options.\n",
    );
    return controller.signal.aborted ? 130 : 3;
  }
  return exit;
}
export async function runCliAndExit(argv: readonly string[]): Promise<void> {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  process.exitCode = await runCli({
    argv,
    version: manifest.version,
    workingDirectory: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
