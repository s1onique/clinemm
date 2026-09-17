# ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01

> Status: CLOSED (NOT_REPRODUCED)
> Owner: EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01
> Cluster: TERMINAL_COMPLETION_TIMEOUT_WAIT_LIFECYCLE
> Primary epistemic purpose: REPRODUCTION_AND_BOUNDARY_CLASSIFICATION

## Mission (verbatim from launch contract)

Find whether CURRENT ClineMM contains a deterministic production-seam
defect where a command starts successfully, either exits or reaches a
defined timeout/abort boundary, but the tool runtime fails to return
one truthful terminal result to its caller - causing the
terminal/tool execution itself to remain pending, skipped, running,
timed-out incorrectly, or otherwise unresolved.

This ACT is about INDIVIDUAL TOOL RUNTIME correctness. It is NOT
about post-tool task progression, TaskHeader / Thinking / Cancel
presentation, command approval, command-risk classification, or
telemetry mechanism/outcome classification.

## CORRECTED VERDICT

```
TOOL_RUNTIME_HAZARD = STRUCTURAL_OBSERVATION (no reachable defect proven)
UNBOUNDED_FOREGROUND_AWAIT = STRUCTURAL (real)
CASE_C_WAITER_RESOLUTION = NOT_REPRODUCED at production seam
CASE_E_FROM_UNRESOLVED_VSCODE_TERMINAL_PROCESS = NOT_REPRODUCED
GENERAL_CASE_E_REGISTRY_RESIDUE = UNTESTED / RADAR

ROOT_CAUSE_ISOLATED = NO
```

**The earlier verdict (`ROOT_CAUSE_ISOLATED`) is withdrawn.** A
reviewer (P0 `HALT_RED_NOT_PRODUCTION_REPRODUCTION`) showed that the
first recon file
(`tool-runtime-reliability-recon01.adversarial.test.ts`) was a
contract probe: it injected a fake `ITerminalProcess` whose
awaitable was simply defined to never resolve, then asserted the
executor hangs. That established only a STRUCTURAL property, not
a reachable production defect.

This ACT now drives the REAL `VscodeTerminalProcess.run()` state
machine through the four allegedly-broken branches (A1-A4). All
four branches settle. **No reachable production state leaves the
awaitable pending.**

## Scope perimeter

- IN: foreground and background tool-execution seams (run_commands
  -> executeForeground -> ITerminalProcess and CommandJobManager).
- OUT: idle/task-header coherence (CORRECTION06 CLOSED), R5 manual
  approval (WATCH_ONLY), R0 execution obligation (CLOSED), R3/R4
  (DEFER/HARDENING), command approval, telemetry classification,
  task-progression state machines.

## Production seams exercised

1. apps/vscode/src/sdk/vscode-run-commands-tool.ts
   - executeForeground(command, cwd, terminalManager, ...)
   - createVscodeRunCommandsTool(...)
2. apps/vscode/src/hosts/vscode/terminal/VscodeTerminalProcess.ts
   - run() race: stream, onDidEndTerminalShellExecution,
     onDidCloseTerminal, markerless timers
   - EXIT_CODE_EVENT_TIMEOUT_MS race (the wait seam)
   - MARKERLESS_*_TIMEOUT idle heuristics
   - continue() vs detach() semantics
3. apps/vscode/src/hosts/vscode/terminal/VscodeTerminalManager.ts
   - runCommand() reserves terminal (busy=true), releases on
     process completion (busy=false)
4. apps/vscode/src/hosts/vscode/terminal/VscodeTerminalRegistry.ts
   - Static terminal pool; removeTerminal(id), disposeTerminalsPendingCleanup()
5. apps/vscode/src/sdk/command-job-manager.ts
   - CommandJobManager.start() -> terminalPromise -> finalize() -> exitTransitions

## Recon stop point

Real completion authority = ITerminalProcess "completed" (foreground)
and CommandJobManager.finalize() (background). Real wait seam =
await process (foreground) and terminalPromise (background).
Stop recon here.

## Q1-Q8

| Q | Answer |
|---|---|
| Q1 | ITerminalProcess "completed". Foreground: await process. Background: CommandJobManager.finalize(). |
| Q2 | process: TerminalProcessResultPromise (foreground); start.terminalPromise: Promise<TerminalTransition> (background). |
| Q3 normal exit | both seams: completed/exited -> resolve -> return output. |
| Q3 nonzero exit | both seams: throw CommandExitError(exitCode, ...). |
| Q3 timeout | foreground: NO kill timeout; FOREGROUND_COMMAND_AUTO_PROCEED_MS is auto-detach. background: DEFAULT_EXECUTION_DEADLINE_MS kills the child. |
| Q3 terminal closed | foreground: CommandExitError(1, terminalClosed:true). |
| Q3 shell integration never completes | foreground: markerless fallback emits completed{unobservedCommand}; CommandExitError(1, ...). |
| Q3 background promotion | foreground: applyDetach -> detach -> formatDetachedResult. background: stays in CommandJobManager, queryable. |
| Q4 permanently-unresolved waiters at REAL seam | NO - see A1-A4 below. The earlier adversarial file manufactured this state. |
| Q5 timeout ownership | disjoint: process-kill (background deadline), wait-budget (background wait), shell-event race (foreground EXIT_CODE_EVENT_TIMEOUT_MS), auto-detach (FOREGROUND_COMMAND_AUTO_PROCEED_MS), markerless idle (MARKERLESS_*), terminal-acquisition (CWD_COMMAND_TIMEOUT_MS, shellIntegrationTimeout). |
| Q6 timeout intent | kill (background deadline), detach (foreground auto-proceed), RUNNING (background wait), failure (foreground markerless/terminalClosed/event-timeout silent). |
| Q7 who clears bookkeeping | foreground: terminalManager.runCommand clears busy on completed/error. background: CommandJobManager.finalize() removes from map. |
| Q8 stale bookkeeping reachable from real state machine | NO - production seam always emits completed OR error in every reachable branch. (Only proven for the A1-A4 paths exercised above; an independent manager bug that bypasses the completed/error signal would not be caught by these probes and remains UNTESTED / RADAR.) |

