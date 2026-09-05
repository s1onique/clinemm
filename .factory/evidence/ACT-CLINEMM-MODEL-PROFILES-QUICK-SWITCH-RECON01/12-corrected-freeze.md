# 12 — Corrected §21 freeze (terminal)

PRODUCTION HEAD = 97f49582e

This file SUPERSEDES the §21 freeze that was recorded in
`05-product-discriminator.md` for the recon ACT
`ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01`. The recon ACT
body is unchanged in load-bearing ways; the freeze values are
amended per reviewer's `HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT`
verdict.

EVIDENCE CLASS = TERMINAL FREEZE (this freeze replaces the prior
                  §21 freeze; downstream ACTs must use THIS file
                  as the source of truth).

## Corrected freeze

```text
PROFILE_STORAGE_MODEL                                  = I
                                                         (profile references a
                                                          ProviderConfigurationInstance
                                                          identity, not a providerId;
                                                          secrets stay in existing
                                                          secure provider machinery)

ORIGINAL_PRODUCT_REQUIRES_MULTIPLE_INSTANCES_OF_SAME_PROVIDER = YES
                                                         (the product case explicitly
                                                          cites multiple OpenAI-compatible
                                                          endpoints with different base
                                                          URLs / keys; this is a hard
                                                          requirement)

MODEL_PROFILE_REQUIRES_PROVIDER_INSTANCE_IDENTITY      = YES
                                                         (profile must reference an
                                                          instanceId so two configs of
                                                          one provider can coexist)

CURRENT_STORE_SUPPORTS_MULTIPLE_INSTANCES_OF_SAME_PROVIDER = NO
                                                         (unchanged from prior; now
                                                          reframed as a prerequisite
                                                          to be filled by the foundation
                                                          ACT, not a V1 fact)

SESSION_PROFILE_APPLICATION                            = D (SPLIT_ACTION)
                                                         (footer quick-switch updates
                                                          current task/session only;
                                                          explicit "Set as default"
                                                          updates defaultProfileId)

CURRENT_SESSION_SWITCH_SEAM_EXISTS                     = YES
                                                         (unchanged; both seams wired)

SWITCH_EFFECTIVE_BOUNDARY                              = NEXT_MODEL_REQUEST
                                                         (unchanged; orchestrator comment
                                                          and updateConnection path)

SWITCH_DURING_INFLIGHT_MODEL_REQUEST                   = RESTRICT_UNTIL_IDLE
                                                         (V1 freezes conservative behavior:
                                                          disable picker while a request
                                                          is active; characterization for
                                                          the in-place path justified
                                                          before shipping)

SESSION_PROFILE_BINDING_PERSISTED                      = YES (refined)
                                                         (per-session, not global:
                                                          SESSION_ACTIVE_PROFILE_ID
                                                          persists in session manifest +
                                                          taskHistory.json)

SESSION_ACTIVE_PROFILE_PERSISTED                       = YES
                                                         (NEW field; per-task/session)

GLOBAL_DEFAULT_PROFILE_PERSISTED                       = YES
                                                         (NEW field; lives in globalState)

RESUME_USES                                            = SESSION_ACTIVE_PROFILE
                                                         (+ GLOBAL_DEFAULT_PROFILE
                                                          fallback when no activeProfileId
                                                          is recoverable)

NEW_SESSION_USES                                       = GLOBAL_DEFAULT_PROFILE
                                                         (NEW discriminator)

SWITCH_PERSISTS_GLOBAL_DEFAULT                         = NO (for footer quick-switch)
                                                         (only explicit "Set as default"
                                                          persists global default)

PROFILE_CONTAINS_RAW_SECRET                            = NO
                                                         (unchanged; identity layer does
                                                          not require copying secrets)

MIGRATION_MODEL                                        = HYBRID
                                                         (unchanged; no profiles to migrate
                                                          for existing users)

QUICK_SWITCH_TRIGGER                                   = CURRENT_MODEL_LABEL
   (now reads from SESSION_ACTIVE_PROFILE when a task is open;
    from GLOBAL_DEFAULT_PROFILE when no task is open)

IMPLEMENTATION_SHAPE                                   = SPLIT:
                                                         (1) ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
                                                             (NOT F4; foundation ACT;
                                                              freezes identity layer +
                                                              persistence seam + in-flight
                                                              semantic)
                                                         (2) ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
                                                             (implementation ACT, gated
                                                              on foundation closure)
```

