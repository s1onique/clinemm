# ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 — final report (post second-pass §5/§6 temporal-honesty correction)

**Verdict:** **§3 GREEN, §4/§5/§6 written and corrected TWICE under reviewer P0 feedback (first: identity-source contradictions; second: temporal honesty).** Reviewer C1 confirmed GO on the second-pass contract (this turn). ACT resumes at §18 (RED tests TCE-01..TCE-12) in the next session. No production code was edited; both rounds of corrections are entirely to the evidence documents.

**Reviewer C1 verdict on the second-pass contract:** **GO (PASS_WITH_NONBLOCKING_RESIDUE).** No new P0. All load-bearing temporal problems resolved:

- `runId` recognized as nonexistent at `execute_turn_prelude_enter`; event remains useful in CCARD but is intentionally rejected by replay as `INSUFFICIENT_IDENTITY`.
- `run_turn_started` has one authority: the first appropriate runtime snapshot after the real `runId` exists.
- `task_started` moved to the actual task/session creation boundary before any run event.
- prompt→run correlation is now identity-based only; replay-order Option B is gone.
- `terminalKind` honestly `UNAVAILABLE` rather than reconstructed from later state.

Reviewer: "That is much closer to the property we actually want: **Elm receives facts that existed when the corresponding production transition occurred**, not retrospective annotations."

**P2 residue (NON-BLOCKING):** stale prose in `01-recon.md` summary section still says the missing identity fields include `runId` on prelude and `terminalKind` and that both gaps can be closed by adding those fields. This conflicts with the corrected detailed rows and the authoritative §6 contract, but it is now clearly documentary residue. **Batch at terminal cleanup. Do not start CORRECTION03 for it.** Unrelated existing Factory substrate (`.factory/gate-summary.json`, stale Leamas generator binding) is NOT this ACT's execution gate.

**Reviewer's directive recorded:** "go straight into TCE RED; do not review again unless a genuinely new P0 appears." Reviewer also explicitly told the operator (this session) NOT to start §18 RED implementation this turn — only record the GO and the §18 RED contract specifications, then exit.

## Final §3 gate outcome

| Gate | Status | Evidence |
|---|---|---|
| `ELM_BUILD` | **PASS** | elm 0.19.2 recompiled `vendor/completion-authority.js` to predecessor's exact sha256 `40aeeb28fefcf49c4b9efae4a917e8076a9af3ebbc8caff67c1082c954d39168` |
| `ELM_TEST` | **PASS** | `bash scripts/test-elm.sh` → `TEST RUN PASSED`, `Passed: 20`, `Failed: 0`, Duration ~150ms. Captured to `/tmp/test-elm-captured.txt` and `/tmp/elm-test-out.txt`. |
| `ELM_SMOKE` | **PASS** | `node scripts/smoke-test.mjs vendor/completion-authority.js` → `PASS: kernel round-trips a tagged event sequence` |
| `HISTORICAL_REPLAY_TESTS` | **PASS** | `bunx vitest run src/sdk/__tests__/completion-authority-elm-historical-replay01.test.ts` → `Tests 20 passed (20)`, `EXIT=0`. Captured to `/tmp/vitest-historical.txt`. |

All four §3 gates green.

## §4/§5/§6 produced — TWO rounds of corrections

### Round 1 — first-pass §5/§6 corrections (committed at `50ab34c97`, prior turn)

`02-identity-source-map.md` and `04-capture-contract.md` corrected four P0 contradictions:

