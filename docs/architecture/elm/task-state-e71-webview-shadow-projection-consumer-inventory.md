# E7.1 — Local Webview Shadow-Projection Consumer Inventory

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01**

This is the E7.1-C0 consumer inventory. It enumerates every production
webview consumer that participates in the Thinking/presentation decision
on the LOCAL scope, traces each to its extension producer, classifies
the current authority, and identifies the LOCAL target after the
cutover.

---

## 1. Recon scope

```text
SEARCH PATTERNS
  Thinking\.\.\.
  isThinking
  thinking
  isTaskRunning
  isStreaming
  modelStreaming
  turnPhase
  currentPhase
  awaiting_approval
  ChatRow
  RequestStartRow
  ExtensionStateContext
  TurnStateTracker
  TaskTelemetryTracker
  projectThinking
  projectTurnState

SEARCH PATHS
  apps/vscode
  apps/vscode/webview-ui
  packages
  sdk

RESULT (post-merge with predecessor ACTs)
  C2.4-CLOSE01, C2.5-CLOSE-CLEAN, ELM-02F-CORRECTION01,
  E7-CORRECTION01-FIXUP01
  — ALL CLOSED in the predecessor ACT range. The advisory surface
  (getLocalShadowProjection, getLocalShadowPhase, getLastObservedArbiter,
  getLastObservedShadowPhase, selectTaskShadowArbiterSnapshot) is
  RELEASED and unused by any webview consumer. The legacy
  TurnStateTracker is the sole authority that flows into the webview's
  `turnState` field today; the canonical TaskState shadow is recorded
  on the host only and never surfaces to the webview.

  CONSUMER_CUTOVER = ⛔ NOT YET (per migration board line 33)
  EFFECT_EXECUTION_ENABLED = false
  LEGACY_WRITERS_RETIRED = false
```

## 2. Consumer table

| ID  | Visible behavior                              | React consumer                                                                           | Input field                                                | Extension producer                                                                                                            | Current authority                  | LOCAL target |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------ |
| C1  | "Thinking..." shimmer in chat list (reasoning) | `apps/vscode/webview-ui/src/components/chat/ChatRow.tsx:881-921` (`case "reasoning"`)   | `turnState`, `thinkingPresentation`                        | `apps/vscode/src/sdk/SdkController.ts:2726` (turnState), `:2748` (thinkingPresentation)                                        | LEGACY + E7.1 → shadow             | shadow       |
| C2  | "Thinking..." shimmer below reasoning (inline) | `apps/vscode/webview-ui/src/components/chat/RequestStartRow.tsx:194-326`                 | `turnState`, `thinkingPresentation` (via `useOptionalThinkingPresentation`) | same as C1                                                                                                                   | LEGACY + E7.1 → shadow             | shadow       |
| C3  | "Thinking..." loader row (pre-reasoning)      | `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.ts:62-101` | `turnState`, `thinkingPresentation`                        | same as C1                                                                                                                   | LEGACY + E7.1 → shadow             | shadow       |
| C4  | "Thinking..." in task header (state label)     | `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx:31`      | `turnState.phase` (via `taskHeaderStateLabel`)              | same as C1                                                                                                                   | LEGACY                             | disposition (TaskHeader state label is multi-phase, not pure Thinking; explicitly OUT OF SCOPE for E7.1) |

## 3. Tracing the real transport

```text
TaskState shadow (canonical, on the host)
  ↓ AgentRuntimeEvent stream
TaskStateShadow observer (apps/vscode/src/sdk/task-state-shadow-observer.ts)
  ↓
TaskShadowHostWiring
  apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
  ├── recorder.recordDifferential(...)
  ├── coordinator.observe(...)
  └── getArbiterSnapshot() → selectTaskShadowArbiterSnapshot(canonical, legacyPhase)
       │
       └── ↓ projects onto the canonical ArbiterSnapshot.execution.modelStreaming
       ↓
SdkController.getLocalShadowProjection()
  apps/vscode/src/sdk/SdkController.ts:1078
  ↓
selectThinkingPresentation({ canonicalShadow, currentLegacyPhase, seq })
  apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:233
  ↓
ExtensionState.thinkingPresentation: ThinkingPresentationProjection
  apps/vscode/src/shared/ExtensionMessage.ts:148
  ↓
ExtensionStateContext (webview replica, no merge — direct pass-through)
  apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  ↓
useExtensionState().thinkingPresentation
  ↓
ChatRow.tsx:908 (case "reasoning") ─┐
RequestStartRow.tsx:215 (inline)    ├─ C1..C3 Thinking consumers (E7.1 cutover)
useThinkingLoaderRow.ts:53         ┘
TaskHeaderTelemetry.tsx:31 (NOT MIGRATED in E7.1 — see disposition row C4)
  ↓
"Thinking..." shimmer / loader row
```

