# ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 — Evidence Report

**Target:** Chart 01 (Task / Turn Phase), claims T-01 … T-14
**Verdict:** `PASS_STRUCTURAL_ONLY`
**ENTRY_HEAD:** `27e82ca3fef79fd48dc2ee59240167114349c7bc` (main)
**Baseline stated by the ACT:** `27e82ca3fef79fd48dc2ee59240167114349c7bc` — **verified as the actual ENTRY_HEAD**.

## 0. Summary

Chart 01's nine pre-existing claims (`T-01` … `T-09`) are now
source-bound executable contracts, plus the five MINIMAL source-bound
additions (`T-10` … `T-14`) that describe pre-existing production
writers the old diagram omitted.

| metric | value |
|---|---|
| eligible claims | **14** |
| eligible claims with executed PASS evidence | **14** |
| eligible claims FAILED | **0** |
| eligible claims with an explicit gap | **0** |
| negative witnesses | **11 / 11 PASS** |
| invariant witnesses | **8 / 8 PASS** |
| witness suite | **60 passed (60)** |
| RED/GREEN controlled mutations | **5 / 5 detected the targeted defect** |

**No production behaviour changed.** The only non-test, non-documentation
source touched is the Mermaid **validator**
(`apps/vscode/src/sdk/lifecycle-transition-contract-verifier.ts`) — a
documentation-synchronization guard, not runtime behaviour.

## 1. R0 — recon and the ownership map

### 1.1 The starting facts, VERIFIED against source

| stated fact | verified | source |
|---|---|---|
| `setWithWriter()` updates phase, anchor and sequence BEFORE notifying listeners | **yes** | `apps/vscode/src/sdk/turn-state-tracker.ts:96-153` |
| `set()` is the legacy alias using `unknown-legacy-writer` | **yes** | `turn-state-tracker.ts:71-73` |
| Observers must not veto an authoritative phase write | **yes** | `turn-state-tracker.ts:144-152` (try/catch over a `[...this.listeners]` snapshot) |
| `TurnPhase` contains eight values | **yes** | `apps/vscode/src/shared/ExtensionMessage.ts:713-729` |
| The modern TaskHeader has host/shadow/legacy authority selection; `stateLabel()` alone is not the complete display-authority contract | **yes** | `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:559` (`selectTaskHeaderPresentation`); `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` (`stateLabel` / `taskHeaderPresentationStateLabel`) |
| `T-06` documents the cancellation straggler guard | **yes** | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3338` |
| `T-09` documents a projection, not a transition | **yes** | `taskHeaderTelemetryHelpers.ts` |

### 1.2 The phase-writer ownership map (G0)

The map is machine-checkable in
`apps/vscode/src/sdk/turn-phase-contract.ts#TURN_PHASE_WRITER_MAP` and is
rendered as a table in the Chart 01 document. The witness suite proves
it is a **TOTAL, DISJOINT** map over the closed `TurnStateWriterId`
union (`G0` and `G0 (completeness)`).

**The real writers are NOT confined to the session-event coordinator.**
Recon found writers in six additional production modules:

