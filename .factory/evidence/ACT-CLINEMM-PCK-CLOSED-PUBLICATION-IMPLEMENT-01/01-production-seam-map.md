# 01 — The production seam map

```text
ACT: ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
```

## 1.1 — The ACTUAL production lifecycle, as found in the source

The ACT's PROPOSED ordering was:

```text
Canonical agent history
        v
Compaction eligibility decision
        v
Pre-compaction checkpoint generation        <-- SEAM 1
        v
Closed publication validation
        v
Accepted bounded records / empty
        v
Existing agentic compaction
        v
Task-contract enrichment
        v
Verified-outcome enrichment
        v
Existing adjudication enrichment
        v
Closed checkpoint projection                <-- SEAM 2
        v
   Persisted state  /  Provider request
```

**The REAL ownership and injection points, confirmed against the source:**

| Stage | Production owner (file:line at the entry HEAD) |
|---|---|
| Canonical history | `agent-runtime.ts` -> `context.messages` |
| Eligibility decision | `compaction.ts` `createContextCompactionPrepareTurn` -> `shouldCompact` (line 699) |
| Strategy dispatch | `compaction.ts` `runBuiltinStrategy(builtinOptions)` (line 1091) |
| Agentic compaction | `agentic-compaction.ts` `runAgenticCompaction` -> `generateSummary` (line 189) |
| Task-contract enrichment | `compaction.ts` -> `applyTaskContractToCompactedMessages` (line 1819) |
| Verified-outcome enrichment | `compaction.ts` -> `applyVerifiedEvidenceToCompactedMessages` (line 1839) |
| Adjudication enrichment | `compaction.ts` -> `applyAdjudicationCarryForward` (line 1849) |
| Persisted state | `compaction.ts` -> `createSessionCompactionState` (line 1856) |
| Provider request | `session/services/message-builder.ts` `MessageBuilder.buildForApi` (line 219) |

### THE TWO OWNERSHIP FACTS THAT DETERMINE THE SEAMS

**FACT 1 — the eligibility decision and the strategy dispatch live in the
INNER seam, and the enrichments live in the OUTER seam.**

`createContextCompactionPrepareTurn` (inner) decides whether to compact and
runs the strategy. `createCompactionStateAwarePrepareTurn` (outer) runs the
enrichments and persists the result.

The checkpoint therefore needs to span BOTH: it must be generated AFTER the
inner seam has decided to compact, and it must be projected in the OUTER
seam, after the enrichments and before the persistence.

**FACT 2 — the OUTER seam is where the checkpoint can be injected without
touching the ordinary summarizer.**

The outer seam already owns the ordering
`contracted -> evidenced -> adjudicated -> createSessionCompactionState`.
The checkpoint is appended as ONE more stage in that chain, so the ordinary
summarizer is NOT widened at all.

## 1.2 — The chosen injection points

```text
SEAM 1 — generatePreCompactionKnowledgeCheckpoint()
  file:   sdk/packages/core/src/extensions/context/compaction.ts
  site:   the FIRST-compaction branch of
          createCompactionStateAwarePrepareTurn, immediately BEFORE
          `input.compact(context)` is invoked.

  WHY THERE AND NOT EARLIER
    - `input.compact` IS the eligibility decision. The inner seam returns
      `undefined` when no compaction is required. The checkpoint is
      therefore NEVER generated for a turn that merely prepared a request.
    - It is AFTER the decision, so no checkpoint model call happens merely
      because a normal turn was prepared.

  WHY THERE AND NOT LATER
    - It must be BEFORE the agentic compaction, because the checkpoint's
      input is the WORKING-AGENT CONTEXT. After the compaction, that
      context is a lossy summary.

SEAM 2 — projectPreCompactionKnowledgeCheckpoint()
  file:   sdk/packages/core/src/extensions/context/compaction.ts
  site:   the FIRST-compaction branch of
          createCompactionStateAwarePrepareTurn, AFTER
          applyAdjudicationCarryForward and BEFORE
          createSessionCompactionState.

  WHY THERE
    - The publication gate has already run inside seam 1, so the records
      that reach seam 2 are the GATE'S OUTPUT. An ungated candidate has no
      path into the sidecar.
    - It is BEFORE `createSessionCompactionState`, so the persisted sidecar
      cannot receive an ungated candidate.
    - It is BEFORE the provider projection is built downstream, so the
      provider-visible continuation cannot receive one either.
    - It is AFTER the existing enrichments, so the task contract, the
      verified outcomes and the adjudication carry-forward are untouched.
```

## 1.3 — How the compaction paths are discriminated

Every path was checked SEPARATELY.

