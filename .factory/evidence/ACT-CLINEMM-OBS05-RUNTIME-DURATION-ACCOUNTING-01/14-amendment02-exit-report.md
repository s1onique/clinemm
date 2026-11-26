# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02) — 14 Exit Report

## Verdict

**PASS_STRUCTURAL_ONLY**

The bounded checkpoint-conservation repair is complete and every executable gate is
GREEN. Installed live qualification was **NOT** executed — the operator directed that no
VSIX be built and no live qualification be performed.

OBS-05 therefore remains **pending live qualification**.

## What the AMENDMENT changed

The architecture is RETAINED. The repair touched five seams and REMOVED logic rather than
adding guards around it:

| Seam | Change |
|---|---|
| Accumulator (`task-duration-accounting.ts`) | The per-bucket `Math.max` restore merge is **REMOVED**. The restore is authorized exactly ONCE, at task activation, before the live accounting begins; a stale or duplicate restore is **explicitly rejected** and touches nothing. An unrecognized authoritative phase now opens an explicit **UNKNOWN** interval instead of silently continuing the previous classification. |
| Tracker (`task-telemetry-tracker.ts`) | The restore rejection is exposed as the accumulator's own authority (`restoreRejected`). The bound persistence pair now also carries the **capture order**. |
| Persistence (`SdkController.ts`) | The `candidateTotal > writtenTotal` freshness predicate is **REMOVED**; the **capture order** (the existing process-wide `MessageIdMinter` sequence) is the authority. A write whose `HistoryItem` does not exist is no longer marked durable, so a later retry succeeds. The persistence chain no longer leaks its map entry. The last-written cache holds only a NUMBER and is pruned on re-activation. |
| Coordinator (`sdk-session-event-coordinator.ts`) | The bound pair's capture order travels with the identity and the record into the persistence seam. |
| Webview (`taskHeaderTelemetryHelpers.ts` + `TaskHeaderTelemetry.tsx`) | The forward projection is **MONOTONE across the freshness boundary** (clamped at the bound) and reports a `stale` flag; the component renders an explicit **`estimated`** marker. |

## Why PASS_STRUCTURAL_ONLY and not PASS_LIVE

`PASS_LIVE` requires an exact-head artifact identity AND installed-runtime qualification.
Neither was performed: the artifact was deliberately not built, and the live observations
were therefore not taken.

Everything else the ACT requires is complete and executable:

* the three reproduced restore counterexamples are closed and pinned by witnesses;
* a restored record can never replace a newer live lifecycle phase;
* an open anchor is never reset through an obsolete restore;
* overlapping intervals are never merged;
* equal-duration lifecycle changes persist (phase, coverage and waiting reason);
* an older checkpoint cannot replace a newer one;
* a skipped write is not marked durable, and a later retry succeeds;
* a drained persistence chain removes its map entry;
* the legacy task is unavailable before AND after resumption;
* the header's freshness expiry no longer jumps backwards;

## The regression delta

The full host `src/sdk` vitest suite was run at the entry HEAD
(`23af44c205696f1563f9f4bc922b998639ee6ef9`) and again with the AMENDMENT applied, both
through the JSON reporter, and the per-test failing sets were compared:

| | passed | failed |
|---|---|---|
| entry HEAD | 5728 | 253 |
| with the AMENDMENT | 5748 | 251 |

The per-test diff is **1 added + 3 removed**, and every entry is in the UNRELATED
process-containment / command-job timing families. The three suites were run **in
isolation at the entry HEAD** and produced the **IDENTICAL** result
(`9 failed | 21 passed (30)`) to the same run with the AMENDMENT applied — they are
pre-existing environment-dependent failures, unaffected by this change.

The webview failing set is **byte-IDENTICAL** before and after (`67` failures in both),
with 6 additional passing tests.

**ZERO ACT-owned failures or diagnostics.**

## The evidence classes (W5)

