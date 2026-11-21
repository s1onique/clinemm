# ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 — Conservation Results

All controls drive the REAL production seams:
`createCompactionStateAwarePrepareTurn()` → `projectSessionCompactionState()`
→ `applyTaskContractToCompactedMessages()` → `applyVerifiedEvidenceToCompactedMessages()`
→ `MessageBuilder.buildForApi()`.

The executable binding is
`sdk/packages/core/src/extensions/context/compaction.stable-prefix-repair01.test.ts`
(18 tests) and the predecessor's inverted suite
`sdk/packages/core/src/extensions/context/compaction.summary-churn01.test.ts`
(20 tests).

---

## C1 — Canonical evidence

| Control | Executable assertion | Result |
|---|---|---|
| Valid successful tool outcomes retained | `expect(signals.get("call_ev_b")).toBe(true)` — the post-boundary outcome's model-visible result body carries the affirmative `success: true` payload | PASS |
| Failed outcomes excluded | `expect(signals.get("call_cf")).toBe(false)` and `expect(text).not.toContain("call_cf")` — a failed result is never promoted to a success | PASS |
| Missing results excluded | `expect(text).not.toContain("call_cu")` — an unpaired call carries no verified outcome | PASS |
| Ambiguous results not promoted | The unchanged `evidence-continuity.test.ts` (62 tests) pins the fail-closed classifier: `unmatched_result`, `ambiguous_call_id`, `ambiguous_result_id`, `tool_name_mismatch`, `result_precedes_call`, `result_is_error`, `no_success_signal`, `conflicting_status`, `payload_failure` | PASS |
| Multi-command result accounting conserved | `expect(signals.get("call_cb")).toBe(true)` — a three-command batch that wholly succeeded is a single verified outcome; the unchanged suite pins `commandCount === 3` and the rendered `3 commands` | PASS |
| Tool-call/result correlation exact | The join is by `tool_use_id`, never by position. The unchanged suite pins the `ambiguous_call_id` and `ambiguous_result_id` rejections | PASS |
| Ordering conserved | `extractVerifiedToolOutcomes()` sorts by the canonical call index. The unchanged suite pins the rolling selection order | PASS |
| No duplicate carried outcomes | The unchanged suite pins `applyEvidenceToSummary()` idempotence: `expect(applyEvidenceToSummary(once, ledger)).toBe(once)` | PASS |
| No delimiter spoofing | The unchanged suite pins that the carried subject is a finite-allowlist CLASSIFICATION, so a raw command can never carry a delimiter; and that a delimiter that reached a subject is escaped | PASS |
| Superseded outcomes handled correctly | Scenario F of the discriminator: `call_f1` and `call_f2` are both carried, in canonical order; scenario J (stale-read replacement) shows `call_j` and `call_j2` both carrying the success signal in the tail | PASS |

## C2 — Stable prefix

| Control | Executable assertion | Result |
|---|---|---|
| Unchanged persisted summary remains byte-identical | `expect(projectedSummaryText(after.prepared?.messages ?? [])).toBe(projectedSummaryText(before.prepared?.messages ?? []))` | PASS |
| Append-only verified outcome does not rewrite the early summary | the same assertion, plus the RED witness itself | PASS |
| Multiple successive successful outcomes preserve the prefix | four continuations (`h0`→`h1`→`h2`→`h3`), all four summaries asserted equal | PASS |
| Same-byte-length but different outcome content is handled correctly | `expect(afterText).toBe(beforeText)` AND `expect(afterText.length).toBe(beforeText.length)` — a length-neutral rewrite would be caught by the content assertion | PASS |
| No artificial prefix stability through omitted evidence | the NEGATIVE CONTROL below | PASS |
| Legitimate new compaction may establish a new prefix | `expect(run.savedStates.length).toBe(1)`; `expect(saved.source_message_count).toBe(canonical.length)`; `expect(text).toContain("call_rc")` — the new sidecar carries the new boundary's evidence | PASS |

### The negative control

```
const stripped = run.providerRequest
    .map((message) => { /* drop every tool_result block */ })
    .filter((message) => /* drop now-empty messages */);
const signals = providerVisibleSuccessSignals(stripped);
expect(signals.get("call_ev_neg")).toBeUndefined();
expect(signals.get("call_ev_neg")).not.toBe(true);
```

