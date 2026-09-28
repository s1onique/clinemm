# ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02

**Epistemic purpose:** live evidence acquisition → causal isolation →
one bounded repair only if RED reproduces.

**Predecessor:** `ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01`
(closure at HEAD `6a4368787e331e44d700184f8dc5280285850d66`,
production change limited to acquisition diagnostic surface +
automation helper).

**Priority:** P0

**Initial verdict:** `OPEN_LIVE_P0`

**Stall class:** POST_CONTINUATION_RUN_STALL

**Live evidence class:** REAL (operator-supplied CCARD JSONL +
liveness JSONL, both SHA-256 frozen into
`.factory/evidence/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02/`).

---

## §0 — Why this ACT exists

A real installed-Codium run (`4.1.16-a0d496408`, profile
`.vscodium-clinemm`, session `1790633775136_8mrnl`, provider
`minimax`, model `MiniMax-M3`) now records a new completion stall:

```text
run_turn_started          = 3
agent_turn_done           = 2
submit_and_exit_seen      = 2
task_completion_committed = 1
```

The continuation chain up to and including `run_turn_started #3` is
healthy; the run never reaches `agent_turn_done #3`. This is **not**
a myc-prime diagnosis ACT. It is a new P0 in the
continuation/finalization execution chain.

The predecessor ACT did NOT change the run path; its production
surface is the acquisition diagnostic module only
(`myc-prime-live-diag.ts` + `myc-prime-automation.ts`).

---

## §1 — Frozen live RED

### Live artifacts (SHA-256 verified)

| Artifact | Path | SHA-256 |
|---|---|---|
| Cardinality JSONL | `.factory/evidence/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02/continuation-cardinality-authority.jsonl` | `2fab1cc4c2f88162cc9e4ccd0186d0dbff48f603bd445adb1a1fc1066b9e0ddd` |
| Liveness JSONL | `.factory/evidence/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02/background-job-liveness-authority.jsonl` | `1ec462d986f93a73dafa6cae4cfdab3dcb2d488c29945e8a1ca81ab963c20541` |

### Live chronology (verbatim from JSONL)

```text
seq  1   1790633511358  run_turn_started           origin=explicit_user       session=1790633511093_34re2  (RUN #1)
seq 20   1790633547011  submit_and_exit_seen       origin=pending_prompt_drain session=1790633511093_34re2
seq 21   1790633547011  task_completion_committed  origin=pending_prompt_drain session=1790633511093_34re2
seq 22   1790633547049  agent_turn_done            origin=explicit_user       session=1790633511093_34re2  (RUN #1 ENDS)
seq 23   1790633775379  run_turn_started           origin=explicit_user       session=1790633775136_8mrnl  (RUN #2)
... [many terminal_committed events for the bun test-suite jobs in between] ...
seq153   1790634915728  submit_and_exit_seen       origin=pending_prompt_drain session=1790633775136_8mrnl  (RUN #2 finish)
seq154   1790634915728  pending_prompt_enqueued    origin=pending_prompt_drain session=1790633775136_8mrnl promptId=pending_1790634915728_WJ4Cj
seq155   1790634915774  agent_turn_done            origin=explicit_user       session=1790633775136_8mrnl  (RUN #2 ENDS)
seq156   1790634915775  pending_prompt_dequeued    origin=pending_prompt_drain session=1790633775136_8mrnl promptId=pending_1790634915728_WJ4Cj
seq157   1790634915775  continuation_scheduled     origin=pending_prompt_drain session=1790633775136_8mrnl promptId=pending_1790634915728_WJ4Cj
seq158   1790634915775  run_turn_started           origin=explicit_user       session=1790633775136_8mrnl  (RUN #3 STARTS — STALL)
[no further capture — ~30 s later: extension_shutdown M8]
```

