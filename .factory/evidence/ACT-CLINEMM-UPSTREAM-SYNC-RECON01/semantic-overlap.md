# ClineMM × Upstream Semantic Overlap

Source: `git diff --name-only merge-base..{HEAD,upstream/main}` + `git merge-tree --write-tree HEAD upstream/main`.

## Counts

- Local-only commits: 905
- Upstream-only commits: 177
- Files changed in both sides: 55
- Files with content-level merge conflicts: 17
- Auto-mergeable files (54 - 17 = 37): 37
- ClineMM-only production files: 634

## High-Value Semantic Overlaps (load-bearing)

### 1. Completion authority (`COMPLETION_AUTHORITY` lane — ACTIVE/HIGH, NEXT = `SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01`)

Upstream landing:

- `c870116d1` (PR #13489): `task.completed` now emitted from EVERY teardown path via `emitTaskCompletedOnTeardown`; covers `shutdownSession` AND `releaseSessionRuntime`. New `taskCompletedEmitted` flag prevents double-emit; `failSession` records the errored final turn so a stale `"completed"` from an earlier turn cannot leak.
- `80dd57315` (PR #13612): submit_and_exit UX finalized (auto-expand row, render summary as markdown, label errored rows).
- Upstream runtime explicitly treats `submit_and_exit` as the completion authority; shutdown is fallback.

### 2. Resume / Restore / QPSR / RSR (`QPSR_RSR` lane — PARKED)

Upstream landing (all 4 directly overlap QPSR/RSR investigation space):

- `b9efa9682` (PR #13175): continue the surviving idle session on resume/follow-up; only rebuild from history when no live session matches the displayed task. Fixes "bare Resume after Stop re-runs the original task".
- `eef7958ca` (PR #13418): truthful session status so desktop checkpoint restore stops wedging. Resets `agent.done` dedup on `session.pending_prompt_submitted`; new idle sessions start as idle (not running).
- `9cf60cd43` (PR #13330): finalize queued turns on `chat_done` with canonical history reconcile (turn-epoch / session-id / in-flight guards).
- `fed502e3c` (PR #13419): `legacyApiHistoryToSdkMessages` honors classic truncation range; drops orphaned tool_results. **DIRECT HIT** on the QPSR lost-tool-results bug family.
- `89c2efa97` (PR #13626): checkpoint restore refuses if HEAD moved past checkpoint; atomic compare-and-swap via `git update-ref` closes guard-to-reset race. (Security-critical.)
- `d4b415f8a` (PR #13259): sidecar persists the trimmed transcript on checkpoint restore.

Supersession risk: **YES** for all four core QPSR bugs. RSR may not need to reopen — upstream closes the underlying seams.

### 3. Editor tool approval (`EDITOR_TOOL_APPROVAL_FRICTION` lane — OPEN, live specimen blocked by host substrate)

Upstream landing:

- `2b7b01328` (PR #13498): **auto-approve all MCP tool calls when the MCP toggle is on**. Removes `mcpHub` dependency from `isToolAutoApproved`. Simplifies `isMcpToolName` to a substring check. Behavior change: per-tool MCP auto-approve flag is no longer consulted.
- `833cc891b` (PR #13522): hide per-tool MCP auto-approve checkboxes behind a flag (so the UI no longer pretends to control them).
- `7718142ef` (PR #13512) + `dc43a57fd` (PR #13521): apply_patch preserves CRLF + new files use platform-native line ending. Affects only `apply_patch`, not `editor`.
- Upstream `sdk/packages/core/src/extensions/tools/model-tool-routing.ts` exists and routes `codex`/`gpt` models (or `openai-native` provider) toward `apply_patch` and away from `editor` in `act` mode.
### 4. Sandbox / capability (`SETTINGS_SANDBOX_CAPABILITIES` lane — CLOSED_V2)

Upstream landing: NONE in the 177-commit window on `sandbox-policy.ts`, `command-job-manager.ts`, or the ClineMM-specific capability selectors.

- `sandbox-policy.ts` (42 KB) and `command-job-manager.ts` (54 KB) are ClineMM-only.
- Upstream did NOT land a competing implementation.
- Upstream did NOT touch the `clinemm_safe_yolo_allow_network` (189) or `clinemm_safe_yolo_allow_ssh_agent` (190) proto fields, the Settings persistence handler, or the seatbelt integration.

Supersession risk: **NONE**. The Closed_V2 invariants remain valid.

### 5. Settings persistence (`SETTINGS_SANDBOX_CAPABILITIES` wire contract)

Upstream changes (`38f8260bc`, PR #13226):

- Removes `optional bool auto_approve_all_toggled = 174` from `apps/vscode/proto/cline/state.proto`.
- Moves `reserved 142` block from mid-file to top-of-Settings.
- Adds `RemoteConfigRefreshCoordinator`, `refreshRemoteConfig({ force })`, `rematerializeRemoteConfig`, `ensureRemoteConfigForSessionStart`, `initialRemoteConfigReady`. Refactors `shouldAutoApproveTool` to drop `mcpHub` arg. Refactors `VscodeSessionHost.create` call sites to `createRemoteConfigAwareSessionHost`.

ClineMM position: ClineMM has `auto_approve_all_toggled = 174` RE-ADDED with a comment block explaining the legacy VSCode migration at `src/hosts/vscode/vscode-to-file-migration.ts:289` still reads `autoApproveAllToggled` from VSCode globalState.

**Conflict result** (`state.proto`): no protobuf field-number collision. Both sides agree `reserved 142` exists. Upstream deletes field 174, ClineMM re-adds it. Wire-shape conflict but no field-number collision.

Resolution principle (frozen): **preserve ClineMM restoration of field 174** because the legacy migration depends on it. Upstream deletion removes the migration source; ClineMM retention keeps it. After integration, the migration must be either (a) re-anchored at the legacy source location only and the field removed, or (b) both kept.
## Medium-Value Semantic Overlaps

- `9cf60cd43` queued-turn finalization + `eef7958ca` truthful status together cover the live UI streaming shimmer bug. No ClineMM lane currently tracks this.
- `8fe5a196c` + `9b9a067fb` tool-hook context/cancel semantics (no direct ClineMM overlap; hook subsystem is upstream-only).
- `6859d00e5` hub broadcast drops full transcripts (privacy / transcript-volume). No direct ClineMM overlap.
- `c870116d1` + `80dd57315` completion authority are the highest-value pair.

## Low-Value / No-Overlap

- All `chore(*)` release commits (`v3.0.59`, `v3.0.60`, `v0.0.81`, `v0.0.80`, `v0.0.19`, `v0.0.14`, `v0.0.13`, `4.1.10`, `desktop v0.0.20`): trivial.
- `feat(ui):` Markdown pipeline + ThinkingBlock, share attachment drop zone, AskQuestion redesign, agent welcome hero, etc.: UI only; safe merge.
- Provider/model: `aa815cd41`, `1986fa56d`, `27350f243`, `ce71fe5eb`, `1fbcfab05`, `aa4753f4a`, `8bbdde2a5`, `a8841bf96`, `ce2f7a00b`, `8a64372b5`: no ClineMM lane intersects.
- CI / test infra: `b532b174b`, `839074d7c`, `e7ed29109`, `eeaed357e`, `bca9b6420`, `36397f47e`, `eeaed357e`, `5ad2dd5fc`: no ClineMM lane intersects.
- Hook subsystem (`8fe5a196c`, `9b9a067fb`, `6ba9b9d7b`): upstream-only; ClineMM does not currently wire hooks. Defer.

## Verdict-Affecting Upstream Commits (Top 12)

| SHA | Lane | Behavior |
|-----|------|----------|
| c870116d1 | COMPLETION | task.completed on every teardown |
| 80dd57315 | COMPLETION | submit_and_exit UX finalized |
| b9efa9682 | QPSR | survive on resume, do not rebuild |
| eef7958ca | QPSR | truthful session status |
| 9cf60cd43 | QPSR | finalize queued turns on chat_done |
| fed502e3c | LEGACY | honor classic truncation on migration |
| 89c2efa97 | CHECKPOINT | refuse restore when HEAD moved |
| 2b7b01328 | SAFE_YOLO | auto-approve all MCP on toggle |
| 38f8260bc | SETTINGS | remote-config parity, drop field 174 |
| 8fe5a196c | HOOKS | tool hook contextModification |
| 61b95a62e | BASH | stream run command output |
| 52d5e1a51 | ABORT | session abort to teammates |

```
PROTO_FIELD_NUMBER_COLLISION = NO
SETTINGS_FIELD_COLLISION = YES (semantic) - field 174 only
GENERATED_REGEN_RISK = LOW - only state.proto and task.proto changed; both edits are well-bounded.
```

### 6. SDK runtime authority (`task.completed`, session-status truthfulness)

Already covered in §1 + §2. The principal SDK authority seams — `emitTaskCompletedOnTeardown`, `RemoteConfigRefreshCoordinator`, `initialRemoteConfigReady`, truthfulness for `session.updated` snapshots — all land in upstream.

ClineMM position: editor-tool live specimen is OPEN; capture tool is `PASS_APPROVAL_SPECIMEN_CAPTURE_STRUCTURAL_READY_V1`.

Supersession risk: **YES for the MCP approval simplification** (load-bearing for Safe-YOLO); the per-MCP-tool approval flow ClineMM may have wired needs re-evaluation post-merge.

`OUR_LIVE_EDITOR_SPECIMEN_TOOL_SELECTION_STILL_STABLE` = **MODEL_DEPENDENT** — confirmed by upstream `DEFAULT_MODEL_TOOL_ROUTING_RULES`. The live specimen must record the actual provider/model used and verify the tool the runtime actually selects, not assume `editor`.
ClineMM position: completion authority ACT is `NEXT/HIGH` and the `taskState.abort` cleanup after streaming is the live contract.

Supersession risk: **YES** for the `task.completed` emission authority (the same path ClineMM was about to wire). ClineMM must adopt `emitTaskCompletedOnTeardown`-equivalent and drop any in-flight task.completed path.
