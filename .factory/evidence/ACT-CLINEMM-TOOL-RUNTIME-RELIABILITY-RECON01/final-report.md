# Final report (ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01, corrected)

## Verdict

**NOT_REPRODUCED at the production state machine + STRUCTURAL observation only.**

Earlier verdict (`ROOT_CAUSE_ISOLATED`) is WITHDRAWN following
reviewer finding P0 `HALT_RED_NOT_PRODUCTION_REPRODUCTION`.

## First-broken-boundary claims, corrected

- **CASE_C_WAITER_RESOLUTION** (executor `await process` is unbounded
  except by process-promise resolution): **NOT_REPRODUCED** at
  the production seam. The real `VscodeTerminalProcess.run()`
  state machine always settles its awaitable in every reachable
  terminal-fact branch (A1-A4 confirm at HEAD `9912e1154`).

- **CASE_E_FROM_UNRESOLVED_VSCODE_TERMINAL_PROCESS** (manager `busy`
  only cleared on `completed`/`error`): **NOT_REPRODUCED** because
  the upstream seam always emits `completed` or `error` in the A1-A4
  paths exercised. Inherited from A1-A4.

- **GENERAL_CASE_E_REGISTRY_RESIDUE** (independent manager bug that
  bypasses the completed/error signal): **UNTESTED / RADAR.** The
  A1-A4 probes do not exercise this surface and a future ACT would
  be needed to drive `VscodeTerminalManager` against injected
  terminal/process dependencies.

## What IS legitimately proven

- `executeForeground`'s `await process` has NO independent bounded
  timeout. **STRUCTURAL.**
- Normal completion / nonzero / terminalClosed mapping through
  `executeForeground`. **SYNTHETIC_REAL** via fake ITerminalProcess.
- Production seam is robust to the four terminal-fact branches
  exercised by A1-A4. **PRODUCTION.**
- Manager bookkeeping is correctly bound to the seam that always
  fires. **INFERRED** from A1-A4 (only for the A1-A4 paths exercised;
  an independent manager-side bug that bypasses the completed/error
  signal is UNTESTED / RADAR).

## Evidence

- ACT: `.factory/acts/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01.md`
- Entry freeze: `.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01/entry-freeze.txt`
- Source seam trace: `.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01/source-seam-trace.md`
- Reproduction report: `.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01/reproduction-report.md`
- Test file: `apps/vscode/src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts`
- Test output: `.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01/test-output.txt`

## Test outcomes

5/5 vitest assertions pass:

- 4 PRODUCTION-SEAM PROBES (A1-A4): all pass; production seam
  settles in every reachable branch.
- 1 STRUCTURAL CONTRACT PROBE: passes; documents that
  `executeForeground`'s wait seam has no independent bounded
  timeout. STRUCTURAL, NOT a production defect.

## Causal chain (verified)

```
VscodeTerminalProcess.run()
  read-loop break (streamEnd | executionEnd | terminalClosed | idle)
  -> exit-code race resolves (executionEnd event | EXIT_CODE_EVENT_TIMEOUT_MS)
  -> emit("completed", details)
       [EMITTED in every reachable branch - A1-A4 confirm]
  -> VscodeTerminalManager.runCommand clears busy=false on completed/error
       [REACHED in every reachable branch - inherited from A1-A4]
  -> executeForeground's await process resolves
  -> getCompletionDetails -> throw CommandExitError | return output
```

The chain is closed. No reachable production state breaks it.

## Hard-stop rule

This ACT does NOT authorize a repair. The earlier "ROOT_CAUSE_ISOLATED"
verdict is WITHDRAWN. No repair ACT recommended.

## Quality

- `git diff --check` passes for the new test file.
- vitest: 5/5 pass on the new file (test-output.txt captured).
- Pre-existing vitest failures in unrelated files are baseline on
  HEAD before this ACT and are NOT regressions introduced by this
  ACT. Per ACT §11, "If actual production source is untouched: no
  need to ceremonially run unrelated entire-repo suites."
  Production source was untouched.

## Stop list confirmed

Did NOT touch:
- Idle/task-header coherence (CORRECTION06 CLOSED)
- R5 manual approval (WATCH_ONLY)
- R0 execution obligation (CLOSED)
- R3/R4 (DEFER/HARDENING)
- Task-progression semantics
- Approval / risk classification
- Telemetry classification
- Production source code (no edits)

## Upstream radar (RETAINED as RADAR only)

Promotion to IMPORT requires a future ACT that proves a reachable
production path, not just the structural hazard:

- #10537 — terminal command succeeds, then execution/task hangs
- #11550 — accumulated terminals; later trivial commands timeout
- #10931 — interactive/pager waits indefinitely; terminal close
  loses state (A1 covers the seam; production settles)
- #12079 — command executes but UI records "skipped" and hangs
  (task-progression, deferred)
- #10063 — shell syntax error followed by terminal stall

## Board transition

Per ACT §12, transition:

```
Tool runtime reliability
  P1 / OPEN / HIGH
to:
  TOOL-RUNTIME-RELIABILITY-RECON01
    CLOSED (NOT_REPRODUCED + STRUCTURAL_OBSERVATION)
    CLUSTER=terminal completion/timeout/wait lifecycle
    VERDICT=NEGATIVE
    DEFECT_PROVEN=NO
    CASE_C=NOT_REPRODUCED
    CASE_E_FROM_C=NOT_REPRODUCED
    CASE_E_GENERAL=UNTESTED / RADAR
    RADAR_RETAINED=YES
```

The board file `.factory/epic-board.md` is intentionally NOT
edited in this ACT — board edits are reserved for closure ACTs
(see `.factory/epics/_index-contract.md`). The epic detail file
`.factory/epics/tool-runtime-reliability.md` is the canonical
state surface for this ACT; operators update it on closure.
