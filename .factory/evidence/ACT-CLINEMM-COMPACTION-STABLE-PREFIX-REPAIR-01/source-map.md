# ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 — Source Map

**Entry HEAD:** `9117f13ae7d643373c56eeedc30da661fc790b08` (`main`)
**Subject HEAD:** `9f57bc84d98f3439a0d70e4bf74300efef6564cd`
**Scope:** bounded production repair of the post-compaction prompt-prefix
invalidation. One production seam, one behavioural change, no new subsystem.

---

## 1. The provider-visible transformation boundary

`createCompactionStateAwarePrepareTurn()` —
`sdk/packages/core/src/extensions/context/compaction.ts:1422`.

Its three evidence-carry-forward call sites:

| Site | Line | Phase | Boundary passed | Behaviour |
|---|---|---|---|---|
| RE-COMPACTION | `compaction.ts:1595` | **A — new compaction** | `context.messages.length` | The section is derived from the FULL canonical history: the new summary's own boundary. |
| **RESTORATION** | `compaction.ts:1642` | **B — continuation** | `existingState.source_message_count` | **THE REPAIR SITE.** The persisted summary is a historical snapshot; the section is derived from the canonical prefix AT ITS OWN BOUNDARY. |
| FRESH COMPACTION | `compaction.ts:1682` | **A — new compaction** | `context.messages.length` | The section is derived from the FULL canonical history: the new summary's own boundary. |

Before the repair, all three sites derived the section from the ENTIRE
canonical history. Site 2 is the one that runs on EVERY continuation once a
sidecar exists, and it is the sole producer of the observed churn.

### The confirmed production order

```
persisted compaction state (sidecar)
   ↓  projectSessionCompactionState()               session/models/session-compaction.ts:168
canonical transcript + sidecar projection
   ↓  applyTaskContractToCompactedMessages()        extensions/context/task-contract.ts:358
task-contract restoration
   ↓  applyVerifiedEvidenceToCompactedMessages()    extensions/context/evidence-continuity.ts:1464
verified-evidence restoration  ← BOUNDARY-SCOPED at the restoration site
   ↓  MessageBuilder.buildForApi()                  session/services/message-builder.ts:219
provider-visible messages
   ↓  AI SDK → wire serialization
```

---

## 2. Ownership map — the seven questions the ACT asked

### 2.1 How the persisted summary enters a restored request

`projectSessionCompactionState()` (`session-compaction.ts:168`) clones the
sidecar's `messages` and appends `sourceMessages.slice(source_message_count)`.
The persisted summary is therefore the FIRST message of the projected list,
and the canonical tail follows it.

### 2.2 Where its historical verified outcomes were originally inserted

At compaction time, by `applyVerifiedEvidenceToCompactedMessages()` →
`applyEvidenceToSummary()` → `renderEvidenceSection()`
(`evidence-continuity.ts:1464 / 1275 / 1193`). The section is appended to the
summary prose inside explicit `<!-- cline-evidence:begin -->` /
`<!-- cline-evidence:end -->` delimiters, and the provider-visible text and
`metadata.summary` are updated together.

### 2.3 Which canonical messages appear after the stored source boundary

Exactly `sourceMessages.slice(state.source_message_count)` — the canonical
tail. The boundary is authoritative: it is the sidecar's `source_message_count`,
and the persisted `source_prefix_hash` validates that the first
`source_message_count` canonical messages are unchanged.

### 2.4 Whether new verified outcomes are visible in the provider representation

**Yes — established empirically for every required class (A–L).** The
provider-visible tail's `tool_result` block carries:

- the canonical tool-call identity in `tool_use_id`,
- the tool name in `name`,
- the result body, whose persisted `{query, result, success}` payload carries
  the affirmative `success: true` signal that `classifyToolResultStatus()`
  reads.

Verified in `tail-sufficiency-matrix.json`: for every post-boundary verified
outcome, `tailCarriesCallIdentity`, `tailHasResult`,
`tailAgreesWithCanonical` and `tailBodyCarriesSuccessPayload` are all true,
and `tailSufficient` is true.

The ONE case that needed care is scenario **B** (tool call BEFORE the
boundary, result AFTER it). The tool_use block is not in the tail, but the
RESULT block carries the call identity in `tool_use_id`, so the tail is still
sufficient. The first pass of the discriminator demanded the tool_use BLOCK
and reported scenario B as insufficient; the discriminator was corrected to
demand the call IDENTITY, which is what the verified-success authority is
actually bound to.

### 2.5 Where their verified-success authority is established

`extractVerifiedToolOutcomes()` (`evidence-continuity.ts:960`) joins canonical
tool calls to canonical tool results by `tool_use_id` and classifies the
result with `classifyToolResultStatus()` (`evidence-continuity.ts:342`). The
classification reads the RESULT ITSELF — never the tool name, never a
provider id — and fails closed on every ambiguity (unmatched result,
ambiguous call id, ambiguous result id, tool-name mismatch, result preceding
its call, error result, no success signal, conflicting status, payload
failure).

