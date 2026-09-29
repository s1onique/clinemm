# ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 — final report (post second-pass §5/§6 temporal-honesty correction)

**Verdict:** **§3 GREEN, §4/§5/§6 written and corrected TWICE under reviewer P0 feedback (first: identity-source contradictions; second: temporal honesty).** ACT resumes at §18 (RED tests TCE-01..TCE-12) in the next session. No production code was edited; both rounds of corrections are entirely to the evidence documents.

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
