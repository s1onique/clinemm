# ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01 — PASS_NONTERMINAL_COMMAND_RESULT_CLASSIFICATION_PRELIVE — 2026-10-09

**Status:** CLOSED with verdict `PASS_NONTERMINAL_COMMAND_RESULT_CLASSIFICATION_PRELIVE` after a bounded single-source repair. The fix is targeted at the `command_status` tool's projection-reconciliation seam; it is NOT a new architecture, no new Elm kernel, no protocol migration. The P0-B post-turn presentation defect remains open and is the explicit successor.

## C0 — Repository trust and exact-source baseline

```
$ git status --short
 M apps/vscode/src/sdk/command-status-tool.ts
 M apps/vscode/src/sdk/vscode-runtime-builder.ts
?? apps/vscode/src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts

$ git rev-parse HEAD
050641f5e343df48f5b42c8a28f0725d1cbfe1e5

$ git log -12 --oneline
050641f5e docs(epic-board): SEAM04-CORRECTION01 precise labels + dual-path contract
05a3e035b docs+test(SEAM04): add OBL-07..08 dual-path contract tests + precise labels
e2b508b46 docs(epic-board): SEAM04-CORRECTION01 entry with obligation-conservation + adversarial fixes + P0 hygiene
f04e0104d docs(SEAM04): CORRECTION01 closure artifact — obligation conservation, adversarial fixes, hygiene
03f055a96 test(SEAM04): CORRECTION01 P0 obligation + P1 adversarial + P2 hygiene
ab6fbc225 fix(frontend): synchronize npm lockfile (unplugin ^3.4.0 root hoist)
7e9942523 docs(SEAM04): closure artifacts — ACT plan + epic board PASS entry
2943c3a8a test(SEAM04): BNACUT04 production-seam matrix (C3/C4/C6/C7/C8 evidence)
9d03e8707 test(elm): SEAM04 async consumeTerminal migration — await call sites + drainNotifyJob/driveNotifyTerminal
4c3577be5 fix(elm): SEAM04 background-notify-authority C7 production cutover
0c12ba41b fix(elm): SEAM04 background-notify-authority C2 correlation protocol + C11 production kernel path wiring
42d6381f0 feat(elm): SEAM03 background-notify-authority substrate (PASS_ELM_SEAM03_SUBSTRATE)

$ git stash list
stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration

$ git diff --check
(no output — exit 0)
```

PROTECTED_STASH: `stash@{0}` is the protected Tart stash historically anchored at `d46223b51` (`git log -1 --oneline d46223b51` confirms). The stash contents are the tart-testbed lifecycle tooling (`tools/macos-host-helper/native/{build.sh,helper.c,helper.test.ts,tart-testbed-run.test.ts}`) — completely separate from the P0-A fix scope. The stash is preserved untouched (operator owns the protected Tart branch and will pop / apply independently).

No tracked dirt: clean worktree aside from the ACT-owned deltas.

### C0.1 — Source binding (LIVE_SOURCE_UNBOUND)

```
SCREENSHOT_DATE: 2026-10-09
COMMAND_JOB_ID: cmd_mv0l6blcq0mavibu

INSTALLED_EXTENSION:
  version: NOT_BOUND
  source_head: NOT_BOUND
  vsix_sha256: NOT_BOUND
  identity_evidence: (no installed source binding in the captured specimen)

ENTRY_HEAD: 050641f5e
WORKTREE: /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
PROTECTED_STASH: stash@{0} (d46223b51)
```

The screenshot is LIVE symptom evidence but the installed extension identity was not bound by the operator. The C2-class structural RED below proves the defect is independent of the installed source — the production seam (`command_status` tool → projection reconciliation) was reproducibly desynced against the canonical `CommandJobManager.status()` observation on the current pre-repair HEAD.

## C1 — Production classification boundary

The `run_commands` / `command_status` pipeline is:

