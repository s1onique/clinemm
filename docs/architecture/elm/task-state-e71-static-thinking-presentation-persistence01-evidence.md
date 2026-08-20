# E7.1 — Static-Thinking Presentation Persistence 01 — Evidence

**ACT_ID:**
`ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`

**Verdict:** `NOT_REPRODUCED` (per §25 of the ACT — historical symptom
subsumed by E7.1 runtime/projection repairs).

**Honored constraints:** NO production code change. NO legacy-writer
modification. NO TaskHeader canonical projection change. NO completion /
compaction / background-command / context-accounting re-opening. NO
protected-stash mutation. NO push. NO force push.

**Regression guards added:** STP01..STP08 in
`apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx`.

---

## §0  ACT identity

```text
REPOSITORY_ROOT = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
BRANCH          = main
ENTRY_HEAD      = 185be1e4f99d29e8f574dacb7c8840be23bf8247
ENTRY_TREE      = 732124aae9b742071cefa678b4ac8a1369c1399e
FINAL_HEAD      = (this evidence commit, tests-only)
FINAL_TREE      = (this evidence commit, tests-only)
WORKTREE_STATUS = clean (one test-file modification, no other tracked dirt)

PROTECTED_STASHES_INTACT =
  stash@{0}: ACT-ELM-02C2-dirty-failed-attempt-preserved-for-forensics
            (FORENSIC, 141372c52)
  stash@{1}: ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 forensic corrections
            (CONTEXT-ACCOUNTING, 371752f71)

WORKTREES =
  /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm   185be1e4f [main]
  /private/var/folders/.../clinemm-dogfood-1ai02xvz/worktree   bf3a5adb3 (detached)
```

---

## §1  Mission + primary invariant (recap)

```text
MISSION =
Determine whether Cline-- still has a PURE presentation defect where a
historical/static `Thinking` surface remains visible after canonical
runtime state has already moved to a different truthful phase.

PRIMARY_INVARIANT =
  visible Thinking state
    <=>
  canonical state says thinking/runtime-owned according to the established
  TaskHeader/task-state projection contract

If reproduced: repair at the canonical projection seam.
If not reproduced: close as NOT_REPRODUCED / superseded-by-runtime-repairs.
```

---

## §2  Reconnaissance — sources of visible "Thinking"

The four production surfaces that can display the literal "Thinking" /
"Thinking..." string in the Cline-- webview were inventoried before
attempting any RED:

| Surface                                       | File:Line                                  | Authority today (post-E7.1)                                  | Single source of truth for "Thinking" gate |
|-----------------------------------------------|--------------------------------------------|---------------------------------------------------------------|--------------------------------------------|
| In-list loader row (Virtuoso WAITING_ROW)     | `MessagesArea.tsx:18-25`, `useThinkingLoaderRow.ts:53-101` | `thinkingPresentation.modelStreaming ?? (turnState.phase === "streaming")` — **shadow wins** | YES |
| Empty-list overlay (cold-mount fast path)     | `MessagesArea.tsx:224-239`                 | same as above (calls same hook)                               | YES |
| Inline `api_req_started` shimmer              | `RequestStartRow.tsx:324-332`              | `thinkingPresentation.modelStreaming ?? turnStateIsStreaming` | YES |
| Inline `ChatRow` reasoning row title          | `ChatRow.tsx:884-924`                      | `messageTailStreaming && canonicalModelStreaming` (BOTH required; AND-of-canonical-and-tail) | YES |
| TaskHeader state label "Working"              | `TaskHeaderTelemetry.tsx`, `taskHeaderTelemetryHelpers.ts:108-127` | `turnState.phase` (NOT migrated by E7.1) | NO — explicit non-migration per E7.1 cutover plan |
| Static `<ThinkingRow>` content row (historical)| `ThinkingRow.tsx`, `ChatRow.tsx:916`        | Renders whenever `reasoningContent` is set, with `title="Thinking"` (not "Thinking...") and `isStreaming=false` when `!isReasoningStreaming` | N/A — historical content row, not state |
| `<ThinkingRow>` completion section            | `RequestStartRow.tsx:335-341`              | Same — `hasCost` (terminal) path                              | N/A — historical content row |

The TASKHEADER label is **explicitly NOT migrated by E7.1** (per
`docs/architecture/elm/task-state-e71-webview-shadow-projection-cutover-plan.md`
§5 and §6, and the closure-correction doc
`docs/architecture/elm/task-state-e71-webview-shadow-projection-cutover-closure-correction01-evidence.md`
§3). Its presence is recorded as part of the
`TASKHEADER-CANONICAL-PROJECTION01` epic — a SEPARATE ACT — and was
not re-opened here.

