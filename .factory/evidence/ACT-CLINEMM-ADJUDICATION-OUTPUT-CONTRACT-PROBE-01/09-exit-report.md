# 09 — Exit report

```text
ACT:                         ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01
ENTRY_HEAD:                  97c2659c8552a9b78ed87c56d2bbe7d31dc74900  (== expected)
FINAL_HEAD:                  recorded in the board entry and the operator
                             report; NOT written here (self-reference)
BRANCH:                      main
WORKTREE:                    /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
PRODUCTION_DELTA:            ZERO (no src/ production module changed)

VERDICT:                     PASS_PROBE_CONTINUITY_STRUCTURAL
NEXT_ACTION:                 A -- ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01
REOPEN_CONDITION:            see "Reopen conditions" below
```

## PREDECESSOR

```text
verdict:                 HALT_TRUST_BOUNDARY_UNRESOLVED
historical_red_preserved: YES -- byte-identical to d69cfb9be, still excluded
                            from the default suite, still 5 failed (5) on
                            demand
original_loss_boundary:  M1 -- the compaction SOURCE SELECTION. The
                          `agentic_summary` policy sets dropThinkingBlocks:true
                          and removes every thinking block before any budget
                          arithmetic, so a verdict that lives only in thinking
                          never reaches the summarizer.
```

The predecessor's disposition was PRESERVED, not reinvestigated. The
historical R3/R7/R8 witnesses were NOT recovered, and this ACT makes no
claim about them. The new contract is explicitly future-facing.

## CARRIER_INVENTORY

```text
assistant_text:            YES  -- first-class canonical ContentBlock; created
                                 by the real provider adapter; survives
                                 persistence byte-identically; NOT dropped by
                                 the agentic_summary policy
text_plus_tool_use:        YES  -- structurally proven in agent-runtime.ts /
                                 ai-sdk.ts, and LIVE-proven (the publishing
                                 turn also carried a tool call)
existing_tool_carrier:     NO  -- every registered tool either mutates the
                                 workspace, executes a command, or ends the run
canonical_persistence:     YES  -- normalizeStoredMessagesForPersistence and
                                 the agent-message codec round-trip both
                                 preserve the carrier verbatim
agentic_summary_visibility:YES  -- serializeMessage renders assistant text as
                                 "[Bot]: <envelope>"; the envelope reaches the
                                 summarizer input
```

## OUTPUT_CONTRACT

```text
schema:                 a strict-parsed JSON envelope in an assistant `text`
                         carrier, with a closed field set, a strict decision
                         enum, an allowlisted qualification vocabulary, an
                         allowlisted question vocabulary, and bounded arrays
authorship:              MODEL -- never user, never runtime, never system
qualification:           the ESSENTIAL qualification for the finding must
                         survive verbatim; dropping it is REJECTED, not
                         accepted as a weaker verdict
evidence_binding:        every reference must resolve to a canonical PAIRED
                         tool call/result; a paired id establishes PROVENANCE
                         IDENTITY, not semantic truth
source_revision:         must be independently bound by the runtime; an
                         unbound claim is REJECTED, a changed revision is
                         STALE
semantic_support:        OPT-IN and never inferred; when unavailable the
                         candidate stays PROVISIONAL and
                         SEMANTIC_SUPPORT_UNVERIFIED is stated
confidentiality:         closed identifier/enum vocabulary only; there is NO
                         field through which arbitrary model prose, file
                         content, stdout or reasoning can travel
injection_resistance:    unknown fields, unknown codes, unknown findings,
                         invalid enums, unbounded arrays and oversized
                         payloads are all REJECTED; an instruction-shaped
                         qualification code is REJECTED
```

## PRODUCER_PROBE

```text
execution_class: SYNTHETIC_REAL  (structural)  +  REAL_MODEL_RESPONSE  (live)
result:          PASS
                 PROBE-1 assistant-text publication      PASS
                 PROBE-2 continued execution            PASS
                 PROBE-3 canonical persistence           PASS
                 PROBE-4 no thinking dependency         PASS
                 PROBE-5 source-reference binding        PASS
                 PROBE-6 qualification fidelity         PASS
                 PROBE-7 incomplete publication          PASS
                 PROBE-8 no artifact                     PASS
```