| Boundary               | File:symbol                                                     | Behavior under pre-repair                                             |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Job state owner        | `command-job-manager.ts:851` `snapshot(job)`                    | `state: "running"` after `start()` returns; the canonical terminal fact |
| Observation tool       | `command-status-tool.ts:137` `createCommandStatusTool`           | `manager.status({jobId, waitMs:0})` → `{ok, snap}`                    |
| Tool result envelope   | `command-status-tool.ts:347-367` return shape                    | `{ok, jobId, state, elapsedMs, deadlineRemainingMs, stdout, stderr, ...}` |
| Transcript projection   | `message-translator.ts:1240` `isBackgroundedCommandOutput`       | `command_status` tool result renders as a generic `tool` say message   |
| Chat row state         | `webview-ui/src/components/chat/ChatRow.tsx:294` `liveProjectionValue` | `backgroundCommandJobStates[jobId]` is the source of the pill         |
| Renderer predicate     | `webview-ui/src/components/chat/CommandOutputRow.tsx:367`        | `containment_failed` → `"Run failed"` pill                            |
| Runner start signal    | `vscode-run-commands-tool.ts:879` `notifyBackgroundStateChange(true, start.jobId)` | Sets `backgroundCommandJobStates[J] = "running"`        |
| Runner terminal signal | `vscode-run-commands-tool.ts:902-904` `terminalPromise.then(...)` | Sets `backgroundCommandJobStates[J] = terminalState`                  |
| Runner catch signal    | `vscode-run-commands-tool.ts:1034-1037`                          | Same, for `CommandExitError` / `spawn_failed`                          |
| Host projection sink   | `SdkController.ts:5282-5297` `updateBackgroundCommandState`      | Writes the per-job map; short-circuits no-op when scalar+taskId unchanged |
| Webview display        | `webview-ui/src/components/chat/CommandOutputRow.tsx:259-266`     | `getCommandStatusText(... liveProjectionTerminalReason)`              |

### Recon artifact (source-backed)

```
JOB_STATE_OWNER:
  file: apps/vscode/src/sdk/command-job-manager.ts:851
  symbol: snapshot(job)

OBSERVATION_BOUNDARY:
  file: apps/vscode/src/sdk/command-job-manager.ts:2797
  symbol: status({jobId, waitMs})
  initial_wait_ms: 0 (clamped to MAX_STATUS_WAIT_MS=30_000)
  execution_deadline_ms: DEFAULT_EXECUTION_DEADLINE_MS=600_000

TOOL_RESULT_OWNER:
  file: apps/vscode/src/sdk/command-status-tool.ts:347
  symbol: tool execute() return envelope
  envelope: {ok, jobId, state, elapsedMs, deadlineRemainingMs, stdout, stderr, outputTruncated, ...}

TRANSCRIPT_CLASSIFIER:
  file: apps/vscode/src/sdk/message-translator.ts (no special-case for command_status tool result; renders as a generic tool result message)

REACT_PRESENTATION:
  file: apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx:367
  symbol: CommandStatusMap.containment_failed
  pill_text: "Run failed"

FIRST_POSSIBLE_DIVERGENCE:
  The `command_status` tool returns the canonical snapshot from
  `CommandJobManager.status()`. The chat row's `liveProjectionValue` reads
  from `backgroundCommandJobStates[jobId]` (the per-job projection map
  maintained by `SdkController.updateBackgroundCommandState`). The two
  values CAN diverge when the projection map is written by a terminal
  listener at the runner seam (`vscode-run-commands-tool.ts:902-904,
  1034-1037`) without a corresponding snapshot update — e.g. a
  one-shot `command_job_containment_failed` lifecycle emit that fires
  while the job is still alive, or a stale terminal write that survived
  a session/task boundary. The `command_status` tool was the
  canonical nonterminal observation seam but did NOT reconcile the
  projection on a `state: "running"` observation.
```

## C2 — Real production-seam RED

**Test file:** `apps/vscode/src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts` (new, 5 tests)

The test uses the same `spawnFactory` DI seam as `background-command-terminal-card-projection01.bctcp01-runner-seam.test.ts` to drive a real `CommandJobManager.start` + real `createVscodeRunCommandsTool` + real `createCommandStatusTool` composition without spawning a real subprocess (the env cannot kill real processes; see C7).

### RCNC-01 — the original contradiction (RED on pre-repair)

