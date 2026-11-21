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
NEW_TEST_FILES: 1 (21 tests)
CORRECTION01: ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01-CORRECTION01
  review verdict: PASS_WITH_BOUNDED_P1_CORRECTION
  P1-A retained-tail counterexample: CONFIRMED, contract corrected
  P1-B display-only boundary divergence: CONFIRMED, production defect fixed
  P2-A budget rationale: CONFIRMED mathematically false, withdrawn and replaced
  P2-B final artifact identity: CONFIRMED, head identities made explicit
EVIDENCE: .factory/evidence/ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01/
  identity.json
  source-map.md
  tail-sufficiency-matrix.json
  red-green-receipt.txt
  correction01-receipt.txt
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

### CORRECTION01 — the bounded review correction

The review returned `PASS_WITH_BOUNDED_P1_CORRECTION`. All three findings were
**CONFIRMED** and corrected in one focused cycle; the original RED witness is
preserved UNMODIFIED.

**P1-A — the retained-tail counterexample.** CONFIRMED. A re-compaction's
sidecar is `[summary, ...messages.slice(cutIndex)]` over the compactor's
input, so it legitimately retains canonical messages from before its own
boundary, and the suffix measurement reports an EARLIER boundary (3 vs 5).
The production path never used the inference, so the central invariant was
never at risk; but the source's claim that the inference is "EXACT for every
real production shape" was **unsupported and is withdrawn**. The contract is
now stated honestly: the inference UNDER-estimates the boundary, and that
direction is **conservative** — the section can only be a subset of the
boundary's outcomes, so it costs compactness, never correctness.

**P1-B — the display-only boundary divergence.** CONFIRMED, and this one DID
reach production. The Phase-A sites passed `context.messages.length` (the RAW
length) while the persisted sidecar records the CANONICAL count, so with a
display-only message present the persisted section and the persisted boundary
described DIFFERENT boundaries. Fixed by exporting
`countCanonicalSourceMessages()` from `session/models/session-compaction.ts`
— the SAME filter `createSessionCompactionState()` applies — and using it at
both Phase-A sites, so the two cannot diverge by construction.

**P2-A — the budget argument.** CONFIRMED mathematically false and
**WITHDRAWN**. The ledger retains the most RECENT 12 outcomes, so a
boundary-scoped ledger can retain older — and, when they render longer,
LARGER — entries: measured 632 bytes (whole) vs 656 bytes (scoped). The
rationale is replaced with the ACTUAL authority: the FINAL budget guard at
the provider-dispatch seam (`agent-runtime.ts`,
`assertProviderRequestWithinBudget()`), which measures the provider-visible
projection of the FINAL messages after every `beforeModel` mutation and
FAILS CLOSED with `TaskContractBudgetError` before any provider dispatch.
The repair does not change that guard. Six documentation occurrences of the
false claim were corrected.

**P2-B — the final artifact identity.** CONFIRMED and corrected. The head
identities are now explicit: `entryHead`, `subjectHead` (the implementation
commit), `artifactHead` (the commit that produced the original artifact
package) and `finalHead`.

**Production behaviour changed by CORRECTION01:** only the Phase-A boundary
value, and only when a display-only message is present in the canonical
history.

**CORRECTION01 gates:** the original RED witness still passes; focused
suites 175 passed / 1 skipped (+3 controls); the full package suite's
failing test-file set is IDENTICAL to the pristine baseline (139 failures
in both, 28 files each, sets diff to empty); typecheck 44 before and after,
0 contributed; Biome clean.

**CORRECTION01 head chain:**

```text
entryHead          9117f13ae7d643373c56eeedc30da661fc790b08  the predecessor's final HEAD; the ACT's entry
subjectHead        9f57bc84d98f3439a0d70e4bf74300efef6564cd  the IMPLEMENTATION commit (the production repair)
artifactHead       155eb4b400d1bed95cdca03c8ea22db9e690beba  the commit that produced the original artifact package
reviewHandoffHead  b5558f973fa11b1576d0746c4c98e92e7f398b4c  the evidence package as the REVIEW saw it
correctionHead     a9bf4fc8be637a17d11b9fbb0338e4774cd98b56  the CORRECTION01 commit (the boundary-contract production fix)
finalHead          a9bf4fc8be637a17d11b9fbb0338e4774cd98b56  the ACT's terminal PRODUCTION commit (the CORRECTION01 fix)
```

`finalHead` names the terminal commit that carries the ACT's PRODUCTION
behaviour. The documentation commits that carry the artifact package and the
regenerated hash manifest follow it; each is documentation-only and changes
no production module and no test.

The working tree after the terminal commit is CLEAN. Every SHA is recorded
after its commit, never predicted.

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
