# ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02

> Status: **CLOSED / GREEN /
> NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY /
> HANDOFF_RUNTIME_TASK_PROGRESSION /
> STOP = yes**.
>
> Verdict: `P1_RESULT_PUBLICATION_TO_SESSION_EVENT = GREEN`
> (exercised `[1] -> [3]` contract is conserved for the tested
> RESULT_EXISTS-shaped schedule; see final-report.md).
>
> Owner: `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01`
> Cluster: **POST_TOOL_ADVANCE_STALL** (new cluster label; promotion
> of upstream signals that RECON01 left at RADAR / cluster-assigned).
> Predecessor: `ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01`
> (CLOSED, NOT_REPRODUCED at the foreground-await seam; STRUCTURAL
> hazard; broader radar preserved as RADAR-only).
> Adjacent operator-only frontier (NOT in scope of this ACT):
> `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`
> (`HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND`; LIVE bind is
> operator-gated).
>
> ```text
> ENTRY_HEAD       = a90f36a4b501a3c47c43b4df8d8c1c79e7e5d3a4
>                    (= HEAD = origin/main at ACT opening)
> ORIGIN_MAIN      = a90f36a4b501a3c47c43b4df8d8c1c79e7e5d3a4
> DOCS_HEAD        = (this file's commit; not yet committed)
> CAUSE            = UNKNOWN
> REPAIR_AUTHORIZED = NO
> LANE_OF_PRECEDENT = TOOL-RUNTIME-RELIABILITY (post-tool advance stall
>                     is a structurally-distinct failure class from
>                     RECON01's foreground-await hazard; both share
>                     "post-execution runtime stuck" as the user-visible
>                     symptom but their CAUSE domain is disjoint per
>                     the durable scope boundary in
>                     `.factory/epics/tool-runtime-reliability.md`)
> UPSTREAM_RADAR   = 3 (this cycle)
>                    LOAD_BEARING (RESULT_EXISTS established):
>                    #10537  cline/cline  v3.82.0 hangs at "Thinking"
>                            after terminal command returns
>                    #10122  cline/cline  freezes in thinking after
>                            execute_command reads terminal output
>                    ADJACENT_RADAR (no RESULT_EXISTS evidence):
>                    #13691  cline/cline  v4.1.16 emits tool calls but
>                            "nothing else happens" — does NOT
>                            establish that a tool result exists
> OPERATOR_GATE    = NO (this ACT is headless-runnable)
## Mission (verbatim from launch contract)

> RECON02 mission (from the Factory reviewer reopening this lane
> on 2026-09-01):
>
> ```text
> Determine whether current ClineMM has a reachable production path
> where a tool invocation has completed sufficiently for its result
> to exist, but the agent/runtime fails to advance to the next
> model/runtime state.
>
> CAUSE = UNKNOWN.
> ```
>
> Do not assume:
>   - foreground waiter
>   - terminal manager busy residue
>   - TurnState bug
>   - model-provider bug
>   - parser bug
>   - UI projection bug
>
> The failure family is:
> ```text
> tool invocation completed (RESULT_EXISTS is true)
> → runtime fails to advance
> → task remains Thinking / tool processing stalls
> ```
>
> `RESULT_EXISTS` is the **frozen entry seam** of this ACT. Anything
> before it is a tool-routing outcome and is explicitly
> **`OUT_OF_SCOPE_TOOL_RESULT_NOT_PRODUCED`** — it is not a RECON02
> causal class.
>
> Three current upstream issues establish a valuable failure family,
> NOT its cause. The load-bearing subset has evidence of
> `RESULT_EXISTS`; the third does not and is carried only as
> adjacent RADAR:
>
> ```text
> LOAD_BEARING (result EXISTS, runtime does not advance):
> #10537  command output returns successfully, then Cline remains
>         indefinitely in "Thinking."
> #10122  repeated terminal-command completion followed by a frozen
>         thinking state; UI can become unrecoverable.
>
> ADJACENT RADAR (does NOT establish result EXISTS — out of
> RECON02's frozen entry seam):
> #13691  tool calls are emitted but then "nothing else happens,"
>         including run_commands, read_files, and search_codebase.
>         Carried for trace; NOT a load-bearing witness for RECON02.
> ```
>
> These reports establish **a valuable failure family**, not its cause.
>
> Heterogeneous internal classification: #12079 (command ran →
> UI records "skipped" → Thinking hangs → user-restart only) is
> superficially similar but its internal classification may differ
> from #10537 / #10122. The heterogeneity is exactly why
> `CAUSE = UNKNOWN` and production-seam RED discipline are appropriate.

## Scope perimeter

### IN (frozen at `RESULT_EXISTS`)

- The chain from tool-result-existence to conversation / session-event
  advance. The frozen entry seam is `RESULT_EXISTS`; the chain
  begins at result publication, NOT before:
  ```text
  RESULT_EXISTS                                    ← frozen entry seam
  → result publication
  → conversation / message append
  → continuation / model request scheduling
  → TurnState / session-event transition
  → provider / model response boundary
  → UI projection
  ```
- Inventory of existing tests and diagnostics at every boundary
  above (the §1 source-seam-map recon).
- A single production-seam discriminator (§2 `P1_RESULT_PUBLICATION_TO_SESSION_EVENT`),
  driving a **REAL_PRODUCTION_SEAM** end-to-end through the
  `[1]→[3]` portion of the chain.
- Causal classification only after a RED is observed at one of the
  A-F schedules.

### REAL_PRODUCTION_SEAM admissibility (frozen)

```text
RED must invoke the actual production coordinator / function / module.

Fakes / adapters around external dependencies are allowed.

Source extraction, copied orchestration, new Function(),
synthetic state machines, or helper reimplementations are
SYNTHETIC_REAL at best and cannot satisfy RED.
```

This is exactly the lesson RECON01 taught: structural probes that
manufacture a stuck awaitable are NOT REDs. The §2 schedules MUST
drive real production code end-to-end; an extracted or re-implemented
control flow is admissible only as a `SYNTHETIC_REAL` probe and must
be filed separately with that label.

### OUT (deliberate, do NOT touch)

- RECON01's closed territory:
  - foreground await structural hazard (RECON01 §6 closed)
  - `executeForeground` / `VscodeTerminalProcess.run()` /
    `CommandJobManager.start()` completion-authority seams
    (RECON01 A1-A4 closed)
  - tool-runtime-reliability's structural observation that the
    production seam always emits `completed` in every reachable
    branch (RECON01 §6)
- The `runtime-task-progression` epic's territory (post-tool state
  transitions). This ACT will cross-reference but does NOT subsume
  it; if the broken boundary turns out to be a
  runtime-task-progression defect (e.g. TurnState never transitions
  out of a phase), this ACT returns the boundary classification
  to the runtime-task-progression epic and STOPS. No repair ACT
  is authored here.
- `tool-execution-semantics01` (telemetry classification) — out
  per the durable scope boundary in
  `.factory/epics/tool-runtime-reliability.md`.
- `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01` — that
  ACT's LIVE-first-idle-writer bind is operator-gated; this ACT
  neither waits for nor depends on its closure. They are parallel
  frontiers on a related surface.
- Repair (per §5 STOP). No production code change in this ACT.

## Production seams exercised (planned)

This ACT will inventory the existing test coverage at each
boundary, and where there is a real gap and a 50-line probe can
reach the stuck state, add a single probe. Per §4 of the reviewer's
contract: **prefer one 50-line probe over new infrastructure.**

The intended probe surface (to be confirmed by inventory):

1. `apps/vscode/src/sdk/vscode-run-commands-tool.ts`
   - `executeForeground(...)` post-completion return path
   - `createVscodeRunCommandsTool(...)` tool-result wrapper
2. `apps/vscode/src/sdk/command-job-manager.ts`
   - `CommandJobManager.start()` -> `finalize()` path
   - `terminalPromise` -> `TerminalTransition` resolution
3. `apps/vscode/src/sdk/sdk-foreground-command-coordinator.ts`
   - boundary between tool result and message coordinator
4. `apps/vscode/src/sdk/sdk-message-coordinator.ts`
   - tool-result-to-message publication
5. `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`
   - session-event emission after tool completion
6. `apps/vscode/src/sdk/sdk-followup-coordinator.ts`
   - followup-on-follow-up-abandoned branch (cross-reference
     BHTD01 candidate B)
7. `apps/vscode/src/sdk/sdk-compaction-coordinator.ts`
   - compaction-vs-continuation race after tool completion
8. `apps/vscode/src/sdk/turn-state-tracker.ts`
   - `TurnStateTracker.publishTurn` / `commitTurn`
   - `taskId` / `epoch` stamping (cross-reference BHTD01 candidate A
     `controller-epoch-transition-reseed`)
9. `apps/vscode/src/sdk/SdkController.ts`
   - top-level task loop (the analog of the classic
     `recursivelyMakeClineRequests`)
   - SdkController.task-telemetry-wiring.test.ts for existing
     coverage shape

## §2 Single production-seam discriminator

The earlier A–F plan was retracted in the same turn per reviewer
P1 corrections (it re-entered closed pre-RESULT_EXISTS territory
and proposed a non-semantic writer-cardinality oracle). RECON02
now owns **one** discriminator, at the only boundary inside its
frozen entry seam that names a causal candidate for the failure
family.

### `P1_RESULT_PUBLICATION_TO_SESSION_EVENT`

```text
REAL_PRODUCTION_SEAM:
  SdkMessageCoordinator  (apps/vscode/src/sdk/sdk-message-coordinator.ts:20)
  TaskProxy               (apps/vscode/src/sdk/task-proxy.ts)
  MessageIdMinter         (apps/vscode/src/sdk/message-id-minter.ts)
  pushMessageToWebview    (vi.mock — natural external seam)

INPUT (real shape, NOT a structural probe):
  one ClineMessage shaped like a tool_result publication:
    ts: monotonically increasing
    type: "say"
    say: "tool_result"
    text: a small synthetic stdout
    partial: false

FLOW (real path):
  appendAndEmit(messages, event)
    → appendMessages(messages)            [stamps seq/epoch]
    → emitSessionEvents(messages, event)  [fan-out to listeners]

ASSERTIONS (no event-count oracle, no TurnState premise,
NO JavaScript reference-identity oracle — semantic identity only):
  1. after appendAndEmit returns, getClineMessages() contains two
     messages whose semantic fields (ts / type / say / text /
     partial / epoch) match the inputs
  2. the listener was called once per appendAndEmit and the
     listener received an array whose single element carries
     the same say / text / seq / epoch as the appended message;
     the session event passed to the listener equals the event
     passed to appendAndEmit
  3. seq is positive and strictly monotonic across the two
     appendAndEmit calls; epoch equals minter.epoch for both
  4. appendAndEmit is synchronous and bounded — its call returns
     without throwing and the listener count advances before the
     call returns; no setImmediate budget is required

(`ClineMessage` does not expose a `taskId` field; `taskId` lives
on the TaskProxy. The earlier draft claim that the message
stamped inside the coordinator has `taskId === session-123` is a
fossil and is removed. Reference-identity assertions such as
`stored[0] === first[0]` are also removed because they would
RED on a defensively-cloned implementation even when every
semantic field needed for continuation is preserved.)
```

### What P1 does NOT assert

- It does NOT count `setWithWriter` invocations. Writer cardinality
  is implementation bookkeeping; a correct runtime may legitimately
  emit more or fewer TurnState writes while preserving behavior.
- It does NOT require a TurnState transition out of any phase.
  TurnState represents turn/model liveness, not every subordinate
  process lifecycle (per the background-handoff work).
- It does NOT drive `SdkForegroundCommandCoordinator` or any
  pre-RESULT_EXISTS path.
- It does NOT touch the `saveClineMessagesTimer` debounce as a
  causal candidate (`SAVE_DEBOUNCE = STRUCTURAL / PERSISTENCE
  PATH / NOT CURRENTLY CAUSAL` per the §1 demotion).

### Disposition

```text
RED  (P1) → B or C territory inside RECON02's owned range
            → if causal → ROOT_CAUSE_ISOLATED;
              child BOUNDED REPAIR ACT authorized as a
              follow-on ACT (NOT pre-authorized here)
            → if NOT causal → CAPTURE_INSUFFICIENT;
              follow-on ACT required

GREEN (P1) → [1]→[3] conserved at the production seam;
            FIRST_UNTESTED_BOUNDARY = continuation scheduling
            OWNER = runtime-task-progression epic
            RECON02 disposition =
              NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY
              / HANDOFF_RUNTIME_TASK_PROGRESSION
            STOP = yes
```

> **No fake "promise that never resolves."**
>
> A RED is admissible only if the production seam itself reaches
> the stuck state. A test that injects an unrecoverable awaitable
> to manufacture a stall is a **STRUCTURAL** observation (consistent
> with RECON01's discipline), NOT a RED.

> No follow-on probes are written speculatively. The next ACT (if
> any) lives at the runtime-task-progression epic and is not
> pre-authorized here.

## §3 First broken boundary (classification-only)

After a RED is observed at a REAL_PRODUCTION_SEAM (entry seam
`RESULT_EXISTS` already crossed), classify the stuck state into one
of:

| CASE | Stuck-where                                        |
|------|----------------------------------------------------|
|      |                                                    |
| OUT_OF_SCOPE_TOOL_RESULT_NOT_PRODUCED               |
|      | result was never produced; pre-`RESULT_EXISTS`     |
|      | routing outcome; NOT a RECON02 causal class         |
|      |                                                    |
| B    | result EXISTS but not published                    |
| C    | published but not appended to conversation         |
| D    | appended but continuation not scheduled            |
| E    | continuation scheduled but runtime state stuck     |
| F    | provider / model response boundary                |
| G    | UI-only projection defect                          |

> **Do not repair in RECON02.**
>
> The classification output is a one-shot artifact for the
> closing ACT's `final-report.md` and for the epic ledger update.
> Any child ACT authored from this classification will be a
> BOUNDED REPAIR ACT in its own right (under the same factory
> discipline as CORRECTION01..06 chains), and is NOT pre-authorized
> here.

## §4 Causal discriminator

Use existing instrumentation where possible.

> **Capture exact identities:**
> ```text
> taskId
> epoch
> toolCallId
> request / result chronology
> turn / session state
> ```
>
> **Prefer one 50-line probe over new infrastructure.**

The existing diagnostics that may be reused (to be confirmed by
inventory in the source-seam-map):

- `apps/vscode/src/sdk/turn-state-tracker.ts` (TSWPD) — already
  wired in production; can capture writer + previous.phase +
  committed.phase + taskId + epoch transitions. See
  `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`
  §10 for the writer-provenance capture protocol.
- `apps/vscode/src/sdk/host-ownership-diagnostic-runtime.ts`
  — runtime-state diagnostic, mirrors TSWPD context shape.
- `apps/vscode/src/sdk/task-telemetry-tracker.ts` — task elapsed
  time tracker with frozen `endedAt` discipline.
- `apps/vscode/src/services/telemetry/TelemetryService.ts:1331`
  — already records "when terminal execution hangs or gets stuck"
  (existing signal; reuse).
- `apps/vscode/src/sdk/sdk-interaction-coordinator-p-probe.test.ts`
  — shape reference for production-seam probes.

## §5 STOP

The ACT closes at one of three verdicts:
## Out-of-scope RADAR (carry forward from RECON01)

These remain RADAR per RECON01's verdict and are NOT re-litigated
by this ACT. They are listed here only so a future ACT does not
mistake this ACT for closing them:

| #     | Surface                                              | RECON01 status        |
|-------|------------------------------------------------------|-----------------------|
| 11550 | accumulated terminals; later trivial commands timeout   | mechanism plausible, not reachable at HEAD (RECON01 §6) |
| 10931 | interactive/pager waits indefinitely                 | A1 covers branch; production settles (RECON01 §6) |
| 12079 | command executes but UI records "skipped" and hangs   | DEFERRED (task-progression out of scope) |
| 10063 | shell syntax error followed by terminal stall        | not reproduced at production state machine (RECON01 §6) |

## Adjacent operator-only frontier (carried, NOT blocked on)

```text
ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
  status      = HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND
  state       = LIVE_FIRST_IDLE_WRITER = UNBOUND
  ACT verdict = live anomaly PROVEN, discriminator machinery
                READY (synthetic-real PASS), live bind requires
                one operator TSWPD capture cycle on the live
                recurrence
  parallel?   = YES — RECON02 does not depend on this ACT's
                closure, and this ACT does not unblock RECON02
  block       = operator + live VSCode host + live recurrence
                (none of which this shell can supply)
```

## Hard-stop rule (RECON02)

This ACT does NOT authorize a repair. The earlier lesson from
RECON01 is preserved:

- **No fake "promise that never resolves" probe** (`RECON01`'s
  `HALT_RED_NOT_PRODUCTION_REPRODUCTION`).
- **No ROOT_CAUSE_ISOLATED overclaim from a structural hazard**
  (RECON01's `ROOT_CAUSE_ISOLATED` walk-back).
- **No scope expansion into `runtime-task-progression`** —
  if the broken boundary belongs to that epic, RECON02 returns
  the boundary classification and STOPS.
- **No production source edit.**

## Reviewer's contract (from the C1 GO of the prior halt)

The Factory reviewer's reopening of this lane explicitly authorizes:

1. The ACT IS headless-runnable — no operator gate.
2. The probe IS production-seam — no fake awaitable.
3. The verdict is one of ROOT_CAUSE_ISOLATED / NOT_REPRODUCED /
   CAPTURE_INSUFFICIENT — three options, no other outcome.
4. No child repair ACT is pre-authorized.
5. The BACKGROUND-HANDOFF-DISCRIMINATOR ACT remains
   WAITING_FOR_OPERATOR — RECON02 runs in parallel and does not
   wait for its operator step.

## ACT ledger

```text
ACT_ID          = ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02
PARENT_EPIC     = EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01
PRECONDITION    = RECON01 CLOSED (NOT_REPRODUCED) — preserved as
                  the foreground-await structural-hazard verdict
PARALLEL_FRONT  = ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
                  (operator-gated; not blocking)
UPSTREAM_RADAR  = #10537, #10122 (load-bearing, RESULT_EXISTS established)
                 #13691 (adjacent RADAR, no RESULT_EXISTS evidence)
OUT_OF_SCOPE_RADAR = #11550, #10931, #12079, #10063 (carry from RECON01)
PRODUCTION_DELTA_PLANNED = ZERO
REPAIR_AUTHORIZED = NO
```

## Evidence

```text
.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02/
  entry-freeze.txt     (this ACT's freeze: HEAD, branch, worktree,
                        frozen entry seam, production-seam admissibility,
                        load-bearing + adjacent upstream radar)
  source-seam-map.md   (§1 inventory — AUTHORED. Boundaries [1]-[8]
                        of the post-tool advance chain mapped to real
                        production seams + existing tests + diagnostic
                        surfaces; three cross-boundary gaps identified;
                        §2 probe candidates A-F mapped to the gaps;
                        ≤50-line REAL_PRODUCTION_SEAM discipline
                        preserved per the reviewer's contract.)
  probe-result-publication-to-session-event.md
                      (planned §2 — ONE production-seam
                       discriminator at the [1]→[3] boundary;
                       REAL_PRODUCTION_SEAM; ≤50 lines including
                       imports + assertions)
  final-report.md      (planned §3 classification + §5 verdict)
```

`source-seam-map.md` is the §1 inventory step. The single
`probe-result-publication-to-session-event.md` is the §2
discriminator and is the only probe RECON02 authors. No A–F
follow-ons are pre-authorized — the next ACT (if any) lives at
the runtime-task-progression epic.

## Final disposition (CLOSED — GREEN — 2026-09-01)

```text
RECON02_STATUS       = CLOSED
RECON02_PURPOSE      = REPRODUCTION_AND_BOUNDARY_CLASSIFICATION
CAUSE                = UNKNOWN at [1]->[3]; the boundary is CONSERVED
ENTRY_SEAM           = RESULT_EXISTS (frozen)
UPSTREAM_RADAR       = 2 load-bearing (#10537, #10122)
                         + 1 adjacent (#13691, no RESULT_EXISTS)
                         + 1 heterogeneous witness (#12079)
PRODUCTION_DELTA     = ZERO
REPAIR_AUTHORIZED    = NO
VERDICT              = P1_RESULT_PUBLICATION_TO_SESSION_EVENT = GREEN
                      ([1]->[3] CONSERVED at the production seam)
DISPOSITION          = NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY
FIRST_UNTESTED_      = continuation scheduling ([5] in source-seam-map)
BOUNDARY               (owned by runtime-task-progression epic)
HANDOFF              = RUNTIME_TASK_PROGRESSION
STOP                 = yes (no A-F follow-ons)
INVENTORY            = §1 source-seam-map.md AUTHORED;
                      A-F plan retracted per reviewer P1 corrections;
                      P1 single-probe discriminator executed (GREEN)
NEXT (HANDOFF)       = the next ACT (if any) lives at the
                       runtime-task-progression epic and tests the
                       continuation-scheduling boundary [5]; it is
                       NOT pre-authorized by RECON02
PARALLEL_OPERATOR_GATE = ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-
                         DISCRIMINATOR01 (operator-gated; NOT
                         blocking RECON02; its outcome does not
                         affect RECON02's disposition)
NEW_REVIEW_ROUND     = NO (closure ACT)
EVIDENCE             = apps/vscode/src/sdk/tool-runtime-reliability-
                       recon02.production-seam.test.ts (89 lines,
                       bun:test + chai; PASSING)
                     + .factory/evidence/.../probe-result-
                       publication-to-session-event.md
                     + .factory/evidence/.../probe-p1-run-log.txt
                     + .factory/evidence/.../final-report.md
```

```text
ROOT_CAUSE_ISOLATED    → child BOUNDED REPAIR ACT may be authored
                          under its own ACT ID; NOT pre-authorized here
NOT_REPRODUCED         → closes cleanly; recon is the deliverable
CAPTURE_INSUFFICIENT   → closes with a precise follow-on ACT that
                          captures what was missing (e.g. an operator
                          live-recurrence ACT, not a repair ACT)
```

> **Only `ROOT_CAUSE_ISOLATED` authorizes a child repair ACT.**
> `NOT_REPRODUCED` and `CAPTURE_INSUFFICIENT` do NOT.
The exact inventory will be captured in the
`source-seam-map.md` evidence file before any probe is written.
> ```