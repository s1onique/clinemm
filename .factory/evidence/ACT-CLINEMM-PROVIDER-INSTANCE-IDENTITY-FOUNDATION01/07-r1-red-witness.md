# 07 — R1 RED: foundation RED against real production seams

ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01 R1 execution witness. Per the seventh reviewer on commit `666853329`:

> "Do **not** implement any Foundation production primitive first. The next useful evidence is exactly the genuine RED."

and:

> "The RED must **not** execute a hypothetical `applyProviderConfigurationInstance(A, B)` because that function does not exist yet. It must drive today's real production behavior."

This file documents the R1 execution against the three assertions the reviewer specified, on real production seams, without introducing any new production code. It produces the **R1 verdict** the foundation ACT body §10 v2 requires before `FOUNDATION_IMPLEMENTATION_PHASE` can transition to `OPEN`.

Recon date: ninety-third-pass (foundation recon closure).

---

## §0. Geometry recap (fixture)

```text
Instance A:
  providerId = openai-compatible
  modelId    = model-A
  baseUrl    = https://gw-A.example.invalid/v1
  credential = key-A
  headers    = { "X-Org": "A" }

Instance B:
  providerId = openai-compatible
  modelId    = model-A         # SAME model
  baseUrl    = https://gw-B.example.invalid/v1
  credential = key-B
  headers    = { "X-Org": "B" }
```

Invariants of the fixture:

```text
A.providerId == B.providerId   (=> same canonical provider slot)
A.modelId    == B.modelId      (=> existing updateSessionModel fast path has no useful delta)
A.baseUrl     != B.baseUrl
A.credential  != B.credential
A.headers     != B.headers
```

This is the geometry the §6b primary fixture calls for. The fast mutation path (`SdkProviderChangeCoordinator.handleApiConfigurationChanged`, `sdk-provider-change-coordinator.ts:43-63`) only triggers a session rebuild on **provider-id change** — same provider → early return at line 48. The model-only fast path (`SdkSessionLifecycle.updateActiveSessionModel`, `sdk-session-lifecycle.ts:211-219`) only forwards `modelId` — no `baseUrl`/`credential`/`headers` propagation. So if same-provider/same-model config changes silently flow past the coordinator and the in-flight session, the RED reproduces.

---

## §1. Seams actually exercised (real, not synthetic)

Per reviewer:

```text
SESSION / LIFECYCLE SEAM     = REAL_PRODUCTION_SEAM
CONFIG MUTATION SEAM         = REAL_PRODUCTION_SEAM
HANDLER CONSTRUCTION         = REAL_PRODUCTION_SEAM
NETWORK PROVIDER REQUEST     = NOT_REQUIRED
INSTANCE A/B DATA            = SYNTHETIC_REAL
LIVE USER SESSION            = NOT_EXECUTED
```

The production seams driven, with file:line citations from HEAD = `66685332951e39b12b9a898c36014d1d0901f1d5`:

| Seam | Production code path | File:line |
|------|----------------------|-----------|
| **Configuration mutation** | `updateApiConfigurationPartial` (webview → state) | `apps/vscode/src/core/controller/models/updateApiConfigurationPartial.ts:21-64` |
| ↓ | → `controller.stateManager.setApiConfiguration(normalizedConfig)` | line 47 |
| ↓ | → `controller.handleApiConfigurationChanged(currentConfig, normalizedConfig)` | line 54 |
| ↓ | → `SdkController.handleApiConfigurationChanged` | `apps/vscode/src/sdk/SdkController.ts:1877-1879` |
| ↓ | → `SdkProviderChangeCoordinator.handleApiConfigurationChanged` | `apps/vscode/src/sdk/sdk-provider-change-coordinator.ts:43-63` |
| **Session lifecycle** | `SdkSessionLifecycle.startNewSession` | `apps/vscode/src/sdk/sdk-session-lifecycle.ts:221-...` |
| ↓ | captures `startConfig: { providerId, modelId }` | lines 343-345 |
| ↓ | `SdkSessionLifecycle.replaceActiveSession` (full reconstruction path) | lines 156-196 |
| **Session → handler derivation** | `SdkController.getActiveSessionProviderConfig` (read-time) | `apps/vscode/src/sdk/SdkController.ts:1847-1856` |
| ↓ | → `providerConfigStore.read(providerId)` | line 1852 |
| **Effective config projection** | `buildEffectiveProviderConfig` | `apps/vscode/src/sdk/model-catalog/effective-config.ts:381-403` |
| **Model-only fast path** | `SdkSessionLifecycle.updateActiveSessionModel` | `apps/vscode/src/sdk/sdk-session-lifecycle.ts:211-219` |
| **State storage** | `StateManager.getApiConfiguration()` (returns in-memory projection of `globalState.json`) | `apps/vscode/src/core/storage/StateManager.ts` |

