# 08 — Final Report (§34 terminal review, AMENDED by P2 + P3 corrections)

PRODUCTION HEAD = 97f49582e
RECON CLOSE     = PASS (initial) → AMENDED via P2 CORRECTION01

```text
AMENDMENT_NOTICE (v1):
  Reviewer verdict 2026-09-05a = HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT
  P2 correction ACT            = ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01
  Freeze superseded by         = .factory/evidence/ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01/12-corrected-freeze.md (v1)
  Source chain preserved       = 00..07 unchanged; recon source work survives
  Implementation status        = NOT AUTHORIZED; foundation ACT prerequisite

AMENDMENT_NOTICE (v2):
  Reviewer verdict 2026-09-05b = HALT_PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND
                                  (authorizes foundation ACT, narrower scope)
  P3 correction ACT            = §6 of ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01
  Freeze superseded by         = .factory/evidence/ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01/12-corrected-freeze.md (v2; terminal)
  New P0 closed                = PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND
                                  (seam not proven for same-providerId-different-instanceId
                                   switch; foundation ACT must trace via evidence 13 RED plan)
  New P0 closed                = SAME_PROVIDER_MULTI_CREDENTIAL_IDENTITY_NOT_BOUND
                                  (credentialReference namespace must be frozen by foundation)
  New P1 closed                = session persistence seam frozen ahead of source survey
                                  (downgraded to SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM
                                   = NOT_YET_BOUND; foundation discovers)
  New P1 closed                = defaultProfileId was incorrectly included in foundation scope
                                  (moved to implementation ACT scope)
  Foundation ACT authorized    = ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
                                  (narrower: identity + credential namespace + runtime
                                   instance-switch + instance-binding seam only)
  Implementation ACT status    = NOT AUTHORIZED (still gated on foundation closure)
  New evidence                 = 13-instance-switch-semantic-recon-plan.md
  Amended evidence             = 09, 10, 12 (surgical NOT_YET_BOUND / NOT_YET_PROVEN additions)
  Source chain preserved       = 00..07 unchanged; recon source work survives
```

## §34 terminal review — answers (corrected)

