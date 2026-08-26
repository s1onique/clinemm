# EPIC-TASK-PRESENTATION

> Task presentation substrate: context/compaction (authority + lifecycle) and task-state presentation (header, projection, telemetry-strip). See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: CLOSED framework (the 4 ACTs in this family are all closed; the substrate is what the rest of the task-presentation surface relies on)
- Priority: P1 (substrate for task lifecycle)
- Current frontier: see board rows 22 (`CLASSIC-PROTECTION-RECON01`) and 23 (`REMOVE TEMPORARY YOLO BYPASS`) for the unblocked next-frontier work after Safe-YOLO closure
- Blocked by: n/a

## Contract / durable conclusions

- **Compaction authority.** Compaction is owned by exactly one authority (`ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01`). Selection, sequencing, and cancellation all flow through that authority; downstream observers project from it. Per FACT-001.
- **Context accounting.** Context-window accounting is truthful across read/compaction boundaries (`ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01`). The truth-row invariant: any consumer reading context length observes the same number after compaction as the canonical source.
- **User-context ceiling.** A user-context ceiling applies (`ACT-CLINEMM-USER-CONTEXT-CEILING01`) — the host enforces a hard ceiling; the producer cannot exceed it without explicit user override.
- **Task state presentation.** The task-header projection (`ACT-CLINEMM-E7`) is the canonical consumer of task-state for the webview; downstream telemetry strips read from the same projection.

## ACT ledger

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01` | CLOSED | L3202-3336 | Compaction ownership |
| `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` | CLOSED | L3202-3336 | Truth-row invariant for context length |
| `ACT-CLINEMM-USER-CONTEXT-CEILING01` | CLOSED | L3202-3336 | Hard user-context ceiling |
| `ACT-CLINEMM-E7` | CLOSED | L3337-3377 | Task-state header projection (canonical webview source) |

## Open work

None directly in this epic. Reopen conditions:

- New compaction authority appears that bypasses `COMPACTION-STATE-AUTHORITY01`.
- Context accounting observed diverging between producer and any consumer.
- User-context ceiling becomes soft in production.

## Deferred work

None.

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