## Delta vs. prior freeze

```text
PROFILE_STORAGE_MODEL                              R        ->  I
MODEL_PROFILE_REQUIRES_PROVIDER_INSTANCE_IDENTITY  NO       ->  YES
ORIGINAL_PRODUCT_REQUIRES_MULTIPLE_INSTANCES_      (new)    ->  YES
   OF_SAME_PROVIDER
SESSION_PROFILE_APPLICATION                        A        ->  D
SESSION_ACTIVE_PROFILE_PERSISTED                   (new)    ->  YES
GLOBAL_DEFAULT_PROFILE_PERSISTED                   (new)    ->  YES
RESUME_USES                                        SESSION_ ->  SESSION_ACTIVE_PROFILE
                                                       LAST_
                                                       PROFILE
NEW_SESSION_USES                                   (new)    ->  GLOBAL_DEFAULT_PROFILE
SWITCH_PERSISTS_GLOBAL_DEFAULT                     YES      ->  NO (for footer quick-switch)
                                                       (implicit)
SWITCH_DURING_INFLIGHT_MODEL_REQUEST               QUEUE_   ->  RESTRICT_UNTIL_IDLE
                                                       FOR_
                                                       NEXT_
                                                       REQUEST
IMPLEMENTATION_SHAPE                               SINGLE   ->  SPLIT (foundation + impl)
```

## Unchanged fields

```text
CURRENT_SESSION_SWITCH_SEAM_EXISTS                = YES
SWITCH_EFFECTIVE_BOUNDARY                         = NEXT_MODEL_REQUEST
PROFILE_CONTAINS_RAW_SECRET                       = NO
MIGRATION_MODEL                                   = HYBRID
QUICK_SWITCH_TRIGGER (semantic, refined)          = CURRENT_MODEL_LABEL
```

## Foundation ACT scope (frozen here)

The implementation ACT is gated on a single bounded foundation ACT:

```text
ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
  OWNERSHIP:
    - ProviderConfigurationInstance schema
      (Option α/β/γ — foundation ACT picks one based on source survey)
    - SESSION_ACTIVE_PROFILE_ID persistence seam
      (Candidate 1+2 recommended, foundation ACT freezes)
    - In-flight semantic for both switch paths
      (RESTRICT_UNTIL_IDLE for V1; characterization for in-place
       path optional)
    - defaultProfileId global state key
  PROD_EDITS:
    - persistence file(s) per chosen Option
    - state-keys.ts extension for defaultProfileId
    - session manifest / taskHistory.json extension for activeProfileId
  TESTS:
    - characterization for the in-place in-flight path
      (recommended; foundation ACT decides)
  GATES:
    - PROFILE_CONTAINS_RAW_SECRET = NO must hold after foundation closes
    - No secret material in any new file
    - Existing providerId-keyed read sites must keep working
      (backward compat during transition)
```

## Implementation ACT scope (gated on foundation closure)

```text
ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
  OWNS:
    - Profile CRUD on top of ProviderConfigurationInstance
    - Footer quick-switch (SPLIT_ACTION semantic)
    - "Set as default" UI affordance
    - buildSessionConfig integration:
        activeProfileId (from manifest) > defaultProfileId
        > current behavior (state-key fallback)
    - Settings "Manage Profiles" page
  GATED_ON:
    - Foundation ACT closure with all invariants green
```
