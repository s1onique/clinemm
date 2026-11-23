# 05 — The exit report

## The verdict

    PASS_CORRECTION_PROVENANCE_BOUND

The predecessor's structural continuity result and its 4/16 real-model
acceptance measurement are PRESERVED. This correction closed the three
load-bearing provenance defects the reviewer found and requalified the exact
packaged artifact.

## What was closed

### P0-1 — the source revision is bound AT ACQUISITION

The evaluation-time re-resolution is GONE. The binding reads an
acquisition-time record captured when the evidence was observed, whose
content identity is derived from the bytes the tool RETURNED. The record
rides ON the canonical tool-result block, so it is part of the durable
canonical history.

    bindSourceRevision() no longer resolves anything.

### P0-2 — the evidence authority

The canonical ledger uses the PRODUCTION `classifyToolResultStatus()` rule,
so a result with no affirmative success signal — and one whose structured
payload reports a failure without `is_error` — is not evidence. The source
identity requires an OBSERVATION: the result payload's own `query`
attribution, for a source-observing tool only. A multi-file call binds every
path and fails whole if one file failed.

### P0-3 — the handle continuity across a session recreation

The acquisition records are DURABLE, so a recreated host restores them from
the persisted transcript with no in-memory handover and no workspace re-read.
The handle secret is host-supplied, so a restored session re-derives
identical handles. Without a host secret the registry reports itself NOT
restorable — the fail-closed degraded mode, defined and tested rather than
claimed away.

### P1 — the multi-source compatibility

Compatibility is decided by the WORKSPACE identity (revision + repository +
workspace root); the content identity is validated independently, per
observed source. Two different files at the same revision are compatible.

### The hook ordering

The capture runs on the EFFECTIVE, POST-HOOK result.

### The release-artifact blocker

The SDK was rebuilt, the VSIX repackaged, and the corrected implementation
verified in the VSIX's ACTUAL bundled bytes.

## The measurements

    focused suites (3 files)              82 passed
    context + orchestration + config      919 passed, 2 skipped
    full @cline/core suite vs. baseline    ZERO regressions
                                             (28 pre-existing failing files
                                              identical before and after)
    typecheck                             44 diagnostics (the baseline)
    historical thinking-only RED witness  byte-identical, 5 intentional
                                             failures preserved

## The REDs

    verification/gate1-red-durable-restoration.txt   7 failures
    verification/gate2-red-multi-source-stale.txt    1 failure

Each RED reverts ONLY the defect under test, keeping everything else fixed,
so it isolates that defect exactly.

## What was NOT claimed

- Behavioural improvement — whether ClineMM investigates less after
  compaction — is NOT established by this ACT.
- The predecessor's three whitespace findings and the stale gate-summary
  binding remain P2, NON-BLOCKING.
- A LIVE INSTALLED RUN was not performed: a GUI-driven installed run is not
  possible on this substrate, exactly as the predecessor recorded.

## The files

Production:

    sdk/packages/shared/src/llms/messages.ts        the persisted record type
    sdk/packages/shared/src/agent.ts                  the agent-part carrier
    sdk/packages/shared/src/agents/types.ts           the host-supplied contract
    sdk/packages/shared/src/index.ts                  the export
    sdk/packages/core/src/extensions/context/adjudication-continuity.ts
    sdk/packages/core/src/extensions/context/evidence-continuity.ts
    sdk/packages/core/src/extensions/context/compaction.ts
    sdk/packages/core/src/runtime/config/agent-message-codec.ts
    sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
    sdk/packages/core/src/runtime/host/local-runtime-host.ts
    sdk/packages/core/src/types/adjudication-config.ts
    sdk/packages/core/src/index.ts

Tests:

    sdk/packages/core/src/extensions/context/compaction.adjudication-provenance.correction01.test.ts
    sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.adjudication-acquisition.correction01.test.ts
    sdk/packages/core/src/extensions/context/compaction.adjudication-output-contract.implement01.test.ts
                                                       (updated to the corrected
                                                        contract)