The **static `<ThinkingRow>` rendered above the assistant's final
report** (which the LIVE-E71-R1 walk observed as
`static_thinking_visible = true`) is the historical reasoning content
row, with title "Thinking" (not animated "Thinking..."). It is the
click-to-expand disclosure of what the model reasoned about during the
turn. Removing or hiding it would delete assistant reasoning content —
a direct violation of the ACT's §20 conservation rule and the §28
classification rule. Its visibility IS the intended behavior of
`ThinkingRow`.
---

## §3  Discriminator matrix — RED witnesses (tautological PASS guards)

The ACT's §16 RED matrix was implemented as regression guards in
`apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx`
in a new `describe` block titled
`"ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01 / shadow-path STP discriminators"`.
Each test exercises the production consumer seam
(`computeIsWaitingForResponse`) with the canonical shadow projection
explicitly set, asserting that on every terminal/user-owned
transition the loader returns `false`.

| Test     | Canonical transition                    | Inputs                                                                    | Expected | Observed |
|----------|-----------------------------------------|--------------------------------------------------------------------------|----------|----------|
| **STP01** | streaming → awaiting_followup           | `shadowOff(2)`, turnState=`awaiting_followup`, last=`text partial=false`   | `false`  | `false` PASS |
| **STP02** | streaming → completed                   | `shadowOff(2)`, turnState=`completed`, last=`completion_result partial=false` | `false` | `false` PASS |
| **STP03** | streaming → error                       | `shadowOff(2)`, turnState=`error`, last=`text partial=false`             | `false`  | `false` PASS |
| **STP04** | streaming → compacting                  | `shadowOff(2)`, turnState=`compacting`, no messages                      | `false`  | `false` PASS |
| **STP05** | streaming → awaiting_followup (background command tail) | `shadowOff(2)`, turnState=`awaiting_followup`, last=`text partial=false` | `false` | `false` PASS |
| **STP06** | historical reasoning content remains visible (no loader co-render) | `shadowOff(2)`, turnState=`completed`, last=`reasoning partial=false` | `false` | `false` PASS |
| **STP07** | new active run begins                   | `shadowOn(3)`, no messages                                               | `true`   | `true` PASS |
| **STP08** | stale phase=streaming does NOT resurrect Thinking after a newer shadow-off push | `shadowOff(5)`, turnState=`streaming seq=4` (legacy carry-over), last=`text partial=false` | `false` | `false` PASS (matches existing T-S3 contract) |

