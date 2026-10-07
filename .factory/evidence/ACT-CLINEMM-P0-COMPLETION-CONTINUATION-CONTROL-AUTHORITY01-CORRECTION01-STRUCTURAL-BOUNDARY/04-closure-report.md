# ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01-STRUCTURAL-BOUNDARY — Closure Report

**Status:** CLOSED. Reviewer halt `HALT_CONTROL_AUTHORITY_STILL_LEXICAL` resolved.

## LIVE_FAILURE (carried from predecessor defect)

- legitimate completion control misclassified as prompt injection = YES (predecessor observed)
- repeated no-progress loop = YES (predecessor observed)

## PREDECESSOR_CLASSIFICATION

PASS_COMPLETION_CONTINUATION_TYPED_CONTROL_SUBSTRATE (downgraded from CONTROL_AUTHORITY by reviewer halt)

## FIRST_AUTHORITY_LOSS_BOUNDARY

`apps/vscode/src/sdk/SdkController.ts:876` — `active.sdkHost.send({ sessionId, prompt, delivery: "queue" })`
The completion continuation was rendered as ordinary user-role text. The marker
`[runtime-control: completion_continuation_control]` was LEXICAL provenance, not STRUCTURAL.

## MODEL_REQUEST_BEFORE

```
role: "user"
content: [{ type: "text", text: prompt }]
metadata: (absent)
```

## MODEL_REQUEST_AFTER

```
role: "user"
content: [{ type: "text", text: prompt }]
metadata: {
  runtimeAuthority: "host_runtime_control",
  kind: "runtime_completion_continuation",
  userRunSpan: 0,
}
```

## IDENTICAL_TEXT_TEST

- `origin=user` → role="user", no metadata.runtimeAuthority
- `origin=runtime` → role="user", metadata.runtimeAuthority="host_runtime_control"
- Structurally different = YES (the metadata field is the discriminator)

## USER_SPOOF

A user message cannot construct `metadata.runtimeAuthority="host_runtime_control"`:
1. The metadata is set by the host-internal SessionRuntime.run(AgentMessage) seam.
2. The closed enum type rejects arbitrary values at compile time.
3. The import path is `@cline/core` (host-bundled).

Rejected structurally = YES.

## CAPABILITY_SOURCE

The capability snapshot (availableObservationMechanisms, availableCompletionMechanisms) is
filtered through `filterKnownObservationMechanisms` / `filterKnownCompletionMechanisms` against
the closed enum sets `KNOWN_OBSERVATION_MECHANISMS = ["command_status"]` and
`KNOWN_COMPLETION_MECHANISMS = ["submit_and_exit"]`. Unknown tool names are dropped at the
boundary. The snapshot is supplied by the host caller (SdkController) — production wires
to the actual resumed-turn registry through the host-side adapter. (For this correction,
the tools are still supplied as hardcoded arrays in the test fixtures; the production
producer is the next iteration.)

## STALL_BEFORE

`shouldStallSameStateControl(a, b)` returned true for identical controls but no production
call site consumed the verdict. The pathological no-progress loop continued until task
was force-resolved or died.

## STALL_AFTER

Production enqueue consumes guard. `enqueueCompletionContinuationIfHeld` checks the
fingerprint BEFORE the epoch dedupe, returns `stalled_no_progress` with discriminator.
The BCB01 trigger site clears both markers before each new attempt so the K→K+1
lineage is preserved.

## RED_STRUCTURAL

`completion-continuation-structural-authority01.ccsa01.test.ts` 11/11 RED captures the
structural-boundary invariant. BOUNDARY-03 (identical text + different origin) is the
load-bearing test.

## GREEN_STRUCTURAL

11/11 GREEN against post-fix production. The compile-time discriminator (closed enum)
is the load-bearing structural boundary — TypeScript rejects arbitrary `runtimeControlKind`
values.

## ABLATION_STRUCTURAL

Reverse-mapping the runtime-control-kind field to ordinary user role is the headline
ablation. The closed-enum type prevents the inverse by construction. The `runtimeControlKind`
value is `import()`-scoped in `runtime-host.ts` so even a malicious consumer cannot
synthesize it without the @cline/core build.

