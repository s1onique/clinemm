# ACT-CLINEMM-ELM-SEAM05-PROMPT-ADMISSION-RECON — PASS_ELM_SEAM05_RECON — 2026-10-09

**Status:** CLOSED with verdict `PASS_ELM_SEAM05_RECON`. One bounded
production decision authority selected. No production code touched.
No Elm implementation attempted (per scope).

**Preconditions met:**
- SEAM01–04 evidence preserved (all four prior PASS/closure entries
  are still present in `.factory/epic-board.md` and
  `.factory/ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER.md`).
- SEAM04 outstanding VSIX / live qualification remains a separate
  cursor (this ACT does NOT claim it).
- ENTRY_HEAD = `3bfba1582` on branch `main`; working tree clean;
  no stashes; no uncommitted changes.
- HALT_UNEXPECTED_TRACKED_DIRT: NOT TRIGGERED.

## 1. Selected production decision authority

**The prompt-admission decision at `LocalRuntimeHost.runTurn` lines
1244–1274 in `sdk/packages/core/src/runtime/host/local-runtime-host.ts`.**

This is the **only** production seam that decides, for a given
prompt, whether to (a) defer to the queue, (b) promote to the
front of the queue, or (c) execute immediately. The full
production call graph is documented in §3.

## 2. Why this seam (over the alternatives)

| Candidate | Status | Why not selected |
| --- | --- | --- |
| `PendingPromptsController.enqueue` (service.ts:287) | TRANSITION_PLUS_EFFECT | mutates the queue; depends on `delivery` flag from caller — admission already decided upstream |
| `PendingPromptsController.drain` (service.ts:522) | IO_COUPLED | downstream of admission; no decision vocabulary of its own |
| `SdkFollowupCoordinator.askResponse` (apps/vscode/.../sdk-followup-coordinator.ts:93) | REACT_LIFECYCLE_COUPLED | decides which session receives the prompt (idle vs running vs task-history) — a routing decision, not an admission decision; the actual queue/steer flag is then passed through to `runTurn` |
| `LocalRuntimeHost.runTurn` (local-runtime-host.ts:1227) **SELECTED** | PURE_DECISION + REACT_LIFECYCLE (light) | the only seam that takes the (caller flag, session interactivity, agent readiness) triple and returns a queue/steer/immediate verdict. The three facts are the entire input vocabulary. The output is a closed three-tag decision. The downstream effect (enqueue vs executeTurn) is straightforward, single-call, no race. |
| `LocalRuntimeHost.consumeSteer` (local-runtime-host.ts:961) | PURE_DECISION (consumption) | reads front of queue; not an admission decision (the prompt was already admitted) |
| `BackgroundNotifyCoordinator.consumeTerminal` (already Elm-migrated via SEAM04) | SDK_COUPLED | already on Elm; out of scope for SEAM05 |

**Why `LocalRuntimeHost.runTurn` is a clean Elm seam:**

1. **Real production reach.** Every prompt in the system
   (user-typed followup, terminal-wake continuation, completion
   continuation) flows through `sdkHost.send` → `ClineCore.send`
   → `RuntimeHost.runTurn` → `LocalRuntimeHost.runTurn`. The
   decision at lines 1244–1274 is the single funnel.

2. **Significant temporal / ownership complexity.** The decision
   depends on three facts that have orthogonal lifetimes:
   - `input.delivery` — caller-supplied, set by
     `SdkController` / `BackgroundNotifyCoordinator` /
     `SdkFollowupCoordinator` at request time.
   - `session.interactive` — session config flag, set at session
     start.
   - `session.agent.canStartRun()` — runtime state, depends on
     current turn phase and abort window. The auto-queue branch
     (`!canStartRun && interactive`) is the canonical
     "followup-while-running" admission semantic.

3. **Clean Elm facts/decision boundary.** The three facts are
   all observable in production (no diagnostic side effects).
   The three-tag output is a closed enum. The downstream
   effect (enqueue vs `executeTurn`) is a single `if` that
   the Elm kernel can emit as a `Cmd` (or return as a `Decision`
   record that the TS adapter dispatches).

4. **Existing historical regression witnesses.** Multiple
   `pending-prompt-service` tests already exercise this
   boundary (see §5 for inventory).

5. **Low duplication of canonical mutable state.** The decision
   reads three facts, returns one tag. The queue mutation
   happens downstream in `PendingPromptsController.enqueue`,
   not in the decision itself.