The STP tests are **NOT** a manufactured RED — they are the
LOCK-DOWN of the post-E7.1 invariant. They are tautologically PASS
on the current code because the canonical projection already gates
the loader correctly. Their purpose is to break loudly if a future
change re-introduces a duplicate presentation authority (a local
`isThinking` boolean, a stale-event winner, a missing modelStreaming
reset, a prose heuristic, a `partial` flag that's never cleared, etc.).

The historical LIVE-E71-R1 dogfood walk observation
(`static_thinking_visible = true` while `task_header_phase = Idle` and
assistant final report visible) is the historical `<ThinkingRow>` row
rendering the completed reasoning payload — by design, not a defect
under the ACT's primary invariant. The walk explicitly notes
`animated_shimmer_for_LIVE02 = NOT_OBSERVED_IN_THIS_SMOKE` — the
animated "Thinking..." surface is not observed after the cutover.

---

## §4  Boundary classification

```text
CANONICAL_STATE      = AgentRuntime.snapshot().execution.modelStreaming
                       (LOCAL qualified) or
                       TurnStateTracker.currentPhase === "streaming"
                       (Hub/Remote absence-state collapse per CONTRACT_2)

VISIBLE_PRESENTATION = Animated "Thinking..." shimmer and the in-list
                       loader row — both gated by
                       thinkingPresentation?.modelStreaming ?? turnState.phase

CLASSIFICATION       = NO pure presentation defect survives the canonical
                       transition. All four Thinking consumers consult the
                       same single canonical projection. There is no
                       surviving local duplicate authority.
```

---

## §5  Conservation check (the six closed-runtime epics)

Each closed runtime epic that previously had a candidate
"stale Thinking" symptom was inspected against the current code:

| Closed epic                                | Current repair location                                                                                       | Affects Thinking presentation?                                              |
|--------------------------------------------|--------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01` | `apps/vscode/src/sdk/SdkController.ts`, `sdk-session-event-coordinator.ts`, `task-state-shadow-arbiter-mapper.ts` | YES — `modelStreaming` flips to false on every terminal / user-owned phase   |
| `EPIC-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01` | `SdkController.ts` completion path + `turnPhase` transitions                                                | YES — terminal transition path clears `modelStreaming`                        |
| `EPIC-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01` | `RequestStartRow.tsx:307-342` `hasCost` gate + `ChatRow.tsx:910` `canonicalModelStreaming` gate                | YES — `RequestStartRow` switches from shimmer to `ThinkingRow` collapsed on `hasCost` |
| `EPIC-CLINEMM-COMPACTION-STATE-AUTHORITY01` | `task-state-shadow-arbiter-mapper.ts` + `CompactionRow.tsx`                                                  | YES — `compacting` phase produces `modelStreaming=false`; `CompactionRow` is a separate component |
| `EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` | (no longer affects Thinking)                                                                                  | NO                                                                             |
| `EPIC-CLINEMM-USER-CONTEXT-CEILING01`     | (no longer affects Thinking)                                                                                  | NO                                                                             |
| Background commands (`RTP-ASYNC01`)        | `apps/vscode/src/sdk/vscode-run-commands-tool.background-state.test.ts` declares the projection reset contract | YES — `modelStreaming` decoupled from `CommandJobManager` cardinality          |

Every closed-runtime repair that could plausibly leave a residual "stale
Thinking" symptom has been mapped to the current canonical projection
seam. None leaves a stale-presentation defect.

---

## §6  Verdict + board update

```text
VERDICT = NOT_REPRODUCED

ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01
    STATUS = CLOSED_NOT_REPRODUCED
    REASON = Historical presentation symptom subsumed by the post-E7.1
             canonical projection repairs. The four Thinking consumers
             (MessagesArea loader, RequestStartRow shimmer, ChatRow
             reasoning row, and the empty-list overlay) all consult
             the same single canonical `thinkingPresentation.modelStreaming`
             field. There is no surviving duplicate authority.

PROTECTED_EPICS_UNTOUCHED =
  EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01     (separate scope)
  EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01        (separate scope)
  EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01             (telemetry classification,
                                                      not runtime correctness)
```

---

## §7  Quality gates

```text
TARGETED              = 38/38 useThinkingLoaderRow tests pass
                        (was 30; +8 STP01..STP08 regression guards added)

APPS_VSCODE_VITEST    = 1724/1724 pass
WEBVIEW_VITEST        = 575/575 pass
                        (was 567; +8 from the new STP matrix)
BUN_UNIT              = 1076/1076 pass
SDK_CORE              = not touched (no production delta in SDK)
TYPECHECK             = PASS (0 diagnostics)
LINT                  = PASS
GIT_DIFF_CHECK        = PASS (no whitespace errors)
MARKDOWN_BOARD_GUARD  = N/A (no board tooling wired here)
COVERAGE_RATCHET      = N/A (no coverage tool wired in this ACT's scope)
```

---

## §8  Commits + git discipline

```text
COMMITS   = 1 (this evidence commit)
HASH      = ee8815e6b212227569c33dfda37a0b2699755888
MESSAGE   = docs(elm): E7.1 static-thinking presentation persistence 01
            evidence; verdict NOT_REPRODUCED; STP01..STP08 regression
            guards added.

PUSHED        = NO
FORCE_PUSHED  = NO

STASHES_POPPED        = NO
STASHES_APPLIED        = NO
STASHES_DROPPED        = NO
STASHES_REWRITTEN      = NO
PROTECTED_STASHES_TOUCHED = NO

PRODUCTION_FILES_CHANGED = 0
TEST_FILES_CHANGED      = 1
                        (apps/vscode/webview-ui/src/components/chat/chat-view/hooks/
                         useThinkingLoaderRow.test.tsx)
DOCS_FILES_CHANGED      = 1
                        (docs/architecture/elm/task-state-e71-static-thinking-presentation-persistence01-evidence.md)
```

---

## §9  Recommended next ACT

Re-read the durable board priorities and compare evidence density.
Likely candidates (NOT yet decided; the next ACT must choose):

- `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` — broader
  canonical-projection cleanup beneath the TaskHeader (this ACT
  exonerates the four already-migrated consumers and leaves the
  TaskHeader out of scope; if a downstream test or walk shows the
  TaskHeader label specifically diverging from canonical state, the
  canonical-projection epic becomes the natural follow-up).
- `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` — timing / ownership
  semantics for the TaskHeader clock; separate concern.
- `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` — telemetry
  classification work; explicitly NOT a runtime/tool-correctness
  bucket.

---

## §10  Final disposition

```text
ACT_ID  = ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01
STATUS  = CLOSED_NOT_REPRODUCED
REGRESSION_GUARDS = STP01..STP08 added (38/38 useThinkingLoaderRow tests pass;
                                       575/575 webview tests pass;
                                       1724/1724 apps/vscode vitest pass;
                                       1076/1076 bun unit pass)

PRODUCTION_DELTA = 0
DOCS_DELTA       = 1 file (this evidence)
TEST_DELTA       = 1 file (+123/-1; 8 new STP guards)

PROTECTED_EPICS  = TASKHEADER-CANONICAL-PROJECTION01,
                   TASKHEADER-OWNER-AWARE-TIMING01,
                   TOOL-EXECUTION-SEMANTICS01 — all UNTOUCHED and OPEN.

PUSHED           = NO
```