## CANONICAL_PERSISTENCE

```text
result: PASS -- CANONICAL_PERSISTENCE_VERIFIED
        normalizeStoredMessagesForPersistence: byte-identical carrier
        agent-message codec round-trip:        byte-identical carrier
        MessageBuilder.buildForApi:            carrier present in the
                                              provider-visible projection
        CANONICAL_PERSISTENCE_UNVERIFIED: NOT TRIGGERED
```

## COMPACTION_PROBE

```text
m1_visibility:          the published assistant-text envelope SURVIVES the
                        agentic_summary projection; the thinking-only control
                        is DROPPED; the same thinking content is KEPT under
                        normal_provider_request (isolation control)
summarizer_input:       the envelope IS present in buildSummaryRequest's
                        output
summary_output:         DEPENDENT ON THE SUMMARIZER -- a controlled
                        summarizer that retains it preserves the decision, the
                        qualifications and the reference identities; a
                        controlled summarizer that omits it loses it
                        (MANDATORY NEGATIVE CONTROL, G4.3-B)
provider_continuation:  present when the summary retains it; ABSENT when the
                        summary omits it
second_compaction:      the candidate does not become a system instruction,
                        does not duplicate unboundedly, does not gain
                        authority, does not override newer contradictory
                        evidence, and does not silently lose its qualification
```

## NEGATIVE_CONTROLS

```text
All 15 required dispositions are executable and pass. See
06-adversarial-controls.md for the full table.
The SEMANTIC GROUNDING rule is honoured: a candidate with a valid, paired,
successful tool reference whose result does NOT support the decision is never
labelled VERIFIED.
```

## CONSERVATION_TESTS

```text
SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false   (asserted)
MAX_CARRIED_OUTCOMES                   = 12      (asserted)
dropThinkingBlocks for agentic_summary = true    (asserted)
Canonical history outside fixtures     unchanged
Task-contract behaviour                unchanged
Provider tool schemas                  unchanged
Sidecar schema                         unchanged
New default-on diagnostics             none
Cross-session state                    none
Additional model call in preparation    none
React updater semantics                unaffected
Stable-prefix behaviour                unchanged
Previous RED                           isolated and unchanged
PRODUCTION DELTA                       ZERO
```

## EXECUTED_GATES

```text
GATE 1  focused contract probe          55 passed (55)          EXIT=0
GATE 2  historical discriminator        24 passed (24)          EXIT=0
GATE 3  evidence fidelity               39 passed (39)          EXIT=0
GATE 4  context directory              551 passed | 2 skipped   EXIT=0
                                                (498 baseline + 55)
GATE 5  typecheck                       44 diagnostics           EXIT=2
                                               identical to baseline,
                                               0 ACT-owned
GATE 6  historical RED (on demand)        5 failed (5)           EXIT=1
                                               EXPECTED
GATE 7  biome                            clean                   EXIT=0
GATE 8  live model probe                 publishedValidCandidate EXIT=0
```

## TYPECHECK_BASELINE

```text
44 diagnostics at entry, 44 after.
Diagnostic IDENTITIES identical (file, code, message; line/column stripped).
ACT_OWNED_DIAGNOSTICS: 0
```

## LIVE

```text
executed:          YES
model_provider:    minimax / MiniMax-M3 (local settings provider)
capture_identity:  sanitized observation report committed at
                   verification/gate8-live-model-probe.txt; the raw provider
                   payloads were written to a PRIVATE temp path and are NOT
                   committed. Only sanitized synthetic fixture data is in Git.
observations:      10 measured runs, 9 published a schema-valid candidate.
                   In every published run:
                     decision               = "narrowed"
                     qualification_codes    = ["manual_enforcement_only"]
                     remaining_question_ids = ["S1.automated_enforcement"]
                     publishedTurnAlsoCarriedToolUse = true
                     publishedAfterToolResult         = true
                   ONE run did not publish.
                   NEGATIVE FINDING: the model's evidence_tool_use_ids were
                   NOT canonical ids (tool names, synthetic labels, invented
                   ids). Every one would be REJECTED by the contract -- which
                   is correct, and which becomes design constraint C1 for the
                   successor.
```

