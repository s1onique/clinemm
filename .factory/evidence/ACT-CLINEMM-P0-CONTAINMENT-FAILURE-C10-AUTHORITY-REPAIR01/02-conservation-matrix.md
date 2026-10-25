# 02 — CAUSAL CONSERVATION MATRIX (before → after)

Every row was exercised against the REAL production coordinator and manager
seams in
`apps/vscode/src/sdk/__tests__/containment-failure-c10-authority-repair01.cfc10ar01.test.ts`
(25 tests) and, for the immediate path, additionally in the predecessor's
suite `containment-failure-c10-authority01.cfc10a01.test.ts` (19 tests).

`BEFORE` = the pristine ENTRY_HEAD production implementation.
`AFTER` = the repaired implementation.

## The required matrix

| # | Case | BEFORE (C10) | AFTER (C10) | Witness |
|---|---|---|---|---|
| 1 | Failed containment, observation PENDING | HOLD | HOLD | M1-A / RED-03-A |
| 2 | Failed containment, observation CONSUMED | **COMMIT (defect)** | **HOLD** | M1-B / RED-03-B |
| 3 | Clean containment, observation PENDING | HOLD | HOLD | M1-C / RED-03-C |
| 4 | Clean containment, observation CONSUMED | COMMIT | COMMIT | M1-D / RED-03-C |
| 5 | Foreign failed containment | COMMIT | COMMIT | M1-E / RED-04-A |
| 6 | Unknown-owner failed containment | **COMMIT (defect)** | **HOLD** | M1-F |
| 7 | ABSENT owner map + failed containment | **COMMIT (defect)** | **HOLD** | M1-G |
| 8 | ABSENT state map (input not wired) | COMMIT | COMMIT | M1-H |
| 9 | Elm HOLD, clean containment | HOLD | HOLD | M2-A / RED-03-D |
| 10 | Elm AUTHORIZE, failed containment | **COMMIT (defect)** | **HOLD** | M2-B |
| 11 | Elm FAILURE, clean containment | HOLD | HOLD | M2-C |
| 12 | Deferred re-evaluation, failed containment | **COMMIT (defect)** | **HOLD** | M3-A / RED-03-B-DEFERRED |
| 13 | Deferred re-evaluation, clean containment | COMMIT | COMMIT | M3-B |
| 14 | Deferred re-evaluation, foreign failure | COMMIT | COMMIT | M3-C |
| 15 | Stale task/epoch marker | no commit | no commit | M5-B |
| 16 | Multiple jobs, one matching failure | **COMMIT (defect)** | **HOLD** | M1-I |
| 17 | Multiple jobs, only foreign failures | COMMIT | COMMIT | M1-J |
| 18 | Existing Q5 failure recovery | `resumable` + canonical writer | **UNCHANGED** | M5-C + PHCF01 (10/10) |

## The R4 asynchronous admission interval

| # | Case | BEFORE | AFTER | Witness |
|---|---|---|---|---|
| 19 | A containment failure published DURING the awaited Elm flush | **COMMIT (defect)** | **HOLD** | M4-A |
| 20 | The same interval on the clean path | COMMIT | COMMIT | M4-B |
| 21 | The revalidation adds a second Elm consult | n/a | **NO — exactly 1** | M4-C |

Row 19 is the R4 finding: `checkElmCompletionAuthority()` awaits
`flushElmAuthorityForSession` between the barrier's containment read and the
final phase write, so a failure published during that await was invisible to
the earlier read. The repair re-reads the SAME owner-scoped classifier at the
ACTUAL commit boundary on both the immediate and the deferred path.

## The additional required verifications

| Required verification | Result | Witness |
|---|---|---|
| No authoritative completion-marker promotion while blocked | **PASS** — `markerPromotions() === 0` | M1-B, M2-B, M3-A, M4-A |
| No `task_completion_committed` event while blocked | **PASS** — the CCARD capture count is 0 | M1-B, M2-B, M3-A, M4-A, M5-E |
| A clean terminal does not suffer a new false HOLD | **PASS** — the clean path still commits | M1-D, M3-B, M4-B |
| Observing or evicting a failed job does not erase its classification | **PASS** — the classification survives the observation consumption | M5-A / RED-02-A |
| Tracing disabled preserves normal non-defect behavior | **PASS** — the clean path commits with the canonical writer id | M5-D |
| The predicate is not duplicated | **PASS** — exactly 1 classifier definition, exactly 1 `containment_failed` comparison, 5 call sites | M5-F / RED-03-E |
| The Q5 path uses the SHARED classifier | **PASS** — no second copy | M5-C |
| The CCARD capture fires exactly once on the clean path | **PASS** | M5-E |

## The success criterion

```
containment_failed + observation_consumed + Elm_AUTHORIZE → C10_completed
```

is now IMPOSSIBLE through the tested production paths:

- **Immediate path** — the barrier's fifth conjunct (Site A) holds, and the
  commit-boundary revalidation (R4) holds the commit even if the failure
  appears during the Elm flush.
- **Deferred path** — the Site B conjunct holds and PRESERVES the deferred
  marker, and the R4 revalidation re-registers the marker at the commit
  boundary.
- **The clean-terminal path continues to work** — M1-D / M3-B / M4-B.

## The shared classifier's semantics (G2)

| Input | Classification | Preserved from Q5 |
|---|---|---|
| Clean terminal job | Does not block | yes |
| `containment_failed`, matching session | Blocks | yes |
| `containment_failed`, foreign session | Does not block | yes |
| `containment_failed`, unknown owner | Blocks | yes (fail closed) |
| `containment_failed`, owner map unavailable | Blocks conservatively | yes (pre-PHCF17 unscoped) |
| Multiple jobs, at least one matching failure | Blocks | yes |
| No failure entries | Does not block | yes |
| ABSENT state map (input not wired) | Does not block | yes (pre-PHCF01) |

The distinction between an ABSENT authority input and a KNOWN
failed-containment entry is preserved: an absent state map means there is no
entry to classify; an absent owner map while a `containment_failed` entry
DOES exist means the owner discriminator is unavailable, so the entry is
RETAINED (fail closed).