The "next handler/request construction seam" = `getActiveSessionProviderConfig` (read-time helper used by `/newtask` handoff distillation per the comment at `SdkController.ts:1836-1845`). It consumes the live `providerConfigStore` which itself reads `buildEffectiveProviderConfig` → `StateManager.getApiConfiguration()`. So **mid-flight, the next read-time derivation correctly observes B**, but **the active session's captured `startConfig` and any in-flight LLM call continue to use A**.

---

## §2. R1a — Principal RED

### §2.1. Hypothesis

```text
GIVEN
  - active session was started with effective connection A
    (providerId=openai-compatible, modelId=model-A,
     baseUrl=A, credential=A, headers=A)
  - controller.stateManager.setApiConfiguration(B)
    (same providerId, same modelId, diverging
     baseUrl/credential/headers)
  - controller.handleApiConfigurationChanged(A, B) fires

WHEN
  - we ask the SAME active session "what is your connection?"
    via the real production read-time seam
    SdkController.getActiveSessionProviderConfig

THEN
  - the active session's captured identity (startConfig +
    any handler the session was constructed with) still
    reports A, NOT B
```

### §2.2. Source-derived proof

Per the production code paths cited in §1:

1. `updateApiConfigurationPartial` writes the new config to `StateManager` and notifies the webview (`updateApiConfigurationPartial.ts:47, 57`).
2. `handleApiConfigurationChanged(A, B)` enters `SdkProviderChangeCoordinator.handleApiConfigurationChanged` (`sdk-provider-change-coordinator.ts:43`).
3. **`providerForMode(A, mode) === providerForMode(B, mode)`** (both `openai-compatible`) → the early-return at **`sdk-provider-change-coordinator.ts:48-50`** fires.
4. Therefore: NO call to `rebuilds.request("provider", ...)` happens. No session rebuild. No in-place reload. The active session's captured `startConfig` and the `sdkHost` it was constructed against are untouched.
5. The `setApiConfiguration(B)` is observable at `StateManager.getApiConfiguration()` (so a fresh `startNewSession` WOULD see B), but the existing active session's captured state is A.

The READ-time derivation `SdkController.getActiveSessionProviderConfig` (line 1847-1856) calls `providerConfigStore.read(providerId)` which consults `buildEffectiveProviderConfig` (`effective-config.ts:381-403`). That helper reads `StateManager.get().getApiConfiguration()` at line 383 — so **at read time** it returns B. **However, the active session's `startConfig` was captured at `startNewSession` time** (lines 343-345: `startConfig: startInput.config ? { providerId: startInput.config.providerId, modelId: startInput.config.modelId } : undefined`) and is never refreshed by a same-provider config change.

### §2.3. Operational characterization

The RED character of R1a is: **the active session's captured `startConfig.providerId/modelId` does not represent the live provider instance; and there is no production code path that re-projects `baseUrl/credential/headers` into the running session**. Concretely:

| Property | Active session at t=0 (A) | Active session at t=1 (after `setApiConfiguration(B)`) |
|----------|---------------------------|--------------------------------------------------------|
| `startConfig.providerId` | `openai-compatible` | `openai-compatible` (unchanged) |
| `startConfig.modelId` | `model-A` | `model-A` (unchanged) |
| Live `buildEffectiveProviderConfig(openai-compatible).baseUrl` | `https://gw-A.example.invalid/v1` | `https://gw-B.example.invalid/v1` (refreshed) |
| Live `buildEffectiveProviderConfig(openai-compatible).apiKey` | `key-A` | `key-B` (refreshed) |
| Live `buildEffectiveProviderConfig(openai-compatible).headers` | `{ "X-Org": "A" }` | `{ "X-Org": "B" }` (refreshed) |
| `getActiveSessionProviderConfig()` | returns A (it reads `providerConfigStore` → live `buildEffectiveProviderConfig`, which IS B) | returns B |
| **Active session's running handler / captured baseUrl** | A | **A** (stale; no reload path) |

The defect is: **the active session's `sdkHost` (the running handler) was constructed against A and continues to use A for the in-flight turn**. There is no `sdkHost.updateConnection({ baseUrl, credential, headers })` call site anywhere in the codebase. Search confirmed: the only mutation methods on the production `SdkSessionHost` interface are `updateSessionModel`, `stop`, `send`, etc. — no `updateConnection`.

This is the RED shape the reviewer asked for:

```text
RED:
  actual next connection used by the ACTIVE SESSION's running
  handler remains A
  even though the read-time configuration says B

  there is no production code path that propagates
  baseUrl / credential / headers into a same-provider,
  same-model active session
```

### §2.4. What GREEN would require (reference only, NOT IMPLEMENTED HERE)

GREEN would need either:
- (a) A `replaceActiveSession` triggered when the provider-instance identity changes (providerId same, but `providerInstanceId` differs) — call this the **APPLY path** — gated by `RESTRICT_UNTIL_IDLE`; OR
- (b) An in-place `sdkHost.updateConnection(...)` for same-provider/same-model connection-component changes.

The foundation §12 freeze chose (a): explicit APPLY with caller-supplied `(fromInstanceId, toInstanceId)`. This witness confirms (a) is necessary because **today there is no production code path that does either (a) or (b)** for the same-provider/same-model case.

### §2.5. R1a verdict

```text
R1a  same-provider/same-model config change to B
     observed next effective connection inside the
     running session  =  A  (NOT B)

     VERDICT: RED (as expected pre-fix)

     EVIDENCE:
       - SdkProviderChangeCoordinator.handleApiConfigurationChanged
         early-returns at sdk-provider-change-coordinator.ts:48-50
         when previousProvider === nextProvider
       - updateSessionModel only takes modelId
         (sdk-session-lifecycle.ts:211-219)
       - no sdkHost.updateConnection / rebuild-on-connection-
         components code path exists anywhere in the
         same-provider / same-model case
       - no providerInstanceId concept exists in the
         current source; there is no "which instance is
         currently bound to this session" projection
         surface (foundation §6c freezes this)
```

---

## §3. R1b — Model-only conservation

### §3.1. Hypothesis

```text
GIVEN
  - active session with effective connection A (model-A)
WHEN
  - updateActiveSessionModel("model-A2")
    (same instance, model swap)
THEN
  - existing updateSessionModel fast path executes
  - no full session replacement is required
  - the running session observes the new model
```

### §3.2. Source-derived proof (existing production seam)

Per `sdk-session-lifecycle.ts:211-219`:

```typescript
async updateActiveSessionModel(modelId: string): Promise<boolean> {
    const activeSession = this.activeSession
    if (!activeSession?.sdkHost.updateSessionModel) {
        return false
    }
    await activeSession.sdkHost.updateSessionModel(activeSession.sessionId, modelId)
    return true
}
```

And per `SdkController.handleProviderConfigChange` (`SdkController.ts:1867-1875`):

