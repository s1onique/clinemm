# Source Seam Map — ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01

HEAD: `fbf3eef2e` (origin/main, 2026-09-01)
Branch: `main`
Recon: 2026-09-01 (this ACT)

This is the file:line inventory backing the Q1–Q12 answers in
`ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01.md` §2.

## Webview (chat DOM owner — Q1, Q3, Q8)

| Seam                                   | File:Line                                            | Note |
|----------------------------------------|------------------------------------------------------|------|
| `Virtuoso` import                      | `apps/vscode/webview-ui/src/components/chat/chat-view/components/layout/MessagesArea.tsx:4` | confirms library |
| `Virtuoso` props                       | `apps/vscode/webview-ui/src/components/chat/chat-view/components/layout/MessagesArea.tsx:241-267` | `bottom: Number.MAX_SAFE_INTEGER` |
| `displayedGroupedMessages` derivation  | `apps/vscode/webview-ui/src/components/chat/chat-view/components/layout/MessagesArea.tsx:125-193` | memoization seam |
| `filterVisibleMessages` (visibility only, no windowing) | `apps/vscode/webview-ui/src/components/chat/chat-view/utils/messageUtils.ts:116-177` | drops a fixed set of types only |
| ChatRow render                         | `apps/vscode/webview-ui/src/components/chat/ChatRow.tsx` (whole file) | per-row render cost |
| ChatView mount                         | `apps/vscode/webview-ui/src/components/chat/ChatView.tsx:390-451` | `<MessagesArea ... />` |
| `ChatView` data source                 | `apps/vscode/webview-ui/src/components/chat/ChatView.tsx:51-86` | reads `clineMessages` from `useExtensionState` |
| `useExtensionState` replica merge      | `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:597-770` | W1/W2/W3 channels, pure updater |
| Functional updater (R9-purity)         | `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:666-770` | pure derive-and-return |
| `applyMessage` reducer                 | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:154-217` | per-message merge |
| `applyStateSnapshot` reducer           | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:236-270` | full-snapshot merge (NEVER truncates same-epoch) |
| `applyTurnState` reducer               | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:72-80` | seq-gated turn phase |

## Webview subscription to host (Q2, Q5, Q9)

| Seam                                   | File:Line                                            | Note |
|----------------------------------------|------------------------------------------------------|------|
| `subscribeToState` initial wire        | `apps/vscode/src/core/controller/state/subscribeToState.ts:19-55` | first post = full state JSON |
| `sendStateUpdate` (per push)           | `apps/vscode/src/core/controller/state/subscribeToState.ts:61-86` | `JSON.stringify` + fire-and-forget |
| `recordStateSizeTelemetry` (LIVE)      | `apps/vscode/src/core/controller/state/subscribeToState.ts:88-90` | `captureGrpcResponseSize` — only live performance signal |
| `subscribeToPartialMessage` (per-message) | `apps/vscode/src/core/controller/ui/subscribeToPartialMessage.ts` (file) | cheap per-message wire |

## Host state build (Q4, Q6, Q7)

| Seam                                   | File:Line                                            | Note |
|----------------------------------------|------------------------------------------------------|------|
| `getStateToPostToWebview` entry        | `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:23-34` | pure builder |
| `clineMessages` shallow spread         | `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:92` | **`[...controller.task?.messageStateHandler?.getClineMessages?.()]`** — full copy |
| `taskHistory` slice                    | `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:95-98` | bounded to 100 |
| All settings reads                     | `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:38-87` | O(1) per post |
| Return assembly                        | `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:119-199` | full ExtensionState |
| Caller (`SdkController`)               | `apps/vscode/src/sdk/SdkController.ts:3796-3800`      | dynamic import → `buildBaseState(...)` |

## Host → webview bridges (Q2, Q5)

| Seam                                   | File:Line                                            | Note |
|----------------------------------------|------------------------------------------------------|------|
| `pushPartialMessage`                   | `apps/vscode/src/sdk/webview-grpc-bridge.ts:93-100`  | per-message stream |
| `pushStateUpdate` (host-initiated)     | `apps/vscode/src/sdk/webview-grpc-bridge.ts:110-135` | full state; ends/done/error |
| `createListener` (session event bridge) | `apps/vscode/src/sdk/webview-grpc-bridge.ts:55-59` | event-driven entry |
| `handleSessionEvent`                   | `apps/vscode/src/sdk/webview-grpc-bridge.ts:69-88`   | partial → partial; `ended`/`done`/`error` → state |
| Host-session-event coordinator         | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:52-100` | `pending_prompts`, `pending_prompt_submitted`, etc. |
| `appendAndEmit`                        | `apps/vscode/src/sdk/sdk-message-coordinator.ts:98-101` | stamps seq/epoch, emits to listeners |

## Host post debouncing (Q5)

| Seam                                   | File:Line                                            | Note |
|----------------------------------------|------------------------------------------------------|------|
| Debounce window                        | `apps/vscode/src/sdk/SdkController.ts:712`          | `STATE_POST_DEBOUNCE_MS = 50` (≤20 posts/sec) |
| `StatePostDebouncer`                   | `apps/vscode/src/sdk/state-post-debouncer.ts:28-96`  | coalesces burst to trailing flush |

## Diagnostics in production (Q9)

| Diagnostic                             | File:Line                                            | Status |
|----------------------------------------|------------------------------------------------------|--------|
| `recordStateSizeTelemetry` (post size) | `apps/vscode/src/core/controller/state/subscribeToState.ts:88-90` | **LIVE** in production |
| `activity.publication.v1` ring (D-knob)| `apps/vscode/src/sdk/activity-publication-v1.ts:1-...` + `apps/vscode/src/sdk/host-ownership-diagnostic-runtime.ts:18-...` | DOGFOOD-OPT-IN |
| Webview `Profiler` boundary            | —                                                    | NONE |
| Debouncer timing log                   | —                                                    | NONE |
| Native `sample` integration            | —                                                    | NONE (operator runs ad-hoc) |

## Cycle analysis (Q11)

| Search target                          | Outcome                                              |
|----------------------------------------|------------------------------------------------------|
| `setState` ↔ `postStateToWebview` cycle | NOT FOUND in production-seam code |
| Pure updater enforcement               | `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:666-770` — R9-purity |
| Re-entrant `postStateToWebview`        | NOT FOUND; every call site is event-driven OR coordinator-drained |

## Owner-routing authority (Q11, supportive)

| Seam                                   | File:Line                                            |
|----------------------------------------|------------------------------------------------------|
| `TurnStateTracker.setWithWriter` (no double-write) | `apps/vscode/src/sdk/turn-state-tracker.ts` (file) |
| Task-shadow-arbiter mapper             | `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:163-...` |
