# Configuration

The CLI accepts explicit JSON via `--config`. The Action reads only
`breaklint.policy.json` at the exact trusted Base commit, or uses defaults when
absent. Neither entry point imports executable JS/TS configuration. There is no
Head-policy fallback. The hosted service independently enforces authorized policy.

```json
{
  "scope": { "kind": "repository", "selectionProfile": "authored-source-1" },
  "transferExclusions": [],
  "rules": [],
  "gate": { "changes": "introduced-or-worsened", "minimumSeverity": "warning" }
}
```

`transferExclusions` contains literal `{ "kind": "file" | "directory", "path":
"repository-relative-path" }` entries, not glob patterns. Entries must be sorted
by kind then path, with no duplicates, aliases or unsafe components. Excluding
required source makes coverage incomplete; exclusion never means deletion.
At most 128 exclusions and eight rule overrides are accepted.

Rule overrides contain `ruleId`, `enabled`, and `severity` (`default`, `info`,
`warning`, or `error`), sorted by ruleId. Gate minimumSeverity is info/warning/error;
gate changes is always introduced-or-worsened. Unknown keys, executable values,
credentials, duplicate JSON keys and invalid paths are rejected without echoing input.

| Rule ID                                           | Public meaning                                        |
| ------------------------------------------------- | ----------------------------------------------------- |
| responsive.automatic-minimum-content-pressure     | Automatic minimum sizing can constrain layout.        |
| responsive.clipped-layout-pressure                | Authored layout pressure can clip content.            |
| responsive.dynamic-nowrap-control                 | Dynamic no-wrap content needs bounded evaluation.     |
| responsive.media-width-resilience                 | Media sizing can constrain available width.           |
| responsive.scroll-contained-structural-pressure   | Structural pressure occurs inside a scroll container. |
| responsive.uncontained-layout-pressure            | Authored content pressure is not contained.           |
| responsive.unresolved-layout-pressure-consequence | A pressure consequence could not be established.      |
| responsive.unsatisfiable-sizing                   | Authored size constraints cannot all be satisfied.    |

The helpers `defineConfig`, `validateConfig`, `projectPolicy` and type `UserConfig`
are supported from `@breaklint/public-config`. CLI root `breaklint` re-exports
`defineConfig`, `projectPolicy`, UserConfig, and the four public protocol types.
`defineConfig` validates programmatic values; it does not make executable config
files loadable by the CLI. [The JS example](../examples/define-config.mjs) explicitly
writes declarative JSON for subsequent use.

`@breaklint/public-protocol` exports only types `AnalysisRequest`, `AnalysisResult`,
`PublicAnalysisPolicy`, and `PublicFinding`. Its `/internal` subpath is reserved for
lockstep implementation consumers. No other deep import is supported.
