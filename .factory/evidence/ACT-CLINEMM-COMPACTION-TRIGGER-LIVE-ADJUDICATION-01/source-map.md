# Source map — ACT-CLINEMM-COMPACTION-TRIGGER-LIVE-ADJUDICATION-01

**Repository:** `s1onique/clinemm` · **Branch:** `main` · **ENTRY_HEAD:** `5d75a7e635a77d8e55eb9771d33f509c8bd75565`

**Scope note.** This map describes the ClineMM repository as it exists at ENTRY_HEAD. It is
NOT a claim that upstream Cline and ClineMM share an identical implementation — the two are
read separately here, and only the ClineMM tree is adjudicated.

---

## 1. The production seam, in execution order

The automatic-compaction decision lives in a single production function.

**`sdk/packages/core/src/extensions/context/compaction.ts`**
→ `createContextCompactionPrepareTurn(...)` returns the `prepareTurn` callback that the agent
runtime invokes before every model request.

| # | Step | Location | What it computes |
|---|---|---|---|
| 1 | Effective mode | `compaction.ts:615-617` | `overflowRecovery ? "overflow_recovery" : mode` |
| 2 | API-message token subtotal | `compaction.ts:618-621` | `apiMessageTokens = Σ estimateMessageTokens(message)` over `context.apiMessages` |
| 3 | **Request-time projection** | `compaction.ts:622-626` | `requestInputTokens = estimateRequestInputTokens({systemPrompt, messages: context.apiMessages, tools})` — a **request-time ESTIMATE** of the candidate |
| 4 | Working-context subtotal | `compaction.ts:627-630` | `messageInputTokens = Σ estimateMessageTokens(message)` over `context.messages` |
| 5 | Request overhead | `compaction.ts:631-634` | `requestOverheadTokens = max(0, requestInputTokens - apiMessageTokens)` |
| 6 | Canonical model capacity | `compaction.ts:635-638` | `modelMaxInputTokens = resolveEffectiveMaxInputTokens({maxInputTokens, contextWindow})` |
| 7 | User operating ceiling | `compaction.ts:639-645` | `ceilingAdjustedMaxInputTokens = applyUserContextCeiling(modelMaxInputTokens, sanitizedUserContextCeiling)` — may only **reduce** |
| 8 | Unknown-budget refusal | `compaction.ts:651-656` | in `auto` mode an unknown canonical limit returns `undefined` (no default-budget decision) |
| 9 | Raw budget | `compaction.ts:657-658` | `rawMaxInputTokens = ceilingAdjustedMaxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS` |
| 10 | **Provider-usage authority** | `compaction.ts:672-683` | `actualPreviousInputTokens = context.previousRequestInputTokens` (the **previous submitted** request's provider-reported usage) → `underestimateFactor = min(4, max(1, actualPrevious / requestInputTokens))` — engages **only** when the estimate under-counts it |
| 11 | Scaled budget | `compaction.ts:684` | `maxInputTokens = rawMaxInputTokens / underestimateFactor` |
| 12 | **Threshold construction** | `compaction.ts:685` | `requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO` |
| 13 | **The decision** | `compaction.ts:692` | `shouldCompact = requestInputTokens >= requestTriggerTokens` |
| 14 | Diagnostic publication | `compaction.ts:755-880` | `observeCompactionTrace(sink, "diagnostics", …)` — publishes the decision record (identity, arithmetic, classification) |
| 15 | Private candidate capture | `compaction.ts:898-907` | `captureCompactionDecisionCandidate(...)` — one-way, armed-only, never read back |
| 16 | **Compaction initiation** | `compaction.ts:908-910` | in `auto` mode: `if (!shouldCompact) return undefined` — **no compaction work at all** |
| 17 | Target budget | `compaction.ts:911-931` | `resolveAutoRequestTargetTokens(...)` / `translateRequestBudgetToMessages(...)` |
| 18 | Compaction execution | `compaction.ts:933-1100+` | `runAgenticCompaction` / `runBasicCompaction` / custom `compact` |
| 19 | Completion publication | `compaction.ts:1100+` | publishes `compactionMessagesBefore/After`, `compactionEvidenceRefsBefore/After`, `compactionOutcome` |

**Supporting modules.**

| Path | Role |
|---|---|
| `sdk/packages/core/src/extensions/context/compaction-shared.ts` | `COMPACTION_TRIGGER_RATIO = 0.9` (:20), `CONTEXT_WINDOW_INPUT_RATIO = 0.9` (:18), `MAX_INPUT_UNDERESTIMATE_FACTOR = 4` (:28), `DEFAULT_MAX_INPUT_TOKENS = 128_000` (:16), `resolveEffectiveMaxInputTokens` (:75-94), `normalizeUserContextCeiling` (:106-113), `applyUserContextCeiling` (:128-140) |
| `sdk/packages/shared/src/llms/tokens.ts` | `estimateRequestInputTokens` (:94-129) — `CHARS_PER_TOKEN = 3` over the JSON serialization of `{systemPrompt, messages, tools}`, plus a flat per-image cost |
| `sdk/packages/core/src/observability/latency/latency-trace.ts` | `LATENCY_METADATA_ALLOWLIST` (:191+) — the privacy contract that bounds what reaches the exported trace |
| `sdk/packages/core/src/observability/latency/latency-sink.ts` | `LatencyTraceSink` — the adapter that turns the runtime's observation channels into a `LatencyTrace` |
| `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` | forwards `preparationRequestId` verbatim into the prepare-turn context (:1796+) so the decision joins to the provider dispatch by an EXACT key |
| `sdk/packages/agents/src/agent-runtime.ts` | mints the preparation request identity BEFORE the compaction seam runs, and supplies `previousRequestInputTokens` from the previous provider response |

---

## 2. The two authorities the ACT must keep apart

| Authority | Field | Meaning | Where it comes from |
|---|---|---|---|
| **Request-time estimate** | `requestInputTokens` | The production estimator's projection of the candidate request | `estimateRequestInputTokens(...)` — `compaction.ts:622-626` |
| **Provider-reported usage** | `inputTokens` (provider events), `actualPreviousInputTokens` (decision events) | What the provider actually billed for a **submitted** request | The provider's own usage report on `provider_completed` |

`actualPreviousInputTokens` is the provider's usage for an **earlier** request. It never
describes the candidate. It only ever influences the decision **indirectly**, through
`underestimateFactor`, and only when the estimate under-counts it. In the adjudicated session
`underestimateFactor` was `1` at **every one of the 18 decisions**.

### 2.1 Why the exported trace carries `apiMessageTokens` and not `requestInputTokens`

`LATENCY_METADATA_ALLOWLIST` (`latency-trace.ts:191+`) lists `apiMessageTokens`,
`requestOverheadTokens` and `requestTriggerTokens`, but does **not** list
`requestInputTokens`. The exported trace therefore does not carry the production projection
field directly.

The production seam computes `requestOverheadTokens = requestInputTokens - apiMessageTokens`
(`compaction.ts:631-634`), so:

```
requestInputTokens  ==  apiMessageTokens + requestOverheadTokens
```

is an **exact algebraic identity**, not an approximation. The adjudicator reconstructs the
production projection from the two allowlisted fields and then checks it against the
production `>=` branch for all 18 decisions. `productionBranchInconsistencyCount` is **0**.

This reconstruction is verified against the **real** production seam by a disposable offline
probe that drives `createContextCompactionPrepareTurn` directly and reads the production
`requestInputTokens` from the raw decision payload (see §4).

---

## 3. Existing tests and diagnostics inventory

The seam was already covered before this ACT. No new permanent test was added by it.

| Test file | What it already asserts |
|---|---|
| `compaction.decision-capture.matrix.test.ts` | The decision-capture scenario matrix: below threshold, trigger arithmetic follows the production `>=` policy, provider calibration, user ceiling, unknown model limit, manual mode, overflow recovery, consecutive decisions, missing terminal event, disabled diagnostics, sink throws, synthetic sensitive content, retention overflow |
| `compaction.decision-capture.conservation.test.ts` | Tracing OFF vs ON produces identical canonical input, prepared messages, decision, compacted continuation and provider dispatch arguments |
| `compaction.estimator-parity01.test.ts` | Estimator parity between the production resolver and the canonical estimator over `context.apiMessages` + system prompt + tools |
| `compaction.trigger-accounting-representation.test.ts` | The trigger-accounting representation split (request-side vs provider-side) |
| `compaction.roundc-fidelity-recon02.test.ts` | Round C compaction fidelity against the real seam |
| `compaction.token-evidence-capture01.test.ts` | The token-evidence capture contract across both the no-op and the initiated branch |
| `compaction.latency-span-lifecycle.red01.test.ts` | Compaction-span lifecycle and the truthful terminal outcome |
| `compaction.real-producer-seam-red.test.ts` | The real producer seam |
| `compaction.test.ts`, `compaction.live.test.ts`, `compaction.long-session-discriminator.test.ts` | General compaction behaviour |
| `sdk/packages/core/src/observability/latency/latency-sink.compaction-token-evidence-capture01.test.ts` | The latency sink's compaction token-evidence capture |
| `sdk/packages/core/src/observability/latency/latency-boundaries.integration.test.ts` | Boundary integration, including `compactionEvidenceRefsAfter` |
| `apps/vscode/src/sdk/__tests__/roundc-latency-trace-identity.qual01.test.ts` | The Round C latency trace identity qualification |

**Executed in this ACT (gate results are recorded in `qualification-report.md`):**

```
bun x vitest run --config vitest.config.ts \
  src/extensions/context/compaction.decision-capture.matrix.test.ts \
  src/extensions/context/compaction.decision-capture.conservation.test.ts \
  src/extensions/context/compaction.estimator-parity01.test.ts \
  src/extensions/context/compaction.roundc-fidelity-recon02.test.ts \
  src/extensions/context/compaction.trigger-accounting-representation.test.ts \
  src/extensions/context/compaction.token-evidence-capture01.test.ts
→ Test Files 6 passed (6); Tests 69 passed | 1 skipped (70)
```

---

## 4. The disposable offline probe

The current tools could not verify the **boundary** directly: the exported trace omits
`requestInputTokens`, and no existing test drives the production seam with the **captured
dogfood configuration**. One small, disposable, offline probe was therefore introduced — it
was executed and its results observed, then **deleted**; it is not part of the repository's
test surface and is not committed.

The probe (`sdk/packages/core/src/extensions/context/zz-disposable-adjudication-probe.test.ts`,
temporary) drove the **real** `createContextCompactionPrepareTurn` with the captured
configuration:

- `contextWindow: 128000` → `resolveEffectiveMaxInputTokens` → `128000 × 0.9 = 115200`
  (the captured `rawMaxInputTokens` / `effectiveMaxInputTokens`);
- `userContextCeiling: 128000` cannot expand the canonical 115200 (`applyUserContextCeiling`
  takes the minimum), so the captured effective budget holds;
- `COMPACTION_TRIGGER_RATIO = 0.9` → `requestTriggerTokens = 115200 × 0.9 = 103680`
  (the captured trigger, reproduced exactly).

It then asserted, on the production seam's **own** captured values:

1. the budget authority (`rawMaxInputTokens`, `maxInputTokens`, `requestTriggerTokens`,
   `inputBudgetSource`, `effectiveMaxInputTokens`, `userContextCeiling`) reproduces the capture;
2. the last non-trigger magnitude classifies as `shouldCompact=false`,
   `compactionInitiated=false`;
3. the first-trigger magnitude classifies as `shouldCompact=true`,
   `compactionInitiated=true`;
4. **Hypothesis B control** — the same estimate magnitude with the trigger decision's
   previous provider usage (83,984) still classifies as `shouldCompact=false`, because the
   previous usage did not move the trigger (`underestimateFactor` stayed 1).

Result: **4 passed (4)**.

---

## 5. Observability limitations (bounded, and NOT repaired here)

1. **`requestInputTokens` is absent from the exported trace.** The allowlist carries
   `apiMessageTokens` and `requestOverheadTokens` instead. The projection is exactly
   reconstructible from them (this ACT), but a consumer that does not know the identity must
   reconstruct it. Adding the field to the allowlist would be a **new always-on telemetry
   field**, which this ACT explicitly forbids.
2. **The pre-compaction candidate has no provider usage, by construction.** Its token count
   is an estimate and is labelled `UNLABELLED` in `decision-audit.json`. No provider ever
   reported usage for it because it was never submitted.
3. **The 17 dropped working-context references are an observation only.** Whether the
   corresponding canonical evidence survived belongs to **RC-04**, not to this ACT.
4. **The installed extension bundle identity is not a source identity.** The trace's
   `identity.sourceHead` is `UNAVAILABLE_FROM_TRACE`; the bundle SHA-256 identifies the
   installed runtime, not this repository HEAD.
5. **13 `provider_first_text` events are unavailable** ("the provider did not report this
   event"). None of them is a compaction boundary, so they do not affect this adjudication.

---

## 6. Execution order of the adjudicated session (abridged)

```
decision #12  req_B3-Yjnop  mono 518461.8  31 messages  proj 103,436 < 103,680  → NOT TRIGGERED
              request_preparation  mono 518484.2  31 messages
              provider_submitted   mono 518486.6
              provider reported    83,984 tokens
              ────────────────────────────────────────────────────────────
decision #13  req_wdW3TYdm  mono 550327.2  34 messages  proj 108,280 ≥ 103,680  → TRIGGERED
              compaction START     mono 550327.2
              compaction END       mono 614891.7   duration 64,564.48 ms
                                 34 → 6 messages, 20 → 3 evidence refs (17 dropped)
              request_preparation  mono 615004.3   6 messages   ← AFTER the compaction ended
              provider_submitted   mono 615004.7
              provider reported    15,607 tokens   ← the SUBMITTED post-compaction request
```

The pre-compaction 34-message candidate was never prepared for submission. The request that
carries the preparation identity `req_wdW3TYdm` was prepared **after** the compaction span
closed, with the 6-message post-compaction representation.
