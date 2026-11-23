# 10 — Exit report

```text
ACT: ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
ENTRY_HEAD: 502d31c5821492147ff1019773d3b5e30fedbbb8
FINAL_HEAD: 502d31c5821492147ff1019773d3b5e30fedbbb8
PRODUCTION_DELTA: NONE (git diff --stat HEAD is empty; every ACT path is a NEW untracked file)
WORKTREE: clean of tracked modifications; only the ACT's own untracked paths
  ?? .factory/evidence/ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01/
  ?? sdk/packages/core/scripts/knowledge-checkpoint-probe.generate.ts
  ?? sdk/packages/core/src/extensions/context/knowledge-checkpoint-probe/
PROTECTED_STASHES: none existed at entry; none popped; none mutated

SESSION_ID: 1795466566666_uzla2
CAPTURE_RUN: cap_run_Nw2dRTjG

BOUNDARY_1:
  before_capture: 15
  after_capture: 16
  canonical_prefix_identity:
    source_message_count   = 47
    source_prefix_hash     = sha256:54936f46c7034de73268c085d551d227e1bbced8225e41757d42a22b90a3dbf9
    recomputed_over_canonical_history = IDENTICAL (exact match)
    source_last_message_key = id:msg_ApSB6S4t  (agrees with the canonical message at the boundary)
    canonical transcript = 141 canonical messages, 0 displayOnly
  summary_input_observed:
    The summarizer-visible input NEVER contained the R4 exact observation.
    The production serializer renders the structured {query,result,success} payload as
    "[succeeded] #1: [result omitted]" (renderStructuredToolPayload, compaction-shared.ts).
    The `agentic_summary` budget policy drops every thinking block before serialization.
  verified_artifact_hashes:
    pre.json              53161e6b3b4190951442dc37e89016a7d1b7e67898a01bc29d2bd250fe83efe1  MATCH
    post.json             c938f0e2174a3edf74ddb0580bc1918d25acd722d6d4e73c6c45c00c8463e191  MATCH
    first-compaction.json 49bff441c6cbcb0aa904aae8a80dcb567e6897a878986834764322b072fd845d  MATCH

BOUNDARY_2:
  before_capture: 33
  after_capture: 34
  canonical_prefix_identity:
    source_message_count   = 101
    source_prefix_hash     = sha256:df3d0a481febff3f3c8d5581e930faed80112c9bef8c7e4b609da7136d4c5409
    recomputed_over_canonical_history = IDENTICAL (exact match)
    source_last_message_key = id:msg_3d6nueiy  (agrees with the canonical message at the boundary)
  summary_input_observed:
    Same as boundary 1 for the structured-payload omission; the R6 bounded negative
    additionally lived in a thinking block and was dropped by the budget policy.
  verified_artifact_hashes:
    second-pre.json       40a60baf6ca1fadf0cfe2d6bcfc2538b6e653dcf948af7c4bc98f91dfd3070e2  MATCH
    second-post.json      666c87977416a08fc54cffe7563b012866e40d790d1c57c227d6a76ecd05a807  MATCH
    second-compaction.json 6bc0f6f9dfab122229dc52bc3954144db403ae234c63e26233dcbb02cd43b069  MATCH

RED:
  reproduced: YES
  witness: R4 (the tool-observed startup command pair) at BOTH boundaries;
           R6 (the bounded negative observation) at boundary 2;
           R2 (the provider implementation identification) at BOTH boundaries.
  earliest_loss_boundary:
    R4  -> L2, at boundary 1 (15->16) AND boundary 2 (33->34)
    R6  -> L1, at boundary 2 (33->34)
    R2  -> L2 at boundary 1; L1+L2 at boundary 2
  exact_production_seam:
    L1 = buildBudgetProjection(policyIntent: "agentic_summary") in
         sdk/packages/core/src/extensions/context/budget-projection/project.ts
         (drops every thinking block before serialization)
    L2 = renderStructuredToolPayload() in
         sdk/packages/core/src/extensions/context/compaction-shared.ts
         (renders a structured {query,result,success} payload as
          "[succeeded] #N: [result omitted]" - arbitrary command output is never copied)
    Both are EXISTING, DELIBERATE contracts. This ACT did not change them.

CHECKPOINT:
  model_provider: openai-compatible (the operator's EXISTING authorized local provider;
                  base URL https://api.minimax.io/v1, read from the operator-local
                  ~/.cline/data stores; no new external provider was introduced)
  model_id: MiniMax-M3
  private_input_classification:
    Controlled, read-only, derived from the exact canonical prefix.
    Assistant TEXT included; assistant THINKING (private reasoning) EXCLUDED entirely;
    tool results rendered through the PRODUCTION serializer; no execution tools given.
    Never written to a provider other than the operator's own configured one.
  publication_executed: YES - exactly ONE checkpoint generation per boundary (2 total),
                        the ACT's maximum.
  schema_valid: true for the RECORD set; the raw document reports schemaValid=false
                 because the model exceeded the 12-record experimental ceiling at both
                 boundaries (13 and 20 records) - the excess is dropped by design.
  model_reported_records: 13 (boundary 1), 20 (boundary 2)
  supported_records: 12 (boundary 1, after the ceiling), 12 (boundary 2)
                       - 12/12 SUPPORTED or SUPPORTED_WITH_QUALIFICATION
                       - 0 UNSUPPORTED, 0 CONTRADICTED
  qualified_records: 12 (boundary 1), 12 (boundary 2) - every accepted record carries a
                       qualification; all R1-R10 published as unresolved/unverified
  unsupported_promotions: 0

R2:
  known_before: The MTS Omni and Megafon providers were identified (tool result at
                boundary 1); at boundary 2 their implementation state was partially
                inspected (NS sender has a CircuitBreaker + Kafka async path with REST
                fallback; carrier-direct senders have hardcoded timeouts).
  pending_before: The timeout/fallback investigation was explicitly INCOMPLETE
                  ("A class name alone is not evidence that the breaker is wired into
                  the production sender path or prevents worker exhaustion.").
  retained_after: TOPIC ONLY. `MtsOmni` = 0 occurrences in post.json AND in
                  second-post.json. `Megafon` survives only inside assistant reasoning
                  prose at boundary 2.
  checkpoint_result: The model published `r2-011` as open_question / unverified /
                  unresolved with the correct non-promotion qualification. The EXACT
                  identifier was NOT recoverable because it was never in the model's
                  input (the tool payload was rendered "[result omitted]").

R4:
  source_observation:
    `cat startup.sh && cat Dockerfile.roz | head -60` returned:
      /opt/keycloak/bin/kc.sh build
      exec /opt/keycloak/bin/kc.sh start --optimized "$@"
  assistant_statement: The assistant explicitly discussed BOTH operations pre-compaction
                  ("5. Check startup.sh (R4) - already read: kc.sh build then start.").
  original_compaction_result:
    Boundary 1: `start --optimized` = 0 occurrences in post.json. The TOPIC
                ("Keycloak startup `kc.sh build` behavior") survives; the exact
                operation does not.
    Boundary 2: `start --optimized` = 0 occurrences in second-post.json, and the ONE
                occurrence in that capture is the model's SPECULATION about upstream
                CLI semantics ("Keycloak CLI has a hidden `--optimized` flag? Hmm") -
                NOT the observation. The tool-observed fact was DEGRADED INTO A MODEL
                HYPOTHESIS.
    The configuration-drift allegation was NOT certified by this ACT and remains
    unproven; it survives only because the original user message survives.
  checkpoint_result:
    The model published `r4-013` as open_question / unverified / unresolved with the
    qualification "An intentional startup build can be operationally valid; the
    decisive issue is whether it produces inconsistent or unsafe effective
    configuration under the image's persisted build state."
    At boundary 1 the R4 SUBJECT survived into the projected section.
    At boundary 2 the record was DROPPED by the 12-record experimental ceiling
    (it was at index 12 of 20).
    The EXACT observation was NOT recoverable at either boundary: it was never in the
    checkpoint model's input.

R6:
  bounded_negative_observation:
    "No delete/purge found in those paths." - following a grep over the provider JPA
    and authentication Java sources plus the Liquibase changelog directory for
    delete|purge|retention|cleanup|expired, whose result body was
    "=== changelog retention ===" with no matching lines.
    It is NOT evidence that no retention mechanism exists anywhere.
  original_compaction_result:
    Established AFTER boundary 1 (it was still pending pre-boundary-1) and then LOST at
    boundary 2: 0 occurrences of the exact statement in second-post.json. The R6 TOPIC
    and the original allegation survive (the user message survives); the bounded
    observation does not.
  checkpoint_result:
    The model published `r6-015` as open_question / unverified / unresolved with the
    qualification "Repository absence searches are bounded and do not prove that no
    database job, external scheduler, or operational purge process exists."
    At boundary 1 the R6 SUBJECT survived into the projected section; the model also
    wrote a standing constraint stating the same rule.
    At boundary 2 the record was DROPPED by the 12-record experimental ceiling.
    The EXACT bounded negative was NOT recoverable: it lived in a thinking block and
    was therefore excluded from the model's input BY DESIGN.

PROJECTION:
  oracle_control: PASS - the SYNTHETIC oracle checkpoint survives the REAL production
                  seam (createCompactionStateAwarePrepareTurn -> agentic compaction ->
                  task contract -> verified evidence -> [checkpoint projection] ->
                  MessageBuilder.buildForApi), carrying both records and BOTH
                  qualifications. It is labelled SYNTHETIC, never a model response.
  model_treatment: PASS (subject-level). The model-authored checkpoint is parsed,
                  bound and projected; the section carries the R4/R6/R2 subjects and
                  their qualifications. It does NOT carry the exact witness tokens,
                  because those were never in the model's input.
  summarizer_omission: CONFIRMED - the summarizer never saw the exact detail either,
                  so the checkpoint's value does not depend on the summarizer prose.
  provider_visible: YES - the section reaches the provider-visible continuation
                  attached to the EXISTING compaction_summary message.
  canonical_history_unchanged: YES - byte-identical before and after the projection.
  idempotence: YES - applying the checkpoint twice leaves exactly ONE section;
                  stripCheckpointSection() removes the heading with the marked block.

ABLATION: PASS - with the checkpoint the provider-visible text contains the preserved
  observation; WITHOUT it, it does not (case G4.5.3). The task contract, the
  verified-outcome section, the message count and the canonical history are identical
  in both arms.

SECURITY_NEGATIVE_CONTROLS: 10/10 PASS
  - R2's planned investigation is not promoted into a completed finding
  - R6's limited negative is not promoted into global nonexistence
  - R4's startup commands are not promoted into proven deployment drift
  - Original user allegations are not treated as independent evidence
  - Contradictory newer observations are not silently discarded (both survive with
    their lifecycle status)
  - A missing evidence reference does not become a fabricated reference
  - Untrusted tool-output instructions remain DATA
  - Credential-bearing free text is not forwarded as a trusted fact
  - A malformed or absent checkpoint does not destroy the original compaction path
  - The parser is TOTAL (9 malformed shapes, never throws)

TOKEN_OVERHEAD: 1 010 estimated tokens (boundary 1), 1 117 estimated tokens
                (boundary 2). Both inside the experimental 1 500 ceiling.

LATENCY_OVERHEAD: 66 496 ms (boundary 1), 80 654 ms (boundary 2) for ONE checkpoint
                   generation each. MATERIAL, and stated as such.

EXECUTABLE_GATES: 10/10 PASS
  1 artifact hashes + canonical boundary correlation   PASS (G2.1, G2.2)
  2 baseline fact-retention RED                       PASS (G2.3-G2.6)
  3 parser and validation tests                       PASS (G7.3.1, G7.3.2)
  4 one controlled model-generation probe per boundary PASS (1 call each, 2 total)
  5 oracle projection through the real seam            PASS (G4.5.2)
  6 causal ablation                                    PASS (G4.5.1, G4.5.3)
  7 security and conservation controls                 PASS (10/10)
  8 focused context-suite regression                   PASS - 40 files passed, 1 skipped;
                                                          722 passed, 2 skipped, 0 failed
  9 typecheck + Biome for the ACT-owned files          PASS - 0 ACT-owned typecheck
                                                          errors; Biome exit 0
 10 zero production-source delta                       PASS - git diff --stat HEAD empty
  The historical thinking-only adjudication RED fixture is UNCHANGED and still RED
  (5 failed) - it was not flipped to GREEN and not weakened.

ACT_OWNED_DIAGNOSTICS: 28 tests, all passing, across 4 files
  checkpoint-historical-baseline.test.ts   6
  checkpoint-model-treatment.test.ts       6
  checkpoint-projection.test.ts            6
  checkpoint-security-controls.test.ts    10

ARTIFACT_HASHES: see artifact-hashes.json. All six frozen private artifacts match the
  ACT's recorded SHA-256 values exactly; both canonical prefix hashes were reproduced
  exactly by the production v2 algorithm over the canonical transcript. The raw session
  transcript, provider payloads and checkpoint free text remain OPERATOR-LOCAL and were
  NEVER committed.

BEHAVIORAL_CONVERGENCE: NOT_EXECUTED
```

