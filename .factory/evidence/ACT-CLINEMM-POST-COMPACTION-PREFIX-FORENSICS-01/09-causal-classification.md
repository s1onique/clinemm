# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — Causal Classification

---

## 1. Classification

# `PREFIX_MUTATION_ISOLATED`

> *an exact early model-facing change is identified and bound to its producing
> seam.*

### 1.1 The exact change

| Field | Value |
|---|---|
| WHAT changed | the CONTENT of an existing `tool`-role message (a `tool-result` part) |
| WHERE in the message list | message index **11** (M1), **27** (M2), **41** (M3) |
| Common prefix before it | 11 / 27 / 41 messages |
| Role | `tool` — **UNCHANGED** |
| Position | **UNCHANGED** |
| Message count | **UNCHANGED** |
| `toolCallId` | **UNCHANGED** |
| Tool schema / tool order / system prompt | **UNCHANGED** |
| Bytes before → after | 26,426 → 317 / 17,380 → 332 / 16,522 → 318 |
| Part bytes before → after | 26,398 → 289 / 17,352 → 304 / 16,494 → 290 |
| The replacement | `[outdated - see the latest file content]` |
| Occurrences in the corpus | **21** in-place rewrites across **6 independent hosts** |

### 1.2 The producing seam

`sdk/packages/core/src/session/services/message-builder.ts`

| Line | Role |
|---|---|
| `:356-368` | `transformBlock()` → `replaceOutdatedReadContent()` — **the in-place rewrite** |
| `:51` | `OUTDATED_FILE_CONTENT` — the replacement text |
| `:782-864` | `commitOutdatedRewrites()` — the commit gate |
| `:39-41` | `DEFAULT_MIN_OUTDATED_REWRITE_BYTES = 65_536` — the batch threshold |
| `:216-241` | `buildForApi()` — the shielding of duplicate-read anchors/references, and the DELIBERATE non-shielding of superseded content |

### 1.3 Why this is not `MULTIPLE_CAUSES`

`BRANCH_ALTERNATION_OBSERVED` describes 201 of the 225 non-append pairs — a
new user turn starting a new task. Those are EXPECTED branch changes, and
they are not the mechanism behind the reuse plateau: the deep-reuse → plateau
transition the ACT names (17:05:07 → 17:06:03) has the shape of an
IN-PLACE rewrite, not of a branch change, and the plateau is STICKY across
the following requests — a branch change would be transient.

A branch alternation IS a genuine alternative mechanism for *some* deep-reuse
→ no-reuse transitions, and it is present in the corpus. But the mechanism
that explains the STICKY, REPEATED 3,895-token plateau across consecutive
requests is the in-place rewrite: once the early history is rewritten, the
blocking bytes stay rewritten, so the shallow reuse depth persists until the
history is rebuilt.

---

## 2. Why the other classifications do not apply

| Classification | Why not |
|---|---|
| `ADAPTER_MUTATION_ISOLATED` | The decisive difference is already present at the **AI SDK prompt** boundary — i.e. BEFORE the adapter's serialization — and it is produced by the message builder, which runs before the runtime hands the request to the provider. The adapter cannot be the producer of a change that is already in its own input. (The wire stage remains `UNAVAILABLE_FROM_TRACE`, so the ACT does not claim the wire payload is equal to the AI SDK prompt.) |
| `BRANCH_ALTERNATION_OBSERVED` | Branch changes ARE present (201 pairs) but are transient and expected (new user task). The sticky repeated plateau is explained by the in-place rewrite. |
| `CACHE_RETENTION_SUSPECTED` | D5's precondition — a STABLE request prefix — is NOT met. The prefix is demonstrably unstable. |
| `HALT_RED_NOT_REPRODUCED` | The RED was reproduced: three ablations each produced a genuine failing witness. |
| `CAPTURE_INSUFFICIENT` | The capture WAS sufficient for the discriminators that the ACT's Section 10 permits (a preserved eligible pair existed and was analysed). It is insufficient for the WIRE stage and for the TOKEN boundary, and those are reported as `UNAVAILABLE_FROM_TRACE` / `TOKEN_BOUNDARY_UNAVAILABLE` rather than being papered over. |

---

## 3. What the ACT does and does NOT establish

### 3.1 Established (directly observed)

1. The earliest model-facing difference between consecutive post-compaction
   requests is an **in-place rewrite of an early tool result**.
2. The rewrite is produced by `MessageBuilder.replaceOutdatedReadContent()`,
   under the stale-read policy's deliberate *"freshness wins over
   prefix-cache preservation"* trade-off.
3. The rewrite preserves the message count, the order, the role, the position
   and the tool-call id — so it is **invisible to any message-count or
   message-index analysis**.
4. The system prompt and the ordered tool inventory are **byte-stable** across
   every analysed boundary — D1 is refuted.
5. The mechanism is **host-independent**: 21 occurrences across 6 hosts.
6. The client-side mutation is present. The server-side checkpoint limitation
   is therefore **NOT** the explanation.

### 3.2 NOT established (explicitly withheld)

1. **`FIRST_TOKEN_DIFFERENCE = N` is NOT asserted.** No verified model
   tokenizer or chat template is available offline (the installed Strata
   exposes no tokenizer route — verified live, 404). The result is
   `TOKEN_BOUNDARY_UNAVAILABLE`.
