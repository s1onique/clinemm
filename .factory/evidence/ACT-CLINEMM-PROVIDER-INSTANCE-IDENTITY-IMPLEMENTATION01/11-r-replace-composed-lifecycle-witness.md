# 11 — R-REPLACE Composed Lifecycle Witness (Hundred-and-second-pass, ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01)

Author: ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01, hundred-and-second-pass
Date: 2026-09-06
Reviewer: fourteenth reviewer (C1: "GO TO R-REPLACE") on commit 50623cf39 (hundred-and-first-pass)

## 1. What was authorized

The fourteenth reviewer (on commit 50623cf39) authorized R-replace with
the explicit instruction:

> "C1: GO TO R-REPLACE — Do the real composed lifecycle qualification
> now. If positive B replacement, missing-secret no-replacement,
> running-session refusal, and model-only conservation all pass, you
> should be very close to Foundation closure + §17 handoff to Model
> Profiles rather than another architecture pass."

And further specified the witnesses:

> "Exercise the real:
> Provider-instance apply
>   → real SdkSessionConfigBuilder
>   → credential resolution
>   → typed projection
>   → real SdkSessionLifecycle.replaceActiveSession
>   → real session reconstruction"

And the four witness cases:

> "Positive composed witness" (A → B applies, B is installed)
> "Negative missing-secret witness" (B credential missing → explicit
>   MissingProviderInstanceCredentialError; replaceActiveSession = 0;
>   active session remains A)
> "Conservation" (same instance, model A1 → A2; → updateSessionModel;
>   replaceActiveSession = 0)
> "Running-session behavior" (isRunning = true → instance replacement
>   refused; current session untouched; no deferred queue)

## 2. The bounded correction (this pass)

Production source files NOT touched. This is a TEST-ONLY qualification pass.

### Why no production changes?

The reviewer wrote:

> "Do not open another correction cycle. Fold one negative case into
> R-replace: ... That closes the P1 as part of the already-required
> lifecycle qualification."

This pass is a witness pass, not a correction. The thirteenth-reviewer
fix is in place; the fourteenth reviewer wants the same fail-closed
contract demonstrated through the lifecycle seam.

### New test file

`apps/vscode/src/sdk/__tests__/provider-instance-identity-r-replace-real-lifecycle.piif01.test.ts`
(NEW, 4 witnesses, ~400 lines)

### Test wiring

- `apps/vscode/vitest.config.c2-4-c-bridge.ts`: added the new file to
  the bridge include list.
- `apps/vscode/vitest.config.ts`: excluded the new file from the base
  config (bridge-only alias requirement).
- `apps/vscode/tsconfig.c2-4-c-bridge.json`: added the new file to the
  bridge include list.
- `apps/vscode/tsconfig.json`: excluded the new file from the base
  typecheck.

## 3. Production seams driven (this file)

```
SdkSessionConfigBuilder.build                    = REAL_PRODUCTION_SEAM
applyTypedProviderInstanceToConfig               = REAL_PRODUCTION_SEAM
MissingProviderInstanceCredentialError           = REAL_PRODUCTION_SEAM
SdkSessionLifecycle.replaceActiveSession         = REAL_PRODUCTION_SEAM
SdkSessionLifecycle.startNewSession              = REAL_PRODUCTION_SEAM
SdkSessionLifecycle.endActiveSession             = REAL_PRODUCTION_SEAM
SdkSessionLifecycle.updateActiveSessionModel     = REAL_PRODUCTION_SEAM
```

## 4. Collaborators stubbed

```
buildSessionConfig (= baseline A)                = SYNTHETIC
buildAgentHooks   (= no-op)                      = SYNTHETIC
VscodeSessionHost.create (= fake sdkHost)        = SYNTHETIC
StateManager (only autoApprovalSettings probed)  = SYNTHETIC
```

The fake `sdkHost` returned by `VscodeSessionHost.create` has
programmable `start()`, `subscribe()`, `updateSessionModel()`,
`stop()`, `dispose()`. The `start()` function takes a queue of
sessionIds and returns the next one on each call — so the test
controls exactly what sessionId the real lifecycle installs.

