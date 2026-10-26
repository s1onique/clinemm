# Disposition — B2PO01 (prompt-origin correction) — PASS_STRUCTURAL_ONLY

```text
ENTRY_HEAD:                  86adc504b8f609a3f62d478750e55dcf5038cc34
SUBJECT_HEAD:                86adc504b8f609a3f62d478750e55dcf5038cc34
PREDECESSOR:                 ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
                             (PASS_STRUCTURAL_ONLY; the prompt-origin fix is ACCEPTED)
VERDICT:                     PASS_STRUCTURAL_ONLY
S2:                          RESOLVED — control-only execution IS intentionally non-active;
                             the Resume affordance provably cannot cause unsafe concurrent dispatch
S4:                          RESOLVED — a REAL P0 was FOUND and REPAIRED (the stale BCB-ownership
                             classification); a late completion could fabricate `completed` + a C10
                             for an explicitly cancelled turn
ACT_OWNED_FAILURES:          0
TYPECHECK:                   PASS (tsc --noEmit base + tsc -p tsconfig.b2po01.json, 0 diagnostics)
LINT:                        PASS (biome lint, 0 errors)
FORMAT:                      PASS (biome format, 0 files needing changes)
REGRESSION:                  NONE — full suite 5,073 tests / 4,825 passed / 193 failed;
                             the failing test-id sets are IDENTICAL to the measured baseline
                             (193 = 193, ADDED=0, REMOVED=0)
```

## What this ACT did

The review of `86adc504b` accepted the prompt-origin fix but held closure on
two new items. Both are resolved.

### S2 — the queued BCB continuation vs. the `resumable` phase

The continuation reaches the REAL model-run dispatch seam while the
committed phase stays `resumable`. The review's conditional was:

> Establish whether control-only model execution is intentionally non-active
> from the user's perspective. If so, prove the Resume affordance cannot
> cause unsafe concurrent dispatch. Otherwise, correct the phase transition
> and preserve terminal BCB convergence.

**ESTABLISHED: control-only execution IS intentionally non-active.** The
continuation prompt is brand-gated and promoted onto the model's privileged
`instructions` channel, so it is never a visible user turn; and the
BCB-hold `resumable` is the EXISTING non-running affordance that the
containment-failure hold and the cancel path also publish, already mapped by
the webview to `BUTTON_CONFIGS.resume_task`.

**PROVEN: the Resume affordance cannot cause unsafe concurrent dispatch.**
The Resume is not a direct dispatch — it takes the `queueToActiveSession`
branch and sends with `delivery: "queue"` — and the runtime refuses to drain
a queued prompt while a run is in flight, via TWO independent real
mechanisms (`drainingPendingPrompts`, and `SessionRuntimeOrchestrator.canStartRun()`).

The phase transition was therefore NOT changed, and the terminal BCB
convergence is preserved.

See `01-s2-resume-concurrency.md`.

### S4 — the actual cancellation writer / fence semantics

**A REAL P0 WAS FOUND.** The predecessor's `bcbHoldResumablePublished` flag
was documented as "cleared by EVERY other phase write", but the production
CANCEL path writes the phase DIRECTLY to the `TurnStateTracker`
(`SdkController.cancelTask` -> `turnStateTracker.setWithWriter("resumable",
..., "controller-cancel-task")`), never through the coordinator. The flag
therefore survived the cancel and described the CANCEL's `resumable`. With
the flag stale-true the turn-complete straggler guard was DISABLED, and a
late completion could:

- re-publish the BCB hold after an explicit cancellation, and
- once the held obligation drained, **COMMIT `completed` and a C10
  `task_completion_committed` for a turn the user explicitly cancelled**.

Both shapes were reproduced at the REAL production seam and are now fixed by
deriving the classification from the AUTHORITATIVE committed WRITER IDENTITY
(`TurnStateTracker.currentWriterId`), which is replaced in the SAME mutation
as the committed phase and can therefore never go stale.

