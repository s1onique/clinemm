# 10 — Exit report

```text
ACT: ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01

ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
FINAL_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
BRANCH: main
WORKTREE: clean of tracked modifications; only the ACT's own untracked paths
  ?? .factory/evidence/ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01/
  ?? sdk/packages/core/scripts/source-visibility-discriminator.generate.ts
  ?? sdk/packages/core/src/extensions/context/source-visibility-discriminator/
TRACKED_DIRT: none
PROTECTED_STASHES: none existed at entry; none popped; none mutated
PREDECESSOR_ARTIFACT_STATUS: COMMITTED (predecessor ACT is HEAD~0: 0f111f3d7);
  all 13 predecessor source hashes re-verified and MATCHING
PRODUCTION_DELTA: NONE (git diff --stat HEAD is empty; every ACT path is a NEW untracked file)

SESSION_ID: 1795466566666_uzla2
CAPTURE_RUN: cap_run_Nw2dRTjG

BOUNDARY_1:
  canonical_source_count: 47
  source_prefix_hash: sha256:54936f46c7034de73268c085d551d227e1bbced8225e41757d42a22b90a3dbf9
  artifacts_verified: pre.json, post.json, first-compaction.json — all MATCH

BOUNDARY_2:
  canonical_source_count: 101
  source_prefix_hash: sha256:df3d0a481febff3f3c8d5581e930faed80112c9bef8c7e4b609da7136d4c5409
  artifacts_verified: second-pre.json, second-post.json, second-compaction.json — all MATCH

SOURCE_MAP:
  pre_compaction_generation_seam: compaction.ts:1813 / agentic-compaction.ts:74,
    owned by createCompactionStateAwarePrepareTurn
  serializer_owner: renderStructuredToolPayload() — compaction-shared.ts:258 (UNCHANGED)
  provider_request_owner: MessageBuilder.buildForApi() — message-builder.ts:219
  thinking_origin_classification: content-origin.ts classifyBlockOrigin();
    ASSISTANT_THINKING and UNKNOWN_ORIGIN are never forwarded

RED:
  reproduced: YES
  exact_witnesses:
    R4  the tool-observed startup command pair — canonical PRESENT,
        ordinary summarizer view MISSING, working-agent view PRESENT,
        provider-visible before compaction PRESENT, after compaction MISSING
    R2  the inspected implementation content — canonical PRESENT,
        ordinary summarizer view MISSING, working-agent view PRESENT
    R6  the empty-match-set result body — canonical PRESENT,
        ordinary summarizer view MISSING, working-agent view PRESENT
  earliest_loss_boundary:
    R4 -> L2 (renderStructuredToolPayload), both boundaries
    R2 -> L2 (renderStructuredToolPayload), both boundaries
    R6 -> L2 for the evidence; L1 (thinking drop) for the exact wording

INPUT_A:
  exact_source_visibility: NONE (R4, R2 and R6 are all absent)
  trust_classification: REAL_PRODUCTION_SEAM — the existing, unchanged contract

INPUT_B:
  exact_source_visibility: FULL (R4, R2 and R6 all present)
  checkpoint_generation_executed: YES — 2 calls (1 per boundary), the ACT maximum
  provider_identity: openai-compatible / MiniMax-M3 / https://api.minimax.io/v1
  trust_classification: SYNTHETIC_REAL — constructed and origin-filtered; every
    model over-claim mechanically downgraded

INPUT_C:
  exact_source_visibility: FULL (same three witnesses)
  checkpoint_generation_executed: NO — B was sufficient, so C was not needed
  trust_classification: SYNTHETIC — the narrower fallback

R2:
  exact_source_observation_visible: YES
  checkpoint_publication: YES — an observation naming the carriers, the 3 s/10 s
    timeouts and the circuit-breaker contrast
  incomplete_status_preserved: YES — the qualification states the effective
    production sender and the runtime toggle were not reconciled

R4:
  build_visible: YES
  optimized_start_visible: YES
  checkpoint_publication: YES — an observation naming both operations
  drift_claim_unproven: YES — drift is qualified and the record is unresolved

R6:
  non_thinking_evidence_available: YES — the empty-match-set tool-result body
  bounded_negative_published: YES — a fresh, bounded, qualified conclusion
  private_reasoning_forwarded: NO

PROVENANCE:
  canonical_refs_resolved: YES
  semantic_support_verified: NO — never; the resolver is content-blind by design
  unrelated_reference_negative: PASS — identity RESOLVED, support NOT VERIFIED
  assurance_promotions: 0 — 6 model over-claims, all downgraded

SELECTION:
  first_12_result: 12 records, 960 tokens, 64 distinct canonical references,
    3 zero-novelty records; R4 and R6 DISCARDED
  relevance_selection_result: 12 records, 960 tokens, 90 distinct canonical
    references, 2 zero-novelty records; R4 and R6 RETAINED
  ablation: byte-identical to the control
  tokens: 960 (both arms), inside the 1 500 ceiling

MODEL_COST:
  calls: 2 (the maximum)
  latency_ms: 178853 (boundary 1), 73827 (boundary 2)
  input_tokens: ~68 482 estimated (boundary 1), ~99 777 estimated (boundary 2)
  output_tokens: 76 714 characters (boundary 1), 70 190 characters (boundary 2)

SECURITY_NEGATIVE_CONTROLS: 10/10 PASS

CONSERVATION: PASS — canonical messages, the original user task, the
  tool-call/result pairing, the task contract, the verified-outcome
  carry-forward, the adjudication carry-forward and the stable-prefix
  behaviour are all unchanged; no sidecar schema change, no new provider
  tool, no new execution command, no global memory store, no leaked raw
  thinking, no default-on instrumentation, no live installed-extension mutation

FOCUSED_TESTS: 47 passed / 7 files
CONTEXT_SUITE: 769 passed, 2 skipped, 0 failed / 47 files passed, 1 skipped
TYPECHECK: 0 ACT-owned diagnostics (44 baseline, unchanged)
BIOME: exit 0, 14 files checked
ACT_OWNED_DIAGNOSTICS: 0
ARTIFACT_HASHES: see artifact-hashes.json. All six frozen private artifacts
  match; both canonical prefix hashes reproduced exactly by the production v2
  algorithm; the raw session transcript, provider payloads, private reasoning
  and generated checkpoint free text remain OPERATOR-LOCAL and were NEVER
  committed.

BEHAVIORAL_CONVERGENCE: NOT_EXECUTED

VERDICT: GO_PCK_SOURCE_VIEW_FEASIBLE
```

