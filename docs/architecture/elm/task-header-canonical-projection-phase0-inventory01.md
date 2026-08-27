# ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01 — Phase-0 inventory

> Phase 0 of the factory reviewer's plan.
> Recon-only. No production change. No test change. No board change. No commit yet.
>
> Inventory TaskHeader surface. Classify each visible field by source authority.
> Do NOT design or refactor before this map exists.

## 0. Entry baseline

- HEAD: `ab6e29a2e` (commit immediately before this file was written; working tree clean)
- ACT: `ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01`
- Reviewer: task-state architect / React-UI engineer / Factory reviewer
- Phase 0 mode: inventory only. Reviewer stop rules:

```text
HALT_RECON_SEAM_NOT_FOUND
HALT_RED_NOT_REPRODUCED
HALT_MESSAGE_TAIL_BECOMES_AUTHORITY
HALT_TIMING_SCOPE_CREEP
HALT_CANCEL_OWNERSHIP_SCOPE_CREEP
HALT_RUNTIME_SEMANTIC_DELTA
```

## 1. Prior ACT inventory (must be understood first)

This ACT was prescribed on the assumption that the TaskHeader's canonical projection is missing. Phase 0 reveals the opposite: the projection exists, is published, is consumed, and is regression-pinned. The board still lists the EPIC as OPEN — same post-sharding drift as `E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`.

| ACT / EPIC ID | Commit | Verdict | Evidence |
|---|---|---|---|
| `ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` (recon) | `8b62e164b` | `HALT_CANONICAL_PROJECTION_INSUFFICIENT` (recon-only; bounded follow-up recommended) | `docs/architecture/elm/task-state-thcp01-recon-evidence.md` |
| `ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01` | `149fb131e` | `PASS_TASKHEADER_CANONICAL_PROJECTION` (published projection; migrated TaskHeader off legacy `turnState.phase`; 18 selector + 7 helper tests; ablation proven) | `docs/architecture/elm/task-state-thcp01-migration01-evidence.md` |
| `ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / THCP11` | `8a7e53742` | `PASS_TASKHEADER_CANONICAL_PROJECTION` (host-override freshness proof + reviewer P1 closure) | same evidence file, §THCP11 closure addendum |
| `ACT-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` (recon) | `e54a71326` (+ `0db0201cc` hygiene) | `NOT_REPRODUCED` (timer is documented task wall-clock age; nothing to fix in scope) | `docs/architecture/elm/task-state-oat01-owner-aware-timing-recon-evidence.md` |
| `ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01` | `9e2fcfbe3` (+ CORRECTION01 in `9b1d29869`, FIX01 in `e5c6bf486`) | CLOSED (canonical delegation, no duplicate authority) | `docs/architecture/elm/task-header-live-activity-coherence01-evidence.md` |
| `ACT-CLINEMM-TASKHEADER-LIVE-TIMER-ZERO-RESET01` | `48685b8c5` (+ evidence dogfood in `287b23f81`) | CLOSED (anchored taskTelemetry on resume seam) | `docs/architecture/elm/task-header-live-timer-zero-reset01-evidence.md` |
| `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01` (sibling — same board drift pattern) | `df8d71d4b` | `CLOSED_NOT_REPRODUCED` (board reconciled; precedent for this Phase-0 finding) | `docs/architecture/elm/task-state-e71-static-thinking-presentation-persistence01-reclosure.md` |

## 2. Phase-0 inventory: visible TaskHeader field × source × classification

Source files inspected (read-only):

- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx:1-290`
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx:1-272`
- `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts:1-268`
- `apps/vscode/webview-ui/src/components/chat/chat-view/shared/turnStateSelectors.ts:1-135`
- `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:258-326`
- `apps/vscode/src/sdk/SdkController.ts:3515-3528` (publication seam)
- `apps/vscode/src/shared/ExtensionMessage.ts:163-226` (wire types)

Classification legend (per reviewer):

