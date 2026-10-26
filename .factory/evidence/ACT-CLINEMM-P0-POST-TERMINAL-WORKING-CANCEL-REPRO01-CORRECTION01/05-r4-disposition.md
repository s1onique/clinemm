# R4 — Disposition: PASS_STRUCTURAL_ONLY

## Verdict

```text
ENTRY_HEAD:                  674bdd43bdb391f36f069c75476ce491d370cf79
SUBJECT_HEAD:                674bdd43bdb391f36f069c75476ce491d370cf79
INCIDENT:                    1792958891945_k2wrd / epoch 12
VERDICT:                     PASS_STRUCTURAL_ONLY
P0_RED_REPRODUCED:           YES (predecessor) -> REPAIRED (this ACT)
REPAIR_GREEN:                9/9 in the CORRECTION01 suite; 15/15 in the predecessor suite
TYPECHECK:                   PASS (bun run check-types; 0 diagnostics)
LINT:                        PASS (biome, 2400 files, 0 errors)
FORMAT:                      PASS (biome, 0 errors)
GIT_DIFF_CHECK:              PASS (0 whitespace errors)
FULL_SUITE:                  5,073 tests — 4,825 passed, 193 failed
BASELINE (same command):     5,064 tests — 4,816 passed, 193 failed
REGRESSIONS:                 ZERO — the failing test-id sets are IDENTICAL (248 = 248)
ACT_OWNED_FAILURES:          0
LIVE_CLAIM:                  NONE (no VSIX built / installed; no live re-run)
```

**`PASS_STRUCTURAL_ONLY`, NOT `PASS_LIVE`.** The repair is proved at the REAL
production seam (the REAL `SdkSessionEventCoordinator`, the REAL
`TurnStateTracker`, the REAL `MessageTranslatorState`, the REAL Elm projection
kernel and the REAL webview button selector), but no VSIX was built or installed
and no LIVE re-run of the incident was performed. The LIVE claim remains
outstanding.

## Why `PASS_STRUCTURAL_ONLY` and not a live verdict

- The extension build toolchain (esbuild bundle, VSIX packaging) and the
  LIVE host (the `.vscodium-clinemm` capture root) were not exercised in this
  ACT.
- The predecessor's LIVE evidence (the frozen capture root) was READ and
  re-verified, but no new LIVE capture was produced.
- Claiming a LIVE verdict would require a LIVE re-run of the incident
  scenario, which this ACT did not perform.

## The repair, in one paragraph

The LIVE defect had TWO load-bearing boundaries, established by the predecessor
and re-verified in this ACT's R0: the BCB hold path published NO phase, and the
`pending_prompt_submitted` writer re-asserted `streaming` unconditionally. The
repair closes BOTH: **B1** the BCB hold path now publishes the EXISTING
truthful non-running `resumable` phase (the "the run was abandoned" affordance
already used by the containment-failure hold and by the cancel path) through a
NEW writer identity `session-event-bcb-hold-resumable`; **B2** the
`pending_prompt_submitted` writer no longer re-asserts `streaming` while the
deferred-completion BARRIER holds the active turn's completion, discriminated by
the EXISTING BCB barrier authority (the `sessionId` / `taskId` / `epoch`
identity triple) — NOT by the phase and NOT by the runtime status. The BCB
HOLD, the Elm completion authority, the containment guards and the epoch
identity triple are all UNTOUCHED. NO `completed` is fabricated, NO new phase
is introduced, and the barrier's own release path
(`reevaluateDeferredCompletionBarrier`) remains the ONLY writer of a terminal
phase for the held obligation.

## The two deviations from the predecessor's proposal (both REQUIRED)

1. **The proposal's boundary 2 was NOT implemented literally.** The proposal
   said the pending-prompt writer should not re-assert `streaming` "over a
   terminal phase". Implemented literally, that breaks the PINNED T-08a
   contract (`completed -> streaming` on `pending_prompt_submitted`), which is
   verified by `turn-phase-contract01.tpc01.test.ts` (60 tests, all GREEN). The
   CORRECTION01 suite's own first-draft assertion carried that literal
   reading; **the TEST was corrected, not the production code**, and the
   corrected pair (R1-06 + R1-06b) is STRICTLY STRONGER than the original.