```text
 1. What is a Model Profile?
    A named bundle of { instanceId, modelId, optional per-mode
    override fields } stored in <dataDir>/settings/profiles.json.
    A profile is a NAMED REFERENCE to a ProviderConfigurationInstance
    identity (not a providerId), never a duplicate of credentials
    or base URL. PROFILE_STORAGE_MODEL = I.
    (CORRECTION: prior freeze said R; the product explicitly requires
     multiple configurations of the same provider to coexist.)

 2. Does it duplicate provider settings?
    NO. Profiles REFERENCE instanceId; credentials (apiKey, OAuth,
    baseUrl, apiLine, headers, region) live in the existing secure
    provider machinery keyed by the instance's resolved providerId.
    PROFILE_CONTAINS_RAW_SECRET = NO (unchanged).

 3. Can two configurations of the same provider coexist?
    YES — but ONLY after the foundation ACT freezes the
    ProviderConfigurationInstance identity layer. The foundation ACT
    picks Option α/β/γ based on source survey (see
    09-provider-instance-identity-options.md). Until then,
    CURRENT_STORE_SUPPORTS_MULTIPLE_INSTANCES_OF_SAME_PROVIDER = NO,
    and the foundation ACT is the bounded prerequisite.
    ORIGINAL_PRODUCT_REQUIRES_MULTIPLE_INSTANCES_OF_SAME_PROVIDER = YES.

 4. What does clicking a profile do to the current task?
    It commits the profile's (instanceId, modelId) for the active
    mode via ProviderConfigStore.commitSelection (same shape as
    before; the new field is the instanceId).

    For the OLD domain (providerId, modelId) only:
      - same providerId, same instance, different model
        → in-place updateSessionModel (cheap, next-request-applied)
      - different providerId
        → SdkProviderChangeCoordinator restarts the active session
          (heavier but tested; Seam 2 in evidence 13)

    For the NEW domain (instanceId, providerId, modelId, effective
    provider config): UNPROVEN. Both Seam 1 and Seam 2 are
    triggered by providerId equality/inequality; same-providerId-
    different-instance is NOT in either discriminator. The foundation
    ACT must trace this case via the RED plan in
    13-instance-switch-semantic-recon-plan.md and freeze either
    reuse (Outcome A), forced-rebuild discriminator (Outcome B),
    or a bounded runtime-switch extension (Outcome C).

    (CORRECTION-v2: prior answer overclaimed. The 5-question RED
     in evidence 13 must be answered before either path can carry
     profile-instance switching.)

    It updates ONLY the current task/session's activeProfileId,
    NOT the global defaultProfileId.
    SESSION_PROFILE_APPLICATION = D (SPLIT_ACTION).
    CURRENT_PROVIDER_INSTANCE_SWITCH_SEAM_EXISTS = NOT_YET_PROVEN.

 5. What exact request boundary applies the change?
    For the proven (providerId, modelId) domain:
      SWITCH_EFFECTIVE_BOUNDARY = NEXT_MODEL_REQUEST (the orchestrator's
      updateConnection is documented as "Mutate provider / reasoning
      fields for subsequent runs" — applies to the next agentic run,
      never to a request already in flight).
    For the (instanceId, providerId, modelId, effective provider config)
      domain: NOT_YET_PROVEN. See Q4 above and evidence 13.

    SWITCH_DURING_INFLIGHT_MODEL_REQUEST = RESTRICT_UNTIL_IDLE
    (P2 CORRECTION: prior freeze said QUEUE_FOR_NEXT_REQUEST, which the
     orchestrator comment does NOT prove for the provider-restart
     path; conservative behavior is to disable the picker while a
     request is active).
    (P3: still RESTRICT_UNTIL_IDLE in v2; characterization for
     the in-place same-provider path justified before shipping a
     permissive mode.)

 6. What survives restart/resume?
    SESSION_ACTIVE_PROFILE_PERSISTED = YES (product invariant).
    RESUME_USES = SESSION_ACTIVE_PROFILE: buildSessionConfig reads
    it first on next session start; if present, the profile's
    selections are committed before the first request. If the
    profile was deleted, falls back to GLOBAL_DEFAULT_PROFILE;
    if neither is set, falls back to current behavior (state-key
    read).
    NEW_SESSION_USES = GLOBAL_DEFAULT_PROFILE.

    SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM = NOT_YET_BOUND
    (P3 CORRECTION: prior answer said "session manifest + taskHistory.json";
     this upgraded a candidate into a frozen design. The foundation ACT
     discovers the minimal seam; see evidence 10 downgrade and
     evidence 13 Step 1.)

 7. What becomes the global default?
    Nothing automatically. The footer quick-switch updates the
    current task/session ONLY; it does NOT change the global
    default. The global defaultProfileId is changed only by an
    explicit "Set as default" action in the Settings UI.
    SWITCH_PERSISTS_GLOBAL_DEFAULT = NO (for footer quick-switch).

 8. How are credentials handled?
    They are NOT handled by the profile. apiKey / OAuth / baseUrl /
    apiLine / headers / region remain exclusively in the existing
    secure provider machinery (providers.json + secrets.json +
    OAuth storage).
    The profile references the instanceId; the runtime resolves
    the instance, then routes to the existing ProviderSettingsManager
    for credentials.
    PROFILE_CONTAINS_RAW_SECRET = NO (frozen; provider-instance
    identity does NOT require copying secrets into profile records).

    (P3 CORRECTION: prior answer claimed credentials are "keyed by
     the instance's resolved providerId" — that is wrong for the
     two-instance case. PROVIDER_INSTANCE_CREDENTIAL_IDENTITY =
     NOT_YET_BOUND; CREDENTIAL_IDENTITY_SCOPE = NOT_YET_BOUND;
     the foundation ACT must pick PROVIDER_INSTANCE_ID as the
     credential namespace, not PROVIDER_ID. See evidence 09 P3-2
     section.)

 9. Is migration zero-delta?
    YES, by construction. No pre-existing "profile" concept exists
    in the codebase. Existing users keep their current behavior
    exactly: SESSION_ACTIVE_PROFILE = undefined AND
    defaultProfileId = undefined → buildSessionConfig reads state
    keys directly as today. New users see profiles from day one.
    MIGRATION_MODEL = HYBRID (zero-delta for existing users, new
    shape appears next to existing behavior).

10. What exact implementation ACT follows?
    THREE bounded ACTs (gated):
    (0) ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01 —
        foundation ACT (NOT F4). NARROWED scope per P3 reviewer:
        only owns ProviderConfigurationInstance identity +
        secret-reference identity (CREDENTIAL_IDENTITY_SCOPE) +
        runtime instance-switch behavior (the 5-Q RED in evidence 13)
        + per-session instance-binding seam (NOT the profile-pointer
        wiring). Does NOT own defaultProfileId global key, Profile
        CRUD, or any UI. AUTHORIZED (named).
    (1) ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 —
        implementation ACT (NOT yet authorized). Owns Profile CRUD,
        defaultProfileId global key, SESSION_ACTIVE_PROFILE_ID
        profile-pointer wiring (extending the foundation's
        instance-binding seam), footer quick-switch (SPLIT_ACTION),
        "Set as default" UI, Settings "Manage Profiles" page.
        Gated on (0) closing with all invariants green.
    IMPLEMENTATION_SHAPE = FOUNDATION_THEN_MODEL_PROFILES
    (renamed from SPLIT for clarity).

11. STOP.
```