```
test setup:
  - real createVscodeRunCommandsTool() via the BCTCP-01 runner-seam harness
  - real CommandJobManager with fake supervisor (spawnFactory DI)
  - start a long-running job (sleep 30), backgrounded mode
  - simulate the LIVE-specimen desync: write
    projection[jobId] = "containment_failed"  (the "Run failed" pill text)
  - call createCommandStatusTool().execute({jobId, waitMs: 0})

assertions:
  - statusResult.state === "running"            ✓ (manager says alive)
  - statusResult.jobId  === jobId               ✓
  - onRunningObservedSpy called with (jobId)   ✗ RED on pre-repair
  - projection[jobId]   === "running"           ✗ RED on pre-repair
```

**Pre-repair run output (verbatim from `bun vitest run`):**

```
× RCNC-01: a nonterminal command_status observation reconciles a stale terminal projection back to running
AssertionError: expected "vi.fn()" to be called with arguments: [ 'cmd_mv107d280lm70f58' ]
```

The spy assertion failure is the canonical RED witness: on the pre-repair surface, the `command_status` tool's `execute()` body has no `onRunningObserved` callback seam, so the production `SdkController.updateBackgroundCommandState` is never called for the nonterminal observation, and the chat row's `Run failed` projection persists even after the canonical `status()` says `state: "running"`.

The 4 other tests in the matrix are GREEN regardless of the fix (RCNC-02/04/05/06 pin pre-existing behavior that the fix must NOT disturb).

### Conservation matrix

