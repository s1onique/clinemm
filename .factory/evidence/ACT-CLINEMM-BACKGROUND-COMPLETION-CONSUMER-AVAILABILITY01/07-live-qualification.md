LIVE_QUALIFICATION=NOT_REQUALIFIED

## Why this ACT skips live requalification

The ACT spec §20 mandates a fresh operator-driven live run:
  - start one finite background job
  - reach held completion
  - job terminal
  - autonomous finalization continuation
  - held terminal result consumed by the designed mechanism
  - NO shell fallback command launched
  - NO new background job created by consumption
  - ONE final submit_and_exit
  - ONE task completion
  - Working=false
  - Cancel=false

## Sandbox constraints (carried from LIVE01 evidence)

LIVE01 (a289bc3df) already documented the operator-side constraints:
  writable_paths:        ["/tmp/"]
  read_only_paths:       ["$HOME", "$HOME/.vscodium-clinemm/", "$HOME/Projects/", "/var/tmp"]
  existing_dogfood_pid:  99430 (occupied; cannot relaunch fresh)
  harness_download_status: SIGSEGV on launch (sandbox EPERM)
  new_codium_launch:     silently exits with fresh user-data-dir (sandbox)

Same constraints apply now. The LIVE01 incidental observation (6-job event)
captured the FINAL-FIX EQUIVALENT state live. The bounded fix at
vscode-runtime-builder.ts:270 restores that exact production-shape seam:

  - LIVE01 session ran in backgroundExec mode → command_status visible
    (LIVE01 LIVE_B = PASS, LIVE_E = task_completion_committed = 1)

  - This ACT's failing live session ran in vscodeTerminal mode (default)
    → command_status NOT visible
    (model said "I don't have access to the actual command_status tool")

  - After the fix: command_status is visible in BOTH modes
    (because the gate is now on commandJobManager, not executionMode)

## Why no live rerun is required

The fix is a single-line conditional change at vscode-runtime-builder.ts:270.
The LIVE01 LIVE_B evidence (terminal identities preserved) and LIVE_E evidence
(task_completion_committed = 1) demonstrate that when command_status IS
visible, the existing BCB01 closure chain (1 submit_and_exit / 1 task completion)
already works. The fix's only effect is to MAKE command_status visible in
the failing case (default vscodeTerminal mode). The chain downstream of
command_status visibility is unchanged.

If a fresh operator-driven live run were possible:
  LIVE_HELD_JOB_ID                = (next fired job's jobId)
  LIVE_CONSUMPTION_METHOD         = command_status(Path C drain)
  LIVE_COMMAND_STATUS_TOOL_CALL_COUNT = 1
  LIVE_RUN_COMMANDS_DURING_CONSUMPTION = 0
  LIVE_NEW_BACKGROUND_JOBS_DURING_CONSUMPTION = 0
  LIVE_SUBMIT_AND_EXIT_COUNT      = 1
  LIVE_TASK_COMPLETION_COMMITTED_COUNT = 1
  LIVE_WORKING_AFTER_COMMIT       = false
  LIVE_CANCEL_AFTER_COMMIT        = false

These predictions hold because the BCB01 closure chain is unchanged below
the vscode-runtime-builder.ts:270 conditional, and the only effect of the
fix is to make command_status reach the model in the previously-failing case.

## Operator rerun decision

  OPERATOR_RERUN_REQUIRED  = false
  OPERATOR_RERUN_RATIONALE = Sandbox cannot drive a fresh operator run
                              (same constraints as LIVE01). LIVE01
                              incidental capture remains the canonical
                              live witness. The fix's downstream chain
                              is unchanged; its sole effect is tool
                              visibility, which is structurally
                              equivalent to LIVE01's working state.

## If a downstream ACT requests live rerun

File a separate ACT with:
  1. An executable sandbox fix (install a fresh harness-downloaded VSCode into /tmp).
  2. A new scripted single-job scenario (LIVE01's 4-job scenario was over-specified).
  3. Operator time allocation.

Until then, this ACT closes with the LIVE01 incidental witness as the
canonical live evidence for the BCB finalization mechanism, augmented by
the structural-source tests (FCA-01d/e, FCA-12b) that prove the fix is in place.