| module | writers |
|---|---|
| `sdk-session-event-coordinator.ts` | `session-event-pending-prompt-submitted`, `session-event-turn-complete-completed`, `session-event-turn-complete-error`, `session-event-turn-complete-awaiting-followup`, `session-event-turn-complete-awaiting-followup-liveness`, `session-event-turn-complete-resumable-straggler-preserve`, `session-event-turn-complete-containment-failed-resumable`, `session-event-bcb-blocked-observation-unavailable` |
| `sdk-interaction-coordinator.ts` | `interaction-handle-tool-approval`, `interaction-resolve-tool-approval-message-response`, `interaction-resolve-tool-approval-yes-no`, `interaction-handle-ask-question`, `interaction-resolve-ask-question`, `interaction-handle-mistake-limit`, `interaction-resolve-mistake-limit` |
| `sdk-compaction-coordinator.ts` | `compaction-enter` (+ the three phase-dependent restore writers) |
| `sdk-task-control-coordinator.ts` | `task-control-resume-ask`, `task-control-resumable-ask`, `task-control-idle-fallback`, `task-control-cancel-no-active-session` |
| `sdk-task-start-coordinator.ts` | `task-start-init-task`, `task-start-reinit-existing-task` |
| `sdk-mode-coordinator.ts` | `mode-coordinator-mode-switch-resumable` |
| `SdkController.ts` | `controller-on-send-error`, `controller-emit-cline-auth-error`, `controller-emit-cline-balance-error`, `controller-cancel-task`, `controller-clear-task`, `controller-ask-response`, `controller-edit-message-and-regenerate`, `controller-epoch-transition-reseed`, `controller-restore-checkpoint`, `followup-auto-continue-starting`, `followup-auto-continue-failed`, `followup-on-follow-up-abandoned`, `followup-on-resume-failed` |

**The phase-dependent restore writers.** The three compaction restore
writers (`compaction-restore-entry-preserve`,
`compaction-restore-canonical-unavailable-preserve`,
`compaction-restore-canonical-resolved`) do NOT commit a FIXED phase —
they commit the phase that was current when the bounded window opened.
They are therefore listed in `TURN_PHASE_RESTORE_WRITERS` rather than
being mis-attributed to `compacting`.

### 1.3 The observation boundary

For each candidate observation the ACT's chain is:

`request → writer authorization → tracker mutation → committed snapshot → listener notification → transported snapshot → UI projection`

| stage | production symbol | observable? |
|---|---|---|
| request | the coordinator / interaction / compaction / control call site | yes |
| writer authorization | the predicate at the call site (Elm decision, BCB capability probe, cancel fence, etc.) | yes (Elm decision is INJECTED at the existing provider boundary) |
| tracker mutation | `TurnStateTracker.setWithWriter` | **yes — this is the authoritative host phase boundary** |
| committed snapshot | `TurnStateTracker.get()` | yes |
| listener notification | `TurnStateTracker.subscribe` fan-out | yes (observation-only; cannot veto) |
| transported snapshot | the webview replica reducer (`applyTurnState` / `applyPresentationProjection` / `applyStateSnapshot`) | yes, driven by the REAL reducer |
| UI projection | `taskHeaderPresentationStateLabel` over `selectTaskHeaderPresentation` | yes |

**A host snapshot commit is NOT equated with webview delivery.** The
witnesses that assert "the webview accepted the state" drive the REAL
reducer; the witnesses that assert "the phase is committed" read the
tracker's committed snapshot. The two are never conflated.

### 1.4 Unobservable boundaries (explicitly marked)

| boundary | classification | reason |
|---|---|---|
| live Elm kernel evaluation | `INJECTED_DECISION` | the decision is injected at the existing `getElmCompletionAuthorityDecision` provider boundary; the kernel itself is not re-qualified here |
| installed-extension webview render | `LIVE_UNOBSERVABLE` | no installed-extension live capture was taken, so no live observation is claimed |

## 2. Claim classification (G1)

The provisional classification in the ACT was **confirmed** by recon:

| claim | provisional | final | change |
|---|---|---|---|
| T-01 | TRANSITION | TRANSITION | — |
| T-02 | TRANSITION | TRANSITION | — |
| T-03 | TRANSITION | TRANSITION | — |
| T-04 | TRANSITION | TRANSITION | — |
| T-05 | TRANSITION | TRANSITION | — |
| T-06 | GUARD | **GUARD** | confirmed: the straggler guard SUPPRESSES a write; it performs no transition of its own |
| T-07 | TRANSITION | TRANSITION | — |
| T-08 | TRANSITION | TRANSITION | grouped over FOUR distinct source states |
| T-09 | PROJECTION | **PROJECTION** | confirmed: the label is a function of the committed phase, not a lifecycle state |

### 2.1 The minimal source-bound additions (T-10 … T-14)

