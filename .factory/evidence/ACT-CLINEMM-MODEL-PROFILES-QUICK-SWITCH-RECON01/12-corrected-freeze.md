# 12 — Corrected §21 freeze (terminal)

PRODUCTION HEAD = 97f49582e

This file is the TERMINAL FREEZE for the recon ACT
`ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01` and its P2/P3
corrections. Downstream ACTs (in particular the named
`ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01`) must use
THIS file as the source of truth.

## History

- v0 (superseded): recon ACT §21 freeze — `PROFILE_STORAGE_MODEL = R`,
  `MODEL_PROFILE_REQUIRES_PROVIDER_INSTANCE_IDENTITY = NO`, etc.
  Source: `05-product-discriminator.md`.
- v1 (superseded by v2): P2 correction freeze addressing
  `HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT`. Set
  `PROFILE_STORAGE_MODEL = I`, `SESSION_PROFILE_APPLICATION = D`,
  `RESUME_USES = SESSION_ACTIVE_PROFILE`, etc. Source: prior version
  of THIS file (commit 830be436).
- v2 (TERMINAL, this version): P3 correction freeze addressing
  `HALT_PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND`. Reviewer
  directive: "amend only these fields". Adds honest
  `NOT_YET_BOUND` / `NOT_YET_PROVEN` framing for the three
  discriminators the foundation ACT must prove by source survey.
  Source: §6 of `ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01.md`.

EVIDENCE CLASS = TERMINAL FREEZE (this is the single source of
                  truth going forward; the §21 freeze in
                  `05-product-discriminator.md` is HISTORICAL only).

## v2 — Terminal freeze (per reviewer amended field list)

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

PROFILE_CONTAINS_RAW_SECRET                            = NO
                                                         (identity layer does not require
                                                          copying secrets; credentials are
                                                          resolved through a foundation-
                                                          chosen secret-reference identity
                                                          namespace - see
                                                          PROVIDER_INSTANCE_CREDENTIAL_IDENTITY)

CURRENT_PROVIDER_MODEL_SWITCH_SEAM_EXISTS              = YES
                                                         (proven for (providerId, modelId)
                                                          domain: updateSessionModel /
                                                          updateConnection)

CURRENT_PROVIDER_INSTANCE_SWITCH_SEAM_EXISTS           = NOT_YET_PROVEN
                                                         (foundation must trace the
                                                          same-providerId-different-
                                                          instanceId switch path:
                                                          old.providerId === new.providerId
                                                          but baseUrl / apiLine / headers /
                                                          region / providerSpecificConfig /
                                                          credential identity differ)

PROVIDER_INSTANCE_CREDENTIAL_IDENTITY                  = NOT_YET_BOUND
                                                         (foundation must answer
                                                          CREDENTIAL_IDENTITY_SCOPE:
                                                          PROVIDER_ID |
                                                          PROVIDER_INSTANCE_ID |
                                                          EXISTING_SECRET_REFERENCE;
                                                          result must permit
                                                          instance A -> secret A,
                                                          instance B -> secret B
                                                          without copying either secret
                                                          into the instance record)

SESSION_ACTIVE_PROFILE_PERSISTED                       = YES
                                                         (invariant; product contract;
                                                          survives restart and resume)

SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM                = NOT_YET_BOUND
                                                         (foundation ACT discovers whether
                                                          task history alone, manifest
                                                          alone, both, or another existing
                                                          metadata seam is minimal;
                                                          no commitment ahead of survey)

SESSION_PROFILE_APPLICATION                            = SPLIT_ACTION
                                                         (footer quick-switch updates
                                                          current task/session activeProfileId
                                                          ONLY; explicit "Set as default"
                                                          updates global defaultProfileId)

GLOBAL_DEFAULT_PROFILE                                 = SEPARATE_FROM_SESSION_ACTIVE_PROFILE
                                                         (lives in globalState.json,
                                                          mirroring favoritedModelIds
                                                          precedent; updated ONLY by
                                                          explicit "Set as default" /
                                                          "Make default on create";
                                                          NOT touched by footer quick-switch)

SWITCH_DURING_INFLIGHT_MODEL_REQUEST                   = RESTRICT_UNTIL_IDLE
                                                         (V1: disable picker while a
                                                          model request is active;
                                                          re-enable on completion /
                                                          error / abort; characterization
                                                          for the in-place same-provider
                                                          path justified before shipping
                                                          a permissive mode)

IMPLEMENTATION_SHAPE                                   = FOUNDATION_THEN_MODEL_PROFILES
                                                         (foundation ACT gates
                                                          implementation ACT;
                                                          foundation narrows to
                                                          identity + credential namespace
                                                          + runtime instance-switch +
                                                          instance-binding seam only)

CURRENT_STORE_SUPPORTS_MULTIPLE_INSTANCES_OF_SAME_PROVIDER = NO
                                                         (unchanged from prior; now a
                                                          prerequisite to be filled by
                                                          the foundation ACT, not a V1
                                                          fact; not overclaimed)

MIGRATION_MODEL                                        = HYBRID
                                                         (unchanged; no profiles to migrate
                                                          for existing users)

