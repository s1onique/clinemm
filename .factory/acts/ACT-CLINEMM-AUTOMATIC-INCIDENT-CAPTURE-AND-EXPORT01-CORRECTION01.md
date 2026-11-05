# ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01

> Status: CLOSED (P0 EVIDENCE-PROVENANCE CORRECTION + one non-blocking P1)
> Owner: EPIC-CLINEMM-TRACE-AND-ACCEPTANCE-EVIDENCE
> Cluster: INCIDENT_EVIDENCE_PROVENANCE
> Predecessor: ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
> Predecessor verdict: HALT_EVIDENCE_PROVENANCE_INTEGRITY

## Mission (verbatim from this correction's launch)

One bounded correction for the four P0 evidence-provenance defects and the
one non-blocking P1 raised against AICE01. Exactly these repairs:

1. Publication identity and ordering: bind reconciliation to the original
   owner/job; capture actual success or failure after the controller
   publication boundary.
2. Evidence semantics: advance coverage only on the corresponding observed
   production stage. Fix the reconciliation `stage` mapping and prevent
   duplication of joined records.
3. Source-bound export: read real CFPR01 provenance. Require an executable
   test that inspects the resulting ZIP and proves the original blocking-job
   evidence is present.
4. Durability: persist terminal reconciliation observations, handle
   `{ succeeded: false }`, and prevent an older persisted revision from
   replacing a newer in-memory snapshot during export.

The non-blocking P1: explicit public-user opt-in to detailed diagnostics
currently does not arm the reconciliation sink, because
`applyReconciliationDiagnosticCaptureProfile()` considers only `isDogfood`.

No extra process probes, no completion-state changes, no new telemetry
subsystem.

## What changed

| File | Change |
| ---- | ------ |
| `apps/vscode/src/sdk/automatic-incident-capture.ts` | P0-1 owner/job resolver; P0-2 coverage semantics + `stage` mapping + no duplication; P0-4 durability hook |
| `apps/vscode/src/sdk/automatic-incident-containment-provenance.ts` | **NEW** — P0-3 source-bound CFPR01 reader |
| `apps/vscode/src/sdk/automatic-incident-export-runtime.ts` | P0-3 real provenance join; P0-4 revision guard |
| `apps/vscode/src/sdk/automatic-incident-export.ts` | P0-1/P0-2 export allowlist additions |
| `apps/vscode/src/sdk/SdkController.ts` | P0-1 publication ordering + identity; P0-4 `{ succeeded: false }` |
| `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` | P1 public opt-in arms the reconciliation sink |
| `apps/vscode/src/extension.ts` | P1 wiring; P0-4 durability hook installation |
| `apps/vscode/src/sdk/__tests__/automatic-incident-correction01.aice01.test.ts` | **NEW** — 26 GREEN assertions |

## Banned-list audit

- No new process probe, signal, or shell inspection — RESPECTED.
- No completion-state change — RESPECTED.
- No new telemetry subsystem — RESPECTED (the durability hook is a
  persistence seam on the EXISTING incident manager, not a telemetry
  subsystem).
- No new dependency — RESPECTED (`archiver` was already declared).
- No env-var override matrix — RESPECTED (the P1 uses the EXISTING
  persisted user setting).
- No extra process probes in the tests — RESPECTED (the P0-3 test
  decompresses a ZIP with the OS `unzip`; it does not probe a process).

## Evidence

- `docs/acts/ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01/CORRECTION01.md`
- `docs/acts/ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01/evidence/red-reproduction-correction01.txt`
- `docs/acts/ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01/evidence/verification-correction01.txt`

## Verdict (machine-readable)

```
P0_EVIDENCE_PROVENANCE_CORRECTION = CLOSED
P1_PUBLIC_OPTIN_RECONCILIATION    = CLOSED
PRODUCTION_SEMANTIC_DELTA          = NONE (diagnostic evidence semantics only)
LIVE_VSCODIUM_QUALIFICATION       = PENDING (operator step after the commit)
HALT                              = NO
```
