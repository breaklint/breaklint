# CI and fork security

Keep the workflow and Base policy trusted. Do not run PR install scripts, application
builds, hooks, JS/TS config, or any source-controlled executable while credentials
are present. Pin Actions by reviewed immutable commit. Acquire exact Git objects
with persistence of checkout credentials disabled. The template is a baseline;
review any additional steps against the same trust boundary.

Use `pull_request`, not a privileged event that executes fork code. The public
entry point refuses fork credentials and reports unavailable/inconclusive. The
[fork-safe example](../examples/github-action.yml.example) fails an explicit fork
job before checkout or secret-bearing analysis; it does not label a skipped scan
as successful. Required-check configuration must require a meaningful completed
analysis and account for the two job paths. Decide the repository's policy for
external contributions before enabling this as a required check.

Trusted same-repository review needs `id-token: write`, `contents: read`,
`actions: read`, `pull-requests: read` and `checks: write`. Keep inline disabled;
public v1 requires no pull-request write permission.
GitHub publication credentials and OIDC identity stay separate. Limit service scope to the approved
repository, policy and execution context, and provide rotation/revocation.

Fork analysis requires a separately reviewed provider credential broker and
service-side binding to repository IDs, exact revisions, event association and
protected policy. No such route is shipped by this entry point. Do not work around
that absence using a broad long-lived token or copying secrets to fork workflows.

The launch profile requires an operator-registered reusable workflow pinned to an
immutable commit. It fixes the service origin/audience and requests OIDC only for
same-repository PRs. Head can neither replace the registered trusted workflow nor
weaken the service policy. No long-lived Breaklint token is used. The service
independently checks repository IDs, current PR revisions and workflow run attempt.
