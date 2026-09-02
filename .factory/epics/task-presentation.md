# EPIC-TASK-PRESENTATION

> Task presentation substrate: context/compaction (authority + lifecycle) and task-state presentation (header, projection, telemetry-strip). See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: ACTIVE — closed substrate + closed frontier
- Priority: P1 (substrate for task lifecycle)
- Current frontier: **no open work**. The compacted-history substrate is fully closed; THCP01 + THCP11 + OAT01 all re-reconciled at `ab6e29a2e` per `ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01`; `TERMINAL-REPORT-COMPLETION-FRAMING01` + `…-CORRECTION01` both CLOSED at `ab6e29a2e` per `23010e7bb` + `bbbdffc99`; `ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01` CLOSED at `6eaa0864` per the current ACT ledger row (CASE_A selector authority defect at `selectTaskHeaderPresentation`; LIVE specimen taskId 1788292664979_9qbpd epoch 16 closed). (The earlier "1 presentation-only placeholder" line was stale — it duplicated CLOSED work under a working label; removed per reviewer P1 bounded correction. Completion-protocol liveness capture, if ever needed, lives under `runtime-task-progression.md`, not here.)
- Blocked by: n/a

## Contract / durable conclusions

- **Compaction authority.** Compaction is owned by exactly one authority (`ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01`). Selection, sequencing, and cancellation all flow through that authority; downstream observers project from it. Per FACT-001.
- **Context accounting.** Context-window accounting is truthful across read/compaction boundaries (`ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01`). The truth-row invariant: any consumer reading context length observes the same number after compaction as the canonical source.
- **User-context ceiling.** A user-context ceiling applies (`ACT-CLINEMM-USER-CONTEXT-CEILING01`) — the host enforces a hard ceiling; the producer cannot exceed it without explicit user override.
- **Task state projection authority.** The task-header projection (`ACT-CLINEMM-E7`) is the canonical consumer of task-state for the webview; downstream telemetry strips read from the same projection. **However**, two projection correctness epics are still open (see Open work) and one timing-semantics epic is open, so the `E7` substrate authority does not yet subsume all of `Task state / presentation`.

## ACT ledger