## What the ACT proved

**The upstream question is answered YES.** A checkpoint model CAN receive the
information that ordinary compaction loses, and can publish it as qualified,
non-reasoning working knowledge — without making arbitrary tool output
trusted.

The decisive chain:

```text
the working agent's context still holds the tool-result body
  -> the checkpoint model receives it
  -> it publishes the EXACT observation (both R4 commands, the R2
     implementation content, the R6 bounded negative)
  -> the trust gate downgrades every over-claim
  -> the section is projected through the REAL production compaction seam
  -> it reaches the provider-visible continuation
```

## What the ACT corrected in the predecessor's account

The predecessor's report contained two measurement errors that the ACT's
own measurement corrected. Both are recorded in
`02-production-source-map.md` and `03-visibility-red.md`:

1. **The bare `MtsOmni` identifier is NOT lost.** It survives the ordinary
   summarizer view through the tool CALL's command line. What is lost is
   the INSPECTED IMPLEMENTATION CONTENT. The ACT's RED discriminates on the
   latter.
2. **The historical `second-post.json` DOES contain
   `connectTimeoutMillis(3_000)`** — but only inside a provider `reasoning`
   block. A measurement that does not exclude the reasoning channel would
   wrongly report that R2 survived the boundary. It did not.

## The most important design finding

