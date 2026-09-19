# GitHub Action

The local distribution is `action/action.yml` with the self-contained
`action/dist/index.js` bundle. It runs on the GitHub Node 24 runtime. The Action
handles `pull_request` events on github.com only; other events fail unavailable.
There is no browser installation, preview URL, or application build step.

The [workflow template](../examples/github-action.yml.example) uses deliberately
nonworking publication placeholders. Replace the checkout pin and public repository
coordinate plus full immutable Action commit only after verification. The `/action`
subdirectory is part of the future coordinate. No existing published Action is claimed.

| Input             | Purpose                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| service-url       | Trusted authorized HTTPS service, without query/credentials/fragment.              |
| service-token     | Dedicated scoped hosted-service credential; never a GitHub token.                  |
| github-token      | Separate GitHub context/publication token; defaults to github.token.               |
| working-directory | Git checkout containing exact Base and raw Head; defaults to `.`.                  |
| inline            | `true` enables service-approved raw-Head locations in current diff; default false. |

Outputs are `status`, `conclusion`, `delivery` and `run-id`. Source conclusion and
publication delivery remain separate. Missing credentials, unsupported events and
forks without an authorized route cannot produce a successful source check.
The shipped entry point denies all forks; passing a token does not enable forks.

Use one Action invocation per non-matrix job and serialize runs for a PR. Exact
Base and raw Head must exist locally. Shallow or missing objects fail closed;
there is no implicit network fetch. Policy comes from exact Base. The Action
rechecks revisions before publication and suppresses stale delivery. GitHub does
not offer an atomic compare-and-publish operation, so a residual race remains.
Replay uses a durable Check journal; ambiguous creation is not blindly repeated.

An operational provider-authorized service/authenticator is a launch prerequisite.
The registered CLI service alone is insufficient for Action authorization.
See [CI security](ci-security.md). The public distribution is not launch-ready
until this prerequisite and owner publication gates are satisfied.
