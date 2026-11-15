# Phase 4 — Compaction Evidence Contract

**ACT:** `ACT-CLINEMM-ROUND-C-HARNESS-01`
**Scope:** Investigation and design. This ACT does **not** redesign compaction
and does **not** change any compaction behaviour.

Every number below was measured against the supplied Round C evidence
(`1794702518894_gui73.messages.json` and `1794702518894_gui73.compaction.json`)
with the offline profiler from Phase 1. The raw session dumps are not
committed.

---

## 1. Why the stored summary repeats ~49% task-contract text

**Measured: 48.94%** (10,495 of 21,443 characters).

The cause is structural, not a summarizer failure. The stored compaction
summary is not a free-form summary of the conversation — it is the
**session's own context preamble**, and the task contract is a region of
that preamble delimited by the production markers:

```
<!-- cline-task-contract:begin -->
…
<!-- cline-task-contract:end -->
```

The region spans character 10,948 to 21,443 of the 21,443-character
summary. The contract is copied **verbatim**, including the runtime
completion-obligation boilerplate and the entire prior ACT's phase
listings.

Two independent mechanisms produce the repetition:

1. **Structural copy.** The contract is a delimited region in the
   session preamble, so anything that persists the preamble persists the
   contract. The contract is *authoritative input*, not conversation
   output, so a summarizer that compresses "what was said" has no reason
   to touch it.
2. **Historical layering.** The contract block contains the **previous**
   ACT's full phase structure ("Adversarial falsification of Round B
   production risks", "Phase 0 — Repository identity", …) in addition to
   the current ACT's. The preamble accumulates contracts across ACTs
   rather than replacing them.

**Consequence for the ledger.** A contract block is *policy*, not
*evidence*. It must never be recorded as an observation, and the ledger's
observation kinds exclude it by construction — there is no
`task_contract` kind, and the digest-based source identity means a
repeated contract cannot masquerade as a repeated observation.

**The contract is also the wrong thing to spend context on.** 10.5k of
21.4k characters — nearly half the summary budget — is spent on text that
did not change between turns. This is a compaction *efficiency* finding,
distinct from the evidence question, and it is recorded as such.

---

## 2. Why prior observations are reported blank or unverified

**This is the most consequential finding of Phase 4, and it is a
falsification of the summary's own account.**

The summary states, under `## Files`:

> - **Read**
>   - No confirmed file content is visible from this segment.
>   - Attempted read-only targets included:
>     - Git identity/status.
>     - `.gitlab-ci.yml`.
>     - … (~40 further targets)

And under `## State`:

> their tool results appear blank/non-visible

**Measured against the same transcript:**

| Measurement | Value |
|---|---:|
| `tool_result` messages in the compacted prefix (messages 0–394) | 208 |
| …of which carried **non-empty** result content | **206** |
| …of which carried empty result content | 2 |
| `tool_result` messages retained in the compaction sidecar | **6** |
| `tool_result` messages **dropped** | **202** |

So 206 of the 208 observations the summary describes as "blank" were
present and non-empty **in the source transcript**. The summary did not
observe blank results; it observed **no results**, because the results it
needed had already been dropped by the compaction it was describing.

These numbers are produced by `analyzeCompactionLoss` in
`roundc-replay/compaction.ts` and were verified against the real evidence
by running the analyzer over the raw Round C transcript and sidecar.

This is a **self-referential evidence gap**, and it is the precise failure
the evidence ledger is designed to close:

> A summary that says "blank" cannot be distinguished from a summary
> written where the observations really were blank — because the evidence
> that would settle the question was removed by the very act being
> questioned.

The round-trip is: observations exist → compaction drops them → the
summary describes the drop as a property of the observations → the
summary is trusted because it sounds like an observation → the original
transcript is never consulted again.

Note also that the summary's own `## Files` section enumerates ~40
**attempted** targets — it faithfully records the *attempt* while
recording no *result*, because the results were not in its context.

**Consequence for the ledger.** The ledger records the observation
**before** the compaction, with a digest of the source, so a later
summary's "blank" claim can be checked against the record. A summary that
asserts "no confirmed file content is visible" can be compared against an
observation whose verification state is `verified`.

---

## 3. Whether original tool results, model-visible results and provider-ready requests can be correlated

**Partially, and only for the retained tail.**

The compaction sidecar carries 13 messages: 1 summary message plus a
12-message tail. The correlation analysis:

| Measurement | Value |
|---|---:|
| `tool_use` ids in the original transcript | 209 |
| `tool_use` ids in the compaction sidecar | 6 |
| Sidecar ids **present in the original** | **6 / 6** |
| Distinct `tool_call_id`s with results in the compacted prefix | 208 |
| …whose result the sidecar still carries | 6 |
| …**dropped** | **202** |

**What this means:**

- **Within the retained tail, correlation is exact.** All 6 carried
  `tool_use` ids resolve against the original transcript, because the
  `tool_use_id` is the model's own identifier for the call. No new
  identifier scheme is needed — the existing id is already the
  correlation key.
- **Beyond the retained tail, correlation is impossible.** 202 of 208
  results are gone, and the summary carries no reference to them. There is
  no surviving artefact that identifies what was dropped.
- **The provider-ready request is not independently observable in the
  sidecar.** The sidecar records what the conversation *became*; it does
  not record what was actually *sent* to the provider. A result can be
  present in the conversation, rewritten when the request is built, and
  truncated by a context budget — and the sidecar cannot distinguish
  those three cases.

**Consequence for the ledger.** The ledger's `source.toolCallId` is the
`tool_use_id`, which is the correlation key that already works. The
ledger additionally carries `source.sourceHash` and `source.sourceBytes`
so that "which version of this result" is answerable, and a separate
observation kind is needed for the provider-ready view rather than
reusing the conversation view.

**This is the concrete gap Phase 2's tracer was built to close:** the
`provider_ready` boundary records the byte count and digest of each
tool result **as it appears in the request that was actually sent**,
which is the third view the compaction sidecar cannot supply.

---

## 4. What information is lost when a context window is compacted

**Measured loss on the single Round C compaction:**

| Dimension | Before | After | Retained |
|---|---:|---:|---:|
| Transcript messages | 397 | 13 | 3.3% |
| `tool_result` messages | 208 | 6 | 2.9% |
| Tool results with non-empty content | 206 | — | — |
| `tool_use` ids | 209 | 6 | 2.9% |
| Distinct tool call ids with results | 208 | 6 | 2.9% |

**Five distinct kinds of information are lost. They are not
interchangeable, and a summary cannot recover any of them:**

1. **Result content.** The output itself. Unrecoverable — it existed
   only in the dropped messages.
2. **Result identity.** Which tool call produced which result. Partially
   preserved for 6 calls; gone for 202.
3. **Result provenance.** The *fact* that a result existed, its byte
   count, and its digest. Gone for 202 calls — this is what makes the
   "blank" claim unfalsifiable.
4. **Tool-call arguments.** The commands that were run. Gone for 202
   calls. The summary's `## State` notes the run of ~40 file targets and
   ~675 command strings, but not their arguments.
5. **The model-visible view.** Whether a result was actually delivered to
   the model, as opposed to merely existing in the conversation. The
   sidecar cannot distinguish "produced and delivered" from "produced and
   dropped before delivery".

Item 5 is the one that most directly explains the observed behaviour:
**the summary's claim that results were "blank" may be an accurate
report of what the MODEL saw, while being an inaccurate report of what
EXISTED.** Those are different questions, and the compaction sidecar
answers only the first.

**What is not lost:** the task contract (§1), and the summary's own
structural narrative (goals, state, highlights, next steps). The
compaction preserves the *plan* and discards the *evidence*, which is
the inverse of what an evidence ledger needs.

---

## 5. The concrete design — an immutable, HEAD-bound evidence ledger

Implemented in `sdk/packages/core/src/observability/evidence/evidence-ledger.ts`
(13 tests in `evidence-ledger.test.ts`).

### 5.1 Record shape

```ts
interface EvidenceObservation {
  observationId: string          // derived, stable
  kind: EvidenceKind             // tool_result | file_read | command_output
                                 // | model_turn | compaction
  source: {
    toolCallId?: string          // the model's own tool_use_id
    messageId?: string
    subject?: string             // a path or URL
    sourceHash: string           // SHA-256 of the source content
    sourceBytes?: number
  }
  verification: EvidenceVerification
                                 // verified | refuted | unverifiable | pending
  findingRefs: readonly string[] // IDs of findings, never finding text
  head: string                   // the git HEAD at capture
  capturedAtIso: string
  label?: string                 // a classification, not content
}
```

Each entry additionally carries a `chainDigest`.

### 5.2 Invariants