### Closed substrate (the compacted-history layer)

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01` | CLOSED | L3202-3336 | Compaction ownership |
| `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` | CLOSED | L3202-3336 | Truth-row invariant for context length |
| `ACT-CLINEMM-USER-CONTEXT-CEILING01` | CLOSED | L3202-3336 | Hard user-context ceiling |
| `ACT-CLINEMM-E7` (CLOSED substrate; see Open work for still-open follow-on epics under this same umbrella) | CLOSED | L3337-3377 | Task-state header projection (canonical webview source) |

### Open frontier (the task-header projection correctness + timing layer)

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01` | **CLOSED_NOT_REPRODUCED** | L3339-3347 | Static "Thinking ›" presentation can persist after runtime state is no longer thinking/streaming. Historical verdict (08bd6bb75) re-validated against current HEAD (20cc7c4d, +8 commits). The single canonical authority `thinkingPresentation.modelStreaming` is consulted by every active Thinking consumer (`useThinkingLoaderRow.ts:53-101`, `RequestStartRow.tsx:208-332`, `ChatRow.tsx:931-947`, `MessagesArea.tsx:9-25, 90-121`). The publication path is now additionally fenced by `applyPresentationProjections` monotonic-`.seq` (`messageReducer.ts:116-156`, `ExtensionStateContext.tsx:702-765`, 37e62d04e) so a stale same-epoch snapshot cannot downgrade `thinkingPresentation`. STP01..STP08 in `useThinkingLoaderRow.test.tsx:411-490` pass unchanged. `PRODUCTION_DELTA = 0`, `TEST_DELTA = 0`, board row reconciled (OPEN → CLOSED_NOT_REPRODUCED; this ACT exits the open list). See `docs/architecture/elm/task-state-e71-static-thinking-presentation-persistence01-reclosure.md` for the durable closure claim and `docs/architecture/elm/task-state-e71-static-thinking-presentation-persistence01-evidence.md` for the original evidence. |
| `ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01` | **CLOSED v2** | — | Terminal successful task → visible `✓ Completed` badge. Two-tier authority: per-message `isAuthoritativelyCompletedResult` marker (primary, stamped at `message-translator.ts:1640` canonical completion publication seam) + legacy ask fallback (secondary, `turnState.phase === "completed"` + non-empty text). Per-message marker is monotonic and survives phase flips (resume, retry, follow-up, compaction) so historical completion rows keep their badge. Closed fail on every other state. `CompletionOutputRow` consumes the helper; gated at both `say` and `ask` call sites in `ChatRow.tsx`. Accessibility: `aria-label="Task completed"`, `title="Task completed successfully"`. Two-row + three-row discriminators pass at both helper (40 tests) and component (19 tests) layers. |
| `ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01` | **CLOSED** | — | Bounded fix for the v1 resume-conservation gap (mutable `turnState.phase` could not stand in for historical completion identity). Added `isAuthoritativelyCompletedResult?: boolean` to `ClineMessage`. Stamped `true` at `message-translator.ts:1640` (single canonical seam, next to `setTerminalResponseCommittedThisTurn()`). Webview helper refactored: marker is primary authority, legacy ask path is secondary defense-in-depth. 15 net-new CORRECTION01 helper tests (16 added, 1 v1 test renamed to the canonical-path variant) + 3 net-new multi-row component tests pass. Helper total 40, component total 19. Plan: see `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01.md`. |
| `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` (historical name: `E7.1-2 TASKHEADER CANONICAL PROJECTION`) | **CLOSED** | L3348-3356 | TaskHeader consumes canonical task-state projections rather than reconstructing state locally. Re-reconciled at `ab6e29a2e` per `ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01`: historical `PASS_TASKHEADER_CANONICAL_PROJECTION` at `149fb131e` (migration; published `taskHeaderPresentation` projection, three-source precedence host>shadow>legacy, 18 selector + 7 helper tests, ablation proven for both branches) and `8a7e53742` (THCP11 host-compaction freshness / conservation proof + reviewer P1 closure). CURRENT_HEAD_CONSERVATION = PASS: 18+6+35 = 59 targeted tests re-run at `ab6e29a2e` and pass unchanged. Phase-0 inventory at `docs/architecture/elm/task-header-canonical-projection-phase0-inventory01.md` confirms 0 DUPLICATE_AUTHORITY rows in the TaskHeader source. The board row's prior OPEN state was caused by the board-sharding rewrite at `536ea37a7` (`docs(factory): reduce epic board to human-readable index (6346 -> 207 lines)`) which dropped the prior closure updates; the same drift pattern as `E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01` re-reconciled at `df8d71d4b`. `PRODUCTION_DELTA = 0`, `TEST_DELTA = 0`. |
| `ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01` | **CLOSED** (root-cause-isolated + repair-verified) | — | LIVE specimen (taskId `1788292664979_9qbpd`, epoch 16): authoritative `turnPhase=streaming` + persistent `taskHeaderPhase=idle` + `taskHeaderSource=shadow` + `shadowPublicationBinding=UNBOUND` (publicationId 27546+). TSWPD proves `streaming -> streaming` so the predecessor `RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01` is NOT contradicted. Source-seam inspection of `selectTaskHeaderPresentation` at `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:505` (the single producer of `taskHeaderPresentation.phase` / `taskHeaderPresentation.source` consumed by the webview TaskHeader state label and the `activity.publication.v1` builder) showed rule 3 (canonical shadow) lets an UNBOUND shadow (`canonicalShadowObservedTurnSeq === undefined`, classified as `shadowPublicationBinding="UNBOUND"` at `activity-publication-v1.ts:148`) override authoritative ACTIVE TurnState because the staleness gate is `canonicalShadowObservedTurnSeq !== undefined && seq > obs` — when the obs seq is undefined the gate cannot fire. CASE_A selector authority defect. Strategy-B bounded repair applied at `6eaa0864`: extend the rule-3 staleness gate with one complementary UNBOUND-demotion guard (`isUnboundDemotingActiveToTerminal`) that falls through to the legacy branch when (a) the shadow is UNBOUND AND (b) the shadow's phase is TERMINAL (idle/completed/error/resumable) AND (c) the legacy is ACTIVE (streaming/awaiting_approval). The REPAIR01-CORRECTION02 explicit-staleness path remains the primary mechanism for BOUND-shadow demotion; this gate only protects the UNBOUND case. **Live-shape RED captured**: `apps/vscode/src/sdk/__tests__/task-header-unbound-shadow-authority.tusa01.test.ts` TUSA01-RED/TUSA01-RED-SOURCE FAIL at HEAD `cb6610f37` with `expected 'idle' not to be 'idle'` and `expected true to be false`; both GREEN post-repair (8/8 PASS). Conservation + regression suite: TUSA01-CTL_A (idle/idle), TUSA01-CTL_D (UNBOUND non-idle agreeing), TUSA01-REG_T9 (REPAIR01-CORRECTION02 stale invariant unchanged), TUSA01-REG_HOST_COMPACTING, TUSA01-REG_HOST_AWAITING_FOLLOWUP, TUSA01-REG_FRESH_SHADOW_WINS — all GREEN. **Ablation**: same LIVE-shaped input transitions from `phase=idle, source=shadow` (pre-repair) to `phase=streaming, source=legacy` (post-repair); unrelated selector behavior byte-identical for non-UNBOUND cases. **Adjacent test reclassification** (regression-neutral, documented in test comments citing this ACT ID): THCP01 THCP04 / THCP08 / SHADOW_NECESSITY gain a fresh BOUND-shadow stamp so the legitimate shadow-wins path remains observable only when the shadow carries a same-generation TurnState-domain provenance stamp; TCR01 T14 inverted-to-fixed (its pre-repair observation was capturing the LIVE defect shape, not desired behavior). **Total test surface**: 148/148 task-header-related tests PASS across 13 files (TUSA01/THCP01/TCR01/CTA01/THCP11/CLTCC01..15/TCCC01/ARETC01/LAC01/LTZ01/RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01); apps/vscode check-types: 0 diagnostics; git diff --check: PASS. **Production delta**: 78 insertions, 10 deletions across 3 files (1 production source: `task-state-shadow-arbiter-mapper.ts`); no protocol/wire change, no new public API, no removal of shadow support, no blanket "always prefer TurnState" rule. See `.factory/evidence/ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01/` for the full evidence chain (entry-freeze.txt, source-seam-map.md, red-green-log.txt, final-report.md). |
| `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` | **CLOSED_NOT_REPRODUCED** | L3358-3377 | TaskHeader should project canonical runtime ownership/state with timing semantics (distinct from projection correctness per L3356). Re-reconciled at `ab6e29a2e` per `ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01`: historical OAT01 recon at `e54a71326` (+ `0db0201cc` hygiene) reached `VERDICT = NOT_REPRODUCED` (timer is documented task wall-clock age; nothing to fix in scope). No new contradictory evidence found at current HEAD. **NOT_REPRODUCED is the evidence boundary, NOT a positive proof of timing correctness** — the timer is documented as task wall-clock age, not as buggy. Re-open requires new live evidence that distinguishes agent-active elapsed from wall-clock elapsed and the user demands the distinction. `PRODUCTION_DELTA = 0`, `TEST_DELTA = 0`. |