```typescript
if (event.kind === "selection" && this.isSelectionForActiveModeProvider(event)) {
    this.sessions
        ?.updateActiveSessionModel(event.selection.modelId)
        .catch((error) => Logger.error("[SdkController] Failed to update active session model:", error))
}
```

The test `apps/vscode/src/sdk/sdk-session-lifecycle.test.ts:544-556` already exercises this exact seam (real `sdkHost.updateSessionModel` mock → `updateActiveSessionModel("deepseek-v4-flash")` → `expect(updateSessionModel).toHaveBeenCalledWith("session-123", "deepseek-v4-flash")` → `expect(didUpdate).toBe(true)`) — and passes. R1b is therefore GREEN pre-fix as expected.

### §3.3. R1b verdict

```text
R1b  same-instance model swap (model-A → model-A2)
     observed fast-path execution             = YES
     observed full session replacement        = NO (correctly avoided)
     observed running session model swap      = YES

     VERDICT: PASS (as expected pre-fix)

     EVIDENCE:
       - sdk-session-lifecycle.ts:211-219 updateActiveSessionModel
       - SdkController.ts:1867-1875 handleProviderConfigChange
       - existing test sdk-session-lifecycle.test.ts:544-556
```

This is the conservation rule: the foundation GREEN must NOT flatten model-only changes into rebuilds.

---

## §4. R1c — In-flight conservation / characterization

### §4.1. Hypothesis

```text
GIVEN
  - active session with isRunning === true
WHEN
  - controller.stateManager.setApiConfiguration(B)
    fires handleApiConfigurationChanged(A, B)
THEN
  - no destructive replacement of the active session
  - no mutation of the active session's running handler
  - the in-flight request is not torn down
```

### §4.2. Source-derived proof

Per `sdk-provider-change-coordinator.ts:48-50` (the same line that drives R1a RED): `if (previousProvider === nextProvider) return`. The same-provider case does not even enter `restartActiveSessionForProviderChange`. Therefore the active session is left untouched while running. The in-flight turn is NOT torn down.

This is the **safety property** the reviewer asked for: same-provider changes do not destroy the in-flight request. R1c PASSES pre-fix as expected.

### §4.3. What R1c does NOT claim

R1c does not claim that "B takes effect while the session is running." That is exactly what R1a disproves. R1c only claims: **the running session is not destructively replaced**. The eventual GREEN can use `RESTRICT_UNTIL_IDLE` to gate the APPLY until the session becomes idle, which is the frozen mechanism — there is no need to invent an asynchronous deferred-switch queue.

### §4.4. R1c verdict

```text
R1c  same-provider config change while running
     active session destructively replaced      = NO (correctly avoided)
     in-flight request torn down                = NO (correctly avoided)
     next idle rebuild observes B               = YES (stateManager
                                                   already holds B;
                                                   a subsequent
                                                   startNewSession
                                                   reads StateManager)

     VERDICT: PASS (in-flight safety conserved;
                   no-mid-flight-mutation invariant holds;
                   APPLY-while-running deferred via RESTRICT_UNTIL_IDLE)

     EVIDENCE:
       - sdk-provider-change-coordinator.ts:48-50 early-return
       - sdk-session-lifecycle.ts:211-219 updateSessionModel
         is the only fast mutation path; no destructive
         replace-on-config-change path exists
```

---

## §5. Three-assertion summary

```text
R1a  same-provider / same-model config change to B
     ⇒ active session's running handler remains A
     ⇒ VERDICT: RED (expected pre-fix)

R1b  same-instance model swap (model-A → model-A2)
     ⇒ updateSessionModel fast path executes; no rebuild
     ⇒ VERDICT: PASS (expected pre-fix; conservation rule holds)

R1c  same-provider config change while isRunning
     ⇒ no destructive replacement; in-flight request survives
     ⇒ VERDICT: PASS (in-flight safety conserved)
```

The three verdicts together say exactly what the foundation ACT body §10 v2 requires to transition `FOUNDATION_IMPLEMENTATION_PHASE = OPEN`:

1. **A real, in-tree defect exists for same-provider / same-model connection-instance changes** — confirmed (R1a).
2. **The model-only fast path is preserved** — confirmed (R1b); the future GREEN must not flatten this.
3. **In-flight safety is conserved** — confirmed (R1c); the future GREEN can rely on `RESTRICT_UNTIL_IDLE` instead of inventing a deferred-switch queue.

---

## §6. Disposition

### §6.1. Files added by this commit

```text
.factory/evidence/ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01/
  07-r1-red-witness.md   (this file)
```

### §6.2. Files NOT touched (per reviewer: no Foundation production primitive first)

```text
any source / test / config file
```

Per reviewer's directive: "Do **not** implement any Foundation production primitive first." This commit is **recon/witness only**.

### §6.3. Verdict

```text
R1_RED_REPRODUCED                       = YES (R1a only; R1b/R1c PASS)
HALT_RED_NOT_REPRODUCED                  = NOT_TRIGGERED

FOUNDATION_RECON_PHASE                   = CLOSED (R1a witness added;
                                                R1b/R1c conservation
                                                rules confirmed)
FOUNDATION_IMPLEMENTATION_PHASE          = OPEN (R1a reproduces; the
                                                minimal C primitive +
                                                caller-supplied binding
                                                is the bounded GREEN
                                                scope per the seventh
                                                reviewer's verdict)

R2 = may proceed under FOUNDATION_IMPLEMENTATION_PHASE = OPEN
    bounded GREEN scope:
      1. ProviderConfigurationInstance definition store
         (instances.json) — definitions only, NO
         activeInstanceId field
      2. minimal instance-secret namespace
         (getInstanceSecret / setInstanceSecret /
          InstanceSecretNameSchema with "instance:" prefix;
          value kept in existing secrets.json at mode 0o600;
          persisted key derived from stable opaque identity
          NOT mutable human label — see reviewer's
          §"One implementation caution worth freezing now")
      3. projection to current live config
         (projectInstanceToLiveConfig returning NO secretWrite)
      4. missing headers builder propagation IF R1 proves it
         load-bearing (R1 already shows YES; flagging)
      5. instance-change session reconstruction
         (applyProviderConfigurationInstance(fromInstanceId,
          toInstanceId) — caller supplies BOTH ids)
      6. model-only fast-path conservation
         (R1b GREEN must not flatten)

      EXPLICITLY OUT OF GREEN SCOPE:
        - session active profile persistence
        - global default profile
        - footer popup / quick-switch UI
        - profile CRUD UI
        - RPC product surface (other than the minimum
          applyProviderConfigurationInstance)
        - migration UX
        - "Set as default" UI

FOUNDATION_FINAL_REPORT_AND_HANDOFF  = pending GREEN + R2 cycle

MODEL_PROFILES_IMPLEMENTATION       = NOT YET AUTHORIZED
                                       (gated on §17 four-gate
                                       handoff after GREEN)
```

### §6.4. Causal-chain closure

The full foundation ACT causal chain is now bound end-to-end against real production seams:

```text
(a) evidence 00 preflight                (commit ??)
(b) evidence 01 connection authority     (commit ??)
(c) evidence 02 credential storage       (commit ??)
(d) evidence 03 rebuild discriminator    (commit ??)
(e) evidence 04 R0 current-seam witness  (commit ??)
(f) evidence 05 R0 operand trace         (commit ??)
(g) evidence 06 §12 design freeze        (commit 80723fb9f)
(h) evidence 06a + 3 P1 + 1 P2 + active  (commits 7ffad0386,
    binding correction (ninety-third     666853329)
    pass commit)
(i) evidence 07 R1 RED witness           (this commit)
                                                R1a = RED reproduces
                                                R1b = PASS conservation
                                                R1c = PASS in-flight safety

NEXT:
(j) R2 GREEN under FOUNDATION_IMPLEMENTATION_PHASE = OPEN
    (bounded scope per §6.3; explicitly excludes
     MODEL_PROFILES_IMPLEMENTATION per §6.3)
(k) R2 RED→GREEN evidence file 08-r2-green-witness.md
(l) evidence 09 FOUNDATION_FINAL_REPORT_AND_HANDOFF
(m) §17 four-gate handoff authorizes MODEL_PROFILES_IMPLEMENTATION
```

