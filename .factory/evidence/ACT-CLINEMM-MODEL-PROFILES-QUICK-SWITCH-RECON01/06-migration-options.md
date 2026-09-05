# 06 — Migration Options (Q11 / §19)

This file answers ACT §19 "Q11: Backwards compatibility / migration":
"is migration zero-delta for existing users?"

PRODUCTION HEAD = 97f49582e

## Current users have no profiles

There is no pre-existing "profile" concept in the codebase. The
closest neighbors are:

-   `favoritedModelIds: string[]` — a flat list of model IDs
    (NOT provider+model, NOT named profiles).
-   The active `planModeApiProvider` + `actModeApiProvider` +
    per-mode model id triplet in `apiConfiguration`.

Neither of these maps to "a saved profile". So migration is a no-op
by definition: there is nothing to translate.

## Recommended migration model

`MIGRATION_MODEL = HYBRID` (frozen in 05):

-   New users see profiles from day one.
-   Existing users keep their current behavior exactly:
    -   `lastUsedProfileId` is `undefined` for them.
    -   `buildSessionConfig` continues to read
        `planModeApiProvider` / `actModeApiProvider` + per-mode model
        id from `apiConfiguration` as today.
    -   No changes to the Settings UI; profiles appear as a NEW tab
        next to the existing API Options page.

## Edge cases to verify during implementation

1.  **First-time "Save as Profile"**. When the user clicks "Save as
    Profile" in the Settings UI for the first time, the resulting
    `profiles.json` should reflect the CURRENT active selection
    (the one they just clicked Save on), not a stale default.

2.  **`favoritedModelIds` interaction**. Today's favorites list is
    model-id-only. It can stay independent of profiles, or it can
    become a "where did this profile's model come from" lineage.
    Recommendation: KEEP INDEPENDENT for V1 (don't conflate). A
    profile may reference a model that happens to be favorited; the
    two features are orthogonal.

3.  **A user with `planActSeparateModelsSetting = true` saves a
    profile**. The profile must capture both plan AND act selections,
    not just one. Otherwise restoring the profile would silently
    collapse them. (Implementation detail: profile shape includes
    `{ plan: {providerId, modelId}, act: {providerId, modelId} }`.)

4.  **A profile references a provider whose credentials were deleted**.
    When the profile is applied, `ProviderConfigStore.commitSelection`
    will still write the `(providerId, modelId)` to state. The
    next session's `buildSessionConfig` will then read missing
    credentials, surface the existing "auth missing" UI, and the
    user can either restore credentials or pick a different profile.
    No special handling needed.

5.  **`providers.json` migration (F3B residue)**. The mirror between
    `providers.json` and `globalState.json` is maintained by
    `ProviderConfigStore.write`. Profiles do NOT add a third mirror
    surface; they only reference providerId. So no F3B-style
    "dual store consistency" risk is introduced by profiles.

## Freeze

```text
MIGRATION_MODEL                   = HYBRID  (no profiles to migrate; new shape appears next to existing behavior; zero-delta for current users)
EXISTING_FAVORITES_INTERACTION    = KEEP_INDEPENDENT  (favoritedModelIds unchanged)
DELIMITED_AUTH_FOR_REMOVED_PROFILE = EXISTING_UX  (no special handling; auth-missing UI surfaces naturally)
PLAN_ACT_SEPARATE_USERS_PROFILE_SHAPE = BIND_BOTH  (profile = {plan, act} both)
```

EVIDENCE CLASS = INFERRED (no migration work is required by the
                 recon ACT; this file documents the assumption so
                 the implementation ACT can verify it before
                 shipping).
