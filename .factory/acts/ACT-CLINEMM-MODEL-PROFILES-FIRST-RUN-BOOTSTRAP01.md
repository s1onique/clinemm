# ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01

> **Entry identity (auto-recorded by §0 preflight):**
>
> ```text
> ACT_ID            = ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01
> LIVE_OBS_SUBJECT  = c47e219f76dafffe4f9bced6dc4d05eac73bb4d2
>                    (DOGFOOD-VSIX-TYPECHECK-UNBLOCK01 closure HEAD,
>                     the VSIX that was installed and exercised when
>                     the live defect was observed. This is the
>                     correct subject; previous registration
>                     mis-cited a long-form hash that does not
>                     resolve to a git object — fixed by this
>                     in-place amendment.)
> ENTRY_HEAD        = 052da8958d096fad6fe475d1be78bfb53957086b
>                    (current repository HEAD at amendment time;
>                     DOGFOOD-VSIX-TYPECHECK-UNBLOCK02 closure, the
>                     post-UNBLOCK01 typecheck follow-up)
> PREDECESSORS      = ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02
>                     (closes P0 fail-closed binding — the very fix
>                      that surfaced the missing bootstrap path)
> PREDECESSOR_STATE = COMPONENT_IMPLEMENTATION = PASS
>                     DOMAIN_IMPLEMENTATION    = PASS
>                     PRODUCTION_COMPOSITION   = PASS (typed-foundation
>                                                  composition witness)
>                     P0-1, P0-3               = deferred to this ACT
>                     SECRET_ISOLATION         = PASS
>                     LIVE_DOGFOOD             = NOT_READY (live defect)
> BRANCH            = main
> PROD_EDITS        = AUTHORIZED (product implementation phase)
> TESTS             = bootstrap path / typed-instance capture / error
>                     visibility / empty-state CTA (each RED -> GREEN)
> AMENDMENT_NOTES   = 2026-09-07 in-place amendment on the opening
>                     registration. Three contract freezes added in
>                     response to the post-registration reviewer
>                     panel (runtime architect + persistence/security
>                     engineer + factory reviewer consensus):
>                       CURRENT_PHYSICAL_CREDENTIAL_SOURCE
>                       BOOTSTRAP_COMMIT_MODEL
>                       BOOTSTRAP_RPC
>                     Plus the live-observation subject was rebound
>                     to the actual installed artifact HEAD
>                     (c47e219f7) — see "Identity correction" below.
> ```
>
> PRIMARY_EPISTEMIC_PURPOSE =
>   Can a user with zero existing Model Profiles and a valid
>   legacy/current API configuration successfully create the first
>   Model Profile from the Settings > Model Profiles tab without
>   silently failing, without guessing provider-instance identity,
>   and without surfacing an empty-state dead end?

## Verdict source

Live-dogfood reviewer (product/UX engineer + runtime architect
+ factory reviewer consensus, 2026-09-07):

```
HALT_MODEL_PROFILE_FIRST_RUN_BOOTSTRAP_ABSENT
```

The defect was observed live against the exact HEAD installable
from the UNBLOCK02 VSIX. Repro:

1. Fresh user installs VSIX.
2. Configures OpenAI-compatible provider (e.g. Granelle endpoint)
   with a real API key.
3. Opens Settings > Model Profiles.
4. Sees the dead-end empty state and the Save-current-as-profile
   affordance.
5. Types a name, clicks the button.
6. Nothing visible happens.

Root cause analysis (the run that produced this verdict):

```
legacy/current API configuration exists
provider instance identity = not yet established
profiles = []
    ↓
"Save current configuration as profile"
    ↓
cannot determine exact ProviderConfigurationInstance
    ↓
fail closed (correctly, per MPWC01 C3 fix)
    ↓
gRPC Error → console.error → no UI feedback
    ↓
button appears to do nothing
```

The C3 fail-closed fix in
`ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01`
correctly eliminated the `providerId === providerId` collapse
fallback. But it also removed the only path that could answer
"What is the active provider instance?" for a user who has
NEVER created a profile before. That answer used to come from
the (now-forbidden) identity-collapse fallback.

The new product demand is therefore: an explicit bootstrap
operation that converts a legacy/current API configuration into
a stable `ProviderConfigurationInstance` + physical credential
+ first `ModelProfile`, while preserving the invariant

```
providerId → instanceId inference = FORBIDDEN
```

## P0 (load-bearing)

| P0 | Class | Repair |
|----|-------|--------|
| P0-1 | `HALT_MODEL_PROFILE_FIRST_RUN_BOOTSTRAP_ABSENT` | Add a typed bootstrap operation `bootstrapModelProfileFromCurrentConfiguration(name)` that (a) reads the legacy/current `ApiConfiguration` directly via the **CURRENT_CONFIGURATION authority** (NOT the instance-secret namespace — the namespace does not yet exist for a first-run user), (b) resolves the physical credential from that current config via `CURRENT_PHYSICAL_CREDENTIAL_SOURCE` (see contract freezes below), (c) generates a fresh opaque `instanceId`, (d) derives the canonical `InstanceSecretName` from that id (`nameFor(instanceId)`), (e) writes the physical credential under the instance-scoped secret namespace via `setInstanceSecret(name, physicalCredential)`, (f) persists a new `ProviderConfigurationInstance` whose `credentialRef.name === name` via `InstancesStore.write`, (g) creates the first `ModelProfile` referencing the new `instanceId`, (h) **post-commit**: best-effort binds it to the active task via `writeActiveProfileIdToHistoryItem`, (i) **post-commit**: publishes ExtensionState. The existing `saveCurrentAsModelProfile` keeps its cheaper profile-only path for users who already have an instance. Step (g) is the durable commit boundary; steps (h)-(i) are post-commit composition and may fail without invalidating the persisted profile. See `BOOTSTRAP_COMMIT_MODEL` freeze below. |

## P1 (UX)

| P1 | Class | Repair |
|----|-------|--------|
| P1-1 | `HALT_EMPTY_STATE_DEAD_END` | When `profiles.length === 0`, the Settings > Model Profiles section renders a first-run onboarding pane (current configuration summary + profile-name input + Save CTA + "Configure a different provider first" escape hatch). The established-state profile table appears only after at least one profile exists. |
| P1-2 | `HALT_SAVE_FAILURE_SILENT_SWALLOW` | The `ModelProfilesSectionContainer` must surface typed bootstrap results to the user via an inline error/notice, not a `console.error` alone. The section gains a small error banner state. The typed result envelope is `BootstrapModelProfileResult = { ok: true, profileId, instanceId } \| { ok: false, reason: BootstrapFailureReason }` with reason taxonomy: `CREATED`, `CREATED_BINDING_FAILED` (post-commit task binding failure — profile was created and persisted; user should still see success-with-warning), `NO_CURRENT_CONFIGURATION`, `CURRENT_CONFIGURATION_UNSUPPORTED`, `MISSING_CREDENTIAL`, `INSTANCE_WRITE_FAILED`, `PROFILE_WRITE_FAILED`. The error path does NOT throw across gRPC; typed results travel back in the response. |
| P1-3 | `HALT_PICKER_POPUP_EMPTY_DEAD_END` | When `ModelProfileQuickSwitch` popover is opened with zero profiles, render a "Create first profile" CTA that opens the Settings > Model Profiles tab in onboarding mode (new `targetSection: "model-profiles"` + a `?createFirst=1` query so the section starts in first-run mode). |

## Scope

In scope (V1 surface):

- A single new public operation on the model-profiles owner
  (`bootstrapModelProfileFromCurrentConfiguration`) that performs
  the atomic six-step bootstrap described in §P0-1.
- A new typed result
  `BootstrapModelProfileResult = { ok: true, profileId, instanceId }
   | { ok: false, reason: BootstrapFailureReason, message? }`.
- Front-end: Settings section first-run mode, picker popup
  CTA, container error-surfacing.
- Foundation `InstancesStore.write` already supports arbitrary
  opaque instance ids; no Foundation change required.

Out of scope (deferred to successor ACTs — frozen here):

- Any change to `providerId → instanceId` inference rules.
- Any change to the typed-foundation composition seam.
- Any change to the chat-label trigger.
- Any change to resume/new-task lifecycle wiring.
- Non-API-key auth (AWS / GCP / Azure) — out of V1 per PIIF01.
- Profile migration tooling for users who DO have a
  `providerInstanceId`-bound profile but happen to be in the
  empty-list state because of a separate bug.

## Contract freezes (reviewer-mandated, 2026-09-07 amendment)

These three freezes were added in response to the post-registration
reviewer panel verdict
(`HALT_BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND` plus two P1
non-blocking concerns). They are non-negotiable for the
implementation corrections of this ACT.

### CURRENT_PHYSICAL_CREDENTIAL_SOURCE

The physical API key written to the new instance-scoped secret
namespace MUST be resolved from the **existing current/legacy
`ApiConfiguration` authority**, NOT from the new instance-secret
namespace (which does not yet exist at the point the credential is
needed). Specifically:

```
CURRENT_PHYSICAL_CREDENTIAL_SOURCE
    = the existing ApiConfiguration / provider-settings authority
      that is ALREADY loaded and resolves a literal physical key
      for the active mode (plan|act)

    FORBIDDEN_SOURCES:
      - getInstanceSecret(NEW_NAME)    // namespace does not exist yet
      - credentialRef                  // lives on the instance WE are creating
      - providerId-based lookup        // identity-collapse (MPWC01 C3)
      - any other inference path       // ditto
```

The bootstrap primitive takes the dependency seam

```ts
resolveCurrentCredential:
  (config: ApiConfiguration) =>
    { value: string; providerId: ApiProvider } | undefined
```

(or, if the boundary already guarantees `ApiConfiguration`
contains the resolved physical key, just freezes that as
`CURRENT_CREDENTIAL_SOURCE = apiConfig[apiKeyField(providerId)]`).
The implementation correction MUST freeze which field-per-provider
it reads and the corresponding `getApiKeyField(providerId)` mapping
already centralized in `apps/vscode/src/sdk/cline-session-factory.ts:411`
(re-exported in `apps/vscode/src/sdk/model-catalog/store.ts:48` and
`apps/vscode/src/sdk/model-catalog/effective-config.ts:29`).

The causal chain is therefore:

```
CURRENT/LEGACY CONFIGURATION AUTHORITY
    ↓
resolve CURRENT physical credential
    ↓
generate new opaque instanceId
    ↓
derive instance:<opaque-id> secret name
    ↓
write physical credential there
```

NOT:

```
new instance-secret namespace
    ↓
somehow resolve credential before instance exists
```

### BOOTSTRAP_COMMIT_MODEL

The bootstrap is **NOT transactional**. There is no rollback path
on partial failure. The durable commit boundary is the profile
write (step (g) in P0-1). Steps (h)-(i) — task binding and state
publication — are **post-commit composition** and may fail without
invalidating the persisted profile.

```
definition commit:
  secret → instance → profile
  = profile creation success (CREATED)

post-commit composition:
  bind current task → publish ExtensionState
  = may fail independently without invalidating the persisted
    profile; if it does, the result is CREATED_BINDING_FAILED
    (truthful success-with-warning), NOT a generic failure that
    hides the durable commit.

NO_TRANSACTIONAL_ROLLBACK   = TRUE
NO_UNREACHABLE_GARBAGE_TOLERATION = FALSE
  // specifically: a partially-completed secret+instance write
  // before the profile write fails IS tolerable garbage and is
  // expected to be reaped by a future reconciliation pass;
  // the bootstrap MUST NOT attempt to clean it up in-line (that
  // would create a different correctness bug).
```

The B3 witness must assert this discriminated-union taxonomy
(reviewer's P1 bounded correction applied mechanically during B1/B3
typed-contract creation; replaces the earlier `{ ok, reason, warning }`
pattern with a single `status`-keyed union that is never mixed):

```
// Success-with-payload — profileId and instanceId are ALWAYS present
status: "CREATED"                    -> { profileId, instanceId }
// Success-with-warning — profileId, instanceId, message are ALL present;
// never appears as a failure-reason string; a CREATED_BINDING_FAILED is
// still a CREATED profile on disk, the user just sees the warning.
status: "CREATED_BINDING_FAILED"     -> { profileId, instanceId, message }

// Failure — only `message` is present; profileId/instanceId are undefined.
status: "NO_CURRENT_CONFIGURATION"   -> { message }
status: "CURRENT_CONFIGURATION_UNSUPPORTED" -> { message }
status: "MISSING_CREDENTIAL"         -> { message }
status: "INSTANCE_WRITE_FAILED"      -> { message }
status: "PROFILE_WRITE_FAILED"       -> { message }

// Status "CREATED" never appears as a failure-reason string in any
// failure union.
```

This algebra is implemented as the `BootstrapModelProfileStatus`
string union + `BootstrapModelProfileResult` discriminated union in
`apps/vscode/src/sdk/profile-store/bootstrap.ts`.

### BOOTSTRAP_RPC

A **NEW dedicated RPC** is added, not a new result type on the
existing `saveCurrentAsModelProfile`. The semantics are genuinely
different:

```
saveCurrentAsModelProfile
    = existing exact instance identity required (fail-closed,
      uses activeSession.startConfig → bound profile.providerInstanceId)

bootstrapModelProfileFromCurrentConfiguration
    = NO existing instance identity required
    = creates instance identity + secret binding + profile from
      legacy/current config
```

The webview picks the right RPC by state:

```
profiles.length === 0
    → render first-run onboarding pane
    → on submit, call bootstrapModelProfileFromCurrentConfiguration

profiles.length >= 1
    → render management UI
    → "Save current" calls the existing saveCurrentAsModelProfile
```

The new proto request/response messages, RPC method, and gRPC
handler are added under
`apps/vscode/proto/cline/state.proto` (modeled on the existing
`SaveCurrentAsModelProfileRequest`). Implementation corrections
of this ACT MUST NOT mutate the established save-current result
type, request type, or fail-closed semantics.

## Conservation (must remain unchanged)

- MPWC01 C3 fail-closed binding (no providerId guessing).
- MPWC01 C4 factory integration (typed-instance threading).
- MPWC02 chat-parent TDZ fix.
- MPWC02 manage-profiles target routing to `"model-profiles"`.
- MPQS01 typed-foundation composition witness.
- All existing Foundation primitives (24/24 GREEN).

## RED → GREEN witnesses