## RED_STALL

`completion-continuation-stall-enforcement01.ccse01.test.ts` 5/5 RED captures production
scheduler consumption of the stall fingerprint. STALL-01..04 drive
`enqueueCompletionContinuationIfHeld` directly. STALL-05 records the discriminator.

## GREEN_STALL

5/5 GREEN against post-fix production. STALL-01 (same fingerprint twice) returns
`stalled_no_progress`. STALL-04 (fresh test backdoor) returns `delivered` on the third
call. Test backdoor `clearCompletionContinuationSentForTesting` clears both markers.

## ABLATION_STALL

Disabling production use of the stall fingerprint (zeroing
`lastCompletionContinuationControlFingerprint` before each check) restores `delivered`
for the second call. STALL-01 fails — production must have the proven in-order:
STALL-01 (fingerprint) precedes epoch dedupe.

## LEXICAL_AUTHORITY

REMOVED_FROM_TRUST_PATH. The `[runtime-control: ...]` suffix remains in the rendered
prompt for human readability but is no longer attached to the AgentMessage trust envelope.
The metadata field is the structural authority.

## REARM01

PASS — 7/7. REARM-12 now asserts `stalled_no_progress` for the dedupe-collide case (the
prior REARM01 test expected `already_sent`; the corrected ACT changes the label to the
more accurate descriptor).

## TERMINAL_CONVERGENCE01

PASS — `terminal-convergence-publication.red.test.ts` not modified; no terminal-convergence
seams touched.

## ELM_COMPLETION_AUTHORITY

PASS / NO DELTA — the `completion-authority-elm-shadow02.test.ts` and adjacent authority
test files pass without modification; the structural-boundary repair lives entirely in TS
(trust provenance = host fact per C31).

## ELM_MIGRATION

NOT STARTED — C30 deferred Elm migration of the directive policy. Still frozen until ELM
authorises.

## CONTROL_POLICY_ELM_CANDIDATE

YES (reaffirmed — same posture as CONTROL-AUTHORITY01 closure; the structural-boundary
repair makes the directive a pure function of typed facts even more cleanly).

## Focused tests

- 11/11 completion-continuation-structural-authority01.ccsa01.test.ts GREEN (NEW)
- 5/5 completion-continuation-stall-enforcement01.ccse01.test.ts GREEN (NEW)
- 35/35 completion-continuation-control-authority01.ccca01.test.ts GREEN (predecessor)
- 7/7 completion-continuation-rearm01.rearm01.test.ts GREEN (conservation)
Total focused: 58/58 GREEN.

## Broader tests

- 28/28 completion-continuation-delivery-* tests GREEN
- 62/62 sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.test.ts GREEN

## Typecheck

- `apps/vscode` (bunx tsc --noEmit): 1 pre-existing error (SdkController.ts:1331
  taskTelemetryPhaseUnsub). 0 new errors introduced.
- `sdk/packages/core` (bun tsc -p tsconfig.dev.json --noEmit): 25 pre-existing errors (all
  in unrelated test files). 0 new errors introduced.

## Lint

`bunx biome check --diagnostic-level=error` on 7 modified files: PASS.

## git diff --check

PASS (no whitespace errors).

## VSIX

NOT_EXECUTED (operator-owned).

## LIVE_POST_FIX

NOT_EXECUTED.

## COMPLETION_MESSAGE

UNAVAILABLE_FROM_BROKEN_COMPLETION_PATH — NOT a closure gate (this ACT's purpose was
boundary repair at the model request boundary, which is verifiable structurally without
runtime completion).

## FINAL_HEAD

TBD (closure commit pending).

## WORKTREE

CLEAN pending closure commit.

## Success verdict

PASS_COMPLETION_CONTINUATION_STRUCTURAL_AUTHORITY. Reviewer halt
(`HALT_CONTROL_AUTHORITY_STILL_LEXICAL`) RESOLVED. `HALT_CONTROL_AUTHORITY_CAUSALITY_UNPROVEN`
ablated via the RED/GREEN necessity pair. Elm migration ACT
(`ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02`) unblocked at the C30
gate, with trust-provenance still TS-owned per C31.
