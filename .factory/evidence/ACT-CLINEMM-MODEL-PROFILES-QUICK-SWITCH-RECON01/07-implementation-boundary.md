# 07 — Implementation Boundary (Q12 / §28)

This file answers ACT §28 "Implementation handoff requirements" and
§27 "Permitted outcomes". It is the technical scope envelope the
implementation ACT must respect.

PRODUCTION HEAD = 97f49582e

## Recommended outcome: A (V1 straightforward)

Per §27 Outcome A and 05 freeze `IMPLEMENTATION_SHAPE = SINGLE_ACT`:

A SINGLE bounded backend+state+UI ACT delivers V1. No follow-up UI
ACT is required; no Follow-up state ACT is required. The runtime
seams (in-place updateConnection and restart via
SdkProviderChangeCoordinator) are reused; no new runtime seam is
created.

## Boundary of the V1 ACT

### In scope

1.  **Storage**
    -   New file `<dataDir>/settings/profiles.json` (mode 0o600) with
        schema `{ profiles: Record<profileId, ModelProfile> }`.
    -   Or: extend `StoredProviderModes` with a `modelProfiles` block
        (matches the existing `voiceInput` precedent). Decision
        delegated to the implementation ACT.
    -   New state key `lastUsedProfileId: string | undefined` in
        `state-keys.ts`.

2.  **Runtime / proto**
    -   New RPCs in `models.proto` (or a new `profiles.proto`):
        `listModelProfiles`, `createModelProfile`, `updateModelProfile`,
        `deleteModelProfile`, `applyModelProfile`.
    -   Handler implementations in
        `apps/vscode/src/core/controller/profiles/`.
    -   `applyModelProfile(profileId)` translates the profile into:
        -   One `commitSelection(providerId, "plan", …)` call
        -   One `commitSelection(providerId, "act", …)` call
        -   One `setGlobalStateBatch({ lastUsedProfileId, … })`
        -   Existing `handleProviderConfigChange` + `handleApiConfigurationChanged`
            carry the rest (in-place or restart).

3.  **buildSessionConfig integration**
    -   Read `lastUsedProfileId` at the start.
    -   If present + profile still exists: commit the profile's
        `(plan, act)` selections BEFORE the session starts.
    -   If absent or deleted: fall back to current behavior
        (read state keys directly). Zero-delta for existing users.

4.  **UI (webview-ui)**
    -   Compact profile picker triggered by clicking the footer model
        label.
    -   "Manage Profiles…" entry into Settings.
    -   Settings page: list / create / edit / delete profiles.
    -   Empty-state for users with no saved profiles.

### Out of scope (deferred)

1.  **Provider-instance identity** (multiple credential sets per
    providerId). Future ACT if user demand appears.
2.  **Profile sharing / cloud sync**. §20 froze `LOCAL_USER V1`.
3.  **Profile-level auto-approval overrides**. Profiles are pure
    model/provider configs, not policy bundles.
4.  **Removing the legacy mirror residue** (100+ legacy per-mode keys).
    That is a Factorize-level cleanup, separate ACT.
5.  **Folding `favoritedModelIds` into profiles**. Keep orthogonal.

## Test envelope (per §23)

-   **Unit tests** (required):
    -   Profile storage round-trip (read/write/delete).
    -   `applyModelProfile` translates to correct commitSelection
        sequence.
    -   Resume logic correctly falls back to GLOBAL_DEFAULT when
        profile is missing.
-   **Characterization tests** (optional, only if needed):
    -   `applyModelProfile` on a live session triggers the in-place
        path when provider matches, restart path when it doesn't.
-   **No RED suite** before implementation lands.

## Acceptance matrix (per §29)

Each §21 discriminator value MUST be observable at the end of the
implementation ACT:

| Frozen value                                                          | How to verify                                              |
|-----------------------------------------------------------------------|------------------------------------------------------------|
| `PROFILE_STORAGE_MODEL = R`                                            | profiles.json entry has no apiKey/auth fields              |
| `SESSION_PROFILE_APPLICATION = CURRENT_SESSION_NEXT_REQUEST`           | apply during a session → next request uses new selection   |
| `SWITCH_EFFECTIVE_BOUNDARY = NEXT_MODEL_REQUEST`                       | orchestrator trace shows no in-flight mutation             |
| `SWITCH_DURING_INFLIGHT_MODEL_REQUEST = QUEUE_FOR_NEXT_REQUEST`        | unit test for in-flight apply                              |
| `SESSION_PROFILE_BINDING_PERSISTED = YES`                              | state.postStateToWebview reflects lastUsedProfileId        |
| `RESUME_USES = SESSION_LAST_PROFILE`                                   | new session from a profile-bound history restores profile  |
| `PROFILE_CONTAINS_RAW_SECRET = NO`                                     | profiles.json schema excludes apiKey/auth                  |
| `MIGRATION_MODEL = HYBRID`                                             | existing user with no profiles keeps current behavior       |
| `QUICK_SWITCH_TRIGGER = CURRENT_MODEL_LABEL`                           | clicking footer opens picker                               |
| `IMPLEMENTATION_SHAPE = SINGLE_ACT`                                    | one ACT, one board row                                     |

## Halt conditions (re-evaluated for the implementation ACT)

The implementation ACT must HALT and re-open recon if:

-   The chosen storage shape cannot represent a profile without
    duplicating credentials (would force `PROFILE_CONTAINS_RAW_SECRET`
    to YES, violating §13).
-   The in-place path is observed to mutate an in-flight stream
    during characterization (would violate
    `SWITCH_DURING_INFLIGHT_MODEL_REQUEST`).
-   Resume semantics cannot round-trip
    (`RESUME_USES = SESSION_LAST_PROFILE` unachievable without
    breaking the existing "last active provider" behavior).

EVIDENCE CLASS = SCOPE BOUNDARY derived from 01–06 + §27/§28.
                 No new recon is implied; this is the contract the
                 implementation ACT inherits.