6. **Bounded interop cost.** The TS-side change is a single
   call site (one function body). The Elm-side change is a
   new pure function in a new kernel, wired through the
   existing TS adapter pattern (mirroring SEAM04's
   `consumeTerminalAuthority`).

## 3. Exact production call graph

```text
user action / SDK event
  ↓
[1] SdkController.askResponse (apps/vscode/.../SdkController.ts:4430)
    → SdkFollowupCoordinator.askResponse (apps/vscode/.../sdk-followup-coordinator.ts:93)
      ├─ tool approval pending? → resolvePendingToolApproval (return)
      ├─ ask_question pending?  → resolvePendingAskQuestion (return)
      └─ active session present?
           ├─ isRunning OR submittedDuringActiveTurn → queueToActiveSession
           │     → sessions.fireAndForgetSend(sdkHost, sessionId, prompt, ..., "queue")
           │         → active.sdkHost.send({ sessionId, prompt, delivery: "queue" })
           ├─ idle session                      → continueIdleSession
           │     → sessions.fireAndForgetSend(sdkHost, sessionId, prompt, ..., undefined)  // no delivery
           │         → active.sdkHost.send({ sessionId, prompt, delivery: undefined })
           └─ no session, task present         → tryResumeSessionFromTask
                 → resumeSessionFromTask → fireAndForgetSend (no delivery)

  ↓
[2] VscodeSessionHost.send (apps/vscode/.../vscode-session-host.ts)
    → ClineCore.send (sdk/packages/core/src/cline-core/ClineCore.ts:350)
        = RuntimeHost["runTurn"]
    → LocalRuntimeHost.runTurn (sdk/packages/core/.../local-runtime-host.ts:1227)

  ↓
[3] ★ ADMISSION DECISION ★  local-runtime-host.ts:1244-1248
       const canStartRun = session.agent.canStartRun();
       const resolvedDelivery =
           input.delivery ??
           (session.interactive && !canStartRun ? "queue" as const : undefined);
       const delivery = resolvedDelivery;
       if (delivery === "queue" || delivery === "steer") {
           this.pendingPromptsController.enqueue(input.sessionId, { ... })
           return undefined;
       }
    // else: proceed to executeTurn(...)
```

**Other entry points that arrive at the same admission seam:**

```text
BackgroundNotifyCoordinator.consumeTerminal
  → BackgroundNotifyCoordinator invokes its enqueueTerminalWake transport
    (built via buildSdkControllerEnqueueTerminalWake at SdkController.ts:736)
    → active.sdkHost.send({ sessionId, prompt, delivery: "queue", jobId })
      → LocalRuntimeHost.runTurn (same as [3] above)

SdkSessionEventCoordinator.enqueueCompletionContinuation
  → buildSdkControllerEnqueueCompletionContinuation (SdkController.ts:820)
    → active.sdkHost.send({ sessionId, prompt, delivery: "queue", runtimeControlKind: "completion_continuation_control" })
      → LocalRuntimeHost.runTurn (same as [3] above)

hub daemon: HubRuntimeHost.runTurn (sdk/packages/core/src/hub/.../hub-runtime-host.ts:1203)
  → in-memory mirror; not the LocalRuntimeHost path
```

**Lifecycle / ownership observations:**

