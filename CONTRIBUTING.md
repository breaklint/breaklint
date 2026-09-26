# Contributing

This workspace contains the public CLI, protocol, declarative config,
hosted transport, and GitHub Action. Changes should keep these clients independent
of the hosted analysis implementation.

Use the supported Node range from package.json and pnpm 11.9.0. Run
`pnpm install --frozen-lockfile`, then `pnpm verify`. Tests use small synthetic Git
objects and mocked service/provider responses. No browser or service is required.
Run `pnpm format` after edits. Generated Action files under `action/` and notices
must be regenerated with `pnpm build && pnpm inventory` and reviewed together.

Keep the four protocol root types stable. `@breaklint/public-protocol/internal`
is a version-coupled implementation channel for the matching clients and service;
it is not a supported user API. Other deep imports are blocked by exports.
Do not add test fakes or harnesses to production exports.

Use synthetic fixtures without customer source, credentials, or actual repository
identities. Preserve license comments and third-party notices. Submit public changes through [pull requests](https://github.com/breaklint/breaklint/pulls).
First-party contributions are under the repository Apache-2.0 license.
Use [private vulnerability reporting](SECURITY.md) for security reports.
Do not upload sensitive reports to public issues.