The ACT authorizes "only the minimal source-bound IDs needed to describe
[additional load-bearing transitions]". Recon found five genuine
production writers that the old diagram did NOT represent. **None is new
production behaviour** — each is a pre-existing writer:

| id | transition | production writer | why the old diagram omitted it |
|---|---|---|---|
| T-10 | → `compacting` | `compaction-enter` | the compaction phase had no Chart 01 edge at all |
| T-11 | `compacting` → (entry phase) | `compaction-restore-entry-preserve` | the restore had no Chart 01 edge |
| T-12 | → `awaiting_approval` | `interaction-handle-tool-approval` | the interaction coordinator was not in the diagram's scope |
| T-13 | → `awaiting_followup` | `interaction-handle-ask-question` | same |
| T-14 | `awaiting_approval` → `streaming` | `interaction-resolve-tool-approval-yes-no` | same |

## 3. The eight-phase vocabulary (G2)

All eight phases are accounted for with their production writers and
their TaskHeader projection authority (the table is in the Chart 01
document; the machine-checkable form is `TURN_PHASE_WRITER_MAP` and
`TURN_PHASE_PROJECTION_AUTHORITY`).

**The projection authority is a property of the SELECTOR's precedence,
not of the phase alone.** `selectTaskHeaderPresentation` gives the HOST
precedence for exactly the four phases the canonical shadow cannot
represent (`compacting`, `awaiting_followup`, `error`, `resumable`); the
other four are rendered from the shadow when a shadow observation exists
and from the legacy absence fallback otherwise.

## 4. The invariants (INV-T01 … INV-T09)

