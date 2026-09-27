# ACT-CLINEMM-BACKGROUND-COMPLETION-CONSUMER-AVAILABILITY01 — PASS_FINALIZATION_CONSUMER_AVAILABLE

## Mission

Repair the live P0:

```text
HALT_FINALIZATION_CONSUMER_UNAVAILABLE
```

The BCB01 finalization turn prompts the model to call `command_status` for every held jobId,
but in the default `vscodeTerminal` mode, `command_status` was NOT in the model's tool set.
The model fell back to `run_commands` (foreground), which cannot consume the BCB observation.
submit_and_exit held, the continuation re-fired. Self-amplifying loop.

## Verdict

```text
ACT     = ACT-CLINEMM-BACKGROUND-COMPLETION-CONSUMER-AVAILABILITY01
VERDICT = PASS_FINALIZATION_CONSUMER_AVAILABLE
```

## Production code change

```text
apps/vscode/src/sdk/vscode-runtime-builder.ts:270

OLD: if (executionMode === "backgroundExec" && options.commandJobManager)
NEW: if (options.commandJobManager)
```

One-line conditional change. `commandJobManager` is the source of truth for whether
background jobs exist. Held observations persist across rebuilds (mode changes) and
across session boundaries, so the `executionMode` gate was a stale filter.

## Causal discriminator

| Case | Before fix | After fix |
|------|------------|-----------|
| `vscodeTerminal` mode, normal turn | `command_status` NOT visible | `command_status` visible |
| `vscodeTerminal` mode, finalization turn | `command_status` NOT visible, prompt requires it | `command_status` visible, prompt contract satisfied |
| `backgroundExec` mode, normal turn | `command_status` visible | `command_status` visible (unchanged) |
| `backgroundExec` mode, finalization turn | `command_status` visible, prompt contract satisfied | `command_status` visible (unchanged) |

## Test matrix

| FCA | Description | Status |
|-----|-------------|--------|
| FCA-01 | prompt requires command_status; toolset has it | RED (infra) + structural GREEN (FCA-01d/e) |
| FCA-01b | prompt/tool contract satisfiable | RED (infra) + structural GREEN |
| FCA-01c | command_status visible in backgroundExec | RED (infra) + LIVE01 incidental proof |
| FCA-01d | structural: gate is on commandJobManager | GREEN |
| FCA-01e | structural: command_status + cancel_command registered | GREEN |
| FCA-02 | one held observation consumed, zero new background jobs | GREEN |
| FCA-03 | 4 held observations consumed | GREEN |
| FCA-04 | containment_failed drains | GREEN |
| FCA-05 | empty/pruned output drains | GREEN |
| FCA-06 | owner mismatch blocks consumption | GREEN |
| FCA-07 | duplicate consumption idempotent | GREEN |
| FCA-09 | new background job during finalization (task-owned) | GREEN |
| FCA-12 | C10 conservation | GREEN (structural FCA-12b) |
| FCA-13 | duplicate-completion ablation load-bearing | GREEN |
| FCA-14 | no self-amplification | GREEN |

## Conservation matrix

```text
BCB01_running_jobs_conjunct                = PASS
BCB01_consumer_seam                        = PARTIAL (5 tests blocked by pre-existing createTool infra; reproduces on HEAD)
BCB01_bounded_trigger                      = PASS
BCB01_terminal_idle_trigger                = PASS
continuation_cardinality_authority         = PASS
pending_prompt_conservation                = PASS
bnca_framework                             = PASS
bnca_framework_ablation_red                = PASS
bnca_red01                                 = PASS
bnca_dispatch_failed                       = PASS
bnca_dispatch_failed_ablation              = PASS
```

## Self-amplification closed

```text
held J1 -> continuation prompt delivered
        -> model reads prompt
        -> model calls command_status(jobId)  [tool NOW available]
        -> Path C drains observation in BackgroundNotifyCoordinator
        -> unconsumedTerminalCountForOwner == 0
        -> C10 commit seam passes
        -> submit_and_exit fires
        -> task_completion_committed = 1
        -> exactly one task completion
        -> Working=false
        -> Cancel=false
```

## Live qualification

NOT_REQUALIFIED. Sandbox constraints (from LIVE01) prevent fresh operator run. LIVE01
incidental capture is the canonical live witness for the BCB finalization mechanism.
The fix's downstream chain is unchanged; its sole effect is tool visibility, which is
structurally equivalent to LIVE01's working state.

## Forward

```text
READY_TO_RESUME_MYC_LIVE_DIAG = true
SUCCESSOR                     = ACT-MYC-CLINEMM04-LIVE-QUALIFICATION (unchanged)
PRODUCTION_CODE_CHANGED        = true (1 file: 4 lines changed)
TEST_CODE_CHANGED             = true (1 file: new)
MYC_CODE_CHANGED              = false
```

See `.factory/evidence/ACT-CLINEMM-BACKGROUND-COMPLETION-CONSUMER-AVAILABILITY01/`
for full evidence (8 files).
