# ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 — Frozen Repair Contract

**Frozen after:** the source recon, the canonical-tail sufficiency
discriminator (G1) and the RED reproduction (G2).
**Frozen before:** any production code was changed.

---

## 1. The invariant the repair must establish

> For an unchanged persisted compaction state and an append-only canonical
> continuation that adds new verified tool outcomes:
>
> 1. The already-published compaction-summary text remains byte-identical.
> 2. The model receives the required current verified outcomes.
> 3. Canonical history remains authoritative.
> 4. Sidecar and resume semantics remain valid.
> 5. Request-budget enforcement remains fail-closed.
> 6. No unauthorized provider behaviour changes are introduced.

**The repair must not achieve prefix stability merely by suppressing
evidence.**

---

## 2. The design decision (G1 — canonical-tail sufficiency)

### The discriminator

For every required scenario (A–L), and for every VERIFIED outcome that lies
at or after the stored source boundary, the real production seams were driven
and the following were established:

| Property | Established by |
|---|---|
| canonical tool-call identity | `extractVerifiedToolOutcomes()` — the call/result join key |
| corresponding result identity | the same join, by `tool_use_id` |
| verified-success status | `classifyToolResultStatus()`, reading the RESULT ITSELF |
| canonical order | the canonical index of the call |
| source-boundary position | the call's and the result's canonical index against `source_message_count` |
| provider-visible representation | the real `MessageBuilder.buildForApi()` output |
| whether an equivalent carried record already exists | the persisted section |
| whether the model can distinguish success from a merely submitted command | the result body's affirmative `success: true` payload |

### The decision

**Tail-only conservation is SUFFICIENT for every required class (A–L).**

The provider-visible canonical tail's `tool_result` block carries the
canonical tool-call identity (`tool_use_id`), the tool name (`name`), and the
result body — whose persisted payload carries the affirmative `success: true`
signal. The tail therefore represents the post-boundary verified-success
authority without any additional carried record.

Accordingly, the ACT's **Design alternative 1 (tail-only conservation)** was
selected. **Design alternative 2 (a bounded later evidence representation) was
NOT needed** and was not built: no second representation of the post-boundary
evidence exists, so there is nothing to duplicate or contradict.

### The one case that needed care

Scenario **B** (tool call BEFORE the boundary, result AFTER it). The tool_use
block is not in the tail, but the RESULT block carries the call identity in
`tool_use_id`, so the tail is sufficient. The discriminator's first pass
demanded the tool_use BLOCK and reported scenario B as insufficient; the
discriminator was corrected to demand the call IDENTITY, which is what the
verified-success authority is bound to. The corrected discriminator reports
`tailSufficient: true` for scenario B.

### What the tail CANNOT represent — and is therefore kept in the summary

Outcomes verified BEFORE the boundary have fallen out of the visible tail
entirely: the compacted prefix that held their raw records was replaced by
the summary. The boundary-scoped section keeps exactly this set.

---

## 3. The implementation contract

### 3.1 Two phases

**Phase A — NEW COMPACTION.**
A newly produced summary is a fresh lossy projection of the canonical
history. It MUST receive the verified-outcome section derived from the
canonical history AT ITS NEW BOUNDARY, or it would again omit an operation
that actually executed.

- The compaction pipeline passes `sourceMessageCount: context.messages.length`.
- The persisted sidecar's `source_message_count` is `context.messages.length`
  as well, so the persisted section and the persisted boundary AGREE by
  construction.
- A newly created compaction summary may legitimately differ from the old one.

**Phase B — SUBSEQUENT CONTINUATION.**
The persisted summary is a HISTORICAL SNAPSHOT. It is NOT rebuilt from the
growing canonical transcript.

- The compaction pipeline passes
  `sourceMessageCount: existingState.source_message_count` — the persisted
  sidecar's own boundary, which is AUTHORITATIVE.
