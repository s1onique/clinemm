# ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — Causal Classification

---

## 1. PRINCIPAL RESULT

```
EVIDENCE_RESTORATION_CAUSAL
```

The production summary churn reproduces; evidence carry-forward is
necessary for the observed early change; task-contract restoration is not
independently responsible.

### The producer

`applyVerifiedEvidenceToCompactedMessages()`
— `sdk/packages/core/src/extensions/context/evidence-continuity.ts:1366`

It re-derives the verified-outcome ledger from the ENTIRE canonical
history (`evidence-continuity.ts:1370`), renders the section
(`evidence-continuity.ts:1193`), strips the previous section and appends the
new one (`evidence-continuity.ts:1275`), and replaces the summary message
in place (`evidence-continuity.ts:1403`). The section sits at the TAIL of
the summary, but the summary's CONTENT changes — and the summary is the
FIRST provider-visible message, so every deeper prompt-cache checkpoint is
invalidated.

---

## 2. The four separately-reported statuses

These are reported independently and are NOT combined into one stronger
assertion.

### `LIVE_WIRE_MUTATION`: **observed**

Established from the preserved prefix-forensics captures of the live
session `1795229584545_t33f9` (provider `openai-compatible`, model
`qwen3.8-flash-next-q2_0`).

- The mutable provider-visible user message is at **wire index 1**, the
  first user message, the largest text part, the `compaction_summary`
  carrier.
- Across iterations **26→39**, its content fingerprint changed on **12 of
  13** adjacent transitions.
- The **25→26** transition is a genuine compaction-shaped transition
  (71 → 15 messages, 10,114 → 14,761 bytes).
- The **27→28** transition changes the content while keeping the **same
  byte length** (14,802 → 14,802) — 7 such transitions exist across the
  capture.
- The **30→31** transition is the negative control: the fingerprint did
  **not** change (14,802 → 14,802, unchanged).
- The **31→32** transition is a renewed mutation (unchanged length, changed
  fingerprint).
- The system prompt fingerprint and the ordered tool inventory were
  **byte-stable across every single transition**.
- The mutation is introduced at the **`runtime_projection`** stage and
  propagates byte-identically through `ai_sdk_prompt` to `wire_request`.

### `OFFLINE_CAUSAL_MECHANISM`: **established**

- The REAL production functions, driven against the REAL persisted sidecar
  and the REAL canonical transcript of the SAME live session, reproduce the
  mutation across append-only canonical continuations (H0→H1→H2).
- The changed section is isolated exactly: `contractChanged: false`,
  `proseChanged: false`, `evidenceChanged: true`.
- The 2×2 ablation establishes necessity (see §3).
- The persisted sidecar is byte-identical before and after; the canonical
  transcript is append-only; no new compaction summary was created.

### `ENGINE_CACHE_EFFECT`: **inferred**

**NOT measured.** The preserved Strata server-log interval is joined to
the ClineMM requests only by TEMPORAL proximity and a request census. It
carries no authoritative per-request reuse counts for some matched
requests, and no shared cross-process request ID was independently
verified.

Per the ACT's cross-system join rules, that join is:

```
TEMPORAL_ONE_TO_ONE_SUPPORTED
```

— not an authoritative identity join. A short request is NOT proof of a
particular cache hit. The previously observed 3,895-token plateau remains
independently established but is NOT authoritatively bound to these
individual ClineMM requests.

**The engine-side effect is therefore INFERRED, and no counterfactual
speedup is claimed.**

### `REPAIR_NECESSITY`: **not evaluated**

This ACT is explicitly a causal investigation with ONE bounded ablation.
No repair was implemented, no repair was prototyped, and the necessity of
a repair was not evaluated. The successor ACT
(`ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01`) is a PROPOSAL.

---

## 3. The necessity discriminator

Measured on the REAL sidecar and REAL canonical transcript with the REAL
production functions. The switches exist ONLY in the disposable offline
experiment; they are NOT production flags and NOT public APIs.

| Variant | Task contract | Verified evidence | H0→H1 changed | H1→H2 changed | Rewritten each continuation |
|---|---|---|---|---|---|
| A — Original projection | OFF | OFF | no | no | no |
| B — Contract only | ON | OFF | **no** | **no** | **no** |
| C — Evidence only | OFF | ON | **yes** | **yes** | **yes** |
| D — Production composition | ON | ON | **yes** | **yes** | **yes** |

| # | ACT condition | Result |
|---|---|---|
| 1 | The production composition reproduces churn | **MET** (D) |
| 2 | Removing evidence restoration eliminates the relevant mutation | **MET** (B) |
| 3 | Re-enabling it restores that mutation under equivalent inputs | **MET** (C) |
| 4 | Contract-only behavior does not independently cause the same observed mutation | **MET** (B) |

### The symmetric test for task-contract restoration

