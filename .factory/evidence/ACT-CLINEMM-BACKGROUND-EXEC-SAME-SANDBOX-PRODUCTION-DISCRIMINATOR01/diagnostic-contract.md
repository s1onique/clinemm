# Diagnostic Contract

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01`
**Diagnostic source head:** `cfd81f35594a759e185da97834923450f4ba8e9b`
**Classification:** `STRUCTURAL`

---

## What the diagnostic is

A **TEMPORARY, DEFAULT_OFF, ONE-SHOT** substitution of a single Seatbelt
profile rule:

```diff
- (allow signal (target self))
+ (allow signal (target same-sandbox))
```

Nothing else about the profile changes.

## Layer 1 — SDK: the private one-shot authorization slot

`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts`

| Symbol | Role |
|---|---|
| `armSeatbeltSignalRuleAuthorization(identity)` | Installs ONE pending authorization. Arming a second REPLACES the first (a stale authorization can never accumulate authority). |
| `clearSeatbeltSignalRuleAuthorization()` | Removes the pending authorization. |
| `getSeatbeltSignalRuleAuthorization()` | Read-only accessor (tests / evidence). |
| `resolveSignalTargetForInvocation(cmd)` | Module-private. Returns `"same-sandbox"` ONLY when an authorization is pending AND the identity matches EXACTLY AND it has not been consumed. **Consumes and revokes the authorization** on a match — before the profile is written — so a single authorization can never widen more than one invocation, even if the profile write later fails. |

Identity match = exact `executable` equality AND exact whole-array `argv`
equality.

`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts`

`generateSeatbeltProfile()` gained an optional `signalTarget` option
(`"self" | "same-sandbox"`). **DEFAULT = `"self"`** → the original
production rule, byte-for-byte.

## Layer 2 — Host: the trusted opt-in gate

`apps/vscode/src/sdk/sandbox-policy.ts`

`resolveSameSandboxDiagnosticOptIn(env)` returns `armed: true` ONLY when
**ALL** of the following hold:

1. `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL` is exactly `"1"` or `"true"`
   (exact match; fail-closed on typos — `"yes"`, `"enabled"`, `"0"` all
   disarm).
2. The Seatbelt experimental sandbox is the active mode
   (`CLINEMM_EXPERIMENTAL_SANDBOX` unset / `""` / `"seatbelt"`).
   `off` → disarmed. An unrecognized value → disarmed (fail-closed).
3. `CLINEMM_RUNTIME_PROFILE` is exactly `"dogfood"` — the closed runtime
   identity. A **public install can never arm this diagnostic**.
4. `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL_COMMAND` is a JSON array
   `[executable, ...argv]` of non-empty strings — the operator states the
   EXACT canonical identity of the ONE fixture the extension host may run.

`armSameSandboxDiagnosticIfOptedIn(env)` installs the authorization when
the gate resolves to `armed: true`; otherwise it is a no-op.

`apps/vscode/src/extension.ts` calls it once, at the **earliest**
activation seam (`activate()`, right after
`configureDogfoodCaptureStorage`), before any command can execute.

## Layer 3 — The barrel export (temporary)

`sdk/packages/core/src/index.ts` re-exports the three functions, in the
SAME shape as the pre-existing `setSeatbeltDiagnosticObserver` diagnostic
precedent. This is **not** a product option, user setting, protocol
field, wire method, or capability variant. The successor ACT deletes it
together with the rest.

## What CANNOT activate the diagnostic

| Attempted activation | Result |
|---|---|
| Command text contains the marker | **CANNOT** — the gate never inspects command text; the SDK matches an exact argv. |
| Command ARGUMENT contains the marker | **CANNOT** — exact whole-array argv match required. |
| Command STDOUT contains the marker | **CANNOT** — stdout is not an input to either gate. |
| The `run_commands` environment contains the marker | **CANNOT** — the gate reads only the extension host's OWN process env. |
| A different executable with the same argv | **CANNOT** — executable is matched exactly. |
| A public (`CLINEMM_RUNTIME_PROFILE=public`) install | **CANNOT** — the dogfood runtime identity is required. |
| The diagnostic env var set, but no exact identity | **CANNOT** — both are required. |
| Two different commands | **CANNOT** — only the exact identity matches; everything else keeps `target self`. |

## What the diagnostic CANNOT do

- It cannot widen the signal authority of an unrelated job.
- It cannot grant filesystem, network, environment, socket or cwd access:
  every one of those rules is byte-identical to the baseline profile.
- It cannot bypass Seatbelt: the command still runs through
  `/usr/bin/sandbox-exec -f <profile>`.
- It cannot change the global singleton's semantics: with no authorization
  installed, `prepare()` produces the original profile bytes.
- It cannot persist: the authorization is revoked on first use.

## Environment contract

The diagnostic flag is read ONLY by the extension host at activation. It
is **NOT** forwarded into the sandboxed child: the materialized
environment is the unchanged `SAFE_ENVIRONMENT_BASELINE` allow-list
(plus `CLINEMM_HOST_HELPER_SOCKET`, which the Seatbelt backend already
adds by existing design). The child therefore cannot observe or
influence the diagnostic.

## Removal inventory (T10)

These are the EXACT temporary changes to delete after the experiment:

| File | Change to remove |
|---|---|
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts` | The `SeatbeltSignalTarget` type, the `signalTarget` option, the `signalRule` variable, and the `signalRule` entry in the `lines` array (restore the literal `"(allow signal (target self))"`). |
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts` | The whole `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01` block: the `SeatbeltSignalRuleAuthorizationIdentity` type, the `SignalRuleAuthorization` type, `pendingSignalRuleAuthorization`, `armSeatbeltSignalRuleAuthorization`, `clearSeatbeltSignalRuleAuthorization`, `getSeatbeltSignalRuleAuthorization`, `resolveSignalTargetForInvocation`, the `signalTarget` resolution line, and the `signalTarget` option passed to `generateSeatbeltProfile`. |
| `sdk/packages/core/src/index.ts` | The temporary `export { armSeatbeltSignalRuleAuthorization, clearSeatbeltSignalRuleAuthorization, getSeatbeltSignalRuleAuthorization, type SeatbeltSignalRuleAuthorizationIdentity }` block. |
| `apps/vscode/src/sdk/sandbox-policy.ts` | The whole `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01` block: `CLINEMM_SAME_SANDBOX_DISCRIMINATOR_MARKER`, `SAME_SANDBOX_DIAGNOSTIC_ENV_VAR`, `SameSandboxDiagnosticOptIn`, `resolveSameSandboxDiagnosticOptIn`, `armSameSandboxDiagnosticIfOptedIn`; plus the `armSeatbeltSignalRuleAuthorization` import and the optional `env` parameter on `resolveExperimentalSandboxMode` (the optional parameter is harmless but belongs to the diagnostic change set). |
| `apps/vscode/src/extension.ts` | The `armSameSandboxDiagnosticIfOptedIn` import and the `armSameSandboxDiagnosticIfOptedIn(process.env)` call. |
| `apps/vscode/src/test/cline-core-vitest-stub.ts` | The three re-exports + the type re-export of the authorization functions. |
| `apps/vscode/tsconfig.json` | The `same-sandbox-production-discriminator01.policy.test.ts` exclusion entry. |
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-same-sandbox-discriminator01.test.ts` | DELETE the file (it asserts the diagnostic exists). |
| `apps/vscode/src/sdk/__tests__/same-sandbox-production-discriminator01.policy.test.ts` | DELETE the file (it asserts the diagnostic exists). |

**Preserve** (safe test fixtures / raw evidence): the probe fixture
`probe-fixtures/same-sandbox-probe.mjs` and everything under `raw/`.

**No intentionally failing test remains in the default suite** — every
test added by this ACT PASSES against the diagnostic build.
