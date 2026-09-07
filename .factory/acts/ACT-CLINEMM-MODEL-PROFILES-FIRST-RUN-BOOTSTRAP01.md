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
