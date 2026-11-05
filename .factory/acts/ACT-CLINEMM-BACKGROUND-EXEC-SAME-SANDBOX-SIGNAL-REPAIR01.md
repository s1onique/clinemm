# ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01

**Class:** ACT — bounded permanent production repair
**Successor to:** `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01`
**Selected architecture:** `SELECT_SEATBELT_SIGNAL_REPAIR` (C1: GO)

---

## Mission

Close the macOS child-signalling defect in the ClineMM Background Exec
seatbelt profile, preserve the causal evidence, remove the temporary
diagnostic, and qualify the repair at the real production seam.

## Authority

The predecessor ACT closed its production discriminator with
`SELECT_SEATBELT_SIGNAL_REPAIR`: the live production measurement showed
that `(allow signal (target same-sandbox))` permits a Background Exec
workload to terminate a child it spawned, while the original
`(allow signal (target self))` denied the same signal with `EPERM`.

## Scope of the repair

EXACTLY ONE profile line changes, permanently and unconditionally:

```diff
- (allow signal (target self))
+ (allow signal (target same-sandbox))
```

Everything else is conserved: filesystem read/write grants, network
grants, environment materialization, socket rules, cwd, and the
`/usr/bin/sandbox-exec -f <profile>` launch path are byte-for-byte
unchanged.

## Removal inventory (executed)

| File | Change |
|---|---|
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts` | `SeatbeltSignalTarget` type, the `signalTarget` option, and the `signalRule` selector removed; the permanent rule is now an inline constant. |
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts` | The entire one-shot authorization block removed: `SeatbeltSignalRuleAuthorizationIdentity`, `SignalRuleAuthorization`, `pendingSignalRuleAuthorization`, `armSeatbeltSignalRuleAuthorization`, `clearSeatbeltSignalRuleAuthorization`, `getSeatbeltSignalRuleAuthorization`, `resolveSignalTargetForInvocation`, and the `signalTarget` option passed to `generateSeatbeltProfile`. |
| `sdk/packages/core/src/index.ts` | The temporary barrel export removed. |
| `apps/vscode/src/sdk/sandbox-policy.ts` | The entire `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL` / `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL_COMMAND` gate removed, together with the `armSeatbeltSignalRuleAuthorization` import. |
| `apps/vscode/src/extension.ts` | The `armSameSandboxDiagnosticIfOptedIn` import and its activation-time call removed. |
| `apps/vscode/src/test/cline-core-vitest-stub.ts` | The authorization re-exports and the type re-export removed. |
| `apps/vscode/tsconfig.json` | The test-only exclusion entry removed. |
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-same-sandbox-discriminator01.test.ts` | DELETED (asserted the diagnostic exists). |
| `apps/vscode/src/sdk/__tests__/same-sandbox-production-discriminator01.policy.test.ts` | DELETED (asserted the diagnostic exists). |

**Preserved:** the probe fixture
`.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01/probe-fixtures/same-sandbox-probe.mjs`
and every raw evidence artifact.

## New tests

`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-same-sandbox-signal-repair01.test.ts`
covers the permanent rule (R1), the removal of the diagnostic surface
(R2), one-line conservation (R3), signal-scope conservation (R4), no
sandbox bypass (R5), foreign-process denial (R6), idempotence (R7), and
the unchanged read-only observer seam (R9).

## Load-bearing limitation

`same-sandbox` is a SANDBOX-SCOPED permission, not an ownership-token
check. It permits signalling any process in the SAME sandbox session; it
does NOT prove the target is a descendant of the caller. The existing
host-helper ownership protections (`process-group.register-owned` /
`process-group.terminate-owned`) are UNCHANGED and remain the authority
for terminating owned processes outside this sandbox.

A successful `kill(childPid)` does NOT prove successful `kill(-pgid)` or
complete descendant cleanup. Those are qualified separately.