## Production-seam probes (A1-A4) at HEAD `9912e1154`

The corrected evidence file
`apps/vscode/src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts`
drives the REAL `VscodeTerminalProcess.run()` through four
allegedly-broken branches and asserts the awaitable settles.

| Branch | Real production behavior | Time to settle | Verdict |
|---|---|---|---|
| A1 terminalClosed mid-command | read loop breaks on terminalClosed; exit-code race times out; emit("completed", {terminalClosed:true}); run() resolves | 10.2s (EXIT_CODE_EVENT_TIMEOUT_MS=5s) | NOT REPRODUCED |
| A2 read iterator remains open after executionEnd | read loop breaks on executionEnd; emit("completed", {exitCode}); run() resolves | 1.5s | NOT REPRODUCED |
| A3 markerless idle, prompt-quiet | read loop breaks on idle(prompt-strong); emit("completed", {unobservedCommand}); run() resolves | 38s (MARKERLESS_IDLE_TIMEOUT=3s + MAX_QUIET_TIME=30s + EXIT_CODE_EVENT_TIMEOUT_MS=5s) | NOT REPRODUCED |
| A4 shell execution end event never fires | stream ends naturally; exit-code race times out; emit("completed", {exitCode from D-marker}); run() resolves | 7s (EXIT_CODE_EVENT_TIMEOUT_MS=5s) | NOT REPRODUCED |

All four probes PASS at HEAD. Production seam always settles.

## What IS legitimately proven

- `executeForeground`'s `await process` has NO independent bounded
  timeout. STRUCTURAL.
- Normal completion / nonzero / terminalClosed mapping through
  `executeForeground`. SYNTHETIC_REAL via fake ITerminalProcess
  (consistent with existing `vscode-run-commands-tool.test.ts`).
- Production seam is robust to the four terminal-fact branches
  exercised by A1-A4. PRODUCTION.
- Manager bookkeeping (`busy=true` -> `busy=false` on completed/error)
  is correctly bound to the seam that always fires. INFERRED from
  A1-A4 (no reachable stuck-state at the production state machine).
  This only falsifies CASE_E_AS_A_CONSEQUENCE_OF_TESTED_CASE_C_PATHS;
  a general manager-side bug that bypasses the completed/error signal
  would not be caught by these probes and remains UNTESTED / RADAR.

## What is NOT proven

- That `executeForeground` is robust to a future ITerminalProcess
  implementation that violates the contract (never emits completed
  AND never resolves its awaitable). The seam has no secondary
  race; this is the STRUCTURAL hazard. NOT a reachable defect at HEAD.
- A reachable production path that produces the user-reported
  symptoms in upstream issues #10537, #11550, #10931, #12079, #10063.
  These remain RADAR-only.
- A reachable production path that corrupts the manager's `busy`
  bookkeeping INDEPENDENTLY of the ITerminalProcess seam (general
  CASE_E). UNTESTED / RADAR.

## Causal chain (verified at the production state machine)

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

## Hard-stop rule respected

This ACT does NOT authorize a repair. The earlier "ROOT_CAUSE_ISOLATED"
verdict is WITHDRAWN. The remaining STRUCTURAL observation does NOT
rise to a defect. No repair ACT recommended.

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

## Upstream radar (RETAINED as RADAR, NOT promoted to IMPORT)

The recon still surfaces a valuable radar for upstream issues.
Promotion to IMPORT requires a future ACT that proves a reachable
production path, not just the structural hazard.

| # | Issue | Surface | Local RED at HEAD |
|---|-------|--------|-------------------|
| 10537 | terminal command succeeds, then execution/task hangs | not reproduced at the production state machine | none (regression elsewhere) |
| 11550 | accumulated terminals; later trivial commands timeout | mechanism plausible (busy leak), not reachable at HEAD | none |
| 10931 | interactive/pager waits indefinitely; terminal close loses state | A1 covers this branch; production settles | none |
| 12079 | command executes but UI records "skipped" and hangs | DEFERRED (task-progression out of scope) | none |
| 10063 | shell syntax error followed by terminal stall | not reproduced at the production state machine | none |

## Correction delta vs. earlier ACT submission

| Field | Earlier (REJECTED) | Corrected |
|---|---|---|
| Verdict | ROOT_CAUSE_ISOLATED | NOT_REPRODUCED (production seam) + STRUCTURAL_OBSERVATION (executor) |
| Test file | adversarial.test.ts (RED via injected fault) | production-seam.test.ts (real VscodeTerminalProcess probes A1-A4 + 1 structural probe) |
| CASE_C | REPRODUCED (RED-1) | NOT_REPRODUCED |
| CASE_E (from C) | REPRODUCED (RED-3) | NOT_REPRODUCED |
| CASE_E (general) | implied REPRODUCED | UNTESTED / RADAR |
| Repair ACT candidates | named | none (no defect proven) |
| Upstream radar | IMPORT-pending | RADAR-only (re-promote requires new ACT) |
| Evidence | entry-freeze, source-trace, repro, final | all retained + corrected |
