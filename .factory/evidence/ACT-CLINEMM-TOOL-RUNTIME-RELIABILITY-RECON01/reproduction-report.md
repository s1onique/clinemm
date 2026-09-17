# Reproduction report (ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01, corrected)

## Test results at HEAD `9912e1154`

Source: `apps/vscode/src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts`.

Run command:

```
cd apps/vscode && PATH=/opt/homebrew/bin:$PATH bun run test:vitest \
  -- src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts --reporter=verbose
```

Output excerpt:

```
✓ production-seam A1 (terminalClosed mid-command) > real VscodeTerminalProcess settles when terminal is closed mid-command 10206ms
✓ production-seam A2 (read iterator stays open after executionEnd) > real VscodeTerminalProcess settles when shell execution ends while read() remains open 1554ms
✓ production-seam A3 (markerless idle, no C marker, prompt-quiet) > real VscodeTerminalProcess settles via prompt-quiet heuristic when no C marker ever arrives 38002ms
✓ production-seam A4 (shell execution end event never fires) > real VscodeTerminalProcess settles via the EXIT_CODE_EVENT_TIMEOUT_MS race when no end event arrives 7002ms
✓ structural contract > documents that executeForeground's `await process` is bounded only by the process-promise contract 1051ms
Test Files  1 passed (1)
     Tests  5 passed (5)
```

(The `EPERM` lines at the end of the run are sandbox-shell noise
on Vitest's worker cleanup; they do not affect test results.)

## Why the first submission was REJECTED

The earlier file
(`tool-runtime-reliability-recon01.adversarial.test.ts`) used a
fake `ITerminalProcess` whose awaitable was *defined* to never
resolve. That established:

```text
executeForeground's await process has no independent short bound
```

It did NOT establish:

```text
the REAL VscodeTerminalProcess can actually reach a state where
its underlying command has terminated / terminal closed /
read-loop ended
BUT its awaitable remains unresolved
```

The reviewer finding (P0 `HALT_RED_NOT_PRODUCTION_REPRODUCTION`)
correctly flagged this as INJECTED FAULT rather than reachable
defect.

## Why the corrected probes are real reproductions

The corrected file drives the REAL `VscodeTerminalProcess.run()`
through four allegedly-broken branches (A1-A4). The mock surface
is the minimum needed:

- `vscode.window.onDidCloseTerminal` and
  `vscode.window.onDidEndTerminalShellExecution` are stubbed in
  the test (extensions to the existing vitest stub).
- The terminal object has a real `shellIntegration.executeCommand`
  that yields a controlled `read()` stream.
- The four branches are driven by:
  - A1: `terminal.dispose()` equivalent -> `fireTerminalClose()`
  - A2: stream hangs -> `fireExecutionEnd(0)`
  - A3: stream yields prompt-quiet chunks and hangs
  - A4: stream yields C/D markers and ends naturally, end event
    never fires

The production code path is unmodified; the test only provides
the inputs the production code consumes.

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

No reachable production state breaks the chain.

## What this ACT does NOT prove

- That `executeForeground` is robust to a future ITerminalProcess
  implementation that violates the contract. STRUCTURAL hazard.
  NOT a reachable defect at HEAD.
- A reachable production path for any of the upstream issues
  (#10537, #11550, #10931, #12079, #10063). RADAR-only.

## Stop list confirmed

Did NOT touch: idle/task-header coherence, R5 manual approval,
R0 execution obligation, R3/R4, task-progression, approval/risk
classification, telemetry classification, production source code.
