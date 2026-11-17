# ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — capture identity + retention correction

**Review disposition addressed:** `HALT_CAPTURE_IDENTITY_COLLISION_REPRODUCED`
**Scope:** the capture-store identity and retention contract ONLY. No estimator, Strata,
compaction-policy, estimator-repair or Full-Round-C change.

---

## 1. The P0s, confirmed against the REPOSITORY checkout

The reviewer reproduced both counterexamples from a source-extracted replay of the
staged diff. This correction reproduced both **against the production
`CompactionCandidateCaptureStore` in the repository**, not a re-implementation.

### P0-A — the 12-candidate cap could retain 13 files

`record()` capped `compactionCandidates` at 12 **independently** of
`controlCandidate`, and `retainedCandidates()` / `flush()` returned both
collections. 12 compaction candidates plus one control produced **13 files**
against a declared maximum of 12.

### P0-B — identical content overwrote a different decision's snapshot

The file name was derived from the content fingerprint alone:

```
const fileName = `${finalReceipt.contentFingerprint}.json`;
```

The fingerprint covers only `{systemPrompt, apiMessages, tools, options}`, so two
distinct eligibility decisions with identical content resolved to the SAME file
and the second write silently replaced the first decision's snapshot.

### P0-C — overlapping flushes were not serialized

`flush()` had no serialization, so two overlapping calls could interleave a
`writeFile()` to the same file. Node explicitly warns against this.

---

## 2. RED — the counterexamples, reproduced against the production store

`sdk/packages/core/src/runtime/observability/compaction-candidate-capture.identity-retention.test.ts`

The witnesses drive the REAL store and assert against the ACTUAL on-disk
contents of a temporary directory.

| Witness | Expected | Actual (pre-correction) | Reviewer's replay |
| --- | --- | --- | --- |
| `I1` distinct decisions, identical content | 2 files | **1 file** | "Files actually preserved: **1**" |
| `I2` control + 12 compaction candidates | ≤ 12 files | **13 files** | "Retained and written: **13**" |
| `I2` 12 → 13 → 14 transitions | ≤ 12 at every step | **13** | "Declared maximum: **12**" |

Both P0 counterexamples reproduced exactly, against the repository checkout.

---

## 3. The repair

### 3.1 Per-decision storage identity

The file name is now a PER-DECISION identity:

```
<storage identity>--<content fingerprint>.json
```

- The storage identity is the candidate's `decisionId`, else its
  `preparationRequestId`. A candidate carrying NEITHER receives a monotonic
  ordinal, so it still gets its own file rather than being silently dropped.
- The identity is resolved in `record()`, so a candidate's file name is STABLE
  for its whole lifetime across every subsequent flush.
- The identity is sanitized to a filesystem-safe token and shortened; a short
  hash of the FULL identity is appended so two identities that sanitize to the
  same token still differ.

The content fingerprint is retained in the name: it still describes exactly what
was measured.

### 3.2 The hard cap is a TOTAL

`enforceRetentionCap()` counts the control AND the compaction candidates
together against `COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES`. The control no
longer gets a slot on top of the cap. The OLDEST compaction candidate is evicted
first; the control is evicted only when nothing older remains to drop.

### 3.3 Serialized, idempotent writes

- Overlapping `flush()` calls are chained on a per-store promise chain, so the
  second flush starts only after the first completes. The chain does not break
  on failure: a rejected flush does not poison subsequent flushes.
- A candidate whose serialized bytes are unchanged is NOT rewritten, so a
  previously persisted snapshot is not needlessly re-exposed and the directory
  is not churned on every flush.

---

## 4. GREEN + non-vacuity (ablations)

Every production change was ablated to prove its witness is load-bearing.

| Ablation | Witness that fails | Proves |
| --- | --- | --- |
| file name reverted to the content fingerprint alone | `I1` | the identity fix is load-bearing |
| total cap reverted to the per-collection cap | `I2` (×2) | the cap fix is load-bearing |
| flush serialization removed | `I4` | the serialization fix is load-bearing |
| idempotent-rewrite skip removed | `I4b` | the no-rewrite fix is load-bearing |

**Green:** `56 tests / 8 files` PASS across the whole capture + observability
surface, including the 14 pre-existing capture witnesses and the 6 new
identity/retention witnesses. Zero regressions.

---

## 5. Conservation

| Gate | Result |
| --- | --- |
| core typecheck | **ZERO delta** — 43 errors before AND after; the before/after error sets are IDENTICAL (empty diff). All 43 are pre-existing baseline errors in non-ACT-owned files. |
| core full suite | 17 failing files, IDENTICAL and STABLE across two runs; **none** is ACT-owned. Those 17 files in isolation give **111 failures before AND after** this change. |
| agents suite | **603 / 603 PASS** (matches the recorded baseline) |
| shared suite | **573 / 573 PASS** (matches the recorded baseline) |
| `bun run build:sdk` | **PASS** — all SDK packages build, `@cline/core` including the runtime build-id verification |
| biome | **0 errors** in both touched files (2 `info`-level non-null-assertion notices, matching the 17 pre-existing infos in the sibling test file) |
| production files touched | `sdk/packages/core/src/runtime/observability/compaction-candidate-capture.ts` ONLY |

The capture file name is purely INTERNAL to the store: no downstream consumer
in `sdk/`, `apps/` or `.factory/` depends on the naming scheme, so the change
is fully contained.

**Not touched:** the estimator, Strata, the compaction policy, the Leamas
gate summary (P2, NON-BLOCKING), Full Round C, and the rest of Factory.

---

## 6. Remaining

- **C1: GO for commit** — the two new P0 counterexamples are GREEN and every
  witness is proven non-vacuous.
- The operator's manual **exact-head VSIX build** and the **targeted dogfood
  capture** remain outstanding. No live snapshot is claimed.
- Full Round C and estimator repair remain deferred until actual candidate-token
  evidence exists.