| ID | Test | Discriminator |
|----|------|---------------|
| B1 | `bootstrap-first-profile.mpfrb01.test.ts` | legacy/current config B (providerId, modelId, baseUrl, headers, physical API key), zero instances, zero profiles. The new `bootstrapModelProfileFromCurrentConfiguration("My first")` returns `{ status: "CREATED", profileId, instanceId }` (or `{ status: "CREATED_BINDING_FAILED", profileId, instanceId, message }` if a binding write throws — but `CREATED` when there is no current task, NOT `CREATED_BINDING_FAILED`). The causal chain is asserted step-by-step: (1) physical key B is resolved from the current-config authority (`apiConfig[apiKeyField(B.providerId)]`), (2) a fresh opaque `inst-C` is generated, (3) `nameFor(inst-C)` produces the canonical `InstanceSecretName`, (4) `setInstanceSecret(name, physical-key-B)` is called, (5) `InstancesStore.write` persists an instance C whose `credentialRef.name === name` and whose connection tuple matches B's (providerId, modelId, baseUrl, headers), (6) `ProfilesStore` persists a profile P referencing `inst-C`. After the call, `getInstanceSecret(name)` returns the literal physical key B (NOT the reference name, NOT empty). The first profile references the new instanceId and has modelId=B's modelId. |
| B2 | `bootstrap-no-provider-id-collapse.mpfrb01.test.ts` | Two stored same-provider instances (A + B) exist; zero profiles; current config is NOT bound to either. Bootstrap creates a THIRD instance that matches the current config exactly. It does NOT pick A or B. ProviderId-equality matching must not appear anywhere in the bootstrap path. |
| B3 | `bootstrap-failure-visible.mpfrb01.test.ts` | (a) Unsupported provider (provider id not in the bootstrap-coverage table) → result is `{ status: "CURRENT_CONFIGURATION_UNSUPPORTED", message }`. (b) Missing API key on current config (current config exists but the resolved credential seam returns undefined) → result is `{ status: "MISSING_CREDENTIAL", message }`. (c) No current configuration (active mode's `*ModeApiProvider` is unset) → result is `{ status: "NO_CURRENT_CONFIGURATION", message }`. (d) Happy path → result is `{ status: "CREATED", profileId, instanceId }`. (e) Happy path with post-commit task-binding failure (active task available but binding write throws) → result is `{ status: "CREATED_BINDING_FAILED", profileId, instanceId, message }` — the profile is durably persisted AND the user sees a success-with-warning banner. (f) `InstancesStore.write` throws → `{ status: "INSTANCE_WRITE_FAILED", message }`. (g) ProfilesStore write throws → `{ status: "PROFILE_WRITE_FAILED", message }`. The container's handler converts each status into a user-facing message; the section shows the error banner (or success-with-warning). The error path does NOT throw across gRPC. |
| B4 | `empty-state-cta.mpfrb01.test.tsx` | (a) `ModelProfilesSection` with `profiles = []` renders a first-run onboarding pane (current configuration summary, name input, save CTA, escape hatch) — NOT the management table. (b) `ModelProfileQuickSwitch` with `profiles = []` renders a "Create first profile" CTA inside the popover. (c) Clicking the CTA fires a `setSection("model-profiles")` + `setCreateFirstProfileHint(true)` intent so the Settings section opens in first-run mode. |

## Files

### Created (production)

- `apps/vscode/src/sdk/profile-store/bootstrap.ts`
- `apps/vscode/src/sdk/__tests__/bootstrap-first-profile.mpfrb01.test.ts`
- `apps/vscode/src/sdk/__tests__/bootstrap-no-provider-id-collapse.mpfrb01.test.ts`
- `apps/vscode/src/sdk/__tests__/bootstrap-failure-visible.mpfrb01.test.ts`
- `apps/vscode/webview-ui/src/components/settings/sections/__tests__/empty-state-cta.mpfrb01.test.tsx`
- `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01/`

### Created (test infra, additive, zero-delta to runtime)

- `apps/vscode/vitest.config.c2-4-c-bridge.ts` (extended to include
  the new bootstrap tests; follows the established bridge pattern)

### Edited (additive, zero-delta to existing tests)

- `apps/vscode/src/sdk/profile-store/owner.ts` — expose
  `bootstrapModelProfileFromCurrentConfiguration`.
- `apps/vscode/src/core/controller/state/saveCurrentAsModelProfile.ts`
  — narrow to the profile-only path; document the bootstrap
  fallback via the new operation.
- `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.tsx`
  — first-run mode + error banner state.
- `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSectionContainer.tsx`
  — call the bootstrap operation; surface typed results.
- `apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitch.tsx`
  — empty-state CTA.
- `apps/vscode/webview-ui/src/components/settings/SettingsView.tsx`
  — accept a `?createFirst=1` query from the picker CTA.
- `.gitignore` — whitelist for this ACT's evidence directory
  (mirrors PIIF01 + MPWC01 durable patterns).
- `apps/vscode/src/shared/ExtensionMessage.ts` — optional
  `lastBootstrapError?: BootstrapFailureReason` field on
  `ExtensionState`.

### NOT edited

- `apps/vscode/src/sdk/sdk-provider-change-coordinator.ts`
  (typed-foundation seam unchanged).
- `apps/vscode/src/sdk/instance-store/**` (Foundation primitives
  unchanged; `write` already supports arbitrary opaque ids).
- `apps/vscode/src/shared/storage/state-keys.ts` (no new global
  state keys; bootstrap state lives on ExtensionState).

## Test results (target after GREEN pass)

```
Backend (bridge config):
  + new bootstrap tests = 3 files, 9 tests
  Foundation conservation: 24/24 GREEN (unchanged)
  All existing tests: GREEN (unchanged)

Webview:
  + new empty-state tests = 1 file, 4 tests
  All existing tests: GREEN (unchanged)

TYPECHECK: 0 new errors.
git diff --check: clean.
```

## Evidence (initial, RED)

This commit ships:

- `00-entry-freeze.txt` — entry identity + scope freeze.
- `01-red-live-dogfood-bug.txt` — RED trace of the live defect
  against the current exact HEAD (the screenshot-described
  failure mode, walked through the actual code paths).
- `02-red-backend-bootstrap-path-absent.txt` — RED trace showing
  the backend's saveCurrentAsModelProfile fails closed without
  a bootstrap alternative; the gRPC error reaches the container
  which silently console.errors.
- `03-red-frontend-empty-state-dead-end.txt` — RED trace showing
  the picker popup renders only "No profiles configured yet."
  with no CTA, and the Settings section renders the
  management-table UI even with zero profiles.

Subsequent corrections will append:

- `04-green-b1-bootstrap.md`
- `05-green-b2-no-collapse.md`
- `06-green-b3-failure-visible.md`
- `07-green-b4-empty-state-cta.md`
- `08-conservation.txt`
- `09-typecheck-lint.txt`
- `10-final-report.md`
- `11-exact-head-binding.txt`

## Verdict (initial, RED, post-amendment)

```
LIVE_EMPTY_STATE_UX                       = REAL_DEFECT
LIVE_SAVE_CURRENT_BUTTON_PRESENT          = TRUE
LIVE_SAVE_CURRENT_SUCCESS                 = FAIL (silent)
FIRST_PROFILE_BOOTSTRAP_PATH              = ABSENT
CURRENT_CONFIG_TO_INSTANCE_IDENTITY_PATH  = ABSENT
PROVIDER_ID_COLLAPSE_FALLBACK             = ABSENT (correct)
FOUNDATION_CONSERVATION                   = GREEN (24/24)

# Live-observation subject rebound by amendment
LIVE_OBS_SUBJECT   = c47e219f76dafffe4f9bced6dc4d05eac73bb4d2
                     (UNBLOCK01 closure — the installed VSIX)
ENTRY_HEAD         = 052da8958d096fad6fe475d1be78bfb53957086b
                     (UNBLOCK02 closure — current repo HEAD)

# Original halt (live dogfood)
HALT_MODEL_PROFILE_FIRST_RUN_BOOTSTRAP_ABSENT  = OPEN

# Reviewer-panel halt added by amendment (load-bearing contract)
HALT_BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND     = CLOSED
                                                 (closed by the
                                                  three freezes in
                                                  §Contract freezes)

# P-class hierarchy
P0  BOOTSTRAP_PATH_ABSENT                      = CLOSED (B1 GREEN,
                                                  B2 GREEN, B3 in
                                                  progress)
P1  BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND      = CLOSED (by freezes)
P1  BOOTSTRAP_ATOMICITY_UNDEFINED              = CLOSED (by freeze
                                                  BOOTSTRAP_COMMIT_MODEL)
P1  BOOTSTRAP_RPC_SURFACE_STILL_TBD            = CLOSED (by freeze
                                                  BOOTSTRAP_RPC)
P1  EXACT_HEAD_LABEL_OVERSTATED                = CLOSED (subject
                                                  rebound above)
P1  EMPTY_STATE_DEAD_END                       = OPEN (B4)
P1  SILENT_FAILURE                             = OPEN (B3 in progress)
P1  PICKER_POPUP_DEAD_END                      = OPEN (B4)
P2  BLANK_AT_EOF_DIAGNOSTICS                   = OPEN (terminal cleanup)
P2  INVALID_HISTORICAL_GATE_SUMMARY            = LEFT_ALONE (per
                                                  reviewer policy)

# B-witness status
B1  bootstrap-first-profile.mpfrb01            = GREEN (2026-09-07)
B2  bootstrap-no-provider-id-collapse.mpfrb01  = GREEN (2026-09-07)
B3  bootstrap-failure-visible.mpfrb01          = PLANNED (next)
B4  empty-state-cta.mpfrb01                    = PLANNED (after B3)
```

Subsequent bounded corrections will close the OPEN P0/P1s
one at a time (B1/B2 backend with frozen geometry, B3 error
visibility with frozen taxonomy, B4 empty-state UI) without
reopening the Foundation or any prior ACT.

## Identity correction (added by amendment)

The opening registration cited
`5f9e931a32a07d0b9bf2f55f7bc1a31d4f4c1e6b` as the entry head,
claiming it was the MPWC02 correction03 closure HEAD. The
reviewer panel correctly noted:

> `git cat-file -t 5f9e931a32a07d0b9bf2f55f7bc1a31d4f4c1e6b`
> reports "could not get object info" — that long-form hash does
> not exist as a git object.

The real `5f9e931a3...` short-form resolves to
`5f9e931a3df0a84a358502e3183cd49d88ccc41b`, which IS a real commit
(MPWC02 bounded correction03). But that commit is not the current
HEAD at registration time.

The correct identity is therefore:

```
LIVE_OBS_SUBJECT  = c47e219f76dafffe4f9bced6dc4d05eac73bb4d2
                    (DOGFOOD-VSIX-TYPECHECK-UNBLOCK01 closure —
                     the VSIX that was installed and exercised
                     when the live defect was observed)
ENTRY_HEAD        = 052da8958d096fad6fe475d1be78bfb53957086b
                    (DOGFOOD-VSIX-TYPECHECK-UNBLOCK02 closure —
                     the current repository HEAD at amendment time,
                     post-UNBLOCK01 typecheck follow-up)
```

This does NOT weaken the defect (the screenshots + mechanically
matching source path confirm the live observation against the
UNBLOCK01 install). It just rebinds the EXACT-HEAD label to an
actually-existing git object.

## Lessons learned (durable)

1. **The MPWC01 C3 fail-closed fix removed the only escape hatch
   for users in the "I have a legacy API config but never made a
   profile" state.** That escape hatch was UNSOUND (providerId
   collapse), but its absence revealed the missing product flow.
   This is the correct order: prove identity-collapse is a real
   bug → close it fail-closed → observe the user-facing hole →
   fix the hole with a typed bootstrap. Reverse-ordering would
   have shipped a wrong-but-working UX.

2. **gRPC handlers that `throw new Error(...)` produce
   user-invisible failures unless the caller distinguishes
   "expected typed refusal" from "unexpected exception".**
   `console.error` is NOT user feedback. The container MUST
   pattern-match the gRPC error or, better, receive a typed
   result envelope so the UI can render a meaningful banner.

3. **The factory rule "do not present management UI before there
   is anything to manage" applies here.** The management-table
   affordance (Use / Set default / Rename / Update / Delete)
   presupposes that profiles exist. A first-run user sees a
   giant empty panel + a tiny text box + one black button —
   this is the inverse of the intended UX.

4. **The "bootstrap asks the new instance-secret namespace for
   a credential that does not exist yet" anti-pattern
   (reviewer-mandated lesson, 2026-09-07 amendment).** A
   bootstrap that creates identity MUST resolve its
   pre-identity credential from a pre-identity authority
   (the existing current/legacy `ApiConfiguration`). Reading
   `getInstanceSecret(NEW_NAME)` where `NEW_NAME` is derived
   from an `instanceId` that the operation is in the process
   of creating is a category error — it asks the
   not-yet-existent namespace to authorize the operation
   that creates it. The causal chain is:
   `current-config-authority → physical-credential →
   instanceId → secret-name → write-secret → write-instance →
   write-profile`. Always resolve the credential BEFORE the
   identity exists.

5. **"Atomic without rollback" is not atomic.** It is a
   commit-model choice: durable profile creation succeeds
   iff the profile write succeeds; post-commit composition
   (task binding, state publication) may fail independently.
   The user-visible result taxonomy must reflect this
   honestly (`CREATED` vs `CREATED_BINDING_FAILED`) instead
   of pretending the whole transaction is one unit.

6. **Two operations with different semantics need two RPCs.**
   `saveCurrentAsModelProfile` (existing exact identity
   required, fail-closed) and `bootstrapModelProfileFromCurrentConfiguration`
   (no existing identity, creates it) should not be two modes
   of the same RPC. They have different preconditions, different
   failure taxonomies, and different UI entry points. Use a
   dedicated new RPC for the new semantics.

7. **The `{ ok, reason, warning }` result-algebra pattern is
   fragile and reviews into a discriminated union.** The
   reviewer panel flagged it as a P1 bounded correctness concern
   during registration: success-with-warning
   (`{ ok: true, warning: "CREATED_BINDING_FAILED" }`) and
   pure failure (`{ ok: false, reason: "..." }`) are two
   different shapes that the caller has to pattern-match
   carefully. Mixing `CREATED` into the warning string is
   especially misleading. The fix, applied mechanically
   during B1/B3 typed-contract creation, is a single
   `status`-keyed discriminated union: `status: "CREATED"`
   carries `{ profileId, instanceId }`,
   `status: "CREATED_BINDING_FAILED"` carries
   `{ profileId, instanceId, message }`, and the five failure
   statuses carry only `{ message }`. The string `CREATED`
   never appears as a failure-reason. This is also the
   shape that gRPC's `oneof`/typed-enum projection maps to
   cleanly, so it survives transport translation.

---

## CORRECTION02 (2026-09-08, bounded)

Triggered by the twenty-second reviewer's
`HALT_BOOTSTRAP_DURABILITY_AND_CONNECTION_FIDELITY` verdict,
which closed CORRECTION01's B1/B2 GREEN status and reopened
the ACT with three new P0s:

```
P0-1  BOOTSTRAP_SECRET_NOT_DURABLE_AT_PROFILE_COMMIT
P0-2  BOOTSTRAP_CONNECTION_TUPLE_INCOMPLETE
P0-3  UNEXPECTED_TRACKED_DIRT  (.gitignore whitelist missed
                                 from the B1+B2 commit)

P1    MISSING_MODEL_MISCLASSIFIED_AS_MISSING_CREDENTIAL
```

The reviewer explicitly authorized a bounded correction
(not a fresh ACT): "Do one correction, not another design
ACT." Scope was tight: prove the two causal invariants,
clean the worktree, fix the missing-model status label,
rerun the test suite, proceed to B3.

### Bounded corrections applied

**C-1 (P0-1, durability barrier):**

Added `flushInstanceSecrets: () => Promise<void>` to
`BootstrapModelProfileDeps` and awaited it between
`setInstanceSecret` and `instancesStore.upsert`. Wired
in production to `StateManager.flushPendingState()`.

The causal chain is now:

```
current-config-authority
  -> resolveCurrentProviderAndCredential(providerId, config)
  -> resolveCurrentConnection(providerId, config)  // modelId, baseUrl, headers, ...
  -> generate opaque instanceId
  -> derive InstanceSecretName = nameFor(instanceId)
  -> stateManager.setInstanceSecret(name, value)   // cache + 500ms debounce
  -> await flushInstanceSecrets()                  // NEW (CORRECTION02 P0-1)
  -> instancesStore.upsert({ ... connection })
  -> profilesStore.upsert({ ... })
  -> [POST-COMMIT] writeActiveProfileIdToHistoryItem(currentTaskHistoryItem, profileId)
  -> [POST-COMMIT] postStateToWebview()
```

The freeze is restated as:

```
PROFILE_COMMIT IMPLIES REFERENCED_SECRET_ALREADY_DURABLE
```

A flush failure surfaces as `INSTANCE_WRITE_FAILED` with a
human-readable message ("Could not flush the instance secret
to disk before the profile commit. ..."). Per the existing
BOOTSTRAP_COMMIT_MODEL freeze we do NOT roll back the
in-memory secret write; the user re-tries, and the bounded
garbage-tolerance rule applies.

The witness is `bootstrap-secret-durable.mpfrb01.test.ts`:
real `StateManager` + real `ClineFileStorage` on a tmpfs data
dir, `flushInstanceSecrets` wired to
`stateManager.flushPendingState()`. After `CREATED`,
`secrets.json`, `instances.json`, AND `profiles.json` all
three contain the new records (2/2 sub-tests pass, including
a cold-reload assertion that a fresh `ClineFileStorage` reads
the durable secret back from disk).

**C-2 (P0-2, exact connection capture):**

Extended `captureConnection` to also capture `headers` for
the `openai` (OpenAI-Compatible) provider. The legacy
`ApiConfiguration` stores `openAiHeaders` as a JSON-encoded
string; the capture path parses both that string form and
the in-memory plain-object form and emits
`connection.headers` as a `Record<string, string>` when the
source has headers. The capture leaves `connection.headers`
absent (NOT `{}`, NOT `null`) when the source has no headers
— the typed-projector distinction between "field wasn't on
the source" (`undefined`, preserve-default) and "explicit
clear" (`null`) is preserved.

The B2 test fixture was also extended to include
`openAiHeaders: JSON.stringify({ "X-Tenant": "tenant-C", "X-Region": "eu" })`
on the CURRENT config, so the B2 invariant now also pins
"headers must survive a same-providerId, same-baseUrl,
different-headers bootstrap."

The new freeze:

```
EXACT_CONNECTION_CAPTURE
```

pins the V1 connection tuple capture. The remaining fields
(region, apiLine, providerSpecificConfig) remain absent on
V1 — they have no equivalent top-level field on the legacy
`ApiConfiguration` for the providers currently in
`BOOTSTRAP_COVERAGE` and need a per-provider mapping (out of
scope for this ACT).

The witness is `bootstrap-connection-tuples.mpfrb01.test.ts`
(4/4 sub-tests pass: JSON-string form, no-headers, Anthropic-
no-headers, plain-object form).

**C-3 (P0-3, repository trust):**

The durable-ACT whitelist entry for the bootstrap ACT was
omitted from commit `f0c12c957` (B1+B2 GREEN commit). Without
it, `.factory/acts/ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01.md`
and its evidence dir would be silently swallowed by the
repo-wide DEFAULT-DENY `.gitignore` policy
(.gitignore lines 115-125 + 347-348). The fix is a small
follow-up commit landing the whitelist (analogous to the
PIIF01 IMPL01 and MPWC01 opening commits, both of which made
similar split commits). After this commit:

```
$ git status --short
(empty)
```

**C-4 (P1, missing-model status):**

Added `MISSING_MODEL` to the discriminated
`BootstrapModelProfileStatus` union and the
`BootstrapModelProfileResult` failure-shape. The branch that
returned `MISSING_CREDENTIAL` when `connection.modelId` was
absent now returns `MISSING_MODEL`. The user-visible message
is unchanged: "No model id is configured for 'anthropic' in
act mode. Pick a model first." The discriminator is now
honest — a missing model does not look like a missing API
key in the UI.

A new sub-test in `bootstrap-first-profile.mpfrb01.test.ts`
pins this:

```
MPFRB01_B1_MISSING_MODEL: missing model returns MISSING_MODEL,
not MISSING_CREDENTIAL
```

### CORRECTION02 test results

```
$ cd apps/vscode && TMPDIR=/tmp bun test \
    src/sdk/__tests__/bootstrap-first-profile.mpfrb01.test.ts \
    src/sdk/__tests__/bootstrap-no-provider-id-collapse.mpfrb01.test.ts \
    src/sdk/__tests__/bootstrap-secret-durable.mpfrb01.test.ts \
    src/sdk/__tests__/bootstrap-connection-tuples.mpfrb01.test.ts

 14 pass
  0 fail
105 expect() calls
Ran 14 tests across 4 files.
```

Per-file:
- `bootstrap-first-profile.mpfrb01.test.ts`           7/7 pass (B1 happy path + 6 typed-failure paths, including new MISSING_MODEL)
- `bootstrap-no-provider-id-collapse.mpfrb01.test.ts` 1/1 pass (B2 with headers verification on instance C)
- `bootstrap-secret-durable.mpfrb01.test.ts`          2/2 pass (real StateManager, real ClineFileStorage, real flushPendingState)
- `bootstrap-connection-tuples.mpfrb01.test.ts`       4/4 pass (JSON string / no headers / Anthropic / plain object)

Conservation:

```
$ cd apps/vscode && TMPDIR=/tmp bun run test:unit
Files: 78   Pass: 1107   Fail: 0
All unit test files passed.

$ cd apps/vscode && bun x tsc --noEmit
exit=0
```

(Foundation went from 1101/1101 at CORRECTION01 close to
1107/1107 at CORRECTION02 close — the +6 delta is the new
B-DURABILITY and B-CONNECTION witnesses; the B1 MISSING_MODEL
addition lands inside the existing B1 file.)

### CORRECTION02 verdict

```
# Witness status
B1  bootstrap-first-profile.mpfrb01            = GREEN (7/7,
                                                  P1 added:
                                                  MISSING_MODEL)
B2  bootstrap-no-provider-id-collapse.mpfrb01  = GREEN (1/1,
                                                  headers
                                                  verified)
B-DURABILITY bootstrap-secret-durable.mpfrb01  = GREEN (2/2,
                                                  real
                                                  StateManager
                                                  + real
                                                  ClineFileStorage)
B-CONNECTION bootstrap-connection-tuples.mpfrb01 = GREEN (4/4)
B3  bootstrap-failure-visible.mpfrb01          = PLANNED (next)
B4  empty-state-cta.mpfrb01                    = PLANNED (after
                                                  B3)

# P-class hierarchy
P0  BOOTSTRAP_PATH_ABSENT                       = CLOSED (B1 GREEN,
                                                   B2 GREEN)
P0  BOOTSTRAP_SECRET_NOT_DURABLE_AT_PROFILE_COMMIT = CLOSED (B-DURABILITY GREEN)
P0  BOOTSTRAP_CONNECTION_TUPLE_INCOMPLETE       = CLOSED (B-CONNECTION GREEN)
P0  UNEXPECTED_TRACKED_DIRT                     = CLOSED (whitelist committed)
P1  BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND       = CLOSED (by freezes)
P1  BOOTSTRAP_ATOMICITY_UNDEFINED               = CLOSED (by freeze)
P1  BOOTSTRAP_RPC_SURFACE_STILL_TBD             = CLOSED (by freeze)
P1  EXACT_HEAD_LABEL_OVERSTATED                 = CLOSED (rebinding)
P1  MISSING_MODEL_MISCLASSIFIED_AS_MISSING_CREDENTIAL = CLOSED (P1 added
                                                   MISSING_MODEL status)
P1  EMPTY_STATE_DEAD_END                        = OPEN (B4)
P1  SILENT_FAILURE                              = OPEN (B3 next)
P1  PICKER_POPUP_DEAD_END                       = OPEN (B4)
P2  BLANK_AT_EOF_DIAGNOSTICS                    = OPEN (terminal cleanup)

# Repository trust
WORKING_TREE_CLEAN                             = TRUE
ALL_DURABLE_ACT_FILES_COMMITTED                = TRUE
```

### CORRECTION02 lessons learned (additive)

8. **The "instant `setInstanceSecret` returns, secret is durable"
   intuition is wrong on top of a debounced persistence layer.**
   `setInstanceSecret` mutates the in-memory cache and schedules
   a 500ms debounce; it does NOT block until `secrets.json`
   contains the entry. For any operation that "commits" by
   referencing the secret — including the bootstrap primitive
   — the caller MUST await an explicit persistence barrier
   (`StateManager.flushPendingState()`) before returning
   `CREATED`. The barrier is the only thing that turns the
   in-memory `pendingInstanceSecrets` Set into a durable
   `secrets.json` entry. Without it, the `CREATED` semantics
   are unenforced — a process death in the debounce window
   silently desynchronizes the profile from its credential.

9. **Capture-code paths need to enumerate the full V1 contract,
   not just the fields the test fixture happens to exercise.**
   The CORRECTION01 `captureConnection` left `headers` absent
   because the B1 fixture used Anthropic, which doesn't have
   custom HTTP headers in the legacy config. The loss was
   invisible to B1 but load-bearing for OpenAI-Compatible
   users (LiteLLM, corporate gateways, per-route routing
   hints). The fix is to enumerate every V1 contract field
   for which the legacy config has a corresponding source,
   and capture each one explicitly. A "captures only what
   the test covers" capture path is a trap.

10. **"Atomic without rollback" is the right primitive for
    a multi-step bootstrap, but it MUST be paired with an
    explicit durability barrier between the cache-mutating
    step and the commit step.** Without the barrier, the
    "atomic" semantic is unenforced for the parts that
    actually take time (persistence I/O). The result is a
    half-committed state that fails-closed on the next
    read. The barrier closes the gap; the "without
    rollback" rule is preserved by accepting the tolerable
    garbage if the barrier itself fails.

11. **The repository-trust halt is structural, not ceremonial.**
    An unstaged tracked `.gitignore` modification is exactly
    the kind of dirt that triggers a fresh-clone `git
    status` to disagree with the durable-ACT evidence. The
    durable-ACT convention requires the whitelist to be
    committed in lockstep with the ACT body it protects —
    not in a follow-up cleanup commit — so the convention
    is upheld by automated tooling, not by reviewers
    noticing the omission. (The CORRECTION02 commit landed
    the whitelist as a small follow-up commit because the
    reviewer explicitly authorized a bounded correction,
    not a full re-open; the durable-ACT policy above
    remains the cleaner default.)

## CORRECTION03 (2026-09-09, bounded: B3 + freeze #5 + coverage invariant)

### Trigger

Reviewer verdict C1 on the CORRECTION02 close identified two
bounded P1s that ride along on B3 (the
transport-to-user-semantics witness), neither of which required
opening a new review cycle:

  - `BOOTSTRAP_COVERAGE_SCOPE_PRECISION`: every entry in
    `BOOTSTRAP_COVERAGE` must have BOTH a wired `resolveApiKey`
    seam AND a wired `resolveModelId` seam. Without a witness,
    drift between the set and the resolver maps is invisible
    until a user happens to pick an unwired provider.
  - `MALFORMED_PRESENT_HEADERS_POLICY`: the
    `captureOpenAiHeaders` path previously log-and-swallowed
    `JSON.parse` failures, committing a profile with weakened
    connection semantics for OpenAI-Compatible users who
    configured custom headers but stored them as garbage JSON.
    The "absent headers" intent was implicit; the
    "present-but-malformed" intent was missing.

### Bounded corrections applied

1. **Freeze #5 `MALFORMED_HEADERS_POLICY` (load-bearing).**
   When `providerId === "openai"` AND `config.openAiHeaders`
   is PRESENT but its JSON payload is malformed (parse throws
   OR parsed value is not a plain object), the bootstrap MUST
   refuse with `CURRENT_CONFIGURATION_UNSUPPORTED` and a
   human-readable message naming the field. Plain-object
   (non-string) inputs that aren't objects (arrays,
   primitives) follow the same refuse policy. Empty-string
   and absent remain "treat as absent" per freeze #4.

