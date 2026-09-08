# ACT-CLINEMM-MODEL-PROFILES-UX-POLISH01 — Product UX polish (entry)

> **Entry identity (auto-recorded by §0 preflight):**
>
> ```text
> ACT_ID            = ACT-CLINEMM-MODEL-PROFILES-UX-POLISH01
> ENTRY_HEAD        = 632ac4d36
>                    (post-CORRECTION06 closure HEAD — the model-profiles
>                     feature is functionally recognizable as working:
>                     bootstrap RPC, persistence, getStateToPostToWebview
>                     publication, chat quick-switch, and Settings
>                     management section all green; the visible UI is now
>                     what needs polish, not the backend/state model)
> PREDECESSORS      = ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01
>                     (closes P0 HALT_MODEL_PROFILE_POST_CREATE_STATE_NOT_PUBLISHED
>                      at CORRECTION06)
>                     ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
>                     (closes P0-2 typed-foundation bypass + Phase E/F UI)
>                     ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
>                     ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02
>                     ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01
> PREDECESSOR_STATE = BACKEND/STATE_MODEL = SUBSTANTIALLY_WORKING
>                     LIVE_FIRST_RUN_FLOW = WORKING (dogfooded via
>                                          CORRECTION06 P0 closure)
>                     PROFILE_CREATION_UX  = UNCLEAR
>                     PROFILE_SWITCHER_UX  = VISUALLY_WEAK
>                     PROFILE_MANAGEMENT_UX = ACTION_HEAVY
> BRANCH            = main
> PROD_EDITS        = AUTHORIZED (pure UX polish — no semantic change to
>                     profiles, bindings, default, rename, update, delete,
>                     A/B switching, or apply semantics)
> TESTS             = RED->GREEN witnesses for each U-class below
> ```

PRIMARY_EPISTEMIC_PURPOSE =
  Make creating, selecting, and managing Model Profiles
  self-explanatory without changing any profile semantics.

## What the live UX qualification surfaced

The model-profile feature works end-to-end (bootstrap RPC, persistence,
projection, chat quick-switch, settings section). But the UI exposes the
implementation model rather than the user's mental model. Three separate
user jobs are mixed into one horizontal strip:

  SWITCH    = "Use another profile now"            (quick-switch popover)
  CREATE    = "Turn my current configuration into a new named profile"
  MANAGE    = "Rename / update / default / delete profiles"

The current Settings page mixes CREATE and MANAGE; the chat quick-switch
control visually communicates "pale rectangular text field" rather than
"dropdown chooser"; and the profile-card row is action-heavy
(Use / Set default / Rename / Update / Delete) with weak state signals
(Default badge only — no ACTIVE indicator, no DEFAULT-vs-ACTIVE badge
hierarchy).

Additionally, `providerId` leaks directly into the UI as the literal
runtime token `openai` instead of the user-facing label
"OpenAI Compatible". That's the first polish-class leak the bounded
ACT absorbs.

This ACT does NOT touch:

- The bootstrap RPC, its typed envelope, or its success/failure codes.
- `ProfilesStore` / `InstancesStore` / `SecretsStore` writes or
  reconciliation.
- `applyModelProfile` / `setDefaultModelProfile` / `clearDefaultModelProfile`
  / `renameModelProfile` / `updateModelProfileFromCurrent` /
  `deleteModelProfile` / `saveCurrentAsModelProfile` semantics.
- Precedence algebra (`resolveActiveProfileIdForResume/NewTask`).
- Secret projection / webview summary sentinel scan.
- A/B switching semantics.
- `ModelProfileQuickSwitch` testids consumed by external integration tests.

It DOES change:

- Presentation: profile rows collapse to Use + overflow menu
  (`•••` -> Set as default / Update from current / Rename / Delete).
- Presentation: ACTIVE and ACTIVE · DEFAULT badges above the row
  copy, replacing the inline "Default" pill.
- Presentation: Settings page gains an explicit
  `+ New profile` affordance that opens a creation pane (name +
  current-configuration preview + Create / Cancel).
- Presentation: chat quick-switch popover gains a `+ New profile`
  entry that routes to Settings (same target as `Manage Profiles…`).
- Presentation: provider labels resolved through the existing
  `useProviderListings` hook (SDK-backed catalog name), with a
  product-canonical alias for `openai` -> "OpenAI Compatible" when the
  catalog entry is missing or unset.

## Bounded scope freeze

