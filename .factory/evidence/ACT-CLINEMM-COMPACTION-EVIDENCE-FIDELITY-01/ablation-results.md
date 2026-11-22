# Ablation results — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01

## The ablation

Identical canonical input. **Only** the restoration differs: the tool name
that classifies a result payload as a source-attributed file read.

| Arm | Construction | Observable |
|---|---|---|
| **CONTROL** | `flattenToolResultContent(payload)` — the pre-repair production projection | `"[succeeded] #1: [result omitted]"` |
| **TREATMENT** | `flattenToolResultContent(payload, "read_files")` — the SAME payload | `"[succeeded] source-file <path>: <the source text>"` |

The task contract, the tool schemas, the model settings, the source revision,
the compaction policy and the unrelated conversation history are identical in
both arms.

## Ablation arms — receipts

All four are asserted in
`sdk/packages/core/src/extensions/context/compaction.evidence-fidelity01.test.ts`.

| Proof | What it shows | Assertion | Result |
|---|---|---|---|
| PROOF 1 | The fact IS present BEFORE the identified transformation | the canonical payload contains `/opt/keycloak/bin/kc.sh build` and `/opt/keycloak/bin/kc.sh start --optimized` | PASS |
| PROOF 2 | The fact is ABSENT AFTERWARD in the CONTROL | `control === "[succeeded] #1: [result omitted]"` and it contains neither marker | PASS |
| PROOF 2b | The CONTROL is a strict, information-removing transformation — nothing else changed | the control still contains `[succeeded]` and `[result omitted]`; only the body is gone | PASS |
| PROOF 3 | Restoring the exact safe evidence AT that transformation makes it available afterward | the treatment contains both markers and the source attribution; the reader's line-number gutter is not carried | PASS |
| PROOF 4 | Removing that restoration causes the original RED to recur | the control arm, re-derived from the same canonical payload, is `[succeeded] #1: [result omitted]`; the end-to-end seam then carries the fact | PASS |

## End-to-end ablation

| Projection | Fact in the provider-visible post-compaction working context? |
|---|---|
| CONTROL (pre-repair) | **NO** — the continuation carried only `- run_commands (call_...): succeeded — cat`, an execution status with no fact, and the summary asserted the outputs were omitted |
| TREATMENT (repaired) | **YES** — the continuation carries the fact, attributed to its source path, next to the deterministic `## Verified tool outcomes (canonical record)` section |

## What the ablation does NOT establish

It establishes **necessity for the representation failure**: without the
restoration at that transformation, the fact is absent from the
provider-visible projection; with it, the fact is present.

It does **not** establish that the model's later behaviour was caused by the
omission. That is a separate link, qualified on its own in
`causal-discriminator.md` as `BEHAVIORAL_CAUSE_SUPPORTED` on the strength of
the direct trace (iteration 85's first tool call re-runs
`grep -rn "kc.sh build"`).

## Why the treatment is bounded and safe

| Property | Mechanism | Test |
|---|---|---|
| Bounded | `SOURCE_FILE_FACT_CHAR_LIMIT = 2_000` characters per excerpt; a fixed constant independent of the transcript size | CONTROL 13 |
| Marked when cut | the excerpt carries `...[truncated N chars]` | CONTROL 13 |
| Attributed | the excerpt is prefixed with the source path | PROOF 3 |
| Not arbitrary output | only the source-file read class is carried; a command's stdout is still `[result omitted]` | CONTROL 4, CONTROL 12 |
| Fail-closed on provenance | no success signal, a failure signal, an error flag, a mixed batch, a contradictory result, or an unmatched result yields no fact | CONTROL 1, 2, 3, 8, 9, 10 |
| Not forgeable | the section delimiters inside a carried body are escaped | CONTROL 11 |
| Stable across continuations | the carry-forward replaces the section rather than appending; exactly one section exists | CONTROL 14 |
| Non-mutating | the canonical history is byte-identical before and after | CONTROL 15 |

## Command receipts

```
$ cd sdk/packages/core
$ bunx vitest run --config vitest.config.ts \
    src/extensions/context/compaction.evidence-fidelity01.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)
EXIT=0
```

```
$ bunx vitest run --config vitest.config.ts src/extensions/context/
 Test Files  26 passed | 1 skipped (27)
      Tests  440 passed | 2 skipped (442)
EXIT=0
```

```
$ bun tsc -p tsconfig.dev.json --noEmit | grep -cE '^src/.*error TS'
43
```

43 is the entry-HEAD baseline; the normalized diagnostic sets are identical.
