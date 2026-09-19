# Security

Public security reporting and the supported-release policy are not yet provisioned.
Before launch, the owner must replace this statement with a monitored private
reporting channel and response policy. No public release is currently claimed.
Do not put secrets, source payloads, or private repository details in public issues.

The CLI uploads committed source and Git membership/provenance objects to a trusted
HTTPS service. Configure the service URL from trusted settings and use a dedicated
repository-scoped service credential. Do not use a GitHub token as the service token.
Do not pass credentials in URLs or config. Redirects are refused. Invalid remote
results fail closed instead of being rendered as a successful review.

Only explicit declarative JSON configuration is loaded by the CLI. The Action uses
policy from exact Base and does not execute Head configuration, dependency scripts,
or application code. Never combine untrusted PR execution with service secrets.
See [CI security](docs/ci-security.md) and [privacy](docs/known-limitations.md).

Secret detection is bounded and cannot guarantee that authored source or Git commit
metadata is free of sensitive information. Review the transfer scope and provider's
retention/data-use terms before using the service. CLI `--json` includes validated
findings and source locations; handle results as repository-sensitive content.