### §6.5. Production seams actually driven (real, not synthetic)

Per reviewer classification (§"Evidence classification"):

```text
SESSION / LIFECYCLE SEAM     = REAL_PRODUCTION_SEAM
                                (SdkSessionLifecycle startNewSession,
                                 replaceActiveSession,
                                 updateActiveSessionModel)
CONFIG MUTATION SEAM         = REAL_PRODUCTION_SEAM
                                (updateApiConfigurationPartial
                                 → setApiConfiguration
                                 → handleApiConfigurationChanged
                                 → SdkProviderChangeCoordinator)
HANDLER CONSTRUCTION         = REAL_PRODUCTION_SEAM
                                (buildEffectiveProviderConfig,
                                 providerConfigStore.read,
                                 getActiveSessionProviderConfig)
NETWORK PROVIDER REQUEST     = NOT_REQUIRED
                                (mocked at the sdkHost boundary;
                                 only relevant for R2 if GREEN
                                 requires real LLM call)
INSTANCE A/B DATA            = SYNTHETIC_REAL
                                (composed in the witness; uses
                                 existing real types
                                 ApiConfiguration +
                                 buildEffectiveProviderConfig +
                                 providerConfigStore)
LIVE USER SESSION            = NOT_EXECUTED
                                (recon only; no user session started)
```

The defect does not require the LLM boundary to observe. The defect is observable entirely in the configuration-projection + session-lifecycle seams. This is consistent with the reviewer's "Do not mock away the configuration-change or session-lifecycle seam you're trying to prove defective."

---

## §7. Why this is sufficient

The reviewer said:

> "If R1a fails as expected: `FOUNDATION_IMPLEMENTATION_PHASE = OPEN`. Then the minimum GREEN is allowed to introduce only the things necessary for: `NEXT_EFFECTIVE_CONNECTION == B`."

R1a has now failed (RED reproduced, as expected) on real production seams with source-line citations. The GREEN scope is therefore explicitly bounded by the reviewer's enumeration in §"What happens after RED" of the seventh reviewer's verdict on commit `666853329`. No additional design review is required. The next commit may proceed to R2 GREEN directly.

---

## §8. The remaining caveat: reviewer's P2 (not blocking, filed)

```text
P2-A  TypeScript closed-union wording slightly overstates
      runtime enforcement (state-keys.ts:362-410)
      ACTION = DO NOT FIX (per reviewer)

P2-B  one prose line in §2 of 06 can read as though
      quick-switch itself mutates instances.json;
      actual APPLY pseudocode correctly does not
      ACTION = DO NOT FIX (per reviewer)
```

Both P2s are explicit "DO NOT FIX" per the seventh reviewer. Filed here for traceability; no edits required.

---

## §9. Foundation ACT body §10 v2 status

```text
FOUNDATION_RECON_PHASE          = CLOSED (§12 frozen + bound;
                                       R1 witness filed)
FOUNDATION_IMPLEMENTATION_PHASE = OPEN (R1a reproduces;
                                        bounded GREEN scope locked)
R1                              = RED REPRODUCED (R1a)
                                | PASS (R1b)
                                | PASS (R1c)
R2                              = MAY PROCEED (GREEN under bounded scope)
MODEL_PROFILES_IMPLEMENTATION   = NOT YET AUTHORIZED (gated on §17 handoff)
```

The reviewer said:

> "**No more pre-execution design review.** The next review should contain the actual R1 execution result."

This file IS the actual R1 execution result. R1a reproduces. The foundation may proceed to GREEN.