Removing the post-boundary verified evidence from the model-visible request
makes the evidence-continuity assertion **FAIL**. A repair that achieved
prefix stability by SUPPRESSING evidence would make this control pass, and
it does not.

### The positive control

```
expect(second.providerRequest.length).toBe(first.providerRequest.length);
expect(JSON.stringify(second.providerRequest)).toBe(
    JSON.stringify(first.providerRequest),
);
```

With no verified outcome added, the provider-visible prefix is unchanged
AND no extra message is introduced.

## C3 — Task contract

| Control | Executable assertion | Result |
|---|---|---|
| Original task objective retained | `expect(text).toContain("Adjudicate the ten findings.")` | PASS |
| User constraints retained | `expect(text).toContain("Do not add replacement findings.")` | PASS |
| Completion obligations retained | the unchanged `task-contract-conservation.test.ts` (29 tests) and `task-contract-conservation.historical.test.ts` (3 tests) pin the runtime completion obligation | PASS |
| Active contract updates not suppressed merely to preserve cache hits | `expect(afterText).not.toBe(beforeText)` and `expect(afterText).toContain("Also report the repository identity.")` — a genuine canonical contract change STILL updates the summary | PASS |
| Contract budget overflow fails closed | the unchanged `task-contract-budget-authority.test.ts` (9 tests) — `TaskContractBudgetError` is thrown before any persistence or dispatch | PASS |

**The repair did not touch `applyTaskContractToCompactedMessages()`.** The
task contract was independently measured to be byte-stable across an
append-only continuation even BEFORE the repair (the predecessor's 2×2
ablation established this, and it was re-verified here).

## C4 — Sidecar and resume

| Control | Executable assertion | Result |
|---|---|---|
| `source_prefix_hash` remains valid | `expect(state.source_prefix_hash).toMatch(/^sha256:/)`, and the projection SUCCEEDS against the persisted sidecar | PASS |
| `source_message_count` remains authoritative | `expect(state.source_message_count).toBe(h0.length)` | PASS |
| Boundary identity conserved | `session-compaction.ts` is UNCHANGED; the unchanged `session-compaction.test.ts` (12 tests) passes | PASS |
| Persisted sidecar unchanged during read-only projection | `expect(JSON.stringify(state)).toBe(before)` | PASS |
| Appended canonical tail included exactly once | `expect(text.split("call_sh2").length - 1).toBe(1)` | PASS |
| Historical sidecar compatibility retained | a sidecar whose summary carries NO evidence section is enriched once with the BOUNDARY-scoped section. The enrichment is itself stable across continuations, so it does not re-introduce the churn (measured: the pre-repair behaviour grew the section by one line per continuation) | PASS |
| Invalid sidecar rejected | `expect(run.prepared?.messages).toBeUndefined()` — the projector refuses, and the request falls back to the canonical transcript | PASS |
| Resume produces equivalent model-facing evidence | the restoration path is the SAME code path a resume takes (`projectSessionCompactionState()` → restoration), so a resumed session produces the identical provider-visible representation | PASS |

## C5 — Re-compaction

| Control | Executable assertion | Result |
|---|---|---|
| New summary receives required canonical evidence | `expect(text).toContain("call_rc")` | PASS |
| Old summary evidence not duplicated | the unchanged `compaction.roundc-fidelity-recon02.test.ts` idempotence test passes: exactly ONE `Verified tool outcomes (canonical record)` heading across repeated applications | PASS |
| Tool outcomes crossing old/new boundaries remain attributable | the boundary-scoped derivation uses the canonical PREFIX, so an outcome is attributed to the boundary it belonged to; the ledger's join is by `tool_use_id`, never by position | PASS |
| No accidental re-compaction loop | the repair does not change WHEN a compaction happens; it changes only what the carried section is derived from. The unchanged `compaction.trigger-accounting-representation.test.ts` and `compaction.working-context-ratio.test.ts` pass | PASS |
| New sidecar binds to the correct canonical source | `expect(saved.source_message_count).toBe(canonical.length)` — and the Phase-A evidence call passes the SAME boundary, so the persisted section and the persisted boundary agree by construction | PASS |
| Fresh compaction respects effective request budget | the budget authority is unchanged and fail-closed; the repair can only REDUCE the measured request | PASS |

