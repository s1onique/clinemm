# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01 — Discriminator

## Summary

This ACT is **evidence-acquisition only**. It does not repair the
predecessor's LIVE RED. Its sole purpose is to add the four
default-off diagnostic observation points that the §17 discriminator
tree requires, and to leave the diagnostic surface ready for the
operator-driven live dogfood run that will identify the first
production-only divergence.

## Evidence classification

The four diagnostic observation points added by this ACT are:

| Event | Classification | Notes |
|-------|----------------|-------|
| `myc_beforemodel_enter` | SYNTHETIC_REAL | Tested in `myc-prime-live-diag.test.ts` LBC-02/03/05 against the REAL `buildAgentHooks` + REAL `beforeModel` body. Production wiring at `hooks-adapter.ts:219-236`. |
| `myc_beforemodel_lookup` | SYNTHETIC_REAL (extended) | Pre-existing observation extended with `lookupKey`. Tested in LBC-02/03/05. |
| `myc_beforemodel_exit` | SYNTHETIC_REAL (pre-existing) | The pre-existing `recordMycPrimeLiveInjection` already captures `injected`, `reason`, `packetBytes`, `iteration` — these are the "exit" semantics. No new recorder. |
| `myc_provider_capture_binding` | SYNTHETIC_REAL (pre-existing) | The pre-existing `recordMycPrimeLiveCapture` already stamps `captureId` and records `aiSdkPromptObserved`. No new recorder. |

The LIVE RED classification remains REAL and is preserved as input
evidence (frozen in `result.json`). The successor ACT
`ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01` will
acquire the LIVE-typed observation by running a clean
installed-Codium dogfood session with diagnostics enabled.

## The four cases the new observations discriminate

| Case | Detection |
|------|-----------|
| A: PRODUCTION_HOOK_ASSEMBLY_OR_INSTALLATION | `entry.bind` is undefined for the captured host sessionId |
| B: PRODUCTION_RUNTIME_SESSION_IDENTITY | `entry.bind?.sessionId === S` AND `entry.enter?.sessionId !== S` |
| C: PRIME_RECORDER_LIFETIME_OR_INSTANCE | `entry.enter?.sessionId === S` AND `entry.lookup.recordedPrimeFound === false` |
| D: PRIME_INJECTION_GUARD | `entry.injection.injected === false` AND `entry.injection.reason` narrows the branch |
| E: POST_HOOK_REQUEST_COMPOSITION_LOSS | `entry.injection.injected === true` AND on-disk provider capture has 0 prime packets |
| F: NOT_REPRODUCED_LIVE | `entry.injection.injected === true` AND on-disk provider capture has 1 prime packet |

## Why the existing surface was sufficient — almost

`myc_beforemodel_exit` (i.e. `injection.injected` + `reason` +
`packetBytes`) and `myc_provider_capture_binding` (i.e.
`capture.captureId` + `aiSdkPromptObserved`) were already captured
by the ACT-MYC-CLINEMM03-LIVE-DIAG01 work. The two NEW observations
(`bind` and `enter`) are necessary because the predecessor evidence
left two ambiguities open:

- Was a hook bag EVER given to the runtime, or was the runtime
  configured without one? (`bind` resolves this.)
- Did the runtime actually CALL the hook body even if the body
  short-circuited on `iteration>1` or missing sessionId? (`enter`
  resolves this — `enter` fires before any short-circuit, so an
  empty body trace is unambiguous evidence that the hook was never
  invoked.)

The `lookupKey` extension is necessary because the existing
`recordMycPrimeLiveLookup` only captured the boolean predicate
results, not the actual key the lookup was issued against. Without
the key, Case B (key mismatch between bind sessionId and the runtime
sessionId) cannot be distinguished from Case C (correct key,
recorder miss).

## Why a one-file diagnostic-surface change was sufficient

The central dogfood profile resolver
(`dogfood-diagnostic-profile.ts#applyMycPrimeLiveDiagDiagnosticProfile`)
already arms the M (myc-prime-live-diag) knob at extension activation
when `isDogfood === true`. No new env flag was needed. The
`_MycPrimeLiveDiagEntry` writeable-internal-type was introduced
inside the diagnostic module so the new `bind` and `enter` fields
can be assigned without violating the public readonly type. The
`startMycPrimeLiveDiag` re-start semantics were extended to
preserve the structural `bind`/`enter` fields across a re-start
(otherwise the BIND event would be clobbered by every
`runMycPrimeOnSessionStart` call, since that is where
`startMycPrimeLiveDiag` is invoked in production).

## Why the production semantics are bit-identical when disabled

LBC-01 (in `myc-prime-live-diag.test.ts`) proves that with
`CLINEMM_MYC_PRIME_DIAG` unset and the module seam not armed:

- `buildAgentHooks(..., "hs-test")` returns a hook bag bit-identical
  to the pre-ACT path: the BIND recorder short-circuits on the
  first `isMycPrimeLiveDiagEnabled()` check and produces zero state
  writes.
- `beforeModel(ctx)` short-circuits the ENTER recorder for the same
  reason; the off-path behavior (prime packet injection when the
  recorder singleton is populated, no injection otherwise) is
  bit-identical to the pre-ACT path.

The pre-existing `D9.a` test ("env flag unset → disabled") continues
to pass and now also covers the new BIND / ENTER recorders.