The same symmetric discriminator was applied to the task contract:

- With the contract ON and the evidence OFF (variant B), the summary is
  **byte-stable** across the same append-only continuations.
- Therefore the task contract does NOT independently cause the observed
  mutation.

A separate, one-sided control confirms the contract is not inert: the
permanent suite has a case in which the canonical contract changes WITHOUT
a new verified outcome, and the summary's contract section moves ALONE
(`contractSection(after) !== contractSection(before)` while
`evidenceSection(after) === evidenceSection(before)`). The contract CAN
move — it simply does not move in the live session's observed pattern.

**⇒ `EVIDENCE_RESTORATION_CAUSAL`, not `MULTIPLE_CAUSES`.**

---

## 4. What the evidence does NOT support

Stated explicitly, because the ACT requires the limits to be preserved:

1. **The live captures do not carry section-level attribution.** They
   record fingerprints and byte counts only. A fingerprint proves two
   contents DIFFER; it cannot say which section differs. The section-level
   attribution comes from the OFFLINE reproduction on the same session's
   real artifacts.
2. **The Strata server logs are not an instrumented causal trace.** They
   were not rewritten and are not presented as one. The join is
   `TEMPORAL_ONE_TO_ONE_SUPPORTED`, not an authoritative identity join.
3. **No engine cache hit was measured.** A short request is not proof of a
   particular cache hit.
4. **No executed speedup is claimed.** See §5.
5. **This is a cache-prefix stability counterexample, NOT a semantic
   correctness bug.** The existing carry-forward behaviour may well be
   intentional. The ACT explicitly asks that this not be upgraded into a
   stronger claim.
6. **HMAC fingerprint changes establish content differences, not exact
   tokenizer offsets.**

---

## 5. The possible benefit (stated as an interval, not a false precision)

### 5.1 Observed prefill cost

`UNAVAILABLE_FROM_TRACE` at the per-request level. The ACT's held evidence
records "repeated expensive prompt processing after compaction" in the
server-log interval, and separately records the independently established
3,895-token plateau — but the plateau is not authoritatively bound to
these individual ClineMM requests, and the log extract lacks authoritative
per-request reuse counts for some matched requests.

### 5.2 Estimated recoverable prefill

`UNAVAILABLE_FROM_TRACE`. A counterfactual requires the checkpoint-reuse
function, which the trace does not authoritatively expose.

What the offline evidence DOES establish, without any engine measurement:

- The provider-visible summary is **14,802 bytes** at the churned
  iterations and is the **FIRST** provider-visible message after the
  system prompt.
- The mutation replaces only the evidence section, which occupies the
  **tail** — the common prefix is **14,020 bytes** of ~14,850.
- So a repair that keeps the summary's prefix stable would preserve
  **≥ 94%** of the summary's byte prefix as a reusable cache prefix.

This is a STRUCTURAL statement about the byte layout. It is NOT a
statement that the engine produces a checkpoint at that boundary.

### 5.3 Unrecoverable work

Even with a perfectly stable summary prefix, the following cost remains:

- the **new tokens** of each continuation (the growing canonical tail),
- the **compaction-boundary reread** at iteration 26 — the new summary is
  a genuinely different document and the cache is legitimately cold there,
- any **genuinely changed prompt content** (the system prompt and the tool
  inventory were byte-stable here, so neither contributes).

### 5.4 Checkpoint limitation

**A stable summary does NOT automatically yield a checkpoint.** The engine
selects checkpoints at its own token boundaries with its own retention and
eviction policy. A stable prefix is a NECESSARY condition for a deeper
checkpoint to be reusable; it is not a SUFFICIENT one. The engine's
checkpoint granularity, retention window and eviction behaviour are not
observable in the preserved trace.

**Therefore: the possible benefit is real in direction and unquantified in
magnitude.** This ACT does not present a counterfactual as an executed
speedup.

---

## 6. The successor (a PROPOSAL, not an authorized implementation)

```
ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01
```

**Proposed invariant:**

> Preserve the existing compaction summary's stable provider-facing prefix
> while making newly verified canonical tool outcomes available later in
> the model-facing context, without losing evidence, ordering, task
> obligations, resume correctness or budget safety.

**Constraints the successor must respect** (derived from §7 of
`conservation-results.md`):

- The verified-outcome continuity guarantee must survive. The repair is
  NOT "remove the carry-forward".
- The rolling 12-outcome selection, the canonical ordering, the
  fail-closed rejection of unverifiable outcomes, the delimiter escaping
  and the command-count semantics must all survive.
- The task contract, the budget guard (fail-closed), the sidecar identity
  and the resume path must survive.
- The persisted sidecar and `metadata.summary` must stay consistent with
  the provider-visible text.

**The successor design is deliberately NOT frozen here.** This ACT's causal
discriminator is complete; the successor's design is a separate decision.
