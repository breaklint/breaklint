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
| oidc-audience     | Exact audience registered by the service operator; requires `id-token: write`.     |
| github-token      | Separate GitHub context/publication token; defaults to github.token.               |
| working-directory | Git checkout containing exact Base and raw Head; defaults to `.`.                  |
| inline            | Reserved compatibility input; keep `false`. Public v1 supports Check/summary only. |

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

Same-repository launch authentication uses a short-lived GitHub OIDC token. There
is no static Breaklint token fallback. The service must register the repository
and owner IDs, caller workflow path, Base branch, approved policy and immutable
reusable workflow SHA. The workflow must use that pinned reusable workflow;
direct unregistered workflow jobs cannot authenticate. See the two example files.
Token expiry or unavailable provider metadata fails closed. The public service
origin and expected audience require operator configuration; this candidate supplies neither a public endpoint nor service enrollment.