QUICK_SWITCH_TRIGGER                                   = CURRENT_MODEL_LABEL
   (now reads from SESSION_ACTIVE_PROFILE when a task is open;
    from GLOBAL_DEFAULT_PROFILE when no task is open)

RESUME_USES                                            = SESSION_ACTIVE_PROFILE
                                                         (+ GLOBAL_DEFAULT_PROFILE
                                                          fallback when no activeProfileId
                                                          is recoverable)

NEW_SESSION_USES                                       = GLOBAL_DEFAULT_PROFILE

SWITCH_PERSISTS_GLOBAL_DEFAULT                         = NO (for footer quick-switch)
                                                         (only explicit "Set as default"
                                                          persists global default)
```

## Delta vs. v1 freeze

```text
CURRENT_SESSION_SWITCH_SEAM_EXISTS              YES     ->  (replaced; generalized to:)
CURRENT_PROVIDER_MODEL_SWITCH_SEAM_EXISTS       (new)   ->  YES
CURRENT_PROVIDER_INSTANCE_SWITCH_SEAM_EXISTS    (new)   ->  NOT_YET_PROVEN
SWITCH_EFFECTIVE_BOUNDARY                       NEXT_   ->  (removed from freeze; was
                                                         MODEL_REQUEST          overclaim about
                                                                                 instance switching)
PROVIDER_INSTANCE_CREDENTIAL_IDENTITY           (new)   ->  NOT_YET_BOUND
SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM         (new)   ->  NOT_YET_BOUND
GLOBAL_DEFAULT_PROFILE_PERSISTED                YES     ->  (moved out of freeze to
                                                         implementation ACT scope;
                                                         GLOBAL_DEFAULT_PROFILE kept
                                                         as invariant)
```

## Foundation ACT scope (narrowed per reviewer)

The implementation ACT is gated on a single bounded foundation ACT.
The foundation is narrowed to provider-instance identity concerns
only; the `defaultProfileId` global key and the `SESSION_ACTIVE_PROFILE_ID`
profile-pointer persistence wiring are NOT foundation work.

```text
ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
  PRIMARY QUESTION (frozen here):
    Can two independently configured instances of the same providerId
    coexist and can an active session transition from instance A to
    instance B such that the NEXT request uses exactly B's effective
    connection + credentials, without duplicating secrets into profiles?

  REQUIRED PHASE 0 RECON (before implementation):
    Instance identity:
      storage candidates α / β / γ
      exact read/write blast radius
    Credential identity:
      how key/token A and key/token B coexist for same providerId
      no raw secret in instance metadata
    Runtime:
      compare A → B where providerId SAME
      does current switch logic rebuild?
      what fields can updateConnection mutate?
      what builds providerConfig / handler?
    Persistence:
      only characterize possible per-session instance-metadata seam;
      do not implement Model Profile fields yet

  RED THAT ACTUALLY MATTERS:
    Construct the real semantic case:
      same providerId, different instanceId, different baseUrl,
      different credential reference
    Then:
      active = A, switch to B, next request effective config = B
    Pre-foundation this should either fail or prove that an
    existing seam already handles it.

  OWNS:
    ProviderConfigurationInstance identity
    secret-reference identity (PROVIDER_INSTANCE_CREDENTIAL_IDENTITY)
    runtime instance-switch behavior (CURRENT_PROVIDER_INSTANCE_SWITCH_SEAM_EXISTS)
    per-session metadata seam FOR INSTANCE BINDING ONLY
      (SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM, narrowed to
       "what is the per-session seam for the currently-bound instance?")

  DOES NOT OWN:
    defaultProfileId global key (implementation ACT)
    Profile-pointer wiring (SESSION_ACTIVE_PROFILE_ID as a profile
      pointer belongs to the implementation ACT; foundation only
      characterizes the instance-binding seam)
    Profile CRUD, footer quick-switch UI, "Set as default" UI,
      Settings "Manage Profiles" page (implementation ACT)

  PROD_EDITS:
    - persistence file(s) per chosen Option (α/β/γ)
    - state-keys.ts extension for instance records and
      per-session instance binding (NOT defaultProfileId)
    - existing providerId-keyed read sites: backward-compat
      during transition
  TESTS:
    - characterization for the same-providerId-different-instanceId
      switch (foundation must either prove the seam or prove it
      doesn't exist; either outcome unblocks the implementation ACT)
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
    - defaultProfileId global state key + "Set as default" UI affordance
    - SESSION_ACTIVE_PROFILE_ID profile-pointer wiring
      (extends the foundation's instance-binding seam to also carry
       the profile pointer)
    - Footer quick-switch (SPLIT_ACTION semantic)
    - buildSessionConfig integration:
        activeProfileId (from manifest) > defaultProfileId
        > current behavior (state-key fallback)
    - Settings "Manage Profiles" page
  GATED_ON:
    - Foundation ACT closure with all foundation invariants green
    - CURRENT_PROVIDER_INSTANCE_SWITCH_SEAM_EXISTS proven YES
    - PROVIDER_INSTANCE_CREDENTIAL_IDENTITY bound
    - SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM bound (for the
      instance-binding use case at minimum; the profile-pointer
      wiring is implementation ACT work)
```
