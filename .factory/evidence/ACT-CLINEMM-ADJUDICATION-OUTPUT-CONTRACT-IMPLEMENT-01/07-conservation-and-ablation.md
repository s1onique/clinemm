# 07 — The conservation requirements and the necessity ablation

## The conservation table

| Requirement | Status | How it is established |
|---|---|---|
| `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false` | PRESERVED | The constant is untouched in `evidence-continuity.ts`. The ACT did not modify that module at all. |
| `MAX_CARRIED_OUTCOMES = 12` | PRESERVED | Untouched. The ACT introduced its OWN bounded count (`MAX_CARRIED_ADJUDICATIONS = 8`) rather than extending the verified-outcome budget. |
| `dropThinkingBlocks = true` for `agentic_summary` | PRESERVED | `budget-projection/project.ts` is untouched. The ACT reads assistant `text` carriers, never thinking blocks. |
| Canonical history unchanged | PRESERVED | The carry-forward attaches to the compacted projection; it never mutates `context.messages`. A dedicated control asserts the canonical history is byte-identical before and after the compaction. |
| Tool-call/result pairing unchanged | PRESERVED | A dedicated control asserts the tool-call/result pairing is byte-identical before and after the compaction. |
| Task-contract authority unchanged | PRESERVED | `task-contract.ts` is untouched; the adjudication section is a SEPARATE, independent projection applied AFTER it. |
| Provider tool schemas unchanged | PRESERVED | No tool schema was modified. The live probe's synthetic schema is a probe-local fixture, not a production change. |
| Existing session isolation unchanged | PRESERVED | The handle registry is session-scoped and a handle from another session does not resolve. |
| No default-on diagnostic instrumentation | PRESERVED | No telemetry, trace sink or diagnostic flag was added. The ablation hook used for G7.1 was REMOVED after the measurement (verified: `grep -c ABLATION compaction.ts` returns 0). |
| No mutation of unrelated persisted messages | PRESERVED | Only the `compaction_summary` message is rewritten, and only its `content` and `metadata.summary`. |
| No unexpected provider-request prefix churn | PRESERVED | The section is derived from the sidecar's OWN `source_message_count` boundary, so the provider-visible prefix is byte-stable across continuations. |
| No model request added to the no-op path | PRESERVED | The no-compaction branch returns the metadata-only result and does not reach the carry-forward at all. The ACT adds NO model call anywhere. |
| Automatic source-file excerpt carry-forward remains disabled | PRESERVED | Untouched. |

## The production delta

```text
sdk/packages/core/src/extensions/context/adjudication-continuity.ts          NEW
sdk/packages/core/src/extensions/context/compaction.adjudication-output-contract.implement01.test.ts  NEW
sdk/packages/core/src/types/adjudication-config.ts                            NEW
sdk/packages/core/scripts/adjudication-output-contract.implement01.live-probe.ts  NEW (a script, not a production module)

sdk/packages/core/src/extensions/context/compaction.ts                        MODIFIED (the carry-forward, at three sites)
sdk/packages/core/src/runtime/host/local-runtime-host.ts                      MODIFIED (the registry, the seam, the instruction)
sdk/packages/core/src/types/config.ts                                          MODIFIED (the config field)
sdk/packages/core/src/index.ts                                                 MODIFIED (the barrel exports)
```

No new public tool, provider protocol field, persistence subsystem,
cross-session state service or generic knowledge store.

## The G7.1 causal progression

### A — Original production implementation

The C1 positive witness and the C2 summarizer-omission witness both
FAILED. The predecessor measured `candidate_accepted: 0 / 10` live, and
the C2 boundary was reproduced by the predecessor's own RED suite.

### B — Bounded implementation enabled

```text
focused C1/C2 suite          54 passed / 0 failed
context suite                614 passed / 2 skipped
contract probes              64 passed
evidence-fidelity regression 39 passed
typecheck                    44 diagnostics, 0 ACT-owned
live candidate_accepted      4 / 16 with a genuine nonempty bound reference
live compaction boundary     persisted=True visible=True count=1 in all 4
```

### C — Remove ONLY the bounded implementation

The adjudication carry-forward inside `createCompactionStateAwarePrepareTurn`
was disabled. Everything else — the parser, the validator, the evidence
registry, the handle projection, the publication instruction — was
UNCHANGED.

```text
Ablated:  5 failed | 49 passed (54)
Failed:
  RED-C2: the summarizer OMITS the candidate and the continuation KEEPS it
  a summarizer that RETAINS the candidate produces the SAME carried section
  the carried section is IDEMPOTENT: no duplicate accumulation
  a SECOND compaction keeps EXACTLY ONE qualified candidate
  the carried section is a CLOSED representation: only authorized values
```

The five failures are EXACTLY the C2 continuity witnesses and the
closed-representation control. The C1 gate tests remain GREEN under the
ablation, which is CORRECT: they exercise the parser and the validator
directly, and the ablation removes only the PROJECTION.

The receipt is `verification/gate7-ablation-implement01.txt`.

## G7.2 — The historical RED is preserved

The five thinking-only adjudication tests in
`compaction.adjudication-continuity.red01.test.ts` remain INTENTIONALLY
RED:

```text
bun x vitest run --config vitest.red.adjudication-continuity-red01.config.ts
  Test Files  1 failed (1)
       Tests  5 failed (5)
```

They were NOT weakened and NOT converted into ordinary assistant-text
fixtures. The file is byte-identical to the entry head.

This ACT is future-facing. The historical thinking-only recovery is NOT
implemented and is NOT claimed.