```text
CANONICAL           = host-published projection, single source of truth
LEGACY_FALLBACK     = backstop when projection absent (Hub/Remote / pre-observation)
DERIVED_BUT_SAFE    = pure function of canonical input, no independent authority
DUPLICATE_AUTHORITY = second independent lifecycle classifier (the defect family)
LIVE_UNOBSERVABLE   = depends on chat-tail / effect cardinality / timer / etc.
```

| TaskHeader surface | Visible field | Actual source path | Classification |
|---|---|---|---|
| Working / thinking label | `state.label`, `state.glyph` | `taskHeaderPresentationStateLabel(presentation, turnState)` → `stateLabel(phase)` in `taskHeaderTelemetryHelpers.ts:146-176` (consumed at `TaskHeaderTelemetry.tsx:227-233`) | **CANONICAL** when `taskHeaderPresentation` is on the wire (host-published three-source precedence at `task-state-shadow-arbiter-mapper.ts:260-326`); **LEGACY_FALLBACK** when projection absent (Hub/Remote / pre-observation). No third path. |
| Elapsed timer | `elapsedText` | `resolveElapsedDisplayMs(telemetry.startedAt, telemetry.endedAt, now)` at `taskHeaderTelemetryHelpers.ts:115-124`. Webview `setInterval(1000)` is presentation only. | **CANONICAL** (`telemetry.startedAt` is host-owned; the webview's `setInterval` is explicitly NOT the authority — pinned by THCP11 freshness closure). `endedAt` freezes display when set; cleared on same-task continuation. |
| Tool count (cumulative) | `telemetry.toolCalls` | Host-owned `taskTelemetry.toolCalls` | **CANONICAL**. Webview never re-derives. |
| Tool mechanism breakdown | `MECHANISM_DESCRIPTORS` chip map | `telemetry.mechanism` field, gated by `isUsableMechanismProjection(mechanism, toolCalls)` (`taskHeaderTelemetryHelpers.ts:249-267`). Falls back to flat `🔧 N` if validator fails. | **CANONICAL** when validator returns true (4-condition wire-boundary validator: finite non-negative ints; bucket sum === `mechanism.total`; `mechanism.total === toolCalls`). **LEGACY_FALLBACK** (flat count) when validator fails. No third path. |
| Recovery count (`↻ N`) | `telemetry.recoveryBudgetFailures` | Host-owned `taskTelemetry.recoveryBudgetFailures` | **CANONICAL** (host-owned counter). Display via `showRecovery` predicate. |
| Working-directory badge | `currentTaskItem?.cwdOnTaskInitialization` | `TaskWorkingDirectoryBadge` consumes `currentTaskItem.cwdOnTaskInitialization` | **CANONICAL** (host-owned task item metadata) |
| Cost / price-tag | `${totalCost.toFixed(4)}` | `useProviderUsageCostDisplay` + provider-billing-mode gate (`isCostAvailable` at `TaskHeader.tsx:147-156`). Subscription billing modes (ClinePass) suppressed per `COST-DISPLAY-TRUTH01` and `cb92f83a5` | **DERIVED_BUT_SAFE** — combines canonical provider config with billing-mode gate. No independent lifecycle classifier. |
| Tokens / context-window | `<ContextWindow>` sub-component | Consumes `lastApiReqContextInputTokens`, `lastApiReqTotalTokens`, `tokensIn`, `tokensOut`, `cacheReads`, `cacheWrites`, `selectedModelInfo.contextWindow` | **CANONICAL** (every field is host-owned projection or props). `lastApiReqContextInputTokens` is the source of truth for the occupancy bar per `CONTEXT-ACCOUNTING-TRUTH01`. |
| Model / provider label | (rendered via `getModeSpecificFields` and `useNormalizedApiConfiguration`) | Provider-normalized config; no chat-derived inference | **CANONICAL** (host-owned API configuration) |
| Cancel affordance | `CancelTaskButton` (rendered by `ChatView`, NOT TaskHeader) | `isRunLive(turnState)` in `turnStateSelectors.ts:98-103` | **CANONICAL** — outside TaskHeader's authority by design. |
| Resume affordance | (rendered outside TaskHeader) | Same — `turnState.phase === "resumable"` | **CANONICAL** — outside TaskHeader. |
| "New task" button | `<NewTaskButton>` | `onClose` prop on TaskHeader | **NOT_A_LIFECYCLE_FIELD** — orthogonal. |
| Copy / Delete / Compact / Open-Disk | `<CopyTaskButton>` / `<DeleteTaskButton>` / `<CompactTaskButton>` / `<OpenDiskConversationHistoryButton>` | Each consumes its own canonical props | **NOT_A_LIFECYCLE_FIELD** — orthogonal. |

## 3. Authority chain summary

The TaskHeader is a **pure projection consumer**:

```text
apps/vscode/src/shared/ExtensionMessage.ts:163-226
  defines TaskHeaderPresentationProjection, TaskHeaderTelemetryStrip, TurnState
                  │
apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:258-326
  selectTaskHeaderPresentation (three-source precedence:
    host compaction override > shadow > legacy absence fallback)
                  │
apps/vscode/src/sdk/SdkController.ts:3515-3528
  taskHeaderPresentation: selectTaskHeaderPresentation(...)
  in getStateToPostToWebview() — single publication seam
                  │
apps/vscode/src/context/ExtensionStateContext.tsx (webview)
  mirrors the field on the webview side
                  │
apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx:48-55, 95-97
  reads from context (prop preferred for testability)
                  │
apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx
  consumes taskHeaderPresentation + telemetry via
  taskHeaderPresentationStateLabel (canonical projection entry point)
                  │
helper (taskHeaderTelemetryHelpers.ts:213-221)
  taskHeaderPresentationStateLabel prefers projection, falls back to
  turnState.phase only when projection is absent
                  │
helper (taskHeaderTelemetryHelpers.ts:146-176)
  stateLabel(phase): pure TurnPhase → {label, glyph, live} mapping
```

Every visible TaskHeader field traces back to one of:

1. `taskHeaderPresentation` (host projection, three-source precedence)
2. `taskTelemetry` (host projection)
3. `turnState` (host projection, only consulted when projection absent)
4. Provider-normalized API config
5. Pure presentation functions over the above

**No `messages.at(-1)`, no `lastMessage.ask/say`, no message-tail inference, no chat-derived fallback, no independent lifecycle classifier was found in the TaskHeader source.**

## 4. Halt assessment vs the reviewer's stop rules

| Stop rule | Applies? | Why |
|---|---|---|
| `HALT_RECON_SEAM_NOT_FOUND` | INVERTED — seam FOUND | The projection seam `selectTaskHeaderPresentation` is present, published, consumed, and pinned by 18 selector tests + 7 helper tests + THCP11 freshness test. |
| `HALT_MESSAGE_TAIL_BECOMES_AUTHORITY` | NOT TRIGGERED | No message-tail / last-ask / last-say inference in the TaskHeader source. The state label is a pure `phase → {label, glyph, live}` function over host-published `phase`. |
| `HALT_TIMING_SCOPE_CREEP` | INVERTED — explicitly out of scope per reviewer | Timing semantics live on `TaskHeaderTelemetry` (`resolveElapsedDisplayMs`) and consume `telemetry.startedAt` / `endedAt` only. No owner classification (AGENT/HUMAN/terminal/error) is currently exposed; this would be `OWNER-AWARE-TIMING01` work, which is also already reconcluded `NOT_REPRODUCED` at `e54a71326`. |
| `HALT_CANCEL_OWNERSHIP_SCOPE_CREEP` | NOT TRIGGERED | Cancel button is OUTSIDE TaskHeader by design. Phase 0 makes no proposal to redesign Cancel ownership. |
| `HALT_RUNTIME_SEMANTIC_DELTA` | NOT TRIGGERED | No runtime-side delta is proposed. Phase 0 is read-only inventory. |
| (new) `HALT_RED_NOT_REPRODUCED` | **TRIGGERED** | Phase 3 (RED) presumes a duplicate authority survives. The Phase 0 inventory finds none. Per the reviewer's rule: "If RED does not reproduce an actual duplicate authority: HALT_RED_NOT_REPRODUCED. Then close as recon-only rather than inventing a refactor." |

## 5. Recommended next move

Per the reviewer's own stop-rule language, the right disposition is:

```text
ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01 (this ACT)
  → close as recon-only
  → VERDICT = HALT_RED_NOT_REPRODUCED (RED would not reproduce, see §4)
  → EPIC EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01
    reconcile board row: OPEN → CLOSED (matches 149fb131e + 8a7e53742
    which actually closed the work but lost the board update during
    the sharding rewrite at 536ea37a7 — same pattern as E7.1)

EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01
  → OAT01 recon at e54a71326 reached NOT_REPRODUCED
  → board row 36 ("2 task-header projection items OPEN") should drop to
    "1" — only OWNER-AWARE-TIMING01 genuinely remains (and even that
    has NOT_REPRODUCED recon evidence)
  → recommend separate reclosure ACT (mirrors this one)
```

Both reclosures are bounded docs-only corrections matching the
`ACT-CLINEMM-RACT-LAUNCH-HEAD-BINDING01` precedent at `5b0fbd611`:
no production change, no test change, no upstream snapshot refresh.
They are precisely the kind of "negative architectural knowledge +
board reconciliation" work the Factory reviewer has previously
authorized as the right disposition when the code is right but the
board lies.

## 6. What this ACT does NOT do

- Does NOT redesign TaskHeader.
- Does NOT add a second state machine.
- Does NOT widen the canonical projection contract.
- Does NOT touch Cancel / Resume ownership semantics.
- Does NOT touch elapsed-time semantics.
- Does NOT commit yet.

Awaiting user decision on §5.

## 7. Disposition (decided)

Per Factory reviewer (2026-08-27): combine the two stale TaskHeader fronts into one bounded documentary reconciliation ACT, **NOT** two ceremonial ACTs. Honor `HALT_RED_NOT_REPRODUCED`. No Phase 1-8 work.

```text
ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01
  PRIMARY_PURPOSE = DOCUMENTARY RECONCILIATION

  In-scope rows:
    1. TASKHEADER-CANONICAL-PROJECTION
    2. TASKHEADER-OWNER-AWARE-TIMING

  Bounded claims (THCP):
    ACT-...-THCP01 (recon)    = HALT_CANONICAL_PROJECTION_INSUFFICIENT
    ACT-...-MIGRATION01       = PASS_TASKHEADER_CANONICAL_PROJECTION
    THCP11                    = PASS (publication freshness/conservation)
    CURRENT_HEAD duplicate    = NOT_FOUND (Phase-0 inventory)
    FINAL FAMILY STATE        = CLOSED

  Bounded claims (OAT):
    ACT-...-OAT01 (recon)     = NOT_REPRODUCED
    CURRENT_HEAD              = no new contradictory evidence
    FINAL FAMILY STATE        = CLOSED_NOT_REPRODUCED
                                (NOT "OWNER_AWARE_TIMING_CORRECT = PROVEN" —
                                 NOT_REPRODUCED is the boundary, not positive proof)

  CURRENT_HEAD_CONSERVATION  = PASS
    18/18 thcp01 selector tests (149fb131e, 8b7e53742 lineage)
    35/35 taskHeaderTelemetryHelpers tests
    6/6 thcp11 host-compaction freshness test
    Run on ab6e29a2e; PASS.
```

## 8. Evidence boundary (important)

This Phase-0 inventory **did not rerun every historical test**. It discovered and reconciled existing executable evidence at current HEAD. The "PASS" verdict for THCP is the conjunction of:

1. The historical `PASS_TASKHEADER_CANONICAL_PROJECTION` claim at `149fb131e` / `8a7e53742` (durable evidence in `task-state-thcp01-migration01-evidence.md`).
2. The 18+6+35 = 59 historical tests still passing at HEAD (`ab6e29a2e`) when re-run today.

The two together bind current HEAD to the historical THCP contract.

## 9. Status

- No production change.
- No test change.
- No board change **in this file**.
- Phase-0 inventory file: written, untracked.
- Board + detail-file corrections land in the bounded reconciliation ACT `ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01` (the next ACT).
- Working tree clean (HEAD is `ab6e29a2e`).
