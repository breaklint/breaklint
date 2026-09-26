# Breaklint

Breaklint is a source-native responsive regression reviewer for pull requests.
Its public CLI and GitHub Action send a bounded immutable source/revision package
over authenticated HTTPS to the private hosted Breaklint service. The analyzer
engine is proprietary and is not included in this repository. Results include
explicit coverage and uncertainty.

Source is the primary truth. No browser, preview URL, application deployment,
or application login is needed. Public v1 does not include runtime verification,
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

The CLI package coordinate is `@breaklint/cli`; its executable remains `breaklint`.
The intended npm family is `@breaklint/public-protocol`, `@breaklint/public-config`,
`@breaklint/hosted-client`, and `@breaklint/cli`. These are unpublished local
candidates; npm scope control is verified, while publication requires owner approval. The Action
workspace package stays private and is distributed through `action/` only.
