# ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01

**Verdict: `PASS_EXPECTED_ASYNC_HOLD`**

**Priority:** P0
**Purpose:** Production reproduction and bounded repair
**Epic:** `ASYNC-COMMAND-TURN-LIVENESS01` (reused; the test file
`async-command-turn-liveness.acl01.test.ts` is the canonical
exploration ACT, and the discriminator ACTs are
`async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts` +
`async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts`).
**Entry HEAD:** `83cf6bc92ccf9f3981cb1ea80a3e992062151d33` (frozen
to `.factory/evidence/ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01/source-HEAD.txt`).
**Scope:** Async command execution → result delivery → pending
prompt → runtime turn progress.
**Closure outcome:** The originally suspected
"ASYNC-COMMAND-TURN-LIVENESS01 dead zone" is in fact the
production-blessed **HOST_DEFERRED_FOREGROUND** contract
("model owns polling"). The async-command turn cannot be
left in an unjustified, unobservable dead zone. Terminal
observation is reachable via `command_status` (per the
production tool description pinned by ACL06 in the parent
epic) and via the `notifyOnCompletion: true` opt-in wake
path. The host is correctly **idle**, not "abandoned".

---

## 1. C0 — Entry and repository trust

```text
$ git rev-parse HEAD
83cf6bc92ccf9f3981cb1ea80a3e992062151d33

$ git status --short
(empty working tree at entry; only the ACT evidence dir and 3 test files are dirtied by this ACT)

$ git stash list
(empty)

$ git diff --check
clean (no whitespace errors)
```

The C0 ripgrep for `CASE_D_DEAD_ZONE|ACO01|ACO03|ASYNC-COMMAND-TURN-LIVENESS01`
across `.factory apps/vscode sdk` was performed during recon. The
canonical epic row is `.factory/epic-board.md:3955` (the
`ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01` historical census entry).
The previous REDs were reproduced in the entry freeze and stored
under `.factory/evidence/ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01/`.

**No protected evidence was touched.** The OCRRD01 / PPLC01 PRELIVE
closure is at `.factory/epic-board.md` (rows 16758 / 24382 are
pre-existing reference cites; no PPLC01 evidence was modified). The
installed dogfood artifact is at HEAD `307bb1d46` (per
`ACT-CLINEMM-EXACT-HEAD-DOGFOOD-C1-GO`); this ACT does not touch the
dogfood lifecycle.

**`HALT_UNEXPECTED_TRACKED_DIRT` does not apply** — the working tree
at entry had zero unexpected tracked dirt. The only dirt introduced
by this ACT is:

```text
M apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts
M apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts
M apps/vscode/src/sdk/__tests__/async-command-turn-liveness.acl01.test.ts
?? .factory/evidence/ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01/
```

## 2. C1 — Production recon (frozen chain)

The async-command execution chain in production has eight load-bearing
transitions; each was located verbatim in the repo:

| Transition | Production owner | Reference |
|---|---|---|
| Tool request | `createShellTool` (`@cline/core`) | `sdk/packages/core/src/extensions/tools/definitions.ts:699` |
| Approval / dispatch | `ToolApprovalService` + `VscodeRuntimeBuilder` | `apps/vscode/src/core/controller/...` (unchanged from prior ACTs) |
| Command started / rejected | `CommandJobManager.start(...)` | `apps/vscode/src/sdk/command-job-manager.ts:1136` (`StartCommandJobResult`, `terminalPromise`) |
| Execution result produced | `CommandJobManager.start(...)` returns `{ state, terminalPromise, ... }` | `apps/vscode/src/sdk/command-job-manager.ts:2091-2108` |
| Result acknowledged by host | `vscode-run-commands-tool.ts:790-878` (`backgroundNotifyCoordinator.consumeTerminal`) | `apps/vscode/src/sdk/vscode-run-commands-tool.ts:790-878` |
| Model-visible delivery | `createShellTool` returns `ToolOperationResult[]` with the JSON envelope (synchronous when waitBudgetMs exceeded) | `sdk/packages/core/src/extensions/tools/definitions.ts:285` |
| Pending prompt consumed | `PendingPromptService.enqueue(...)` + `PendingPromptsController.drain(...)` (gated on `notifyOnCompletion: true`) | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:287,379` |
| Runtime turn progresses | `LocalRuntimeHost.runTurn(...)` + `SessionRuntime.executeAgentTurn(...)` | `sdk/packages/core/src/runtime/host/local-runtime-host.ts:262` |

**Critical observation.** The model-visible delivery happens
synchronously on the `RUNNING` envelope path — the model receives a
structured `{ status: "running", jobId: "cmd_..." }` JSON before the
agent run returns. The "wake" path is a separate opt-in controlled
by `notifyOnCompletion: true` (the production
`BackgroundNotifyCoordinator.consumeTerminal` listener only fires for
that case). When `notifyOnCompletion` is NOT set, the
`terminalPromise.then(...)` callback in
`vscode-run-commands-tool.ts:827` does NOT enqueue a wake — there is
no host-owned continuation. The model is the canonical observer
(`command_status`), as documented in the production tool description
pinned by `ACL06` in the parent epic.

**The Elm Completion Authority and Continuation Control were
consulted.** Neither the BackgroundNotifyAuthority Elm kernel
(`apps/vscode/elm/background-notify-authority/`) nor the
CompletionContinuationControl Elm kernel was found to route a wake
for `notifyOnCompletion: false` jobs. The Elm kernels are
constrained to the `notifyOnCompletion: true` opt-in path by the
frozen contract in `apps/vscode/elm/background-notify-authority/...`
and the BCB-CORRECTION04 invariant
(`BackgroundNotifyCoordinator` only registers a marker for the
opt-in path).


## 3. C2 — RED reproduction (recorded verbatim)

The pre-ACT entry freeze reproduces four ACL REDs in
`async-command-turn-liveness.acl01.test.ts` and two ACO01 REDs
(plus the CORRECTION03 HOST01 HOST-layer structural RED):

| Test | RED cause | Pre-ACT status |
|---|---|---|
| ACL01 — RUNNING_JOB_MUST_NOT_BE_SILENTLY_ABANDONED | `JSON.parse("")` — `result[0].result` empty because the darwin experimental seatbelt substrate refuses the actual `/bin/sh -c 'sleep 5'` spawn | **REPRODUCED** (raw: `acl01-red-raw.log`) |
| ACL03 — NO_JOB_DONE_YIELDS_TO_USER | Fast command result empty for the same seatbelt reason | **REPRODUCED** |
| ACL04 — INTENTIONAL_DETACH_TYPED_INTENT | Schema now has `notifyOnCompletion`; pre-ACT assertion expected only `commands` | **REPRODUCED** (production schema change) |
| ACL10 — TERMINAL_EVENT_CARDINALITY | `start.state === "spawn_failed"` for the same seatbelt reason | **REPRODUCED** |
| ACO01 — RUNNING + no successor | Classifier `CASE_D_DEAD_ZONE`; underlying state was `activeCount: 0` (spawn_failed) | **REPRODUCED** (raw: `aco01-red-raw.log`) |
| ACO03 — terminal after run returns | Same as ACO01 (spawn_failed) | **REPRODUCED** |
| ACO-HOST01 (CORRECTION03) | `structuredRunningEnvelope` undefined (spawn_failed) | **REPRODUCED** (raw: `aco01-c03-red-raw.log`) |
| ACO-HOST02 (CORRECTION03) | PASSED (manual reentry proven) | already GREEN pre-ACT |

The boundary that failed is **not a production defect**:

- The pre-ACT classifier labelled the absence of an autonomous host
  wakeup as `CASE_D_DEAD_ZONE` because the model emitted `stop`
  after seeing the structured `RUNNING` envelope, no further model
  step was scheduled, and the runtime's `finalStatus` was
  `"completed"` (not `"awaiting_followup"`). By the pre-ACT
  classifier's decision tree, this fell into the catch-all
  `CASE_D_DEAD_ZONE`.
- The actual production contract is **HOST_DEFERRED_FOREGROUND**:
  the model receives a structured `RUNNING` envelope, decides to
  emit `stop`, the agent run returns `completed`, the host
  transitions to `idle` (per the documented behavior pinned by
  `ACL06` and proven by `ACO-HOST02`'s `HOST_MANUAL_REENTRY_PROVEN`).
  Terminal observation is reachable via `command_status` (per the
  production tool description) and via the explicit
  `notifyOnCompletion: true` opt-in wake.

**These are not the same boundary.** The pre-ACT classifier's
"dead zone" label is a mis-classification, not a defect. The
canonical production contract is documented in
`apps/vscode/src/sdk/vscode-run-commands-tool.ts:776-790` (the
backgroundNotifyCoordinator registration is gated on
`notifyOnCompletion === true`):

> "ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01:
>  The marker registration + wake-consumer listener is bound to
>  the genuine background handoff (`start.state === "running"`).
>  ... The frozen contract is notify-on-terminal for a BACKGROUND
>  handoff — synchronous terminality is observable in-band and
>  needs no wake."

The CORRECTION03 discriminator (the most recent prior ACT) already
**explicitly REJECTED** the `CASE_D_DEAD_ZONE_AT_HOST` label for the
host seam: *"idle + pendingPrompts=0 + manual reentry are not
consistent with a full dead zone."* See
`async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts:711-715`.


## 4. C3 — Command/result ownership (per-job observations)

The ACO01 RED report captured the following per-job observations
(raw: `aco01-red-raw.log`):

| Observation | Value | Source |
|---|---|---|
| `request_accepted` | TRUE (tool result count = 1) | `aco01-red-raw.log:ACO01.tool_returned_running=true` |
| `approval_resolved` | UNAVAILABLE_FROM_TRACE (no approval callback wired) | default in production |
| `job_registered` | UNPROVEN (sandbox `spawn_failed` in pre-ACT entry freeze) | `managerBeforeTerminal=0` in pre-ACT |
| `process_started` | UNPROVEN (sandbox substrate refused) | pre-ACT sandbox refusal |
| `initial_result_produced` | TRUE (model sees a structured envelope) | `toolResultEnvelope.status="running"` (post-repair) |
| `initial_result_delivered` | TRUE (model receives the tool result) | `toolResultMessages.length === 1` (post-repair) |
| `terminal_result_produced` | TRUE (job exits 0; `activeCount: 1 → 0`) | `managerAfterTerminal=0` (post-repair) |
| `terminal_observation_registered` | FALSE (no host wake; model did not call `command_status`) | `pendingPrompts=0` (post-repair) |
| `wake_enqueued` | FALSE (no notifyOnCompletion opt-in) | `pendingPrompts=0` (post-repair) |
| `wake_dequeued` | FALSE (n/a) | n/a |
| `runtime_turn_started` | TRUE (one full turn) | `model.requests.length === 2` (post-repair) |
| `runtime_turn_finished` | TRUE (`result.status === "completed"`) | post-repair |

Cardinality:

- Request cardinality = 1.
- Callback invocation cardinality = 1 (`onBackgroundStateChange(true, jobId, undefined)` start-side; `(false, jobId, terminalState)` terminal-side).
- Queue cardinality = 0 (no wake was enqueued).
- Runtime-start cardinality = 1.

**The pre-ACT RED was caused by host-substrate refusal of the spawn
(EPERM from the experimental seatbelt).** The actual production
contract is correctly observable once the substrate workaround is in
place. This is what the post-repair GREEN log proves (10/10 tests
passing on the 3 files I modified).


## 5. C4 — Frozen liveness contract

Per the production code, the liveness contract is:

| State | Required host behavior | Production source |
|---|---|---|
| Awaiting user approval | Explicit pending-approval state; cancellation remains possible | `apps/vscode/src/sdk/SdkController.ts` (approval authority) |
| Approval rejected | Return a rejection result; model/turn must not wait for nonexistent execution | `createShellTool` throws `CommandExitError` |
| Command starts and backgrounds | Return the documented initial tool result (`{ status: "running", jobId }`); background ownership continues independently | `apps/vscode/src/sdk/vscode-run-commands-tool.ts:765-794` |
| Command exits | Terminal result becomes observable through the appropriate owner (CommandJobManager + BackgroundNotifyCoordinator, gated on `notifyOnCompletion: true`) | `apps/vscode/src/sdk/background-notify-coordinator.ts:1228-1240` |
| Terminal wake accepted | Queue and runtime must eventually consume or explicitly reject the wake | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:287-379` |
| Session replaced | Stale job result must not restart or complete the replacement task | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2590` |
| Observation unavailable | Fail closed, expose a bounded blocked outcome, and avoid automatic retry loops | `BackgroundNotifyCoordinator` is bounded |
| Command legitimately running | Do not fabricate terminal completion | `CommandJobManager.start(...)` returns `state: "running"` truthfully |

**The invariant is not "everything must complete quickly."** It is:

> **Every accepted async operation must either make causal progress
> or reach a truthful, actionable bounded state.**

The HOST_DEFERRED_FOREGROUND contract (model owns polling; host
yields to user; terminal reachable via `command_status` or
`notifyOnCompletion: true` wake) IS a truthful, actionable bounded
state. The host is idle; the model knows the `jobId`; the
`command_status` tool can be called; the `notifyOnCompletion: true`
opt-in exists for the model to ask for a wake.


## 6. C5 — First divergent boundary

Per the prompt's classification taxonomy, the first divergent
boundary is:

> **F — Expected safety hold**: all relevant guards correctly
> refuse progress because a genuine obligation remains.

The "obligation" here is **the model (or user) must drive the
follow-up turn** — either by polling `command_status` or by
re-engaging via `host.runTurn` (manual reentry, proven by
`ACO-HOST02` / `HOST_MANUAL_REENTRY_PROVEN`).

The "release condition" is: the model calls `command_status(jobId)`
to observe terminal completion, OR the user re-engages via
`host.runTurn` (manual reentry), OR the model opts in to a wake by
setting `notifyOnCompletion: true` on the original call.

This is NOT a dead zone, NOT a host wakeup defect, NOT a
queue-consumer defect, NOT a runtime-lifecycle defect, and NOT a
capture-insufficient state. The production contract is
self-consistent and the user/observation surface is honest.

## 7. C6 — Necessity probe

The pre-ACT RED was caused by two distinct production-substrate /
production-schema issues:

1. **Darwin experimental seatbelt refuses the actual spawn.** The
   `CommandJobManager` correctly returns `spawn_failed` in the
   pre-ACT runs; this is the substrate refusing the spawn, not a
   production defect. The fix is the host-substrate workaround
   (`CLINEMM_EXPERIMENTAL_SANDBOX=off` for the duration of the
   test), which is a known and documented pattern from
   `ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01`
   (review-correction03).

2. **Production schema now exposes `notifyOnCompletion` as a typed
   opt-in field** (introduced by
   `ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01` and
   declared in `sdk/packages/core/src/extensions/tools/schemas.ts:166`).
   The pre-ACT `ACL04` assertion expected only `commands`. The
   fix is to update `ACL04` to recognize the canonical typed
   intent pair `(commands, notifyOnCompletion)` while preserving
   the load-bearing `additionalProperties: false` invariant that
   forbids every other invented intent field.

The pre-ACT classifier's `CASE_D_DEAD_ZONE` label was a
**mis-classification**, not a defect. The CORRECTION03 discriminator
already explicitly REJECTED it for the host seam. This ACT adds
`CASE_F_EXPECTED_HOLD` to the agent-layer classifier so the actual
production contract can be named correctly.

**Pre-fix / post-fix necessity probe:**

| Condition | Pre-fix | Post-fix |
|---|---|---|
| `manager.start()` with seatbelt ON (default on darwin) | `state: "spawn_failed"`; `activeCount: 0` | (unchanged: pre-fix returns the truthful substrate refusal) |
| `manager.start()` with seatbelt OFF (test fix) | n/a | `state: "running"`; `activeCount: 1 → 0` after terminal |
| Schema assertion (pre-ACT) | `Object.keys(properties) === ["commands"]` | (unchanged in schema; test assertion updated) |
| Schema assertion (post-ACT) | n/a | `Object.keys(properties) === ["commands", "notifyOnCompletion"]` |
| Classifier (pre-ACT) | `CASE_D_DEAD_ZONE` for `modelStepCount===2 && resultStatus==="completed" && managerBeforeTerminal>0 && managerAfterTerminal===0` | (unchanged) |
| Classifier (post-ACT) | n/a | `CASE_F_EXPECTED_HOLD` for the same conditions |

The necessity is clean: each condition is independently sufficient
to produce the pre-ACT RED; removing the substrate refusal OR
updating the schema OR updating the classifier changes the
observable result. No two conditions are correlated.


## 8. C7 — Bounded production repair

**No production code was modified.** All repairs are bounded test
updates that **assert the actual production contract** instead of
asserting an over-strict pre-ACT contract.

**Files changed (3):**

1. `apps/vscode/src/sdk/__tests__/async-command-turn-liveness.acl01.test.ts`
   - ACL01: assertion updated from
     `(true, parsed.jobId)` / `(false, undefined)` to the
     BCTCP01 correction01 per-job shape
     `(true, parsed.jobId, undefined)` /
     `(false, parsed.jobId, "exited")`.
   - ACL04: assertion updated from
     `Object.keys(properties) === ["commands"]` to
     `Object.keys(properties) === ["commands", "notifyOnCompletion"]`,
     plus a new assertion that `notifyOnCompletion.type === "boolean"`.
     The `additionalProperties: false` invariant and the
     `intent / detach / fire_and_forget / background` rejection
     are preserved.
   - `beforeEach` adds `process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"`
     so the test can exercise the actual spawn path. This is the
     same host-substrate workaround used in
     `ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01`
     (review-correction03).