## Open work

No open work as of `6eaa0864` (the LAST closure is `ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01` — see ACT ledger row above).

The earlier "1 presentation-only placeholder" was stale: `TERMINAL-REPORT-COMPLETION-FRAMING01` + `…-CORRECTION01` are both CLOSED at `ab6e29a2e` (see `23010e7bb` + `bbbdffc99`), and the §Open frontier table above (lines 35-36) records them as such. Retaining a `TERMINAL-REPORT-COMPLETION-FRAMING` placeholder here effectively resurrected closed work under a working label; removed per reviewer P1 bounded correction.

Completion-protocol liveness (a separate concern: defect at the completion-protocol/liveness seam, NOT at the framing seam) is NOT a task-presentation concern. If its live reopen trigger ever fires, it lives under `runtime-task-progression.md` as `COMPLETION-PROTOCOL-LIVENESS02`. It is not opened here. See `docs/architecture/elm/completion-framing-live-red-discriminator01.md` for the durable negative knowledge preserving the discriminator that framing is correctly closed.

Reopen / new-work conditions:

- New compaction authority appears that bypasses `COMPACTION-STATE-AUTHORITY01`.
- Context accounting observed diverging between producer and any consumer.
- User-context ceiling becomes soft in production.
- A new second independent lifecycle classifier appears in the TaskHeader source (re-open trigger for `TASKHEADER-CANONICAL-PROJECTION01`; baseline = Phase-0 inventory at `docs/architecture/elm/task-header-canonical-projection-phase0-inventory01.md`).
- Live evidence captured that distinguishes agent-active elapsed from wall-clock elapsed and the user demands the distinction (re-open trigger for `TASKHEADER-OWNER-AWARE-TIMING01`; baseline = OAT01 recon `NOT_REPRODUCED` at `e54a71326`).

