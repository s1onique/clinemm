# ACT-CLINEMM-READ-RESULT-DEDUP-REPAIR01-CORRECTION01

**Verdict:** `PASS_STRUCTURAL_ONLY`
**Repository:** `s1onique/clinemm`, branch `main`
**Entry HEAD:** `f761fa68210e6d1ea195e130f5bc9503a6278eeb` ("fix(core): deduplicate identical read results")
**Protected stash:** `stash@{0}` preserved unchanged.
**Scope:** one bounded correction. No push, no PR, no unrelated changes, no Elm work.

## Verdict on the reviewed commit

The reviewer's `HALT_FRESHNESS_CONSERVATION` verdict was correct. The P0 was reproduced
through the real production seam and is now fixed; the two P1 test defects are also
corrected.

## The P0: stale-content conservation

`MessageBuilder.projectDuplicateReadResults` grouped every read observation that had ever
shared a content hash at a locator, then shielded that whole group from the 64 KiB
stale-read rewrite policy. A later, different observation at the same locator therefore
did not invalidate the protection, and the obsolete bytes stayed fully visible:

```
read A -> X     (anchor)
read B -> X     (duplicate, becomes a compact reference to A)
read C -> Y     (the file changed)
```

With payloads crossing the 64 KiB threshold, `buildForApi` deleted the committed
stale-rewrite decisions of both A and B, so the obsolete X remained visible even though C
established that Y is the latest content. The pre-repair baseline (`bf486a47c`) rewrote
both obsolete observations to the stale marker and kept the newest Y fully visible; the
reviewed commit regressed that behaviour.

### Fix

The projection now splits each locator's observations into **contiguous runs** of
byte-identical content. Only the **last** run of a locator is current. Every earlier run
holds superseded content and is neither projected into a compact reference nor shielded
from the stale-read rewrite policy. `buildForApi` additionally skips the anchor/reference
shielding explicitly for obsolete result ids, so the protection cannot be re-granted.

Freshness takes precedence over prefix-cache preservation. The first-anchor trade-off
accepted for **identical** observations is untouched: an unchanged X -> X -> X sequence
still keeps the anchor stable and still projects the later duplicates to references.

Contiguous runs, not "all observations that ever matched", are the right unit: an
intervening different observation breaks the run, so a later X after a Y is never aliased
to the earlier X (conservative X -> Y -> X behaviour preserved).

The obsolete computation is linear in the number of runs (`runIndicesByLocator`), not
quadratic in locators x runs.

## RED -> GREEN

RED on the unmodified reviewed commit `f761fa682`, through real
`MessageBuilder.buildForApi` with 40,000-character payloads:

```
Tests  3 failed | 29 passed (32)
  x rewrites obsolete duplicate groups when a later read changed the content
  x rewrites obsolete duplicate groups across a sticky multi-build sequence
  x case 10b: superseded content is reclaimed once the stale-read threshold is crossed
```

GREEN after the correction: 100/100 MessageBuilder, dedup, recovery, and cache tests pass;
165/165 compaction tests pass (1 skipped). The full core unit suite shows the identical
113 pre-existing environment failures as the entry commit and 26 additional passing tests.

## Permanent regression coverage

`message-builder-read-dedup.test.ts` now carries 32 tests (was 6):

- **Freshness conservation (new, 7 tests):** X -> X -> Y; X -> X -> Y across a sticky
  multi-build sequence; X -> X -> X stable anchor; X -> Y -> X conservative; same path at
  different ranges (no cross-range alias); rollback/restoration; final-projection anchor
  lifetime.
- **Predecessor adversarial matrix (new, 18 tests):** the full 17-case matrix from
  `ACT-CLINEMM-READ-RESULT-DEDUP-RECON-01` plus case 10b, executed against the permanent
  production implementation instead of a throwaway probe.
- **Original suite retained (6 tests)** plus a fixture-size assertion (7th).

## P1 corrections

- **Different-range case:** the permanent suite now has an explicit same-path /
  different-range test (`does not alias reads of the same path at different ranges`) and
  matrix case 5.
- **Fixture size:** the synthetic historical fixture is
  `"  1 | fixture line\n" x 3,397 + "tail"` = **64,547 characters / 64,547 UTF-8 bytes**.
  The source comment claiming 47,253 characters is corrected, and a new assertion
  (`DOCUMENTED_HISTORICAL_CONTENT_CHARS`) fails if the generated payload and the
  documented size ever diverge again. The predecessor `REPORT.md` and
  `evidence/conservation.txt` still carry the wrong 47,253 label; this correction does
  not rewrite predecessor evidence, and the discrepancy is disclosed here.

## Gates

| Gate | Result |
|---|---|
| Focused RED -> GREEN | 3 RED failures on `f761fa682` -> 32/32 GREEN |
| MessageBuilder + dedup + recovery + cache | 100/100 PASS |
| Compaction suites | 165/165 PASS, 1 skipped |
| Full core unit suite | 113 pre-existing environment failures, identical to the entry; +26 passing tests, 0 regressions |
| Typecheck baseline comparison | Entry and current diagnostic sets byte-identical (40 pre-existing diagnostics); `message-builder` diagnostics 0; ACT-owned diagnostics 0 |
| Biome check | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |

## Scope confirmation

No tool execution, authorization, filesystem, schema, persistence, provider branch, or
public API changed. No persistent reference store was introduced. No Elm work. The only
production file touched is `sdk/packages/core/src/session/services/message-builder.ts`;
the only test file touched is
`sdk/packages/core/src/session/services/message-builder-read-dedup.test.ts`.

## Packaging and live qualification

Not performed by this correction. The reviewer authorized packaging and live Flint
qualification once the freshness-conservation case is green; that is the next step. No
VSIX artifact identity, cache-hit, wall-clock, or model-comprehension improvement is
claimed. Live Flint/Kapitsa qualification is `NOT_EXECUTED`.