- The section is a pure function of (persisted summary, boundary prefix). The
  boundary prefix does not change when the transcript grows, so the section is
  byte-identical across every continuation.

### 3.2 The historical sidecar (no evidence section)

A sidecar written before the evidence section existed carries no section.
Phase B still adds the boundary-scoped section, so the evidence-continuity
guarantee is not silently lost for such a sidecar. Because the derivation is
scoped to the boundary prefix, the enrichment is ITSELF stable across
continuations — it does not re-introduce the churn. (This was measured: with
the pre-repair behaviour, a historical sidecar's section grew by one line on
every continuation.)

### 3.3 The boundary fallback

`applyVerifiedEvidenceToCompactedMessages()` takes an OPTIONAL
`sourceMessageCount`. When it is omitted, the boundary is INFERRED from the
projection by `inferCompactionSourceBoundary()`, which measures the longest
common suffix between the projected message list and the canonical history.

- The projection is `[...sidecar messages..., ...canonical tail...]` and the
  tail is exactly `canonicalMessages.slice(boundary)` — a true SUFFIX.
- The sidecar's own messages are the compaction summary (not a canonical
  message) and, after a re-compaction, canonical messages from an OLDER
  boundary. Those sit BEFORE the tail in the canonical history, so extending
  the suffix match backwards reaches a message that does not match the
  canonical message at the corresponding position, and the match stops exactly
  at the boundary.
- The inference is a FALLBACK. The compaction pipeline ALWAYS supplies the
  authoritative value explicitly, so the production path never relies on the
  inference.
- The inference exists so that a direct helper call (as in the predecessor's
  RED witness) is ALSO stable, without weakening that witness's assertion.

### 3.4 The rolling 12-outcome window

`MAX_CARRIED_OUTCOMES = 12` and the "most recent 12" selection are UNCHANGED.
What changed is the SCOPE of the derivation:

- **Correctness obligation (retained):** the section must never claim a
  verified success that the canonical record does not support, and must not
  omit a boundary-verified outcome that the visible tail cannot represent.
  The boundary-scoped derivation satisfies both.
- **Presentation policy (unchanged, not a correctness obligation):** WHICH 12
  of the boundary's outcomes are shown. The same rolling selection applies,
  now over the boundary's outcomes rather than over the whole history's.

The section is NOT presented as "the current ledger". It is the boundary's
ledger, and the CURRENT outcomes are in the tail. This is why the repair does
not need a second, later evidence representation: the two are complementary,
not contradictory — the section holds the pre-boundary set (invisible to the
tail) and the tail holds the post-boundary set (invisible to the section).

### 3.5 The rules the repair obeys

| Rule | How it is obeyed |
|---|---|
| A persisted summary is a historical snapshot, not an authority replacing canonical history. | The section is derived from the CANONICAL prefix, never from a previous summary. |
| New verified facts must not silently disappear. | The post-boundary outcomes are in the provider-visible tail with their success signal; the negative control proves their removal breaks the evidence-continuity assertion. |
| Previously verified facts must not become fabricated or contradictory. | The boundary-scoped ledger is derived from a PREFIX of the canonical history, so it can only contain outcomes the canonical record actually supports; nothing is invented, and the ambiguous/failed outcomes are still rejected by the same fail-closed classifier. (It is NOT a subset of the whole-history ledger — see the budget argument in §3.7 — but every entry it does contain is canonical.) |
| An existing summary must not be mutated merely because a new successful tool result was appended later. | **This IS the repair.** |
| Existing task-contract semantics must remain intact. | `applyTaskContractToCompactedMessages()` is UNCHANGED. A genuine contract change still updates the summary. |
| If an active task contract genuinely changes, its correctness takes priority over prefix stability. | Verified: scenario C's summary still changes, and the change is contract-only. |
| Re-compaction may legitimately create a new prefix. | Phase A derives the section from the whole canonical history. |
| No permanent feature flag is required. | There is none. |
| No change to the canonical persistence format. | `session-compaction.ts` is untouched. |

