# Security

Report vulnerabilities using **GitHub Private Vulnerability Reporting** for
[breaklint/breaklint](https://github.com/breaklint/breaklint/security/advisories/new).
In the repository, open **Security → Advisories → Report a vulnerability**.
Include the affected version, reproduction steps, impact and a minimal synthetic
example. Avoid sending customer source, credentials or unnecessary personal data.
Do not report vulnerabilities or sensitive details in public issues or pull requests.

This channel is prepared for the initial release. Repository creation and enabling
private vulnerability reporting are publication prerequisites; this document does
not claim the feature is already enabled. If the private reporting control is
unavailable, keep the report private until it is enabled. Publication execution
must verify that reporting is enabled before declaring the release complete.
No security email, bug bounty or response-time commitment is offered here.

## Supported releases

The initial release is 0.1.0. Security fixes target the latest published release;
update to that release when a fix is available. There is no commitment to maintain
older versions or provide long-term support. Before the initial publication,
there is no published version covered by this policy.

## Safe use

The CLI uploads committed source and Git membership/provenance objects to an
authenticated HTTPS service. Configure the service URL from trusted settings and
use a dedicated repository-scoped service credential. Do not use a GitHub token as
the service token or pass credentials in URLs or config. Redirects are refused.
Invalid remote results fail closed instead of appearing as a successful review.

Only explicit declarative JSON configuration is loaded by the CLI. The Action uses
policy from exact Base and does not execute Head configuration, dependency scripts
or application code. Never combine untrusted PR execution with service secrets.
See [CI security](docs/ci-security.md) and [source processing](docs/source-processing.md).

Secret detection is bounded and cannot guarantee that authored source or Git commit
metadata is free of sensitive information. CLI JSON output includes validated
findings and source locations; handle results as repository-sensitive content.
