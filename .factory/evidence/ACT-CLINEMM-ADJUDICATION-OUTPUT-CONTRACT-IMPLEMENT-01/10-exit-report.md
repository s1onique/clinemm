# 10 — The exit report

## The verdict

```text
PASS_STRUCTURAL_ONLY
```

The C1 and C2 production-seam tests are GREEN, the security and
conservation gates pass, and the LIVE MODEL RESPONSE measurement achieved
the load-bearing metric — `candidate_accepted = true` with a genuine,
NONEMPTY, runtime-bound evidence reference, in 4 of 16 live runs, with
the candidate surviving the REAL agentic compaction into the persisted
sidecar and the provider-visible request.

The verdict is `PASS_STRUCTURAL_ONLY` and NOT `PASS_LIVE_QUALIFIED`
because **the runtime was NOT INSTALLED**. A GUI-driven live installed run
is not possible on this substrate (the branded VS Code AND the
harness-downloaded VS Code both die with SIGSEGV under the Seatbelt
profile — the same constraint the established precedent
`live-installed-vsix-qualification.tcrr01.mjs` records).

The distinction is recorded honestly rather than blurred:

```text
REAL_MODEL_RESPONSE   MEASURED  16 runs, 4 accepted, compaction boundary observed
LIVE_INSTALLED_RUN    NOT EXECUTED
```

## Why not `HALT_*`

None of the halt conditions applies:

| Halt | Why it does not apply |
|---|---|
| `HALT_EVIDENCE_IDENTITY_UNRESOLVED` | The opaque session-scoped handle resolves EXACTLY, live: `canonical_refs_resolved` was true in 6 of 16 runs, and every accepted run bound a real revision. |
| `HALT_SOURCE_REVISION_UNBOUND` | The runtime bound the revision independently in 4 of 16 runs, from a host-supplied resolver over the workspace's git identity. |
| `HALT_CONTINUITY_UNPROVEN` | The summarizer-omission case passes through the whole production seam, and the ablation proves the implementation is necessary. |
| `HALT_SCOPE_EXPANSION` | No new public tool, provider protocol field, persistence subsystem or cross-session state service. The vocabulary is a host-supplied config input. |
| `HALT_TRUST_BOUNDARY_UNRESOLVED` | The carried representation is CLOSED with runtime-validated values. No arbitrary reasoning, source content or unbounded prose is forwarded. |
| `HALT_RED_NOT_REPRODUCED` | The RED suite reproduced against unchanged production code, and the ablation restored the failures. |
| `HALT_P0` | No correctness, security or evidence-integrity blocker was found. |

## What the ACT changed

```text
C1  A model-published candidate's evidence reference resolves EXACTLY to a
    canonical tool call, through a bounded, opaque, session-scoped handle
    that the model reads on the tool result it already sees. The source
    revision is bound INDEPENDENTLY by the runtime. The task-scoped
    vocabulary is host-supplied.

C2  An accepted candidate survives compaction INDEPENDENTLY of whether the
    summarizer repeats it, as a bounded, closed, deterministic section
    attached to the existing compaction summary.
```

## What the ACT did NOT change

- The historical thinking-only RED: still 5 intentional failures, byte-identical.
- The automatic source-file excerpt carry-forward: still disabled.
- The task contract, the verified-outcome continuity and `MAX_CARRIED_OUTCOMES`.
- The canonical history, the tool-call/result pairing, the provider tool
  schemas and the session isolation.
- The persisted sidecar schema.
- The default agent path: without a host-supplied adjudication contract,
  the prompt, the request and the compaction output are byte-identical.

## The defects this ACT found in its own implementation

Both were found by EXECUTION, not by review, and both were fixed:

1. **The gates short-circuited.** A candidate whose evidence references
   resolved but whose source revision could not be bound reported
   `canonical_refs_resolved: false` — a FALSE report, and the exact
   conflation the predecessor's correction was created to remove. The
   LIVE probe caught it: the first live run reported
   `canonical_refs_resolved: false` with an EMPTY unresolved-reference
   list, which is a contradiction no honest implementation should
   produce. The reference resolution and the revision binding are now
   evaluated independently and each reports its own truth.

2. **The carried section duplicated on a second compaction.** The first
   implementation stripped only the marked block and left the heading
   behind, so the next compaction appended a second section under the
   first heading. The strip now removes the heading together with the
   block, and the projection is byte-stable.

## The next action

The operator must rebuild the SDK and re-package the extension before the
packaged bytes reflect the current source:

```bash
bun run build:sdk
cd apps/vscode && bun run package
```

This is NOT optional: the ACT observed that the extension bundles
`@cline/core` from `sdk/packages/core/dist/` — the COMPILED SDK — and
that the bundle inspected during the ACT still carried the PRE-REFACTOR
implementation, because it had been built before the refactor landed.
A VSIX built from a stale SDK dist would ship the short-circuit gate
reporting.

## The reopen condition

Reopen this ACT when EITHER:

- the runtime is installed on a substrate where the GUI can start, so a
  `LIVE_INSTALLED_RUN` can replace the `REAL_MODEL_RESPONSE`
  classification; OR
- a host supplies an adjudication contract in production, so the
  mechanism is exercised on a real task rather than a synthetic fixture.
