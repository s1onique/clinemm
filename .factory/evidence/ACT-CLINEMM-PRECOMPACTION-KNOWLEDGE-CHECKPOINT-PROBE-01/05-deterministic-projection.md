# 05 — Deterministic projection through the real seam

**Evidence class:** `SYNTHETIC_REAL` — real production functions, synthetic content.
**Reproduction:** `checkpoint-projection.test.ts` (6 tests, all passing).

---

## 5.1 The seam that was driven

```text
createCompactionStateAwarePrepareTurn
  -> createContextCompactionPrepareTurn({ strategy: "agentic" })
     -> runAgenticCompaction
        -> buildAgenticSummaryInputBudget -> buildBudgetProjection
        -> serializeConversation -> buildSummaryRequest
        -> generateSummary   (mocked at the EXISTING @cline/llms createHandlerAsync boundary)
     -> applyTaskContractToCompactedMessages
     -> applyVerifiedEvidenceToCompactedMessages
     -> [CHECKPOINT PROJECTION]      <- the ACT's test-local seam
     -> MessageBuilder.buildForApi
```

The summarizer request string is **captured from the mocked provider handler**, never
re-derived from the production code, so the assertions about it are about the real
production request.

**The live sidecar and the installed extension were not modified.** The projection is
applied to a COPY of the projected messages inside the harness.

---

## 5.2 The four cases

| Case | Checkpoint | Projection | Result |
|---|---|---|---|
| **A** | none | recorded control | the exact source observation is **ABSENT** from the provider-visible continuation; the TOPIC (`kc.sh build`) is present |
| **B** | model-generated, validated | treatment | subject-level retention; see `04-model-publication-results.md` for the token-level finding that the exact tokens were never in the model input |
| **C** | **SYNTHETIC** oracle | diagnostic positive control | **the oracle SURVIVES the real projection seam**, with both qualifications intact |
| **D** | none | ablation of the treatment | removing the checkpoint **restores the absence** |

### Case A — control (the recorded baseline)

```text
The summarizer really ran and really received an input window.   (request length > 0)
The TOPIC survived:        provider-visible text contains "kc.sh build"
The EXACT observation did NOT survive: it does not contain
                           "exec /opt/keycloak/bin/kc.sh start --optimized"
The exact bounded negative did NOT survive either.
checkpointApplied = false
```

### Case C — the synthetic oracle (diagnostic positive control)

The oracle is built from the independently verified R4/R6 facts. It is labelled
**`SYNTHETIC`** and is **never** presented as a model response.

```text
accepted = 2, rejected = 0
checkpointApplied = true, carriedRecordCount = 2
provider-visible text contains "start --optimized"
provider-visible text contains the checkpoint section heading
provider-visible text contains "configuration drift remains unproven"
provider-visible text contains "an external purge is not excluded"
provider-visible text contains "returned no delete/purge match"
provider-visible text does NOT contain "no retention mechanism exists anywhere"
```

### Case D — ablation

```text
with checkpoint:    provider-visible text contains "start --optimized"
without checkpoint: provider-visible text does NOT contain "start --optimized"
```

**This is the causal demonstration.** The information's presence in the continuation is
caused by the checkpoint, and removing the checkpoint removes it.

---

## 5.3 The conservation requirements (G4.5)

| Requirement | Measured | Result |
|---|---|---|
| Canonical history unchanged | The canonical message array's JSON is byte-identical before and after the run | ✅ |
| No source/tool execution | The harness executes no repository command; the checkpoint model had no tools | ✅ |
| No second summary call | Exactly **1** message with `metadata.kind === "compaction_summary"` in the projection | ✅ |
| No state mutation outside the fixture | `saveState` is a no-op; `getState` returns `undefined` | ✅ |
| No duplicate checkpoint section | Applying the checkpoint twice leaves exactly **1** section heading; `stripCheckpointSection` removes it cleanly | ✅ |
| Task contract preserved | The `## Active task contract (authoritative)` section is intact in the projected summary | ✅ |
| Verified outcomes preserved | The `## Verified tool outcomes (canonical record)` section is intact | ✅ |
| Token budget respected | Projected section 1 010 / 1 117 estimated tokens vs. the 1 500 experimental ceiling | ✅ |

