# Executable Witness — ACT-CLINEMM-ELM-SEAM10-INTEROP-DISC

> Head: `ff80cddbf92a4e9b834fe75359d17e64a687949b` (SEAM09 commit)
> Date: 2026-10-12

## TPAEID01 discriminator (11/11 PASS, exitCode 0)

```text
$ cd apps/vscode && bun vitest run \
    src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts \
    --reporter=default

 ✓ src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts (11 tests) 65ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
   exitCode 0
```

The trailing `[vitest-pool]: Failed to terminate forks worker ...
EPERM: operation not permitted, kill` and `[vitest-pool]: Timeout
terminating forks worker ...` are benign macOS worker-cleanup
artifacts; `exitCode 0` is the authoritative test result.

## Cross-regression (60/60 PASS, exitCode 0)

```text
$ cd apps/vscode && bun vitest run \
    src/sdk/sdk-interaction-coordinator.test.ts \
    src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts \
    src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts \
    --reporter=default

 ✓ src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts (11 tests) 62ms
 ✓ src/sdk/sdk-interaction-coordinator.test.ts (43 tests) 1216ms
 ✓ src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts (6 tests) 593ms
 Test Files  3 passed (3)
      Tests  60 passed (60)
   exitCode 0
```

## TypeScript typecheck (0 errors, exitCode 0)

```text
$ cd apps/vscode && bun --bun tsc --noEmit

exitCode=0
0 errors
```

## TPAEID-10 disposition (recorded by the harness)

```text
disposition: NOT_A_GOOD_ELM_SEAM
reasons:
  - TPAEID-01: Platform.worker is fundamentally async; the SEAM09
    'synchronous verdict' claim is unsupportable.
  - TPAEID-02: TOCTOU window is non-zero; the verdict commits at
    T1 > T0; the cutover needs an explicit snapshot/revalidate
    boundary.
  - TPAEID-06: 3 of the 9 VerdictTags (ALLOW_SDK_POLICY,
    ALLOW_HOST_CALLBACK, REFORMULATE) carry an evidence-loss
    hazard; the TS adapter would re-run the host policy lattice
    to reconstruct the evidence.
  - TPAEID-08: the host's evaluateCommandToolApproval already
    returns full evidence; the Elm VerdictTag is a strict loss
    unless the kernel carries the full evidence payload through
    the wire (which contradicts the 'pure projection' framing).
  - TPAEID-09: the REFORMULATE tag is an indirect side effect via
    a class field; the SEAM04 'kernel classifies, TS commits'
    pattern does not apply.
  - MIRRORS SEAM06: the verdict body is too small and too
    synchronous to justify an Elm kernel; safe integration costs
    more than the policy migration is worth.
```

## What each discriminator family proves

| ID | What it proves | How it proves it | Verdict |
|---|---|---|---|
| TPAEID-01 | Synchronous-impossibility | Microtask race against the real `consultDeferredCompletionBarrierElmKernel` async bridge. The Promise stays pending through one event-loop tick. | CONFIRMED |
| TPAEID-02 | TOCTOU window is non-zero | Wall-clock measurement: `tPromiseResolved > tPromiseStarted` strictly. | CONFIRMED |
| TPAEID-03 | Fail-closed on `kernel_offline` | Sentinel `invokeForProduction` returns `{ kind: "kernel_offline", classification: ... }`. The consult surfaces `kind: "kernel_offline"`, not `directive`. | PASS |
| TPAEID-04 | Fail-closed on `decode_error` | Sentinel invoke returns `{ kind: "decode_error", reason: "verdict tag is unknown_kind; ...", classification: ... }`. The consult surfaces `kind: "decode_error"`, not `directive`. | PASS |
| TPAEID-05 | Fail-closed on `response_timeout` | Sentinel invoke returns `new Promise<never>(() => {})` (hangs forever). The public-boundary `responseTimeoutMs: 50` trips the `no_response` classification. The consult surfaces `{ kind: "decode_error", reason: "no_response: ..." }`. | PASS |
| TPAEID-06 | Evidence-loss hazard | Static enumeration: 3 of 9 `VerdictTag`s have a per-tag evidence payload that the tag alone cannot round-trip. | CONFIRMED |
| TPAEID-07 | LoC delta | Acknowledged as deferred to the next ACT (out of scope for the discriminator). | DEFERRED |
| TPAEID-08 | Existing-await-boundary economics | Static comparison: `hostEvidenceFields.length=5` vs `verdictTagFields.length=1`. The Elm verdict is a strict loss. | CONFIRMED |
| TPAEID-09 | Reformulation side-channel | Static: `REFORMULATE` requires class-field mutation at L522. The Elm kernel cannot perform it. | CONFIRMED |
| TPAEID-10 | Disposition harness | The disposition is one of `{GO_SEAM10, NOT_A_GOOD_ELM_SEAM, HALT_APPROVAL_AUTHORITY_UNSAFE}`. | RECORDED |
| auxiliary | Tag enumeration | The 9 `VerdictTag`s are exactly as the SEAM09 frozen contract defines. 4 of 9 are permissive-if-defaulted. | DOCUMENTED |