The epoch fence alone was NOT sufficient: it secures the B2 BCB-hold guard
(the barrier's identity triple stops matching) but not the turn-complete
straggler guard, which reads only the committed phase and the
coordinator-private flag.

See `02-s4-cancellation-writer-fence.md`.


## The witnesses (8, all GREEN)

| id | file | proves |
| --- | --- | --- |
| S1 | `post-terminal-working-cancel-b2-prompt-origin01.b2po01.test.ts` | BCB held, no new run -> `resumable`, never a false Working |
| S2 | same | the REAL queued continuation reaches the dispatch seam while the phase stays `resumable` |
| S2c | same | the concurrency OUTCOME: the Resume is QUEUED, never dispatched concurrently, and drains SERIALLY after the control run ends |
| S2d | same | the runtime's own `canStartRun()` in-flight gate alone refuses a concurrent dispatch |
| S3 | same | an INDEPENDENT user prompt's legitimate activation is NOT indefinitely hidden |
| S4 | same | the ACTUAL production cancellation sequence; the late completion writes NO phase |
| S4a | `post-terminal-working-cancel-b2po01-s4-cancel-fence.test.ts` | the same sequence through the REAL `SdkTaskControlCoordinator`; the fence is raised BEFORE the abort; the cancellation straggler guard is ACTIVE |
| S4b | same | the SEVERE shape (the held obligation drains): NO `completed`, NO C10 |

### Load-bearing ablations (each run and recorded)

| ablation | result |
| --- | --- |
| the S4 repair reverted | S4a RED (`expected [ { phase: 'resumable', …(1) } ] to have a length of +0 but got 1`) and S4b RED (`expected [ { phase: 'completed', …(1) } ] to have a length of +0 but got 1`) |
| the runtime `canStartRun()` gate disabled | S2d RED (`expected "vi.fn()" to not be called at all, but actually been called 1 times`) |

## The verification method (recorded so it is reproducible)

```bash
# 1. BASELINE — stash ONLY this ACT's paths, run, restore.
git stash push -u -m '<act>-baseline-probe' -- <the act-owned paths>
node node_modules/.bin/vitest run --config vitest.config.ts --pool=threads \
  --reporter=json --outputFile=/tmp/baseline.json
git stash pop

# 2. AFTER — the same command.
node node_modules/.bin/vitest run --config vitest.config.ts --pool=threads \
  --reporter=json --outputFile=/tmp/after.json

# 3. COMPARE — a per-test-id set difference of the two JSON reports.
#    NEVER grep the console output; NEVER infer from a truncated log.
```

**The runtime note.** The default forks pool aborts the run in this sandbox
with `kill EPERM`, and the Bun runtime SEGFAULTS (`panic: Segmentation
fault`) before the JSON report is written. The measurements above were
therefore taken with the Node runtime from the nix store
(`/nix/store/8cbb8r8mkaz6z7si022ks2b78qqy9sz4-nodejs-slim-24.19.0/bin/node`,
v24.19.0) and `--pool=threads`. This is a SANDBOX artifact, not a test
failure, and it is recorded rather than masked.


## The full-suite comparison

Because this ACT CHANGES production semantics (the straggler guard), the
full-suite comparison was re-measured, as the review permits.

| | total | passed | failed | suites |
| --- | --- | --- | --- | --- |
| baseline (this ACT's paths stashed) | 5,073 | 4,825 | **193** | 1,790 |
| after | 5,073 | 4,825 | **193** | 1,790 |

Per-test-id set difference:

```text
ADDED failures (regressions): 0
REMOVED failures (fixed):     0
IDENTICAL SETS:                True
```

The 193 pre-existing failures are the environment's baseline (the seatbelt /
darwin-kernel suites, the command-job-manager suites, `sdk-task-history`, and
the `host-blocked-outcome-*` suites). They are NOT ACT-owned and were left
untouched.

The DIRECTLY AFFECTED conservation sweep (the two predecessor suites, the
pinned TPC01 contract suite, the coordinator suite, the C9-C10 conservation
suite, the two writer-provenance suites, and the cancel-liveness suite) was
measured separately against its own stashed baseline:

| | total | passed | failed |
| --- | --- | --- | --- |
| focused baseline | 184 | 181 | **3** |
| focused after | 184 | 181 | **3** |

```text
ADDED:  []      REMOVED: []      IDENTICAL: True
```

The 3 focused failures are pre-existing and reproduce identically with this
ACT's production paths stashed:
`sdk-session-event-coordinator.test.ts :: CPL02`,
`sdk-session-event-coordinator.test.ts :: OWN01 RED`, and
`turn-state-writer-provenance.wprov.test.ts :: WPROV07.1`.

## The environment limitation is recorded, not masked

No VSIX was built or installed and no LIVE re-run of the incident was
performed, so the closure is `PASS_STRUCTURAL_ONLY`, NOT `PASS_LIVE`.
Claiming a LIVE verdict would require a LIVE re-run of the incident
scenario, which this ACT did not perform.

## Production changes

- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` — the prompt-origin
  discriminator (the `runtimeControlKind` guard) and the S4 stale-flag
  repair.
- `apps/vscode/src/sdk/turn-state-tracker.ts` — the committed writer
  identity (`currentWriterId`), replaced in the same mutation as the
  committed phase.
- `apps/vscode/src/sdk/SdkController.ts` — the `getTurnPhaseWriterId`
  wiring.
- `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` —
  the `runtimeControlKind` origin discriminator is preserved across the
  queue round-trip and the event boundary.
- `sdk/packages/core/src/types/events.ts` — the
  `SessionPendingPromptSubmittedEvent.runtimeControlKind` field.
- `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts` and
  `sdk/packages/core/src/hub/server/handlers/session-event-projector.ts` —
  the hub transport forwards the discriminator.

No Elm kernel, no protocol, no webview reducer, no schema.