2. **The straggler guard had to learn the CAUSE of a `resumable`.** The
   turn-complete straggler guard keys on the PHASE VALUE `resumable` to
   preserve a CANCEL-set `resumable`. B1's `resumable` has a different cause,
   and the guard could not tell them apart, so it swallowed the entire
   completion-commit path (12 of the 22 regressions found by the full-suite
   baseline diff). The coordinator now tracks WHICH writer published the
   committed `resumable`. See `03-r2-blast-radius-and-the-straggler-guard.md`.

## The production files changed

| File | Change |
|---|---|
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | B1 (the BCB-hold `resumable` publish, guarded against a typed blocked verdict), B2 (the barrier-hold guard on the `pending_prompt_submitted` write), the `bcbHoldResumablePublished` cause-discrimination for the straggler guard |
| `apps/vscode/src/shared/turn-state-writer-provenance.ts` | the NEW writer identity `session-event-bcb-hold-resumable` in the closed `TurnStateWriterId` union |
| `apps/vscode/src/sdk/turn-phase-contract.ts` | the new writer mapped to the `resumable` phase in the writer-identity -> phase ownership map (the TPC01 G0 completeness gate) |

## The test files changed

| File | Change |
|---|---|
| `apps/vscode/src/sdk/__tests__/post-terminal-working-cancel-correction01.ptwcr01c01.test.ts` | NEW — the 9-test safety RED that had to go GREEN |
| `apps/vscode/src/sdk/__tests__/post-terminal-working-cancel-repro01.ptwcr01.test.ts` | the predecessor's RED suite, reconciled in place (4 assertions inverted; test ids and causal roles preserved) |
| `apps/vscode/src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01.test.ts` | 2 assertions inverted (RED-01, RED-02) |
| `apps/vscode/src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01-cons.test.ts` | 2 assertions inverted (CONS-01, CONS-03) |
| `apps/vscode/src/sdk/__tests__/completion-presentation-authority01.cpa01.test.ts` | 1 assertion inverted (CPA-10) |
| `apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts` | 1 assertion inverted (HBCLO-20) |
| `apps/vscode/src/sdk/__tests__/host-blocked-outcome-publication01.hbop01.test.ts` | 1 assertion inverted (HBOP-03) |

In EVERY inverted test, the load-bearing conservation invariant is preserved
verbatim: no `completed` is fabricated, ZERO C10 `task_completion_committed`
records, no authoritative completion display, and the deferred marker is
PRESERVED. See `04-r3-inversion-ledger.md`.

## The verification method (recorded so it is reproducible)

```bash
# 1. BASELINE — stash ONLY this ACT's files, run, restore.
git stash push -u -m '<act>-baseline-probe' -- <the act-owned paths>
bun x vitest run --config vitest.config.ts --pool=threads \
  --reporter=json --outputFile=/tmp/baseline.json
git stash pop

# 2. AFTER — the same command.
bun x vitest run --config vitest.config.ts --pool=threads \
  --reporter=json --outputFile=/tmp/after.json

# 3. COMPARE — a per-test-id set difference of the two JSON reports.
#    NEVER grep the console output; NEVER infer from a truncated log.
```

`--pool=threads` is used because the sandbox's `kill EPERM` on the default
forks pool can abort a run before the JSON report is written. That is a
SANDBOX artifact, not a test failure.

## The 193 pre-existing failures (baseline, NOT caused by this ACT)

Identical before and after, by test id. The largest contributors are the
seatbelt / darwin-kernel suites (`darwin-seatbelt-*`, `seatbelt-*`), the
command-job-manager suites, `sdk-task-history`, and the
`host-blocked-outcome-*` suites. They are NOT ACT-owned and were left
untouched. The pre-existing baseline is the predecessor's recorded baseline
plus whatever the environment contributes; the ACT's obligation is that its own
change adds ZERO to it, and it does not.