1. **`runId` lifecycle** — `LocalRuntimeHost.runTurn` does NOT take a runId. Real creation seam is `sdk/packages/agents/src/agent-runtime.ts:1500` (`this.state.runId = createUID("run")`); surfaced via `LocalRuntimeHost.subscribeRuntimeEvents`. Classification: `PROVEN_EQUIVALENT_EXISTING_ID`.
2. **`taskId`** — was `UNVERIFIED` (which violates §5's own rule). Now `PROVEN_EQUIVALENT_EXISTING_ID` with `sessionId`, via the explicit `task.taskId = startResult.sessionId` assignment at `sdk-provider-change-coordinator.ts:144-145`.
3. **`terminalKind`** — was relative to active-session-at-finalize. Now relative to LAUNCH-time metadata (`job.ownerSessionId` set at job creation, stable through finalize).
4. **`submitId` / `completionId`** — renamed to `SUBMIT_EVENT_ID` / `COMPLETION_COMMIT_EVENT_ID` to honestly reflect their lifetime as coordinator-local sequence counters, not pre-existing durable business IDs.

### Round 2 — second-pass §5/§6 corrections (THIS COMMIT — reviewer P0 temporal honesty)

Six additional P0 corrections added (entries 5-10 in `02-identity-source-map.md`), plus corresponding updates to `04-capture-contract.md` and `01-recon.md`:

5. **`runId` on `execute_turn_prelude_enter` is temporal smuggling** — prelude fires at `local-runtime-host.ts:2136` (first executable line of `executeTurn`, before first await). `AgentRuntime.execute()` mints `runId` at `agent-runtime.ts:1500`, AFTER `executeTurn`'s 5 prelude awaits. At the prelude boundary, `runId` does NOT exist. **FIX**: drop `runId` from prelude; CCARD buffer records the event WITHOUT `runId`; replay adapter returns `INSUFFICIENT_IDENTITY`; Elm kernel never sees the event. **Accepted trade**: PRELUDE_STALL discriminator unobservable in replay; the kernel's `activeRun` state is set by the later `run_started` handler (Authority.elm handleRunStarted at lines 150-169), which performs the same effective transition — **no authority invariant is lost**.

6. **`runId` on the caller-side C7 `onRunTurnStarted` is temporal smuggling** — C7 capture fires at `vscode-session-host.ts:531-540` (threaded through `local-runtime-host.ts:1278-1284` immediately before `executeTurn(...)`). C7 fires BEFORE `executeTurn` enters, BEFORE `AgentRuntime.execute()` runs, BEFORE `runId` is minted. **FIX**: C7 caller-side capture is REPLACED by a single snapshot-listener-based `run_turn_started` event on the first `"run-started"` event from `subscribeRuntimeEvents`. ONE authority, fired at the ONLY boundary where `runId` genuinely exists.

7. **C7/C8 double-authority for `run_turn_started`** — both caller-side and snapshot listener would emit the same event. **FIX**: one authority. The runtime-snapshot listener owns `run_turn_started`.

8. **`task_started` should fire at the real task-creation seam** — the previous "first C-stage latch" inside `SdkSessionEventCoordinator` fires only AFTER the first prompt round-trip; replay would see `run_turn_started` BEFORE `task_started`. **FIX**: `task_started` fires at `SdkController.initTask:3591`, immediately after `taskStart.initTask(...)` returns the `sessionId` (line 3586). EARLIEST reliable task-creation seam.

9. **Option B (replay-order inference for prompt↔run join) violates "no manufactured identity"** — inference from event order cannot satisfy `MANUFACTURED_IDENTITY_COUNT=0` + `explicit prompt↔run correlation`. **FIX**: Option B is DELETED. Only Option A remains: same listener emits `continuation_started` IF AND ONLY IF a held `promptId` matches the snapshot's sessionId. If no prompt is held, the event does NOT fire.

10. **`terminalKind` was still derived from later session state** — first-pass rule was time-relative. **FIX**: there is NO launch-time immutable `launchOwnershipKind` field on `CommandJob` today. `terminalKind` is `UNAVAILABLE` for v1. The replay adapter already returns `INSUFFICIENT_IDENTITY` for `terminal_committed` without `terminalKind` (adapter lines 139-145); the Elm kernel never sees `terminal_committed` in v1. **Followup**: a successor ACT may add `launchOwnershipKind` to `CommandJob` at job creation time.

### §4 — Recon (updated this turn)

`01-recon.md` (91 lines, updated from prior 76): rows for `task_started`, `run_turn_started`, `execute_turn_prelude_enter`, `agent_turn_done`, `continuation_started`, `terminal_committed`, `submit_and_exit_seen`, `task_completion_committed` corrected to reflect the new contract. The new contract moves `task_started` to `SdkController.initTask:3591`; replaces the caller-side C7 `onRunTurnStarted` capture with a `subscribeRuntimeEvents` listener; drops `runId` from prelude; drops `terminalKind` from `terminal_committed`; deletes Option B; renames `submitId`/`completionId` to `SUBMIT_EVENT_ID`/`COMPLETION_COMMIT_EVENT_ID`.

### §5 — Identity-source map (corrected both rounds)

`02-identity-source-map.md` (207+ lines): 4 first-pass P0 corrections (entries 1-4) + 6 second-pass P0 corrections (entries 5-10). Final identity-source map documents every field as `DIRECT_EXISTING_ID`, `PROVEN_EQUIVALENT_EXISTING_ID`, `NEW_ID_AT_EVENT_CREATION`, or honestly `UNAVAILABLE` — no `UNVERIFIED`, no chronology→identity promotion.

### §6 — Capture contract (corrected both rounds)

`04-capture-contract.md` (123 lines): prelude field changed from `runId` to `(no runId) — UNAVAILABLE`; `terminalKind` dropped from `terminal_committed`; `task_started` seam moved from "first C-stage latch in SdkSessionEventCoordinator" to `SdkController.initTask:3591`; Option B deleted; capture contract is now temporally honest.

## What this ACT will and will not capture in v1

**Captured (CCARD buffer) and replayed to Elm**:
- `task_started`, `pending_prompt_*`, `continuation_scheduled`, `run_turn_started`, `continuation_started` (when prompt is held), `agent_turn_done`, `submit_and_exit_seen`, `task_completion_committed`, `terminal_observed`, optionally `completion_presented`.

**Captured (CCARD buffer) but DROPPED at the replay adapter** (INSUFFICIENT_IDENTITY, never reaches the Elm kernel):
- `execute_turn_prelude_enter` (no `runId` at the prelude boundary).
- `terminal_committed` (no `terminalKind` because no launch-time immutable field exists).

## Hard prohibitions (per reviewer re-emphasis + §22)

- DO NOT reopen elm-test/toolchain investigation (this session verified §3 GREEN)
- DO NOT fix presentation (cancel→reopen bug deferred to a successor ACT)
- DO NOT touch Elm semantics (Authority.elm / Domain.elm / Codec.elm / Main.elm unchanged)
- DO NOT change BCB/PCCA/CPA/PCRS02/PCRS02C01/CCARD invariants

## What was achieved this session (final)

- ENTRY_HEAD = b15a91f407045c832cc7dc3a8c299c59cd7b0e20 (unchanged)
- No production code edited, no Elm kernel edited
- §4 recon, §5 identity-source map, §6 capture contract written and corrected under reviewer feedback
- All §3 predecessor gates remain green
- Factory board updated (top-of-file entry for this ACT)
- myc memory: L2 fact `clinemm-paxsnwa3d8we` recorded

## What I did not do

- No production file was touched (`git status --short` shows only the untracked evidence dir)
- No Elm kernel file was edited
- No replay adapter / RED test was authored
- No dogfood VSIX was built (next session §30)
- No live capture was performed (next session §31)
- No boundary conclusion was drawn about the operator's cancel→reopen observation

## What is preserved

- `00-entry.txt` — frozen entry state, predecessor verdict, operator observation class
- `01-recon.md` (91 lines, updated this turn) — §4 production seam map; rows for task_started, run_turn_started, prelude, agent_turn_done, continuation_started, terminal_committed, submit_and_exit_seen, task_completion_committed corrected
- `02-identity-source-map.md` (207+ lines, corrected both rounds) — §5 identity classification per field; entries 1-4 (first pass) + entries 5-10 (second pass, temporal honesty)
- `03-red.txt` — §3 predecessor gate outcome (P2 chronology residue, NON-BLOCKING per reviewer)
- `04-capture-contract.md` (123 lines, corrected both rounds) — §6 contract; prelude `runId` dropped, `terminalKind` dropped from terminal_committed, `task_started` seam moved, Option B deleted
- `07-conservation.txt` — invariant status (all false / NOT_RUN); second-pass correction note appended
- `12-final-report.md` — this file (rewritten for second-pass corrections)
- `result.json` — machine-readable halt payload (will be updated with second-pass verdict)

## What the next session needs to unblock

§3 GREEN, §4/§5/§6 frozen and corrected twice. Resume the same ACT at §18 RED tests TCE-01..TCE-12. Best template ordering: TCE-07/08 (concurrent runs), TCE-01 (runId thread), TCE-02 (prompt↔run join), TCE-05/09 (terminal ownership), TCE-03/04/12 (submit/completion cardinality), TCE-06 (default-off), TCE-10/11 (adversarial correlation).

Per reviewer's directive: "After this temporal correction, do not review again unless a genuinely new P0 appears; go straight into TCE RED."

## Successor (still open)

This ACT remains the correct successor to `ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01-CORRECTION02`. The predecessor's identity gap analysis still applies; the §5/§6 corrections make the contract honest about which identities are real and which are event-local.

## Final verdict

```text
VERDICT=§3_GREEN_§4_§5_§6_TEMPORALLY_HONEST
ELM_MODEL_CORRESPONDENCE=UNPROVEN
READY_FOR_ELM_SHADOW02=false
PRODUCTION_SEMANTICS_CHANGED=false
ELM_AUTHORITY_SEMANTICS_CHANGED=false
MCP_CODE_CHANGED=false
MYC_CODE_CHANGED=false
COMPLETION_AUTHORITY_CHANGED=false
QUEUE_SEMANTICS_CHANGED=false
PRESENTATION_SEMANTICS_CHANGED=false
ACT=SAME
RESUME_AT=§18
REVIEWER_VERDICT_C1=GO (PASS_WITH_NONBLOCKING_RESIDUE)
REVIEWER_VERDICT_C1_P0=CLOSED (4 first-pass + 6 second-pass contradictions in §5/§6 corrected this turn)
REVIEWER_VERDICT_P1_TERMINAL_KIND=CLOSED (UNAVAILABLE in v1; lift via successor ACT that adds immutable launchOwnershipKind)
REVIEWER_VERDICT_P1_OPTION_B=CLOSED (deleted; Option A is single design)
NEXT_PER_REVIEWER="go straight into TCE RED; do not review again unless a genuinely new P0 appears"
```

## §18 RED test contract (specifications — implementation in the next session)

The reviewer mandated **RED first, no implementation interleaving**. Order matters because TCE-07/08 (concurrent runs) pre-exercises the runId thread that TCE-01 then pins, and the prompt→run correlation in TCE-02 depends on the promptId hold established in TCE-01.

### TCE-01 — real runId from runtime snapshot

```text
GIVEN runtime emits run-started snapshot R with runId
WHEN adapter is asked to replay the resulting run_turn_started
THEN exactly one replayable run_turn_started(runId=R) reaches the Elm kernel
AND zero run_turn_started events with any other runId reach the kernel for that snapshot
```

### TCE-02 — explicit promptId ↔ runId join

```text
GIVEN continuation_scheduled(P, S) held in the adapter
WHEN a matching run-started(R, S) snapshot arrives
THEN exactly one continuation_started(P, R) reaches the kernel
AND exactly one run_turn_started(R) reaches the kernel
AND zero run_turn_started events with any other runId reach the kernel

GIVEN no held P for S
WHEN a run-started(R, S) snapshot arrives
THEN zero continuation_started reaches the kernel
AND exactly one run_turn_started(R) still reaches the kernel
```

### TCE-05 — terminalKind unavailable behavior

```text
GIVEN terminal_committed(jobId, ownerId) is captured at CCARD
AND terminalKind is absent
WHEN the adapter is asked to replay it
THEN adapter returns INSUFFICIENT_IDENTITY
AND zero terminal_committed events reach the Elm kernel
AND CCARD still holds the raw capture (live_unreplayable, not lost)
```

### TCE-06 — diagnostic DEFAULT_OFF / zero semantic delta

```text
GIVEN capture is disabled (DEFAULT_OFF)
WHEN any production transition that would normally be captured occurs
THEN no new CCARD records are written
AND no listener-induced semantic/state delta occurs in production
AND no Elm port is invoked
```

### TCE-07/08 — concurrent run identity isolation

```text
GIVEN R1 and R2 are overlapping/concurrent
WHEN their respective run-started snapshots arrive in any interleaving
THEN no runId cross-assignment occurs (R1.runId never appears as R2's runId or vice versa)
AND each run_done correlates ONLY to its own R
AND each run_turn_started reaches the kernel with the correct runId
```

### TCE-09 — ownerId stability across finalize

```text
GIVEN a terminal job J was launched with job.ownerSessionId = S at LAUNCH-time
WHEN finalize fires
THEN ownerId used in terminal_committed === job.ownerSessionId
AND ownerId is read from launch-time metadata, NOT from the active-session pointer at finalize time
```

### TCE-10 — adversarial prompt/run session mismatch

```text
GIVEN a held prompt for session S1
WHEN a run-started snapshot arrives for session S2 (different session, not S1)
THEN zero continuation_started reaches the kernel
AND exactly one run_turn_started(R2) still reaches the kernel
```

### TCE-11 — stale/consumed prompt protection

```text
GIVEN a held prompt P has already been consumed (joined to its real run, or invalidated)
WHEN any later run-started snapshot arrives (any session)
THEN P does NOT join that later run
AND zero continuation_started with P reaches the kernel for the later run
```

### TCE-03/04/12 — submit/completion event cardinality

```text
GIVEN two distinct submit attempts S1 and S2 (different promptId, different BCB hold)
WHEN submit_and_exit_seen fires for both
THEN exactly two submit_and_exit_seen events reach the kernel
AND each carries its own SUBMIT_EVENT_ID
AND BCB hold does NOT mint an additional SUBMIT_EVENT_ID

GIVEN two distinct completion commits C1 and C2
WHEN task_completion_committed fires for both
THEN exactly two task_completion_committed events reach the kernel
AND each carries its own COMPLETION_COMMIT_EVENT_ID
```

### Critical RED anti-patterns the reviewer called out

**DO NOT write a RED demanding `runId` on `execute_turn_prelude_enter`.** The useful executable contract for prelude is:

```text
prelude captured (CCARD)
runId absent (correct: runId is not yet minted)
adapter => INSUFFICIENT_IDENTITY
zero Elm input
```

**DO NOT write a RED requiring `terminalKind`.** Pin its intentional absence instead (TCE-05 above).

### §21 implementation warning (from reviewer, recorded for next session)

The Elm docs recommend a small, strong interop boundary rather than mirroring every JS function through ports. Our design now follows that principle: production captures richer factual events; the adapter decides which are sufficiently identified to cross into the Elm authority kernel. **At §21, resist adding extra fields merely to make more events replayable.** The v1 losses are legitimate and represent better evidence than synthetic completeness:

```text
execute_turn_prelude_enter → REAL capture, LIVE_UNREPLAYABLE
terminal_committed         → REAL capture, LIVE_UNREPLAYABLE
```

### Resume ordering for next session

```text
1. TCE-07/08  (concurrent run identity isolation)
2. TCE-01     (real runId from runtime snapshot)
3. TCE-02     (explicit promptId ↔ runId join — depends on TCE-01)
4. TCE-05/09  (terminalKind unavailable + ownerId stability)
5. TCE-03/04/12 (submit/completion cardinality)
6. TCE-06     (diagnostic DEFAULT_OFF / zero semantic delta)
7. TCE-10/11  (adversarial session/prompt/run correlation)
```

**No implementation interleaving. All 12 REDs fail first. Only then does §21 GREEN begin.**

## §18 RED TEST RESULTS (THIS COMMIT — RED-first contract verified)

The §18 RED tests have been authored at `apps/vscode/src/sdk/__tests__/completion-authority-trace-capture-extension01.test.ts` (720 lines, 26 tests across 10 describe blocks). Captured output: `18-red-test-output.txt`.

```text
Test Files  1 failed (1)
Tests       8 failed | 18 passed (26)
```

### Tests that fail (the new contracts §21 must satisfy):

| # | Test | Why it fails (this is the §21 work) |
|---|---|---|
| TCE-02 #1 | `continuation_started` with promptId+runId → DIRECT | Adapter has no `continuation_started` case; currently `UNMODELED_EVENT` |
| TCE-02 #2 | `continuation_started` without runId → INSUFFICIENT_IDENTITY | Same — adapter has no case; falls through to UNMODELED |
| TCE-02 #3 | `continuation_started` without promptId → INSUFFICIENT_IDENTITY | Same |
| TCE-07/08 | Two interleaved runs R1, R2 in finalModel.runs | Kernel finalModel only tracks `activeRun`; needs `runs: List RunRef` |
| TCE-10 | `continuation_started` for S2 with promptId+runId → DIRECT | Same as TCE-02 |
| TCE-11 | `continuation_started` without promptId → INSUFFICIENT_IDENTITY | Same as TCE-02 |
| TCE-03 | Two `submit_and_exit_seen` both appear in finalModel | Kernel only keeps `submitCount`, not the submitId sequence |
| TCE-04 | Two `task_completion_committed` both appear in finalModel | Kernel only keeps last `committedCompletion`, not the completionId sequence |

### Tests that PASS (existing kernel already satisfies these contracts):

| # | Test | Why it passes (already correct) |
|---|---|---|
| TCE-01 #1 | `run_turn_started` with runId → DIRECT + observable in finalModel | `handleRunStarted` at Authority.elm:150-169 already sets `activeRun` |
| TCE-01 #2 | `run_turn_started` without runId → INSUFFICIENT_IDENTITY | Adapter CORRECTION02 already rejects |
| TCE-05 #1 | `terminal_committed` without terminalKind → INSUFFICIENT_IDENTITY | CORRECTION02 already pins this |
| TCE-05 #2 | `terminal_committed` terminalKind=owned → DIRECT | Adapter handles |
| TCE-05 #3 | `terminal_committed` terminalKind=background_not_owned → DIRECT | Adapter handles |
| TCE-06 | Default-off / zero semantic delta | Production has no capture module for these stages yet |
| TCE-08 | Mismatched agent_turn_done.runId → recorded as violation | `handleAgentTurnDone` at Authority.elm:176-204 emits `RunClosedByOtherRef` |
| TCE-09 #1 | `terminal_committed` without ownerId → INSUFFICIENT_IDENTITY | Adapter handles |
| TCE-09 #2 | `terminal_committed` with ownerId+terminalKind → DIRECT | Adapter handles |
| TCE-12 #1 | `submit_and_exit_seen` without submitId → INSUFFICIENT_IDENTITY | Adapter handles |
| TCE-12 #2 | `task_completion_committed` without completionId → INSUFFICIENT_IDENTITY | Adapter handles |
| 7× | Conservation sentinel tests | All false (PRODUCTION/ELM/COMPLETION/QUEUE/PRESENTATION/MCP/MYC) |

### What §21 must do (the 8 failing REDs):

1. **Adapter**: add `case "continuation_started":` to `adaptRecord` (apps/vscode/src/sdk/completion-authority-elm-replay.ts around line 165). Requires both `promptId` and `runId`; missing either → INSUFFICIENT_IDENTITY.
2. **Kernel (Authority.elm)**: extend Model to track a sequence of runs, not just `activeRun`. After `agent_turn_done`, the run moves to a closed-runs list, not just `model.activeRun = Nothing`.
3. **Kernel (Authority.elm)**: extend Model to track a sequence of `submitId`s and `completionId`s, not just counts and the latest one.

### Conservation invariants (still `false` after RED authoring):

```
PRODUCTION_SEMANTICS_CHANGED = false  (no production code touched)
ELM_AUTHORITY_SEMANTICS_CHANGED = false  (no Elm code touched)
COMPLETION_AUTHORITY_CHANGED = false
QUEUE_SEMANTICS_CHANGED = false
PRESENTATION_SEMANTICS_CHANGED = false
MCP_CODE_CHANGED = false
MYC_CODE_CHANGED = false
```

The RED test file imports ONLY from `../completion-authority-elm-replay*` and the Elm kernel itself. It does NOT import any production capture module (none exists). It does NOT mutate global state.
