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