| Path | Reaches a checkpoint? | Reason |
|---|---|---|
| AUTO + AGENTIC | **YES** | the supported path: eligibility passed, the agentic strategy ran, the checkpoint is generated from the working-agent context and published |
| MANUAL + AGENTIC | **YES** | the same outer seam; the mode does not change the projection chain |
| BASIC | **NO** | the basic strategy produces no agentic summary; the outer seam's checkpoint records stay empty because the seam is only populated on the agentic path |
| OVERFLOW_RECOVERY | **NO** | recovery must not depend on another successful LLM request. The overflow-recovery branch falls back to the DETERMINISTIC basic compaction, so the checkpoint is never generated on it |
| COMPACTION_SKIPPED | **NO** | the inner seam returned `undefined`; the outer seam's `result?.messages` is falsy and no checkpoint record is produced |
| COMPACTION_FAILED | **NO** | the strategy threw; the error propagates and no checkpoint is published |
| RECOMPACTION | **NO** | the re-compaction branch re-compacts an ALREADY-SUMMARISED transcript. A checkpoint generated there would read the lossy summary, which is exactly what the checkpoint exists to avoid. The prior checkpoint SURVIVES the re-compaction because it is carried inside the persisted summary |
| PERSISTED_STATE_RESTORATION | **NO** | the restoration branch projects the persisted sidecar. The checkpoint is part of that persisted content, so it is RESTORED with no model call and no new generation |

### THE TWO HARD REQUIREMENTS THE ACT NAMED

```text
"Do not call the checkpoint before the actual compaction eligibility
 decision."
  SATISFIED. The checkpoint call is sequenced AFTER `input.compact(context)`
  — the very call that IS the eligibility decision.

"provider-confirmed overflow recovery must not wait for a potentially
 expensive additional model generation if doing so jeopardizes recovery."
  SATISFIED. The overflow-recovery path never reaches the checkpoint
  generation. The recovery path's own determinism is preserved exactly.
```

## 1.4 — Lifecycle ownership

```text
Session identity:          config.sessionId (the host-owned session ulid)
Conversation identity:     context.conversationId
Canonical source prefix:   canonicalSourcePrefixKey(context.messages)
                           — the SAME hash the sidecar records as
                           source_prefix_hash, exported for this purpose
Compaction decision id:    the seam's `decisionId()`, bound to the attempt
Cancellation signal:       context.abortSignal, combined with the
                           checkpoint's own deadline
Provider configuration:    resolveSummarizerConfig over the live session
                           provider config — the SAME resolution the
                           ordinary summarizer uses
Model request budget:      the summarizer's own provider input limit; the
                           checkpoint's input is bounded by the canonical
                           history and shares the provider's limit
Sidecar persistence owner: createSessionCompactionState (unchanged)
```

**"Can a checkpoint be generated once per compaction decision without
introducing a second session or canonical conversation writer?"**

```text
YES.
  - The checkpoint makes NO canonical write. It reads the canonical history
    and returns records.
  - The checkpoint is published INTO the existing `compaction_summary`
    message. No new message, no new sidecar, no new schema version.
  - The attempt is bound to (decisionId, sourcePrefixKey). The re-evaluated
    `prepareTurn` path does NOT re-enter the checkpoint generation: the
    generation is sequenced on the FIRST-compaction branch only.
  - The re-compaction branch reuses the ALREADY-PUBLISHED section, because
    the section travels inside the persisted summary.
```

## 1.5 — The existing source invariants, preserved

```text
agentic_summary.dropThinkingBlocks = true
  PRESERVED. The ordinary summarizer's budget projection is untouched.
  The checkpoint has its OWN view builder, which drops `thinking` and
  `redacted_thinking` blocks independently. The ordinary summarizer's
  policy was not widened.

SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false
  PRESERVED. The file is untouched by this ACT.

MAX_CARRIED_OUTCOMES = 12
  PRESERVED. The evidence-continuity module is untouched. The checkpoint's
  own ceiling is a SEPARATE, runtime-owned constant
  (MAX_CARRIED_CHECKPOINT_RECORDS = 12), so the two budgets do not
  interact.

No arbitrary command stdout in the ordinary summarizer input
  PRESERVED. The ordinary serializer is untouched. The checkpoint's OWN
  input DOES carry tool-result bodies — because the working agent already
  received them — and that content is what the closed publication gate
  exists to keep from being published.
```

## 1.6 — The production delta

```text
NEW FILES (tracked source, self-contained):
  sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/
    closed-vocabulary.ts     the runtime-owned vocabularies
    publication-gate.ts      the closed publication gate
    projection.ts            the deterministic projection
    evidence.ts              canonical reference collection + the assurance
                             interpreter
    model-request.ts         the Candidate B input view and the closed
                             instruction
    runtime.ts               the feature gate, the deadline, the
                             cancellation and the attempt
    pck-production-seam.test.ts
    pck-closed-contract.test.ts
    pck-conservation-ablation.test.ts
    pck-persistence-restoration.test.ts
    pck-knowledge-utility.test.ts
    pck-production-seam.red01.test.ts   (ISOLATED RED witness)

MODIFIED FILES:
  sdk/packages/core/src/extensions/context/compaction.ts
    + the two seams, the seam input, the logger
  sdk/packages/core/src/session/models/session-compaction.ts
    + canonicalSourcePrefixKey() — the exported canonical prefix identity
  sdk/packages/core/src/runtime/host/local-runtime-host.ts
    + the knowledgeCheckpoint seam wiring
  sdk/packages/core/vitest.config.ts
    + the RED-witness exclusion
  sdk/packages/core/package.json
    + the two qualification scripts

NO NEW:
  database, memory service, sidecar schema version, provider tool,
  tool-result field, global agent memory store, protobuf field,
  settings field, public/protocol message
```

## G1 exit

```text
PRODUCTION_PCK_SEAM_IDENTIFIED
```