| Frozen invariant                                                | Source ACT              |
|-----------------------------------------------------------------|-------------------------|
| Bootstrap RPC semantics (CREATED / *_FAILED codes)              | MPFRB01                 |
| `ProfilesStore.upsert` / `setDefault` / `clearDefault` writes   | MPQS01 / MPW01          |
| `applyModelProfile` precedence algebra                          | MPQS01 / MPWC01         |
| `isActive` / `isDefault` projection (canonical chokepoint)      | MPQS01 §11              |
| Webview summary secret-sentinel scan                            | MPQS01 §11              |
| Quick-switch keyboard contract (Up/Down/Enter/Esc/aria-* testids) | MPQS01 Phase E          |
| Delete-disabled-for-active-or-default                           | MPQS01 Phase F (P1 fix) |
| Settings section reachability (SettingsView mounts Container)   | MPWC01                  |

All of the above remain behaviorally unchanged. This ACT is a pure
presentation polish.

## Acceptance criteria

### U1 — creation discoverability

RED:
  When `profiles.length > 0`, the Settings page offers no explicit
  "New profile" affordance. The only path is
  `[ Profile name ][ Save current configuration as profile ]`,
  which is an operation description, not an object-creation affordance.

GREEN:
  Settings page renders a `+ New profile` button at the top of the
  Model Profiles section. Clicking it opens a creation pane (inline
  panel; no modal) that contains:
    - Name input
    - Current configuration preview (provider label · model label ·
      endpoint), computed from `useExtensionState().apiConfiguration`
      via the same projection the first-run onboarding pane already
      uses
    - `Create profile` and `Cancel` buttons

  New tests (RED -> GREEN witnesses):
    - `MPUP01_U1_SETTINGS_NEW_PROFILE_BUTTON: profiles.length>0
       renders [data-testid=model-profiles-new-profile-button]`
    - `MPUP01_U1_OPEN_CREATION_PANE: clicking the button renders
       [data-testid=model-profiles-creation-pane] with Name input
       and Create / Cancel`
    - `MPUP01_U1_CREATE_PROFILE: typing a name and clicking
       Create profile invokes onSaveCurrentAsProfile(name)`
    - `MPUP01_U1_CANCEL: clicking Cancel closes the pane without
       invoking onSaveCurrentAsProfile`
    - `MPUP01_U1_FIRST_RUN_UNCHANGED: profiles.length===0 still
       renders the existing first-run onboarding pane (no double CTA)`

### U2 — chooser semantics (compact popover)

The chat quick-switch popover already exists (Phase E) and is
behaviorally correct. The user's complaint is presentation: the
trigger visually communicates "text field" rather than "dropdown".

GREEN:
  Popover list rows are visually grouped:
    - ACTIVE row keeps the existing `aria-selected="true"` + `✓`
      glyph
    - Each row shows profile name + provider display label +
      model display label (resolved through U5)
    - Each row that is also the default gets a `Default` sub-label
      (already present; preserved)
    - Footer divider is unchanged
    - `Manage Profiles…` footer is unchanged

  The trigger is owned by the existing `<ModelDisplayButton>` and is
  out of this ACT's scope to re-style. The popover presentation is
  the only popover-side change.

  New tests (RED -> GREEN witnesses):
    - `MPUP01_U2_POPOVER_ACTIVE_ROW_ARIA: clicking trigger opens
       popover; active row has aria-selected=true and ✓ glyph`
    - `MPUP01_U2_POPOVER_PROVIDER_LABEL: each row's secondary
       line shows the resolved provider label (not the raw id)`
    - `MPUP01_U2_POPOVER_DEFAULT_SUBLABEL: a profile that is
       also default shows "· Default" suffix in its secondary line`

  These tests are additive — existing
  `MPQS01_QS_CURRENT_MARKER` / `MPQS01_QS_POPOVER_LISTS_PROFILES`
  / `MPQS01_QS_SELECT_PROF_B_CALLS_CALLBACK` must remain GREEN.

### U3 — chooser creation path