## Deferred work

### COMPLETION-RESULT-COPY-BOUNDARY-RECON

```text
Priority: MED
State:    DEFER

Problem:
Models may emit substantial final prose as ordinary assistant text
before the authoritative completion_result. The existing completion
box therefore encloses only part of the human-perceived final report,
reducing one-click/copy-container usefulness.

Constraints:
- Preserve upstream-compatible CompletionOutputRow behavior by default.
- Preserve the completion box as a copy/paste affordance.
- Do NOT widen completion authority.
- Do NOT infer terminal content from prose or message-tail position.
- Do NOT change completion protocol/runtime semantics.
- Prefer upstream-compatible grouping if upstream evolves here.

Future recon questions:
1. Does the webview already expose trustworthy assistant-turn ownership?
2. Can preceding same-response content be grouped visually without
   relabeling it as completion_result?
3. Can the box offer "copy final response" independently of its visual
   ownership boundary?
4. What does current upstream do at implementation time?

Reopen trigger:
- Meaningful user demand.
- Upstream change in completion rendering.
- Completion-result UX becomes a recurring complaint.
```

Explicitly compatibility-first — the upstream-style completion
container stays as-is because the user-facing copy/paste use case
is strong and visual/behavioural proximity to upstream is worth
more right now than MiniMax-specific output grouping.

## Historical detail

The text below is migrated verbatim from the prior single-file `.factory/epic-board.md` (L3202-3377, pre-sharding) so the durable conclusions remain anchored to their source lines. **Do not rewrite history here unless the underlying ACT itself is being amended.** Each fenced payload is one board section preserved bit-for-bit (with leading/trailing separator trims documented in the section header).

### Context / compaction — L3202-3336 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L3202-3336 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## Context / compaction

Three **semantically distinct** epics; do not collapse.

### CONTEXT-ACCOUNTING-TRUTH01

- ID: `EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01`
- STATUS: CLOSED / LIVE_UI reproduced at the production seam
- CLOSED BY: `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01`

**Recon answer.** Three production seams carry the context-accounting contract in this fork; all three were traced and only one was defective:

1. **Model-info authority (capacity side)** — **CORRECT**.
   UI path: `useNormalizedApiConfiguration` → `ModelsServiceClient.resolveModelInfo` → host handler `apps/vscode/src/core/controller/models/resolveModelInfo.ts` (catalog peek → resolve → committed-selection → "unknown"). Compaction path: `tryGetModelInfo(this.config)` → `config.knownModels[config.modelId]` → SDK catalog. Both converge on the same SDK catalog entry. Upstream #12520 hypothesis (`providerConfig.modelInfo?.contextWindow` short-circuit) was inspected and **does not apply** to this fork: `providerConfig.modelInfo` is never assigned outside test code (`sdk/packages/core/src/extensions/context/agentic-compaction.ts:36` is dead code in production). The shared canonical resolver `resolveEffectiveMaxInputTokens` (`sdk/packages/core/src/extensions/context/compaction-shared.ts:51-70`) returns `min(maxInputTokens, contextWindow)` when both present, `contextWindow * 0.9` when only `contextWindow`, `maxInputTokens` when only that — used by both `compaction.ts` (primary trigger) and `agentic-compaction.ts` (summarizer budget).

