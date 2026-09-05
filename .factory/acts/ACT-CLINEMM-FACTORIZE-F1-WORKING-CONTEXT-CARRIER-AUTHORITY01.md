# ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01

> Status: **OPEN / RECON / DISCRIMINATOR_NOT_YET_FROZEN / C1: GO** (entry 2026-09-05).
> Predecessor: `ACT-CLINEMM-FACTORIZE-F0-INVENTORY01` (PASS_WITH_NONBLOCKING_RESIDUE, closure commits `49e7069c1` and `0debc0cc1`).
> Mode: **RECON → CHARACTERIZATION → BOUNDED FACTORIZATION** (NOT direct refactor).
> First evidence only — both chains captured + frozen `SAME_*` discriminator. **No RED until all three discriminator answers are recorded.**

## Identity

| Field | Value |
|---|---|
| ENTRY_HEAD | `0debc0cc133ce54f02eff3e6e0d673c2571cbf40` |
| ENTRY_TREE | worktree clean at F1 entry |
| BRANCH | `main` |
| WORKTREE | clean (apart from F1 evidence + .gitignore entry once added) |
| F0_CLOSURE_HEAD | `49e7069c1eb56adf753286d72427f7bf17755925` (unchanged after LEAMAS P2 addendum) |
| F1_CORRECTION_ADDENDUM_HEAD | `0debc0cc133ce54f02eff3e6e0d673c2571cbf40` (LEAMAS P2 correction landed before F1 entry) |

## Inherited from F0 (verbatim, non-negotiable)

```
WorkingContextHostCapture = CACHE_OR_PROJECTION_WITH_MULTIPLE_WRITE_INGRESSES
DUAL_SEMANTIC_AUTHORITY   = NOT_YET_PROVEN
SINGLE_INGRESS_DESIRABLE  = HYPOTHESIS_TO_TEST
```

F1 may not pre-decide the design. F1 must capture both chains, answer three
discriminators, and select one of three permitted outcomes (A/B/C, with B-prime
as a permitted not-factorizable result). The reviewer explicitly forbade
"design-before-recon" (P1 correction at F0).

## F0 residue inherited

```
P0 = NONE
P1 = NONE
P2 = 7 × blank-at-EOF in F0 evidence files (06, 08, 09, 12, 13, 14, 16)
     deferred to terminal cleanup per second-C1 reviewer
     ("the next useful learning is the F1 discriminator, not prettier EOFs")
```

F1 must NOT silently re-clean those EOFs; the residue is durable for the
duration of F1.

## Production changes

**FORBIDDEN in RECON phase.** F1 RECON produces evidence files only — no edits to
`apps/vscode/**`, `sdk/packages/**`, `webview-ui/**`, or test code. The first
production-touching step is permitted ONLY after:

1. Both chains captured (`01-normal-turn-chain.md`, `02-manual-compaction-chain.md`).
2. All three discriminator answers frozen (`03-discriminator.md`).
3. One of A / B / C / B-prime is selected with rationale.
4. A non-circular deletion predicate (see F0 §19.3) is restated for the chosen
   outcome.
5. A `RED` test is written first (RED permitted; non-test production changes
   remain FORBIDDEN until GREEN).

## Headline question (frozen)

```
FREEZE_QUESTION:
Can all host-visible W updates be composed through one semantically-correct
publication/mutation authority without changing runtime semantics?
```

This question is **non-circular**: it does not assume the answer. Outcomes A,
B, C, and B-prime are all admissible, including "no — leave the two ingresses
alone because unifying would force a wrong abstraction".

## Repository governance reminder

Per `.factory/gate-summary.json` non-authoritative state flagged by reviewer:
**do not repair** during F1. Per epic-board durability rule: every meaningful
ACT boundary updates the board; this F1 RECON entry is one such boundary and
will be appended before commit.

## Artifacts (planned, RECON phase first cycle)

F1 evidence files in `.factory/evidence/ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01/`:

```
00-preflight.txt                  (RECON preflight)
01-normal-turn-chain.md           (chain 1 — NORMAL)
02-manual-compaction-chain.md     (chain 2 — MANUAL)
03-discriminator.md               (frozen SAME_* answers + chosen outcome)
04-red-tests.md                   (post-discriminator; RED only)
05-outcome-design.md              (post-RED; chosen outcome's design notes)
06-f1-final-report.md             (closure; same shape as F0 §18)
```

This ACT body file at `.factory/acts/`. Whitelist entry added to `.gitignore`
for evidence persistence across fresh clones.

## F1 sequencing rule

Each evidence file's bottom-of-file "F1 traceability" section must:

1. Cite the F0 evidence file(s) it descends from (typically `19-closure-correction.md`
   + at most one of `01..18`).
2. Carry a heading `ENTRY_HEAD = 0debc0cc1...` and (when frozen) `FROZEN_AT = <HEAD>`.
3. End with `NEXT_EVIDENCE_FILE = <NN-name.md>` (or `END_F1_RECON` for the
   discriminator file).

This makes the F1 evidence chain durable and reviewable in isolation, without
forcing a reviewer to re-read F0 every time.

## Acceptance criteria for F1 RECON closure

```
F1_RECON_VERDICT will be one of:
  PASS_WITH_ONE_BOUNDED_OUTCOME   — outcome A/B/C/B-prime frozen, RED exists
  PASS_WITH_RESIDUE               — outcome frozen, RED exists, P2 items remain
  HOLD_FOR_RECON_REWORK           — discriminator answers reject all four
                                    outcomes (rare; means F1 question itself
                                    is wrong; revert to F0 for re-pick)
  HALT                            — production code path turned out unfixable;
                                    no F1 outcome produces a RED
```

F1's first review is gated on `03-discriminator.md` being complete and the
chosen outcome being one of A / B / C / B-prime. Any other "outcome" (e.g.
"design-before-recon with both ingresses merged silently") is by definition a
reviewer failure of the F0 P1 correction and triggers HOLD_FOR_RECON_REWORK.

## Headline chain summary (so reviewers don't have to re-read F0)

| Chain | Producer | Publication seam | Carrier ingress | Webview surface |
|---|---|---|---|---|
| Normal | `createCompactionStateAwarePrepareTurn` in `sdk/packages/core/src/extensions/context/compaction.ts` | `AgentRuntime.prepareTurnForModelRequest` → `working-context-state-changed` event → `LocalRuntimeHost.subscribeRuntimeEvents` → `apps/vscode/src/sdk/SdkController.attachCanonicalRuntimeEventSubscription` → `WorkingContextHostCapture.observe` | `observe(event)` (canonical, runtime-emit) | `getStateToPostToWebview` → `ExtensionState.currentWorkingContextEstimate` |
| Manual | `compactSessionMessages` in `apps/vscode/src/sdk/sdk-compaction.ts` | `sdk-compaction-coordinator.runCompactionInPhase` → `publishPostCompactionW` option → `SdkController.ts:1706 workingContextHostCapture.setLatest(w)` | `setLatest(estimate)` (transport-only bypass) | `getStateToPostToWebview` → `ExtensionState.currentWorkingContextEstimate` |

Both ingresses share the same carrier slot (`this._latest`) and the same
`UNDEFINED_W_STALE_REUSE = FORBIDDEN` invariant. The bypass was added by
`ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01` to drive the post-bar
update without forcing a full runtime-emit round-trip; whether that bypass is
semantically distinct from the runtime event or merely an optimization is the
core F1 question.


