# ACT-CLINEMM-READ-RESULT-DEDUP-REPAIR01-CORRECTION02

**Verdict:** `PASS_STRUCTURAL_ONLY`
**Repository:** `s1onique/clinemm`, branch `main`
**Entry HEAD:** `6cd7374e1c7bbafae3839e07e7d2d8eee6ecca89` ("fix(core): conserve stale-read freshness when duplicate reads diverge")
**Protected stash:** `stash@{0}` preserved unchanged (`d46223b51` WIP).
**Scope:** one bounded correction. No push, no PR, no unrelated changes.

## Verdict

The newly identified cross-locator freshness defect **reproduced** on the entry
HEAD, was repaired by extending the existing projection's obsolete
classification, and all gates pass. No independently demonstrated P0 remains,
so the authorized next step is exact-head VSIX packaging and operator live
qualification.

## RED

The defect was exercised through the real `MessageBuilder.buildForApi()` with
the exact payload shape named by the task:

```
read A -> X   successful ranged read    file.ts:1-100   (40000 chars)
read B -> X   identical ranged read     file.ts:1-100   (40000 chars)
read C -> Y   later full-file read      file.ts         (40000 chars)
```

The aggregate obsolete payload (2 x 40000 bytes) exceeds the existing 64 KiB
stale-rewrite threshold, so the batched stale-read policy is in play.

On the entry HEAD `6cd7374e1`:

```
   x rewrites obsolete ranged duplicates when a later full-file read owns the path 4ms
 Test Files  1 failed (1)
      Tests  1 failed | 32 passed (33)
```

The assertion failed because result `a` still carried the full 40000-character
X payload instead of the stale marker. All 32 pre-existing assertions in the
same file passed, isolating the defect to the cross-locator case.

### Comparison against the pre-dedup baseline

The pre-dedup baseline `bf486a47c` has no duplicate-read projection at all. The
same cross-locator assertion **PASSES** on it:

```
   v rewrites obsolete ranged duplicates when a later full-file read owns the path 0ms
 Test Files  1 failed (1)
      Tests  8 failed | 25 passed (33)
```

The 8 baseline failures are the dedup-specific assertions (the baseline cannot
emit compact references). The cross-locator freshness assertion passing on the
baseline proves that the duplicate-read projection introduced in `f761fa682`
**regressed** this behaviour, and that the pre-dedup baseline is the correct
reference for the defect.

## Root cause

`MessageBuilder` has two independent mechanisms that can disagree:

1. **The stale-read rewrite policy** (`commitOutdatedRewrites` ->
   `isOutdatedReadLocator`) already treats a read observation as outdated when
   the path's full-content owner is a different `tool_use_id`. The owner map is
   `latestFullContentOwnerByPathCache`, populated by `reindex` from the latest
   full-file read of each path.

2. **The duplicate-read projection** (`projectDuplicateReadResults`) computed
   its `obsoleteResultIds` set from **contiguous runs keyed by the exact
   locator key**. A ranged read at `file.ts:1-100` and a full-file read at
   `file.ts` have different locator keys, so the ranged run was never
   classified as obsolete.

`buildForApi` then shields anchors and references from the stale-read rewrite
policy (`this.committedOutdatedRewrites.delete(...)`). Because the ranged run
was not in `obsoleteResultIds`, its anchor `a` was shielded and its reference
`b` was shielded, so the obsolete X survived in full even though mechanism 1
had already classified it as outdated.

The two mechanisms disagreed because the projection only knew about
same-locator supersession while the policy also knows about the
full-content-owner rule.

## Repair

The correction extends the **existing projection's** obsolete classification to
conserve cross-locator supersession. It reuses the existing
full-content-owner semantics; it does not introduce a second freshness model.

```ts
for (const run of runs) {
    const owner = this.latestFullContentOwnerByPathCache.get(run.locator.path);
    if (!owner) continue;
    for (const resultId of run.resultIds) {
        if (resultId === owner) continue;
        // The owner is a full-file read, so its locator key is the path.
        // An observation at that same locator is already covered by the
        // run logic; only a DIFFERENT locator (a ranged window) is new.
        if (run.locatorKey === run.locator.path) continue;
        obsoleteResultIds.add(resultId);
    }
}
```

The `DuplicateReadRun` interface gained one internal field (`locator`) so the
pass can compare a run's locator key against its path.

The `run.locatorKey === run.locator.path` guard is what preserves the unchanged
X -> X -> X first-anchor behaviour. For a full-file observation the locator key
*is* the path, so the owner shares the same locator and the existing run logic
remains the sole authority over it. Only ranged windows -- a different locator
key -- are newly classified as obsolete.

An observation is newly obsolete only when all of these hold:

1. It is a successful, parseable read result (the existing candidate filter).
2. Its path has a full-content owner (a full-file read of that path exists).
3. The owner is a different `tool_use_id`.
4. It sits at a different locator than the owner (a ranged window).

## Permanent regression coverage

`message-builder-read-dedup.test.ts` grew from 32 to 35 tests:

- **New cross-locator RED -> GREEN (1 test):** the exact A/B/C shape above;
  asserts A and B become the stale marker, C stays authoritative, and no
  compact reference survives that points at the obsolete anchor.
- **No cross-locator over-reach (1 test):** two ranged reads of the same path
  at different ranges with no full-file read anywhere stay current and are
  never aliased.
- **Full-content owner stays authoritative (1 test):** a full-file owner
  followed by two ranged observations of the same path keeps the owner visible
  and reclaims the ranged observations once the 64 KiB threshold is crossed.

Both guard tests also pass on the pre-dedup baseline, which confirms the
repair restores baseline semantics rather than inventing new behaviour.

## Gates

| Gate | Result |
|---|---|
| New cross-locator RED -> GREEN | 1 RED failure on `6cd7374e1` -> 35/35 GREEN |
| Pre-dedup baseline comparison | Cross-locator assertion PASSES on `bf486a47c` |
| Existing X -> X -> Y conservation | PASS |
| Existing X -> Y -> X conservation | PASS |
| Unchanged X -> X -> X first-anchor behaviour | PASS |
| Different-range non-aliasing | PASS |
| Reference-lifetime checks | PASS |
| MessageBuilder + dedup + recovery + cache | 103/103 PASS |
| Compaction suites | 177 passed, 1 skipped |
| Full core unit suite | Entry HEAD and correction both: 34 failed files / 154 failed tests, with the sorted failure sets byte-identical; passing 4923 -> 4926 (+3 new tests), **0 ACT-owned regressions** |
| Typecheck baseline comparison | Entry and current diagnostic sets byte-identical (40 pre-existing); ACT-owned diagnostics 0 |
| Biome check | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |

## Scope confirmation

No tool execution, authorization, filesystem, schema, persistence, provider
branch, public API, or compaction architecture changed. No persistent reference
store was introduced. The only production file touched is
`sdk/packages/core/src/session/services/message-builder.ts`; the only test file
touched is
`sdk/packages/core/src/session/services/message-builder-read-dedup.test.ts`.
The diff is 2 files, insertions only.

## Packaging and live qualification

Not performed by this correction. The reviewer authorized exact-head VSIX
packaging and operator live qualification once the cross-locator freshness case
is green; that is the next step. No VSIX artifact identity, cache-hit,
wall-clock, or model-comprehension improvement is claimed. Live operator
qualification is `NOT_EXECUTED`.
