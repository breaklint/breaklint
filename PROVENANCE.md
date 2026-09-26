# Source provenance

This repository contains Breaklint public client source with independent history.
Copyright © 2026 Breaklint. First-party code is licensed under Apache-2.0; see
LICENSE.md and NOTICE. Import history does not assert original authorship.

## Reproducible Unicode 13.0.0 data

The current table is regenerated from the official Unicode 13.0.0
[CaseFolding.txt](https://www.unicode.org/Public/13.0.0/ucd/CaseFolding.txt).
The vendored input is byte-identical to that file and to the copy distributed by
Unicode in [ICU 67.1](https://github.com/unicode-org/icu/tree/125e29d54990e74845e1546851b5afa3efab06ce),
released in 2020. The immutable ICU commit is
`125e29d54990e74845e1546851b5afa3efab06ce`.

- Input: `unicode/13.0.0/CaseFolding.txt`.
- SHA-256: `99d231d7c91688bbe8ca8ccebcc2f46b5b222f844babe4827295bae11e2abe5f`.
- License evidence: that same release's `icu4c/LICENSE`, preserved verbatim in
  `unicode/13.0.0/ICU-LICENSE.txt`; SHA-256
  `25e21013a7bc2fad735e28c5278a120e4c7f1c327c8c8b9b4df1751748cddbb2`.
- Applicable data notice: the initial Unicode copyright and permission section
  of that license, reproduced in `Unicode-License.txt`, retaining the input's
  2019 copyright and the release notice's 1991–2020 copyright.
- Exact input/license URLs and hashes: `unicode/13.0.0/provenance.json`.

The versioned Unicode distribution supplies the historical permission notice for
its own copy of the input. This chain does not assume the current Unicode V3
notice retroactively applied in 2020. Other ICU components are not incorporated;
the entire upstream license file is kept as provenance evidence.

Generate with `node scripts/generate-case-fold.mjs`; check with
`node scripts/generate-case-fold.mjs --check`. To review before replacement:
`node scripts/generate-case-fold.mjs .release/case-fold.generated.ts`.
The generator verifies both pinned hashes, reads C/F (full default) records,
omits S/T records, sorts by numeric code point, and emits escaped UTF-16 literals.
It also emits implicit identities for mapping target characters absent from the
C/F keys. This preserves uppercase Cherokee folding despite the lowercase fallback.
There are 1,490 C/F mappings and 2,857 total lookup entries.

The public contract retains per-code-point ECMAScript lowercase for characters
outside the table, followed by NFC normalization of the concatenation. It is not a
claim that all runtime Unicode behavior is frozen at version 13. No locale-specific
Turkic folding is added. Generation itself uses no host Unicode case tables.
The replacement was compared exhaustively against the previous implementation for
all 1,112,064 Unicode scalar values before and after normalization on Node 22.14.0
and 24.21.0; equal per-character strings plus unchanged concatenation/NFC establish
equivalence for arbitrary valid strings. Surrogate probes and path tests are retained.

The historical Python generator is still unknown. This is a newly reproducible,
semantically equivalent replacement, not a claim to recover that generator.
`Unicode-License.txt` accompanies every npm package and the Action distribution;
`THIRD_PARTY_NOTICES.md` also includes the applicable notice in full. This third-party
permission is separate from the first-party Apache-2.0 license.
