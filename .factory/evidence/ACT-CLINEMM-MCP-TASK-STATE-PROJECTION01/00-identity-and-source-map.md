# 00 — Identity and source map

**ACT:** `ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01`
**Repository:** `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm`
**Branch:** `main`

---

## C0 — Repository identity

| Field | Value |
|---|---|
| Reported HEAD (reference) | `d397d90c002e9fab136b346771965209d28c6455` |
| Actual ENTRY_HEAD | `5dc1394802b86cb1ac996396fda2ca4b72212a70` |
| Tree identity (ENTRY) | `312cc2ad6c4fb98c2e2b770da82b05f78553d731` |
| Entry commit subject | `fix(observability): complete compaction decision capture contract` |
| Entry commit date | `2026-11-16 23:21:09 +0300` |
| Branch | `main` |

The repository **moved** from the reported reference to `5dc13948`. The
intervening commits are:

```
eb245ae72 recon(roundc): classify Round C compaction evidence discontinuity and premature compaction
d14979749 fix(compaction): ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01 — repair S1, halt S2, correct the RECON02 receipts
25517f509 fix(compaction): ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01 — close the S1 semicolon status-attribution gap
5dc139480 fix(observability): complete compaction decision capture contract
```

Their diffstat touches **none** of the production seams this ACT reads or
writes (no `apps/vscode/src/sdk/control-seam/*`, no
`apps/vscode/src/sdk/SdkController.ts`, no
`apps/vscode/src/core/controller/state/subscribeToState.ts`, no
`apps/vscode/webview-ui/src/components/chat/task-header/*`). The seams
described in C1 are retained verbatim at `5dc13948`. **No intervening ACT
was reverted.**

### Protected stash and worktree inventory (preserved)

| Kind | Inventory | Disposition |
|---|---|---|
| Stash | `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration` | **PRESERVED** — untouched |
| Worktree | `/Volumes/.../clinemm` (`5dc139480`, main) | primary |
| Worktree | `/private/tmp/clinemm-prebase` (`1f456b971`, detached, prunable) | **PRESERVED** |
| Worktree | `/private/tmp/worktree-bun.7ddCHQ` (`bbdccf8a2`, detached) | **PRESERVED** |
| Worktree | `/private/var/.../clinemm-dogfood-cyci5ujq/worktree` (`3147a53b5`, detached, prunable) | **PRESERVED** |
| Worktree | `/Volumes/.../clinemm-m31-action-first` (`38e726c45`, `experiment/m31-action-first`) | **PRESERVED** |
| Worktree | `/Volumes/.../clinemm-m31-bounded` (`0366ea506`, detached) | **PRESERVED** |

A temporary baseline worktree (`/tmp/act-baseline`) was created to
establish the pre-existing test baseline and **removed** afterwards; the
worktree inventory above is unchanged.

### Tracked / untracked status at ENTRY_HEAD

```
git status --porcelain=v1 --untracked-files=all
→ (empty)
```

**Clean tree at entry.** No unexpected tracked dirt →
**no `HALT_UNEXPECTED_TRACKED_DIRT`**.

No upstream merge, reset, rebase, force-push, dependency update or
unrelated cleanup was performed.

---

## C0 — Installed extension identity

The execution substrate is a sandboxed agent workspace. The installed
`codium-clinemm` extension directory was **not** inspected or modified
(see C6.2 — installation is explicitly out of the agent's reach and must
not be bypassed). Installed qualification is therefore **PENDING**; see
`06-artifact-and-live-qualification.md`.


---

## C1 — Source map (the real production seams)

All paths are relative to the repository root.

### The header authority chain

| # | File | Role |
|---|---|---|
| 1 | `apps/vscode/src/sdk/turn-state-tracker.ts` | Owns the legacy `TurnPhase` + `seq` (presentation/turn-state sequence domain). `TurnStateTracker.setWithWriter` (line 122) advances `seq` via the shared minter. `get()` (line 218) returns the immutable snapshot. |
| 2 | `apps/vscode/src/sdk/task-header-elm-authority.ts` | `pickTaskHeaderPresentationForPublication()` (line 79) — the **SOLE semantic authority**. On Elm failure it returns the bounded sentinel `{ phase: "idle", source: "host", seq: input.seq }` (line 68). No hold-last-good cache. |
| 3 | `apps/vscode/src/sdk/SdkController.ts` | `getStateToPostToWebview()` builds the `ExtensionState`; `taskHeaderPresentation` is assigned via `pickTaskHeaderPresentationForPublication(taskHeaderInputs)`. `stateVersion` is stamped from `sharedSeq = minter.nextSeq()`; `epoch` from `minter.epoch`. |
| 4 | `apps/vscode/src/shared/ExtensionMessage.ts` | `TaskHeaderPresentationProjection` (line 715) — `{ phase: TurnPhase; source: "shadow" \| "host" \| "legacy"; seq: number }`. `TurnPhase` (line 743) — the eight-value vocabulary. |
| 5 | `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` | Consumes the projection via `taskHeaderPresentationStateLabel(...)`. |
| 6 | `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` | `stateLabel(phase)` — the pure `TurnPhase → { label, glyph, live }` projection. |