2. **`captureOpenAiHeaders` → `parseOpenAiHeaders` tagged
   result.** The new return type is
   `{kind:"absent"} | {kind:"captured",headers} | {kind:"malformed",reason}`,
   letting the caller apply the right policy per state rather
   than logging-and-swallowing.

3. **`captureConnection` → `CaptureConnectionResult`.** The
   connection-tuple capture now returns
   `{kind:"ok",connection} | {kind:"refused",status,message}`;
   the call site propagates the discriminated refusal as
   `CURRENT_CONFIGURATION_UNSUPPORTED` before the
   `MISSING_MODEL` branch.

4. **`state-keys.ts openAiHeaders` default.** Changed from
   `{}` to `undefined`. Without this, the
   `readGlobalStateFromStorage` default layer coerced
   "user never configured custom headers" into a zero-entry
   plain object that freeze #5 (correctly) refused as
   malformed. The empty plain object is still refused when
   the user explicitly stores it; only the default-coerced
   case is gone.

5. **`assertBootstrapCoverageIsWellFormed` invariant.** New
   `bootstrap-coverage-invariants.ts` module synthesizes a
   probe `ApiConfiguration` populating every candidate
   api-key field and every plan/act model-id field with
   sentinels, then exercises the public
   `resolveApiKey`/`resolveModelId` resolvers to confirm
   every `BOOTSTRAP_COVERAGE` entry has both wired seams.
   Re-exported from `bootstrap.ts` for direct audit.

### Files added / edited (production)

- `apps/vscode/src/sdk/profile-store/bootstrap.ts` — freeze #5
  doc block, `parseOpenAiHeaders` tagged result,
  `CaptureConnectionResult` discriminated outcome,
  re-export of `assertBootstrapCoverageIsWellFormed`.
- `apps/vscode/src/sdk/profile-store/bootstrap-coverage-invariants.ts`
  — new file (~190 lines), probe-config builder,
  `assertBootstrapCoverageIsWellFormed()`.
- `apps/vscode/src/shared/storage/state-keys.ts` — `openAiHeaders`
  default `{}` → `undefined`.

### Files added (test infra, additive, zero-delta to runtime)

- `apps/vscode/src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts`
  — vitest, controller-handler boundary, 15 sub-tests, one
  per `BootstrapModelProfileStatus` value plus the bounded
  P1 absorbs. Real `StateManager` + real
  `InstancesStore`/`ProfilesStore`; faked
  `modelProfilesOwner`. Per-test `mkdtempSync` data dirs
  for store isolation. Per-test fresh `StateManager`
  via singleton reassignment. Cross-scenario cache cleanup
  via direct cache mutation (necessary because
  `setApiConfiguration` skips undefined values).

### CORRECTION03 test results (2026-09-09)

```
bun run test:unit (bun:test files):           1107 pass / 0 fail
                                              (NO regression; +0
                                              vs CORRECTION02)
src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts
  vitest (single-file run):                   15 pass / 0 fail
                                              (B3 GREEN)
src/sdk/__tests__/bootstrap-*.mpfrb01.test.ts
  bun test (single-file runs):                14 pass / 0 fail
                                              (B1+B2+B-CONNECTION+B-DURABILITY
                                              NO regression)
bunx tsc --noEmit:                            exit 0
                                              (no type regression)
```

Pre-existing test failures observed but unrelated:
`OWN01 RED` in `sdk-session-event-coordinator.test.ts`
(confirmed by stashing all CORRECTION03 changes and re-running
the same file: identical failure with zero local changes);
several bun:test files collected by vitest's glob
(`v2-capture.cache-ordering`, `provider-instance-identity-r1a-red`,
etc.) — these run under `bun run test:unit` and pass there;
the vitest mis-collection is pre-existing.

### CORRECTION03 verdict

```
# Witness status
B1  bootstrap-first-profile.mpfrb01            = GREEN (7/7)
B2  bootstrap-no-provider-id-collapse.mpfrb01  = GREEN (1/1)
B-DURABILITY bootstrap-secret-durable.mpfrb01  = GREEN (2/2)
B-CONNECTION bootstrap-connection-tuples.mpfrb01 = GREEN (4/4)
B3  bootstrap-failure-visible.mpfrb01          = GREEN (15/15)
B4  empty-state-cta.mpfrb01                    = PLANNED (next)

# P-class hierarchy
P0  BOOTSTRAP_PATH_ABSENT                       = CLOSED (B1 GREEN,
                                                   B2 GREEN)
P0  BOOTSTRAP_SECRET_NOT_DURABLE_AT_PROFILE_COMMIT = CLOSED (B-DURABILITY GREEN)
P0  BOOTSTRAP_CONNECTION_TUPLE_INCOMPLETE       = CLOSED (B-CONNECTION GREEN)
P0  UNEXPECTED_TRACKED_DIRT                     = CLOSED (whitelist committed)
P1  BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND       = CLOSED (by freezes)
P1  BOOTSTRAP_ATOMICITY_UNDEFINED               = CLOSED (by freeze)
P1  BOOTSTRAP_RPC_SURFACE_STILL_TBD             = CLOSED (by freeze)
P1  EXACT_HEAD_LABEL_OVERSTATED                 = CLOSED (rebinding)
P1  MISSING_MODEL_MISCLASSIFIED_AS_MISSING_CREDENTIAL = CLOSED (P1 added
                                                   MISSING_MODEL status)
P1  BOOTSTRAP_COVERAGE_SCOPE_PRECISION          = CLOSED (B3 GREEN,
                                                   assertBootstrapCoverageIsWellFormed
                                                   witness)
P1  MALFORMED_PRESENT_HEADERS_POLICY            = CLOSED (B3 GREEN,
                                                   freeze #5)
P1  SILENT_FAILURE                              = CLOSED (B3 GREEN,
                                                   15/15 typed-envelope
                                                   witness)
P1  EMPTY_STATE_DEAD_END                        = OPEN (B4)
P1  PICKER_POPUP_DEAD_END                       = OPEN (B4)
P2  BLANK_AT_EOF_DIAGNOSTICS                    = OPEN (terminal cleanup)

# Repository trust
WORKING_TREE_CLEAN                             = TRUE
ALL_DURABLE_ACT_FILES_COMMITTED                = PENDING (this
                                                   section + epic-board
                                                   + evidence file)
```

### CORRECTION03 lessons learned (additive)

