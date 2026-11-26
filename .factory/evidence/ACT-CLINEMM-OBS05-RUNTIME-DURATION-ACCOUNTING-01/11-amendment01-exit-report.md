# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) — 11 Exit Report

## Verdict

**PASS_STRUCTURAL_ONLY**

The bounded correctness repair is complete and every executable gate is GREEN. Installed
live qualification was **NOT** executed — the operator directed that no VSIX be built and no
live qualification be performed.

OBS-05 therefore remains **pending live qualification**.

## What the AMENDMENT changed

The architecture is RETAINED. The repair touched five seams:

| Seam | Change |
|---|---|
| Coordinator wiring (`sdk-session-event-coordinator.ts`) | The accounting is read LAZILY at the persistence boundary through a `readDurationPersistence()` callback instead of being captured EAGERLY at construction time. The record and the task identity travel TOGETHER. |
| Persistence (`SdkController.ts`) | The writes for one task are serialized through a per-task chain, and a checkpoint that is not strictly newer than the one already written is dropped. |
| Accumulator (`task-duration-accounting.ts`) | The restore is monotonic with respect to the accumulated totals, a duplicate restore does not re-establish the interval anchor, the waiting reason is conserved, a restored nonterminal record downgrades coverage to "partial", a legacy task has NO accounting at all, and the clock fallback reads the clock exactly once. |
| Epoch authority (`turn-state-tracker.ts` + `task-telemetry-tracker.ts`) | The accounting binds to the EXISTING `MessageIdMinter.epoch` fence that every production phase writer already stamps. A write from a superseded epoch cannot reopen the accounting. No parallel epoch counter was introduced. |
| Webview (`taskHeaderTelemetryHelpers.ts` + `TaskHeaderTelemetry.tsx`) | A PRESENTATION-ONLY forward projection of the host's snapshot lets the displayed split progress during a quiet human gate without the webview accumulating anything of its own. |

## Why PASS_STRUCTURAL_ONLY and not PASS_LIVE

`PASS_LIVE` requires an exact-head artifact identity AND installed-runtime qualification.
Neither was performed: the artifact was deliberately not built, and the live observations
were therefore not taken.

Everything else the ACT requires is complete and executable:

* fresh production persistence is demonstrated through the REAL controller persistence path;
* identity-bound records are conserved (a record is never written into a different task's
  history slot);
* restart coverage is honest (a restored nonterminal record reports "partial"; no numeric
  gap is invented; a completed task's dormant interval remains legitimately excluded);
* duplicate restores cannot roll back known accounting;
* legacy task activation does not fabricate history;
* task restoration preserves known totals;
* execution-epoch authority is established against the EXISTING fence;
* header freshness has an executable contract (the bounded presentation-only projection);
* the relevant gates pass with ZERO ACT-owned regressions.

## The evidence classes (W5)

The ACT's original evidence overstated what the synthetic chronologies prove. The AMENDMENT
re-classifies every witness precisely — `SYNTHETIC_REAL`, `REAL_PRODUCTION_SEAM`,
`STRUCTURAL`, `NOT_EXECUTED` — and states explicitly that the provider-latency, required
background-command, detached-background-job and human-gate rows are `SYNTHETIC_REAL`: they
exercise the REAL accumulator with a synthetic phase chronology and do **NOT** prove that a
real provider, job or gate produces those transitions. Those remain an explicit
live-qualification requirement. See `06-amendment01-repair-evidence.md` §3 and §5.

## Reopen condition

Reopen OBS-05 to reach `PASS_LIVE` when an operator can:

1. build the exact-head dogfood VSIX via the canonical mechanism
   (`python3 scripts/build-dogfood-vsix.py --install`) at a clean tree;
2. install it into the existing ClineMM dogfood profile;
3. execute the L1..L6 observations listed in
   `06-amendment01-repair-evidence.md` §5 (a real human gate, a real slow provider, a real
   required background command, a real detached background job during a wait, a real machine
   suspend / resume, and the header's native rendering);
4. record those observations against the header's native rendering.

The executable witnesses already pin every property the live run must confirm, so the live
run is a confirmation, not a discovery — with the exception of the rows the AMENDMENT
explicitly re-classified as `SYNTHETIC_REAL`, which the live run must confirm for the first
time.

## Residual risk

The live run can still expose what the deterministic witnesses cannot: that the runtime's
ACTUAL `awaiting_followup` / `awaiting_approval` writes bracket a real human wait exactly
as the synthetic chronology assumes, and that the epoch fence is bumped at every boundary
that can produce a stale write. The phase-driven classification and the existing fence make
both structurally sound, but only a live run can confirm the real writes land where the
authority says they do.

## Known limitations

* `RECOVERY_INTERVENTION` and `OTHER_HUMAN_GATE` remain reserved in the waiting-reason union;
  only `RECOVERY_INTERVENTION` is produced (by the `error` phase).
* The compact proportional bar described as OPTIONAL in the ACT is still NOT implemented. The
  elapsed/active/waiting/unknown values and the waiting reason ARE implemented and
  distinguishable.
* **Machine suspend is NOT covered.** The accounting uses a monotonic clock, which is not a
  proof of continuous observation across a suspend: on most platforms a monotonic clock
  either pauses during the suspend (the suspended wall time is silently not counted) or
  advances across it (the suspended wall time is counted as if the task had been running).
  The host has no authoritative suspend-discontinuity evidence, so this ACT does **NOT**
  claim suspend-continuity. The limitation is DISCLOSED in the wire contract rather than
  papered over. If an OS suspend/resume notification becomes available, the affected
  interval's coverage can be downgraded to "partial" at that point.
* The accounting is a single visible-task window. Returning to a previously-visible task id
  conserves that task's known durations through its PERSISTED record, not through an
  unbounded per-task in-memory cache.
* Historical session durations remain unqualified. No transcript-based estimation was
  implemented; a legacy task simply reports "unavailable".