---

## The verdict

```text
VERDICT: HALT_SOURCE_VISIBILITY
```

**The ACT's narrow question, answered in two parts.**

*Can ClineMM carry a model-authored working-knowledge checkpoint forward without
silently converting hypotheses into facts?* — **YES.** The carrier works through the
real production seam; 32 published records produced **zero** unsupported promotions;
the oracle survives and the ablation restores the absence; the projection is closed,
idempotent, conservation-safe and costs ~1 000–1 100 estimated tokens.

*Can a model explicitly preserve important working knowledge immediately before
compaction?* — **NOT YET, and the reason is upstream of the model.** The checkpoint
model does not receive the relevant pre-compaction evidence: all three witnesses
(`start --optimized`, `No delete/purge found in those paths`, `MtsOmni`) are in the
canonical history and in the pre-compaction provider request, but **none** of them is in
the checkpoint model's input. The model detected this itself and refused to fabricate
the missing content.

The ACT's `GO_PCK_IMPLEMENTATION_FEASIBLE` requires that the checkpoint model receives
the relevant pre-compaction evidence. That condition is **NO**, so the verdict is the
ACT's own designated `HALT_SOURCE_VISIBILITY`, whose next step is explicit: **fix the
input-selection problem before designing a memory carrier.**

```text
NEXT_ACTION:
  Open a SEPARATE, BOUNDED ACT whose single question is:
  "Can the checkpoint model be given a view of the pre-compaction history that contains
   the source observations ordinary compaction loses, WITHOUT widening the production
   summarizer's contract for arbitrary command output?"
  Candidate directions (from this ACT's evidence, none authorized here):
    (a) a checkpoint-ONLY source view with a bounded, source-attributed excerpt for the
        source-file-read class that buildSourceFileFact() already recognises;
    (b) derive the checkpoint from the EXISTING canonical evidence machinery
        (applyVerifiedEvidenceToCompactedMessages) rather than from the serializer's
        lossy view;
    (c) SEPARATELY, a record-selection policy that does not let the record ceiling
        discard a qualified observation in favour of a constraint restatement.
  This ACT does NOT propose deploying a memory system, a new public API, a sidecar
  schema, a database or a tool.

REOPEN_CONDITION:
  Reopen THIS ACT only if a later ACT demonstrates that a checkpoint model CAN be
  supplied with the R4/R6/R2-class observations under an acceptable confidentiality
  and authority boundary. If that later ACT succeeds, THIS ACT's remaining open
  questions are:
    - whether the model-authored checkpoint then publishes a faithful, qualified record
      for each of the three witnesses (the oracle already proves the transport);
    - whether the 66-81 s generation latency is acceptable, and if not, whether the
      checkpoint should be generated conditionally or by a smaller model;
    - whether the record-selection policy can be fixed so the ceiling does not discard
      a qualified observation.
  If the later ACT shows the observations still cannot be surfaced safely, the correct
  conclusion is that a model-authored checkpoint cannot carry THIS class of knowledge,
  and the work should stop there.
```