### The evidence categories were kept distinct

```text
SYNTHETIC CANONICAL FIXTURE  -> 03-producer-probe.md
MOCKED PROVIDER RESPONSE      -> 05-compaction-consumer-probe.md
REAL MODEL RESPONSE           -> 06-adversarial-controls.md (G6)
LIVE INSTALLED RUN            -> NOT CLAIMED
```

No category was promoted to another.

## ARTIFACTS

```text
sdk/packages/core/src/extensions/context/
  compaction.adjudication-output-contract.probe01.test.ts   (the probe)
sdk/packages/core/scripts/
  adjudication-output-contract.live-probe.ts                 (the live harness)
.factory/evidence/ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01/
  00-entry-identity.md
  01-existing-carrier-inventory.md
  02-output-contract.md
  03-producer-probe.md
  04-canonical-persistence.md
  05-compaction-consumer-probe.md
  06-adversarial-controls.md
  07-contract-decision.md
  08-executable-gates.md
  09-exit-report.md
  artifact-hashes.json
  verification/
    gate1-focused-probe.txt
    gate2-historical-discriminator.txt
    gate3-evidence-fidelity.txt
    gate4-context-directory.txt
    gate5-typecheck.txt
    gate6-red-preserved.txt
    gate7-biome.txt
    gate8-live-model-probe.txt
```

## VERDICT

```text
PASS_PROBE_CONTINUITY_STRUCTURAL
```

The existing runtime can represent and persist an explicitly published
non-reasoning adjudication candidate; the schema and security tests pass;
the candidate enters the REAL compaction summarizer input; and the
compaction path preserves the candidate through a controlled summarizer and
into the provider-visible continuation, with the negative controls
demonstrating exactly where the contract is NOT guaranteed.

**This does NOT prove reliable multi-compaction preservation.** The
summarizer omission boundary (G4.3-B) is real, measured and unfilled.

## NEXT_ACTION

**A -- `ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01`**

Authorized because existing-carrier feasibility AND the trust contract are
both supported by executable evidence. The implementation must remain:

- **future-facing** (no historical recovery);
- **bounded** (closed vocabulary, no arbitrary content transport);
- **provisional** (never a system instruction, never above the canonical
  evidence);
- **using the existing assistant `text` carrier** -- no new public
  content-block type, no new protocol, no new persistence subsystem;
- and it must carry design constraints **C1** through **C5** from
  `07-contract-decision.md`.

**B -- `ACT-CLINEMM-ADJUDICATION-OUTPUT-PROTOCOL-DESIGN-01`** is NOT
recommended: the recon demonstrated that a suitable existing carrier DOES
exist. A protocol-design ACT would be created only because a new structured
format seems elegant, which the ACT explicitly forbids.

**C -- no implementation** is NOT recommended: the contract is demonstrably
safe, demonstrably feasible, and demonstrably useful as a continuation aid.

## REOPEN_CONDITION

This ACT's verdict reopens if ANY of the following becomes true:

1. A future measurement shows the assistant `text` carrier does NOT reach
   the summarizer input under the `agentic_summary` policy (the G4.1
   discriminator inverts).
2. A future measurement shows a live model publishes a candidate that
   routinely loses its essential qualification, or converts `narrowed` into
   `supported` (the G6 compliance figure degrades materially).
3. A future implementation attempt shows that the canonical tool-call id
   cannot be made available to the model (constraint C1), which would make
   the evidence binding unsatisfiable in practice.
4. The `agentic_summary` budget policy changes to drop or transform
   assistant `text` blocks, which would invalidate the carrier choice.
5. A summarizer-retention mechanism is implemented that changes the G4.3-B
   boundary; the continuity claim must then be re-measured, not assumed.