| id | invariant | witness | result |
|---|---|---|---|
| INV-T01 | the tracker mutation precedes the listener notification; the listener is not an independent authority | the REAL tracker with a subscriber that READS the committed snapshot at notification time | PASS |
| INV-T02 | every committed write advances the committed seq, including repeated writes of the SAME phase | the REAL tracker, asserting the COMMITTED SNAPSHOT (not the generator's return value) | PASS |
| INV-T02 | the webview stale-state acceptance rule | the REAL `applyTurnState` / `applyPresentationProjection` / `applyStateSnapshot` | PASS |
| INV-T09 | observers cannot veto commits | the REAL tracker: a throwing subscriber, a self-removing subscriber, a subscriber removing another subscriber, and the diagnostic disabled | PASS |

**The webview rule is NOT inferred from the tracker.** The witness
drives the REAL reducer and asserts a stale LOWER-sequence state does
not replace a newer one, that a stale OLDER-EPOCH snapshot is dropped
wholesale, and that an equal-sequence state is accepted idempotently.

## 5. The negative witnesses

| id | counterexample | expected detection | result |
|---|---|---|---|
| NEG-T01 | unauthorized completion after an Elm HOLD | no `completed` commit | PASS |
| NEG-T02 | late `done` after a cancellation | `resumable` preserved (phase AND seq) | PASS |
| NEG-T02 | (control) a legitimate NEW turn after the cancellation | `streaming` DOES advance | PASS |
| NEG-T03 | older phase snapshot delivered after a newer one | stale state rejected | PASS |
| NEG-T04 | throwing tracker subscriber | state remains committed, subsequent subscriber runs | PASS |
| NEG-T05 | incorrect ID attached to a Mermaid edge | exact edge association rejected | PASS |
| NEG-T06 | compaction represented as a user waiting | wrong phase/projection detected | PASS |

**NEG-T05 keeps BOTH ids.** The mutation swaps the labels of T-03
(`streaming → awaiting_followup`) and T-12 (`streaming →
awaiting_approval`) **by their endpoints**, never by an already-mutated
id. The witness first asserts that both ids still survive exactly once
and that each is now attached to the other's edge, then asserts that
BOTH associations are rejected, and finally asserts that the rejection
is NOT a "missing id" artifact. A rejection caused merely by a missing
ID does not prove association validation.

**The phase races use controlled event ordering, never sleeps.** The
cancellation is committed first and the late `done` is delivered
afterwards; the legitimate-resume control then drives a real
`pending_prompt_submitted` event.

## 6. RED/GREEN evidence against MUTATED PRODUCTION SOURCES

Each mutation was applied to the REAL production file, the whole witness
suite was re-run, and the file was then restored byte-for-byte
(`git diff --stat` → empty for the mutated file).

| # | mutation | production file | RED (failed tests) | GREEN |
|---|---|---|---|---|
| 1 | the turn-complete straggler guard is disabled (`if (false && …)`) | `sdk-session-event-coordinator.ts:3338` | **3 failed** — T-06 ×2, NEG-T02 | 60 passed |
| 2 | an Elm HOLD returns `true` (the historical silent-TS-fallback defect) | `sdk-session-event-coordinator.ts` (`checkElmCompletionAuthority`) | **2 failed** — T-02 (Elm HOLD), NEG-T01 | 60 passed |
| 3 | the observer isolation is removed (no try/catch around the listener fan-out) | `turn-state-tracker.ts:144-152` | **2 failed** — INV-T09, NEG-T04 | 60 passed |
| 4 | the compaction path does not enter the `compacting` phase | `sdk-compaction-coordinator.ts:488` | **3 failed** — T-10 ×2, NEG-T06 | 60 passed |
| 5 | the host compaction override is removed from the projection selector | `task-state-shadow-arbiter-mapper.ts:562` | **2 failed** — T-09 (host authority), NEG-T06 | 60 passed |

**Twelve distinct targeted assertions failed across the five mutations,
and every one names the property it protects.** This is the ACT's
primary success criterion: a regression in completion authority,
cancellation preservation, phase writer behaviour, compaction authority
or TaskHeader projection is detected by an executable witness rather
than surviving behind a well-rendered diagram.

## 7. Chart 01 hardening (G9)

### 7.1 The corrected diagram

The Chart 01 Mermaid block was corrected in
`docs/architecture/task-lifecycle/01-task-turn-phase.md`:

* **Every genuine transition is labelled with its stable id.**
* **T-06 is no longer drawn as an edge.** It is a GUARD — a SUPPRESSION
  of a write. It is now a NOTE on the `resumable` state.
* **T-09 is not drawn as an edge.** It is a PROJECTION.
* **The T-08 fan-in is drawn as FOUR separate edges** (T-08, T-08a,
  T-08b, T-08c), one per genuinely distinct runtime source state. A
  slash-delimited source string is not a runtime phase.
* **The eight-phase vocabulary is complete** — `awaiting_approval` and
  `compacting` now appear as first-class states (they were absent from
  the old diagram).
* **T-02 is the ONLY edge into `completed`.** The validator REJECTS any
  other labeled edge whose target is `completed`.
* **The C9 attempt versus C10 commit distinction is preserved.** The
  `completed` note states that T-02 is the only edge into the state and
  that it requires BOTH TS conservation and Elm authorization.

### 7.2 Two documented DISCREPANCIES were corrected

Recon found two edges in the OLD diagram that had **no backing phase
write** in the current production source:

| old edge | finding | disposition |
|---|---|---|
| `streaming --> streaming : content_start / content_update / content_end` | the session-event coordinator performs **NO** phase write for `content_start` / `content_update` / `content_end` (the only `streaming` write in that file is the `pending_prompt_submitted` one) | **REMOVED** — it was not a phase transition |
| `awaiting_approval --> error : approval denied (non-recoverable)` | `resolvePendingToolApproval` commits `streaming` for BOTH approve AND deny; there is no `error` write on the denial path | **REMOVED** — it was not a phase transition |

Recording these as discrepancies (rather than creating production
behaviour to preserve an old diagram) is the disposition the ACT
requires.

### 7.3 The strict association checker (reused, not duplicated)

The existing strict checker in
`apps/vscode/src/sdk/lifecycle-transition-contract-verifier.ts` was
EXTENDED with `verifyChart01TurnPhase`. It is the **same core** the
c9-c10 diagram and Chart 04 use — **not** a second, independent,
cardinality-only checker.

It enforces:

1. every Chart 01 TRANSITION claim appears on EXACTLY ONE labeled edge;
2. every GUARD / PROJECTION claim (T-06, T-09) carries NO edge;
3. every TRANSITION claim labels the CORRECT edge (the verified
   source/target association);
4. NO UNAUTHORIZED path into `completed`;
5. all EIGHT canonical phase states are present.

`transitionIdOfLabel` was extended to recognise the grouped `T-08a` /
`T-08b` / `T-08c` ids (a single optional lowercase suffix) WITHOUT
matching the pre-existing `A-03` / `P-06` / `P-01` ids.

### 7.4 The real Mermaid parser

`bun run verify:chart01-mermaid-parse` parses the embedded Chart 01
block with the INSTALLED REAL Mermaid parser (`mermaid@11.16.1` + a
headless `jsdom@26.1.0` window) — **PASS (exit 0)**.

The markdown-fence guard
(`bun run verify:markdown-mermaid-blocks`) also passes for all four
lifecycle charts.

## 8. Gates

| gate | requirement | result |
|---|---|---|
| G0 | actual writer/authority map verified | **PASS** — total, disjoint map over the closed union; G0 + G0 (completeness) |
| G1 | all nine T-series claims classified | **PASS** — T-06 GUARD, T-09 PROJECTION, the rest TRANSITION |
| G2 | actual eight-phase vocabulary accounted for | **PASS** — all eight, with writers and projection authority |
| G3 | all testable claims have executed evidence or explicit gaps | **PASS** — 14/14 executed, 0 gaps |
| G4 | C10 cannot bypass Elm/BCB authority | **PASS** — T-02 ×4 + NEG-T01; RED-verified against the silent-fallback mutation |
| G5 | cancellation and stale-event conservation pass | **PASS** — T-05, T-06, NEG-T02 ×2, NEG-T03, INV-T02 ×3 |
| G6 | sequence/epoch boundary tests pass | **PASS** — INV-T02 ×3 |
| G7 | TaskHeader projection authority verified | **PASS** — T-09 ×7; RED-verified against the override-removal mutation |
| G8 | mutation witnesses detect targeted defects | **PASS** — 5/5 production mutations detected |
| G9 | Chart 01 passes strict edge association and real Mermaid parse | **PASS** — validator exit 0; real Mermaid parser exit 0 |
| G10 | focused regressions, typecheck and lint pass | **PASS** — see §9 |
| G11 | source and artifacts bound to actual HEAD | **PASS** — see §10 |
| G12 | no unintended production state-semantic delta | **PASS** — see §11 |

## 9. Regression delta

### 9.1 The focused, bounded selection (the usable gate)

| suite | result |
|---|---|
| `turn-phase-contract01.tpc01.test.ts` (new) | **60 passed (60)** |
| `turn-state-tracker.test.ts` | PASS |
| `lifecycle-transition-contract-verifier.correction01.test.ts` | PASS |
| `completion-presentation-contract01.cpc01.test.ts` (H01 / Chart 04) | PASS |
| `markdown-mermaid-block-verifier.c9c10mm01.test.ts` | PASS |
| `sdk-compaction-coordinator.turn-phase-authority.test.ts` | PASS |
| `sdk-session-event-coordinator.test.ts` | 2 pre-existing failures (see §9.3) |
| `sdk-task-control-coordinator.test.ts` | PASS |
| `sdk-interaction-coordinator.test.ts` | PASS |
| `task-terminal-divergence-red01.tdd-red01.test.ts` | 3 pre-existing failures (see §9.3) |
| `bcb-observation-unavailable-capture.bcapt01.test.ts` | PASS |
| `turn-state-writer-provenance.wprov.test.ts` | 1 pre-existing failure (see §9.3) |

### 9.2 The deterministic gates

| gate | command | result |
|---|---|---|
| coverage generator | `bun run verify:turn-phase-contract` | **PASS — 14/14** (`exit 0`) |
| contract + diagram validator | `bun run verify:lifecycle-transition-contract` | **PASS** (`exit 0`) — c9-c10 + Chart 04 + Chart 01 |
| Mermaid parser | `bun run verify:chart01-mermaid-parse` | **PASS** (`exit 0`) |
| markdown fence guard | `bun run verify:markdown-mermaid-blocks` | **PASS** (`exit 0`) |
| TypeScript | `bun x tsc --noEmit` (apps/vscode) | **PASS — 0 diagnostics** |
| Biome lint | `biome lint` on the three touched source files | **PASS** |
| Biome format | `biome format` on the three touched source files | **PASS** |

### 9.3 The pre-existing baseline failures (RECORDED, not owned, not repaired)

Six failures were observed in the related suites. They were verified to
be **PRE-EXISTING** by stashing the entire change set and re-running the
identical files at the pristine `ENTRY_HEAD` `27e82ca3f`: **the identical
six failures, with identical names.** The delta is **ZERO**.

| suite | failing test | classification |
|---|---|---|
| `sdk-session-event-coordinator.test.ts` | `CPL02: done with committed terminal response AND attempt-completion transitions to completed` | pre-existing assertion failure |
| `sdk-session-event-coordinator.test.ts` | `OWN01 RED: bare done + no terminal commit + no attempt_completion + no user-yield authority MUST NOT yield to awaiting_followup` | pre-existing (an intentionally-RED probe) |
| `task-terminal-divergence-red01.tdd-red01.test.ts` | `TDD-01 … non-recoverable error earlier in the same turn as submit_and_exit content_end` | pre-existing assertion failure |
| `task-terminal-divergence-red01.tdd-red01.test.ts` | `TDD-01 … the visible completion row is the SAME on live and reopen paths` | pre-existing assertion failure |
| `task-terminal-divergence-red01.tdd-red01.test.ts` | `TDD-07: SYNTHETIC_REAL witness — final-state assertion` | pre-existing (an intentionally-RED probe) |
| `turn-state-writer-provenance.wprov.test.ts` | `WPROV07.1: writerId union fully reconciles with production call sites` | pre-existing; the scan reports a production writer id `completed` that is not in the closed union — **the ACT did NOT add that writer and did NOT change the union** |

**WPROV07.1 was checked against this ACT's footprint.** That test reads
only `SdkController.ts` and the closed union in
`turn-state-writer-provenance.ts`; it does not read the new registry
module, and the new registry introduces NO production writer id (the
`unknown-legacy-writer` sentinel is the only identity it names beyond
the union). The failure is identical at the pristine `ENTRY_HEAD`.

### 9.4 The environment limitation (recorded, not masked)

The macOS sandbox cannot spawn child processes (`spawn_failed` /
`EPERM`), which makes the process-spawning suites flaky and aborts
vitest at a different point each run. The FULL `apps/vscode` vitest
suite therefore does **NOT** produce a stable count on this machine.

The ACT's response is the one the baseline prescribes:

* an **isolated, bounded test selection** is used as the usable gate
  (§9.1) — every suite is named, and every result is recorded;
* the exact failing test identities are compared against the pristine
  `ENTRY_HEAD` (§9.3) rather than a count;
* test assertions are distinguished from worker-startup failures — the
  six recorded failures are all **assertion** failures, not
  worker-startup failures;
* the full-suite limitation is reported here rather than being
  replaced by a green number.

**Vitest worker-thread mode was NOT used to silently replace the
project's established gate.** The established gate is
`bun run test:vitest` (`vitest run --config vitest.config.ts`), which is
what the focused selection above runs.

## 10. Source and artifact binding (G11)

Every artifact is generated from the executed witness outcomes — never
from a static declaration. The generator
(`scripts/verify-turn-phase-contract.ts`) runs the ACTUAL suite and
parses the reporter output; a claim whose witness did not run is
reported as FAIL / UNVERIFIED and the gate fails.

| artifact | content |
|---|---|
| `docs/acts/…/coverage-report.md` / `.tsv` | the 14-row coverage report, generated from the executed outcomes |
| `docs/acts/…/assertion-inventory.tsv` | the source-bound assertion inventory (one row per witness case) |
| `docs/acts/…/artifact-manifest.tsv` | SHA-256 + byte counts for every artifact |
| `docs/architecture/task-lifecycle/01-task-turn-phase.md` | the corrected Chart 01 document + diagram |
| `docs/architecture/task-lifecycle/transitions.tsv` | the canonical ledger (T-01 … T-14 rows, with `claim_kind` / `evidence_witness` / `evidence_status`) |

## 11. Preservation (G12)

* **No production behaviour changed.** The mutated production files were
  restored byte-for-byte; `git diff --stat` over `apps/vscode/src/sdk/`
  shows only `lifecycle-transition-contract-verifier.ts` (the
  documentation-synchronization validator).
* No lifecycle-policy refactoring, no new Elm kernel or authority, no
  public protocol change, no new tracing framework.
* No unrelated diagram was rewritten (Chart 02, 03 and 04 are
  untouched apart from the shared validator now also covering Chart 01).
* No synthetic-to-live evidence promotion: the Elm decision is labelled
  `INJECTED_DECISION` and the installed-extension render is labelled
  `LIVE_UNOBSERVABLE`.
* No worktrees. No dependency or framework additions — the existing
  `mermaid@11.16.1` and `jsdom@26.1.0` copies in the workspace store are
  used; nothing was added to any manifest.
* No diagnostic side effect inside a React functional updater.
* Unrelated Git state preserved (the pre-existing `stash@{0}` was
  restored intact after the baseline comparison).

## 12. Limitations and explicit gaps

| item | classification | reason |
|---|---|---|
| live Elm completion-authority execution | `INJECTED_DECISION` | the decision is injected at the existing provider boundary; the Elm kernel itself is not re-qualified by this ACT |
| installed-extension live capture | `LIVE_UNOBSERVABLE` | no live capture was taken, so no live observation is claimed |
| the FULL `apps/vscode` vitest suite | **ENVIRONMENT LIMITATION** | the macOS sandbox cannot spawn child processes, so the full-suite count is unstable; the bounded focused selection (§9.1) is the usable gate, and the exact failing identities are compared against the pristine `ENTRY_HEAD` (§9.3) |
| the six pre-existing failures | **PRE-EXISTING (not owned)** | verified identical at the pristine `ENTRY_HEAD`; recorded, not repaired |
| generated-sequence testing | **OMITTED (recorded)** | the existing harness pins every combination the ACT names as explicit, individually-named witnesses against the real production seams. A seeded generator would add a state-machine oracle — which the ACT forbids — and more machinery than useful coverage. |

## 13. Closure

**Verdict: `PASS_STRUCTURAL_ONLY`.**

All required executable source-bound gates pass:

* the phase-writer ownership map is verified (G0);
* all nine pre-existing claims are classified and all fourteen claims
  have executed evidence (G1, G3);
* the eight-phase vocabulary is fully accounted for (G2);
* completion cannot bypass the Elm/BCB authority (G4);
* cancellation and stale-event conservation pass (G5);
* the sequence/epoch boundary tests pass (G6);
* the TaskHeader projection authority is verified (G7);
* the mutation witnesses detect their targeted defects (G8);
* Chart 01 passes the strict edge association and the real Mermaid parse
  (G9);
* the focused regressions, typecheck and lint pass (G10);
* the source and artifacts are bound to the actual HEAD (G11);
* there is no unintended production state-semantic delta (G12).

`PASS_LIVE` is **NOT** claimed: no installed-extension live capture was
taken, so there is nothing to bind to the exact installed source.