2. **The plateau depth (3,895) is NOT asserted** to equal any message index,
   byte offset, estimator value or checkpoint length. The ACT explains the
   plateau's MECHANISM and its STICKINESS, not its exact token arithmetic.
3. **The engine's 7,053 first-mismatch position is NOT reconciled** with the
   message index found here.
4. **The wire payload is NOT claimed equal** to the AI SDK prompt — no wire
   record survives (0 of 24,862).
5. **A live reproduction of the engine's `cached_tokens` behaviour in the
   same run is NOT claimed.** The ACT used the preserved corpus, as Section
   10 explicitly permits, and did not issue new provider requests.
6. **The claim that this mechanism alone accounts for EVERY observed plateau
   is NOT made.** The ACT establishes that it is present, that it is
   sufficient in principle, and that it is not the only mechanism that can
   produce a deep-reuse → no-reuse transition.

---

## 4. Is a ClineMM repair necessary?

### **NO repair is proposed by this ACT, and no repair is applied.**

The ACT's Section 11 says: *"Do not automatically fix a leading hypothesis.
If a repair is justified, record the exact falsifiable causal claim and
propose a separate bounded repair ACT with a genuine RED witness."*

The finding here is a **DELIBERATE, DOCUMENTED TRADE-OFF**, not a defect:

> *"Freshness takes precedence over prefix-cache preservation. When a later
> read observes different content at the same locator, the earlier content is
> superseded: it is neither projected into a reference nor shielded from the
> stale-read rewrite policy, so the newest observation stays the single
> visible source of truth."*
> — `message-builder.ts:388-392`

and

> *"Batch stale-read rewrites to avoid breaking provider prefix caches on
> every re-read."*
> — `message-builder.ts:39`

The existing design ALREADY trades prefix-cache preservation for content
freshness, and it ALREADY batches the rewrites behind a 64 KB threshold
specifically to limit the damage. The observation here is that the batching
is not sufficient to prevent the damage: the rewrite, once committed, is
permanent for the life of the transcript, so the shallow plateau is sticky.

**A repair would require choosing WHICH of the two documented priorities to
give up.** That is a policy decision about the product's content semantics,
not a defect fix, and it is out of scope for an evidence ACT.

### 4.1 The falsifiable causal claim a future repair ACT would have to carry

Recorded here so a successor ACT does not have to re-derive it, and so it can
be refuted if it is false:

> **CLAIM (to be falsified):** *If the stale-read rewrite policy did not
> rewrite a superseded `read`/`read_files` tool result IN PLACE — or if it
> rewrote it only in a way that preserves the bytes before the rewritten
> block — then consecutive post-compaction requests would share a common
> model-facing prefix extending past the rewritten message, and the provider
> would reuse a prefix deeper than the shallow plateau.*

> **RED witness a successor ACT would need:** a real capture pair in which
> the runtime projection's common prefix extends beyond the message that the
> stale-read policy rewrote, with the provider's reported reuse depth
> increasing correspondingly. The current suite CANNOT supply this: it has
> no wire record, and no tokenizer, so the reuse depth is unobservable from
> the client side.

> **What would falsify it:** a qualified run showing that the common prefix
> DID extend past the rewritten message and the reuse depth did NOT improve
> — which would point the cause back at the engine's checkpoint selection.

---

## 5. The removal contract

The temporary forensic instrumentation is explicitly removable:

| Trigger | Status |
|---|---|
| 1. Root cause isolated | **MET** — `PREFIX_MUTATION_ISOLATED` |
| 2. Capture deemed insufficient | not met (the capture was sufficient) |
| 3. Successor evidence supersedes it | not met |

**Removal procedure.** The instrumentation is additive and self-contained:

1. Delete `sdk/packages/shared/src/runtime/prefix-forensics.ts`,
   `prefix-forensics-analyzer.ts`, `prefix-forensics-analyzer-cli.ts`,
   `prefix-forensics-analyzer.test.ts`.
2. Delete `sdk/packages/llms/src/providers/prefix-forensics-capture.ts` and
   `prefix-forensics-capture.test.ts`.
3. Remove the `prefix-forensics` export block from
   `sdk/packages/shared/src/index.ts` and `sdk/packages/llms/src/index.ts`.
4. Remove the three call sites: `agent-runtime.ts` (stage A), `ai-sdk.ts`
   (stage B), `provider-request-capture.ts` (stage C).
5. Revert the `optimizeDeps`/`ssr` zod block in
   `sdk/packages/llms/vitest.config.ts` **only if** no other llms suite needs
   it (the block is a documented, package-wide fix for the shared barrel and
   is harmless to keep).

**The removal is behaviour-preserving by construction:** the instrumentation
is DEFAULT OFF, allocates nothing on the disabled path, and its only
production effect when armed is to write sanitized diagnostic records.

**Recommended next step:** a successor ACT that (a) arms the capture for a
real dogfood session, (b) captures the WIRE stage, and (c) joins the
ClineMM records to the engine's cache diagnostics by a shared request
identity — which would let the reuse depth be correlated with the common
prefix and would decide the repair question above.
