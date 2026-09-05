# 08 — Final Report (§34 terminal review, AMENDED by P2 correction)

PRODUCTION HEAD = 97f49582e
RECON CLOSE     = PASS (initial) → AMENDED via P2 CORRECTION01

```text
AMENDMENT_NOTICE:
  Reviewer verdict 2026-09-05 = HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT
  P2 correction ACT           = ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01
  Freeze superseded by        = .factory/evidence/ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01/12-corrected-freeze.md
  Source chain preserved      = 00..07 unchanged; recon source work survives
  Implementation status       = NOT AUTHORIZED; foundation ACT prerequisite
  New successor ACTs (not yet opened):
    1. ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01  (foundation, NOT F4)
    2. ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01  (implementation, gated on #1)
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
    before; the new field is the instanceId). The downstream path:
      - same instance → in-place updateSessionModel (cheap,
        next-request-applied)
      - different instance → SdkProviderChangeCoordinator restarts
        the active session (heavier but tested)
    It updates ONLY the current task/session's activeProfileId,
    NOT the global defaultProfileId.
    SESSION_PROFILE_APPLICATION = D (SPLIT_ACTION).

 5. What exact request boundary applies the change?
    NEXT_MODEL_REQUEST. The orchestrator's updateConnection is
    documented as "Mutate provider / reasoning fields for
    subsequent runs" — the change applies to the next agentic run,
    never to a request already in flight.
    SWITCH_EFFECTIVE_BOUNDARY = NEXT_MODEL_REQUEST.
    SWITCH_DURING_INFLIGHT_MODEL_REQUEST = RESTRICT_UNTIL_IDLE
    (CORRECTION: prior freeze said QUEUE_FOR_NEXT_REQUEST, which the
     orchestrator comment does NOT prove for the provider-restart
     path; conservative behavior is to disable the picker while a
     request is active).

 6. What survives restart/resume?
    RESUME_USES = SESSION_ACTIVE_PROFILE: the per-task/session
    activeProfileId is persisted to the session manifest +
    taskHistory.json. On the next session start, buildSessionConfig
    reads it first; if present, the profile's selections are
    committed before the first request. If the profile was deleted,
    falls back to GLOBAL_DEFAULT_PROFILE; if neither is set, falls
    back to current behavior (state-key read).
    SESSION_PROFILE_BINDING_PERSISTED = YES (refined).
    NEW_SESSION_USES = GLOBAL_DEFAULT_PROFILE.

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
    OAuth storage), keyed by the instance's resolved providerId.
    The profile references the instanceId; the runtime resolves
    the instance, then routes to the existing ProviderSettingsManager
    for credentials.
    PROFILE_CONTAINS_RAW_SECRET = NO (frozen; provider-instance
    identity does NOT require copying secrets into profile records).

 9. Is migration zero-delta?
    YES, by construction. No pre-existing "profile" concept exists
    in the codebase. Existing users keep their current behavior
    exactly: SESSION_ACTIVE_PROFILE = undefined AND
    defaultProfileId = undefined → buildSessionConfig reads state
    keys directly as today. New users see profiles from day one.
    MIGRATION_MODEL = HYBRID (zero-delta for existing users, new
    shape appears next to existing behavior).

10. What exact implementation ACT follows?
    TWO bounded ACTs (gated, not concurrent):
    (1) ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01 —
        foundation ACT (NOT F4). Freezes the
        ProviderConfigurationInstance schema, the persistence seam,
        and the in-flight semantic. Foundation closes before (2)
        can be authorized.
    (2) ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 —
        implementation ACT. Implements profiles on top of the
        frozen foundation. IMPLEMENTATION_SHAPE = SPLIT (foundation
        + impl), not SINGLE_ACT.

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
12-corrected-freeze.md                          → TERMINAL CORRECTED FREEZE
                                                  (this is the source of truth going forward)
```

## Predecessor chain (load-bearing facts preserved)

```text
F3   (256943c5c)  PASS_F3_RECON_OUTCOME_B
F3B  (321ad2dd5)  PASS_F3B_NO_REPAIR_NEEDED  (T17=NOT_REPRODUCED)
F3B  (bfa2ad592)  P2 closure-evidence precision
MP   (b55407d03)  open
MP   (97f49582e)  P1 wording correction
MP   (<this-commit>)  P2 correction (HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT
                      resolved via bounded correction01; recon source work
                      preserved; freeze amended; foundation ACT required)
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
  (NOT F4; bounded; freezes ProviderConfigurationInstance +
   persistence seam + in-flight semantic)
```

Only after the foundation ACT closes with all invariants green may
the implementation ACT
(`ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01`) be
authorized.