Live liveness (liveness-authority) shows a fresh `manager_constructed`
at T=4915746 (29 ms BEFORE seq 158), `source=VscodeSessionHost.create`,
managerInstance=M8 — i.e. the continuation's per-session
`CommandJobManager` was constructed in time. ~30 s later that M8
instance is disposed via `manager_dispose_*` with
`reason=extension_shutdown` (the operator closed Codium).

### Live RED classification

```text
LIVE_RED_CLASS   = REAL
LIVE_RED_KIND    = POST_CONTINUATION_RUN_STALL
LIVE_SESSION_ID  = 1790633775136_8mrnl
LIVE_TASK_ID     = 1790633775136_8mrnl
LIVE_RUN_2_START = 1790633775379
LIVE_RUN_3_START = 1790634915775
LIVE_RUN_3_END   = NOT_OBSERVED (operator closed Codium at ~4914945857)

RUN3_IDENTITY = continuation_scheduled (C6) and run_turn_started (C7)
                both carry sessionId=1790633775136_8mrnl and the
                same promptId=pending_1790634915728_WJ4Cj. Run #3 IS
                the continuation of run #2 in the same session.
```

### Frozen exclusions (per ACT body §4)

NOT the suspect: PendingPromptsController.enqueue, scheduleDrain,
pending-prompt dequeue, continuation scheduling, BCB held-
observation consumption, completion presentation filter, MCP
session bootstrap (already repaired at FRBS01, `89249175c`, in
HEAD history).

---

## §2 — Source recon (seam map)

### Production seam chain (verbatim file:line)

```text
CONTINUATION_SCHEDULE_SEAM  = apps/vscode/src/sdk/vscode-session-host.ts:518
RUN_TURN_STARTED_RECORDER   = sdk/packages/core/src/runtime/host/local-runtime-host.ts:1227
LOCAL_RUNTIME_RUN_ENTRY     = sdk/packages/core/src/runtime/host/local-runtime-host.ts:1172 (async runTurn)
EXECUTE_TURN_ENTRY          = sdk/packages/core/src/runtime/host/local-runtime-host.ts:2020 (private async executeTurn)
EXECUTE_AGENT_TURN_ENTRY    = sdk/packages/core/src/runtime/host/local-runtime-host.ts:2194 (private async executeAgentTurn)
RUN_WITH_AUTH_RETRY_ENTRY   = sdk/packages/core/src/runtime/host/local-runtime-host.ts:2790
AGENT_RUNTIME_RUN_ENTRY     = sdk/packages/agents/src/agent-runtime.ts:880 (async run) / :884 (async continue) → :1493 (private async execute)
AGENT_TURN_DONE_RECORDER    = sdk/packages/core/src/runtime/host/local-runtime-host.ts:1248
```

### First currently-unobservable production boundary

After seq 158 (`run_turn_started #3`, T=4915775), the existing
diagnostics capture ONLY the OUTER pair (C7 fired at runTurn entry →
C8 fired at runTurn exit). Between them:

```text
executeTurn → executeAgentTurn → runWithAuthRetry
  → session.agent.run / continue
    → AgentRuntime.execute
      → callBeforeRunHooks
      → emit "run-started"  (observable in agent-event stream, NOT in CCARD)
      → while loop:
        → prepareTurnForModelRequest (await config.prepareTurn)
        → beforeModel hooks          (myc-prime injection etc.)
        → openTaskLifecycleStream    (model.stream)
        → for-await chunks
      → emit "run-finished"
```

The CCARD JSONL does NOT distinguish between:

* A. C7 fired, AgentRuntime.execute entered, model.stream never returned
* B. C7 fired, AgentRuntime.execute never entered (stall is in
   `executeTurn`'s prelude: `prepareTurnInput`,
   `ensureSessionPersisted`, `refreshActiveSessionGitMetadata`,
   `syncOAuthCredentials`, `markTurnRunning`)

### Preferred discriminator (per ACT body §7)