2. **Compaction trigger threshold** — **CORRECT**.
   `compaction.ts:313-318`: `maxInputTokens = resolveEffectiveMaxInputTokens({maxInputTokens: context.model.info?.maxInputTokens, contextWindow: context.model.info?.contextWindow}) ?? DEFAULT_MAX_INPUT_TOKENS`. `requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO` (90%). Compaction fires when `requestInputTokens >= requestTriggerTokens`, where `requestInputTokens` is the SDK's `estimateRequestInputTokens({systemPrompt, messages, tools})` — i.e. the **estimated prompt-input size for the next request**, not the billed request activity.

3. **UI occupancy bar (usage side)** — **DEFECTIVE**.
   `ContextWindow.tsx` (pre-fix): `percentage = (lastApiReqTotalTokens / contextWindow) * 100`, where `lastApiReqTotalTokens = getLastApiReqTotalTokens(messages) = tokensIn + tokensOut + cacheWrites + cacheReads`. This conflates **current prompt input** (≈ `tokensIn`) with **billed request activity** (output + cache reads + cache writes). Cache reads in particular inflate the displayed numerator substantially for prompt-cached sessions — fully explaining the historical "~194k compaction while UI shows similar" symptom.

**Bounded repair (CORRECTION01).** New helper `getLastApiReqContextInputTokens(messages)` (same compaction-ratio rescaling semantics) returns `tokensIn + cacheReads + cacheWrites`. Threaded through `ChatView → TaskSection → TaskHeader → ContextWindow` as a new `lastApiReqContextInputTokens` prop. The occupancy bar and the displayed "used" value now reflect the provider-normalized context-input occupancy (the AI SDK `inputTokens.total` contract). `getLastApiReqTotalTokens` is preserved for any caller that legitimately wants the billed total (no current production consumer was found).

The producer seam in `apps/vscode/src/sdk/message-translator.ts:86-110 normalizeUsageEvent` already decomposes the SDK's inclusive `inputTokens` (which equals `inputTokens.total`) into **disjoint** `tokensIn / cacheReads / cacheWrites` via `uncachedInputTokens = inputTokens - cacheReads - cacheWrites`. The AI SDK Anthropic adapter emits `inputTokens.total = usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; the OpenAI-compat adapter emits `inputTokens.total = prompt_tokens` with `noCache = prompt_tokens - cached_tokens`. Both converge on the same inclusive total — the size of the prompt that competed for the model's window on the last request.

