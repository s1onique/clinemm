# ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01

```text
ACT_ID: ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01
TYPE: bounded production repair
VERDICT: PASS_STABLE_PREFIX_REPAIR
ENTRY_HEAD: 9117f13ae7d643373c56eeedc30da661fc790b08   (== EXPECTED ENTRY_HEAD)
BRANCH: main (no ACT branch created)
PRODUCTION_CODE_CHANGES: 2 files
EXISTING_TEST_MODIFICATIONS: 1 file (3 assertions INVERTED; 0 skips, 0 deletions,
                             0 weakenings; the file still has 20 tests)
NEW_TEST_FILES: 1 (18 tests)
EVIDENCE: .factory/evidence/ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01/
  identity.json
  source-map.md
  tail-sufficiency-matrix.json
  red-green-receipt.txt
  repair-contract.md
  conservation-results.md
  provider-prefix-comparison.json
  test-receipts.txt
  qualification-report.md
  artifact-hashes.json
  tool/tail-sufficiency.ts
  tool/prefix-comparison.ts
```

---

## 1. Mission outcome

The ACT's target was the repeated post-compaction prompt-prefix invalidation
caused by verified-evidence restoration. **It is repaired.**

| Field | Value |
|---|---|
| `RED_REPRODUCED` | **YES** — at ENTRY_HEAD, the predecessor's unmodified witness, EXIT 1 |
| `STABLE_PREFIX_GREEN` | **YES** — the same witness, the same assertion, EXIT 0 |
| `CANONICAL_EVIDENCE_CONSERVED` | **YES** |
| `TASK_CONTRACT_CONSERVED` | **YES** |
| `SIDECAR_RESUME_CONSERVED` | **YES** |
| `RECOMPACTION_CONSERVED` | **YES** |
| `BUDGET_SAFETY` | **YES** |
| `PROVIDER_SEMANTIC_DELTA` | no message and no field added; the redundant re-derivation of the post-boundary verified outcomes is removed from the early summary, and the model still receives every verified outcome through the canonical tail |
| `SOURCE_HEAD` | `9117f13ae7d643373c56eeedc30da661fc790b08` |
| `FINAL_HEAD` | recorded in `identity.json` after the evidence commit |
| `LIVE_STRATA_CACHE_EFFECT` | `NOT_EXECUTED` |

---

## 2. The repair in one paragraph

`applyVerifiedEvidenceToCompactedMessages()` re-derived the verified-outcome
section from the ENTIRE growing canonical history on every provider-visible
restoration and replaced the section in place. The compaction summary is the
FIRST provider-visible message of every request, so every later verified
outcome rewrote the head of the request and invalidated every deeper
prompt-cache checkpoint.

The carried section is now derived from the canonical history **AS IT WAS AT
THE SOURCE BOUNDARY**. The boundary does not move when the transcript grows,
so the summary is byte-identical across every continuation.

Two phases, explicitly:

- **Phase A — a NEW compaction.** A freshly produced summary is a lossy
  projection and must carry the verified outcomes that existed at ITS OWN
  boundary. The pipeline passes `context.messages.length`.
- **Phase B — a SUBSEQUENT CONTINUATION.** The persisted summary is a
  historical snapshot and is not rebuilt. The pipeline passes the persisted
  sidecar's `source_message_count`, which is authoritative.

**What is preserved.** Every outcome verified AT the boundary stays carried —
including the ones that have fallen out of the visible tail, which is exactly
the set the tail cannot represent. Every outcome verified AFTER the boundary
remains model-visible through the provider-visible canonical tail, whose
`tool_result` block carries the canonical tool-call identity (`tool_use_id`),
the tool name and the affirmative success payload that
`classifyToolResultStatus()` reads. A historical sidecar written before the
section existed is still enriched — once, and the enrichment is itself
boundary-scoped, so it does not re-introduce the churn.

**The repair is not evidence suppression.** The new suite's negative control
removes the post-boundary verified evidence from the model-visible request and
asserts that the evidence-continuity assertion FAILS. A repair that achieved
prefix stability by suppressing evidence would make that control pass.

---

## 3. The discriminator came first (§3)

The canonical-tail sufficiency discriminator was run against the REAL
production seams BEFORE any production code changed, for all twelve required
scenarios (A–L).

**Verdict: tail-only conservation is sufficient for every required class.**
12/12 scenarios report `postBoundarySufficient: true`.

The one case that needed care was **scenario B** (tool call before the
boundary, result after it). The tool_use block is not in the tail, but the
RESULT block carries the call identity in `tool_use_id`, so the tail is
sufficient. The discriminator's first pass demanded the block and reported B
as insufficient; it was corrected to demand the call IDENTITY — which is what
the verified-success authority is bound to.

Consequently **Design alternative 1 (tail-only conservation) was selected**
and **Design alternative 2 (a bounded later evidence representation) was NOT
built**: there is no second representation of the post-boundary evidence, so
nothing is duplicated and nothing can contradict.

---

## 4. What changed