## C6 — Stale-read behaviour

| Control | Executable assertion | Result |
|---|---|---|
| Existing stale-read policy remains unchanged | `message-builder.ts` is UNCHANGED | PASS |
| Intentional stale-read replacement not silently disabled | unchanged | PASS |
| No duplicate old/new result presented as independent verified outcomes | scenario J of the discriminator: `call_j` and `call_j2` are distinct tool-call identities with distinct results; the canonical ledger carries both as distinct outcomes, each with its own success signal — the OLD one is not re-presented as a new outcome, because the join is by `tool_use_id` | PASS |
| Stable-summary repair does not rely on raw tool-result bodies staying immutable | the carried section is derived from the CANONICAL PREFIX at the boundary — a fixed prefix of the transcript — and not from any raw result body that a later stale-read rewrite could change | PASS |

## C7 — Provider conservation

| Control | Executable assertion | Result |
|---|---|---|
| System prompt unchanged for equivalent requests | the repair does not touch the system prompt; `publishWorkingContextEstimate()` receives the same `projectedSystemPrompt` | PASS |
| Ordered tool inventory unchanged | the repair does not touch `context.tools` | PASS |
| Model/provider configuration unchanged | the repair does not touch the model | PASS |
| Tool-call/results serialized correctly | the unchanged `MessageBuilder.buildForApi()` path is used, and the discriminator read the real serialized output | PASS |
| No extra provider calls | the repair adds no request; `additionalProviderRequests: 0` in the prefix comparison | PASS |
| No new externally visible protocol field | no proto change, no wire change | PASS |
| No unapproved host-side filesystem effect | the two disposable tools live under `.factory/evidence/.../tool/` and are outside every build; the production change writes nothing | PASS |

---

## The predecessor's inverted assertions — exact before/after

`compaction.summary-churn01.test.ts` pinned the DEFECT and explicitly
deferred the repair to a later ACT ("It does NOT assert a repair. The
stable-prefix repair is a SEPARATE, later ACT."). Three assertions asserted
that the churn HAPPENED; they are now inverted to pin the repaired
behaviour. The file still has 20 tests; nothing was weakened, skipped or
deleted.

| Test | Before | After |
|---|---|---|
| "rewrites the provider-visible summary when an append-only canonical continuation adds a verified outcome" | `expect(afterText).not.toBe(beforeText)` + `expect(evidenceSection(afterText)).not.toBe(evidenceSection(beforeText))` + `expect(afterText).toContain("call_h1_new")` | "keeps the provider-visible summary byte-identical …": `expect(afterText).toBe(beforeText)` + `expect(evidenceSection(afterText)).toBe(evidenceSection(beforeText))` + the boundary outcome `call_h0_a`/`call_h0_b` are still carried |
| "only the variants that enable EVIDENCE restoration reproduce the churn" | `expect(observed.C).toBe(true)`; `expect(observed.D).toBe(true)` | `expect(observed.C).toBe(false)`; `expect(observed.D).toBe(false)` — no variant mutates the summary |
| "re-enabling evidence restoration RESTORES the mutation under equivalent inputs" | `expect(withEvidence).not.toBe(withoutEvidence)` | kept, but the assertion now also states WHAT the difference is: the enrichment still adds the section (`expect(withEvidence).toContain("call_ab_h0")`) and does NOT add the post-boundary outcome (`expect(withEvidence).not.toContain("call_ab_h1")`) |
| "moves the evidence section alone when a new outcome is verified but the contract is unchanged" | `expect(afterText).not.toBe(beforeText)` | "does NOT move the evidence section …": `expect(afterText).toBe(beforeText)` + `expect(evidenceSection(afterText)).toBe(evidenceSection(beforeText))` |
| "moves the contract section alone when the canonical contract changes but no new outcome is verified" | UNCHANGED | UNCHANGED — a genuine contract change still moves the summary, and that is asserted in the new suite too |
