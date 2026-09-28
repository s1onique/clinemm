# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01 — Final Report

```text
ACT=ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01
VERDICT=PENDING_LIVE_RUN

ENTRY_HEAD=27868d9f1214e099bd444101f1c8ef8ed3869de9
IMPLEMENTATION_HEAD=UNCOMMITTED (27868d9f1 + 4 modified files + 2 new ACT docs)
DOGFOOD_SOURCE_HEAD=UNBUILT (build gate is the next step)

DIAGNOSTICS_DEFAULT_OFF=true
PRODUCTION_SEMANTICS_CHANGED=false
MYC_CODE_CHANGED=false

LIVE_SESSION_ID=PENDING (operator-driven)
LIVE_RUN_ID=PENDING
LIVE_ITERATION=1

BEFOREMODEL_ENTER_PRESENT=PENDING
BEFOREMODEL_ENTER_SESSION_ID=PENDING
BEFOREMODEL_ENTER_ITERATION=PENDING

LOOKUP_ATTEMPTED=PENDING
LOOKUP_KEY=PENDING
RECORDED_PRIME_FOUND=PENDING
RECORDED_PRIME_SESSION_ID=PENDING
RECORDED_PRIME_STATUS=PENDING

INJECTION_ATTEMPTED=PENDING
INJECTION_RESULT=PENDING
INJECTION_REASON=PENDING
PACKET_BYTES=PENDING

PROVIDER_CAPTURE_PRESENT=PENDING
PROVIDER_CAPTURE_ID=PENDING
PROVIDER_CAPTURE_SESSION_ID=PENDING
PROVIDER_CAPTURE_ITERATION=PENDING
PROVIDER_PRIME_PACKET_COUNT=PENDING

FIRST_DIVERGENCE=PENDING
BOUNDARY_CLASSIFICATION=PENDING

REAL_LIVE_RED_PREDECESSOR=PRESENT (1790604494785_8zlsd, run_PdCFt9iX)
SYNTHETIC_REAL_PREDECESSOR=GREEN_4_OF_4

TYPECHECK=GREEN (apps/vscode tsc --noEmit, 0 errors)
VSCODE_PREPUBLISH=PENDING (next step)
DIFF_CHECK=GREEN (git diff --check)

PRODUCTION_PATCH_APPLIED=false
READY_FOR_REPAIR_ACT=PENDING
```

## What this ACT did

1. Added **two new default-off diagnostic observation points** to the
   pre-existing `myc-prime-live-diag` surface:
   - `recordMycPrimeLiveBind(sessionId)` — fires at `buildAgentHooks`
     time; proves the runtime was given a hook bag for the canonical
     host sessionId.
   - `recordMycPrimeLiveEnter(hostSessionId, snapshotSessionId,
     iteration)` — fires at the very top of `beforeModel` body
     (before any short-circuit); proves the runtime invoked
     `beforeModel`.

2. Extended the existing `recordMycPrimeLiveLookup` with a
   `lookupKey` field — captures the actual key the production
   lookup was issued against so a post-capture join can tell
   `snapshot.sessionId` lookups from `conversationId` fallbacks
   (Case B discriminator).

3. Updated `startMycPrimeLiveDiag` to preserve the structural
   `bind`/`enter` fields across a re-start — without this, the
   `runMycPrimeOnSessionStart` call (which calls
   `startMycPrimeLiveDiag`) would clobber the BIND event recorded
   at `buildAgentHooks` time.

4. Added the 5 LBC-01..LBC-05 diagnostic-correctness tests
   (per ACT §9) to `myc-prime-live-diag.test.ts`.

5. Wired the new observations into the production call sites:
   - `hooks-adapter.ts:170-172` (BIND inside `buildAgentHooks`)
   - `hooks-adapter.ts:232-235` (ENTER at top of `beforeModel`)
   - `hooks-adapter.ts:258` / `:289` / `:327` (lookupKey in
     `recordMycPrimeLiveLookup` call sites)
   - `sdk-session-config-builder.ts:36-41` (passes
     `config.sessionId` as `bindSessionId`)

## What this ACT did NOT do

- Did NOT modify production semantics. The off-path is bit-identical
  to the pre-ACT path; LBC-01 proves this with a hard assertion.
- Did NOT add a new env flag. Reused the existing
  `CLINEMM_MYC_PRIME_DIAG` env var + the central dogfood profile
  resolver.
- Did NOT redesign the existing diagnostic surface. Extended it
  minimally to carry the new observations.
- Did NOT build a synthetic RED reproduction. The predecessor's
  RED is REAL and on disk; the next ACT acquires LIVE evidence.
- Did NOT build a dogfood VSIX. The build is the next step in the
  §11 / §12 contract.

## Conservation results

```text
myc-prime-live-diag.test.ts                                  19/19 GREEN (14 pre-existing + 5 LBC)
myc-prime-auto-injection01.api01-red.c24-c-bridge.test.ts     4/4   GREEN
myc-prime-automation.identity-join.red.c24-c-bridge.test.ts  2/2   GREEN
dogfood-diagnostic-profile-myc-clinemm01.test.ts            39/39  GREEN
sdk-session-config-builder.test.ts                            3/3   GREEN
hooks-adapter.test.ts                                         (covered by base config)
apps/vscode tsc --noEmit                                      0 errors
git diff --check                                              clean
```

Pre-existing drift (independent of this ACT, verified by
`git stash` + re-run on the predecessor commit):

```text
turn-state-writer-provenance.wprov.test.ts WPROV07.1         1 failed (predecessor commit)
```

## Successor

The LIVE-typed observation acquisition is the responsibility of the
next ACT. The exact recipe is in §11-§17 of the ACT document. The
operator recipe for capturing MYC_SESSION_ID and the diagnostic
event trace is in §15-§16.

No production patch is attempted in this ACT. No second review
loop unless the evidence exposes a new P0.

## Files

- **modified** `apps/vscode/src/sdk/myc-prime-live-diag.ts` — two new recorders + one field extension + structural preservation in `startMycPrimeLiveDiag` + writeable internal type
- **modified** `apps/vscode/src/sdk/hooks-adapter.ts` — wiring at four observation points
- **modified** `apps/vscode/src/sdk/sdk-session-config-builder.ts` — pass `config.sessionId` to `buildAgentHooks`
- **modified** `apps/vscode/src/sdk/__tests__/myc-prime-live-diag.test.ts` — 5 LBC tests + 2 new imports
- **new** `.factory/acts/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01.md`
- **new** `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01/00-recon.md`
- **new** `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01/01-discriminator.md`
- **new** `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01/10-final-report.md`
- **new** `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01/result.json`

Total production source delta: 3 files modified (within §8 budget
of 1–3 files).