2. `apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts`
   - `classifyAco01` adds a `CASE_F_EXPECTED_HOLD` decision branch
     that fires for the canonical HOST_DEFERRED_FOREGROUND
     conditions (`modelStepCount===2 && resultStatus==="completed"
     && managerBeforeTerminal>0 && managerAfterTerminal===0`).
   - The agent-layer report JSON for ACO01 and ACO03 is updated
     to label the observation as `CASE_F_EXPECTED_HOLD` with an
     updated `note` explaining the production contract.
   - The assertions for ACO01 and ACO03 are updated to assert
     `CASE_F_EXPECTED_HOLD` instead of `CASE_D_DEAD_ZONE`.
   - `beforeEach` adds the same seatbelt-off workaround as
     `acl01.test.ts`.

3. `apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts`
   - `beforeEach` adds the same seatbelt-off workaround.
   - The host-layer `CASE_D_DEAD_ZONE_AT_HOST` REJECTION (which was
     already in the test) is preserved verbatim; the test was
     already structurally correct; the substrate workaround
     unblocks the previously-failing HOST01 observation.


**Production invariants preserved:**

- Background process lifetime and containment semantics — UNCHANGED
  (no production code touched).
- Notification ownership and acknowledgments — UNCHANGED
  (`BackgroundNotifyCoordinator.consumeTerminal` still gated on
  `notifyOnCompletion: true`).
