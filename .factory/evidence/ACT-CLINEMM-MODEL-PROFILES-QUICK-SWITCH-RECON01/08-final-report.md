# 08 — Final Report (§34 terminal review, AMENDED by P2 + P3 + P4 corrections)

PRODUCTION HEAD = 97f49582e
RECON CLOSE     = PASS (initial) → AMENDED via P2 CORRECTION01 → CLOSED FOR FOUNDATION HANDOFF (per third-reviewer PASS_WITH_ONE_BOUNDED_P1, C1: GO TO FOUNDATION RECON)

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
  New P0 transferred           = PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND
                                  (seam not proven for same-providerId-different-instanceId
                                   switch; foundation ACT must trace via evidence 13 RED plan)
  New P0 transferred           = SAME_PROVIDER_MULTI_CREDENTIAL_IDENTITY_NOT_BOUND
                                  (credentialReference namespace must be frozen by foundation)
  New P1 transferred           = session persistence seam frozen ahead of source survey
                                  (downgraded to SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM
                                   = NOT_YET_BOUND; foundation discovers)
  New P1 transferred           = defaultProfileId was incorrectly included in foundation scope
                                  (moved to implementation ACT scope)
  Foundation ACT authorized    = ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
                                  (narrower: identity + credential namespace + runtime
                                   instance-switch + instance-binding seam only)
  Implementation ACT status    = NOT AUTHORIZED (still gated on foundation closure)
  New evidence                 = 13-instance-switch-semantic-recon-plan.md
  Amended evidence             = 09, 10, 12 (surgical NOT_YET_BOUND / NOT_YET_PROVEN additions)
  Source chain preserved       = 00..07 unchanged; recon source work survives

AMENDMENT_NOTICE (v3):
  Reviewer verdict 2026-09-05c = PASS_WITH_ONE_BOUNDED_P1 — C1: GO TO FOUNDATION RECON
                                  (third reviewer closed the recon cycle)
  P4 correction ACT            = §7 of ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01
  Freeze superseded by         = .factory/evidence/ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01/12-corrected-freeze.md (v3; terminal)
  Bounded P1 (FOUNDATION_RED_TOO_HIGH_LEVEL):
                                  evidence 13 single-stage RED split into
                                  R0 (current-seam characterization witness; runs BEFORE
                                      production edits; measures
                                      CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY,
                                      CURRENT_SEAM_MUTATES_FULL_CONNECTION,
                                      CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY;
                                      prior NO/NO/NO)
                                  + R1 (post-identity semantic RED; runs AFTER instance
                                        abstraction exists; primary assertion =
                                        NEXT_EFFECTIVE_CONNECTION effective-config tuple)
  P2 wording correction:
                                  NOT_YET_BOUND / NOT_YET_PROVEN now read as
                                  OPEN_FOUNDATION_QUESTION (overclaim closed;
                                  capability transferred to foundation), NOT as
                                  "new P0 closed". Applied to evidence 12 v3.
                                  Pure reading instruction; no semantic change
                                  to freeze values. Factory P2/non-blocking.
  Foundation ACT status         = AUTHORIZED (narrowed scope per §7.3 of correction ACT body)
  Implementation ACT status     = NOT AUTHORIZED (still gated on foundation closure)
  Recon correction cycle        = CLOSED
  Source chain preserved        = 00..07 unchanged; recon source work survives
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
        foundation ACT (NOT F4). LOCKED scope per P4 reviewer
        (PASS_WITH_ONE_BOUNDED_P1, third reviewer, C1: GO TO
        FOUNDATION RECON; full AUTHORIZATION):
        only owns ProviderConfigurationInstance identity +
        secret-reference identity (CREDENTIAL_IDENTITY_SCOPE) +
        runtime instance-switch behavior (R0 + R1 RED in evidence 13;
        R0 = current-seam characterization witness, R1 = post-identity
        semantic RED with NEXT_EFFECTIVE_CONNECTION primary assertion)
        + per-session instance-binding seam (NOT the profile-pointer
        wiring). Does NOT own defaultProfileId global key, Profile
        CRUD, activeProfileId profile semantics, or any UI.
        AUTHORIZED.
    (1) ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 —
        implementation ACT (NOT yet authorized). Owns Profile CRUD,
        defaultProfileId global key, SESSION_ACTIVE_PROFILE_ID
        profile-pointer wiring (extending the foundation's
        instance-binding seam), footer quick-switch (SPLIT_ACTION),
        "Set as default" UI, Settings "Manage Profiles" page.
        Gated on (0) closing with all invariants green AND R0/R1
        freezing their results.
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
12-corrected-freeze.md                          → TERMINAL CORRECTED FREEZE (v3)
                                                  (this is the source of truth going forward;
                                                   v2 → v3 was a P2/non-blocking wording
                                                   correction: NOT_YET_* now read as
                                                   OPEN_FOUNDATION_QUESTION per third reviewer)
