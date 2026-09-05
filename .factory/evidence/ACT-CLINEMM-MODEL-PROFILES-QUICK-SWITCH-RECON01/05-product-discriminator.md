# 05 — Product Discriminator Artifact (terminal §21 freeze)

This is the §21 mandatory freeze. Every value below is the project's
posture toward the Model Profile feature at recon close. It is the
single artifact the implementation ACT must inherit verbatim and the
board row must reference.

PRODUCTION HEAD = 97f49582e

```text
PROFILE_STORAGE_MODEL =
  R   (a profile is a NAMED REFERENCE to an existing
       providerId + modelId pair, plus optional per-mode
       override fields. NO duplicated credentials, NO
       duplicated baseUrl/apiLine/headers — those always
       live in providers.json keyed by providerId.)

CURRENT_STORE_SUPPORTS_MULTIPLE_INSTANCES_OF_SAME_PROVIDER =
  NO   (StoredProviderSettings.providers: Record<providerId, Entry>;
        only one credential set per providerId. Profiles for the same
        provider differ ONLY in modelId and/or override fields, never
        in apiKey/auth.)

MODEL_PROFILE_REQUIRES_PROVIDER_INSTANCE_IDENTITY =
  NO   (for the V1 design: profile = reference + overrides. An instance
        identity is a FUTURE capability, NOT a V1 prerequisite. If the
        implementation discovers user demand for multiple credential
        sets per provider, that becomes a follow-up ACT — it does not
        block V1.)

SESSION_PROFILE_APPLICATION =
  CURRENT_SESSION_NEXT_REQUEST  (clicking a profile while a session is
                                  active commits (providerId, modelId)
                                  via commitSelection for the active
                                  mode. The runtime picks up the new
                                  selection at the NEXT agentic run.
                                  If the new providerId differs from the
                                  active session's, the session manager
                                  is rebuilt by the existing
                                  SdkProviderChangeCoordinator path,
                                  still converging on NEXT_REQUEST.)

CURRENT_SESSION_SWITCH_SEAM_EXISTS =
  YES  (proven in 03-existing-switch-seams.md; both in-place and
         restart paths exist and are wired)

SWITCH_EFFECTIVE_BOUNDARY =
  NEXT_MODEL_REQUEST  (matches orchestrator "subsequent runs" guarantee;
                        in the restart path the new session's first
                        request is still the "next request" from the
                        user's perspective)

SWITCH_DURING_INFLIGHT_MODEL_REQUEST =
  QUEUE_FOR_NEXT_REQUEST  (the orchestrator's updateConnection applies
                            to the next run; an in-flight stream
                            completes against the old config. This is
                            the property we already have and want to
                            preserve — no new guard needed.)

SESSION_PROFILE_BINDING_PERSISTED =
  YES  (lastUsedProfileId is written to state at apply time;
         read by buildSessionConfig to pick the profile to restore
         when the next session starts. SESSION_LAST_PROFILE shape.)

RESUME_USES =
  SESSION_LAST_PROFILE  (lastUsedProfileId is read on the next
                          buildSessionConfig; if the profile still
                          exists, its (providerId, modelId) is
                          committed for both plan+act before the
                          first request. If the profile was deleted,
                          fall back to GLOBAL_DEFAULT.)
  GLOBAL_DEFAULT  (fallback only — see above)

PROFILE_CONTAINS_RAW_SECRET =
  NO   (apiKey / OAuth tokens are NEVER stored on the profile object;
        profiles REFERENCE providerId, credentials stay in providers.json)

MIGRATION_MODEL =
  HYBRID  (no existing users have "profiles" — there is nothing to
            migrate. New users see profiles from day one. Existing
            behavior (the single active providerId+modelId pair per
            mode) is preserved exactly: if no profile has ever been
            applied, the runtime reads state as today. Zero-delta
            migration is automatic.)

QUICK_SWITCH_TRIGGER =
  CURRENT_MODEL_LABEL  (clicking the footer label opens a compact
                         picker listing saved profiles + "Manage
                         Profiles…" for the Settings page. Matches
                         the upstream UX signal that motivated this
                         ACT.)

IMPLEMENTATION_SHAPE =
  SINGLE_ACT  (one bounded backend+state ACT is sufficient. The UI
               work lives in webview-ui and is scoped inside the
               same ACT. No follow-up UI-only ACT is required —
               there is no evidence of a topology that would force
               a split.)
```

## Why SINGLE_ACT (not SPLIT)

The recon shows:

-   All persistence writes already exist (commitSelection,
    setGlobalStateBatch).
-   All runtime seams already exist (in-place updateConnection OR
    restart via SdkProviderChangeCoordinator).
-   The ONLY new work is:
    1.  A `profiles.json`-style storage location (mirror the
        `StoredProviderModes.voiceInput` block, or a sibling file).
    2.  An `applyProfile(profileId)` RPC that translates a profile
        into N `commitSelection` calls + a `setGlobalStateBatch`.
    3.  A `lastUsedProfileId` state key.
    4.  A webview footer picker component.
    5.  A Settings "Manage Profiles" panel.

None of these is large enough to warrant a separate ACT, and the
state and the UI cannot be cleanly separated (the picker reads from
the same `profiles.json`).

## Why no HALT

The §26 halt conditions are evaluated:

-   HALT_PROFILE_REQUIRES_SECRET_DUPLICATION: NOT triggered
    (PROFILE_CONTAINS_RAW_SECRET=NO is achievable; profiles reference
    providerId, credentials stay in providers.json).
-   HALT_CURRENT_SESSION_SWITCH_UNSUPPORTED: NOT triggered
    (CURRENT_SESSION_SWITCH_SEAM_EXISTS=YES, both paths proven).
-   CAPTURE_INSUFFICIENT: NOT triggered (full chain traced; only
    NOT_EXECUTED for live click trace, which the recon ACT contract
    does not require).

No halt. Implementation ACT authorized.

EVIDENCE CLASS = TERMINAL FREEZE derived from 01–04 + reviewer
                 Q1–Q4 priorities. NOT_EXECUTED for live click.