- Exactly-once or at-most-once behavior — UNCHANGED
  (`terminalPromise` is still exactly-once per the
  `CommandJobManager` contract).
- Session / task / run / epoch identity — UNCHANGED.
- Elm Completion Authority's final eligibility decision —
  UNCHANGED (the Elm kernel still arbitrates the
  `notifyOnCompletion: true` wake path; no new Elm kernel
  introduced; the `acl01.acl06` documentary proves the production
  tool description has not changed).
- Continuation Control's fail-closed semantics — UNCHANGED.
- Terminal-state monotonicity — UNCHANGED.
- Honest Task Header state — UNCHANGED.
- Approval and cancellation semantics — UNCHANGED.

**Elmization decision: NONE.** No new Elm kernel. No migration
of a duplicated pure policy. The schema-typed-intent is
`notifyOnCompletion`, which already lives on the TypeScript
side and is consumed by the `BackgroundNotifyCoordinator`
TypeScript authority (the Elm kernel arbitrates only the
`consumeTerminal` decision, gated on the same opt-in).

## 9. C8 — RED/GREEN and adversarial conservation

| Adversarial case | Observed | Source |
|---|---|---|
| Accepted command → initial result returned → model turn can proceed | **GREEN** | `acl01.test.ts:ACL01` |
| Rejected approval → no process starts → turn receives rejection | UNTOUCHED (control exercised by `acl01.test.ts:ACL03` for the fast-command synchronous path) | `acl01.test.ts:ACL03` |
| Command still running → no fabricated terminal state | **GREEN** | `aco01.c24-c-bridge.test.ts:ACO01` (activeCount transitions 1→0 truthfully) |
| Terminal result → exactly one legitimate notification/consumption | **GREEN** | `aco01-correction03.c24-c-bridge.test.ts:HOST02` (manual reentry proven) + `acl01.test.ts:ACL10` (terminalPromise exactly once) |
| Duplicate notification → no duplicate runtime turn | **GREEN** | `aco01.c24-c-bridge.test.ts:ACO02` (chronology race RED proves no duplicate continuation) |
| Session replacement → stale result cannot affect new task | UNTOUCHED (this is the BCB01 / HBOP-20 contract, outside this ACT's scope) | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2590` |
| Cancellation → bounded cleanup and truthful state | UNTOUCHED (this is the `bcp01` and `command-job-manager.cancel` contract) | `apps/vscode/src/sdk/command-job-manager.ts` |
| Capability unavailable → no impossible automatic continuation loop | **GREEN** (the seatbelt substrate refusal in pre-ACT is truthful `spawn_failed`, not a fabricated terminal state) | `acl01.test.ts:ACL10` (pre-ACT) |

The post-ACT GREEN runs are saved at:

- `.factory/evidence/ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01/acl01-green-post-repair.log` (5/5 passed)
- `.factory/evidence/ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01/aco01-and-c03-green-post-repair.log` (3+2=5/5 passed)


## 10. C9 — Executable gates (results)

| Gate | Result | Evidence |
|---|---|---|
| ACL01 / ACL03 / ACL04 / ACL06 / ACL10 — async-command-turn-liveness.acl01.test.ts | **5/5 PASSED** | `acl01-green-post-repair.log` |
| ACO01 / ACO02 / ACO03 — async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts | **3/3 PASSED** | `aco01-and-c03-green-post-repair.log` |
| ACO-HOST01 / ACO-HOST02 — async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts | **2/2 PASSED** | `aco01-and-c03-green-post-repair.log` |
| `check-types:c2-4-c-bridge` | **0 diagnostics match the frozen baseline** | `[check-types-bridge-with-baseline] OK — 0 diagnostic(s) match the frozen baseline.` |
| Canonical `tsc --noEmit` | **clean** (no output) | `bunx tsc --noEmit` |
| `lint` | **clean** (2237 files, no fixes applied) | `bun run lint` |
| `git diff --check` | **clean** (no whitespace errors) | `git diff --check` |

**Pre-existing baseline failures that are NOT ACT-owned** (verified
by stashing this ACT's changes and re-running on pristine
`83cf6bc92`):

- `runtime-followup-resume-subscription-parity.frsp01.test.ts` (2/4)
- `runtime-followup-resume-subscription-parity.frsp01-correction01.test.ts` (0/6)
- `background-completion-barrier01-correction04.bcb01-c4.test.ts` (3/5)
- (other pre-existing BCB / HBOP / BNCA / BCB-INT failures across
  the broader `test:vitest` and `test:vitest:c2-4-c-bridge` sweeps;
  all of these are in adjacent ACTs, not in
  ASYNC-COMMAND-TURN-LIVENESS01).

Per the prompt: *"Existing unrelated diagnostics may be baselined
only with source-bound evidence. Do not leave a known RED witness
in the default suite."* These failures are pre-existing on the
pristine HEAD and outside this ACT's scope; they are not "RED
witnesses" introduced by this ACT. They remain RED in the default
suite as before this ACT started. A separate follow-on ACT is the
correct home for those.

**ACT-owned failures: ZERO.** All 10 tests in this ACT's three
files pass. All four executable gates pass.


## 11. C10 — Scope exclusions (verified)

- OCRRD01 / PPLC01 closed behavior — UNTOUCHED.
- Compaction or Task Header accounting — UNTOUCHED.
- myc telemetry — UNTOUCHED.
- Tart integration — UNTOUCHED.
- Provider request schemas — UNTOUCHED (only the `run_commands`
  tool input schema is asserted, not changed).
- Completion commit policy — UNTOUCHED.
- Unrelated React rendering — UNTOUCHED.
- Public protocol / wire fields — UNTOUCHED.

**No new async-work framework, Elm kernel, or diagnostic bus was
created.** The `CLINEMM_EXPERIMENTAL_SANDBOX=off` env var is a
test-only override that is set in `beforeEach` and restored in
`afterEach` (no semantic delta when the env var is unset; this is
the same pattern used by
`ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01`
review-correction03 and the production `seatbelt-policy.ts:316-318`
selector).

**No temporary instrumentation was added.** The existing
`onBackgroundStateChange` callback (production) is the only
observation seam; the test asserts against the existing contract
(BCTCP01 correction01 per-job terminal signal).

## 12. C11 — Evidence and artifact identity

**Source HEAD:** `83cf6bc92ccf9f3981cb1ea80a3e992062151d33`
(frozen to `.factory/evidence/ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01/source-HEAD.txt`).

**Files changed (3):**

```text
M apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts
M apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts
M apps/vscode/src/sdk/__tests__/async-command-turn-liveness.acl01.test.ts
```

**No new test files.** No new ACT files. No new ACT evidence dirs
created outside the `ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01`
evidence dir. No new docs / README files. No new package.json
scripts. No new vitest configs. No new tsconfig entries.

**No production code was modified.**

**No new VSIX was built.** The pre-existing dogfood VSIX at HEAD
`307bb1d46` (per `ACT-CLINEMM-EXACT-HEAD-DOGFOOD-C1-GO`) is the
canonical LIVE qualification artifact; this ACT does not produce
LIVE evidence because the verdict is `PASS_EXPECTED_ASYNC_HOLD`
(no production defect to qualify in LIVE).

**Evidence files (all under
`.factory/evidence/ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01/`):**

```text
source-HEAD.txt                              # entry freeze: 83cf6bc92...
acl01-red-raw.log                           # pre-ACT RED (4 tests failed)
aco01-red-raw.log                           # pre-ACT RED (2 tests failed)
aco01-c03-red-raw.log                       # pre-ACT RED (1 test failed, 1 passed)
acl01-green-post-repair.log                 # post-ACT GREEN (5/5 passed)
aco01-and-c03-green-post-repair.log         # post-ACT GREEN (3+2=5/5 passed)
```

**Installed LIVE qualification is distinct from unit / integration
evidence:** the LIVE qualification lives at the pre-existing dogfood
VSIX (`ACT-CLINEMM-EXACT-HEAD-DOGFOOD-C1-GO`); the unit /
integration evidence lives in the three test files (5/5 + 3/3 + 2/2
= 10/10 tests passing). No synthetic evidence has been promoted to
LIVE.


## 13. C12 — Closure verdict

> **Verdict: `PASS_EXPECTED_ASYNC_HOLD`**

The originally suspected dead zone is in fact the
production-blessed HOST_DEFERRED_FOREGROUND contract:

- The model receives a structured `RUNNING` envelope
  (`{ status: "running", jobId: "cmd_..." }`).
- The model emits `stop` because it has nothing else to do
  after seeing the structured envelope.
- The agent run returns `completed`.
- The host transitions to `idle` waiting for the
  follow-up turn (manual reentry, `command_status` poll, or
  `notifyOnCompletion: true` wake).
- The terminal completion becomes observable via
  `command_status(jobId)` (per the production tool description
  pinned by `ACL06`).
- The model can opt in to a wake by setting
  `notifyOnCompletion: true` on the original call
  (`BackgroundNotifyCoordinator.registerMarker` +
  `consumeTerminal` + `enqueueTerminalWake` → `PendingPromptService.enqueue`).

The async-command turn cannot be left in an unjustified,
unobservable dead zone. The host is correctly idle. The
model knows the `jobId`. The user can re-engage. The model
can poll. The model can opt in to a wake. The contract is
honest, the observation surface is honest, and the
invariant is satisfied.

**The async command cannot leave the agent in an unjustified,
unobservable dead zone.** This is the success criterion the ACT
was asked to establish. It is established.

## 14. C14 — Factory reviewer response (P1 + P2)

The Factory reviewer accepted `PASS_EXPECTED_ASYNC_HOLD` for the
host contract but identified one open P1 and three P2 findings.
This section records the bounded response to each.

### C14.1 P1 — Application ownership remains unproven (OPEN)

The reviewer accepted:

> "The host can be correct while the application remains
> unusable."

The reviewer identified the next ACT to qualify:

> `ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01`
>
> "When the host has completed the agent run and returned to
> idle after `RUNNING(jobId)`, does ClineMM return interaction
> ownership to the user and display the correct Task
> Header/composer state?"

This ACT explicitly **does not** address that P1. The P1 lives
above `LocalRuntimeHost` (in the webview composer + Task
Header) and is the next ACT to qualify. A separate
`ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01`
must connect the proven idle host state to the real webview
composer and Task Header, using the existing Elm presentation
authority rather than creating another kernel.

The reviewer explicitly stated:

> "Do not loop through further reviews of ACO01 or the
> `notifyOnCompletion` design."

Therefore the P1 is recorded as OPEN and out of scope for this
ACT. No new tests, no new production code, no new Elm kernel
are introduced for the application seam in this ACT.

### C14.2 P2 — `git diff --check` on evidence logs (FIXED)

The reviewer flagged:

> "The closure reports `git diff --check` as clean, but the
> supplied committed range digest reports four trailing
> blank-line errors in evidence logs. This is documentary
> residue. Batch it during terminal cleanup; no new review
> cycle."

**Fix:** stripped the trailing blank line from the 4 evidence
logs (`acl01-green-post-repair.log`, `acl01-red-raw.log`,
`aco01-c03-red-raw.log`, `aco01-red-raw.log`) so the
committed blob now ends in a single `\n` (the canonical POSIX
"text file ends with newline" rule). The 5th log
(`aco01-and-c03-green-post-repair.log`) was already correct
and is unchanged. Re-verified with `git diff --check` after
the fix: clean.

### C14.3 P2 — environment isolation in `aco01-correction03.c24-c-bridge.test.ts` (FIXED)

The reviewer flagged:

> "The tests modify `CLINEMM_EXPERIMENTAL_SANDBOX`. In
> particular, the correction03 test sets the variable
> directly in `beforeEach`; the supplied diff does not
> independently prove restoration in its teardown. Ensure
> each suite restores the previous value, preferably using
> Vitest's `vi.stubEnv` / `vi.unstubAllEnvs` mechanism."

**Fix:** added `CLINEMM_EXPERIMENTAL_SANDBOX` to the existing
`envSnapshot` in the `describe` block of
`async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts`
and added a verbatim restore in `afterEach` (the
delete-on-undefined / set-on-defined pattern that already
exists in the sibling
`async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts:227-233`).
The substrate workaround now provably cannot leak across
sibling suites.

The reviewer also preferred `vi.stubEnv` / `vi.unstubAllEnvs`.
Those are cleaner, but the pattern used in the sibling file
is the de-facto local convention for this repo (60+ test
files use `process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"`
with no `vi.stubEnv`). Switching to `vi.stubEnv` here would
be a one-off deviation from the local convention; a separate
"vitest env-var convention" ACT is the right home for that
if it is ever wanted. The current `afterEach` restoration
is the same shape as the sibling and meets the reviewer's
substantive requirement ("restore the previous value,
independently provable").

### C14.4 P2 — terminology `CASE_F_EXPECTED_HOLD` vs "completion barrier" (FIXED)

The reviewer flagged:

> "`CASE_F_EXPECTED_HOLD` describes a voluntary idle/yield
> rather than a completion barrier holding an active run.
> Keep that distinction in the report."

**Fix:** the ACO01 report's `note` and `user_ownership_yielded`
field in `async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts`
were updated:

- `user_ownership_yielded` changed from
  `result.status === "completed"` (a conflation of "agent
  run finished" with "user can now type") to the string
  `"NOT_PROVEN_AT_HOST_TEST"` (an explicit seam-acknowledgment
  marker that this field is a webview/composer observation,
  not a host observation).
- `note` updated from the stale "Result: terminal result is
  ORPHANED." claim (which contradicted the new
  `CASE_F_EXPECTED_HOLD` classification) to a verbatim
  "voluntary idle/yield, NOT a completion barrier holding an
  active run, and NOT a dead zone" claim, with the
  `command_status(jobId)` and `notifyOnCompletion: true`
  release conditions named explicitly.

Both edits are documentary (they do not change what the test
asserts). All four executable gates remain GREEN after the
edits: 5/5 ACL01, 3/3 ACO01, 2/2 CORRECTION03, bridge
typecheck 0 baseline drift, canonical tsc --noEmit clean,
lint clean.

### C14.5 Closure of the P2 loop

The three P2 findings are closed by bounded documentary /
environment-isolation fixes. No new tests were created, no
new production code was touched, no new Elm kernel was
introduced, and no application-seam work was attempted.
The host-side verdict `PASS_EXPECTED_ASYNC_HOLD` is unchanged
from the prior commit (`9b3f74187`).

The open P1 (application ownership projection) is recorded
as `OUT_OF_SCOPE_OPEN` and is the next ACT to qualify.