13-instance-switch-semantic-recon-plan.md         → mechanical RED plan the foundation ACT
                                                  must execute (v3: split into R0 current-seam
                                                  characterization witness + R1 post-identity
                                                  semantic RED with NEXT_EFFECTIVE_CONNECTION
                                                  primary assertion); answers Q1-Q5 about
                                                  same-providerId-different-instanceId switch
```

## Predecessor chain (load-bearing facts preserved)

```text
F3   (256943c5c)  PASS_F3_RECON_OUTCOME_B
F3B  (321ad2dd5)  PASS_F3B_NO_REPAIR_NEEDED  (T17=NOT_REPRODUCED)
F3B  (bfa2ad592)  P2 closure-evidence precision
MP   (b55407d03)  open
MP   (97f49582e)  P1 wording correction
MP   (830be436d)  P2 correction (HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT
                      resolved via bounded correction01; recon source work
                      preserved; freeze amended; foundation ACT authorized)
MP   (951f171e0)  P3 correction (HALT_PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND
                      resolved via bounded correction02; freeze v2 with
                      honest NOT_YET_BOUND/NOT_YET_PROVEN framing;
                      evidence 13 added; foundation ACT scope narrowed)
MP   (<this-commit>) P4 correction (PASS_WITH_ONE_BOUNDED_P1 third-reviewer
                      verdict; evidence 13 RED split into R0 + R1;
                      freeze v3 with OPEN_FOUNDATION_QUESTION reading
                      instruction; foundation ACT scope locked per §7.3;
                      recon correction cycle CLOSED)
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

## Next action (corrected — closed for foundation handoff per P4)

The recon correction cycle is **CLOSED** per third-reviewer
PASS_WITH_ONE_BOUNDED_P1 (C1: GO TO FOUNDATION RECON). The next ACT
to open is the **foundation ACT** (now AUTHORIZED per §7.3 of the
correction ACT body):

```text
ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
  (NOT F4; bounded; AUTHORIZED per P4 verdict;
   scope LOCKED per §7.3:
   - ProviderConfigurationInstance identity
   - secret-reference identity (CREDENTIAL_IDENTITY_SCOPE = PROVIDER_INSTANCE_ID)
   - runtime instance-switch behavior (evidence 13 R0 + R1 plan)
   - per-session instance-binding seam only

   Does NOT own:
   - profiles.json / Profile CRUD
   - defaultProfileId (global default)
   - activeProfileId profile semantics
   - picker UI, "Set as default" UI, Settings "Manage Profiles"

   USEFUL DESIGN BIAS (NOT frozen; the RED decides):
     LIKELY_STORAGE            = additive instance registry
     LIKELY_CREDENTIAL_SCOPE   = PROVIDER_INSTANCE_ID
     LIKELY_SWITCH_POLICY      = FORCE_REBUILD_ON_INSTANCE_CHANGE

   EXECUTION ORDER (reviewer-prescribed):
     1. recon exact current connection authority
     2. R0 current-seam characterization (per evidence 13 R0)
     3. choose α / β / γ only from measured blast radius
     4. bind credential identity namespace
     5. RED instance A -> B effective-config transition (R1)
     6. minimal repair
     7. conservation for existing providerId-only users
     8. session-binding seam characterization
     9. stop

   OPEN_FOUNDATION_QUESTIONS (from evidence 12 v3):
     - PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND     (R0 + R1)
     - SAME_PROVIDER_MULTI_CREDENTIAL_IDENTITY_NOT_BOUND  (R1 byproduct)
     - SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM_NOT_BOUND  (R1 byproduct)
```

Only after the foundation ACT closes with all invariants green AND
the R0/R1 obligations freeze their results may the implementation
ACT
(`ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01`) be
authorized.