**A model given richer input publishes richer claims, and the over-claim
rate goes UP, not down.**

The model claimed `runtime_verified` on 6 records. A naive design that
trusted the model's assurance label would have projected six
runtime-verification claims that no runtime had established. The authority
bounding is therefore not a defensive afterthought — it is what makes the
richer input SAFE to use at all.

## The cost, stated plainly

Boundary 1 took **178 853 ms** — roughly 2.7× the predecessor's 66 496 ms —
because the working-agent view is ≈ 274 K characters against the
predecessor's lossy view. Boundary 2 took 73 827 ms, in line with the
predecessor's 80 654 ms.

**This is material.** A future implementation must either accept it,
generate the checkpoint conditionally, or use a smaller model. The ACT does
not claim the cost is worth it on its own; it reports the semantic gain and
the cost independently, as G6.3 requires.

## NEXT_ACTION

```text
Propose a SEPARATE, BOUNDED production implementation ACT.
```

No automatic deployment authorization. The implementation ACT should, at
minimum:

1. Request the checkpoint at the production seam
   (`compaction.ts:1813`), using the working-agent context view.
2. Carry the AUTHORITY BOUNDING unconditionally — never project a
   model-claimed `runtime_verified`.
3. Carry the MODEL-AUTHORED banner unconditionally.
4. Carry the generic NOVELTY-based selection, not the positional first-N.
5. Decide the latency policy (always / conditionally / smaller model) and
   state the cost.
6. Decide whether the checkpoint is generated before EVERY compaction or
   only when the lossy view would drop evidence.

## REOPEN_CONDITION

Reopen this ACT if ANY of the following becomes true:

- the production summarizer's information-reduction contract is widened, so
  the ordinary view stops dropping the tool-result bodies (the source-
  visibility gap would then close by itself);
- the trust gate is weakened or removed, so the `runtime_verified`
  over-claims can reach a provider request;
- a future provider exposes the tool-result bodies to the summarizer
  without the `[result omitted]` substitution, which would invalidate the
  RED;
- the working-agent context view is found to forward private reasoning in
  some shape the origin classifier does not recognise.

## The exit criteria, evaluated

| ACT exit criterion | Met? | Reason |
|---|---|---|
| `GO_PCK_SOURCE_VIEW_FEASIBLE` | **YES** | every clause is satisfied: the RED is reproduced, candidate B carries the genuine R4 and R2 observations, the checkpoint publishes them accurately, R6 is published as a bounded observation from non-private evidence, no private reasoning is forwarded, no tool-output instruction is promoted to authority, no unrelated canonical reference certifies an assertion, the projection and the ablation pass, the generic selection stays within budget, all conservation tests pass, and the costs are measured |
| `PARTIAL_SOURCE_VISIBILITY` | NO | every evidence class succeeded; none remained inaccessible under the approved boundary |
| `HALT_TRUST_BOUNDARY_UNRESOLVED` | NO | the boundary is established: identity resolution is separated from semantic support, the model-authored nature is explicit, and the 6 real over-claims were all mechanically bounded |
| `HALT_EVIDENCE_SUPPORT_UNBOUND` | NO | the resolver never inspects content, so it is structurally incapable of asserting support; the adversarial unrelated-reference case is asserted |
| `HALT_RED_NOT_REPRODUCED` | NO | the RED reproduced on exact, hash-verified evidence against the checked-out production seam |
| `INPUT_BUDGET_INSUFFICIENT` | NO | 68 K / 100 K estimated tokens against a 256 000-token window |
| `NOT_A_USEFUL_CHECKPOINT` | NO | the model published 20 and 16 substantive records with correct qualifications; it published the three witnesses the predecessor could not |
| `CAPTURE_INSUFFICIENT` | NO | both canonical prefixes were reconstructed EXACTLY by the production algorithm |