```text
R3-01 run_turn_started                   (already captured — seq 158)
R3-02 runtime_prelude_enter              (NOT currently captured)
R3-03 agent_runtime_run_enter            (NOT currently captured)
R3-04 agent_turn_done                    (already captured — absent → stall)
```

The first currently-unobservable seam is `R3-02` (the host-side
`executeTurn` prelude: `prepareTurnInput` → `ensureSessionPersisted`
→ `refreshActiveSessionGitMetadata` → `syncOAuthCredentials` →
`markTurnRunning`).

---

## §3 — Required new observation seam (one bounded pair)

### What we add

ONE new CCARD stage value (and a single capture site in
`LocalRuntimeHost.executeTurn`), default-off (captureEnabled starts
false), no public API, no wire/protocol field, no React-side state.

* New stage: `execute_turn_prelude_enter` (frozen per ACT §3
  contract; adding new values is a breaking change for downstream
  tests, so this name is fixed).
* Capture site: at the top of `executeTurn(session, input)` in
  `sdk/packages/core/src/runtime/host/local-runtime-host.ts`, BEFORE
  the await chain runs.

### Why this seam

This is the FIRST boundary after C7 (`run_turn_started`) that the
existing diagnostics do NOT cover. It distinguishes:

* `C7 fired → execute_turn_prelude_enter fired → (no C8)` →
  `EXECUTE_TURN_PRELUDE_STALL` (stall inside `executeAgentTurn`
  → `AgentRuntime.execute` → model.stream / beforeModel hooks /
  prepareTurn / compaction).
* `C7 fired → execute_turn_prelude_enter NOT fired → (no C8)` →
  `EXECUTE_TURN_PRELUDE_HUNG` (stall inside the prelude awaits
  themselves: session persistence, git metadata refresh, OAuth
  credential sync, status update).

This is the minimum additional seam needed to discriminate the
remaining hypotheses without violating ACT §8 (one file, one
bounded enter/exit pair, default-off, no public API, no wire field).

---

## §4 — RED reproduction (production-shape)

### RED properties (per ACT §11)

1. Real continuation scheduling seam (real `PendingPromptsController`).
2. Real runtime bootstrap seam (real `LocalRuntimeHost.runTurn`).
3. Real terminal completion propagation (real `executeTurn` →
   `executeAgentTurn`).
4. No direct test-body call to the suspected helper.
5. No fake `agent_turn_done`.
6. No test-owned constant asserting itself.
7. No arbitrary sleeps as the causal mechanism.
8. A small injected dependency at the actual failing boundary is
   allowed.

### RED shape

A test wires the real `LocalRuntimeHost` (no production-shape mock)
through `runTurn` and asserts:

```text
Given the CCARD capture seam is ON and a real LocalRuntimeHost
exposes an executeTurn-prelude gate that the test holds OPEN:

When runTurn is invoked once with delivery=undefined:

Then the capture ring shows (in order):
  run_turn_started #1
  execute_turn_prelude_enter #1

And (no agent_turn_done — the prelude gate is held open)
```

This proves the new seam fires when the prelude actually runs
(without the repair, no capture exists → no `execute_turn_prelude_enter`
record is observed). With the seam added, the diagnostic makes
the stall observable.

### RED stop rule

If RED does not reproduce (the prelude does fire on the real
seam): `HALT_RED_NOT_REPRODUCED` — keep the diagnostic seam
(default-off), do NOT repair.

---

## §5 — Conservation (per ACT §17)

Unchanged behavior:

* `PendingPromptsController.enqueue` — NOT touched.
* `scheduleDrain` — NOT touched.
* pending-prompt dequeue — NOT touched.
* continuation scheduling — NOT touched.
* BCB held-observation consumption — NOT touched.
* completion presentation filter (`sdk-session-event-coordinator.ts`) —
  NOT touched.