### Exit criteria not met, and why

| ACT exit criterion | Met? | Reason |
|---|---|---|
| `GO_PCK_IMPLEMENTATION_FEASIBLE` | **NO** | "The checkpoint model receives the relevant pre-compaction evidence" is NO for all three witnesses at both boundaries. |
| `PARTIAL_CHECKPOINT_GENERATION` | **NO** | That verdict is for "the observation is recoverable and the oracle projection works, but the actual model fails to publish an adequate record". Here the observation is **NOT recoverable** for the checkpoint model, and the model did publish adequate records for everything it could see. This is a visibility halt, not a generation halt. |
| `HALT_SOURCE_VISIBILITY` | **YES** | "The necessary facts are missing from the checkpoint model's input. Next: fix the input-selection problem before designing a memory carrier." |
| `HALT_TRUST_BOUNDARY_UNRESOLVED` | NO | A bounded, validated, closed projection forwards within an acceptable boundary. One over-broad regex false positive was found and corrected; it is recorded, not a blocker. |
| `HALT_RED_NOT_REPRODUCED` | NO | The RED reproduced on exact, hash-verified evidence with asserted preconditions. |
| `CAPTURE_INSUFFICIENT` | NO | Both canonical prefixes were reconstructed EXACTLY. |
| `NOT_A_USEFUL_CHECKPOINT` | NO | The model published 12–20 substantive records per boundary with correct qualifications; it did not merely restate the task. |

### The honest summary

The mechanism works. The **input** is wrong. A checkpoint fed the current production
serializer's view inherits exactly the summarizer's blind spot, so the observations
ordinary compaction loses are largely the same observations the checkpoint model cannot
see. The model behaved impeccably under those conditions — it reported the omission
rather than inventing the content, and it promoted nothing. But an impeccable model
cannot carry facts it was never given.