GREEN:
  Popover gains a divider + `+ New profile` entry positioned between
  the profile list and the existing `Manage Profiles…` footer. Clicking
  it calls the same `onOpenManageProfiles` callback (no second
  navigation path; single route to Settings > Model Profiles). The
  Settings tab on arrival shows the U1 creation pane OPEN by default
  (so the user does not have to click `+ New profile` a second time).

  Implementation note: the Settings arrival-state is communicated
  through a new optional `openCreationPane` prop on
  `ModelProfilesSection` (default `false`). `navigateToSettingsModelPicker`
  on the chat side does NOT pass it (it already routes to the dedicated
  `model-profiles` tab); a separate route helper passes `true` when
  the user came from the chooser creation entry.

  New tests (RED -> GREEN witnesses):
    - `MPUP01_U3_QS_NEW_PROFILE_ENTRY: popover renders
       [data-testid=model-profile-create] between profile list and
       Manage Profiles… footer`
    - `MPUP01_U3_QS_NEW_PROFILE_OPENS_SETTINGS: clicking the entry
       calls onOpenManageProfiles exactly once`
    - `MPUP01_U3_OPEN_CREATION_ON_ARRIVAL: when Settings tab mounts
       with openCreationPane=true, the creation pane renders open`
    - `MPUP01_U3_OPEN_CREATION_DEFAULT_FALSE: when Settings tab
       mounts with openCreationPane omitted, the creation pane is
       closed (back-compat default)`

  Existing `MPFRB01_B4_QS_EMPTY_STATE_CTA` continues to assert the
  empty-state CTA copies "Create first profile" — that empty-state
  copy is distinct from the new U3 `+ New profile` entry.

### U4 — management-action hierarchy

RED:
  Profile rows currently render five flat buttons
  (Use / Set as default / Rename / Update from current / Delete).
  State signals are limited to an inline Default pill.

GREEN:
  Each profile row renders:
    - State badge(s) ABOVE the copy line:
        ACTIVE                  (when isActive)
        DEFAULT                 (when isDefault)
        ACTIVE · DEFAULT        (when both — single combined badge)
      The state badge uses `data-testid=model-profiles-state-badge-{id}`
      with text content "ACTIVE", "DEFAULT", or "ACTIVE · DEFAULT".
    - Primary action: `Use` (existing semantics; disabled when
      `!canApplyLive || isActive`; existing testid preserved).
    - Overflow menu trigger: `•••` button
      (`data-testid=model-profiles-overflow-{id}`). Clicking it
      reveals a small menu with four items:
        Set as default    (hidden when isDefault)
        Update from current
        Rename
        Delete            (disabled when isActive || isDefault;
                            disabled state preserved with explanatory
                            title; existing tooltip semantics preserved)

  The five-flat-buttons layout is GONE.

  New tests (RED -> GREEN witnesses):
    - `MPUP01_U4_ACTIVE_BADGE: isActive=true row renders
       state-badge with text "ACTIVE"`
    - `MPUP01_U4_DEFAULT_BADGE: isDefault=true row renders
       state-badge with text "DEFAULT"`
    - `MPUP01_U4_ACTIVE_DEFAULT_BADGE: isActive && isDefault row
       renders state-badge with text "ACTIVE · DEFAULT"`
    - `MPUP01_U4_OVERFLOW_MENU: clicking the overflow trigger
       reveals menu items via testids
       model-profiles-overflow-set-default-{id},
       model-profiles-overflow-update-{id},
       model-profiles-overflow-rename-{id},
       model-profiles-overflow-delete-{id}`
    - `MPUP01_U4_OVERFLOW_RENAME: clicking overflow Rename enters
       rename input mode (existing data-testid
       model-profiles-rename-input-{id} preserved)`
    - `MPUP01_U4_OVERFLOW_DELETE_DISABLED: overflow Delete is
       disabled for isActive || isDefault rows; existing Delete
       semantic contract preserved (no data loss surface regression)`
    - `MPUP01_U4_FLAT_BUTTONS_GONE: rows do NOT render the legacy
       flat buttons with testids model-profiles-set-default-*,
       model-profiles-rename-*, model-profiles-update-*,
       model-profiles-delete-* (these testids are reserved for the
       overflow menu items; the flat layout itself is gone)`

  The flat-button testids (e.g. `model-profiles-rename-{id}`) were
  consumed by the existing
  `MPQS01_SECT_RENAME` / `MPQS01_SECT_UPDATE_FROM_CURRENT` /
  `MPQS01_SECT_DELETE_*` tests. To preserve back-compat (per the
  bounded scope freeze above), the OVERFLOW MENU items adopt the
  same testid roots with the `overflow-` infix:
    `model-profiles-overflow-rename-{id}`
    `model-profiles-overflow-update-{id}`
    `model-profiles-overflow-delete-{id}`
    `model-profiles-overflow-set-default-{id}`

  The legacy flat-button testids
  (`model-profiles-rename-{id}` etc.) are NOT rendered by the new
  layout. The corresponding Phase F tests
  (`MPQS01_SECT_RENAME` / `MPQS01_SECT_UPDATE_FROM_CURRENT` /
  `MPQS01_SECT_DELETE_*`) are migrated to the new testids under
  `MPUP01_U4_OVERFLOW_RENAME` /
  `MPUP01_U4_OVERFLOW_DELETE_DISABLED` and the migration is
  documented at the top of the test files. The Use button testid
  (`model-profiles-use-{id}`) is UNCHANGED.

