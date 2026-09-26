# Breaklint

Breaklint is a source-native responsive regression reviewer for pull requests.
Its public CLI and GitHub Action send a bounded immutable source/revision package
over authenticated HTTPS to the private hosted Breaklint service. The analyzer
engine is proprietary and is not included in this repository. Results include
explicit coverage and uncertainty.

Source is the primary truth. No browser, preview URL, application deployment,
application login, or customer runtime environment is needed. Public v1 does not include runtime verification,
AI explanations, repairs, or an offline analysis engine.

## Public v1 support

| Area                                                                    | Scope                                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| React / Next.js                                                         | Bounded source review; framework recognition does not establish complete coverage |
| Authored CSS, CSS Modules, literal inline styles                        | Supported within modeled Width, Flex and Grid semantics                           |
| Unresolved conditions, source/style influence, component/prop semantics | Abstains where evidence cannot establish behavior                                 |
| Dynamic content and intrinsic dimensions                                | Abstains where dimensions cannot be proven                                        |
| Tailwind / framework themes                                             | Limited; complete theme semantics are unsupported                                 |
| Typography and arbitrary runtime styles                                 | Intrinsic text measurement and browser-equivalent behavior are unsupported        |
| GitHub delivery                                                         | Check and job summary; public inline review comments are outside v1               |

Empty findings do not mean clean unless analysis is complete. Unsupported or
indeterminate input remains inconclusive; proven blocking findings may still fail
a limited review. Runtime visual testing, AI review and automatic repair are
outside public v1.

## Use the CLI

The CLI package is `@breaklint/cli`; the executable is `breaklint`. After publication
of 0.1.0, use:

```sh
npm install --global @breaklint/cli@0.1.0
breaklint --help
npx --package=@breaklint/cli@0.1.0 breaklint --version
```

These registry examples describe post-publication usage, not current availability.
The intended npm family is `@breaklint/public-protocol`, `@breaklint/public-config`,
`@breaklint/hosted-client` and `@breaklint/cli`. The Action workspace package remains
private and is distributed from `breaklint/breaklint/action`, pinned to a verified
full commit SHA. See the [Action guide](docs/github-action.md).

Use Git and Node 22.14.0 or 24.21.0 (the exact tested versions). With a
provider-approved service endpoint and a dedicated credential in `BREAKLINT_TOKEN`:

```sh
breaklint --base BASE_COMMIT --head HEAD_COMMIT \
  --repository REGISTERED_REPOSITORY_ID \
  --service https://SERVICE_NOT_PROVISIONED.invalid --config examples/breaklint.policy.json
```

Uppercase values and the `.invalid` host are deliberate nonworking placeholders.
Service enrollment and authorization for the repository and policy are required;
installing a package does not grant access. The command transfers source and is not
a dry run. Uncommitted files are outside the comparison.

The public flow is:

```text
Public CLI / GitHub Action
  → bounded immutable source/revision package
  → authenticated hosted Breaklint service
  → sanitized result / GitHub Check
```

Source content is processed for analysis and service operation and is not used for
model training, advertising or data sale. Read [source processing](docs/source-processing.md)
for transient storage, metadata/results retention and GitHub output handling.

Read the [CLI reference](docs/cli.md), [config reference](docs/config.md),
[CI and fork security](docs/ci-security.md) and [known limits](docs/known-limitations.md).

## Develop

For a local checkout, use pnpm 11.9.0, run `pnpm install --frozen-lockfile` and
`pnpm build`, then `node packages/cli/bin/breaklint.js --help`.

`pnpm verify` builds, typechecks, lints, checks formatting, tests synthetic
public flows, installs packed artifacts in an empty consumer, and inspects the
Action bundle, dependencies and generated content. No hosted service credentials
are needed for these local tests. See [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md), and [license](LICENSE.md).

## License and project

Copyright © 2026 Breaklint. First-party public code is licensed under
[Apache-2.0](LICENSE.md); see [NOTICE](NOTICE). Third-party dependencies and Unicode
data retain their own [notices](THIRD_PARTY_NOTICES.md) and [provenance](PROVENANCE.md).
This license covers the public clients and Action, not the hosted private engine.

The approved repository is [breaklint/breaklint](https://github.com/breaklint/breaklint).
Use [issues](https://github.com/breaklint/breaklint/issues) for ordinary bugs and
[private vulnerability reporting](SECURITY.md) for security concerns.
