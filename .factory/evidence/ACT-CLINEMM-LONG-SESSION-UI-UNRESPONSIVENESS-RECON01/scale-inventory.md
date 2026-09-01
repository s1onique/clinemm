# Scale Inventory — ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01

HEAD: `fbf3eef2e` (origin/main, 2026-09-01)

Per launch-contract §9. Required table.

## Convention

| Column | Meaning |
|--------|---------|
| FIELD/STRUCTURE | The wire/property name in ExtensionState |
| OWNER | Where the data physically lives |
| SIZE GROWTH VARIABLE | What grows with session length |
| COPIED PER PUBLICATION? | Is a new reference allocated per state post? |
| CROSSES IPC? | Does this field ride the postMessage / gRPC stream? |
| RENDERED/MOUNTED? | Does the webview render rows for this? |
| BOUNDED? | Is the per-publish cardinality bounded by a constant? |
| KNOWN TEST? | Existing production-seam test that pins the behavior |

## Inventory

| FIELD / STRUCTURE | OWNER | SIZE GROWTH VARIABLE | COPIED PER PUBLICATION? | CROSSES IPC? | RENDERED/MOUNTED? | BOUNDED? | KNOWN TEST? |
|---|---|---|---|---|---|---|---|
| `clineMessages` | `controller.task.messageStateHandler` (`apps/vscode/src/sdk/task-proxy.ts:73` private array) | O(N) where N = message count in current task | **YES** — `[...arr]` shallow spread at `getStateToPostToWebview.ts:92` | **YES** — full JSON in every state post | **YES** — Virtuoso mounts within `top: 3000px` + `bottom: MAX_SAFE_INTEGER` working set; render is in webview | **NO** — no windowing; only visibility filter | Many: `messageReducer.test.ts`, `extension-state-context.test.tsx`, `c2-correction02*` family |
| `clineMessages` *individual row* | per-message `ClineMessage` object | per-message length of `text`, `images`, `files`, `reasoning`, etc. can be unbounded for a single row | serialized via `JSON.stringify(state)` | YES (each row in the JSON) | YES (within Virtuoso) | per-row NO; aggregate YES | `ChatRow.test.tsx` (component) |
| `taskHistory` | `stateManager.getGlobalStateKey("taskHistory")` (`getStateToPostToWebview.ts:41,95-98`) | O(K) where K ≤ 100 by `slice(0, 100)`; per-item `task` summary is a string | YES — full read on every post | YES | NO (rendered by `HistoryView`, not in chat) | **YES — bounded to 100** | history tests live in `webview-ui/src/components/history/` |
| `taskHistory` *per-item* | `HistoryItem` with `task: string`, `ts: number`, `id: string` | per-item: `task` summary length can be unbounded if user submitted a long initial prompt | serialized | YES | NO | per-item NO; aggregate bounded | — |
| `turnState` | `apps/vscode/src/sdk/turn-state-tracker.ts` (singleton) | O(1) per post — single `{phase, seq, anchorTs}` | YES — snapshot copy | YES | YES (read by 3 migrated consumers per E7.1) | YES — O(1) | `task-state-shadow*`, `e71*` family tests |
| `thinkingPresentation` | `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:163-...` (projection) | O(1) | YES | YES | YES (3 consumers) | YES — O(1) | E7.1 family |
| `taskTelemetry` | `apps/vscode/src/sdk/task-telemetry-tracker.ts` — `get()` snapshot | O(1) | YES | YES | YES (TaskHeader) | YES — O(1) | `oat01*`, `task-telemetry-tracker.test.ts` |
| `currentTaskItem` | computed inline at `getStateToPostToWebview.ts:89-91` from `taskHistory` | O(1) | YES | YES | YES (UI binding) | YES | — |
| All `*Settings` (`apiConfiguration`, `autoApprovalSettings`, `browserSettings`, etc.) | `stateManager.getGlobalSettings*` | O(1) per post | YES (read each time) | YES | partial (Settings UI) | YES | `updateAutoApprovalSettings.test.ts` |
| All `*Toggles` (`globalClineRulesToggles`, `localWorkflowToggles`, …) | `stateManager.getGlobal*/WorkspaceStateKey` | O(1) per post | YES | YES | partial | YES | — |
| `banners` / `welcomeBanners` | `BannerService.get()` | O(active_banners) — small constant | YES | YES | YES | YES — small constant | `BannerService.test.ts` |
| `mcpResponsesCollapsed`, `favoritedModelIds`, `dismissedBanners` | `stateManager` | O(K) where K = tracked set size | YES | YES | YES | small constants (settings data) | — |
| `queuedPrompts` | derived from session events | O(pending_prompts) | YES | YES | YES (footer) | YES — pending queue | `sdk-session-event-coordinator.test.ts` |
| `workspaceRoots`, `primaryRootIndex`, `isMultiRootWorkspace` | `controller.workspaceManager` | O(workspace_roots) | YES | YES | YES | YES — small constant | — |
| `remoteConfigSettings`, `remoteConfigRevision`, `remoteConfigAvailable` | `stateManager.getRemoteConfigSettings?.()`, `controller.isRemoteConfigAvailable` | O(1) | YES | YES | YES | YES — O(1) | `remote-config-refresh-coordinator.test.ts` |

## Observation: the single scaling field is `clineMessages`

Everything else is bounded. `clineMessages` is:

1. **Unbounded** in array length (no windowing anywhere)
2. **Per-row unbounded** in bytes (no per-row truncation either)
3. **Copied** on every state post (shallow spread at `getStateToPostToWebview.ts:92`)
4. **Serialized** end-to-end on every state post (`JSON.stringify(state)`)
5. **Crosses IPC** as a JSON blob (gRPC `subscribeToState` stream)
6. **Rendered** by Virtuoso within a `bottom: MAX_SAFE_INTEGER` working set

This is the **only** field whose wire-size scales linearly with
session length. It is also the **only** field that is fully
re-rendered into React on every state change. No other field has
this profile.

## Implication for the discriminator

If the operator's live capture shows the extension host (`Helper
(Plugin)`) dominating CPU + RSS, the smoking gun inside the host is
likely `JSON.stringify` (in V8's built-in serializer) — that's the
single hottest inner loop and scales with the full state JSON. The
sample will land in V8's `Serializer` or in our own
`Buffer.byteLength(stateJson)` line in `subscribeToState.ts:70`.

If the operator's live capture shows the webview renderer
(`Helper (Renderer)`) dominating CPU + RSS, the smoking gun inside
the renderer is most likely Virtuoso's measurement / re-render path
(react-virtuoso's internal rAF loop, or React's reconciler). The
sample will land in JS-frame work and not in V8's `Serializer`.

This is the smallest measurable boundary between A and C.
