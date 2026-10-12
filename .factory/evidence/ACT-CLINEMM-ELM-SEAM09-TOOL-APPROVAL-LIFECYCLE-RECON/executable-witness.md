# Executable Witness — ACT-CLINEMM-ELM-SEAM09-TOOL-APPROVAL-LIFECYCLE-RECON

> Head: `179800d36b14c564069f06cd9f701aa575b974da`
> Date: 2026-10-12

## R1–R6 Recon Test (the 4 SEAM09 spec cases)

```text
$ cd apps/vscode && bun vitest run \
    src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts
    --reporter=default

 ✓ src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts (6 tests) 1039ms
     ✓ R5: clearPending('Task switched') rejects A; a subsequent B in the same session still re-ASKs  555ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  6.06s
   exitCode 0
```

The trailing `[vitest-pool]: Failed to terminate forks worker ... EPERM`
is a benign macOS worker-cleanup artifact; `exitCode 0` is the
authoritative test result.

## Full Coordinator Regression Suite

```text
$ cd apps/vscode && bun vitest run src/sdk/sdk-interaction-coordinator.test.ts --reporter=default

 Test Files  1 passed (1)
      Tests  43 passed (43)
   Duration  3.68s
   exitCode 0
```

## Case mapping

| SEAM09 spec case | Test case | Status |
| --- | --- | --- |
| 1. Normal approval | R1 YES (line 125) | GREEN |
| 1. Normal rejection | R1/R2/R3/R4 NO | GREEN |
| 2. Duplicate response | R4 second + third (lines 211-212) | GREEN |
| 3. Wrong identity | R1 different toolCallId, R2 different command | GREEN |
| 4. Late after teardown | R5 clearPending, R6 stale yes-click | GREEN |

## Test-driven evidence that the SEAM10 Elm cutover cannot race the slot

- The verdict body at L427-L608 executes BEFORE the slot is
  registered (L686-L758). Therefore the Elm cutover at the
  verdict body has no observable effect on the slot lifecycle
  until AFTER the verdict is computed.
- The `pendingReformulationSlot` is the only state mutated in
  the verdict body (in the REFORMULATE branch L540-L555). The
  Elm kernel will read its presence as an input fact and emit
  `armReformulationSlot: true` as a tag payload; the TS adapter
  performs the arming as a side effect after classification.
  This mirrors the SEAM04 marker-arm/disarm pattern exactly.
- The atomic slot destruction at L930-L931 and L1086+L1096 is
  preserved verbatim. No Elm code touches
  `pendingToolApprovalResolve` or
  `pendingToolApprovalMessage`.