VS Code's webview transport (extension → webview) uses gRPC postMessage
via `WebviewGrpcBridge`. The `thinkingPresentation` field flows through
the same transport as `turnState` — both are stamped every
`SdkController.getStateToPostToWebview` push and delivered to the
webview via the gRPC streaming subscription.

## 4. Hop classification

```text
REFERENCE_PASS_THROUGH
  thinkingPresentation field flows unchanged from ExtensionStateContext
  into each consumer via useExtensionState().thinkingPresentation.

COPY
  field is part of the stateData JSON payload — direct copy via
  setState(prevState => ...stateData) — no transformation in the
  webview transport.

TRANSLATE
  apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:233
  selectThinkingPresentation() — Translates (ArbiterSnapshot | undefined, TurnPhase, seq)
  into ThinkingPresentationProjection. The two-source rule applies.

DERIVE
  ChatRow.tsx:908 — derives canonicalModelStreaming from
  thinkingPresentation?.modelStreaming ?? turnState?.phase === "streaming".
  RequestStartRow.tsx:215 — same derivation pattern.
  useThinkingLoaderRow.ts:78 — derives computeIsWaitingForResponse from
  the same projection, with shadow wins.

FILTER
  ExtensionStateContext drops partial-message stream diffs before
  merging with the snapshot — orthogonal to E7.1; no filter on
  thinkingPresentation.

CACHE
  In-memory caches in the SdkController:
  - turnStateTracker (TurnStateTracker class)
  - taskStateShadowWiring (TaskShadowHostWiring class)
  Both feed thinkingPresentation via the synchronous
  selectThinkingPresentation() call inside getStateToPostToWebview.

RECONSTRUCT
  None. thinkingPresentation is never reconstructed from chat prose
  on the webview; the field is always authoritative or absent (legacy
  fallback when absent).

LEGACY_INFERENCE
  Predecessor ACTs (DOGFOOD-CORRECTION04-CORRECTION04 and
  DOGFOOD-CORRECTION04-CORRECTION04-CORRECTION01) replaced the legacy
  message-tail inference in ChatRow + RequestStartRow with the
  canonical turnState.phase conjunction partner. E7.1 replaces the
  conjunction partner with the canonical shadow projection (LOCAL)
  or the same turnState.phase fallback (Hub/Remote / pre-observation
  absence).
```

## 5. Coverage gate

```text
THINKING_RENDER_SITES_DISCOVERED       = 3
  (ChatRow.tsx:881, RequestStartRow.tsx:194-326, useThinkingLoaderRow.ts:62-101)
  Plus 1 disposed (TaskHeader state label — multi-phase, not pure Thinking)
THINKING_RENDER_SITES_AUDITED          = 3
THINKING_RENDER_AUDIT_COVERAGE         = 100%

THINKING_INPUT_FIELDS_DISCOVERED       = 2
  turnState, thinkingPresentation
THINKING_INPUT_FIELDS_TRACED_TO_HOST   = 2
THINKING_FIELD_TRACE_COVERAGE          = 100%

UNRESOLVED_THINKING_CONSUMERS          = 0
```

## 6. Predecessor freeze (read from task-state-migration-board.md)

```text
E7-LOCAL-BACKEND-ACTIVATION01       ✅ CLOSED (commit d9b524b5)
E7-CORRECTION01                     ✅ CLOSED (commit e875d181f)
E7-CORRECTION01-FIXUP01             ✅ CLOSED (commit a46f0f214)
ELM-02F-CORRECTION01                ✅ CLOSED (commit ae111383b)

Before E7.1:
  consumer cutover | E7/E7.1 | Webview reads shadow projection | ⛔ NOT YET

E7.1 target after PASS:
  consumer cutover | E7.1 | LOCAL webview Thinking/presentation
                              reads qualified shadow projection | ✅ PASS
```

The migration-board row 33 ("Thinking presentation") in the predecessor
freeze is the row this ACT flips. Other consumer rows (button set,
composer lockout, follow-up routing, etc.) are explicitly NOT touched.