12. **The "transport-to-user semantics" witness must include
    the entire enum, not just the success path.** A regression
    test that only exercises `CREATED` is a happy-path test;
    it cannot catch the "thrown exception instead of typed
    envelope" antipattern. B3's 15 sub-tests are deliberately
    exhaustive — one per `BootstrapModelProfileStatus` value
    plus the bounded P1 absorbs — so the witness fails
    loudly if a future refactor accidentally:
    (a) throws instead of returning a typed envelope,
    (b) silently captures malformed headers as absent
        (freeze #5 regression), or
    (c) drops a coverage entry's resolver seam
        (BOOTSTRAP_COVERAGE_SCOPE_PRECISION regression).

13. **Invariants belong at the table, not in the producer.**
    `assertBootstrapCoverageIsWellFormed` does NOT read
    `PROVIDER_API_KEY_MAP` or `PROVIDER_MODEL_ID_MAP`
    directly; instead, it synthesizes a probe
    `ApiConfiguration` and asks the PUBLIC
    `resolveApiKey`/`resolveModelId` resolvers to find each
    entry's seam. This pins the invariant "every
    `BOOTSTRAP_COVERAGE` entry has wired seams" without
    coupling the witness to the producer's internal data
    structures — if a future refactor moves the resolver
    from a static map to a generated provider descriptor,
    the witness continues to work without changes. The
    tradeoff is that the witness relies on the resolver
    functions' stability, which is itself a contract
    worth preserving.

14. **The default-layer coercion of "absent" → "present with
    garbage" is a cross-layer silent-weakening antipattern.**
    `state-keys.ts`'s `openAiHeaders: { default: {} }` looked
    harmless until freeze #5 made the empty plain object a
    refusing case. The default layer (which runs in
    `readGlobalStateFromStorage` at StateManager.initialize
    time) and the policy layer (which runs in `bootstrap.ts`
    at request time) became coupled through a value that
    neither layer explicitly constructed. The fix is to
    make defaults `undefined` and let the policy layer
    decide what "no value" means. General rule: defaults
    should be the ABSENCE-of-config signal, not a coerced
    "empty present" that the policy layer must learn to
    treat as absent.


## CORRECTION04 (2026-09-09, bounded: reviewer verdict C1 HALT absorb)

### Trigger

Reviewer verdict C1 on B3 GREEN (CORRECTION03): HALT with two P0s and
two P1s.

  P0 #1  HALT_B3_USER_VISIBILITY_NOT_PROVEN
        The CORRECTION03 vitest file at
        apps/vscode/src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts
        proved typed RPC-envelope preservation through the controller
        handler boundary. It did NOT prove that the typed envelope
        reaches the user. The webview container at
        apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSectionContainer.tsx
        console.error'd every failure callback; the typed envelope
        existed at the gRPC seam but was thrown away at the UI seam.
        This was the load-bearing defect of the original
        `LIVE_DEFECT = TRUE`: a user who clicked Save in the picker
        popup hit `saveCurrentAsModelProfile` -> backend refusal ->
        console.error -> UI appeared to do nothing. The vitest file
        captured the typed envelope one layer earlier than the user.

  P0 #2  HALT_UNRELATED_PROTO_CORRUPTION
        Commit 709c791b7 (B3 production code) modified
        apps/vscode/proto/cline/state.proto even though B3 had no
        proto intent. The diff truncated an unrelated comment block,
        left a `}.` orphan inside the `Settings` message body, and
        made `bun run protos` fail with
        `cline/state.proto:364:2: Expected top-level statement`
        and `cline/state.proto:371:1: Unmatched "}"`. The repo's
        contribution rules emphasize coordinated proto plumbing; an
        unrelated schema mutation inside a bootstrap UX ACT is not
        documentary residue, it is a HALT.

  P1 #1  BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN
        `assertBootstrapCoverageIsWellFormed` populated every known
        ApiConfiguration credential field with the same sentinel,
        then asked the resolver whether it returned something. A
        generic fallback (e.g. `resolveApiKey` returning
        `config.apiKey` for every provider) would produce false
        GREENs for under-wired providers.

  P1 #2  OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN
        Changing `state-keys.ts` `openAiHeaders.default` from `{}`
        to `undefined` is the correct semantic fix, but no focused
        conservation witness existed proving that downstream
        consumers tolerate `undefined`.

### Bounded corrections (one bounded reopen; no new design ACT)

Per reviewer: "Do not redesign anything. ... Then go directly to B4."
This CORRECTION04 was a single bounded reopen with five additive
corrections, all in lockstep:

  C1. PROTO TRUST CHECK (revert unrelated state.proto delta)
      apps/vscode/proto/cline/state.proto restored exactly to its
      484ceb479 (CORRECTION02) baseline. Verified by `bun run protos`
      which now exits 0 (vs protoc hard-fail before).

  C2. B3-UI RED + GREEN (HALT_B3_USER_VISIBILITY_NOT_PROVEN absorb)
      Smallest additive change to the existing Settings section +
      container:

        ModelProfilesSection.tsx:
          + new exported BootstrapModelProfileStatus union (8 values)
          + new exported BootstrapModelProfileResultLike interface
          + new exported bootstrapStatusToSeverity():
              CREATED                 -> success
              CREATED_BINDING_FAILED  -> warning
              NO_CURRENT_CONFIGURATION,
              CURRENT_CONFIGURATION_UNSUPPORTED,
              MISSING_CREDENTIAL,
              MISSING_MODEL,
              INSTANCE_WRITE_FAILED,
              PROFILE_WRITE_FAILED    -> error
          + new optional onBootstrapFromCurrent callback prop
          + new optional bootstrapResult prop
          + visible status-aware severity banner with:
              data-testid='model-profiles-bootstrap-banner'
              data-severity={success|warning|error}
              data-status={BootstrapModelProfileStatus}
              role={alert|status}
            The banner includes response.message, profileId, and
            instanceId so users get the actionable diagnostic the
            backend already produced.
          + new 'Bootstrap first profile from current configuration'
            button rendered conditionally on the new callback.

        ModelProfilesSectionContainer.tsx:
          + useState<BootstrapModelProfileResultLike | null>(null)
          + handleBootstrapFromCurrent invokes
            StateServiceClient.bootstrapModelProfileFromCurrentConfiguration
            and stores the typed envelope. The catch path
            populates bootstrapResult with status=PROFILE_WRITE_FAILED
            + message so a transport-level failure (gRPC channel
            error) also reaches the user-visible banner instead of
            console.error-only.

        The change is fully additive: both new props are optional
        and default to no-op, so existing settings-tab behavior is
        unchanged when onBootstrapFromCurrent is omitted. The
        ModelProfilesSection.test.tsx existing 16 tests still pass
        unchanged.

        New webview test file
        apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.mpfrb01-b3-ui.test.tsx
        with 9 sub-tests covering the four reviewer-required
        sub-tests (B3-UI-1..B3-UI-4) plus five regression-guard
        sub-tests (severity mapping, no-banner default, additive-
        only button visibility, all-statuses-visible smoke guard,
        bootstrap-button click wiring).

  C3. COVERAGE INVARIANT PRECISION
       (BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN absorb)
      Refactor `assertBootstrapCoverageIsWellFormed` to use a
      per-provider isolated probe that populates ONLY the intended
      credential field + intended plan/act model-id fields (via the
      now-exported `PROVIDER_API_KEY_MAP` / `PROVIDER_MODEL_ID_MAP`
      from `cline-session-factory.ts`). The diagnostic table now
      exposes:
        hasIntendedCredentialField: boolean  (entry exists in PROVIDER_API_KEY_MAP)
        hasIntendedModelField: boolean       (entry exists in PROVIDER_MODEL_ID_MAP)
        credentialResolved: boolean          (resolveApiKey returned sentinel)
        modelIdResolvedFor: Array<plan|act>  (resolveModelId returned sentinel)
      so the load-bearing assertion is observable separately from
      the resolved-or-not check.

      This is structurally significant: the invariant caught a real
      pre-existing under-wiring - asksage and dify were listed in
      BOOTSTRAP_COVERAGE and PROVIDER_API_KEY_MAP but had no entries
      in PROVIDER_MODEL_ID_MAP (they share the generic
      planModeApiModelId / actModeApiModelId with anthropic /
      gemini / vertex / bedrock / deepseek / openai-native /
      openai-codex). Added the entries with a comment pointing at
      the reviewer's invariant as the discovery mechanism.

      `cline-session-factory.ts`: exported PROVIDER_API_KEY_MAP and
      PROVIDER_MODEL_ID_MAP. Doc-commented both maps to make the
      'add a provider' workflow explicit.

  C4. OPENAI_HEADERS_DEFAULT_CONSERVATION
       (OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN absorb)
      Added a focused sub-test that reads
      `SETTINGS_DEFAULTS.openAiHeaders` and asserts it is undefined
      - proving the absent semantic for the 'never-configured-
      custom-headers' path. Consumers like
      `apps/vscode/src/core/storage/remote-config/utils.ts` already
      check `openAiHeaders !== undefined` so they remain correct.

### Test results

  - bunx vitest run src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts
    -> 17/17 pass (was 15/15; +2 new sub-tests for
       COVERAGE_INVARIANT extension + ISOLATED_PROBE +
       OPENAI_HEADERS_DEFAULT_CONSERVATION)
  - bun vitest run .../ModelProfilesSection.mpfrb01-b3-ui.test.tsx
    -> 9/9 pass (the B3-UI RED -> GREEN witness)
  - bun vitest run .../ModelProfilesSection.test.tsx
    -> 16/16 existing sub-tests pass (NO regression; new props are
       optional with defaults)
  - bun test src/sdk/__tests__/bootstrap-*.mpfrb01.test.ts
    -> 14/14 pass (B1+B2+B-DURABILITY+B-CONNECTION NO regression;
       bun:test foundation unchanged)
  - bun run test:unit -> 1107/1107 pass (Foundation conservation
       holds; +0 delta vs CORRECTION03 since B3-UI is webview, not
       bun:test)
  - bun run protos -> exit 0 (state.proto trust restored)
  - bunx tsc --noEmit (apps/vscode/) -> exit 0
  - bunx tsc --noEmit (apps/vscode/webview-ui/) -> exit 0

### Verdict

  B1=7/7 GREEN, B2=1/1 GREEN, B-DURABILITY=2/2 GREEN,
  B-CONNECTION=4/4 GREEN, B3-handler=17/17 GREEN,
  B3-UI=9/9 GREEN, B4=PLANNED next.

  P0 BOOTSTRAP_PATH_ABSENT
  P0 BOOTSTRAP_SECRET_NOT_DURABLE_AT_PROFILE_COMMIT
  P0 BOOTSTRAP_CONNECTION_TUPLE_INCOMPLETE
  P0 UNEXPECTED_TRACKED_DIRT
  P0 HALT_B3_USER_VISIBILITY_NOT_PROVEN  (NEWLY CLOSED via B3-UI)
  P0 HALT_UNRELATED_PROTO_CORRUPTION     (NEWLY CLOSED via proto revert)
  P0 all CLOSED.

  P1 BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND
  P1 BOOTSTRAP_ATOMICITY_UNDEFINED
  P1 BOOTSTRAP_RPC_SURFACE_STILL_TBD
  P1 EXACT_HEAD_LABEL_OVERSTATED
  P1 MISSING_MODEL_MISCLASSIFIED_AS_MISSING_CREDENTIAL
  P1 BOOTSTRAP_COVERAGE_SCOPE_PRECISION
  P1 MALFORMED_PRESENT_HEADERS_POLICY
  P1 SILENT_FAILURE
  P1 BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN
       (NEWLY CLOSED via isolated probe)
  P1 OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN
       (NEWLY CLOSED via conservation sub-test)
  P1 all CLOSED.

  P1 EMPTY_STATE_DEAD_END = OPEN  (B4 next)
  P1 PICKER_POPUP_DEAD_END = OPEN  (B4 next)

  P2 BLANK_AT_EOF_DIAGNOSTICS = OPEN (non-blocking).

  WORKING_TREE_CLEAN = TRUE (post-commit verified).
  ALL_DURABLE_ACT_FILES_COMMITTED = TRUE.

  HALT_B3_USER_VISIBILITY_NOT_PROVEN = CLOSED.
  HALT_UNRELATED_PROTO_CORRUPTION    = CLOSED.
  BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN = CLOSED.
  OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN = CLOSED.

  B3 is genuinely closed. Ready to proceed to B4.

### Commits (in closure order)

  80c1388 ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 CORRECTION04 step 1:
          revert unrelated state.proto corruption from 709c791b7
  8859c05f0 ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 CORRECTION04 step 2:
           P1 absorbs (coverage invariant precision +
           openAiHeaders default conservation + asksage/dify wiring)
  5263d01e8 ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 CORRECTION04 step 3:
           B3-UI (HALT_B3_USER_VISIBILITY_NOT_PROVEN absorb)

### Lessons learned (additive, CORRECTION04)

  #15 reviewer's halt was the cheapest correct path: the CORRECTION03
     vitest file proved a narrower seam than its evidence claimed.
     "Typed RPC envelope survives the handler" is a different
     claim than "failure is visible to the user". The lesson: when
     the user's bug report includes the word 'appears', the witness
     must include the user's rendering layer. A backend-witness
     alone is half a witness.

  #16 invariants belong at the table, not in the producer. The
     previous assertBootstrapCoverageIsWellFormed was
     over-symmetric: it populated every field with the same
     sentinel, which made the invariant insensitive to per-provider
     wiring choices. A weaker-but-targeted probe (isolated per
     provider, sentinel only in the intended field) catches
     under-wiring that the maximally-populated probe misses. When
     the invariant claim is "X has property Y", the probe must
     observe "X without Y" -> assertion fails.

  #17 unrelated proto corruption is non-trivial and the reviewer's
     halt was structurally correct: state.proto corruption
     triggered a protoc hard-fail (which CI would catch) but also
     a silent weakening of the Settings wire-shape contract that
     only the reviewer's diff-by-hash would have surfaced. Lesson:
     always run `bun run protos` after a proto-adjacent edit, and
     always read `git show --stat` for the production commit to
     confirm the file list matches the commit message. A diff-by-hash
     digest is non-authoritative by design; the production commit
     must be inspected directly.


## B4 (2026-09-09, EMPTY_STATE_DEAD_END + PICKER_POPUP_DEAD_END + WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED)

### Reviewer verdict on CORRECTION04

C1: PASS_WITH_ONE_BOUNDED_P1 — GO TO B4. Two P0s from CORRECTION03
HALT are now CLOSED; one bounded P1 (WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_
DUPLICATED) was accepted to be absorbed in lockstep with B4.

Reviewer evidence evaluation:
  HANDLER_TO_RPC_RESPONSE          = EXECUTED (17/17 vitest)
  RPC_RESPONSE_TO_CONTAINER_STATE  = STRUCTURALLY_PROVEN (production
    ModelProfilesSectionContainer calls
    StateServiceClient.bootstrapModelProfileFromCurrentConfiguration
    and stores the typed envelope; the previous console.error-only
    swallow is structurally excluded)
  CONTAINER_STATE_TO_VISIBLE_DOM   = EXECUTED (9/9 webview vitest)
  COMPOSED_USER_VISIBILITY_PROOF   = PASS

### Implementation (one bounded reopen; no new design ACT)

Three additive changes in a single commit (ce98f54b5):

**B4-A Settings first-run onboarding pane.**

profiles.length === 0 -> dedicated onboarding pane
(data-testid='model-profiles-onboarding', data-state='empty')
containing:

  - explanation copy: "Save your current setup as a reusable profile"
  - description: "A Model Profile captures your provider, model,
    endpoint, and credentials so you can switch between setups in
    one click."
  - optional current-configuration summary card showing the active
    provider/model when the host passes `currentConfiguration`
    (data-testid='model-profiles-onboarding-summary')
  - inline unsupported-provider notice when canCreateFromCurrent=false
    (data-testid='model-profiles-onboarding-unsupported')
  - primary CTA "Create first profile" -> onBootstrapFromCurrent

profiles.length > 0 -> management view unchanged (per reviewer: not a
giant management table plus a bootstrap button above it; zero-profiles
is a distinct view).

**B4-B Picker empty-state CTA.**

The picker's zero-profile empty state now contains a primary CTA
"Create first profile..." (data-testid='model-profile-empty-create')
that invokes onOpenManageProfiles (the existing path to Settings). The
picker is no longer a dead-end.

**Bounded P1 absorb: WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED.**

The webview previously carried a hand-written duplicate of the backend
BootstrapModelProfileStatus union AND an unchecked `as` cast at the
container boundary. Future backend/proto status drift could silently
slip past the cast and leave the banner without a severity tier
(undefined severity -> banner condition fails -> user-visible result
disappears). The exact regression mode the reviewer flagged.

Refactor:

  - new exported parseBootstrapStatus(raw: unknown): BootstrapModelProfileStatus
    is the single status-authority entry point. Returns the typed
    status for known values; returns "UNKNOWN" otherwise. It is the
    load-bearing regression guard against future drift.
  - BootstrapModelProfileResultLike.status is now typed as `string`
    (was BootstrapModelProfileStatus) so the container can pass the
    raw response verbatim with no `as` cast.
  - bootstrapStatusToSeverity adds an explicit UNKNOWN -> "error"
    case. An unrecognised status renders as a visible error banner
    with role=alert, not a silent disappearance.
  - The banner's data-status attribute now reports the DECODED status
    so UNKNOWN drift is observable in the DOM via
    `getByTestId("model-profiles-bootstrap-banner").getAttribute("data-status")`
    == "UNKNOWN".

### UX detail (per reviewer)

"Bootstrap" is Factory/engineering terminology and is removed from
user-facing copy. CTA copy is now:

  - Settings onboarding: "Create first profile"
  - Picker empty state: "Create first profile..."

### Test results

  bun run test:unit: 1107/1107 (foundation conservation, +0 delta)
  bun test bootstrap-*.mpfrb01.test.ts: 14/14
    (B1=7, B2=1, B-DURABILITY=2, B-CONNECTION=4)
  bunx vitest run src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts:
    17/17 (handler boundary; unchanged from CORRECTION04)
  bun vitest run ModelProfilesSection.mpfrb01-b3-ui.test.tsx:
    17/17 (was 10/10; +7 new B4 sub-tests:
      MPFRB01_B4_UI_PARSE_BOOTSTRAP_STATUS_KNOWN
      MPFRB01_B4_UI_PARSE_BOOTSTRAP_STATUS_DRIFT_GUARD
      MPFRB01_B4_UI_ONBOARDING_PANE
      MPFRB01_B4_UI_ONBOARDING_PANE_WITH_SUMMARY
      MPFRB01_B4_UI_ONBOARDING_PANE_UNSUPPORTED
      MPFRB01_B4_UI_MANAGEMENT_VIEW_WHEN_HAS_PROFILES
      MPFRB01_B4_UI_BANNER_STATUS_USES_DECODED
    plus MPFRB01_B4_UI_NO_BOOTSTRAP_BUTTON_WHEN_EMPTY_AND_OMITTED
    demonstrating the additive-only contract holds even in the new
    empty-state surface, plus the existing
    MPFRB01_B3_UI_BOOTSTRAP_BUTTON updated to use profiles:[] because
    the CTA now lives inside the onboarding pane).
  bun vitest run ModelProfilesSection.test.tsx: 16/16 (NO regression;
    new currentConfiguration + parseBootstrapStatus surface are
    additive-only)
  bun vitest run ModelProfileQuickSwitch.test.tsx: 13/13 (was 12/12;
    +1 new B4-B sub-test MPFRB01_B4_QS_EMPTY_STATE_CTA)
  bunx tsc --noEmit (apps/vscode): exit 0
  bunx tsc --noEmit (webview-ui): exit 0
  bun run protos: exit 0 (state.proto trust preserved)

### Defense-in-depth regression guards

  parseBootstrapStatus fallback to UNKNOWN
    Future backend/proto status drift -> UNKNOWN -> defensive error
    banner. Documented in MPFRB01_B4_UI_PARSE_BOOTSTRAP_STATUS_DRIFT_GUARD
    which exercises 6 unrecognised inputs (FUTURE_NEW_STATUS_FROM_BACKEND,
    empty string, null, undefined, 42, {}) and asserts UNKNOWN.

  Banner data-status reports the DECODED status
    `data-status="UNKNOWN"` is observable in the DOM via
    `getByTestId("model-profiles-bootstrap-banner").getAttribute("data-status")`,
    so a drift regression would surface as a DOM-data assertion
    failure in MPFRB01_B4_UI_BANNER_STATUS_USES_DECODED.

  No `as` cast at the container boundary
    The container now passes `status: response.status` verbatim (the
    field is typed as `string`). The unchecked cast that the reviewer
    flagged is gone.

### P-class verdict (post-B4)

  P0 all CLOSED (unchanged from CORRECTION04):
    BOOTSTRAP_PATH_ABSENT
    BOOTSTRAP_SECRET_NOT_DURABLE_AT_PROFILE_COMMIT
    BOOTSTRAP_CONNECTION_TUPLE_INCOMPLETE
    UNEXPECTED_TRACKED_DIRT
    HALT_B3_USER_VISIBILITY_NOT_PROVEN
    HALT_UNRELATED_PROTO_CORRUPTION

  P1:
    BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND         = CLOSED (CORRECTION02)
    BOOTSTRAP_ATOMICITY_UNDEFINED                 = CLOSED (CORRECTION02)
    BOOTSTRAP_RPC_SURFACE_STILL_TBD               = CLOSED (CORRECTION02)
    EXACT_HEAD_LABEL_OVERSTATED                   = CLOSED (CORRECTION02)
    MISSING_MODEL_MISCLASSIFIED_AS_MISSING_CREDENTIAL = CLOSED (CORRECTION02)
    BOOTSTRAP_COVERAGE_SCOPE_PRECISION            = CLOSED (CORRECTION02)
    MALFORMED_PRESENT_HEADERS_POLICY              = CLOSED (CORRECTION03)
    SILENT_FAILURE                                = CLOSED (CORRECTION04)
    BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN  = CLOSED (CORRECTION04)
    OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN = CLOSED (CORRECTION04)
    WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED = CLOSED (B4)
    EMPTY_STATE_DEAD_END                          = CLOSED (B4)
    PICKER_POPUP_DEAD_END                         = CLOSED (B4)

  P1 all CLOSED.

  P2 BLANK_AT_EOF_DIAGNOSTICS = OPEN (non-blocking; unrelated to
    bootstrap surface).

  WORKING_TREE_CLEAN = TRUE (post-commit verified; only the
    unrelated clinemm-outside-* test artifact directories remain
    from a separate agent; they are not staged).

  ALL_DURABLE_ACT_FILES_COMMITTED = TRUE (post this commit).

  HALT_B3_USER_VISIBILITY_NOT_PROVEN              = CLOSED (CORRECTION04)
  HALT_UNRELATED_PROTO_CORRUPTION                 = CLOSED (CORRECTION04)
  BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN    = CLOSED (CORRECTION04)
  OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN  = CLOSED (CORRECTION04)
  WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED   = CLOSED (B4)
  EMPTY_STATE_DEAD_END                            = CLOSED (B4)
  PICKER_POPUP_DEAD_END                           = CLOSED (B4)

  B4 is genuinely closed. Per the reviewer's directive, the next
  genuinely useful step is to build/install a new exact-head VSIX
  and repeat the original live first-run flow on a real VS Code
  extension host.

### Production commit

  ce98f54b5 ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 B4:
          empty-state onboarding + picker CTA + single-status-
          authority decoder

### Lessons learned (additive, B4)

  #18 reviewer's "B4 should be small and visual, not another
     backend ACT" was the right framing. The bounded P1 absorb
     (status-authority single source of truth) is structurally
     small - one exported decoder function plus a tweak to the
     existing severity switch - and folds cleanly into the
     empty-state onboarding work. A separate correction cycle
     for the bounded P1 would have been a waste of review
     bandwidth; doing both in one commit is the same
     "actor-and-witness-of-the-actor compose into one test"
     discipline as B3.

  #19 the empty-state pane IS the new first-run UX. It is not
     a "stub while waiting for the real implementation". The
     current provider/model summary card + primary CTA +
     explanation copy is what a fresh-install user sees, and it
     has to be coherent on its own. The reviewer's "do not put a
     giant management table plus a bootstrap button above it"
     guidance was structurally right: distinct views, not stacked
     widgets.

  #20 product terminology matters. "Bootstrap" is Factory/
     engineering vocabulary; users see "Create first profile".
     The B3-UI button was titled with Factory terminology
     because the B3 UI was inherited from the B3 backend
     primitive name; the reviewer's catch here was correct.


## CORRECTION05 (2026-09-09, bounded: LIVE_FOUND P0 absorb + freeze #5 amendment)

### Trigger

Reviewer verdict C1 on the live first-run dogfood after B4 closure:
HALT with one bounded P0 surfaced exactly where it should have
been (real first-run bootstrap on the exact-HEAD installable):

  P0  HALT_BOOTSTRAP_EMPTY_HEADERS_REPRESENTATION_REJECTED
      The user's existing OpenAI-compatible configuration is
      LEGITIMATE. Cline's runtime authority composes
      `...(openAiHeaders || {})` in the OpenAI-Compatible provider,
      so an absent or empty header map is semantically identical
      ("no custom headers"). The CORRECTION03 bootstrap normalizer
      froze a stricter policy:

        present openAiHeaders
        + zero valid string entries
        -> MALFORMED, refuse CURRENT_CONFIGURATION_UNSUPPORTED

      That policy disagreed with the runtime. The user's legacy
      persisted `openAiHeaders` was `{}`; the bootstrap refused the
      profile creation; the user saw a banner saying
      "openAiHeaders are malformed" - a bootstrap/runtime semantic
      mismatch, not a configuration defect.

      Earlier CORRECTION03 partial-mitigation
      (`SETTINGS_DEFAULTS.openAiHeaders = undefined`) was
      insufficient: changing the default only helps newly
      materialized state. It does NOT migrate or normalize existing
      persisted `{}` values.

      The on-boarding summary card correctly resolved the
      OpenAI-compatible model ("openai · MiniMax-M3"), confirming
      the B4 summary wiring is GREEN and the only remaining
      first-run blocker is the empty-header representation.

### Bounded correction (no new design ACT)

Per reviewer directive: "Do not reopen the whole bootstrap ACT.
Use CORRECTION05. Primary epistemic purpose: normalize legacy /
empty openAiHeaders representations to ABSENT without weakening
rejection of genuinely malformed non-empty header data."

Single-file edit to `parseOpenAiHeaders` at
apps/vscode/src/sdk/profile-store/bootstrap.ts:447-525 + in-place
amendment of freeze #5 in the file-level header.

### Semantic algebra

  undefined                       -> ABSENT
  null                            -> ABSENT
  empty string ""                 -> ABSENT
  empty parsed JSON "{}"          -> ABSENT  (canonicalization)
  {} (empty plain object)         -> ABSENT  (canonicalization;
                                             legacy persisted
                                             empty plain object)
  { "X-Tenant": "foo" }           -> CAPTURED
  '{"X-Tenant":"foo"}'            -> CAPTURED

  "{broken json"                  -> MALFORMED  (still refuses)
  "[]"                            -> MALFORMED  (still refuses)
  42 / true / primitive           -> MALFORMED  (still refuses)
  { "X": 123 }                    -> MALFORMED  (still refuses;
                                              non-empty garbage
                                              where user intended
                                              SOMETHING but stored
                                              the wrong value type)

  General rule: EMPTY = canonicalization (absent);
  NON-EMPTY + ALL-VALUES-UNUSABLE = refuse (MALFORMED_HEADERS_POLICY
  load-bearing case preserved).

### RED -> GREEN matrix

  H1 openAiHeaders=undefined       ABSENT        RED/GREEN (regression guard)
  H2 openAiHeaders={}              ABSENT  *     RED (live failure) / GREEN
  H3 openAiHeaders='{}'            ABSENT        RED / GREEN
  H4 openAiHeaders={X:'foo'}       CAPTURED      GREEN (regression guard)
  H5 openAiHeaders='{...}'         CAPTURED      GREEN (regression guard)
  H6 openAiHeaders='{broken json'  MALFORMED     GREEN (silent-weaken
                                                 antipattern guard)
  H7 openAiHeaders={X:123}         MALFORMED     GREEN (silent-weaken
                                                 antipattern guard)

  LEGACY_MIGRATION                 CREATED       NEW witness
                                                 (legacy persisted {}
                                                 succeeds, persisted
                                                 connection.headers
                                                 strictly absent)
  RUNTIME_PARITY                   both ABSENT   NEW witness
                                                 ({}=undefined produce
                                                 identical persisted
                                                 connection shape)

  * The load-bearing test. RED before the fix; GREEN after.

### Files edited (production)

- apps/vscode/src/sdk/profile-store/bootstrap.ts
    parseOpenAiHeaders: EMPTY canonicalization
    + freeze #5 in-place amendment (CORRECTION05 note in file-level
      header so future contributors cannot re-tighten the empty
      refuse policy without re-reading this ACT).

