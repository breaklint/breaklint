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
| `--help`, `--version`   | Print help or package version.                                                             |

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

## Package and executable

After publication of 0.1.0:

```sh
npm install --global @breaklint/cli@0.1.0
breaklint --help
npx --package=@breaklint/cli@0.1.0 breaklint --version
```

These registry examples describe post-publication usage and do not assert current
availability. The package is `@breaklint/cli`; its executable is `breaklint`.
Service enrollment and authorization are required for analysis; installation alone
does not grant service access. See [source processing](source-processing.md).

For local development, run `pnpm build` then
`node packages/cli/bin/breaklint.js --help` from the repository root.
`pnpm test:consumer` packs all four intended npm packages, installs them in an empty
consumer with local dependency overrides, and exercises imports, declarations and
`npx --offline --no-install --package=@breaklint/cli breaklint` using synthetic
revisions and transport. It does not contact the hosted analysis service.
