# CLI reference

`breaklint` reviews committed revisions in the current Git checkout. It requires
network access, authorization for source transfer, a service endpoint and a dedicated
credential supplied through `BREAKLINT_TOKEN`. No environment dump is sent.

| Option                  | Meaning                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `--base <revision>`     | Required exact baseline commit or trusted local ref; no automatic merge-base substitution. |
| `--head <revision>`     | Raw Head commit or trusted local ref; defaults to HEAD.                                    |
| `--repository <id>`     | Required service-registered repository identity.                                           |
| `--service <https-url>` | Required trusted HTTPS endpoint without credentials, query or fragment.                    |
| `--config <path>`       | Explicit trusted JSON policy; no automatic discovery or JS/TS execution.                   |
| `--request-id <id>`     | Replay the same frozen submission; cannot reuse an ID for different revisions/policy.      |
| `--json`                | Emit the validated public result, including findings and approved locations.               |
| `--help`, `--version`   | Print help or candidate version.                                                           |

The CLI resolves immutable commits and reads Git objects, not the working tree.
It prints source counts and frozen request/revision IDs before submission. This
summary is informational; there is no confirmation prompt or dry-run mode.
Default text output summarizes the outcome. Use `--json` for finding details.
The service determines or validates the effective Head; an unproven merge is
indeterminate, never a silently substituted raw-Head pass.

| Exit | Meaning                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| 0    | Complete analysis with a pass, or help/version.                                  |
| 1    | Proven gating failure, including limited coverage with a valid blocking finding. |
| 2    | Limited, unsupported, or indeterminate non-passing comparison.                   |
| 3    | Input, authentication, protocol, service, or other unavailable/failed operation. |
| 130  | Cancellation or SIGINT.                                                          |

Lost cancellation responses can leave remote state unconfirmed. Do not treat empty
findings, an unavailable service, or a cancelled run as a clean comparison.

Local package invocation after `pnpm build`:

```sh
pnpm --filter @breaklint/cli pack --out ../../.release/breaklint-cli.tgz
npx --offline --no-install breaklint --help
```

The npx command is verified inside the empty consumer created by
`pnpm test:consumer`, where the actual local tarballs have been installed. That test
also runs `npx --offline --no-install breaklint --base BASE_COMMIT --repository
REGISTERED_REPOSITORY_ID --service https://SERVICE_NOT_PROVISIONED.invalid --json`
with synthetic commits, a mock transport and substituted fixture values. The
temporary consumer is removed after the test. For your own local consumer, install
all four client tarballs and override the three `@breaklint/*` dependencies to those
same files, as shown in `scripts/verify-consumer.mjs`; they are not in a registry.
The package is `@breaklint/cli` and the executable is `breaklint`. Do not install
the unrelated unscoped npm package. Registry installation instructions remain
pending publication; use the locally installed executable.
Use the repository-local Node command in README for authenticated analysis.