| Test                       | What it pins                                                                      | Pre-repair | Post-repair |
| -------------------------- | -------------------------------------------------------------------------------- | ---------- | ----------- |
| RCNC-01 (this ACT's RED)    | The original contradiction: `command_status` reconciles a stale terminal projection | RED       | GREEN       |
| RCNC-02 (conservation)     | Real command failure: `command_status` on a terminal `exited` job does NOT flip the projection back to `running` | GREEN     | GREEN       |
| RCNC-04 (conservation)     | Terminal publication: a final terminal observation publishes once; projection reconciles to `terminal`, not flipped back to `running` by a later nonterminal call | GREEN     | GREEN       |
| RCNC-05 (conservation)     | Cancellation: `cancel()` produces `cancelled`; `command_status` does NOT re-flip the projection to `running` | GREEN     | GREEN       |
| RCNC-06 (conservation)     | Initial-wait vs execution-deadline: the fix does NOT change the wait budget / execution deadline semantics | GREEN     | GREEN       |

All 5 tests GREEN after the bounded fix; only RCNC-01 is RED on the pre-repair surface.

## C3 — Causal discriminator

**Classification: PROJECTION_DESYNC.**

A nonterminal `command_status` observation (manager snapshot `state: "running"`) coexists with a stale terminal write on the per-job projection map (e.g. a one-shot `command_job_containment_failed` lifecycle emit that fired while the job was actually still alive, or a stale terminal write that survived a session/task boundary). The chat row's `liveProjectionTerminalValue` reads the stale terminal value from the projection map and renders the `Run failed` pill (the `CommandStatusMap.containment_failed === "Run failed"` literal at `apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx:367`), even though the latest canonical observation says `state: "running"`.

The other causal discriminators were ruled out:
- `RUNNER_STATUS_WRONG`: ruled out. The runner's `terminalPromise.then` listener at `vscode-run-commands-tool.ts:902-904` fires only after `finalize()` mutates `job.state`. The captured payload's `state: "running"` (elapsedMs 15001) is from a `command_status` observation AFTER any such terminal write — the runner cannot have written a terminal value that the manager would disagree with.
- `TOOL_ENVELOPE_WRONG`: ruled out. `command_status` returns the manager's `snapshot` verbatim (`command-status-tool.ts:347-367`). The tool's result correctly says `state: "running"`.
- `TRANSCRIPT_CLASSIFICATION_WRONG`: ruled out. The transcript of the `command_status` tool result renders as a generic `tool` say message; no specialized projection classifier would misclassify a `state: "running"` snapshot.
- `REACT_PRESENTATION_WRONG`: ruled out. The `liveProjectionValue` lookup in `ChatRow.tsx:284-293` is mechanically correct; it reads exactly what the projection map holds. The map is the source of the bug, not the read.
- `OBSERVATION_FAILURE_REAL`: ruled out. The `command_status` tool result is a genuine, in-band observation of a real CommandJob — the desync is between the runner-driven projection and the manager's truth.
- `JOB_STATE_UNOBSERVABLE`: ruled out. `manager.status()` returned a stable `state: "running"` snapshot.

**Authorized repair: the per-call `onRunningObserved(jobId)` callback in the `command_status` tool, wired from `vscode-runtime-builder.ts` to the existing `onBackgroundStateChange` callback, which the production `SdkController.updateBackgroundCommandState` already maps to the per-job projection map (idempotent — already-running entries are a no-op via the `didProjectionChange` short-circuit at `SdkController.ts:5308-5314`).**

## C4 — Semantic result contract (frozen, no migration)

The contract table is the existing `backgroundCommandJobStates` map type, which the bounded fix does NOT change:

| Command evidence                           | Permitted classification                            |
| ------------------------------------------ | --------------------------------------------------- |
| Running, valid job ID, no terminal outcome | Nonterminal / `running`                             |
| Completed, exit code 0                     | Completed (`exited`)                                |
| Failed, verified nonzero exit or failure   | Failed (`exited` with non-zero exitCode, `spawn_failed`, `deadline_exceeded`, `cancelled`) |
| Cancelled, cancellation confirmed          | Cancelled (`cancelled`)                             |
| Terminal state unknown                     | Indeterminate (`unknown`)                           |
| Tool invocation failed, job still running  | Invocation error plus retained running-job identity (`running` projection preserved) |

The existing `Exclude<CommandJobState, "running">` terminal-state union in `SdkController.ts:1253` and `updateBackgroundCommandState`'s `terminalState` parameter at line 5253 are NOT widened. The new `onRunningObserved?: (jobId: string) => void` option on `CreateCommandStatusToolOptions` is OPTIONAL — pre-fix code that calls `createCommandStatusTool(manager, {backgroundNotifyCoordinator, resolveActiveOwner})` continues to compile and behave identically. The fix is a single new function-shape field plus a single guarded call site.

This is NOT a protocol migration. The webview's `backgroundCommandJobStates` field shape, the proto wire, the chat row's `liveProjectionValue` computation, and the existing Path A / B / C / C' terminal drains in `command-status-tool.ts` are all unchanged.

`HALT_COMMAND_RESULT_CONTRACT_INSUFFICIENT` did NOT trigger — the existing contract is sufficient. The defect is in the runtime reconciliation of an existing field.

## C5 — Bounded repair

The fix is a 67-line delta across 2 production files. No new files, no protocol changes, no Elm kernel.

### Production delta (67 lines, 2 files)

```
apps/vscode/src/sdk/command-status-tool.ts    | 48 +++++++++++++++++++++++++++
apps/vscode/src/sdk/vscode-runtime-builder.ts | 19 +++++++++++
```

**`apps/vscode/src/sdk/command-status-tool.ts`** — add the `onRunningObserved` option to `CreateCommandStatusToolOptions` and call it on a `state: "running"` snapshot inside `execute()`. The call is fire-and-forget (no awaited promise) so the tool's return payload is not blocked on the projection reconciliation; the next `getStateToPostToWebview()` post picks up the change.

**`apps/vscode/src/sdk/vscode-runtime-builder.ts`** — thread the host's `onBackgroundStateChange` callback into the `command_status` tool's `onRunningObserved` seam. A nonterminal observation now reconciles the per-job projection map from any stale terminal value back to `running`.

### Conservation properties (per ACT §6)

| Invariant                                                         | Required result                                                       | Verified by       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------- |
| Nonterminal running response NOT fabricated as terminal failure   | RCNC-01 GREEN (projection reconciled)                                  | RCNC-01           |
| Real command failure still reports as failed                       | RCNC-02 GREEN (`command_status` on `exited` does NOT fire `onRunningObserved`) | RCNC-02           |
| Cancellation still distinguished from success                      | RCNC-05 GREEN (`cancelled` projection preserved)                      | RCNC-05           |
| Repeated observation of J — no duplicate job identity               | The callback is idempotent (re-asserts the same `running` projection; `updateBackgroundCommandState` short-circuits via `didProjectionChange` at `SdkController.ts:5308-5314`) | by inspection     |
| Session/task replacement — no stale update                          | `updateBackgroundCommandState` is keyed on the passed `jobId`; a job that has been evicted from the active set has no entry in `backgroundCommandJobStates`, so a re-assert cannot resurrect a phantom entry | by inspection     |
| Unconsumed terminal observation — never silently acknowledged        | The `onRunningObserved` callback fires ONLY for `state: "running"`; terminal observations pass through unchanged and the existing Path A / B / C / C' terminal drain is the terminal authority | RCNC-02 / 04 / 05  |
| Completion attempt — no fabricated `task_completion_committed`      | The callback does not touch `taskState`, `turnPhase`, or the completion-barrier; it ONLY re-asserts the per-job projection map | by inspection     |
| Genuine final observation — existing owner can consume the result  | RCNC-04 GREEN                                                          | RCNC-04           |
| Stall/REARM semantics unchanged                                    | The fix does not touch `STALL`/`REARM`/Completion Authority / `taskState` | by inspection     |
| Background-notify exactly-once delivery semantics unchanged          | The fix does not touch `consumeTerminal`, `registerMarker`, `resolveObligation`, or the Elm kernel | by inspection     |

The fix:
- Does NOT kill the process merely because the initial wait expires (`MAX_STATUS_WAIT_MS=30_000` is unchanged; `manager.status({waitMs:0})` returns the current snapshot synchronously).
- Does NOT convert a running result into success (RCNC-02/04/05: terminal observations do NOT fire the callback).
- Does NOT hide genuine tool invocation errors (`command_status` still returns `{ok: false, error}` for `unknown_job` and other failures; the callback only fires for `state: "running"`).
- Does NOT assign an exit code before the process terminates (the `status()` snapshot is the source; no exit-code synthesis).
- Does NOT create duplicate job records (the callback is per-call; `updateBackgroundCommandState(true, jobId)` is idempotent).
- Does NOT release a held terminal-observation obligation without acknowledgment (the callback only fires for `running`; terminal obligations are settled by the existing Path A / B / C / C' terminal drain).
- Does NOT change STALL/REARM or Completion Authority semantics (the fix does not touch those seams).
- Does NOT add permanent debug-only public fields (the new option is a single optional function field on the existing options interface).
- Does NOT introduce a new Elm kernel.

## C6 — Necessity and conservation

```
Original production seam:
    RCNC-01 RED  ✓ (proves the contradiction at the production boundary)

Repair applied:
    RCNC-01 GREEN  ✓ (post-repair)

Repair neutralized (git stash the production delta):
    RCNC-01 RED  ✓ (the original RED returns; ablation confirmed)

Repair restored (git stash pop):
    RCNC-01 GREEN  ✓ (necessity proven)
```

The full RCNC matrix (RCNC-01..06) is GREEN post-repair; only RCNC-01 was RED pre-repair (the original contradiction). The other 4 tests are GREEN regardless and pin the conservation invariants (no fabricated success, no lost cancellation, no deadline-timeout collapse).

## C7 — Executable evidence and gates

### Focused tests

```
$ bun vitest run --config vitest.config.ts \
    src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts
  ✓ src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts (5 tests) 282ms

Test Files  1 passed (1)
     Tests  5 passed (5)
```

### Conservation test runs

```
$ bun vitest run --config vitest.config.ts \
    src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-controller.test.ts
  ✓ src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-controller.test.ts (7 tests) 5ms

$ bun vitest run --config vitest.config.ts \
    src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-multi-job-controller.test.ts \
    src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-runner-controller-composition.test.ts \
    src/sdk/__tests__/background-command-completion-ownership-correlation01.bccoc01.test.ts
  ✓ src/sdk/__tests__/background-command-completion-ownership-correlation01.bccoc01.test.ts (7 tests) 9ms
  ✓ src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-multi-job-controller.test.ts (5 tests) 5ms
  ✓ src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-runner-controller-composition.test.ts (1 test) 226ms

$ bun vitest run --config vitest.config.ts \
    src/sdk/__tests__/background-command-terminal-presentation-arbitration01.bctpa01.test.ts
  ✓ src/sdk/__tests__/background-command-terminal-presentation-arbitration01.bctpa01.test.ts (6 tests) 6ms

$ bun vitest run --config vitest.config.ts \
    src/sdk/__tests__/active-command-gauge-live-projection-discriminator01.case-b-red-shared-host-lifecycle-sink-omitted.test.ts
  ✓ src/sdk/__tests__/active-command-gauge-live-projection-discriminator01.case-b-red-shared-host-lifecycle-sink-omitted.test.ts (3 tests) 51ms

$ bun vitest run --config vitest.config.ts \
    src/sdk/message-translator.test.ts
  ✓ src/sdk/message-translator.test.ts (167 tests) 28ms

$ bun vitest run --config vitest.config.ts \
    src/sdk/vscode-run-commands-tool.test.ts
  ✓ src/sdk/vscode-run-commands-tool.test.ts (46 tests) 377ms
```

### Pre-existing failures (NOT introduced by this ACT)

`src/sdk/sdk-session-event-coordinator.test.ts` has 2 pre-existing RED tests (`CPL02`, `OWN01`) documented as "RED documenting desired state" in `ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER.md` (closure artifact line 43-46). Verified by `git stash push` of the bounded fix and re-running the same test file — `CPL02` and `OWN01` fail identically with and without the fix. These are P0 / P1 post-correction ACTs that the SEAM04 cutover left for successor work and are out of scope for this P0-A.

### Typecheck

```
$ cd apps/vscode && bun run check-types
(exit 0, no errors)
```

### Lint

```
$ cd apps/vscode && bun run lint
$ biome lint --config-path ./biome.jsonc --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error && bun run lint:proto
Checked 2198 files in 1625ms. No fixes applied.
$ bash ./scripts/proto-lint.sh
(exit 0)
```

### Diff check

```
$ cd apps/vscode && git diff --check
(no output — exit 0)
```

### Webview tests

The webview's `vite.config.ts` vitest config requires a webview build (`tsc -b && vite build -- --dev-build`) before tests can run; the operator owns the build pipeline. The webview-side surface is unchanged by this ACT (no edits under `webview-ui/`), so any pre-existing webview tests remain valid. The webview's `liveProjectionValue` read at `ChatRow.tsx:284-293` and the `CommandStatusMap.containment_failed` literal at `CommandOutputRow.tsx:367` are the rendering seam; they will see the reconciled `running` projection from the bounded fix and render the correct pill text.

### VSIX build

`VSIX: NOT_EXECUTED` — operator owns exact-head packaging per the ACT.

## C8 — Exact-head closure

```
ACT: ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01

ENTRY_HEAD: 050641f5e
SUBJECT_HEAD: 050641f5e (no ACT-owned commit yet; committed below)

LIVE_SPECIMEN:
  job_id: cmd_mv0l6blcq0mavibu
  screenshot_date: 2026-10-09
  installed_source_head: LIVE_SOURCE_UNBOUND
  evidence_class: LIVE

PRODUCTION_SEAM:
  runner: vscode-run-commands-tool.ts:902-904, 1034-1037 (terminalPromise.then notifyBackgroundStateChange)
  tool_envelope: command-status-tool.ts:347-367 (manager.status snapshot, verbatim)
  transcript: message-translator.ts (generic tool result message; no specialized classifier)
  renderer: webview-ui/src/components/chat/CommandOutputRow.tsx:367 (containment_failed → "Run failed" pill)

FIRST_DIVERGENT_BOUNDARY:
  source: apps/vscode/src/sdk/command-status-tool.ts:execute() — no projection-reconciliation seam for state === "running" observations
  cause: PROJECTION_DESYNC — the per-job projection map can be written terminal by a runner-driven terminalPromise listener (or any other terminal-writer path) while the underlying CommandJob is still alive. A subsequent command_status observation returns the canonical "running" snapshot, but the chat row's liveProjectionValue reads the stale terminal value from the projection map and renders "Run failed". The command_status tool was the canonical nonterminal observation seam but did not reconcile the projection on a running observation.

REAL_RED:
  reproduced: yes
  assertion: RCNC-01 in apps/vscode/src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts. With the production fix stashed, the spy on onRunningObserved is never called and the projection map retains the stale "containment_failed" write. Failure verbatim: "AssertionError: expected 'vi.fn()' to be called with arguments: [ 'cmd_mv107d280lm70f58' ]"

REPAIR:
  files:
    - apps/vscode/src/sdk/command-status-tool.ts (add onRunningObserved option, call it on state === "running" inside execute())
    - apps/vscode/src/sdk/vscode-runtime-builder.ts (wire onBackgroundStateChange into onRunningObserved)
  production_delta: 67 lines added, 0 removed (2 files)

NECESSITY:
  ablation: git stash push of both production files; RCNC-01 returns to RED (verified). git stash pop restores GREEN.
  red_restored: yes (assertion: "expected 'vi.fn()' to be called with arguments: [ 'cmd_...' ]")

CONSERVATION:
  running_status: RCNC-01 GREEN (projection reconciled to "running" on nonterminal observation)
  genuine_failure: RCNC-02 GREEN (terminal observation does NOT fire the callback; exited projection preserved)
  cancellation: RCNC-05 GREEN (cancelled projection preserved; onRunningObserved does not fire on terminal)
  ownership: the callback is keyed on the typed jobId; no phantom entries can be created
  terminal_observation: terminal observations pass through the existing Path A / B / C / C' terminal drain unchanged; no obligation is silently acknowledged
  completion_safety: the fix does not touch taskState, turnPhase, or the completion-barrier; the existing P0-B post-turn presentation defect remains open and is the explicit successor ACT (ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01)

GATES:
  focused: bun vitest run --config vitest.config.ts src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts → 5 passed
  typecheck: bun run check-types → exit 0
  lint: bun run lint → "Checked 2198 files in 1625ms. No fixes applied." + proto-lint exit 0
  webview: NOT_EXECUTED (webview surface unchanged; operator owns webview build/test)
  diff_check: git diff --check → exit 0

VSIX: NOT_EXECUTED
LIVE_POST_FIX: NOT_EXECUTED (operator owns the LIVE qualification)

VERDICT: PASS_NONTERMINAL_COMMAND_RESULT_CLASSIFICATION_PRELIVE
```

## C9 — Terminal verdicts

| Outcome                                                       | Verdict                                                   | This ACT     |
| ------------------------------------------------------------- | --------------------------------------------------------- | ------------ |
| Real contradiction reproduced; bounded fix and ablation GREEN | `PASS_NONTERMINAL_COMMAND_RESULT_CLASSIFICATION_PRELIVE`  | **ACHIEVED** |
| Current production seam already correct                       | `NOT_REPRODUCED`                                          |              |
| Wrong result belongs to another observed boundary             | `CAPTURE_INSUFFICIENT` until that boundary is established |              |
| Test bypasses the real classification path                    | `HALT_REAL_COMMAND_RESULT_SEAM_NOT_EXERCISED`             |              |
| Repair loses or fabricates terminal result                    | `HALT_COMMAND_TERMINAL_RESULT_CONSERVATION`               |              |
| Repair changes completion authority                           | `HALT_OUT_OF_SCOPE_COMPLETION_DELTA`                      |              |
| Production patch adds a second semantic authority             | `HALT_DUAL_COMMAND_RESULT_AUTHORITY`                      |              |

None of the HALT conditions triggered.

## C10 — The second P0 remains frozen

The next successor is:

**`ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01`**

Its known LIVE evidence (per the BCB / BCTPA ACT chain):

```
Runtime turn: completed
Canonical shadow: completed
Legacy phase: streaming
Publication binding: UNBOUND
Task completion committed: 0
Held terminal observations: nonzero
```

The next ACT must establish whether the correct visible outcome is `awaiting_followup`, `blocked`, or another existing semantic state — not simply force `Completed`. No edits to the Task Header, the Elm phase authority, or the `updateBackgroundCommandState` terminal-state union are authorized by the present P0-A ACT. The bounded fix in this ACT is strictly bounded to the per-call `onRunningObserved` callback in the `command_status` tool, scoped to nonterminal observations, and does not touch any of those seams.

## Final execution directive

C1: GO. P0-A closed with `PASS_NONTERMINAL_COMMAND_RESULT_CLASSIFICATION_PRELIVE`; P0-B retained as the explicit successor ACT.