### U5 — presentation labels

GREEN:
  Profile row secondary line and chooser popover secondary line show
  the resolved provider display label, not the raw `providerId`.
  Resolution rule (webview-side, pure presentation):

    1. If `useProviderListings()` returns a `ProviderListing` whose
       `id === profile.providerId`, render `listing.name`.
    2. Otherwise, apply a product-canonical alias table:
         "openai"            -> "OpenAI Compatible"
         "openai-compatible" -> "OpenAI Compatible"
         "openrouter"        -> "OpenRouter"
         "anthropic"         -> "Anthropic"
         "cline"             -> "Cline"
         "vscode-lm"         -> "VS Code LM API"
       (Falls back to the raw id for unknown providers — never
       throws, never blocks rendering.)
    3. If neither source yields a label, fall back to the raw id.

  Model display label: the row already renders `profile.modelId`. If
  the model id matches a configured `ModelInfo.displayName` from the
  live catalog (read-only; surfaced only when present), the row
  shows `displayName · modelId` so technical and human labels
  coexist. When the displayName is absent, only `modelId` renders.

  The raw id is NEVER substituted into a clickable link or
  used as a copyable identifier — it remains visible only as a
  tooltip / accessibility hint.

  New tests (RED -> GREEN witnesses):
    - `MPUP01_U5_PROVIDER_LABEL_RESOLVED: when useProviderListings
       returns a listing with name="My Custom Provider" for id="my-prov",
       the row secondary line shows "My Custom Provider · modelId",
       NOT "my-prov · modelId"`
    - `MPUP01_U5_PROVIDER_LABEL_ALIAS: when useProviderListings
       returns no listing for providerId="openai", the row secondary
       line shows "OpenAI Compatible · modelId" (alias applied)`
    - `MPUP01_U5_PROVIDER_LABEL_FALLBACK: when useProviderListings
       returns no listing and no alias matches, the row shows the
       raw id (graceful degradation)`
    - `MPUP01_U5_POPOVER_LABEL: the chooser popover rows render the
       same resolved label as the settings rows (single source of
       truth — extracted into a `formatProviderLabel(providerId,
       listings)` helper consumed by both)`

  A new shared helper
  `apps/vscode/webview-ui/src/components/chat/profileLabels.ts`
  exports:
    `formatProviderLabel(providerId: string, listings:
      ProviderListing[] | undefined): string`
    `formatModelLabel(modelId: string, listings: ProviderListing[] |
      undefined): string`

  Both helpers are PURE functions (no hooks), exported, and unit-
  tested independently under
  `apps/vscode/webview-ui/src/components/chat/profileLabels.test.ts`.

### Behavior conservation (REGRESSION GUARDS)

These MUST remain GREEN. Any failure is a halt.