| # | Invariant | How it is enforced |
|---|---|---|
| I1 | **Immutable** | The builder is the only producer; it has no edit or remove method. A correction is a *new* observation. `build()` returns a fresh array, so a caller cannot mutate the ledger. |
| I2 | **HEAD-bound** | Every observation carries the HEAD it was captured at. The ledger carries the HEAD it was built for. `verifyEvidenceLedgerAgainstAnchor` reports `head-mismatch` when they differ. |
| I3 | **Immutable ids** | `observationId` is *derived* from `(kind, sourceHash, head, findingRefs)` — not supplied by the caller. The same observation always yields the same id; a caller cannot forge one. |
| I4 | **Tamper-evident** | Each entry's `chainDigest` commits to its predecessor's digest. Editing an entry or removing one from the middle breaks the chain and `verifyEvidenceLedger` reports the broken index. |
| I5 | **Tail-truncation detected via an anchor** | A forward-committing hash chain cannot, on its own, distinguish "shorter" from "tail removed". `sealEvidenceLedger` captures an external anchor (digest + entry count + HEAD); `verifyEvidenceLedgerAgainstAnchor` compares against it and reports `entry-count-mismatch` / `digest-mismatch`. This limitation is asserted explicitly in a test rather than papered over. |
| I6 | **No credentials, no raw content** | An observation stores a **digest** and a **byte count**, never the content. There is no field that can hold a secret, a prompt, a file's content, a command's arguments or a command's output. `label` is documented as a classification; `subject` is a path. |
| I7 | **Findings are indexed, not duplicated** | `findingRefs` holds IDs. The ledger never stores a finding's text, so it cannot become a second, divergent copy of the findings. |
| I8 | **The contract is not evidence** | There is no `task_contract` kind. Because ids are content-derived, the 48.94% repeated contract text cannot produce repeated observations. |

### 5.3 Where it hooks in

The ledger is designed to be written **at the moment of observation**,
which is exactly where the Phase 2 latency tracer's boundaries are:

| Boundary | Ledger observation |
|---|---|
| `tool_execution` start | `command_output` — id, digest, bytes; `verification: "pending"` |
| `tool_result_delivered` | `tool_result` — id, digest, bytes; `verification: "verified"` |
| `provider_ready` | `tool_result` — a **second** observation with the digest of the result **as sent**, which is what makes "model-visible" answerable separately from "exists" |
| `compaction` | `compaction` — the sidecar's digest, the count of dropped results, the count of retained ids |

Because the ledger is written at the boundary and not at compaction time,
the 202 dropped results are **already recorded** when compaction runs.
Compaction cannot destroy them, because compaction does not own them.

### 5.4 What this design deliberately does NOT do

- It does not redesign compaction. No memory subsystem is proposed.
- It does not change what the summary contains.
- It does not change the runtime's hot path — the tracer's overhead is
  ~508 ns per enabled boundary pair, and the ledger adds a digest
  (~1 µs) and an append.
- It does not claim the ledger was populated in the Round C session. It
  was not: the session predates the instrumentation. The ledger is the
  mechanism that would have made the §2 finding falsifiable.

---

## 6. Summary of findings

| # | Finding | Status |
|---|---|---|
| F1 | The summary repeats 48.94% task-contract text because the contract is a delimited region of the session preamble that is copied verbatim, and it accumulates across ACTs. | **CONFIRMED** (measured) |
| F2 | The summary's "blank/non-visible" claim is **not** a property of the observations. 206 of 208 results in the compacted prefix were non-empty. The summary lacked the results because compaction dropped 202 of them. | **CONFIRMED** (measured) |
| F3 | Correlation of the retained tail is exact — 6 of 6 carried `tool_use` ids resolve against the original, using the model's existing `tool_use_id` as the key. Correlation beyond the tail is impossible: 202 of 208 results are unreferenced. | **CONFIRMED** (measured) |
| F4 | Five kinds of information are lost (content, identity, provenance, arguments, model-visibility). The model-visibility loss is what makes the summary's claim undecidable. | **CONFIRMED** (measured) |
| F5 | The provider-ready view is not observable in the sidecar, so "exists", "delivered" and "sent" cannot be distinguished from the compaction record alone. | **CONFIRMED** (structural) |
| F6 | An immutable, HEAD-bound evidence ledger with observation ids, source hashes, verification results and finding references is implementable without touching compaction, and is implemented. | **CONFIRMED** (13 tests) |

### The next experiment

The single highest-value change is **not** to the ledger — it is to
eliminate F5 at the source, by recording the provider-ready digest at
the `provider_ready` boundary (Phase 2's tracer, now committed). That
one boundary converts F2 from "unfalsifiable" to "falsifiable", because
it makes the difference between "the result was empty" and "the result
was dropped before the model saw it" observable at the moment it
happens, rather than inferable only from a lossy sidecar.