The AMENDMENT-02 witnesses are classified precisely:

| Witness | Class |
|---|---|
| `RED-01` .. `RED-07`, `RED-14` .. `RED-18` | `SYNTHETIC_REAL` — the REAL accumulator and the REAL tracker driven by a synthetic chronology. |
| `RED-08` .. `RED-13` | `REAL_PRODUCTION_SEAM` — the REAL `SdkController.persistDurationAccounting` against a recording history store. |
| `W4-BOUNDARY-1..3` | `SYNTHETIC_REAL` — the REAL pure projection helper. |
| `W4-COMPONENT-1..3` | `REAL_PRODUCTION_SEAM` — the REAL React component with CONTROLLED time advancement, including a quiet gate and the freshness expiry. |

The rows the AMENDMENT-01 re-classified as `SYNTHETIC_REAL` (the provider-latency, the
required-background-command, the detached-background-job and the human-gate rows) remain
`SYNTHETIC_REAL`. They exercise the REAL accumulator with a synthetic phase chronology and
do **NOT** prove that a real provider, job or gate produces those transitions. Those
remain an explicit **live-qualification** requirement.

## Reopen condition

Reopen OBS-05 to reach `PASS_LIVE` when an operator can:

1. build the exact-head dogfood VSIX via the canonical mechanism
   (`python3 scripts/build-dogfood-vsix.py --install`) at a clean tree;
2. install it into the existing ClineMM dogfood profile;
3. execute the live observations listed in
   `13-amendment02-repair-evidence.md` §6 (a real human gate, a real slow provider, a real
   required background command, a real detached background job during a wait, a real
   machine suspend / resume, the webview recreation, the resume/completion cycle, the
   terminal-stability observation, the task-switching/restoration observation and the
   extension-host recovery observation);
4. record those observations against the header's native rendering.

The executable witnesses already pin every property the live run must confirm, so the live
run is a confirmation, not a discovery — with the exception of the rows explicitly
re-classified as `SYNTHETIC_REAL`, which the live run must confirm for the first time.

## Residual risk

The live run can still expose what the deterministic witnesses cannot: that the runtime's
ACTUAL `awaiting_followup` / `awaiting_approval` writes bracket a real human wait exactly
as the synthetic chronology assumes, and that the epoch fence is bumped at every boundary
that can produce a stale write.

The AMENDMENT-02 restore-ownership change adds one behaviour that only the live run can
confirm: a restore now happens EXACTLY ONCE per activation. If production ever restores a
record at a second point in a task's life (for example after a mid-task extension-host
recovery), that restore is now REJECTED rather than merged. The two production activation
seams (`initTask`, `reinitExistingTaskFromId`) are the only restore sites today, and both
run before the live accounting begins, so this is structurally correct — but a live run
that exercises an extension-host recovery must confirm that the accounting still resumes
correctly.

## Known limitations

* `RECOVERY_INTERVENTION` and `OTHER_HUMAN_GATE` remain reserved in the waiting-reason
  union; only `RECOVERY_INTERVENTION` is produced (by the `error` phase).
* The compact proportional bar described as OPTIONAL in the ACT is still NOT implemented.
* **Machine suspend is NOT covered.** The accounting uses a monotonic clock, which is not a
  proof of continuous observation across a suspend. The host has no authoritative
  suspend-discontinuity evidence, so this ACT does **NOT** claim suspend-continuity. The
  limitation is DISCLOSED in the wire contract rather than papered over.
* The accounting is a single visible-task window. Returning to a previously-visible task
  id conserves that task's known durations through its PERSISTED record, not through an
  unbounded per-task in-memory cache.
* Historical session durations remain unqualified. No transcript-based estimation was
  implemented; a legacy task simply reports "unavailable".
* The capture order is a process-local sequence. It is deliberately NOT persisted: a
  persisted order would have to survive a process restart, and the persisted record is
  restored through the one-shot activation restore instead.