| Test id                                            | Source ACT              | What it asserts                                                  |
|----------------------------------------------------|-------------------------|------------------------------------------------------------------|
| `MPQS01_SECT_RENDERS_ROWS`                         | MPQS01 Phase F          | Rows render                                                       |
| `MPQS01_SECT_USE_BUTTON`                           | MPQS01 Phase F          | Use still calls onUse(profileId)                                 |
| `MPQS01_SECT_USE_DISABLED_FOR_ACTIVE`              | MPQS01 Phase F          | Use disabled for active                                           |
| `MPQS01_SECT_USE_DISABLED_WHEN_BUSY`               | MPQS01 Phase F          | Use disabled when canApplyLive=false                              |
| `MPQS01_SECT_CLEAR_DEFAULT`                        | MPQS01 Phase F          | Clear default still wired                                         |
| `MPQS01_SECT_EMPTY_LIST`                           | MPQS01 Phase F / B4     | Zero-profile onboarding pane still renders                        |
| `MPFRB01_B4_QS_EMPTY_STATE_CTA`                    | MPFRB01 B4              | Empty-state popover CTA copies "Create first profile"             |
| `MPQS01_QS_CLICK_OPENS_POPOVER`                    | MPQS01 Phase E          | Popover opens on trigger click                                    |
| `MPQS01_QS_POPOVER_LISTS_PROFILES`                 | MPQS01 Phase E          | Popover lists all profiles                                        |
| `MPQS01_QS_CURRENT_MARKER`                         | MPQS01 Phase E          | Active profile shows ✓                                            |
| `MPQS01_QS_SELECT_PROF_B_CALLS_CALLBACK`           | MPQS01 Phase E          | Selecting fires onSelectProfile(id)                               |
| `MPQS01_QS_POPOVER_CLOSES_AFTER_SELECT`            | MPQS01 Phase E          | Popover closes after select                                       |
| `MPQS01_QS_ARROW_NAVIGATES`                        | MPQS01 Phase E          | ArrowDown / Enter navigate + select                               |
| `MPQS01_QS_MANAGE_PROFILES`                        | MPQS01 Phase E          | Manage Profiles… footer wired                                     |
| `MPQS01_QS_DISABLED_WHEN_BUSY`                     | MPQS01 Phase E          | Trigger disabled prop honored                                     |
| `MPQS01_QS_ARIA_ROLES`                             | MPQS01 Phase E          | aria-haspopup + listbox preserved                                 |
| `bootstrap-connection-tuples.mpfrb01`              | MPFRB01                 | Bootstrap writes real instance + secret + headers                 |
| `model-profiles-store.mpqs01`                      | MPQS01 Phase D          | ProfilesStore upsert/default/clear semantics                      |
| `model-profile-session-binding.mpqs01`             | MPQS01 Phase C          | Binding precedence algebra                                        |
| `model-profile-application.mpqs01`                 | MPQS01 Phase A          | Profile-application seam                                          |
| `model-profile-webview-summary.mpqs01`             | MPQS01 Phase D          | Secret-sentinel scan still passes                                 |
| `post-create-state-convergence.mpfrb01-correction06`| MPFRB01 C06             | Post-create state publication threads modelProfilesOwner          |
| `settings-parent-reachability.mpwc01`              | MPWC01                  | SettingsView mounts ModelProfilesSectionContainer                 |
| `chat-parent-reachability.mpwc01`                  | MPWC01                  | ChatTextArea binds ModelProfileQuickSwitch                        |

## Out of scope (explicit)

- Editing the provider configuration inside the creation pane (deferred
  to a future "Configure another provider" branch — per reviewer
  suggestion, not necessary for V1).
- Re-styling the chat `<ModelDisplayButton>` trigger itself (the
  user's "pale rectangular text field" complaint applies here too,
  but the trigger is a cross-cutting chrome element owned by a
  separate UX track).
- Profile order controls (drag-to-reorder, alphabetical, etc.).
- Profile color/icon tags.
- Per-profile environment-variable substitution.
- Multi-profile batch operations.
- Provider catalog changes (we CONSUME `useProviderListings`; we
  do not add or modify any catalog entries).
- `apps/vscode/src/sdk/profile-store/**` — backend files are
  FROZEN by this ACT; only the webview changes.

## Implementation plan (file-touch surface, bounded)

### New files

1. `apps/vscode/webview-ui/src/components/chat/profileLabels.ts`
   - `formatProviderLabel(providerId, listings): string`
   - `formatModelLabel(modelId, listings): string`
   - `PROVIDER_LABEL_ALIASES` constant (V1 freeze).

2. `apps/vscode/webview-ui/src/components/chat/profileLabels.test.ts`
   - Pure-function RED->GREEN witnesses for alias + fallback +
     catalog-resolution paths.

3. `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesCreationPane.tsx`
   - Inline creation pane component (Name input + current-config
     preview + Create / Cancel). Pure presentational; receives the
     same `onSaveCurrentAsProfile` callback the existing section
     already accepts.

### Modified files

4. `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.tsx`
   - Replace the `hasProfiles && (...)` horizontal strip with
     `[+ New profile]` button -> conditionally-rendered
     `<ModelProfilesCreationPane>`.
   - Replace flat row buttons (Set as default / Rename / Update /
     Delete) with overflow menu (`•••`).
   - Replace inline "Default" pill with state badge above the copy.
   - Add `openCreationPane?: boolean` prop (default false).
   - Add `onCancelCreate?: () => void` callback (when creation
     pane closes via Cancel).
   - Apply U5 label formatting in both the row and the (existing)
     empty onboarding summary card.

