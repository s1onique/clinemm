# ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01 — C0/C1 entry and source identity

```text
ACT_ID: ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01
TYPE: bounded executable recon (no production change)
ENTRY_HEAD: 8a78510b8
PREDECESSOR_IMPLEMENTATION: 8a78510b8
BRANCH: main
EVIDENCE: .factory/evidence/ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01/
```

## C0 — the REAL mature-session canonical history

The two candidate sessions offered by the operator were both acquired and
measured. **Both are REAL** persisted sessions of live dogfood runs.

| Session | Messages | Tool calls | Tool results | Joined events | Production input view | Est. tokens |
| --- | --- | --- | --- | --- | --- | --- |
| `1795489471969_tachv` | 114 | 56 | 56 | 56 | 296 103 chars | 98 701 |
| `1795491279366_h629x` | 22 | 10 | 10 | 10 | 84 398 chars | 28 133 |

**`1795489471969_tachv` is the mature workload** and is the one every
candidate was evaluated against. It is also the session produced by the
extension build `4.1.26-6fdf56079` — the Qwen-inference-policy commit —
which is the build that generated the correlated 64 024-token PCK request.

```json
{
  "acquisition": "REAL_MATURE_SESSION_CANONICAL_HISTORY",
  "sessionId": "1795489471969_tachv",
  "sessionSource": "vscode",
  "sessionMode": "user",
  "sessionExtensionVersion": "4.1.26-6fdf56079",
  "sessionUpdatedAt": "2026-11-24T03:27:52.427Z",
  "sessionAgent": "lead",
  "canonicalHistorySha256": "3d398ad20c71e9136fb592bb9853a2d9565a0862d368ad76cc211e96a7db9b27",
  "messageCount": 114,
  "roleCounts": { "user": 58, "assistant": 56 },
  "toolCallCount": 56,
  "toolResultCount": 56,
  "joinedCanonicalToolEventCount": 56,
  "privateReasoningBlockCount": 56,
  "publicTextBlockCount": 2,
  "productionInputViewChars": 296103,
  "productionInputViewEstimatedTokens": 98701,
  "canonicalReferenceCount": 114
}
```

The history's identity is pinned by the SHA-256 above, so every candidate is
provably evaluated against the SAME canonical history.

### CONFIDENTIALITY

The acquired history is written to the repository's **GITIGNORED** `tmp/`
tree only. It is never committed. The committed evidence carries only the
aggregate, non-reversible facts above. No private repository contents,
credentials or raw reasoning reach committed evidence. The raw model
outputs are likewise operator-local (`tmp/pck-input-recon/candidate-*.txt`).

The session's own content is a third-party production-risk audit of an
unrelated private repository. Nothing from it is reproduced here beyond the
runtime-owned aggregate counts.

## C1 — what the runtime ALREADY owns

The production source recon established the following, from the source and
not from assumption:

| Production mechanism | What it already provides | Where |
| --- | --- | --- |
| `buildCheckpointInputView()` | the reduced read-only view (text only, tool results with status + body, tool calls as bounded labels, private reasoning EXCLUDED) | `precompaction-knowledge-checkpoint/model-request.ts` |
| `buildCheckpointRequest()` | the request envelope + the canonical reference list | same |
| `interpretCanonicalEvidence()` | the ATOM-SCOPED, ARGUMENT-SCOPED assurance ceiling | `precompaction-knowledge-checkpoint/evidence.ts` |
| `collectCanonicalToolEvents()` | the joined, fail-closed call↔result ledger with the command CLASSIFICATIONS | same |
| `classifyCommand()` | the production command allowlist (the only deterministic operation evidence) | `extensions/context/evidence-continuity.ts` |
| `gateClosedProposals()` | the closed-vocabulary gate, the reference MEMBERSHIP check and the assurance downgrade | `precompaction-knowledge-checkpoint/publication-gate.ts` |
| `extractVerifiedToolOutcomes()` | the production VERIFIED-OUTCOME ledger (status + allowlisted subjects, never raw output) | `extensions/context/evidence-continuity.ts` |
| the task contract | the session's own commissioned findings, carried across compaction | `extensions/context/task-contract.ts` |

### WHAT THE CLOSED VOCABULARY CAN AND CANNOT ESTABLISH

`DETERMINISTICALLY_ESTABLISHABLE_ATOMS` is exactly
`["OPERATION_INVOKED", "OPERATION_ARGUMENT_SET"]`, and
`RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS` gives the `build` argument a
NON-EMPTY set — `["make build"]` — while every other argument
(`start`, `start_optimized`, `connect_timeout_3s`, `socket_timeout_10s`,
`none`) has an EMPTY set.

So the runtime's deterministic operation surface is effectively ONE
classification: `make build`.

### THE MECHANISMS THAT ALREADY DUPLICATE PCK KNOWLEDGE

- The **verified-outcome ledger** already carries each successful tool
  outcome's status and its allowlisted command subjects across compaction.
- The **task contract** already carries the session's commissioned findings.

Both are existing production mechanisms. A checkpoint record that merely
restates them adds NO incremental utility beyond ordinary compaction. The
C3 oracle makes this measurable rather than rhetorical.

### INFORMATION REQUIRED TO ESTABLISH EACH ADMISSIBLE ATOM

| Atom | What the runtime needs | Can it establish it? |
| --- | --- | --- |
| `OPERATION_INVOKED` | a cited, joined, successful `run_commands` call whose own classification is `make build` | **YES** |
| `OPERATION_ARGUMENT_SET` | the same, plus the selected argument is `build` | **YES** |
| `CONFIGURATION_VALUE_SET` | a configuration value read from a file and compared with a claim | **NO** — no deterministic runtime-owned rule |
| `IMPLEMENTATION_INSPECTED` | a read whose content entails "the implementation was inspected" | **NO** — a listing does not entail it |
| `SEARCH_RETURNED_NO_MATCH` | a bounded search whose result entails "no match" | **NO** — 42 matches does not entail it |
| `QUESTION_REMAINS_OPEN` | a model judgment | **NO** — bounded at `model_reported` |

### INFORMATION IRRELEVANT TO THE CLOSED VOCABULARY

The bulk of the transcript. A finding's severity, its confidence rating, its
argument, its rebuttal and its resolution are all **free text**. The closed
vocabulary has NO field for any of them: the statement is RENDERED from the
atom label and the argument label, and the qualifications are RENDERED from
a closed five-class list. **The published record therefore cannot carry the
finding's content at all.**

That is the central architectural constraint this recon had to confront.

### INFORMATION THAT CANNOT SAFELY BE DISCARDED

The evidence that would let the model choose a record at all, and the
canonical references the gate checks by MEMBERSHIP. Discarding the
references would make every record `unverified`.

## THE RECON TOOLING

| Artifact | Role |
| --- | --- |
| `sdk/packages/core/scripts/pck-input-recon.acquire-history.ts` | C0 — acquires a REAL session's canonical history into the gitignored tree and records the aggregate facts |
| `sdk/packages/core/scripts/pck-input-recon.utility-oracle.ts` | C3 — the independently-built inventory of relevant knowledge |
| `sdk/packages/core/scripts/pck-input-recon.compare.ts` | C4 — the executable comparison against the live endpoint |
| `sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/input-candidates.recon.ts` | the four candidate representations (RECON-ONLY) |
| `sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-input-candidates.recon.test.ts` | C5 — the trust-boundary conservation witnesses |
