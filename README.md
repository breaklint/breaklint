# Breaklint

Review committed source changes for responsive layout problems. Breaklint's CLI
and GitHub Action send bounded source revisions to an authenticated hosted analysis
service and show versioned findings with explicit coverage and uncertainty.

Source is the primary truth. No browser, preview URL, application deployment,
or application login is needed. Public v1 does not include runtime verification,
AI explanations, repairs, or an offline analysis engine.

**Local prerelease candidate. Nothing here asserts npm or GitHub availability.**
Public launch is blocked on owner licensing, release coordinates, service access,
and published privacy terms. Package publication is disabled.

## Try the local CLI

Use Git, Node 22.14.0 or 24.21.0 (the exact tested versions in package.json),
and pnpm 11.9.0:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/bin/breaklint.js --help
```

With a provider-approved service endpoint and a dedicated credential in
`BREAKLINT_TOKEN`, review exact committed revisions:

```sh
node packages/cli/bin/breaklint.js --base BASE_COMMIT --head HEAD_COMMIT \
  --repository REGISTERED_REPOSITORY_ID \
  --service https://SERVICE_NOT_PROVISIONED.invalid --config examples/breaklint.policy.json
```

Uppercase values and the `.invalid` host are deliberate nonworking placeholders.
The service must authorize the repository and policy. The command transfers source;
it is not a dry run. Uncommitted files are outside the comparison.

Read the [CLI reference](docs/cli.md), [config reference](docs/config.md),
[Action guide](docs/github-action.md), [CI and fork security](docs/ci-security.md),
and [known limits and privacy](docs/known-limitations.md).

## Develop

`pnpm verify` builds, typechecks, lints, checks formatting, tests synthetic
public flows, installs packed artifacts in an empty consumer, and inspects the
Action bundle, dependencies and generated content. No hosted service credentials
are needed for these local tests. See [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md), and [license status](LICENSE.md).