| File | Change |
|---|---|
| `sdk/packages/core/src/extensions/context/evidence-continuity.ts` | `applyVerifiedEvidenceToCompactedMessages()` gained an optional `sourceMessageCount` and now derives the ledger from `canonicalMessages.slice(0, boundaryCount)`. Added `inferCompactionSourceBoundary()` (the fallback for a direct helper call) and the module-private `sameMessage()`. |
| `sdk/packages/core/src/extensions/context/compaction.ts` | The three evidence call sites now pass an EXPLICIT boundary: `context.messages.length` for the two Phase-A sites, `existingState.source_message_count` for the Phase-B restoration site. |
| `sdk/packages/core/src/extensions/context/compaction.stable-prefix-repair01.test.ts` | **NEW.** 18 production-seam tests. |
| `sdk/packages/core/src/extensions/context/compaction.summary-churn01.test.ts` | Three assertions INVERTED to pin the repaired behaviour. The predecessor's suite pinned the DEFECT and explicitly deferred the repair to a later ACT. |

**Nothing else was touched.** `task-contract.ts`, `session-compaction.ts`,
`message-builder.ts` and `src/shared/llms/request-budget.ts` are unchanged.

No new public API or wire-protocol field, no new persistence system, no
second canonical evidence store, no general-purpose prompt-cache manager, no
Strata checkpoint-policy change, no feature flag, no change to the
persistence format.

---

## 5. The gates

| Gate | Required evidence | Result |
|---|---|---|
| G0 | Correct repository, ancestry, clean/exempt entry state | **PASS** — `main` at the expected predecessor final HEAD; remote `git@github.com:s1onique/clinemm.git`; all five `protected-stash-*` branches and the `recovery/protected-stash-20261117` worktree are byte-identical to the entry state; no `refs/stash` ever existed; no new worktree; no unexpected tracked dirt |
| G1 | Actual canonical-tail sufficiency inventory | **PASS** — `tail-sufficiency-matrix.json`, 12/12 sufficient |
| G2 | Existing RED reproduced unmodified | **PASS** — EXIT 1, the exact one-line evidence diff |
| G3 | Minimal production repair applied | **PASS** — 2 production files, 1 behavioural change |
| G4 | Original RED → GREEN | **PASS** — same witness, same assertion, EXIT 0 |
| G5 | Verified evidence remains model-visible | **PASS** — positive assertion + negative control + positive control |
| G6 | Stable summary across multiple continuations | **PASS** — four successive continuations |
| G7 | Cross-boundary and rolling-ledger conservation | **PASS** — scenarios B, F, J, K |
| G8 | Task-contract and budget conservation | **PASS** — the unchanged contract and budget suites pass; a genuine contract change still updates the summary |
| G9 | Sidecar, resume and re-compaction conservation | **PASS** |
| G10 | Stale-read behaviour conserved | **PASS** — `message-builder.ts` unchanged |
| G11 | Focused existing tests, typechecks and lint | **PASS** — 172 passed / 1 skipped focused; the full package suite's failure set is byte-identical to the pristine baseline (0 contributed); 44 typecheck diagnostics before and after (0 contributed); Biome clean |
| G12 | Exact-head artifacts and privacy verification | **PASS** — see `identity.json` |

---

## 6. The quantitative qualification

| Metric | Baseline | Repaired |
|---|---|---|
| Step-B summary fingerprint | `f7930102aa7ab8e7` — changes | `9b138b60ddcdff17` — stable |
| Step-B summary byte length | 413 | 366 — stable |
| Step-B provider-visible common prefix (code units) | **419** | **1001** |
| Step-C provider-visible common prefix (code units) | **465** | **1292** |
| Current verified outcomes visible | Yes | **Yes** |
| Task contract visible | Yes | **Yes** |
| Additional provider requests | 0 | **0** |
| Effective budget respected | Yes | **Yes** |

The measure is the structural common prefix in UTF-16 code units over the
serialized provider-visible message list. It is NOT a tokenizer token offset
and NOT a byte count.

```text
PREFIX_STABILITY:               measured
EVIDENCE_CONSERVATION:          measured
TOKEN_LEVEL_CACHE_COMPATIBILITY: unavailable unless directly verified
LIVE_PREFILL_IMPROVEMENT:       NOT_EXECUTED
```

An increased structural common prefix establishes that ClineMM has stopped the
targeted early mutation. It does **not** establish that Strata retained a
checkpoint at that boundary. No seconds are reported as measured performance.

---

## 7. Scope discipline

**Authorized and done:** source reconnaissance, the existing RED reproduction,
the minimal production repair, focused regression tests, the offline
request-projection comparison, sanitized evidence generation, the epic-board
update and the local commit.

**Not done (not authorized):** no VSIX installation, no further Round C
benchmark, no additional live inference workload, no Strata/PolyStrata change,
no engine restart, no prompt-cache tuning, no quantization change, no new
tracing subsystem, no provider API or wire-protocol change, no git push, no
PR, no history rewrite.

The existing prefix-forensics instrumentation was consumed, not expanded.

---

## 8. Successor

`ACT-CLINEMM-COMPACTION-STABLE-PREFIX-LIVE-QUALIFICATION-01`.

A green source-level repair is **not** a demonstrated live performance
improvement. The live performance qualification is NOT part of this ACT.