### 3.6 The implementation rules

| Rule | Status |
|---|---|
| 1. No additional provider request. | **Met.** 0 additional requests. |
| 2. No new public API or wire-protocol field. | **Met.** The new option is an internal parameter of an existing function; the new exported helper is not in any package barrel's public surface... it IS exported from the module, so it is reachable, but no barrel re-export and no wire field was added. |
| 3. No new persistence system. | **Met.** |
| 4. No change to tool-call authorization. | **Met.** |
| 5. No change to provider retry semantics. | **Met.** |
| 6. No change to model selection or reasoning settings. | **Met.** |
| 7. No silent failure when required evidence cannot fit the request budget. | **Met.** The final budget guard at the provider-dispatch seam is unchanged and still fail-closed. See §3.7 for the corrected budget argument. |
| 8. No diagnostic side effects in state-mutating paths. | **Met.** |
| 9. No permanent forensic scaffolding. | **Met.** The two tools under `.factory/evidence/.../tool/` are disposable and outside every build. |
| 10. No speculative refactoring. | **Met.** One behavioural change, one new private helper, one new exported inference helper. |

### 3.7 The budget argument

Any newly exposed evidence must participate in the same effective
provider-input budget checks as other model-visible content.

**No newly exposed evidence exists.** The repair REMOVES content from the
summary (the post-boundary outcomes) and adds nothing.

**CORRECTION01 — THE SHRINKAGE ARGUMENT WAS WRONG AND IS WITHDRAWN.** An
earlier version of this document argued that the boundary-scoped ledger is a
SUBSET of the whole-history ledger, and therefore that the measured request
can only shrink. **That is not generally true.** The ledger retains the most
RECENT `MAX_CARRIED_OUTCOMES` (12) outcomes, so a boundary-scoped ledger can
retain OLDER — and, when the outcomes render longer, LARGER — entries than
the whole-history ledger does.

Measured counterexample (`tool/probe-budget.ts`): with 12 verbose outcomes
BEFORE the boundary and 12 short outcomes AFTER it, the whole-history ledger
renders 632 bytes and the boundary-scoped ledger renders 656 bytes. The
repaired summary is therefore **LONGER** in that case.

**THE ACTUAL AUTHORITY IS THE FINAL BUDGET GUARD.** The request budget is
enforced at the provider-dispatch seam, in `agent-runtime.ts`, by
`assertProviderRequestWithinBudget()`:

```ts
if (typeof this.requestBudgetCeilingTokens === "number") {
    assertProviderRequestWithinBudget({
        systemPrompt: request.systemPrompt ?? "",
        messages: toProviderVisibleMessages(request.messages),
        tools: request.tools,
        maxRequestTokens: this.requestBudgetCeilingTokens,
    });
}
```

That guard runs AFTER every `beforeModel` mutation, measures the
PROVIDER-VISIBLE projection of the FINAL messages, and FAILS CLOSED with
`TaskContractBudgetError` before any provider dispatch and before any
compaction sidecar write. The repair does not change it, does not relax it,
and does not introduce any path around it. An over-budget request therefore
still cannot leave the process.

The compaction-side guard (`applyTaskContractToCompactedMessages()`) also
remains unchanged, with its isolated accounting projection
(`prepareBudgetAccountingMessages`); the long-lived stateful production
`MessageBuilder` is still not used for an accounting-only build.

A lower estimated token count is NOT permission to drop required evidence:
the evidence was not dropped — it is carried by the canonical tail, which the
budget guard already measures.

---

## 4. What the repair deliberately does NOT do

- It does not create a second canonical evidence store.
- It does not introduce a general-purpose prompt-cache manager.
- It does not change Strata's checkpoint policy.
- It does not add a feature flag.
- It does not change the persistence format.
- It does not expand the existing prefix-forensics instrumentation.