## 5. The four witnesses

### 5.1 R_REPLACE_POSITIVE

**Setup**: fake host returns "sess-A" on first `start()` and
"sess-B" on second. `getInstanceSecret("instance:inst-B-key")`
returns "physical-key-B". `buildSessionConfig` returns a baseline
A every time.

**Drive**:
1. Install session A: `builder.build({ cwd, mode })` → install via
   `lifecycle.startNewSession({ config: { sessionId: "sess-A", ... } })`
2. Mark idle: `lifecycle.setRunning(false)`
3. Build B: `builder.build({ cwd, mode, providerConfigurationInstanceTyped: B })`
4. Verify the typed projector wrote `apiKey = "physical-key-B"` (NOT
   "instance:inst-B-key"), `modelId = "model-B"`, etc.
5. Apply: `lifecycle.replaceActiveSession({ expectedSession: A, startInput: { config: { sessionId: "sess-B", ... } }, disposeReason: "providerInstanceApply" })`

**Asserts**:
- `replaceActiveSession` returns `{ startResult: { sessionId: "sess-B" }, ... }` (non-undefined)
- `lifecycle.getActiveSession()?.sessionId === "sess-B"` (the NEW session is installed)
- `lifecycle.getActiveSession()?.startConfig === { providerId: "openai-compatible", modelId: "model-B" }`
- `lifecycle.getActiveSession() !== activeSessionA` (NEW object reference)
- `fakeHost.start` called exactly 2 times (one for A, one for B)

### 5.2 R_REPLACE_NEGATIVE_MISSING_CREDENTIAL

**Setup**: `getInstanceSecret(...)` returns undefined for every name
(broken durable instance).

**Drive**: same as POSITIVE, but the build of B throws
`MissingProviderInstanceCredentialError` instead of completing.

**Asserts**:
- `builder.build({ ..., providerConfigurationInstanceTyped: B })`
  rejects with `MissingProviderInstanceCredentialError`
- `lifecycle.getActiveSession()` returns the SAME object reference as
  before the attempt (object-identity invariant — the reviewer-required
  "active session remains unchanged")
- `lifecycle.getActiveSession()?.sessionId === "sess-A"` (still A)
- `lifecycle.getActiveSession()?.startConfig` still A's
- `fakeHost.start` called exactly 1 time (only the initial install; no
  replacement attempt reached `host.start`)

This is the P1 carry-over the fourteenth reviewer explicitly required:
the "active session remains unchanged" invariant is now demonstrated
through the LIFECYCLE seam (not just the builder seam), and the
proof-by-object-identity makes the witness impossible to satisfy
without genuine lifecycle-layer non-interference.

### 5.3 R_REPLACE_RUNNING_SESSION_REFUSAL

**Setup**: install session A and keep `isRunning = true` (we never
call `setRunning(false)`).

**Drive**: build B successfully (secret present); then attempt
`lifecycle.replaceActiveSession({ expectedSession: A, startInput: { sessionId: "sess-B", ... }, disposeReason: "providerInstanceApply" })`.

**Asserts**:
- `replaceActiveSession` returns `undefined` (refused)
- `lifecycle.getActiveSession()` returns the SAME object reference as
  before the attempt
- `lifecycle.getActiveSession()?.sessionId === "sess-A"`
- `lifecycle.getActiveSession()?.startConfig` still A's
- `lifecycle.getActiveSession()?.isRunning === true`
- `fakeHost.start` called exactly 1 time (the initial install); no
  replacement attempt reached `host.start`

No deferred queue is invented. The session stays running; the user
(or the next caller) must wait.

### 5.4 R_REPLACE_CONSERVATION_MODEL_ONLY

**Setup**: install session A; mark idle.

**Drive**: same instance, model-only mutation: call
`lifecycle.updateActiveSessionModel("model-A2")`.