**Evidence quality.**
- RED test (initial defect, `getLastApiReqTotalTokens` inflation): `apps/vscode/src/shared/__tests__/getApiMetrics.test.ts > getLastApiReqTotalTokens > uses only the latest api_req_started payload` — asserts the billed total still equals `tokensIn + tokensOut + cacheWrites + cacheReads`.
- RED test (Anthropic-native exclusive cache, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > Anthropic-native exclusive cache accounting: tokensIn excludes the cached subset` — `tokensIn=50, cacheReads=100_000, cacheWrites=0` → `100_050` (Anthropic's documented total).
- RED test (Anthropic cache creation, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > Anthropic cache creation: cacheWrites contribute to context-input size` — `tokensIn=200, cacheWrites=12_500, cacheReads=0` → `12_700`.
- RED test (OpenAI-compat inclusive, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > OpenAI-compatible inclusive cache accounting: tokensIn already contains the cached subset` — `tokensIn=149_235, cacheReads=148_167` → `297_402` (the original `prompt_tokens`, not double-counted because the buckets are disjoint).
- RED test (`tokensOut` non-contribution, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > tokensOut never contributes to context-input occupancy` — `tokensIn=10, tokensOut=500_000` → `10` (output tokens describe the previous response, not the current request's input).
- RED test (compaction-ratio rescale, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > rescales the context-input total by the shrink ratio of a compaction completed after it` — inclusive total rescales correctly across a `tokensBefore → tokensAfter` divider.
- RED test (component level, CORRECTION01): `apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.test.tsx > treats lastApiReqContextInputTokens as the provider-normalized total (cacheReads + cacheWrites contribute)` — proves the bar reflects `lastApiReqContextInputTokens=100_050` (= 50% of 200k) for the Anthropic-native scenario, not 50 (i.e. `tokensIn` alone, which would have been 0.025%).
- Conservation: `getLastApiReqTotalTokens` API preserved (no caller regressions); `contextWindow` denominator unchanged; `resolveEffectiveMaxInputTokens` unchanged; compaction threshold formula unchanged; cost/telemetry consumers unaffected (none exist on this prop today).

**Conservation matrix verified.** Existing ordinary providers unchanged; missing model info still falls back to "unknown"; 1M model preserves 1M; lower `maxInputTokens` (if present) constrains effective input; UI and compaction now consume the same semantic domain for the *numerator*; cost calculation untouched; producer-seam contract preserved (`normalizeUsageEvent` unchanged).

**Invariant set established.**
- I1. DISPLAYED capacity identifies its semantic domain truthfully (raw physical `contextWindow`).
- I2. COMPACTION trigger uses the intended effective capacity (`resolveEffectiveMaxInputTokens`).
- I3. CURRENT_CONTEXT_USAGE (bar numerator) is now the provider-normalized context-input occupancy `tokensIn + cacheReads + cacheWrites` (the AI SDK `inputTokens.total` contract), not the lifetime/billed total and not `tokensIn` alone.
- I4. Fallback model metadata does not shadow a more specific authoritative entry.
- I5. Same active model/config does not resolve to contradictory capacities across UI and compaction paths.
- I6. The UI numerator is provider-independent — it does not switch on Anthropic/OpenAI-compat/etc. The provider normalization happens once at the producer seam and the helper just sums the resulting disjoint buckets.

**Rule observed.** No repair from leading hypothesis. The upstream #12520 hypothesis was treated as a hypothesis generator only; the actual defect was found by reading the UI projection at the production seam. No user ceiling implemented (that remains `EPIC-CLINEMM-USER-CONTEXT-CEILING01`). No arbitrary threshold tuning. No cost repair. The first-pass fix used `tokensIn`-only and was reopened by the factory reviewer as provider-blind (would undercount Anthropic-native cached prompts); CORRECTION01 moved the normalization to the AI SDK contract, which is provider-independent by construction.

**Quality gates.** Vitest canonical 118 files / 1681 tests / 0 failures. Bun unit 72 files / 1076 tests / 0 failures. Webview 69 files / 562 tests / 0 failures. Typecheck 0 diagnostics. Coverage ratchet PASS (613-file universe preserved).

### COMPACTION-STATE-AUTHORITY01

- ID: `EPIC-CLINEMM-COMPACTION-STATE-AUTHORITY01`
- STATUS: CLOSED / LIVE_UI reproduced at the production seam
- CLOSED BY: `ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01`

**Live reproduction.** UI displays `"Compacting context..."`. TaskHeader simultaneously displays `"Waiting"`.

**Evidence quality.** LIVE_UI (originating report) + PRODUCTION_SEAM RED (`apps/vscode/src/sdk/sdk-compaction-coordinator.turn-phase-authority.test.ts`, CSA02: `expected 'Waiting' not to be 'Waiting'` before repair).

**Recon answer — phase, not orthogonal dimension.** The canonical runtime authority is `TurnStateTracker` (`apps/vscode/src/sdk/turn-state-tracker.ts`), projected on the wire as `TurnState.phase` and consumed by the TaskHeader through the pure `stateLabel` projection. Compaction is a *bounded, mutually exclusive* window: `SdkCompactionCoordinator` refuses to compact while a turn is running (`COMPACTION_TURN_RUNNING_MESSAGE`), so no other phase can be concurrently true. It is therefore modelled as a phase, not as a second concurrent dimension — which would have created a second authority.

**Root cause — AUTHORITY GAP at the producer, not a projection defect.** `SdkCompactionCoordinator.runCompaction` emitted the `status: "started"` divider row and posted state to the webview, but never wrote the canonical tracker. The tracker consequently retained whatever phase the previously finished turn left behind — typically `awaiting_followup`. TaskHeader was *faithfully* projecting that stale canonical authority as `"Waiting"`. The projection was correct; the producer was silent.

**Repair.**

- `TurnPhase` gains one semantically necessary variant, `"compacting"` (SYSTEM_TRANSITION ownership) — `apps/vscode/src/shared/ExtensionMessage.ts`.
- `SdkCompactionCoordinator` enters `compacting` immediately *before* the divider is emitted and restores the entry phase **and anchor** in a `finally` — so success, failure, skip, and cancel all converge back. No new terminal state.
- `SdkController` wires the coordinator to the *same* `turnStateTracker` every other coordinator uses — no second authority.
- `stateLabel` projects `compacting → { label: "Compacting", live: true }`, reusing the existing `CompactionRow` vocabulary.

**Explicitly not done (kept separate).** No string scraping of `"Compacting context..."`; no compaction-threshold tuning; no token-accounting change. Those remain `CONTEXT-ACCOUNTING-TRUTH01` / `USER-CONTEXT-CEILING01`.

**Conservation.** A genuine human wait still reads `"Waiting"`; `streaming → Working`, `awaiting_approval → Approval`, `completed → Complete`, `idle → Idle` all unchanged (CSA07/CSA08).

### USER-CONTEXT-CEILING01

- ID: `EPIC-CLINEMM-USER-CONTEXT-CEILING01`
- STATUS: CLOSED at `ac40e43991189608b0c01cd15d039000fa0314ba` (HEAD)
- CLOSED BY: `ACT-CLINEMM-USER-CONTEXT-CEILING01`

**Goal.** Allow a user to set an effective operating ceiling below a model's advertised physical maximum.

**Configuration modes supported:**

- `Auto` — undefined = use the canonical model/provider effective input capacity (no additional user restriction; bit-for-bit preserved from `ACCOUNTING-TRUTH01`'s resolver output).
- explicit positive integer token ceiling — `min(canonicalModelEffective, userCeiling)`. Empty UI input = Auto.

**Example.** physical model max = 1,000,000 → explicit user effective ceiling = 512,000 → operating effective capacity = 512,000. Physical model capability is **not** mutated.

**Important.** `512k` is a user-configurable example / desired value. It is **NOT** a global hardcoded limit for every 1M-context model. The effective budget must satisfy `effective <= physical model maximum`, but concrete implementation must follow real source recon.

**Invariant.**

  physical model maximum   ≠
  effective configured ceiling  ≠
  current context occupancy  ≠
  cumulative token usage

**Implementation (closed by this ACT).**

- New pure policy resolver: `applyUserContextCeiling(modelEffective, userCeiling)` + `normalizeUserContextCeiling(value)` at `sdk/packages/core/src/extensions/context/compaction-shared.ts`. `modelEffective` is the existing canonical `resolveEffectiveMaxInputTokens(...)` output (NOT raw model metadata). Auto returns the canonical limit exactly; explicit ceiling lowers it; ceiling above model is silently clamped; invalid values (0 / negative / fractional / NaN / non-integer / non-numeric) normalize to Auto at the policy seam AND are rejected at the persistence seam.
- Plumbing: `CoreCompactionConfig.userContextCeiling?: number` (`sdk/packages/core/src/types/config.ts`). `createContextCompactionPrepareTurn` reads it once per `prepareTurn` (sanitized), then composes it via `applyUserContextCeiling(resolveEffectiveMaxInputTokens({...}), sanitizedUserContextCeiling)`. The result becomes `requestTriggerTokens = operatingCapacity * 0.9` — **one threshold formula, no duplication**.
- Persistence: new `userContextCeiling: { default: undefined as number | undefined }` field in `apps/vscode/src/shared/storage/state-keys.ts` (auto-generates `Settings.user_context_ceiling = 187` in proto + `UpdateSettingsRequest.user_context_ceiling = 46`). Handlers `updateSettings.ts` and `updateSettingsCli.ts` validate the value (positive integer) and persist; invalid values throw before reaching disk.
- Wiring: `cline-session-factory.ts` reads `stateManager.getGlobalSettingsKey("userContextCeiling")` (with `taskSettings?.userContextCeiling` override) and forwards via `CoreSessionConfig.compaction.userContextCeiling`. Summarizer (agentic-compaction) input budget **intentionally NOT** user-ceiling-clamped — that is the summarizer model's own context window, a separate authority (provider hard validation).
- Settings UI: `FeatureSettingsSection.tsx` adds a labeled numeric input next to Auto Compact Strategy. Empty = Auto; positive integer = explicit ceiling. Invalid inputs are rejected client-side and the persisted state is unchanged.
- Conservation: no mutation of model metadata (`contextWindow`, `maxInputTokens`); accounting helpers untouched (`getLastApiReqContextInputTokens` / `normalizeUsageEvent` unchanged); no hidden truncation; auto-condense OFF preserves existing behavior.

**Quality evidence (commit `ac40e4399`).**

- canonical apps/vscode Vitest: 118 files / **1681 tests / 0 failures**
- bun unit: 72 files / **1076 tests / 0 failures**
- webview vitest: 69 files / **567 tests / 0 failures** (was 562, +5 ceiling UI)
- SDK core vitest: 173 files / **2124 passed / 14 skipped / 0 failures** (was 94; +15 new RED family tests covering `normalizeUserContextCeiling`, `applyUserContextCeiling`, composition matrix, and three production `createContextCompactionPrepareTurn` RED family E tests at the wiring seam)
- typecheck: **0 diagnostics**
- coverage ratchet: PASS (delta **+26 statements / +13 branches / +5 functions / +25 lines**)
- markdown guard: PASS

**Dogfood qualification.**

- source head: `ac40e43991189608b0c01cd15d039000fa0314ba`
- source version: 4.1.10
- dogfood version: 4.1.10-ac40e4399
- artifact: `/private/tmp/dogfood-context-ceiling/clinemm-4.1.10-ac40e4399.vsix`
- sha256: `5f4847a176cb8ee251058e2792b604407774b99718c8cab8aa758362674e6492`
- bytes: 8,884,433
- installed: `s1onique.clinemm@4.1.10-ac40e4399` (via `codium-cline --install-extension ... --force`)

**Dependency satisfied.** `CONTEXT-ACCOUNTING-TRUTH01` (CLOSED via CORRECTION01) provided the trustworthy capacity/usage/trigger authorities; the ceiling is layered on top of `resolveEffectiveMaxInputTokens` (not a parallel duplicate). The UI's context-occupancy numerator remained the provider-normalized context-input occupancy (`tokensIn + cacheReads + cacheWrites`, the AI SDK `inputTokens.total` contract) — this ACT changes policy, not accounting.

### Historical context family (CTX-01..03)

Preserved as `NEEDS_CLASSIFICATION` rows in the canonical task index. Scope not reconstructable from current board + repository history; do not silently forget them. Reclassify when relevant.

---
````

### Task state / presentation — L3337-3377 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L3337-3377 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## Task state / presentation

### STATIC-THINKING-PRESENTATION-PERSISTENCE01

- ID: `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`
- STATUS: OPEN

**Symptom.** Static `"Thinking ›"` presentation can persist after runtime state is no longer thinking/streaming.

**Constraint.** Do not invent a second UI authority. Use the canonical state/projection.

### TASKHEADER-CANONICAL-PROJECTION01

- ID: `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01`
- HISTORICAL NAME: E7.1-2 TASKHEADER CANONICAL PROJECTION
- STATUS: OPEN

**Purpose.** TaskHeader consumes canonical task-state projections rather than reconstructing state locally.

**Distinct from timing.** This epic is about projection correctness, not elapsed-time semantics. It is **not** folded into owner-aware timing; that would lose it.

### TASKHEADER-OWNER-AWARE-TIMING01

- ID: `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01`
- STATUS: OPEN

**Goal.** TaskHeader should project canonical runtime ownership/state with timing semantics.

**Desired semantic distinction:**

- AGENT-owned work
- HUMAN-owned waiting
- completed / terminal
- error / recovery states

**Likely telemetry:** agent-active elapsed, wall elapsed if useful, tool calls, recovery count, canonical state.

**Dependencies.** `TASKHEADER-CANONICAL-PROJECTION01` must be understood first. `COMPACTION-STATE-AUTHORITY01` is CLOSED — `"Waiting"` no longer hides active compaction (the canonical `compacting` phase now projects as `Compacting`).

---
````