## Source chain summary

```text
00-preflight.txt                                → recon opened cleanly at 97f49582e
01-current-provider-persistence.md              → two-store persistence; one providerId per Record entry
02-session-provider-binding.md                  → buildSessionConfig is the composition root;
                                                  SessionRuntime.updateConnection mutates "for
                                                  subsequent runs"
03-existing-switch-seams.md                     → both seams (in-place via updateConnection,
                                                  restart via SdkProviderChangeCoordinator)
                                                  exist and are wired;
                                                  CURRENT_SESSION_SWITCH_SEAM_EXISTS = YES
04-ui-model-indicator-chain.md                  → footer reads apiConfiguration;
                                                  converges O(next request) on apply
05-product-discriminator.md                     → initial §21 freeze (PROFILE_STORAGE_MODEL = R)
                                                  — SUPERSEDED by 12
06-migration-options.md                         → MIGRATION_MODEL = HYBRID (zero-delta)
07-implementation-boundary.md                   → initial SINGLE_ACT scope envelope
                                                  — SUPERSEDED by 12 (now SPLIT)
08-final-report.md                              → this file (AMENDED by P2 correction)
09-provider-instance-identity-options.md        → Q-mechanical-1 answer (Option α/β/γ;
                                                  foundation ACT picks one)
10-session-active-profile-persistence.md        → Q-mechanical-2 answer (Candidate 1+2;
                                                  foundation ACT freezes the seam)
11-inflight-provider-change-characterization.md → Q-mechanical-3 answer
                                                  (RESTRICT_UNTIL_IDLE for V1;
                                                   characterization for in-place path
                                                   justified but not blocking)
12-corrected-freeze.md                          → TERMINAL CORRECTED FREEZE (v2)
                                                  (this is the source of truth going forward)
13-instance-switch-semantic-recon-plan.md         → mechanical RED plan the foundation ACT
                                                  must execute (P3-1); answers Q1-Q5 about
                                                  same-providerId-different-instanceId switch
```

## Predecessor chain (load-bearing facts preserved)

```text
F3   (256943c5c)  PASS_F3_RECON_OUTCOME_B
F3B  (321ad2dd5)  PASS_F3B_NO_REPAIR_NEEDED  (T17=NOT_REPRODUCED)
F3B  (bfa2ad592)  P2 closure-evidence precision
MP   (b55407d03)  open
MP   (97f49582e)  P1 wording correction
MP   (<prior-commit>) P2 correction (HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT
                      resolved via bounded correction01; recon source work
                      preserved; freeze amended; foundation ACT authorized)
MP   (<this-commit>)  P3 correction (HALT_PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND
                      resolved via bounded correction02 = §6 of P2 correction ACT;
                      freeze narrowed to reviewer's amended field list;
                      foundation ACT scope narrowed; recon source work preserved)
```

## Cross-ACT boundaries (preserved)

-   `ACT-CLINEMM-EFFECTIVE-MODEL-CONTEXT-WINDOW-AUTHORITY-RECON01`
    (MiniMax 1.3M→24.6k): stays separate, unaffected. Profile
    selection does NOT change the runtime's effective context
    window resolution.
-   `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-ASYNC-JOB-WAKE-OWNERSHIP-RECON01`
    (WAITING_WITHOUT_WAKE_SOURCE): stays separate, unaffected.
    Profile application uses existing async ownership paths.

## Next action (corrected)

NOT authorized as a single implementation ACT. The recon closes at
the P2-corrected freeze (file 12). The next ACT to open is the
**foundation ACT**:

```text
ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
  (NOT F4; bounded; NARROWED scope per P3 reviewer:
   ProviderConfigurationInstance identity +
   secret-reference identity (CREDENTIAL_IDENTITY_SCOPE) +
   runtime instance-switch behavior (evidence 13 RED plan) +
   per-session instance-binding seam only.
   Does NOT own defaultProfileId, Profile CRUD, or UI.)
```

Only after the foundation ACT closes with all invariants green may
the implementation ACT
(`ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01`) be
authorized.