### 2.6 Where final token budgeting occurs

`applyTaskContractToCompactedMessages()` → `applyTaskContractWithMeasuredBudget()`
(`task-contract.ts:358 / 451`). It measures the PROVIDER-VISIBLE
representation through the ISOLATED accounting projection
(`prepareBudgetAccountingMessages`, never the long-lived stateful production
`MessageBuilder`) and throws `TaskContractBudgetError` before any state is
persisted or any provider request is dispatched.

**The repair adds no new model-visible content and no new message, so the
budget authority is unchanged.** The carried section is now SMALLER or equal
(a boundary-scoped ledger is a subset of the whole-history ledger), so the
measured request can only shrink.

### 2.7 Where a new compaction replaces the previous sidecar

`createSessionCompactionState()` (`session-compaction.ts:140`) builds the new
sidecar over `context.messages`, and `input.saveState?.(nextState,
context.messages)` (`compaction.ts:1597` and `compaction.ts:1690`) persists it.
The new sidecar's `source_message_count` is `context.messages.length` — which
is exactly the boundary the repair passes to the Phase-A evidence call, so the
persisted section and the persisted boundary AGREE by construction.

---

## 3. The final repair seam

### 3.1 `sdk/packages/core/src/extensions/context/evidence-continuity.ts`

| Symbol | Change |
|---|---|
| `inferCompactionSourceBoundary()` | **NEW.** Recovers the source boundary from the projection itself by measuring the longest common suffix between the projected list and the canonical history. A FALLBACK: the compaction pipeline always supplies the authoritative value. |
| `sameMessage()` | **NEW (module-private).** Compares two canonical messages by role + content, deliberately EXCLUDING the volatile transport identity (`id`, `ts`) — exactly as the persisted source-prefix hash excludes it, because the message codec regenerates both on every storage round-trip. |
| `applyVerifiedEvidenceToCompactedMessages()` | **CHANGED.** Gained an optional `sourceMessageCount`. The ledger is now derived from `canonicalMessages.slice(0, boundaryCount)` instead of the whole canonical history. |

### 3.2 `sdk/packages/core/src/extensions/context/compaction.ts`

The three call sites now pass an EXPLICIT boundary (see the table in §1). No
other production file was touched.

### 3.3 What was deliberately NOT changed

- `applyTaskContractToCompactedMessages()` — the task contract is already
  byte-stable across an append-only continuation (verified: the
  contract-only projection is unchanged), and a genuine contract change must
  still update the summary.
- `session-compaction.ts` — the persistence format, the source-prefix hash
  and the boundary identity are untouched.
- `message-builder.ts` — the stale-read rewrite policy is untouched.
- `src/shared/llms/request-budget.ts` — the budget authority is untouched.
- No new public API, no new wire-protocol field, no new persistence system,
  no second canonical evidence store, no general-purpose prompt-cache
  manager, no Strata checkpoint-policy change.

---

## 4. Existing relevant tests (inspected before adding anything)

| Suite | Tests | Role in this ACT |
|---|---|---|
| `evidence-continuity.test.ts` | 62 | The evidence carry-forward's failure/ambiguity rejection, idempotence, delimiter escaping, credential safety. **Unchanged and passing.** |
| `task-contract-conservation.test.ts` | 29 | The task-contract carry-forward and its conservation guarantees. **Unchanged and passing.** |
| `task-contract-conservation.historical.test.ts` | 3 | The same against a REAL historical sidecar and transcript. **Unchanged and passing.** |
| `task-contract-budget-authority.test.ts` | 9 | The fail-closed budget guard. **Unchanged and passing.** |
| `session-compaction.test.ts` | 12 | The sidecar projector and its source-prefix hash validation. **Unchanged and passing.** |
| `compaction.roundc-fidelity-recon02.test.ts` | 20 | The evidence carry-forward's idempotence across successive compactions. **Unchanged and passing.** |
| `compaction.summary-churn01.test.ts` | 20 | The predecessor's suite. It pinned the DEFECT and explicitly deferred the repair to a later ACT. **Three assertions INVERTED** to pin the repaired behaviour. No assertion weakened or deleted; the file still has 20 tests. |
| `compaction.summary-churn01.red.test.ts` | 1 | The RED witness. **UNMODIFIED** — it now PASSES. |

## 5. New test suite

`sdk/packages/core/src/extensions/context/compaction.stable-prefix-repair01.test.ts`
— 18 tests, all driving the REAL `createCompactionStateAwarePrepareTurn()` →
`projectSessionCompactionState()` → `applyTaskContractToCompactedMessages()` →
`applyVerifiedEvidenceToCompactedMessages()` → `MessageBuilder.buildForApi()`
chain.