### The publication handoff

| # | File | Role |
|---|---|---|
| 7 | `apps/vscode/src/sdk/SdkController.ts` | `postStateToWebview()` → `statePostDebouncer.post()`. `flushStateToWebview()` → `getStateToPostToWebview()` → `sendStateUpdate(state)`. |
| 8 | `apps/vscode/src/sdk/state-post-debouncer.ts` | Coalesces bursts; `flush()` rejections propagate to `post()` callers (lines 78–90). |
| 9 | `apps/vscode/src/core/controller/state/subscribeToState.ts` | `sendStateUpdate(state)` — **the successful handoff boundary**. Serializes the state and dispatches it to the active state subscriptions. |

### The MCP control seam

| # | File | Role |
|---|---|---|
| 10 | `apps/vscode/src/sdk/control-seam/control-seam-protocol.ts` | The wire contract. `CONTROL_SEAM_OPERATION_IDS` (line 70) — exactly `clinemm_capabilities` and `clinemm_get_run`. `ControlSeamRunIdentity` (line 217). `isControlSeamRunIdentity` (line 331) — the fail-closed allow-list. |
| 11 | `apps/vscode/src/sdk/control-seam/control-seam-authority.ts` | `ControlSeamAuthority` (line 41) — a set of READ closures. `readControlSeamRunIdentity` — builds the wire payload. |
| 12 | `apps/vscode/src/sdk/control-seam/control-seam-runtime.ts` | `ControlSeamControllerSurface` (line 31) → `createControlSeamAuthority` (line 64). |
| 13 | `apps/vscode/src/sdk/control-seam/control-seam-server.ts` | The AF_UNIX listener. `handleGetRun` reads the authority, refuses a foreign session echo, and fails closed when the payload violates the allow-list. |
| 14 | `apps/vscode/src/sdk/control-seam/control-seam-proxy.ts` | The stdio MCP server Codex launches. Registers the two tools by the SAME ids. `toToolResult` (line 51) emits the existing text-result transport. |
| 15 | `apps/vscode/src/sdk/SdkController.ts` | The control seam is armed with READ closures over `this.sessions` / `this.task`. |

### Existing focused tests

| File | Coverage |
|---|---|
| `apps/vscode/src/sdk/control-seam/control-seam.recon01.test.ts` | Bounded protocol/authority/transport witnesses. |
| `apps/vscode/src/sdk/control-seam/control-seam-authority.production-shape.test.ts` | Drives the REAL `SdkSessionLifecycle` + REAL `ControlSeamServer`. |
| `apps/vscode/src/sdk/control-seam/control-seam.qual01.test.ts` | REAL AF_UNIX transport: ownership, request settlement, bounded NDJSON, validated opt-in, the two-operation registry. |
| `apps/vscode/src/sdk/control-seam/control-seam.owner-exclusivity.cor02.test.ts` | Instance-ownership exclusivity. |
| `apps/vscode/src/sdk/control-seam/control-seam-proxy.test.ts` | The REAL MCP SDK `Client` over an in-memory transport pair. |
| `apps/vscode/src/sdk/__tests__/task-header-authority-cutover.authority03.test.ts` | The Elm task-header authority cutover. |
| `apps/vscode/src/sdk/__tests__/task-header-unobserved-idle-demotes-completed.tuidc01.test.ts` | The production publication seam feeding the Elm authority. |
| `apps/vscode/src/sdk/__tests__/task-header-unbound-shadow-authority.tusa01.test.ts` | The unbound-shadow authority boundary. |
| `apps/vscode/src/sdk/__tests__/task-header-canonical-task-activity-ownership.cta01.test.ts` | The canonical task-activity ownership boundary. |
| `apps/vscode/src/sdk/__tests__/sdk-controller-w1-epoch-stateversion-stamping.test.ts` | The `stateVersion` / `epoch` stamping on the published snapshot. |
| `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts` | The UI label matrix. |

### ACT-owned new files

| File | Role |
|---|---|
| `apps/vscode/src/shared/task-header-state-label.ts` | The SHARED pure `TurnPhase → label` mapping (single authority for both sides). |
| `apps/vscode/src/sdk/published-task-state.ts` | The controller-owned bounded published-TaskHeader record. |
| `apps/vscode/src/sdk/control-seam/control-seam.task-state-projection01.test.ts` | R1/R2/R3/R4/R5/R6 witnesses over the REAL authority + REAL AF_UNIX transport. |
| `apps/vscode/src/sdk/control-seam/control-seam.publication-boundary01.test.ts` | The publication-boundary witness over the REAL `sendStateUpdate` handoff. |