The projected summary, verbatim from the harness:

```text
## Goal
Adversarially verify and adjudicate the ten production-risk findings.

## State
- **Done:** Ran targeted read-only inspection of the repository.
- **In Progress:** Evidence collection for the findings was underway.
- **Blocked:** Some command outputs were omitted from the session.

## Highlights
- Keycloak startup `kc.sh build` behavior.
- Java provider timeout/circuit-breaker code.
- Token-code retention concerns.

## Files
Read: - none
Modified: - none

## Active task contract (authoritative)
<!-- cline-task-contract:begin -->
### User-authored objective (user authority)
Finding R4: Rebuilding Keycloak at container startup creates configuration consistency and deployment risks.
<!-- cline-task-contract:end -->

## Verified tool outcomes (canonical record)
<!-- cline-evidence:begin -->
- run_commands (call_r4_source_read_0001): succeeded — cat
<!-- cline-evidence:end -->

## Working knowledge checkpoint (model-authored, bounded)
<!-- cline-knowledge-checkpoint:begin -->
r4-startup: kind=observation assurance=tool_observed status=active statement=startup.sh executes kc.sh build and then executes start --optimized. qualifications=Observed command pair only; configuration drift remains unproven. evidence_refs=call_r4_source_read_0001
r6-retention: kind=observation assurance=tool_observed status=unresolved statement=A retention grep over the inspected provider paths returned no delete/purge match. qualifications=Bounded to the inspected paths; an external purge is not excluded. evidence_refs=call_r4_source_read_0001
<!-- cline-knowledge-checkpoint:end -->
```

Note the composition: the checkpoint section sits **beside** the task contract and the
verified-outcome section, not instead of them. The closed representation carries only
kind, assurance, status, statement, qualifications and opaque evidence references — no
raw source excerpt, no private reasoning, no unrestricted command output, no absolute
workspace path.

---

## 5.4 Idempotence

The projection is strip-then-replace, exactly like the production adjudication
carry-forward. Applying it to a summary that already carries a section produces exactly
one section, and `stripCheckpointSection()` removes the heading together with the marked
block — so a later compaction REPLACES the section instead of appending a second copy.

---

## 5.5 Malformed input does not destroy the compaction path

```text
parseCheckpointDocument("this is not json at all")
  -> schemaValid = false, records = []
run the real seam with acceptedRecords = []
  -> the compaction still happened
  -> the provider-visible text is non-empty and contains "kc.sh build"
  -> checkpointApplied = false
```

The parser is **total**: it never throws. Nine malformed shapes are asserted in
`checkpoint-security-controls.test.ts` case `G7.3.1` (`undefined`, `null`, `42`, a
string, an array, `{}`, `{records: "not an array"}`, `{records: [null, 7, "x", {}]}`, and
a record with an unknown kind/assurance/status).

---

## 5.6 The discriminator this establishes (G4.4)

> If the oracle survives but model output fails, the bottleneck is checkpoint generation
> or validation. If even the oracle does not survive the projection, the bottleneck is
> the preservation seam.

**The oracle SURVIVES the real projection seam.** Therefore:

- the **preservation seam is sound** — a validated, bounded, structured record set
  reaches the provider-visible continuation, with its qualifications, without disturbing
  the task contract, the verified outcomes, the canonical history, or the message count;
- the bottleneck is **upstream of the seam** — in the checkpoint model's INPUT (the
  source-visibility defect) and in the checkpoint SELECTION (the experimental ceiling),
  not in the transport or the projection.

This is the single most important structural finding of the ACT: **a checkpoint carrier
is mechanically feasible; what it can carry is currently limited by what the checkpoint
model is allowed to see.**