5. `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSectionContainer.tsx`
   - Read URL-driven `openCreationPane` flag (from
     `navigateToSettingsModelPicker` argument or from a query
     helper). Default false.

6. `apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitch.tsx`
   - Insert divider + `+ New profile` entry between profile list and
     `Manage Profiles…` footer.
   - Apply U5 label formatting to the secondary line.

7. `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.test.tsx`
   - Migrate `MPQS01_SECT_RENAME`,
     `MPQS01_SECT_UPDATE_FROM_CURRENT`,
     `MPQS01_SECT_DELETE_*` testids to the new
     `model-profiles-overflow-*` testids.
   - Add `MPUP01_U4_*` tests (badges + overflow menu).
   - Add `MPUP01_U5_*` tests for label resolution (with a stubbed
     `useProviderListings`).
   - Add `MPUP01_U1_*` tests for the new profile creation pane.
   - PRESERVE `MPQS01_SECT_*` tests that don't reference removed
     testids (e.g. `MPQS01_SECT_RENDERS_ROWS`,
     `MPQS01_SECT_DEFAULT_BADGE` → `MPUP01_U4_DEFAULT_BADGE`,
     `MPQS01_SECT_USE_*`,
     `MPQS01_SECT_CLEAR_DEFAULT`,
     `MPQS01_SECT_EMPTY_LIST`,
     `MPQS01_SECT_SAVE_CURRENT` → `MPUP01_U1_CREATE_PROFILE`,
     `MPQS01_SECT_UNSUPPORTED_CONFIG_NOTICE`).

8. `apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitch.test.tsx`
   - Add `MPUP01_U2_*` and `MPUP01_U3_QS_NEW_PROFILE_*` tests.

### Files NOT touched

- `apps/vscode/src/sdk/profile-store/**` (frozen by scope)
- `apps/vscode/src/core/controller/state/{saveCurrentAs,apply,setDefault,clearDefault,rename,update,delete,bootstrap}ModelProfile*.ts`
- `apps/vscode/proto/cline/state.proto`
- `apps/vscode/src/shared/proto/cline/state.ts` (no proto changes)
- `apps/vscode/webview-ui/src/services/grpc-client.ts`
- `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`
  (no new state keys; existing `modelProfiles` /
  `activeModelProfileId` / `defaultModelProfileId` /
  `apiConfiguration` are sufficient)

## Verification gates

1. `cd apps/vscode && bun run check-types` exits 0.
2. `cd apps/vscode && bun run test:unit` (or its profile-specific
   equivalent) covers all RED->GREEN witnesses above; behavior
   conservation list above stays GREEN.
3. The chat quick-switch + settings creation pane +
   overflow-menu paths are exercised in a manual dogfood session
   against a real LiteLLM-compatible endpoint, and the
   `data-testid`s listed above resolve via DOM inspection in the
   same session. (No formal CI dogfood step in this ACT — that's
   the predecessor's MPFRB01 territory and this ACT explicitly
   does NOT re-trigger it.)

## Risk register

| Risk                                                                           | Mitigation                                                                                                     |
|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| Overflow menu breaks keyboard accessibility (Up/Down/Enter/Esc contract)       | Reuse the existing keyboard contract: Escape closes, Tab moves focus, Enter activates the focused menu item.   |
| Settings tab on-arrival "open creation pane" conflicts with first-run onboarding | `openCreationPane` only opens the pane when `profiles.length > 0`. The first-run onboarding pane is the only pane rendered when `profiles.length === 0`. |
| Provider label resolution introduces new network calls                         | `useProviderListings()` is already populated by the existing `ApiOptions` mount; this ACT adds NO new fetch.   |
| Testid migration breaks external integration tests                              | Only the FLAT row button testids are removed. Quick-switch popover testids, Use button testid, and Settings reachability testid are preserved. Migrated testids are documented in §U4. |
| `formatProviderLabel` aliases drift from SDK catalog                            | Aliases are V1-frozen in `PROVIDER_LABEL_ALIASES`. SDK catalog name wins when present; alias is the fallback.  |

## Status

`OPEN` — entry ACT, no corrections filed yet.