**Asserts**:
- Returns `true`
- `fakeHost.updateSessionModel` was called with `("sess-A", "model-A2")`
- `lifecycle.getActiveSession()` returns the SAME object reference
  (fast lane, no rebuild)
- `fakeHost.start` called exactly 1 time (the initial install only;
  no replacement)

This pins the conservation invariant: the existing same-instance
fast path is preserved end-to-end through the real lifecycle. The
typed-instance rebuild is a strictly heavier operation than the
model-only swap and they do not collide.

## 6. Test counts

| Suite                             | Before | After |
| --------------------------------- | ------ | ----- |
| `typed-projector.test.ts`         | 7      | 7     |
| `instances-store.test.ts`         | 10     | 10    |
| `instance-secret.test.ts`         | 7      | 7     |
| `state-manager-instance-secret-durable.test.ts` | 5 | 5 |
| `provider-instance-identity-r2p-real-projector.piif01.test.ts` | 5 | 5 |
| `provider-instance-identity-r5-missing-credential-fails-closed.piif01.test.ts` | 4 | 4 |
| `provider-instance-identity-r-replace-real-lifecycle.piif01.test.ts` | (NEW) | 4 |
| **Total bridge tests**            | **38** | **42** |

All 42 GREEN across 7 bridge files.

## 7. Bridge typecheck

`bun run check-types:c2-4-c-bridge` exits 0. The frozen baseline
diagnostics file is unchanged (no new diagnostics on this commit;
no production source touched).

## 8. What's no longer halted (post this pass)

- `R-REPLACE = GREEN` (composed lifecycle qualification complete)
- `R3 / R4 / R5 / R2p / R-REPLACE = GREEN`
- `FOUNDATION_IMPLEMENTATION_PHASE = OPEN`; the four reviewer-required
  R-class witnesses are now green; the §17 four-gate handoff
  authorization gate should be re-evaluated at this point.

## 9. What's still on the follow-on list (NOT blocking)

P1 carry-overs, unchanged from the thirteenth-reviewer classification:

- `R4_RELOAD_READ = NOT_EXECUTED` (process-restart-roundtrip witness
  for StateManager instance secrets).
- Generic-provider scope overclaim (claim should be
  `API_KEY_BACKED_INSTANCE_IDENTITY = SUPPORTED` only).
- Structured-provider projection overclaim (R5 covers common-field
  geometry only).

P2 (per fourteenth reviewer): 2 blank-at-EOF diagnostics on
`10-thirteenth-reviewer-fail-closed-witness.md` and
`provider-instance-identity-r5-missing-credential-fails-closed.piif01.test.ts`.
Fixed opportunistically in this commit by trimming trailing newlines.
`git diff --check` is clean.

## 10. Halt inventory (this pass)

- `HALT_MISSING_INSTANCE_SECRET_FAILS_OPEN = CLOSED` (this pass's
  predecessor, commit 50623cf39)
- `HALT_TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED = CLOSED` (unchanged)
- `CREDENTIAL_AUTHORITY_DUPLICATED = CLOSED` (unchanged)
- `R-REPLACE = GREEN` (this pass — composed A→B through real lifecycle)
- `NO_REPLACEMENT_ON_MISSING_SECRET = GREEN at lifecycle seam` (this pass)
- `MODEL_ONLY_CONSERVATION = GREEN` (this pass)

## 11. Composition table (post this pass)

```
ProviderConfigurationInstance.credentialRef
        ↓
StateManager.getInstanceSecret(...)
        ↓
undefined / "" ─────→ THROW MissingProviderInstanceCredentialError
        │                       │
        │                       └─ (NEW: at BUILDER seam, R5; propagated
        │                           up to LIFECYCLE seam, R-REPLACE)
        │
        └─ non-empty secret
                ↓
        typed projector(resolvedSecret: string)
                ↓
        CoreSessionConfig.apiKey = physical secret
                ↓
        SdkSessionLifecycle.replaceActiveSession(...)
                ↓
        NEW active session installed (R-REPLACE POSITIVE)
```

The composition is now coherent end-to-end through two real
production seams (the builder and the lifecycle).
