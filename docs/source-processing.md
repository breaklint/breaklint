# Source processing

This document describes the Breaklint public v1 source-review service. Source
content is processed only for Breaklint analysis and service operation. Submitted
source is not used for AI or model training. User data and source are not sold or
used for advertising. The public v1 source-review path does not call an AI/model
service and does not require executing the customer's application.

## What is submitted

The public CLI and GitHub Action prepare a bounded package of committed source at
exact revisions. It includes selected source files, relative paths, content digests,
revision identifiers, a source manifest and bounded Git objects used to establish
revision relationships and file membership. A request also carries repository and
request identities and the analysis policy. Uncommitted working-tree edits are not
part of the comparison. See [selection and limits](known-limitations.md).

Git tree and commit metadata can reveal file names (including excluded-file names),
authors and commit messages even when a file's source body is excluded. Selection
and secret screening are bounded safeguards, not a guarantee that submitted
content or metadata contains no sensitive information. Transfer only repositories
and data you are authorized to submit.

## Authentication and purpose

Clients use authenticated HTTPS to the configured hosted Breaklint service. The
CLI requires a dedicated service credential. The GitHub Action uses short-lived
GitHub OIDC identity through an operator-registered trusted workflow; the separate
GitHub token permits provider context checks and result publication. Service
access must be provisioned and authorized for the repository and policy.
Installation of the clients does not itself grant service access.

Source is analyzed by the hosted private engine. Normal source review requires no
Chromium/browser installation, preview URL, customer application deployment,
application login or customer runtime environment. Source review does not establish
complete browser or CSS equivalence.

## Source content

Raw source bodies are processed transiently in memory and temporary analysis
storage. Normal run completion clears the upload-body collection and removes the
temporary analysis storage through the existing cleanup path. Source content is
therefore temporarily stored during processing; this is not a claim that code is
never stored or that every copy is immediately and irreversibly erased.

## Provenance and request metadata

Run records may retain repository/request identities, revision identifiers,
policy, source manifests, digests and Git provenance objects for bounded replay,
idempotency and operational reliability. These records are distinct from raw
source bodies, but may still contain sensitive repository paths and commit metadata.

The current implementation has a **24-hour durable replay window**. Replay expiry
limits reuse of a run; it is not a guarantee of deletion at precisely 24 hours.
Expired durable records are removed during service startup or subsequent admission,
so physical removal can occur later than expiry.

## Results

Validated results may be retained with the run for replay and reliable delivery.
They include outcomes, coverage, findings and source locations and may reveal
repository-sensitive information. Results must be handled according to the
repository's access needs even though they are sanitized to the public result
contract.

## GitHub-published output

The Action publishes a GitHub Check and job summary. Public v1 does not publish
inline PR review comments. Findings and source locations in these outputs become
accessible according to the destination repository's GitHub settings. GitHub's
own retention and access behavior applies to published Checks and summaries;
expiry of a Breaklint replay record does not delete GitHub output.

## Retention limits and policy changes

Normal cleanup is not a promise of immediate universal deletion, crash-proof
cleanup or irreversible erasure at a fixed instant. This document does not
establish a general user-facing deletion workflow, backup deletion schedule,
storage region, encryption-at-rest assurance or universal logging-retention
policy. Do not infer these properties from the replay window or HTTPS transport.

Future changes to processing purposes, data handling or these documented limits
will be recorded in this document and the repository's release notes. This is
product documentation, not a data processing agreement or privacy certification,
and it does not assert a legal-controller identity or corporate status.