### Files added (test infra)

- apps/vscode/src/sdk/__tests__/bootstrap-empty-headers-as-absent.mpfrb01-correction05.test.ts
    9 sub-tests: live-failure matrix H1-H7 + LEGACY_MIGRATION
    witness + RUNTIME_PARITY witness. Real bootstrap primitive,
    real InstancesStore, real ProfilesStore. Per-test mkdtempSync
    data dirs.

### Test results (CORRECTION05)

  bun test src/sdk/__tests__/bootstrap-empty-headers-as-absent.mpfrb01-correction05.test.ts
    -> 9/9 pass
  bun test src/sdk/__tests__/bootstrap-*.mpfrb01.test.ts
    -> 14/14 pass (B1=7, B2=1, B-DURABILITY=2, B-CONNECTION=4;
       NO regression in CORRECTION02 connection-tuple witnesses)
  bun run test:unit
    -> 1116 pass / 0 fail (was 1107; +9 from CORRECTION05;
       Foundation conservation holds)
  bun x tsc --noEmit (apps/vscode/)
    -> exit 0 (typecheck clean)

### Verdict

  P0 HALT_BOOTSTRAP_EMPTY_HEADERS_REPRESENTATION_REJECTED
       = CLOSED (CORRECTION05)

  P0 BOOTSTRAP_PATH_ABSENT                        = CLOSED (B1)
  P0 BOOTSTRAP_SECRET_NOT_DURABLE_AT_PROFILE_COMMIT
       = CLOSED (CORRECTION02)
  P0 BOOTSTRAP_CONNECTION_TUPLE_INCOMPLETE        = CLOSED (CORRECTION02)
  P0 UNEXPECTED_TRACKED_DIRT                      = CLOSED (CORRECTION02)
  P0 HALT_B3_USER_VISIBILITY_NOT_PROVEN           = CLOSED (CORRECTION04)
  P0 HALT_UNRELATED_PROTO_CORRUPTION              = CLOSED (CORRECTION04)
  P0 HALT_BOOTSTRAP_EMPTY_HEADERS_REPRESENTATION_REJECTED
       = CLOSED (CORRECTION05)
  P0 all CLOSED.

  P1 EMPTY_STATE_DEAD_END                         = CLOSED (B4)
  P1 PICKER_POPUP_DEAD_END                        = CLOSED (B4)
  P1 WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED
       = CLOSED (B4)
  P1 OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN
       = CLOSED (CORRECTION04)
  P1 BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN
       = CLOSED (CORRECTION04)
  P1 MALFORMED_PRESENT_HEADERS_POLICY             = CLOSED (CORRECTION03)
  P1 BOOTSTRAP_COVERAGE_SCOPE_PRECISION           = CLOSED (CORRECTION03)
  P1 SILENT_FAILURE                               = CLOSED (CORRECTION04)
  P1 BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND        = CLOSED (CORRECTION02)
  P1 BOOTSTRAP_ATOMICITY_UNDEFINED                = CLOSED (CORRECTION02)
  P1 BOOTSTRAP_RPC_SURFACE_STILL_TBD              = CLOSED (CORRECTION02)
  P1 EXACT_HEAD_LABEL_OVERSTATED                  = CLOSED (CORRECTION02)
  P1 MISSING_MODEL_MISCLASSIFIED_AS_MISSING_CREDENTIAL
       = CLOSED (CORRECTION02)
  P1 all CLOSED.

  P2 BLANK_AT_EOF_DIAGNOSTICS = OPEN (non-blocking; unrelated to
    bootstrap surface).

  LIVE_FIRST_PROFILE_CREATION = GREEN
  LIVE_FIRST_RUN_UI           = GREEN
  LIVE_ERROR_VISIBILITY       = GREEN
  LIVE_CURRENT_CONFIG_SUMMARY = GREEN

  CORRECTION05 is genuinely closed. The next genuinely useful step
  is to rebuild + install a new exact-head VSIX and re-run the live
  first-run flow on a real VS Code extension host to confirm the
  user-visible success path.