* `command_status` consumption — NOT touched.
* MCP session bootstrap (FRBS01 repair) — NOT touched.
* myc — NOT touched.
* myc DB — NOT touched.
* provider capture format — NOT touched.
* MCP protocol — NOT touched.
* automatic-prime acquisition (`myc-prime-live-diag.ts`,
  `myc-prime-automation.ts`) — NOT touched.

Required conservation rerun (frozen per ACT §17):

```text
PCCA01       CCARD01       BCB01 family     CCARD01       PPLW01
TQCB01       AUTOSTART01   FINALIZATION-RUN-BOOTSTRAP-STALL01
myc-prime-live-diag.test.ts          myc-prime-live-diag-readout.test.ts
myc-prime-automation.lifecycle01 / lifecycle02
```

Do NOT reopen unrelated existing failures.

---

## §6 — Repair authorization

ONLY if RED reproduces (§11 / §14). Budget:

```text
production files <= 2     (sdk CCARD module + LocalRuntimeHost capture site)
new public API = 0
new protocol fields = 0
new retry loop = 0
new polling loop = 0
myc changes = 0
queue redesign = 0
BCB redesign = 0
```

---

## §7 — HALT conditions

```text
HALT_RED_NOT_REPRODUCED          — RED does not reproduce → no repair
HALT_CONTINUATION_IDENTITY_MISMATCH — run #3 sessionId ≠ run #2 sessionId
                                    (NOT observed: same sessionId)
HALT_SCOPE_EXPANSION_REQUIRED     — repair budget exceeded
HALT_NECESSITY_NOT_PROVEN         — ablation returns GREEN with repair removed
HALT_LIVE_REPRODUCTION_AFTER_REPAIR — operator reports stall at same boundary post-fix
HALT_NEW_P0                       — different boundary appears in next live run
CAPTURE_INSUFFICIENT              — even with new seam, boundary cannot be
                                    discriminated (NOT anticipated)
```

---

## §8 — Live qualification (per ACT §21)

```text
POSTFIX_RUN3_STARTED = 1
POSTFIX_RUN3_DONE    = 1   (this is the load-bearing assertion)
POSTFIX_STALL        = false
TASK_COMPLETION_COMMITTED = 1
VISIBLE_COMPLETION_COUNT = 1
Working = false
Cancel   = false
persistent Your turn = false
```

ClineMM does NOT launch Codium. Operator drives the live run.

---

## §9 — Success criteria (per ACT §25)

```text
LIVE_RED_PRESERVED                = true   (SHA-256 captured above)
CONTINUATION_IDENTITY_PROVEN      = true   (sessionId match, promptId match)
FIRST_UNMATCHED_BOUNDARY_IDENTIFIED = true (execute_turn_prelude_enter)

RED_REPRODUCED                    = required to attempt repair
CAUSAL_DISCRIMINATOR              = PASS
ABLATION                          = PASS

BOUNDED_REPAIR                    = 1 file CCARD module + 1 capture site
CONSERVATION                      = PASS
TYPECHECK                         = PASS
VSCODE_PREPUBLISH                 = PASS
DIFF_CHECK                        = PASS

EXACT_HEAD_ARTIFACT_BOUND         = required
POSTFIX_LIVE_RUN3_DONE            = required (operator)
POSTFIX_STALL                     = false (operator)
```

---

## §10 — Implementation head identity (per ACT §19)

```text
ENTRY_HEAD              = 6a4368787e331e44d700184f8dc5280285850d66
IMPLEMENTATION_HEAD     = <discovered post-commit>
SUBJECT_HEAD            = IMPLEMENTATION_HEAD
CLOSURE_HEAD            = <discovered post board-row commit>
```

The prior acquisition artifact's UNCOMMITTED head placeholders
(per ACT body §19) are out of scope for this ACT and are corrected
separately.

---

## §11 — Stop condition

```text
Find the first unmatched boundary.
Prove it with RED.
Fix only that boundary.
Qualify it live.
Stop.
```