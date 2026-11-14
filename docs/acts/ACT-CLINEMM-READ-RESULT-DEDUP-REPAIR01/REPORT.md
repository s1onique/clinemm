# ACT-CLINEMM-READ-RESULT-DEDUP-REPAIR01

**Verdict:** `PASS_STRUCTURAL_ONLY`
**Repository:** `s1onique/clinemm`, branch `main`
**Entry HEAD:** `bf486a47c11a1a80782d5d96df89c149fdcb2a50`
**Protected stash:** `stash@{0}` preserved unchanged.

## Production change

`MessageBuilder.buildForApi` now applies an ephemeral, first-anchor projection of byte-identical
successful text read results before provider projection. Later identical `read`/`read_files`
results retain their own `tool_use_id` and ordering but carry a compact equality reference to the
first full-content anchor. Hashing indexes candidates; exact string equality confirms each pair.
Ambiguous locators, failed reads, mixed batches, images/non-text, stale/truncated payloads, and
changed content are not projected.

The anchor is protected from the existing 64 KiB stale-read rewrite while it is referenced. After
aggregate budget processing, references are revalidated against the final projection; a missing or
rewritten anchor causes a safe unavailable-content notice instead of a dangling reference.

No tool execution, authorization, filesystem, schema, persistence, provider branch, or public API
changed.

## RED to GREEN

RED on unmodified production: RED-1 passed and RED-2 failed, exit 1. The baseline rewrote exactly
two historical results and broke the provider prefix at message index 5.

GREEN: 59/59 MessageBuilder + focused dedup tests and 34/34 adjacent cache/recovery/file-read
tests pass. The focused dedup suite now proves stable first-anchor references, canonical
immutability, exact tool identity, conservative X->Y->X behavior, nonduplicate controls, and final
reference lifetime.

## Historical comparison

The verified predecessor's full-transcript capture measured 5 preserved prefix messages / 26,440
bytes for production versus 20 / 181,354 for the candidate. Prepared bytes were 182,140 versus
182,422 and estimated tokens 60,759 versus 60,853; neither crossed the nominal 86,400-token 96K
trigger. The local synthetic production-seam replay independently confirms one full copy, two
compact references, zero stale markers, and a byte-stable prior prefix.

## Gates

Executed: focused Vitest suites (93/93 combined), compaction suites (115/115), Biome check,
`git diff --check`, and focused TypeScript diagnostics. The core package typecheck remains exit 2
because the verified entry already has 67 unrelated diagnostics; the entry and current diagnostic
sets are identical and contain no ACT-owned error.

## Packaging and live qualification

No VSIX was packaged: the installed-extension qualification environment was unavailable, so no
artifact identity is claimed. Live Flint/Kapitsa qualification is `NOT_EXECUTED`. No cache-hit,
wall-clock, or model-comprehension improvement is claimed.

Remaining limitation: model comprehension and actual Kapitsa reuse require a live installed-profile
run. One bounded successor action is to execute that qualification against the committed source.
