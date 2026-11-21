# CORRECTION03 — the prefix-forensics evidence-authority contract

This document states the invariants that the CORRECTION03 patch establishes and
that the `AUTH-01`…`AUTH-07` and `CLI-01`…`CLI-08` witnesses enforce.

---

## 1. The identities the runtime actually mints

The authority of a comparison rests entirely on the runtime's own identity
semantics (`sdk/packages/agents/src/agent-runtime.ts`):

| Identity | Minted | Lifetime |
|---|---|---|
| `preparationRequestId` (`req_…`) | once per PREPARED REQUEST | **UNCHANGED across provider retries** |
| `providerAttemptId` / `modelRequestId` | per PROVIDER ATTEMPT | **RE-MINTED on every retry** |
| `iteration` | per MODEL TURN | advances once per turn |
| `sessionId` | per SESSION | constant for the conversation |
| `cohortId` | the KEYED-FINGERPRINT scope | constant for the comparison |

`cohortId` is not an optional decoration: two records with different cohorts are
**not comparable at all**, because their keyed fingerprints are computed under
different keys.

---

## 2. The invariants

### I1 — every required identity is MANDATORY on BOTH sides

A pair is a consecutive turn only when **both** records carry a **non-empty**

- `cohortId`
- `sessionId`
- `iteration`
- `preparationRequestId`
- `providerAttemptId`

A missing identity is `NOT_AUTHORITATIVE` with a reason **naming** the missing
identity. **A timestamp is never substituted.**

> **This is the invariant CORRECTION02 violated.** It compared the preparation
> and attempt identities only when *both* were present, so a record missing
> either identity skipped the check and reached
> `return { consecutive: true, relation: "consecutive_turn" }`.

### I2 — the comparator applies the lineage gate ITSELF

`comparePrefixForensicsBundles()` is a **public** API. It must not be able to
return `authoritative: true` for a pair it has not itself proven consecutive.
Callers may not be required to remember a second check.

### I3 — same session is NOT sufficient

Chronological adjacency within a session is not evidence of consecutive turns.
The gate requires **proven adjacent iterations**.

### I4 — a retry is never a turn

Same preparation identity + different attempt identity + same iteration is a
**retry**, and is refused.

### I5 — distinct preparations are REQUIRED for consecutive turns

Two successive model turns carry **different** preparation identities. A shared
preparation identity means a retry, not a turn. (This is the CORRECTION01
inversion, retained in its corrected form.)

### I6 — conflicting same-stage observations are EXCLUDED, not resolved

Two records for the same request identity and the same stage that **disagree**
cannot be resolved from the capture. Choosing one by file order would assert a
boundary the evidence does not establish. The stage is therefore **removed** from
the bundle and reported `UNAVAILABLE_FROM_TRACE`, so the comparison **fails
closed**.

Two records that **agree** on every discriminating field are a harmless
duplicate and are **collapsed**.

### I7 — the difference report names EVERY change category

The analyzer distinguishes four change categories: `messages`, `tools`, `system`,
`body`. The CLI report must carry all of them, and the first differing stage
must be the analyzer's `earliestDifferingStage` — not a message-only search.

### I8 — negative controls must be NON-VACUOUS

A negative control that iterates over a result collection and asserts inside the
loop passes vacuously when the collection is empty. Every negative control must
assert the **exact expected count**.

---

## 3. What is explicitly NOT claimed

- The synthetic CLI fixtures carry a real `recordSha256` computed from the
  record's own content, but the fixtures are **synthetic**: they establish the
  **lineage** contract, **not** capture-record hash verification against a live
  capture pipeline.
- `PREFIX_MUTATION_ISOLATED` stays **closed** (a ClineMM rewrite of a
  historical tool result is real and observed).
- `STRATA_PLATEAU_CAUSE_UNPROVEN` stays **OPEN**. The MiniMax capture corpus
  and the queried Strata endpoint are **not established to be the same serving
  path**, and no joined engine/capture evidence exists.
- The stale-read **policy** is not changed by this correction.
