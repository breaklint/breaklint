# Known limitations and privacy

Source is primary. This client transfers committed repository source and bounded
Git proof objects over authenticated HTTPS to a private hosted analysis service.
It is not an offline engine. Git trees and commit objects may reveal paths, authors,
commit messages and excluded-file names even when file contents are excluded.
Source locations and excerpts in results must be treated as repository-sensitive.

The owner must publish raw-source retention/deletion and backup timelines, regions,
data use, subprocessors and enrollment terms before launch. This candidate makes
no promises about those unresolved policies. Protocol retry/result binding lasts
24 hours; that is not a raw-source retention commitment. Do not transfer confidential
source until authorized under the actual service's terms.

The current selection profile considers committed TS/TSX, JS/JSX/MJS/CJS,
CSS/SCSS/Sass, JSON and YAML files. Selection is not a claim that every framework,
syntax or dependency is analyzable. Only the service can establish coverage.
Generated/dependency directories, sensitive file names/content, non-text data,
symlinks, submodules, LFS pointers and unsupported formats are not silently analyzed.
Required omissions produce unsupported/limited outcomes; they cannot become deletion.
Path aliases, unsafe paths and unbounded histories fail closed. Secret screening
is heuristic, not a guarantee; commit metadata can force local rejection.

| Ceiling                                        | v1 bound                             |
| ---------------------------------------------- | ------------------------------------ |
| Tree leaves per snapshot                       | 10,000                               |
| Included source per snapshot / total           | 64 MiB / 256 MiB                     |
| Individual source blob                         | 1 MiB                                |
| Snapshots                                      | 4                                    |
| Manifest / proof                               | 8 MiB / 8 MiB                        |
| Proof objects / commits / ancestry edges       | 8,192 / 512 / 256                    |
| Aggregate package                              | 273 MiB                              |
| Policy / request / result                      | 32 KiB / 64 KiB / 4 MiB              |
| Findings / limitations / locations per finding | 1,000 / 100 / 8                      |
| Operation / upload / lifecycle                 | 60 seconds / 10 minutes / 30 minutes |

A complete result has established coverage; a pass has no gating findings.
Limited means incomplete coverage or output; unsupported means the input/scope
cannot be analyzed; indeterminate means a trustworthy comparison could not be
established. Empty findings in those states are inconclusive. Proven blocking
findings can still fail a limited comparison. Unknown protocol values are refused.
Results are immutable and tied to the exact request and revisions.

Git SHA-1 object repositories are the supported input format. Uncommitted edits,
non-Git projects, GitHub Enterprise, general push events, fork credentials, runtime
verification, AI and repair are outside this public v1 entry point. Node versions
outside package.json's tested versions are not supported. Linux GitHub-hosted
runner end-to-end deployment acceptance remains an external launch gate.