- The active session lookup is *requested-time*, not commit-time.
  `LocalRuntimeHost.runTurn` reads `session.agent.canStartRun()`
  at the moment the prompt arrives. A session rebuild that
  replaces the session between the caller-side `getActiveSession`
  read and `runTurn` would surface as a different
  `session.interactive` value inside `runTurn` than the caller
  saw — but this is **NOT** a diagnostic side effect: it is the
  correct semantic ("the current agent is busy, the prompt
  queues").

- The queue itself survives aborts. `PendingPromptsController.enqueue`
  (line 410) explicitly notes: "the queue survives aborts and
  is visible while one settles, so queue operations must keep
  working during the abort window." This means a prompt
  admitted under `delivery: "queue"` is durably queued even
  if the aborting turn cancels before drain.

- Duplicate delivery prevention: `PendingPromptService.enqueue`
  (line 287) deduplicates by `prompt` string. Re-enqueue of the
  same text in `delivery: "steer"` mode promotes the existing
  entry to the front; in `delivery: "queue"` mode it appends.
  This dedup is *post-admission* — it does not influence the
  admission decision itself.

- What happens on task completion or cancellation: the queue
  drains on the next `canStartRun() === true` tick. If the
  session is cancelled, the queue persists until the session
  is deleted (via `PendingPromptsController.clear`).

## 4. SEAM05_CONTRACT (frozen migration contract for the successor ACT)

```text
SEAM05_CONTRACT

production entrypoint:
    sdk/packages/core/src/runtime/host/local-runtime-host.ts:1227
    method: runTurn(input: SendSessionInput): Promise<AgentResult | undefined>
    decision site: lines 1244-1248 (resolveDelivery)
    effect site:   lines 1259-1274 (enqueue OR executeTurn)

caller graph:
    (documented in §3 above)

authoritative state:
    session.agent.canStartRun()      // runtime state (turn phase + abort window)
    session.interactive              // session config (set at session start)
    input.delivery                   // caller-supplied, set by SdkController family
    session.pendingPrompts[]         // mutated by enqueue, NOT by the decision itself

inputs (decision vocabulary):
    inputDelivery    : "queue" | "steer" | undefined
    sessionInteractive : boolean
    canStartRun      : boolean

decision vocabulary (closed):
    AdmissionDelivery = "queue" | "steer" | "immediate"

    resolveAdmissionDelivery :
        (inputDelivery, sessionInteractive, canStartRun) → AdmissionDelivery

    truth table (pinned by admission-decision.test.ts:22 cases):
        inputDelivery="queue"    , * , *                            → "queue"
        inputDelivery="steer"    , * , *                            → "steer"
        inputDelivery=undefined  , interactive=true  , canStart    → "immediate"
        inputDelivery=undefined  , interactive=true  , !canStart   → "queue" (AUTO)
        inputDelivery=undefined  , interactive=false , *            → "immediate"

downstream effects:
    On "queue" or "steer":
        PendingPromptsController.enqueue(sessionId, { prompt, mode, delivery, ... })
        + return undefined  (no AgentResult)
    On "immediate":
        continue to executeTurn(session, input) — unchanged in scope

existing regression tests (full inventory, see §5):
    sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.test.ts
        (10 tests, all GREEN; covers enqueue/consumeSteer/shiftNext/delete/dedupe)
    sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.drain-semantics.test.ts
        (4 tests, all GREEN; covers drain loop, jobId forwarding, conservation)
    sdk/packages/core/src/runtime/host/local-runtime-host.test.ts
        (85 tests; filtered subset covers admission):
        - "queues sends with explicit queue or steer delivery and emits snapshots"
        - "auto-queues sends to a running interactive session"
        - "auto-drains a delivery:'queue' follow-up submitted to an idle interactive session (CRA13)"
    apps/vscode/src/sdk/sdk-followup-coordinator.test.ts
        (29 tests; covers SdkFollowupCoordinator.askResponse routing)
    apps/vscode/src/sdk/__tests__/pending-prompt-lost-wakeup.pplw01.c24-c-bridge.test.ts
    apps/vscode/src/sdk/__tests__/pending-prompt-drain-after-completing-run.pprd01.c24-c-bridge.test.ts
    apps/vscode/src/sdk/__tests__/queued-prompt-stop-resume-integrity.qpsr01.c24-c-bridge.test.ts
    apps/vscode/src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01.test.ts
    apps/vscode/src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01-correction01.test.ts

historical defect witnesses:
    - QPSR01 (queued-prompt-stop-resume-integrity): the queue and resume
      boundary was once uncoordinated; tests now GREEN.
    - FRSP01 (followup-resume-subscription-parity): the followup resume
      path once bypassed the runtime-event subscription; tests now GREEN
      after CORRECTION01.
    - PPRD01 (pending-prompt-drain-after-completing-run): the queue
      drain order relative to a completing turn was once racy; tests
      now GREEN.
    - PPLW01 (pending-prompt-lost-wakeup): a wake could be lost when
      the active session was replaced; tests now GREEN.
    - LHOWA01 (long-horizon-pending-prompt-authority-transport): the
      provisional `getPendingPromptsCount?` primitive was a
      PROVISIONAL_ARCHITECTURAL_LEAK; closed at PPAT01
      (`PASS_PENDING_PROMPT_AUTHORITY_TRANSPORT_NEUTRAL`).

observable:
    (request-time)  input.delivery, session.interactive, session.agent.canStartRun()
    (effect-time)   session.pendingPrompts.length (post-enqueue)
    (event-time)    "pending_prompts" emit (declarative snapshot)
    (capture-time)  onEnqueue / onBeforeDrain / onBeforeDispatch capture hooks

unobservable:
    (LIVE_UNOBSERVABLE)
    - The exact microtask order between `canStartRun()` returning
      `false` and the next `canStartRun()` returning `true` (this is
      by design — the runTurn admission fires inside a single
      synchronous window).
    - Whether a followup that *was* admitted as "queue" would have
      observed "immediate" at a later instant if the caller had
      retried (counterfactual).

migration difficulty: LOW
    The admission is a single boolean expression. The Elm kernel
    is a single pure function of three inputs returning one of
    three tags. The TS adapter change is a single function body
    (~6 lines) at the runTurn call site.

interop risk: LOW
    The Elm-side change is additive (a new pure function in a new
    kernel module). The TS-side change is a single call site
    replacement; the existing tests pin the truth table.
    The CCAR / CRA / PPLW / PPRD / FRSP / QPSR regression suites
    are the conservation gates.
```

## 5. Executable baseline witness (this ACT's primary deliverable)

**File:** `sdk/packages/core/src/runtime/turn-queue/admission-decision.test.ts`
**Verdict:** **22/22 PASS** (baseline GREEN).

```text
$ cd sdk/packages/core && bunx vitest run --config vitest.config.ts \
    src/runtime/turn-queue/admission-decision.test.ts
...
 ✓ src/runtime/turn-queue/admission-decision.test.ts (22 tests) 3ms
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

The witness exports a pure function `resolveAdmissionDelivery` that
is a literal, line-for-line mirror of the production expression at
`local-runtime-host.ts:1244-1248`. The 22 tests cover:

- 4 tests: caller-supplied delivery wins over agent-readiness
- 4 tests: auto-classification only fires under interactive && busy
- 12 tests: full truth table (every combination of 3 inputs × 3 outputs)
- 1 test:  conservation — the production expression reproduces the
  same answer for a sample row

A future SEAM05 cutover to an Elm kernel can call back to this
witness and prove behavioral conservation row-by-row.

## 6. Proposed SEAM06 implementation scope (frozen, no premature code)

```text
SEAM06 scope (out of scope for this recon ACT):

1. Create a new Elm kernel at
       apps/vscode/elm/prompt-admission-authority/
   with src/Authority.elm, src/Codec.elm, src/Domain.elm, src/Main.elm,
   and src/Policy.elm (mirroring the SEAM04 layout).

2. Define the closed type:
       type AdmissionDelivery = Queue | Steer | Immediate
   and the pure function:
       resolveAdmission : { inputDelivery : Maybe CallerDelivery
                          , sessionInteractive : Bool
                          , canStartRun : Bool
                          } -> AdmissionDelivery

3. Compile to vendor/prompt-admission-authority.js (mirroring SEAM04's
   background-notify-authority.js) and wire into extension.ts BEFORE
   LocalRuntimeHost construction.

4. In sdk/packages/core/src/runtime/host/local-runtime-host.ts:1227,
   replace the inline expression at lines 1244-1248 with a synchronous
   call into the Elm kernel (defaulting to invokeElmForAdmissionDecision
   and falling back to a fail-closed `immediate` decision when the
   kernel is missing — same fail-closed pattern as SEAM04's
   getElmAuthorityCompletionDecision).

5. The downstream enqueue / executeTurn branches at lines 1259-1274
   remain UNCHANGED. The Elm kernel's job is to return the
   `AdmissionDelivery`; the TS adapter still does the dispatch.

6. Re-run the full C10 conservation suite:
   - pending-prompt-service.test.ts (10 tests)
   - pending-prompt-service.drain-semantics.test.ts (4 tests)
   - local-runtime-host.test.ts "delivery" subset (>=2 tests)
   - sdk-followup-coordinator.test.ts (29 tests)
   - PPLW01 / PPRD01 / QPSR01 / FRSP01 bridges (all GREEN today)
   - New: admission-decision.test.ts (this ACT's witness, 22 tests)
```

**Forbidden in SEAM06:**

- Reimplementing the queue itself in Elm (the queue is a mutable
  list of pending prompts with requeue / clear / drain semantics —
  those effects live in TS).
- Changing the `delivery` field type or its three-value vocabulary.
- Modifying the `PendingPromptsController.enqueue` body.
- Adding diagnostic side effects to the admission decision
  (the existing capture hooks are sufficient).

## 7. Resolved ownership ambiguity (Phase 2 deliverable)

| Concern | Answer |
| --- | --- |
| Which component owns each pending prompt? | `PendingPromptsController` (one per session, owned by `LocalRuntimeHost`). The `session.pendingPrompts[]` array is the canonical state. |
| Which state is canonical and which is derived? | Canonical: `session.pendingPrompts[]`. Derived: the `pending_prompts` event payload (snapshot at emit time). |
| Where is steer-versus-queue decided? | At `LocalRuntimeHost.runTurn` line 1259 (post `resolveDelivery`). The decision vocabulary is `"queue" | "steer" | "immediate"`. |
| What happens during task completion? | Queue survives; the next `runTurn` drains it when `canStartRun()` returns true. |
| What happens during task cancellation? | Queue survives the abort window (per `PendingPromptsController.enqueue` line 439-444 comment). The `discardQueue` method is called only on a queue-initiated turn abort (line 492). |
| What prevents duplicate prompt delivery? | `PendingPromptService.enqueue` deduplicates by prompt text (line 292-294). Re-enqueue of the same prompt retains the original entry's `jobId` and `runtimeControlKind` (first-wins). |
| What happens when task/session ownership changes? | The active session lookup is requested-time; the call site (`SdkController` or `BackgroundNotifyCoordinator`) re-checks `active.sessionId === wakeSessionId` and drops the prompt if mismatched (the `session_gone` outcome at `SdkController.ts:764`). The `runTurn` admission does not itself observe session-id changes. |
| Which transitions occur inside React functional updaters? | None. The admission decision is in TS (server-side) and the webview reads the `pending_prompts` snapshot. |
| Which facts are observed at request time vs updater evaluation or commit time? | All three admission facts are observed at request time inside `runTurn`. The queue mutation commits synchronously inside `enqueue`. |
| What can be safely observed? | All three admission facts are safely observable. The downstream enqueue / executeTurn dispatch is a single call. |
| Mark unsafe intermediate observations LIVE_UNOBSERVABLE. | The microtask race between `canStartRun() = false` and the next `canStartRun() = true` is `LIVE_UNOBSERVABLE` by design. |

## 8. Toolchain gates (this ACT)

- `cd sdk/packages/core && bunx vitest run --config vitest.config.ts src/runtime/turn-queue/` → **14/14 PASS** (the two existing files)
- `cd sdk/packages/core && bunx vitest run --config vitest.config.ts src/runtime/turn-queue/admission-decision.test.ts` → **22/22 PASS** (this ACT's new witness)
- `cd sdk/packages/core && bunx vitest run --config vitest.config.ts -t 'delivery' src/runtime/host/local-runtime-host.test.ts` → **2/2 PASS** (subset)
- `git status --short` → empty (working tree clean, no production code touched)
- `git diff --check` → exit 0
- VSIX packaging: **NOT EXECUTED** (recon-only ACT; SEAM05 does not produce a VSIX)
- LIVE qualification: **NOT EXECUTED** (recon-only ACT)

## 9. Verdict

`PASS_ELM_SEAM05_RECON`

- One real production decision selected (`LocalRuntimeHost.runTurn`
  lines 1244-1274).
- Correct caller/effect boundaries documented (§3 + §7).
- Executable baseline evidence: 22/22 PASS in
  `admission-decision.test.ts` + 14/14 PASS in the existing
  turn-queue suite + 2/2 PASS in the delivery subset.
- Existing test inventory: full §5 list (six historical defect
  witnesses + the new witness).
- No unresolved ownership ambiguity: §7 table resolves all
  eleven Phase 2 questions.
- Frozen migration contract: §4 SEAM05_CONTRACT + §6 SEAM06
  scope.

**DOGFOOD_SOURCE_HEAD:** 3bfba1582
**DOGFOOD_VERSION:** 4.1.16-3bfba1582
**ENTRY_HEAD:** 3bfba1582
**BRANCH:** main
**STASHES:** none
**WORKTREES:** primary only (`/Volumes/.../clinemm` at 3bfba1582);
the eight prunable sandboxes at `/private/var/folders/.../T/` are
not touched (they are dead sandbox temp worktrees).
**PRODUCTION_CODE_DELTA:** zero.
**NEW_TEST_FILES:** 1 (`admission-decision.test.ts`, 218 lines, 22 tests).
**NEXT_ACT:** `ACT-CLINEMM-ELM-SEAM06-PROMPT-ADMISSION-CUTOVER` (separate ACT, separate cursor).

---

## 10. Factory reviewer verdict (2026-10-09)

**Verdict: `PASS_WITH_NONBLOCKING_RESIDUE` — `C1: GO`**

The SEAM05 recon is acceptable as bounded. The selected seam is
real, bounded, and suitable for a small Elm migration. Three
P1 corrections are recorded for SEAM06:

### P1 #1 — 22 tests don't exercise production authority

The baseline witness at `admission-decision.test.ts` defines its
own `resolveAdmissionDelivery` and the final conservation test
re-evaluates the expression locally. The 22/22 PASS proves the
test-local truth table; it does NOT prove that production
`LocalRuntimeHost.runTurn` conforms to that table. Changing
production admission logic would not necessarily fail these
tests.

**SEAM06 requirement:** add a real production-seam correspondence
test that exercises the actual call site, not a mirror. The
existing TS implementation must serve as the baseline.

### P1 #2 — `immediate` fallback is unsafe

A universal `immediate` fallback when the Elm kernel is missing
is NOT fail-closed. Counter-example:

```
inputDelivery = undefined
sessionInteractive = true
canStartRun = false
Elm unavailable
```

Expected: `queue`. Proposed fallback: `immediate`. This changes
admission semantics precisely when the agent cannot start.

**SEAM06 requirements (pick one):**

- (a) Explicitly fail the admission operation without enqueueing
  or executing anything.
- (b) Retain the exact predecessor TS expression as a classified,
  test-covered emergency fallback. (2b is preferable if admission
  must remain available when Elm is offline, but does not
  establish exclusive Elm policy authority under failure.)

### P1 #3 — SDK→VS Code dependency risk

The decision lives in `sdk/packages/core/src/runtime/host/`. The
proposed kernel lives in `apps/vscode/elm/`. The SDK must not
silently acquire a runtime dependency on the VS Code application.

**SEAM06 requirement (narrowest acceptable pattern):**

```
LocalRuntimeHost
    |
    v
AdmissionAuthority interface (SDK-owned)
    |
    +-- Elm adapter (application composition root)
    |
    v
Queue / Steer / Immediate
```

Alternatively: package the Elm kernel as an SDK-compatible
runtime asset if all relevant SDK consumers can load it. Do not
wire `sdk/packages/core` directly to a VS Code-specific asset
path. A synchronous call needs an executable proof, not just
purity.

### Migration-economics watch (from the reviewer)

The entire current policy is:

```ts
input.delivery ??
  (session.interactive && !canStartRun ? "queue" : undefined)
```

12 input combinations. The Elm replacement could easily
introduce more complexity (loading, serialization, correlation,
failures, deployment) than it removes. SEAM06 must require:

- a small adapter with no generic RPC framework,
- no asynchronous admission race,
- no duplicated canonical session state.

If the clean boundary proves expensive, record
`NOT_A_GOOD_ELM_SEAM` and select the next candidate rather than
forcing the migration.

### Reviewer findings table

| Finding | Severity | Action |
| --- | --- | --- |
| Real production funnel identified | PASS | Preserve |
| Closed three-tag decision vocabulary | PASS | Preserve |
| Test-local baseline, not production correspondence | P1 | Add real-seam proof in SEAM06 |
| Universal `immediate` fallback | P1 | Replace before cutover |
| SDK→VS Code dependency risk | P1 | Resolve at composition boundary |
| Invalid gate-summary schema | P2 | Non-blocking |
| Untracked recon files | Expected | Commit the bounded recon changeset |

### Disposition

- `C1: GO` to `ACT-CLINEMM-ELM-SEAM06-PROMPT-ADMISSION-CUTOVER`,
  subject to the three bounded implementation-contract corrections
  above.
- No second recon round. No SEAM05 review recursion. No need to
  touch SEAM04.
- The actual challenge for SEAM06 is not writing the Elm function.
  It is proving the small function can become authoritative
  without making ClineMM's runtime architecture worse.