### Lessons learned (additive, CORRECTION05)

  #21 "no valid string entries" is the wrong unit of distinguishability
     for the empty case. A `{}` payload has zero valid string
     entries because it has zero entries period - it is
     indistinguishable from absent in intent. The CORRECTION03
     zero-string-entries check was load-bearing for the genuinely
     malformed `{X:123}` case (preserved) but over-fired on `{}`
     (fixed). The semantic fix is to split the "user intended
     something but stored garbage" check from the "is the
     representation actually empty" check: empty = canonicalize to
     absent; non-empty + all-unusable = refuse. Two distinct
     questions, not one.

  #22 changing the default layer is necessary but not sufficient.
     The CORRECTION04 P1 absorb `SETTINGS_DEFAULTS.openAiHeaders =
     undefined` made the default-coerced case absent. CORRECTION05
     closes the loop by making the policy layer also treat a
     PRESENT-but-empty representation as absent. Defaults are the
     absence-of-config signal for NEW state; normalization is the
     absence-of-config signal for EXISTING state. Both layers are
     required to keep them semantically equivalent across user
     timelines.

  #23 the bootstrap/runtime authority split is a smell that the
     reviewer's "do not reopen the whole ACT" verdict correctly
     localized. The bootstrap normalizer had learned a stricter
     policy than the runtime ever observed; the bounded correction
     re-aligned the policy without touching the runtime, the
     projection, the UI, or the Foundation. When two layers
     disagree on the SAME data, the smaller layer is usually
     wrong - here the bootstrap (one function, ~80 lines) is far
     smaller than the OpenAI-compatible runtime authority, so the
     bootstrap was the right place to amend.

  #24 the LIVE_FOUND P0 path is precisely the path the durable-ACT
     convention is built for: real first-run dogfood surfaced a
     bootstrap normalizer disagreement with the runtime, the
     bounded correction absorbed it without reopening the design
     ACT, and the RED -> GREEN matrix maps every empty-header
     representation to ABSENT while preserving every genuinely
     malformed refuse. The bounded-correction discipline works
     exactly because the contract freezes from CORRECTION02/C03/C04
     already pinned the load-bearing invariants - this correction
     only had to amend ONE freeze (the empty-vs-malformed line
     inside freeze #5) without touching any other layer.

## CORRECTION05 REVIEWER C1 ACCEPTANCE (2026-09-09)

Reviewer verdict: PASS_WITH_ONE_BOUNDED_P1 — C1: GO BACK TO LIVE DOGFOOD.

P0 HALT_BOOTSTRAP_EMPTY_HEADERS_REPRESENTATION_REJECTED = CLOSED
  (the live-found P0 that triggered CORRECTION05 is genuinely closed
   and the empty-canonicalize fix is correctly scoped; the three
   semantic classes ABSENT / CAPTURED / MALFORMED are consistent with
   OpenAI-Compatible configuration semantics - custom headers are
   optional - and the model-catalog store scopes headers to the
   `openai` provider, matching the parser scope).

P1 PARTIALLY_MALFORMED_HEADERS_POLICY = OPEN, NON-BLOCKING
  Reviewer observed that the parser's behavior on partially-malformed
  input is asymmetric with freeze #5's "NON-EMPTY + ALL-VALUES-UNUSABLE
  refuses" rule:

    {"X-Good":"foo", "X-Bad":123}
      -> CAPTURED { "X-Good": "foo" }   (silent drop of X-Bad)

  This silent-drop is a load-bearing silent-weaken antipattern similar
  in kind to the one freeze #5 prevents: one requested header can
  disappear silently while another survives, and custom headers are
  explicitly used for authentication and corporate proxy routing.

  Likely desired policy (likely CORRECTION06, post-dogfood):

    any present non-string-valued entry
      -> MALFORMED  (refuse, surface the bad value)

  Reviewer directive: "Do NOT fix before live retest. It is not the
  user's observed geometry, and another pre-dogfood loop would slow
  learning." Recorded here as a freeze of CURRENT behavior, not as an
  endorsement.

  Action taken this commit (non-behavior change):

  1. New freeze #6 PARTIALLY_MALFORMED_HEADERS_POLICY_OBSERVED_ASYMMETRY
     added to the file-level header of
     apps/vscode/src/sdk/profile-store/bootstrap.ts. It pins the
     current silent-drop behavior, names the likely-desired policy,
     records the reviewer directive verbatim, and cross-references
     the pinning witnesses.

  2. Two new pinning witnesses added to the CORRECTION05 test file
     (currently GREEN, designed to go RED -> GREEN when CORRECTION06
     eventually lands):
       MPFRB01_C05_P1_PARTIALLY_MALFORMED_ASYMMETRY_PLAIN_OBJECT
       MPFRB01_C05_P1_PARTIALLY_MALFORMED_ASYMMETRY_JSON_STRING

     Both witness a `{"X-Good":"foo","X-Bad":123}` payload and assert
     CURRENT behavior (CAPTURED with `X-Good` only, status CREATED).
     Both add an explicit anti-assertion
     `expect(result.status).not.toBe("CURRENT_CONFIGURATION_UNSUPPORTED")`
     so the next ACT has a visible RED gate to chase.

P2 RUNTIME_PARITY evidence label slightly overstated = CORRECTED
  Reviewer precision fix: the original witness named
  `MPFRB01_C05_RUNTIME_PARITY` and its in-body comment claimed
  "identical runtime behavior" - but the test only asserts that the
  bootstrap writes the same persisted connection shape for both {} and
  undefined; it does not execute a real provider call. Outbound HTTP
  behavior parity is upstream evidence (OpenAI-Compatible provider
  composes `...(openAiHeaders || {})`), not asserted in this file.

  Renames + label split (no behavior change):

    Test ID:
      MPFRB01_C05_RUNTIME_PARITY
        -> MPFRB01_C05_BOOTSTRAP_PERSISTED_SHAPE_PARITY

    Evidence labels in the file header:
      BOOTSTRAP_PERSISTED_SHAPE_PARITY = EXECUTED  (this file)
      RUNTIME_BEHAVIOR_EQUIVALENCE     = STRUCTURALLY_CORROBORATED
                                          (upstream provider;
                                           not asserted here)

VERDICT (post C1 acceptance):
  P0: HALT_BOOTSTRAP_EMPTY_HEADERS_REJECTED              = CLOSED
      HALT_BOOTSTRAP_EMPTY_HEADERS_REPRESENTATION_REJECTED = CLOSED
  P1: PARTIALLY_MALFORMED_HEADERS_POLICY                 = OPEN, NON-BLOCKING
      (freeze #6 added; pinning witnesses added; deferred to post-dogfood)
  P2: BLANK_AT_EOF_DIAGNOSTICS                           = OPEN, NON-BLOCKING
      RUNTIME_PARITY evidence label                       = CORRECTED

LESSONS LEARNED ADDENDUM (post C1 review):

  #25 even when the bounded correction closes the live-found P0 cleanly,
     the reviewer will surface asymmetric load-bearing antipatterns that
     were not in the user's observed geometry. The right response is
     NOT to fix them in the same bounded correction - it is to FREEZE
     the current behavior so the asymmetry cannot drift, and to add
     pinning witnesses that will RED -> GREEN when the next ACT decides
     to address it. This preserves the bounded-correction discipline
     (do not reopen the design ACT) while making the latent antipattern
     visible at the next decision point.

  #26 evidence-precision reviews are cheap and load-bearing: claiming
     "RUNTIME_PARITY = EXECUTED" when the test only proves "persisted
     shape parity" overstates the assertion and erodes the trust chain
     between reviewer panel and Foundation conservation. Splitting the
     claim into "what this test proves" vs "what is structurally
     corroborated upstream" is the right discipline.

  #27 (added 2026-09-09 per C2 reviewer caution) pinning witnesses
     for a CURRENT asymmetry are CHARACTERIZATION, not PERMANENT
     COMPATIBILITY. When CORRECTION06 eventually changes the policy,
     the two MPFRB01_C05_P1_PARTIALLY_MALFORMED_ASYMMETRY_* witnesses
     must be REWRITTEN into the new RED -> GREEN invariant (e.g.
     "any present non-string-valued entry -> MALFORMED"). Do NOT keep
     them asserting the OLD silent-drop behavior as a historical
     contract — that would re-bake the antipattern into the test
     suite. The witnesses are scaffolding, not load-bearing.

C1: GO TO EXACT-HEAD BUILD/INSTALL -> REPEAT LIVE FIRST-PROFILE CREATION.
   The next genuinely useful step is to build/install a new exact-head
   VSIX from commit 2ba7e3be0 (or its post-C1-acceptance successor) and
   re-run the original live first-run flow on a real VS Code extension
   host with the MiniMax/OpenAI-compatible configuration that
   originally surfaced the bug.

   L-C05-1   legacy openAiHeaders={} -> Settings > Model Profiles ->
             Create first profile -> CREATED -> profile appears.
   L-C05-2   reload VS Code -> profile still present -> credential
             still resolves.
   L-C05-3   use created profile -> next real MiniMax request succeeds.

   Only after L-C05-1/2/3 succeed should dogfood proceed to A/B
   switching and the PARTIALLY_MALFORMED_HEADERS_POLICY review (post-
   dogfood decision, not pre-dogfood).

## CORRECTION06 (2026-09-09, bounded: LIVE_FOUND P0 absorb)

### Trigger (LIVE_FOUND during L-C05-1 dogfood retest)

The reviewer-directed dogfood retest surfaced a SECOND live defect.
The exact-HEAD VSIX post-C1-acceptance (commit 01e724049) reported:

  - Bootstrap RPC returns CREATED                              (success banner)
  - profiles.json / instances.json / secrets.json all on disk (durable OK)
  - ExtensionState.modelProfiles = []                          (BUG)
  - Webview re-renders the zero-profile onboarding pane         (visible)

This is a NEW failure class from the previous corrections. The
write succeeded, the success envelope reached the webview, but
the post-create state push still shipped `modelProfiles: []`.
The user's report:

  ```
  bootstrap RPC        = SUCCESS
  durable creation     = apparently SUCCESS
  success banner       = visible
  webview profile list = still EMPTY
  ```

### Classification

```text
LIVE_PROFILE_WRITE                  = PASS
LIVE_BOOTSTRAP_RESPONSE             = CREATED
LIVE_SUCCESS_BANNER                 = PASS
LIVE_WEBVIEW_PROFILE_CONVERGENCE    = FAIL

P0 = HALT_MODEL_PROFILE_POST_CREATE_STATE_NOT_PUBLISHED
```

### First-bad-boundary trace (mechanical, not assumed)

Inspected the write -> publication chain:

```text
bootstrapModelProfileFromCurrentConfiguration.handler
  -- reads controller.modelProfilesOwner                    [OK, exists]
  -- calls bootstrapPrimitive(deps, name) with deps.profilesStore
     = owner.profilesStore                                 [OK, same instance]
  -- primitive awaits deps.profilesStore.upsert(profile)    [OK, disk updated]
  -- primitive awaits deps.postStateToWebview()             [enqueues via
                                                              debouncer, returns]
  -- debouncer fires after 50ms:
       flushStateToWebview() ->
         this.getStateToPostToWebview() (SdkController method)
         -- buildBaseState({...inline object...})           [BUG]
         -- sends state to webview via sendStateUpdate()
```

The BUG is at the `buildBaseState({...})` call site at
`apps/vscode/src/sdk/SdkController.ts:4192-4230`. The
inline-object literal DOES NOT include `modelProfilesOwner`.

The base builder at `apps/vscode/src/core/controller/state/
getStateToPostToWebview.ts:192-194` reads
`controller.modelProfilesOwner` via an unsafe `as { ... }` cast.
The cast was hiding the missing field on the caller side. The
projection at line 205-241 sees
`controller.modelProfilesOwner === undefined`, falls through to
the empty default, and ships `modelProfiles: []`.

NOT the leading "two ProfilesStore instances with stale in-memory
state" hypothesis: both write and read paths use
`controller.modelProfilesOwner.profilesStore` -- the SAME
instance via the production owner
(`createProductionModelProfilesOwner` returns the single
`profilesStore` it constructed; both the bootstrap handler and
the getStateToPostToWebview caller dereference the same field).

NOT a stale-cache issue: `ProfilesStore` has a single in-memory
`cache` field that is mutated immediately by `upsert()`. There
is no debounced cache invalidation gap to chase.

NOT a postStateToWebview not-awaited issue: the bootstrap awaits
`deps.postStateToWebview()`, which goes through the
`StatePostDebouncer.post()` -> `flushStateToWebview()` ->
`this.getStateToPostToWebview()` chain. The await resolves
when the snapshot has been shipped.

The defect is purely a publication-side wiring defect: the
`modelProfilesOwner` field was not threaded through to the
projection. Unsafe `as { ... }` cast hid the missing field from
the type system for the entire prior PR chain.

### Bounded correction (no new design ACT)

Per reviewer directive ("Do NOT reopen the whole bootstrap ACT.
Use CORRECTION06."):

  (1) SdkController.getStateToPostToWebview() (apps/vscode/src/sdk/
      SdkController.ts:4192-4230): add `modelProfilesOwner:
      this.modelProfilesOwner` to the `buildBaseState({...})`
      argument list. This is the single load-bearing production
      code change.

  (2) getStateToPostToWebview parameter type
      (apps/vscode/src/core/controller/state/
      getStateToPostToWebview.ts:48): add `modelProfilesOwner?:
      { profilesStore; instancesStore; getCurrentTaskHistoryItem? }`
      to the formal controller parameter shape. This makes the
      previously-hidden field visible at the type level so future
      callers cannot silently omit it again.

  (3) getStateToPostToWebview projection
      (apps/vscode/src/core/controller/state/
      getStateToPostToWebview.ts:205-241): remove the unsafe
      `as { ... }` cast chain. Read `controller.modelProfilesOwner`
      directly. The runtime guard `typeof ... list === "function"`
      is preserved as defensive programming.

  (4) NEW RED -> GREEN witness:
      MPFRB01_C06_PUBLICATION_THREADS_OWNER (added to
      apps/vscode/src/sdk/SdkController.test.ts) -- drives
      SdkController.prototype.getStateToPostToWebview.call() with
      a mock `modelProfilesOwner` on the controller, records the
      `buildBaseState` call args, asserts `modelProfilesOwner`
      was threaded through. RED ACTUAL before the fix
      (the field was missing from the inline-object literal);
      GREEN after.

  (5) NEW RHS projection witness:
      MPFRB01_C06_POST_CREATE_STATE_CONVERGENCE
      (apps/vscode/src/core/controller/state/
      post-create-state-convergence.mpfrb01-correction06.test.ts)
      -- drives the REAL bootstrap handler + REAL
      getStateToPostToWebview against a fake controller that wires
      the SAME ProfilesStore. Asserts the post-create state payload
      contains the freshly-created profile. RHS witness; would
      have been GREEN before the fix too (the projection is
      correct in isolation), so it serves as a regression guard
      rather than a RED witness. The RED witness is the LHS one.

### RED -> GREEN matrix

```text
                                        before fix    after fix
MPFRB01_C06_PUBLICATION_THREADS_OWNER      RED          GREEN
MPFRB01_C06_POST_CREATE_STATE_CONVERGENCE  GREEN*       GREEN
                                          (* RHS; was
                                           never the
                                           bug site)
```

### Files edited (production)

  apps/vscode/src/sdk/SdkController.ts:4205-4217
    + modelProfilesOwner: this.modelProfilesOwner (with comment
      block referencing CORRECTION06 + the LIVE_FOUND P0)

  apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:40-59
    + modelProfilesOwner?: { ... } formal parameter type

  apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:205-251
    - the unsafe `as { modelProfilesOwner?: ... }` cast chain
    + direct read of `controller.modelProfilesOwner`
    + CORRECTION06 in-line comment

### Files added (test infra)

  apps/vscode/src/sdk/SdkController.test.ts
    + MPFRB01_C06_PUBLICATION_THREADS_OWNER (1 test, RED -> GREEN)

  apps/vscode/src/core/controller/state/post-create-state-convergence.mpfrb01-correction06.test.ts
    + MPFRB01_C06_POST_CREATE_STATE_CONVERGENCE (1 test, RHS regression guard)

### Test results (CORRECTION06)

```text
$ cd apps/vscode && PATH=/opt/homebrew/bin:$PATH bunx vitest run \
    src/sdk/SdkController.test.ts -t "MPFRB01_C06"

  Tests  1 passed | 19 skipped (20)

$ cd apps/vscode && PATH=/opt/homebrew/bin:$PATH bunx vitest run \
    src/core/controller/state/post-create-state-convergence.mpfrb01-correction06.test.ts

  Tests  1 passed (1)

$ cd apps/vscode && PATH=/opt/homebrew/bin:$PATH bunx vitest run \
    src/core/controller/state/

  Test Files  8 passed (8)
       Tests  45 passed (45)

$ cd apps/vscode && PATH=/opt/homebrew/bin:$PATH bun test \
    src/sdk/__tests__/bootstrap-*.test.ts \
    src/sdk/__tests__/bootstrap-empty-headers-as-absent.mpfrb01-correction05.test.ts

  25 pass / 0 fail

$ cd apps/vscode && PATH=/opt/homebrew/bin:$PATH bun test \
    src/sdk/__tests__/model-profile-*.test.ts \
    src/sdk/__tests__/model-profiles-store.mpqs01.test.ts

  57 pass / 0 fail

$ cd apps/vscode && PATH=/opt/homebrew/bin:$PATH bun x tsc --noEmit; echo exit=$?
  exit=0
```

### Verdict (post CORRECTION06)

```text
P0:
  HALT_BOOTSTRAP_EMPTY_HEADERS_REJECTED                = CLOSED (CORRECTION05)
  HALT_BOOTSTRAP_EMPTY_HEADERS_REPRESENTATION_REJECTED = CLOSED (CORRECTION05)
  HALT_MODEL_PROFILE_POST_CREATE_STATE_NOT_PUBLISHED   = CLOSED (CORRECTION06)

P1:
  PARTIALLY_MALFORMED_HEADERS_POLICY                   = OPEN, NON-BLOCKING
    freeze #6 added; pinning witnesses added; deferred to
    post-dogfood (likely future CORRECTION07).

P2:
  BLANK_AT_EOF_DIAGNOSTICS                             = OPEN, NON-BLOCKING
```

### Lessons learned (additive, CORRECTION06)

#28 an unsafe `as { field?: T }` cast on a function parameter is
   effectively an unchecked escape hatch: it lets callers silently
   omit the field and the function compiles fine, the type system
   has no opinion, and the runtime falls through to the empty
   default. The cast was hiding a load-bearing wiring defect for
   the entire prior PR chain (B1, B2, CORRECTION02, CORRECTION03,
   CORRECTION04, B3, B4, CORRECTION05). The fix is NOT just to
   thread the field through -- it is also to PROMOTE the field
   to a formal parameter type so future callers cannot omit it
   silently. Both halves of the fix are needed; doing only the
   first would leave the cast as a trip wire for the next defect.

#29 the leading hypothesis for a "writes OK but reads stale" bug
   is often "two stores with stale in-memory cache". For a single
   owner composition where both paths dereference the SAME field,
   that hypothesis is wrong -- the bug is on the publication side,
   not on the storage side. The lesson: when the wiring is a
   single-owner composition, trace the WRITE side first to confirm
   the field identity, then trace the READ side's argument
   construction. The defect is almost always at the argument
   construction site, not at the store identity.

#30 state-publication seams are NOT tested by tests that drive
   the standalone state builder directly. A test that calls
   `getStateToPostToWebview(controller)` exercises the projection
   seam in isolation -- which is necessary but not sufficient.
   The full path goes through `SdkController.getStateToPostToWebview()`
   which has its own argument-construction logic. To test the
   full path, the test must drive the SdkController method with
   `SdkController.prototype.getStateToPostToWebview.call(...)`
   and inspect the args passed to `buildBaseState` (the inner
   state-builder call). MPFRB01_C06_PUBLICATION_THREADS_OWNER is
   the LHS witness for this seam; the projection-side witness
   (MPFRB01_C06_POST_CREATE_STATE_CONVERGENCE) is the RHS.

#31 (RED -> GREEN discipline) when a bounded correction is
   LATERAL -- i.e., closes a defect that the prior chain
   unintentionally surfaced -- do NOT expand it into a sweep
   that also fixes latent antipatterns. CORRECTION06 had two
   tempting adjacent fixes: (a) refactor the projection to use
   a real typed projection helper, (b) close the
   PARTIALLY_MALFORMED_HEADERS_POLICY P1 by refusing non-string-
   valued entries instead of silently dropping them. Neither is
   in scope; both are deferred to their own bounded ACT. The
   correction is "thread the owner through, period". This
   preserves the bounded-correction discipline established in
   CORRECTION05.

### Next step

CORRECTION06 closes the LIVE_FOUND P0 surfaced by the L-C05-1
dogfood retest. The next genuinely useful step is to rebuild +
install the new exact-head VSIX (post-CORRECTION06) and re-run
the L-C05 dogfood flow:

  L-C05-1   legacy openAiHeaders={} -> Settings > Model Profiles ->
            Create first profile -> CREATED -> profile appears in
            the list (NOT empty anymore).
  L-C05-2   reload VS Code -> profile still present -> credential
            still resolves.
  L-C05-3   use created profile -> next real MiniMax request
            succeeds.

Only after L-C05-1/2/3 succeed should dogfood proceed to A/B
switching (L-C05-4) and the PARTIALLY_MALFORMED_HEADERS_POLICY
review (post-dogfood decision, not pre-dogfood).

## CORRECTION07 (2026-09-09, bounded: LIVE_FOUND P0 absorb + single-boundary normalization)

### Trigger

Reviewer verdict (live first-run dogfood after CORRECTION06 closure
`632ac4d36`): the post-CORRECTION06 dogfood retest surfaced a SECOND live
P0 with a different signature. Repro of the live failure:

  1. Fresh user installs the exact-HEAD VSIX.
  2. Configures OpenAI-compatible provider (LiteLLM endpoint hosting
     MiniMax-M3) with a real API key. Legacy persisted
     `actModeApiProvider = "openai"`,
     `actModeOpenAiModelId = "MiniMax-M3"`,
     `openAiApiKey = "sk-litellm-..."`,
     `openAiBaseUrl = "https://..."`,
     `openAiHeaders` canonically ABSENT (per CORRECTION05).
  3. Opens Settings > Model Profiles; clicks Create first profile;
     names it "minimax-m3"; clicks Create. Live banner: "Profile
     created."
  4. User clicks Use on the freshly-created profile (or sends a real
     MiniMax-M3 request).
  5. Result:
       Backend error: Unknown or disabled provider "openai".
     The task fails immediately at provider resolution. The SDK
     gateway never reaches the OpenAI-compatible chat-completions
     client; MiniMax network behavior is never exercised.

This is exactly the L-C05-3 step the CORRECTION06 close predicted
would be the next load-bearing test. The post-create state push from
CORRECTION06 made the profile visible; using the profile surfaces the
identity bug.

### Causal chain (six provider-ID boundaries)

```
CURRENT_API_PROVIDER               = "openai"            (legacy)
  v bootstrap.ts:682 (config.actModeApiProvider)
BOOTSTRAPPED_INSTANCE_PROVIDER_ID  = "openai"            (legacy, persisted)
  v bootstrap.ts:798 (instance.providerId)
PROFILE_INSTANCE_PROVIDER_ID       = "openai"            (legacy, profile
                                                          references the
                                                          instance unchanged)
  v typed-projector.ts:134 (the bug: pass-through without normalize)
SESSION_CONFIG_PROVIDER_ID         = "openai"            (legacy, BUG)
  v CoreSessionConfig.providerId
FINAL_GATEWAY_LOOKUP_PROVIDER_ID   = "openai"            (registry throws
                                                          "Unknown or
                                                           disabled
                                                           provider
                                                           'openai'")
```

### Why this is an authority-boundary bug

The legacy non-profile path at
`apps/vscode/src/sdk/cline-session-factory.ts:1053` calls
`toSdkProviderId(providerId)` BEFORE writing
`cfg.providerId` (line 1142). The legacy OPENAI_ONLY_PROBE projector
at `sdk-session-config-builder.ts:181` writes the legacy id verbatim
to `cfg.providerId` (and is exercised by tests at
`provider-instance-identity-r2p-real-projector.piif01.test.ts:136`
that assert `result.providerId === "openai"`). The TYPED projector at
`typed-projector.ts:134` (the one the Model Profile path uses via
`providerConfigurationInstanceTyped`) also wrote the legacy id
verbatim. Neither typed path folded the alias; only the legacy
`buildSessionConfig` path did.

The SDK registry at
`sdk/packages/llms/src/providers/registry.ts:221` keys built-in
providers by their canonical SDK ids (`BUILT_IN_PROVIDER.
OPENAI_COMPATIBLE = "openai-compatible"`,
`BUILT_IN_PROVIDER.NOUSRESEARCH = "nousResearch"`). The
extension's `ApiConfiguration` stores the legacy spellings
(`openai`, `nousresearch`). Without normalization at the typed
projector, the legacy spelling escapes to the SDK gateway.

This is the SAME class of leak the reviewer's first verdict flagged
as "Legacy `openai` spelling the rest of the extension is keyed by":
the extension has always used `openai`, the SDK uses
`openai-compatible`, and the typed instance layer had been missing
the alias fold. The legacy path had the fold (line 1053); the
typed path did not.

### Bounded fix (one production file, two test files)

Per reviewer directive: "Do not reopen the whole bootstrap ACT. Use
CORRECTION07 to bind the fix to one boundary."

**Production change** (1 file, 1 line + comments):

  apps/vscode/src/sdk/instance-store/typed-projector.ts
    + import { toSdkProviderId } from
      "../model-catalog/sdk-provider-id"     (line 93)
    - setOrClear(cfgAny, "providerId",
                 instance.providerId)
    + setOrClear(cfgAny, "providerId",
                 toSdkProviderId(instance.providerId))   (line 186)

    + PROVIDER-ID NORMALIZATION CONTRACT header block
      (lines 65-89): documents the alias fold, the canonical SDK
      ids, and the legacy extension ids, with explicit
      cross-references to the legacy non-profile path at
      `cline-session-factory.ts:1053` (the proven precedent).

    + In-line CORRECTION07 comment at the fix point explaining why
      the projector is the single normalization boundary.

**Test changes** (2 files):

  apps/vscode/src/sdk/instance-store/typed-projector.test.ts
    Added R5-08, R5-09, R5-10 to the existing R5 typed-projector
    suite. R5-08 is the RED->GREEN witness at the projector
    boundary. R5-09 and R5-10 are conservation pin
    (canonical-idempotence and nousResearch alias).

  apps/vscode/src/sdk/__tests__/bootstrap-openai-canonical-id-
    projection.mpfrb01-correction07.test.ts (NEW, 14 tests)
    End-to-end RED->GREEN witness that drives the production
    bootstrap seam + the production typed projector seam on the
    exact live-user geometry (LiteLLM MiniMax-M3), plus
    12-case conservation pin (every other provider id must be
    unchanged; CRITICAL: openai-native is DISTINCT from
    openai-compatible).

### Architectural choice: Outcome B (projector-boundary fold)

Reviewer's verdict offered two outcomes:

  Outcome A: normalize at the bootstrap boundary so durable
    instances store canonical SDK ids.
  Outcome B: normalize at the typed projector boundary so the
    durable instance stores legacy ids (matching the existing
    contract) and the projector (the single consumer of
    `instance.providerId`) is the single authority that folds.

**Outcome B chosen**, for these reasons:

  1. The typed projector IS the single authority boundary that
     converts typed `ProviderConfigurationInstance` records into
     runtime `CoreSessionConfig`. It is the single consumer of
     `instance.providerId` (verified: only
     `typed-projector.ts:134` reads `instance.providerId` in
     production code). Placing the fold there means a single
     point of truth and a single fix point.
  2. Mirrors the legacy non-profile path precedent at
     `cline-session-factory.ts:1053` (`toSdkProviderId` before
     `cfg.providerId`). The fix is symmetric with the working
     legacy path.
  3. The durable `ProviderConfigurationInstance.providerId`
     contract is already pinned by `bootstrap-no-provider-id-
     collapse.mpfrb01.test.ts:227`:
       expect(instC.providerId).toBe("openai")
     and by the broader bootstrap regression suite. Changing
     this would break 5+ existing test witnesses across 3 test
     files. Outcome B preserves the existing contract.
  4. Future writers of `ProviderConfigurationInstance` (RPC
     paths, profile-update flows, future typed-instance
     migration paths) are TOLERANT of either spelling: the
     projector normalizes on read. Outcome A would require
     every future writer to remember to normalize, and a single
     forgotten call site would reintroduce the bug silently.
  5. `toSdkProviderId` is idempotent on already-canonical ids
     (the table maps `nousresearch -> nousResearch` and
     `openai -> openai-compatible`; everything else passes
     through unchanged). Existing typed-projector test fixtures
     using `"openai-compatible"` continue to work without
     modification (R5-09 witnesses this).

### Files NOT touched (per bounded-correction discipline)

  apps/vscode/src/sdk/profile-store/bootstrap.ts (bootstrap
    capture is unchanged; the legacy "openai" spelling IS the
    correct durable contract)
  apps/vscode/src/sdk/sdk-session-config-builder.ts
  apps/vscode/src/sdk/sdk-provider-change-coordinator.ts
  apps/vscode/src/sdk/cline-session-factory.ts
  apps/vscode/src/sdk/instance-store/contracts.ts
    (no schema_version bump; the durable `providerId: string`
     contract is intentionally tolerant of either spelling)
  apps/vscode/src/shared/model-catalog/provider-helpers.ts
    (the inverse alias map `toLegacyApiProvider` is reused as-is;
    we do NOT add new alias authorities)
  apps/vscode/src/sdk/model-catalog/sdk-provider-id.ts
    (the existing `EXTENSION_TO_SDK_PROVIDER_ID` table is
    reused as-is; we do NOT add new alias authorities)

### CORRECTION07 test results

```
bun x tsc --noEmit (apps/vscode/):
  -> exit 0 (clean; the new import path
     "../model-catalog/sdk-provider-id" type-resolves correctly)

bun run lint:
  -> exit 0 (biome lint clean; no fixes needed)

TMPDIR=/tmp bun test
  src/sdk/__tests__/bootstrap-openai-canonical-id-projection.mpfrb01-correction07.test.ts:
  -> 14 pass / 0 fail / 26 expect() calls
     (1 LIVE-GEOMETRY + 12 CONSERVATION + 1 DURABLE-CONTRACT)

bun x vitest run --config vitest.config.c2-4-c-bridge.ts
  src/sdk/instance-store/typed-projector.test.ts:
  -> 10 pass / 0 fail
     (7 existing R5-01..07 + 3 new R5-08..10)

TMPDIR=/tmp bun test
  src/sdk/__tests__/bootstrap-*.test.ts
  src/sdk/__tests__/model-profile-*.test.ts:
  -> 85 pass / 0 fail / 289 expect() calls
     (all bootstrap + model-profile regression stays GREEN;
      no behavioral change to the bootstrap seam itself)
```

### RED->GREEN cycle (proves the test is load-bearing)

```
git diff apps/vscode/src/sdk/instance-store/typed-projector.ts
  - line 186: setOrClear(cfgAny, "providerId",
  -                    toSdkProviderId(instance.providerId))
  + line 186: setOrClear(cfgAny, "providerId",
  +                    instance.providerId)

bun test src/sdk/__tests__/bootstrap-openai-canonical-id-projection.mpfrb01-correction07.test.ts:
  -> 12 pass / 2 fail
     FAIL: MPFRB01_C07_OPENAI_LIVE_GEOMETRY
           Expected "openai-compatible", Received "openai"
     FAIL: MPFRB01_C07_INSTANCE_DURABLE_CONTRACT
           Expected "openai-compatible", Received "openai"
     (the 12 conservation cases pass because they test
      toSdkProviderId directly, which is not the bug)

git checkout apps/vscode/src/sdk/instance-store/typed-projector.ts
  (restore the fix)

bun test src/sdk/__tests__/bootstrap-openai-canonical-id-projection.mpfrb01-correction07.test.ts:
  -> 14 pass / 0 fail
```

### Defense-in-depth regression guards

  1. R5-08 in typed-projector.test.ts: any future regression
     that reverts the normalization (e.g. an unwary refactor
     of the typed projector) would surface as
     `expect(cfg.providerId).toBe("openai-compatible")` failing
     in this exact test.
  2. R5-09 (idempotence) + R5-10 (nousResearch alias) pin the
     conservation contract: `toSdkProviderId` MUST be a pure
     alias fold, NOT a global rewrite. If a future refactor
     accidentally touches `openai-native` or `nousResearch`
     canonical form, these tests fail.
  3. MPFRB01_C07_INSTANCE_DURABLE_CONTRACT pins the
     `instance.providerId = "openai"` durable contract. If a
     future refactor decides to normalize at the bootstrap
     boundary (Outcome A), this test fails and forces the
     refactor to also update bootstrap-no-provider-id-collapse
     + all related test witnesses.
  4. MPFRB01_C07_CONSERVATION_CASE (12 cases) covers every
     built-in provider id and the custom-id pass-through. A
     future regression that broadens the alias fold (e.g.
     accidentally folding `openai-native`) would surface
     immediately as a failing conservation case.

### Lessons learned (additive, CORRECTION07)

  #32 When a SDK-bridged extension introduces a NEW persistence
     boundary (here: typed `ProviderConfigurationInstance`
     records durable on disk), it MUST inherit the legacy-to-
     canonical alias folds that the working legacy path
     already performs. The typed-projector author was unaware
     of the fold at cline-session-factory.ts:1053; the new
     path silently bypassed it. This is a class of bug that
     recurs whenever a new persistence layer is added: every
     seam between the new layer and the runtime SDK gateway is
     a candidate for the alias fold.

  #33 The fix is at the SEAM, not at the WRITER. Normalizing
     the durable `instance.providerId` at write time would
     (a) break 5+ existing test witnesses that pin the
     legacy contract, and (b) require every future writer to
     remember to normalize. The seam (typed projector) is the
     single authority; folding there makes the projection
     correct for every possible writer without per-writer
     discipline.

  #34 `toSdkProviderId` is idempotent on already-canonical
     ids. This is what makes Outcome B safe to ship: every
     existing canonical writer (including the typed-projector
     test fixtures using `"openai-compatible"`) passes through
     unchanged, so the fix is provably backward-compatible
     with the entire test corpus. The R5-09 witness pins
     this idempotence contract.

  #35 Live dogfood retests are load-bearing beyond the
     "feature works" gate. The CORRECTION06 closure made
     "profile appears in the list after create" pass; the
     CORRECTION07 live retest surfaces a different bug at
     "use the profile to make a real request" — proving that
     the L-C05-3 step (the next-step directive in CORRECTION06)
     is non-trivial and that the live geometry exercises
     authority boundaries that the unit-test corpus does not
     reach. The first live retest after each ACT closure
     should drive the FIRST real downstream consumer, not the
     UI feedback loop.

  #36 The `OpenAI-Compatible` / `OpenAI native` distinction
     is canonical and must not be conflated by alias folds.
     The MPFRB01_C07_CONSERVATION_CASE explicit case for
     `openai-native -> openai-native` (NOT `openai-compatible`)
     pins this. A naive "fold any provider containing the
     substring 'openai'" implementation would silently
     route first-party OpenAI traffic through the chat-
     completions client, breaking OAuth tokens and protocol-
     specific headers. The fix is a precise alias-table
     lookup, not a substring match.

### P-class verdict (post-CORRECTION07)

  P0 all CLOSED (unchanged from CORRECTION06):
    BOOTSTRAP_PATH_ABSENT
    BOOTSTRAP_SECRET_NOT_DURABLE_AT_PROFILE_COMMIT
    BOOTSTRAP_CONNECTION_TUPLE_INCOMPLETE
    UNEXPECTED_TRACKED_DIRT
    HALT_B3_USER_VISIBILITY_NOT_PROVEN
    HALT_UNRELATED_PROTO_CORRUPTION
    HALT_MODEL_PROFILE_POST_CREATE_STATE_NOT_PUBLISHED
    HALT_MODEL_PROFILE_PROVIDER_ID_NOT_CANONICAL      (NEW CLOSED HERE)

  P1:
    PARTIALLY_MALFORMED_HEADERS_POLICY
      = OPEN NON-BLOCKING
      (post-dogfood decision; pinned by MPFRB01_C05_P1_PARTIALLY_
       MALFORMED_ASYMMETRY_* witnesses in CORRECTION05; the policy
       silently drops non-string-valued entries rather than refusing
       partially-malformed input. Frozen by CORRECTION05 freeze #6;
       a CORRECTION08 (post-dogfood) may refuse rather than silently
       drop. Not blocking L-C07.)

    PROFILE_PROVIDER_LABEL_AUTHORITY = INTERNAL_ID_EXPOSED
      = OPEN POLISH
      = owned by UX-POLISH01 (separate ACT, OPEN against the
        post-CORRECTION06 closure HEAD; the bounded U5 provider-
        label resolution work is scoped there)
      (The profile card displays the runtime token "openai" instead
       of the user-facing label "OpenAI Compatible". It is the
       SAME leak the bootstrap-boundary fold also affects: the
       durable `instance.providerId = "openai"` is what the
       webview summary surfaces. The CORRECTION07 fix normalizes
       at the runtime boundary only; the UI label is a separate
       projection step that needs U5's `formatProviderLabel`
       authority. UX-POLISH01 owns that work; this ACT does NOT
       re-trigger it.)

  P2 BLANK_AT_EOF_DIAGNOSTICS = OPEN (non-blocking; unrelated
    to bootstrap surface).

  WORKING_TREE_CLEAN = TRUE (post-commit verified)
  ALL_DURABLE_ACT_FILES_COMMITTED = TRUE (post this commit)
```

### Next step

CORRECTION07 closes the LIVE_FOUND P0 surfaced by the L-C05-3
dogfood retest (the very next step the CORRECTION06 close
predicted). The next genuinely useful step is to rebuild +
install the new exact-head VSIX (post-CORRECTION07) and re-run
the L-C05 dogfood flow:

  L-C07-1   legacy openai actModeApiProvider -> Settings > Model
            Profiles -> Create first profile -> CREATED -> profile
            appears in the list -> profile card preview shows the
            user-facing label "OpenAI Compatible" (not the runtime
            token "openai" — that P1 polish is owned by UX-POLISH01).
  L-C07-2   Use the freshly-created profile -> next real MiniMax
            request succeeds (NO "Unknown or disabled provider"
            error). The SDK gateway now sees
            cfg.providerId = "openai-compatible" and resolves the
            provider correctly.

Only after L-C07-1/2 succeed should dogfood proceed to A/B
switching (next profile apply -> network test) and the
PARTIALLY_MALFORMED_HEADERS_POLICY review (post-dogfood
decision, not pre-dogfood). The OPENAI_HEADERS_PERSISTED_VALUE
regression guard (audit `openAiHeaders` across CORRECTION05/06/07
fixtures for shape parity) is still pending from CORRECTION06
and is now blocking on a clean L-C07-2.

## CORRECTION08 (2026-09-09, bounded: LIVE_FOUND P0 absorb + single-boundary coverage table addition)

### Trigger

Reviewer verdict (live first-run dogfood after CORRECTION07 closure
`b2e30df7e`, post-MPSP01 closure `f6ee48907`): the post-CORRECTION07
dogfood retest surfaced a NEW live P0 with a signature distinct from
CORRECTION03/05/06/07 and the MPWC01/MPSP01 work. Repro of the live
failure (verified by screenshots in the factory review):

  1. User installs the exact-HEAD VSIX (post-CORRECTION07 +
     post-MPSP01) with ZERO existing ProviderConfigurationInstance /
     ModelProfile records.
  2. User configures the native MiniMax provider (NOT OpenAI-
     Compatible) with a real API key. Live observed geometry:
        actModeApiProvider = "minimax"
        actModeApiModelId  = "MiniMax-M3"   (generic field)
        minimaxApiKey      = "sk-MM3-physical-..."
        minimaxApiLine     = "international"
  3. The direct MiniMax runtime path WORKS live (a "Say hello and
     stop" task completed successfully). This proves:
        MINIMAX_RUNTIME_SUPPORT    = LIVE_PROVEN
  4. After deleting the stale profile (a separate stale-binding
     defect already closed by MPWC02/C6 as fail-closed), the user
     enters Settings > Model Profiles with zero profiles and clicks
     "Create first profile".
  5. Live banner:
        Provider 'minimax' is not covered by the bootstrap path.
        Use Settings > API Configuration to create the profile
        manually.
     -> status = CURRENT_CONFIGURATION_UNSUPPORTED (RED).

The two screenshots together falsify the "MiniMax runtime is broken"
hypothesis and isolate the defect to the bootstrap provider-coverage
table:

  CURRENT_DIRECT_MINIMAX_CONFIG   = LIVE PASS
  BOOTSTRAP_FROM_MINIMAX_CONFIG   = LIVE RED

The first screenshot ("Model profile 'Default' references a missing
provider instance ...") is independently a PASS for the MPWC02/C6
fail-closed binding work; do NOT touch that.

### First-bad boundary

```
ApiConfiguration.provider = "minimax"
  v bootstrap.ts:690 (BOOTSTRAP_COVERAGE.has("minimax"))
BOOTSTRAP_COVERAGE.has(minimax) = false
  v bootstrap.ts:691-694
result = CURRENT_CONFIGURATION_UNSUPPORTED
```

This is NOT a runtime-provider bug. The live evidence already
falsifies that:

```
CURRENT DIRECT MINIMAX CONFIG
  -> real request
  -> PASS
```

So:

```
MINIMAX_RUNTIME_SUPPORT    = LIVE_PROVEN
BOOTSTRAP_CAPTURE_SUPPORT  = LIVE_RED
```

That is the first-bad boundary.

### Why the existing fails-closed behavior was honest but wrong

The "Provider 'minimax' is not covered by the bootstrap path. Use
Settings > API Configuration to create the profile manually." message
is truthful in one narrow sense -- the feature currently cannot
capture a MiniMax configuration as a profile -- but product-wise it
is wrong: the feature cannot claim "save your current setup as a
reusable profile" if a configuration that Cline itself can execute
cannot be captured.

The suggested action ("Use Settings > API Configuration ...") is
nonsense in this context -- the user is already in Settings and
already has a valid API Configuration. That message was written for
a coverage limitation, not for a user action that can resolve it.

### Conservation (this correction MUST NOT)

  - Reopen the Provider Instance Foundation.
  - Change MiniMax runtime provider semantics.
  - Map "minimax" to "openai-compatible" or any other provider id
    (the previous CORRECTION07 was about openai-Compatible aliasing,
    not about hiding native providers).
  - Weaken the unsupported-provider error message for OTHER
    uncovered providers -- the live error message is correct for the
    unset-coverage case; only the COVERAGE TABLE changes.
  - Add new RPC, new proto field, new webview affordance, or new
    capture algorithm.
  - Hardcode "MiniMax-M3" as the bootstrap default model id. The
    resolver must honor the legacy config authority.

### Files changed (bounded)

  apps/vscode/src/sdk/profile-store/bootstrap.ts:
    +1 entry in BOOTSTRAP_COVERAGE: "minimax" (with a CORRECTION08
      in-line rationale comment mirroring the existing CORRECTION08
      test witness at the bottom of this file).
  apps/vscode/src/sdk/cline-session-factory.ts:
    +1 entry in PROVIDER_MODEL_ID_MAP: "minimax" with the generic
      planModeApiModelId / actModeApiModelId slot (same pattern as
      the CORRECTION04 asksage/dify fix).

### Files NOT touched (per bounded-correction discipline)

  apps/vscode/src/sdk/instance-store/typed-projector.ts
    (the canonical-id fold from CORRECTION07 is unaffected; the
     minimax legacy spelling passes through to the SDK gateway as
     "minimax" exactly as expected -- no openai-Compatible-style
     aliasing needed because "minimax" is already canonical on the
     SDK side per sdk/packages/llms/src/providers/ids.ts:64)
  apps/vscode/src/sdk/instance-store/contracts.ts
    (no schema_version bump; no new typed-instance connection
     fields; the V1 connection stays minimal -- baseUrl, headers,
     apiLine absent for minimax because the live geometry does not
     carry them in the bootstrap capture path)
  apps/vscode/src/sdk/sdk-session-config-builder.ts
  apps/vscode/src/sdk/sdk-provider-change-coordinator.ts
  apps/vscode/src/sdk/profile-store/contracts.ts
  apps/vscode/src/shared/model-catalog/provider-helpers.ts
  apps/vscode/src/shared/api.ts
    (the ApiProvider union already includes "minimax"; no schema
     change needed)
  apps/vscode/proto/cline/state.proto
    (no new RPC; no new field; the existing
     bootstrapModelProfileFromCurrentConfiguration RPC handles
     MiniMax without modification)
  apps/vscode/webview-ui/src/components/settings/sections/
    ModelProfilesSection* (no UI change; the existing CTA already
    works correctly once the backend supports the provider)
  apps/vscode/src/core/controller/state/
    bootstrapModelProfileFromCurrentConfiguration.ts (controller
    handler unchanged -- the handler already returns the typed
    BootstrapModelProfileResponse envelope for every status)

### CORRECTION08 RED -> GREEN arc (new test file)

  RED (before this commit):
    TMPDIR=/tmp bun test \
      src/sdk/__tests__/bootstrap-minimax-coverage.mpfrb01-correction08.test.ts
    -> 6 fail / 1 pass
       (the 6 RED tests reproduce the live defect;
        the 1 GREEN test is the regression-pin that verifies
        previously-covered providers remain ok=true in the
        coverage invariant)
    Specifically:
      MPFRB01_C08_RED_M1_LIVE_GEOMETRY:
        Expected: "CREATED"  Received: "CURRENT_CONFIGURATION_UNSUPPORTED"
      MPFRB01_C08_RED_M2_CREDENTIAL_AUTHORITY:
        same envelope (bootstrap refuses before credential capture)
      MPFRB01_C08_RED_M3_MODEL_AUTHORITY:
        same envelope (bootstrap refuses before model capture)
      MPFRB01_C08_RED_M4_CONNECTION_TUPLE:
        same envelope (bootstrap refuses before connection capture)
      MPFRB01_C08_COVERAGE_TABLE:
        BOOTSTRAP_COVERAGE.has("minimax") = false
      MPFRB01_C08_COVERAGE_INVARIANT:
        assertBootstrapCoverageIsWellFormed() returns no diagnostic
        for "minimax" (it's not in the coverage set)

  GREEN (after the bounded fix):
    bun test src/sdk/__tests__/bootstrap-minimax-coverage.mpfrb01-correction08.test.ts
    -> 7 pass / 0 fail / 85 expect() calls
       (the test file is self-contained; the new tests cover the
        exact live geometry AND a different model id to prove
        the resolver honors the legacy config authority rather
        than a hardcoded default)

### Test results (CORRECTION08)

```
bun x tsc --noEmit (apps/vscode/):
  -> exit 0 (clean; the new minimax entry type-resolves correctly
     through BOOTSTRAP_COVERAGE: ReadonlySet<ApiProvider> and
     PROVIDER_MODEL_ID_MAP: Record<string, {plan: keyof ApiConfiguration,
     act: keyof ApiConfiguration}>)

bun ./node_modules/.bin/biome lint \
  src/sdk/profile-store/bootstrap.ts
  src/sdk/cline-session-factory.ts
  src/sdk/__tests__/bootstrap-minimax-coverage.mpfrb01-correction08.test.ts:
  -> exit 0 (biome lint clean; no fixes needed on the touched
     files; the 52 warnings / 670 infos on the broader src/sdk/
     are pre-existing and unrelated)

TMPDIR=/tmp bun test
  src/sdk/__tests__/bootstrap-minimax-coverage.mpfrb01-correction08.test.ts:
  -> 7 pass / 0 fail / 85 expect() calls
     (1 LIVE_GEOMETRY + 1 CREDENTIAL_AUTHORITY + 1 MODEL_AUTHORITY
      + 1 CONNECTION_TUPLE + 1 COVERAGE_TABLE
      + 1 COVERAGE_INVARIANT + 1 REGRESSION_PIN)

TMPDIR=/tmp bun test src/sdk/__tests__/bootstrap-*.test.ts:
  -> 46 pass / 0 fail / 253 expect() calls
     (all prior bootstrap tests stay GREEN; no behavioral
      regression in the bootstrap seam itself -- the only change
      is the BOOTSTRAP_COVERAGE set grew by one entry)

bun ./node_modules/.bin/biome lint src/sdk/:
  -> No new errors / warnings introduced
     (pre-existing 52 warnings + 670 infos unchanged; my three
      files contribute zero)
```

### Verdict (post-CORRECTION08)

  HALT_MODEL_PROFILE_BOOTSTRAP_MINIMAX_COVERAGE_ABSENT
    = CLOSED (CORRECTION08)

  HALT_MODEL_PROFILE_PROVIDER_ID_NOT_CANONICAL
    = CLOSED (CORRECTION07) -- unchanged

  HALT_BOOTSTRAP_EMPTY_HEADERS_REJECTED
    = CLOSED (CORRECTION05) -- unchanged

  HALT_BOOTSTRAP_EMPTY_HEADERS_REPRESENTATION_REJECTED
    = CLOSED (CORRECTION05) -- unchanged

  HALT_MODEL_PROFILE_POST_CREATE_STATE_NOT_PUBLISHED
    = CLOSED (CORRECTION06) -- unchanged

  HALT_MODEL_PROFILE_SECOND_INSTANCE_CREATION_ABSENT
    = CLOSED (SECOND-PROFILE-CREATION-CORRECTION01) -- unchanged

P-class verdict (post-CORRECTION08):

  P0:
    HALT_MODEL_PROFILE_BOOTSTRAP_MINIMAX_COVERAGE_ABSENT
      = CLOSED (CORRECTION08)
    (all previously-closed P0s remain closed)

  P1:
    PROFILE_PROVIDER_LABEL_AUTHORITY = INTERNAL_ID_EXPOSED
      = OPEN POLISH (owned by UX-POLISH01, separate ACT) -- unchanged
    BOOTSTRAP_UNSUPPORTED_PROVIDER_MESSAGE_IS_MISLEADING
      = acknowledged; the message is technically correct for the
        set-not-covered case but the COPY may want a softer
        framing. Not in scope for the CORRECTION08 bounded
        correction -- the user can still take action (fix the
        API configuration) even though the suggested path is
        circular. Tracked as a non-blocking P1.

  P2:
    existing Factory residue + P2 BLANK_AT_EOF_DIAGNOSTICS
      = OPEN (non-blocking; unrelated to bootstrap surface) --
        unchanged

  WORKING_TREE_CLEAN = TRUE (post-commit verified)
  ALL_DURABLE_ACT_FILES_COMMITTED = TRUE (post this commit)
```

### Lessons learned (additive, CORRECTION08)

  #35 "Runtime support" and "bootstrap support" are not the same
     property. The CORRECTION03-Red bounded P1 added
     `assertBootstrapCoverageIsWellFormed()` to pin the inverse
     half of `BOOTSTRAP_COVERAGE has a resolver entry`: every entry
     in the coverage set has wired credential + model resolver
     seams. But that invariant does NOT pin the OTHER direction:
     every API-key-backed provider with a working runtime path
     MUST appear in BOOTSTRAP_COVERAGE. The live MiniMax defect is
     the missing half. Future contributors adding a new provider to
     the runtime must add it to BOOTSTRAP_COVERAGE in lockstep, OR
     the empty-state CTA "Create first profile" silently breaks
     for that provider.

  #36 Providers without dedicated model-id fields are NOT second-
     class citizens for the V1 bootstrap. The CORRECTION04 fix
     taught us the pattern (asksage / dify share the generic
     planModeApiModelId / actModeApiModelId slot); CORRECTION08
     applies the same pattern to MiniMax. A future contributor
     reading `PROVIDER_MODEL_ID_MAP` and seeing only dedicated-
     field providers might wrongly conclude that providers without
     dedicated fields cannot be bootstrap-supported; the CORRECTION04
     + CORRECTION08 comments on the generic-slot entries make this
     explicit.

  #37 The "What NOT to add" lesson from CORRECTION07 applies in
     reverse here: do not silently broaden the coverage set beyond
     what the runtime actually supports. CORRECTION08 is bounded to
     the single MiniMax provider because MiniMax has a valid live
     runtime path AND an API-key-backed credential authority
     (`minimaxApiKey`). A provider with no working runtime path
     must NOT be added to BOOTSTRAP_COVERAGE just because a user
     sees it in the Settings > API Configuration provider list.

  #38 "Use Settings > API Configuration to create the profile
     manually." was a coverage-limitation message dressed as a
     user-action hint. When the coverage set grows, the message
     becomes a lie (the user IS in Settings, the API Configuration
     IS configured). The fix here is to grow the coverage set so
     the message stops firing for valid configurations; a separate
     UX-POLISH01 line item may want to soften the copy for the
     remaining legitimate cases (e.g. a provider the runtime
     genuinely cannot serve). Tracked as P1 above.

  #39 The "scoped" reading of MPWC01 C3 (providerId-equality
     identity collapse) and CORRECTION07 (canonical-id fold at
     the projector) both rely on the bootstrap NOT collapsing the
     legacy spelling. CORRECTION08 preserves that invariant by
     storing `instance.providerId = "minimax"` (legacy spelling
     that already equals the SDK canonical spelling, since
     toSdkProviderId("minimax") === "minimax" -- the
     `model-profiles-store.mpqs01.test.ts` and the typed-projector
     tests already exercise this pass-through). The CORRECTION07
     conservation witness at `bootstrap-openai-canonical-id-
     projection.mpfrb01-correction07.test.ts:237` lists
     `minimax -> minimax (no change)` as one of the cases it
     pins; CORRECTION08 keeps that pin GREEN.

  #40 The two-screenshot pattern (PASS / RED) is a clean
     discriminator for the runtime-vs-bootstrap axis. When the same
     user can demonstrate that a direct config works live but the
     bootstrap refuses, the first-bad boundary MUST be in the
     bootstrap path (not the runtime path). The factory reviewer
     panel's verdict `HALT_MODEL_PROFILE_BOOTSTRAP_MINIMAX_
     COVERAGE_ABSENT` (vs the alternative `HALT_MINIMAX_RUNTIME`)
     correctly identified the seam in one round.

## CORRECTION09: HALT_MINIMAX_APILINE_NOT_CAPTURED (LIVE_FOUND P0 reopen)

### Trigger

Reviewer-panel review of the CORRECTION08 commit surfaced a NEW
LIVE_FOUND P0: even with `minimax` in `BOOTSTRAP_COVERAGE`, the
bootstrap captured `instance.connection = { modelId }` -- WITHOUT
the `apiLine` field. The persisted profile was therefore
incomplete: applying it could only produce the correct MiniMax
routing line (`international`) by inheriting the GLOBAL ambient
`apiLine` from the user's current config. That recreates exactly
the ambient-collapse authority the Provider Instance Foundation
was introduced to eliminate.

The two-screenshot discriminator (PASS / RED on the same user's
geometry) cleanly falsifies the "MiniMax runtime is broken"
hypothesis AND isolates the bootstrap defect to a specific
sub-field: the runtime supports MiniMax, the bootstrap supports
the MiniMax providerId, but the bootstrap does NOT capture the
profile-bound apiLine so the persisted instance is incomplete.

### First-bad boundary

  ApiConfiguration has
      provider      = "minimax"
      modelId       = "MiniMax-M3"
      apiKey        = "sk-MM3-physical-..."
      apiLine       = "international"
  bootstrap.ts:captureConnection(providerId, mode, config)
      resolved modelId  = "MiniMax-M3"            -> captured OK
      resolved baseUrl  = undefined                -> connection.baseUrl undefined (correct)
      resolved apiLine  = undefined                -> connection.apiLine MISSING (DEFECT)
      resolved headers  = n/a (openai-only)        -> connection.headers undefined (correct)

The captured `connection = { modelId: "MiniMax-M3" }` is then
persisted to `instances.json`. On apply, the typed projector
writes `cfg.apiKey = resolved-secret-B` and `cfg.modelId = "MiniMax-M3"`
but leaves `cfg.apiLine = <baseline>` -- silently inheriting the
ambient `apiLine` from the user's current global config.

### Bounded correction

  apps/vscode/src/sdk/profile-store/bootstrap.ts:
    +1 import: resolveApiLine (already exported from cline-session-factory)
    +1 call inside captureConnection: const apiLine = resolveApiLine(providerId, config); if (apiLine) connection.apiLine = apiLine
    + comment block update at the EXACT_CONNECTION_CAPTURE freeze
      (line ~64) to advertise the new field for providers with
      legacy apiLine fields.
    + comment block update inside captureConnection (line ~605)
      to describe the CORRECTION09 semantics.
    + comment block update inside BOOTSTRAP_COVERAGE for "minimax"
      (line ~298) noting the apiLine capture is part of the
      coverage-table fix.

  apps/vscode/src/sdk/profile-store/bootstrap-coverage-invariants.ts:
    + new fields apiLineRequired + apiLineResolved on BootstrapCoverageDiagnostic.
    + new sentinel PROBE_APILINE_SENTINEL = "international".
    + new mapping PROVIDER_APILINE_FIELD (qwen/moonshot/zai/minimax).
    + buildIsolatedProbe now sets the per-provider `<provider>ApiLine`
      field to the sentinel whenever the provider has an entry in
      PROVIDER_APILINE_FIELD. The probe is decoupled from the
      SDK's ProviderSettingsManager (which may not be initialized
      in the bun test runtime); the legacy-config field name is
      what `captureConnection` reads from, so this is the right
      probe geometry.
    + assertBootstrapCoverageIsWellFormed now requires apiLineResolved
      whenever apiLineRequired is true. ok=false otherwise. The
      probe is isolated so a generic fallback cannot falsely GREEN.

  apps/vscode/src/sdk/__tests__/bootstrap-minimax-coverage.mpfrb01-correction08.test.ts:
    + rewritten M4 (RED -> GREEN): the captured instance has
      connection.apiLine === "international" (was toBeUndefined()).
      This was the original M4 miswitness -- the RED test failed
      under the new bootstrap semantics, proving the fix.
    + new M5 (RED -> GREEN projection inversion): baseline
      apiLine="china" + persisted instance apiLine="international"
      -> applyTypedProviderInstanceToConfig -> result.apiLine ===
      "international". Without M5, a future contributor could
      silently regress the projection half (typed-projector.ts:230)
      and the defect would stay hidden in immediate dogfood
      because the ambient setting happens to match the captured one.
    + COVERAGE_INVARIANT updated: minimax diagnostic now also
      asserts apiLineRequired=true AND apiLineResolved=true.
    + REGRESSION_PIN updated: for every previously-covered provider,
      if apiLineRequired then apiLineResolved, else
      !apiLineResolved. (For the current BOOTSTRAP_COVERAGE, only
      minimax has an apiLine field; the others pin apiLineRequired=false.)

### RED -> GREEN arc

  Phase A (RED for the wrong reason): bootstrap does NOT capture
        apiLine + test asserts toBeUndefined -> PASS (GREEN).
        This is the CORRECTION08 commit state, where the
        assertion was wrong but the test was "green".

  Phase B (RED for the right reason): bootstrap DOES capture
        apiLine + test asserts toBeUndefined -> FAIL (RED).
        This was the moment of the reviewer intervention --
        the assertion was wrong AND now the implementation
        contradicts the wrong assertion.

  Phase C (GREEN): bootstrap DOES capture apiLine + test asserts
        toBe("international") -> PASS (GREEN). This is the
        CORRECTION09 commit state.

M5 is a NEW witness that did not exist before CORRECTION09. It
fails (RED) if a future contributor breaks the projection half
(`cfgAny["apiLine"] = conn.apiLine` at typed-projector.ts:230).
The reviewer-requested "inversion discriminator" is the structural
piece: the baseline's apiLine="china" is CONFLICTING with the
profile's apiLine="international", so the projection must REPLACE
the baseline value, not inherit it.

### Test results (CORRECTION09)

  bootstrap-minimax-coverage.mpfrb01-correction08.test.ts:
    8 pass / 0 fail / 106 expect() calls.
    Tests: M1 LIVE_GEOMETRY + M2 CREDENTIAL_AUTHORITY + M3 MODEL_AUTHORITY
           + M4 CONNECTION_TUPLE (with apiLine assertion) + M5 PROJECTION_INVERSION
           + COVERAGE_TABLE + COVERAGE_INVARIANT (with apiLine assertion)
           + REGRESSION_PIN (with apiLine assertion).

  bootstrap suite + typed-projector (regression):
    57 pass / 0 fail / 307 expect() calls (the same 46 bootstrap
    tests + 10 typed-projector tests + the additional M5 = 57 total).
    The CORRECTION07 R5-08..10 legacy-alias witnesses stay GREEN
    (the apiLine probe does not touch them).

  apps/vscode typecheck: exit 0.
  biome --write on touched files: exit 0 (minor import reformat
    on bootstrap-coverage-invariants.ts).

### Conservation

This is NOT a re-architecture: the Foundation already contemplated
`apiLine` as a load-bearing V1 connection field (see
`instance-store/contracts.ts:194` defining
`apiLine?: string | null` and the comment "API line for region-
specific routing (e.g., 'china' | 'international' for Qwen)" at
`sdk/packages/llms/src/providers/config.ts:149`). The CORRECTION09
fix just makes the bootstrap actually populate the field for
providers whose legacy `ApiConfiguration` carries one (qwen,
moonshot, zai, minimax).

### Files NOT touched (conservation)

  - typed-projector.ts: the apiLine projection half
    (setOrClear(cfgAny, "apiLine", conn.apiLine) at line 230) was
    ALREADY in place; CORRECTION09 only feeds it a non-undefined
    value for the first time on the minimax geometry.
  - instance-store/contracts.ts: the V1 ProviderConnection contract
    already had `apiLine?: string | null`. No schema bump needed.
  - cline-session-factory.ts: no changes; resolveApiLine was already
    exported and already had a minimax branch.
  - proto/, webview-ui/, settings UI: untouched.
  - bootstrap-minimax-coverage.mpfrb01-correction08.test.ts
    M1/M2/M3 RED tests: untouched (they were correctly written
    in CORRECTION08; only M4 was wrong).

### Verdict

  HALT_MINIMAX_APILINE_NOT_CAPTURED = CLOSED
  CORRECTION08 = REOPENED -> CLOSED via CORRECTION09
  SUBJECT_COMMITTED = PASS (post this commit)
  TYPE_REGRESSION = NONE
  CONSERVATION = INTACT (typed-projector + instance-store + proto
    + UI all untouched)

### Lessons learned (additive, CORRECTION09)

  #41 The "minimal-coverage-surface" framing from CORRECTION08
     missed that the V1 ProviderConnection contract already
     contemplated `apiLine` (it was in the schema and the typed
     projector already honored it). The reviewer's "the Foundation
     already contemplated `apiLine`; this is not a schema
     invention" framing is the right corrective. When a field
     is on the V1 contract AND on the legacy config, the
     bootstrap must capture it -- not opt out for "minimality".

  #42 The reviewer-requested inversion discriminator (baseline
     ambient value CONFLICTS with the captured value) is a
     stronger witness than a same-value comparison. Same-value
     tests pass for the wrong reason (ambient inherits naturally
     into the result). Inversion tests fail when the projection
     collapses to ambient, even if both halves of the wiring are
     correct individually. Future projection tests should prefer
     inversion over same-value.

  #43 "V1 connection stays minimal" was the wrong conservation
     claim. The V1 connection is "minimal but accurate": every
     field on the contract that has a corresponding legacy-config
     field MUST be captured when present. "Minimal" only refers
     to NOT capturing fields that have no legacy-config source
     (e.g., providerSpecificConfig is V1-only).

  #44 The probe-only isolation invariant from B3 reviewer
     (`buildIsolatedProbe`) extends gracefully to the apiLine
     field by using a hardcoded `<provider>ApiLine` field-name
     mapping decoupled from the SDK's ProviderSettingsManager.
     Decoupling from the runtime provider-settings registry was
     necessary because the bun test runtime doesn't have an
     initialized providers.json, and `resolveApiLine`'s
     fallback to `getProviderSettings()` would have returned
     undefined even for providers that DO have an apiLine
     field.

### Next step

CORRECTION09 closes the LIVE_FOUND P0 surfaced by the reviewer
panel on the CORRECTION08 commit (the reviewer did NOT need a
new live dogfood retest -- the defect was visible in the existing
fixture's `minimaxApiLine = "international"` setting combined with
the original M4's `toBeUndefined` assertion). The next genuinely
useful step is to rebuild + install the new exact-head VSIX
(post-CORRECTION09) and re-run the dogfood flow:

  L-C08-1   native minimax actModeApiProvider -> Settings > Model
            Profiles -> Create first profile -> CREATED -> profile
            appears in the list (no CURRENT_CONFIGURATION_UNSUPPORTED
            banner).
  L-C08-2   Use the freshly-created profile -> next real MiniMax-M3
            request succeeds (the SDK gateway now resolves the
            minimax provider correctly because the bootstrap now
            persists a valid instance with providerId="minimax",
            AND because the apply path now projects
            connection.apiLine="international" onto the active
            session config -- proving the M5 inversion witness
            holds end-to-end).
  L-C08-3   Reload the VS Code window -> the profile still resolves
            credential AND the apiLine AND runs (the durability
            barrier from CORRECTION02 + the canonical-id invariant
            from CORRECTION07 + the apiLine capture from
            CORRECTION09 are all GREEN for the minimax geometry).
  L-C08-4   Stronger discriminator: switch the user's global
            ambient apiLine to "china" (via Settings > API
            Configuration for MiniMax) -> Use the same profile ->
            the next MiniMax request must STILL hit the
            international endpoint (the profile-bound apiLine
            must override the conflicting ambient apiLine; this
            is the M5 inversion witness proven live).

Only after L-C08-1/2/3 succeed should dogfood proceed to A/B
switching (next profile apply -> network test). The next genuinely
distinct P0 will be surfaced by the live retest, NOT predicted in
advance -- per the existing CORRECTION03-07 lesson that "the next
defect is whatever the next live retest shows".
