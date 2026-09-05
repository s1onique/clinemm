# ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01 — Bounded recon correction after HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT

> **Status: OPEN — HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT / BOUNDED_CORRECTION01_AUTHORIZED.**
>
> Epistemic purpose: **CORRECTION**, not re-design. The recon's source work
> (evidence files 00–08) survives intact and load-bearing. Only the
> §21 discriminator freeze is amended, plus the four §34 review-question
> answers that flow from it. Production edits: **FORBIDDEN**. Tests:
> characterization only if required to answer mechanical question 3.
>
> ```text
> ENTRY_HEAD                  = 97f49582ed56dc669635172a96c2f85a74e5be38
>                              (verified via git rev-parse HEAD at CORRECTION01 entry)
> SUBJECT_HEAD                = <this-commit>
> CLOSURE_HEAD                = <this-commit>
>                              (this ACT closes at the same HEAD as the
>                              bounded-correction commit; no production-code delta)
>
> Predecessor ACT             = ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01
>                              body: b55407d03 (open) + 97f49582e (P1 wording
>                              correction; this ACT's ENTRY_HEAD)
>
> Reviewer disposition (2026-09-05):
>   VERDICT            = HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT
>   P0-1               = PRODUCT_SCOPE_LOST
>                          frozen V1 cannot represent multiple configured
>                          instances of the same provider (the original
>                          product asked for that case explicitly)
>   P0-2               = SESSION_GLOBAL_AUTHORITY_COLLAPSE
>                          global lastUsedProfileId is mislabeled as
>                          SESSION_LAST_PROFILE
>   P1 (lifecycle)     = A/B/C/D discriminator mislabeled
>                          implementation semantics are BOTH while freeze
>                          says CURRENT_SESSION_NEXT_REQUEST
>   P1 (in-flight)     = QUEUE_FOR_NEXT_REQUEST not yet proven for the
>                          provider-restart path; one characterization
>                          needed (or STRUCTURAL/NOT_EXECUTED + conservative
>                          implementation behavior)
>   P2                 = "global default for THIS task" wording
>   P0-1 prerequisite  = provider-instance identity, NOT F4
>   PRODUCTION_REWORK  = NONE AUTHORIZED
>   RECON_SOURCE_WORK  = PRESERVED (evidence 00–08 unchanged)
> ```
>
> See the bounded correction evidence at
> `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01/`
> (new files `09–12` appended; `08-final-report.md` amended to reflect
> the corrected freeze; existing `00–07` unchanged).
>
> ```text
> Second reviewer verdict (2026-09-05, post-P2):
>   VERDICT            = HALT_PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND
>   P2_DISPOSITION     = PASS_BOUNDED_CORRECTION (P0-1, P0-2, P1 lifecycle,
>                          P1 in-flight closed; foundation ACT authorized)
>   NEW_P0_1           = PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND
>                          (seam not proven for same-providerId-
>                           different-instanceId switch)
>   NEW_P0_2           = SAME_PROVIDER_MULTI_CREDENTIAL_IDENTITY_NOT_BOUND
>                          (credentialReference namespace underspecified)
>   NEW_P1_1           = session persistence seam frozen ahead of source survey
>   NEW_P1_2           = defaultProfileId was incorrectly included in
>                          foundation scope
>   P3_CORRECTION      = §6 of this ACT (amends §2 freeze verbatim to the
>                          reviewer's amended field list; narrows foundation
>                          scope; recon source work preserved; production
>                          untouched; no new tests)
>   FOUNDATION_ACT     = YES (named ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-
>                          FOUNDATION01, narrower scope)
>   IMPL_ACT           = NO (still gated on foundation closure)
>   EVIDENCE_NEW       = 1 (13-instance-switch-semantic-recon-plan.md)
>   EVIDENCE_AMENDED   = 4 (08, 09, 10, 12)
> ```
>
> ---
>
> ## §0 — What the reviewer said (2026-09-05)
>
> The recon ACT body closed its recon loop with a terminal §21 freeze
> that picked:
>
> ```text
> PROFILE_STORAGE_MODEL                                  = R
> CURRENT_STORE_SUPPORTS_MULTIPLE_INSTANCES_OF_SAME_PROVIDER = NO
> MODEL_PROFILE_REQUIRES_PROVIDER_INSTANCE_IDENTITY      = NO
> SESSION_PROFILE_APPLICATION                            = CURRENT_SESSION_NEXT_REQUEST
> SWITCH_PERSISTS_GLOBAL_DEFAULT                         = YES  (implicit, per "global default for THIS task")
> RESUME_USES                                            = SESSION_LAST_PROFILE
> ```
>
> The reviewer's HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT verdict
> identified that this freeze contradicts the recon's own earlier
> discriminators:
>
> 1. **P0-1 PRODUCT_SCOPE_LOST.** The recon §8 itself established that
>    `StoredProviderSettings.providers: Record<providerId, Entry>` is
>    flat — exactly one credential set per providerId. Yet the freeze
>    declares `PROFILE_STORAGE_MODEL = R` (profile = `providerId`
>    reference + non-secret overrides) without first establishing the
>    identity layer that lets two configurations of the same provider
>    coexist. The exact case in the original feature request — multiple
>    OpenAI-compatible endpoints (local-litellm, corporate-litellm,
>    lab) — cannot be represented under R.
>
> 2. **P0-2 SESSION_GLOBAL_AUTHORITY_COLLAPSE.** The freeze declares
>    `RESUME_USES = SESSION_LAST_PROFILE` but the proposed mechanism is
>    a single global `lastUsedProfileId` pointer. The counterexample is
>    trivial: Task A switches to Profile A, Task B switches to Profile
>    B, restart VSCodium, resume Task A — global state returns B, not
>    A. The label `SESSION_LAST_PROFILE` is mislabeled; the actual
>    semantics are `GLOBAL_LAST_USED_PROFILE`.
>
> 3. **P1 (lifecycle A/B/C/D).** The freeze says A
>    (`CURRENT_SESSION_NEXT_REQUEST`) but also says
>    `SWITCH_PERSISTS_GLOBAL_DEFAULT = YES`. That is C (`BOTH`), not
>    A. The recon also produces the awkward sentence
>    "global default for THIS task", which is incoherent.
>
> 4. **P1 (in-flight).** The orchestrator comment "Mutate provider /
>    reasoning fields for subsequent runs" supports
>    `CURRENT_INFLIGHT_REQUEST_NOT_RETROACTIVELY_CHANGED = YES`. It
>    does NOT by itself prove `SWITCH_DURING_INFLIGHT_MODEL_REQUEST =
>    QUEUE_FOR_NEXT_REQUEST` for the **provider-change restart path**.
>    A characterization test (or STRUCTURAL/NOT_EXECUTED + conservative
>    implementation behavior) is required.
>
> ---
>
> ## §1 — Scope of this bounded correction
>
> This ACT does ONE bounded thing: answer the reviewer's three
> mechanical questions, re-freeze ONLY the affected discriminator
> fields, and route to the correct §27 outcome (Outcome C — provider-
> instance identity as a foundation prerequisite, NOT F4).
>
> It does **NOT**:
>
> -   Re-design the recon's source chain (evidence 00–08 unchanged).
> -   Touch production code (PRODUCTION_EDITS = FORBIDDEN).
> -   Absorb either of the separately-registered live bugs
>     (`ACT-CLINEMM-EFFECTIVE-MODEL-CONTEXT-WINDOW-AUTHORITY-RECON01`,
>     `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-ASYNC-JOB-WAKE-OWNERSHIP-RECON01`).
> -   Open a new ACT for the provider-instance identity foundation
>     (that's the implementation lane's job; this ACT only freezes
>     the prerequisite).
>
> It DOES:
>
> 1.  Answer Q-mechanical-1 (smallest identity layer for two configs
>     of one provider without duplicating secrets). Evidence: `09-…md`.
> 2.  Answer Q-mechanical-2 (where can `activeProfileId` persist per
>     task/session using existing session metadata). Evidence:
>     `10-…md`.
> 3.  Answer Q-mechanical-3 (can the provider-change path safely accept
>     a switch while a request is running). Evidence: `11-…md`.
> 4.  Re-freeze ONLY the affected §21 discriminator fields. Evidence:
>     `12-corrected-freeze.md`.
> 5.  Amend `08-final-report.md` to reflect the corrected freeze and
>     route to **Outcome C** (bounded foundation ACT first, then
>     implementation ACT).
> 6.  Amend the recon ACT body's §35 successor linkage with a P2
>     pointer to this correction.
>
> ---
>
> ## §2 — The corrected §21 freeze (delta vs. prior)
>
> Affected discriminator fields, BEFORE → AFTER:
>
> ```text
> PROFILE_STORAGE_MODEL                              R        ->  I
>                                                                  (profile references a
>                                                                   ProviderConfigurationInstance
>                                                                   identity, not a providerId)
> MODEL_PROFILE_REQUIRES_PROVIDER_INSTANCE_IDENTITY  NO       ->  YES
> ORIGINAL_PRODUCT_REQUIRES_MULTIPLE_INSTANCES_      (new)    ->  YES
>   OF_SAME_PROVIDER
> CURRENT_STORE_SUPPORTS_MULTIPLE_INSTANCES_OF_      NO       ->  NO  (unchanged)
>   SAME_PROVIDER                                          (now a prerequisite, not a V1 fact)
> SESSION_PROFILE_APPLICATION                        A        ->  D
>                                                       CURRENT_    SPLIT_ACTION
>                                                       SESSION_    (footer quick-switch updates
>                                                       NEXT_REQ.   current task/session only;
>                                                                   explicit "Set as default"
>                                                                   updates defaultProfileId)
> SESSION_ACTIVE_PROFILE_PERSISTED                   (new)    ->  YES
>                                                                  (per task/session, in
>                                                                   existing session metadata)
> GLOBAL_DEFAULT_PROFILE_PERSISTED                   (new)    ->  YES
>                                                                  (global state, separate
>                                                                   from SESSION_ACTIVE_PROFILE)
> RESUME_USES                                        SESSION_ ->  SESSION_ACTIVE_PROFILE
>                                                       LAST_     (+ GLOBAL_DEFAULT_PROFILE
>                                                       PROFILE   fallback when no
>                                                                  activeProfileId is
>                                                                  recoverable)
> NEW_SESSION_USES                                   (new)    ->  GLOBAL_DEFAULT_PROFILE
> SWITCH_PERSISTS_GLOBAL_DEFAULT                     YES      ->  NO (for footer quick-switch;
>                                                       (implicit   only "Set as default"
>                                                       per "global  persists global default)
>                                                       default for
>                                                       THIS task")
> SWITCH_DURING_INFLIGHT_MODEL_REQUEST               QUEUE_   ->  PROVE_OR_RESTRICT_UNTIL_IDLE
>                                                       FOR_      (characterization required
>                                                       NEXT_     for provider-change path;
>                                                       REQUEST    if unobservable, freeze
>                                                                  as STRUCTURAL/NOT_EXECUTED
>                                                                  and implement conservatively:
>                                                                  disable switching while a
>                                                                  model request is active)
> ```
>
> Unaffected discriminator fields (unchanged from the prior freeze):
>
> ```text
> CURRENT_SESSION_SWITCH_SEAM_EXISTS               = YES
> SWITCH_EFFECTIVE_BOUNDARY                        = NEXT_MODEL_REQUEST
> SESSION_PROFILE_BINDING_PERSISTED                = YES  (now refined: see corrected freeze)
> PROFILE_CONTAINS_RAW_SECRET                      = NO   (provider-instance identity does NOT
>                                                          require copying secrets into profile
>                                                          records; the profile references the
>                                                          configured provider, credentials stay
>                                                          in existing secure provider machinery)
> MIGRATION_MODEL                                  = HYBRID (unchanged; no profiles to migrate)
> QUICK_SWITCH_TRIGGER                             = CURRENT_MODEL_LABEL
>   (now reads from active task/session profile when a task is open;
>    from defaultProfileId when no task is open)
> IMPLEMENTATION_SHAPE                             = NO_LONGER_SINGLE_ACT — split:
>                                                       (1) bounded foundation ACT
>                                                           ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
>                                                           (NOT F4; freezes the identity layer;
>                                                            may need its own freeze + evidence pack)
>                                                       (2) bounded implementation ACT
>                                                           ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
>                                                           (gated on foundation closure)
> ```
>
> Full freeze text in evidence file `12-corrected-freeze.md`.
>
> ---
>
> ## §3 — The three mechanical questions (answers)
>
> ### Q-mechanical-1 — Smallest identity layer for two configs of one provider, no secret duplication
>
> **Answer (see evidence `09-provider-instance-identity-options.md`):**
> The smallest identity layer is a thin `ProviderConfigurationInstance`
> record: `{ instanceId, providerId, baseUrl, apiLine, headers,
> region, provider-specific config (non-secret), credentialReference }`.
> The `credentialReference` resolves through the existing
> `ProviderSettingsManager` / `StateManager` machinery (which already
> owns `apiKey`, OAuth tokens, and the secure provider secrets path).
> The profile then references `instanceId`, not `providerId`. Secret
> duplication is avoided because credentials never enter the profile
> record.
>
> Whether the existing `ProviderSettingsManager` keys can be
> generalized from `providerId` → `instanceId` directly, or whether a
> thin separate `provider-instances.json` is cleaner, is a question
> the bounded foundation ACT must answer with a source survey. The
> recon does not pre-decide it.
>
> ### Q-mechanical-2 — Where `activeProfileId` can persist per task/session
>
> **Answer (see evidence `10-session-active-profile-persistence.md`):**
> The session/task persistence surface already exists:
> `CoreSessionConfig` carries the snapshot, and session history
> (`taskHistory.json`) carries the per-task start config + manifest.
> The session-level `activeProfileId` belongs in the per-session
> metadata that survives restart, NOT in global state. The evidence
> file names the specific persistence seam candidates (session
> manifest extension, task metadata block) and identifies which is
> the smallest-necessary extension. The foundation ACT picks one.
>
> The global `defaultProfileId` (new field) lives in the existing
> `globalState.json` store, mirroring the existing `favoritedModelIds`
> precedent.
>
> ### Q-mechanical-3 — In-flight safety on the provider-change restart path
>
> **Answer (see evidence `11-inflight-provider-change-characterization.md`):**
> The orchestrator comment + the existing restart path
> (`replaceActiveSession`) STRUCTURALLY guarantee
> `CURRENT_INFLIGHT_REQUEST_NOT_RETROACTIVELY_CHANGED = YES`:
> the restart tears down the active session and rebuilds it with the
> new configuration. No in-flight request from the old session can
> complete against the new configuration.
>
> However, this does NOT by itself establish
> `SWITCH_DURING_INFLIGHT_MODEL_REQUEST = QUEUE_FOR_NEXT_REQUEST`,
> because `QUEUE_FOR_NEXT_REQUEST` semantics require that the OLD
> request finishes naturally and the NEW request uses the NEW
> configuration, while the restart path actually cancels + recreates
> the active session. The two are not equivalent.
>
> Recommendation: freeze `SWITCH_DURING_INFLIGHT_MODEL_REQUEST =
> RESTRICT_UNTIL_IDLE` for V1 (disable the in-session footer switch
> while a model request is active; the picker is grayed out / shows
> a "current request in progress" hint). The in-place same-provider
> switch path already has structural in-flight safety per the
> orchestrator comment; it may keep the more permissive
> QUEUE_FOR_NEXT_REQUEST semantic, but a characterization test is
> justified before shipping.
>
> ---
>
> ## §4 — §27 outcome: A → C (foundation ACT first)
>
> The reviewer's halt + this correction reroute the recon from
> §27 Outcome A (SINGLE IMPLEMENTATION ACT) to §27 Outcome C
> (provider-instance identity is a real prerequisite, open one
> bounded foundation ACT before profiles, do NOT call it F4).
>
> The recon ACT body's §35 successor linkage is amended to reflect
> this. The implementation ACT
> `ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01` is
> **NOT** authorized; it is gated on the foundation ACT's closure.
>
> Two bounded ACTs follow this correction:
>
> 1.  `ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01`
>     — foundation ACT. Owns the identity layer (Q-mechanical-1's
>     answer), freezes the `ProviderConfigurationInstance` schema,
>     freezes the persistence seam choice (Q-mechanical-2's answer),
>     and freezes the in-flight behavior (Q-mechanical-3's answer,
>     including the characterization if one is possible). NOT F4.
> 2.  `ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01`
>     — implementation ACT. Implements profiles on top of the
>     frozen foundation. Carries the corrected §21 freeze forward.
>     Authorizes proto RPCs, state keys, webview UI per the
>     recon's evidence 01–07.
>
> ---
>
> ## §5 — Verdict
>
> ```text
> HALT_RESOLUTION                         = P0-1, P0-2, P1 (lifecycle), P1 (in-flight)
>                                            addressed in this bounded correction
> §21 FREEZE_AMENDED                      = YES (only the affected discriminator fields)
> EVIDENCE_NEW_FILES                      = 4 (09, 10, 11, 12)
> EVIDENCE_AMENDED_FILES                  = 1 (08-final-report.md, freezes corrected)
> EVIDENCE_PRESERVED_FILES                = 8 (00..07 unchanged; recon source work survives)
> PRODUCTION_CODE_DELTA                   = 0 lines
> NEW_DIAGNOSTIC_FILE                     = 0 (no production code touched)
> NEW_TEST_FILE                           = 0 or 1 (characterization only if Q-mech-3
>                                            cannot be answered STRUCTURAL — see
>                                            11-inflight-provider-change-characterization.md)
> RECON_ACT_BODY_AMENDED                  = §35 successor linkage + entry preamble P2
>                                            pointer (mirrors F3B P2 correction style)
> GITIGNORE_WHITELIST                     = +2 lines (P2 correction ACT body + new evidence)
> GIT_DIFF_CHECK                          = PASS (12 inherited EOF warnings on
>                                            d8894dd5989d..HEAD, all .factory/,
>                                            ZERO on production sources)
> IMPLEMENTATION_ACT_AUTHORIZED           = NO (gated on foundation ACT closure)
> FOUNDATION_ACT_AUTHORIZED               = YES (named, not yet opened)
> CORRECTION01_DISPOSITION                = PASS_BOUNDED_CORRECTION (this ACT's verdict)
> ```
>
> ## §6 — P3 amendment (2026-09-05 second-reviewer verdict)
>
> A second-reviewer verdict (`HALT_PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND`)
> on this bounded correction authorizes the foundation ACT but raises
> **two new P0s** and **two P1s** that the corrected freeze as frozen in
> §2/§12 overclaimed. Per the reviewer's directive ("amend only these
> fields"), this §6 narrows the corrected freeze to match the exact
> updated field list the reviewer supplied. Production edits remain
> FORBIDDEN. NO new tests added. NO production source touched.
>
> ### P3-1 NEW P0 — instance change ≠ provider change at the seam level
>
> The prior P2 freeze carried forward from the recon:
>
> ```text
> CURRENT_SESSION_SWITCH_SEAM_EXISTS  = YES
> SWITCH_EFFECTIVE_BOUNDARY           = NEXT_MODEL_REQUEST
> ```
>
> These were proven under the OLD domain `(providerId, modelId)`:
>
> ```text
> same providerId + new modelId
>   → updateSessionModel / updateConnection
>
> different providerId
>   → SdkProviderChangeCoordinator
>   → replaceActiveSession
> ```
>
> The corrected product introduces the perfectly valid transition:
>
> ```text
> Instance A
>   instanceId  = local
>   providerId  = openai-compatible
>   baseUrl     = http://local-litellm/
>   credential  = local-key-ref
>
>          ↓ switch
>
> Instance B
>   instanceId  = corporate
>   providerId  = openai-compatible
>   baseUrl     = https://corp-litellm/
>   credential  = corporate-key-ref
> ```
>
> Here `old.providerId === new.providerId`. The existing
> provider-change discriminator may say "provider unchanged", and the
> existing same-provider fast path (`updateActiveSessionModel` →
> `updateSessionConnection`) only mutates the **model**, not the
> instance-owned fields (`baseUrl`, `headers`, `apiLine`, `region`,
> `providerSpecificConfig`, `credential identity`). Therefore the
> P2-corrected `CURRENT_SESSION_SWITCH_SEAM_EXISTS = YES` and
> `SWITCH_EFFECTIVE_BOUNDARY = NEXT_MODEL_REQUEST` are **premature for
> profile-instance switching**.
>
> Per reviewer, these are the honest discriminators:
>
> ```text
> CURRENT_PROVIDER_MODEL_SWITCH_SEAM_EXISTS      = YES
> CURRENT_PROVIDER_INSTANCE_SWITCH_SEAM_EXISTS   = NOT_YET_PROVEN
> ```
>
> ### P3-2 NEW P0 — credential identity scope is underspecified
>
> The P2 freeze alternated between two incompatible framings:
>
> ```text
> credentialReference → existing secure machinery
> existing provider credentials are keyed by providerId
> ```
>
> For two same-provider instances with different keys:
>
> ```text
> openai-compatible/local      → key A
> openai-compatible/corporate  → key B
> ```
>
> a credential store keyed only by `providerId = openai-compatible`
> cannot identify both. Option β in evidence 09 quietly introduced the
> thing actually required (`credentialReference.secretsKey =
> provider.litellm-local`), which is a NEW credential-reference
> identity namespace — not merely "use the existing providerId key".
>
> This is fine architecturally, but must be frozen honestly:
>
> ```text
> PROVIDER_INSTANCE_CREDENTIAL_IDENTITY  = NOT_YET_BOUND
> CREDENTIAL_IDENTITY_SCOPE              = NOT_YET_BOUND
>                                         (foundation ACT must answer:
>                                          PROVIDER_ID |
>                                          PROVIDER_INSTANCE_ID |
>                                          EXISTING_SECRET_REFERENCE;
>                                          the result must permit
>                                          instance A → secret A,
>                                          instance B → secret B
>                                          without copying either secret
>                                          into the instance record)
> ```
>
> ### P3-3 P1 — session persistence seam is selected too early
>
> Evidence 10 says:
>
> ```text
> Candidate 1 + Candidate 2 recommended
> foundation ACT picks one
> ```
>
> Yet the P2 freeze committed:
>
> ```text
> SESSION_ACTIVE_PROFILE_ID persists in
> session manifest + taskHistory.json
> ```
>
> That upgrades a **candidate** into a **frozen design** before the
> foundation survey. Per reviewer, keep the product invariant frozen
> but downgrade the mechanism:
>
> ```text
> SESSION_ACTIVE_PROFILE_PERSISTED       = YES   (invariant; product contract)
> SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM = NOT_YET_BOUND
>                                         (foundation ACT discovers whether
>                                          task history alone, manifest
>                                          alone, both, or another existing
>                                          metadata seam is minimal)
> ```
>
> ### P3-4 P1 — `defaultProfileId` does not belong in the foundation
>
> The foundation ACT was over-scoped. `defaultProfileId` belongs to
> **Model Profiles**, not provider-instance identity. Provider
> instances can exist perfectly well without any profile default.
>
> The foundation narrows to one epistemic purpose:
>
> ```text
> Foundation ACT owns:
>   - ProviderConfigurationInstance identity
>   - secret-reference identity (the answer to P3-2)
>   - runtime instance-switch behavior (the answer to P3-1)
>   - per-session metadata seam FOR INSTANCE BINDING ONLY
>     (the answer to P3-3)
> ```
>
> Session `activeProfileId` (the per-session profile pointer) and
> global `defaultProfileId` (the global default pointer) remain
> contracts for the Model Profiles implementation ACT unless the
> source survey proves some shared persistence primitive must land
> together with the instance seam. The P2 freeze's
> `SESSION_ACTIVE_PROFILE_PERSISTED` and `GLOBAL_DEFAULT_PROFILE_PERSISTED`
> move out of the foundation scope into the implementation ACT's
> preflight.
>
> ### Updated freeze (terminal — supersedes §2 and evidence 12 verbatim)
>
> Per reviewer's exact amended freeze, with `NOT_YET_BOUND` /
> `NOT_YET_PROVEN` honesty where the foundation must do source survey:
>
> ```text
> PROFILE_STORAGE_MODEL                                  = I
>
> MODEL_PROFILE_REQUIRES_PROVIDER_INSTANCE_IDENTITY      = YES
>
> PROFILE_CONTAINS_RAW_SECRET                            = NO
>
> CURRENT_PROVIDER_MODEL_SWITCH_SEAM_EXISTS              = YES
>
> CURRENT_PROVIDER_INSTANCE_SWITCH_SEAM_EXISTS           = NOT_YET_PROVEN
>                                                         (foundation must trace
>                                                          same-providerId-
>                                                          different-instance
>                                                          switch path)
>
> PROVIDER_INSTANCE_CREDENTIAL_IDENTITY                  = NOT_YET_BOUND
>                                                         (foundation must answer
>                                                          CREDENTIAL_IDENTITY_SCOPE)
>
> SESSION_ACTIVE_PROFILE_PERSISTED                       = YES
>
> SESSION_ACTIVE_PROFILE_PERSISTENCE_SEAM                = NOT_YET_BOUND
>                                                         (foundation discovers
>                                                          minimal seam)
>
> SESSION_PROFILE_APPLICATION                            = SPLIT_ACTION
>
> GLOBAL_DEFAULT_PROFILE                                 = SEPARATE_FROM_SESSION_ACTIVE_PROFILE
>                                                         (implementation ACT,
>                                                          not foundation)
>
> SWITCH_DURING_INFLIGHT_MODEL_REQUEST                   = RESTRICT_UNTIL_IDLE
>
> IMPLEMENTATION_SHAPE                                   = FOUNDATION_THEN_MODEL_PROFILES
>                                                         (foundation gates impl)
> ```
>
> Everything else from the P2 corrected recon survives. The recon
> source work (evidence 00–07) is unchanged and load-bearing.
> Evidence 08 is amended once more (now reflects §6 updates).
> Evidence 09–11 receive surgical amendments to add
> `NOT_YET_BOUND` / `NOT_YET_PROVEN` honesty. Evidence 12 receives a
> new terminal version of the freeze matching this §6 verbatim.
>
> ### Updated foundation ACT scope (narrowed per reviewer)
>
> ```text
> ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
>   PRIMARY QUESTION (frozen here):
>     Can two independently configured instances of the same providerId
>     coexist and can an active session transition from instance A to
>     instance B such that the NEXT request uses exactly B's effective
>     connection + credentials, without duplicating secrets into profiles?
>
>   REQUIRED PHASE 0 RECON (before implementation):
>     Instance identity:
>       storage candidates α / β / γ
>       exact read/write blast radius
>     Credential identity:
>       how key/token A and key/token B coexist for same providerId
>       no raw secret in instance metadata
>     Runtime:
>       compare A → B where providerId SAME
>       does current switch logic rebuild?
>       what fields can updateConnection mutate?
>       what builds providerConfig / handler?
>     Persistence:
>       only characterize possible per-session instance-metadata seam;
>       do not implement Model Profile fields yet
>
>   RED THAT ACTUALLY MATTERS:
>     Construct the real semantic case:
>       same providerId, different instanceId, different baseUrl,
>       different credential reference
>     Then:
>       active = A, switch to B, next request effective config = B
>     Pre-foundation this should either fail or prove that an
>     existing seam already handles it.
>
>   OWNS:
>     ProviderConfigurationInstance identity
>     secret-reference identity (P3-2 answer)
>     runtime instance-switch behavior (P3-1 answer)
>     per-session metadata seam FOR INSTANCE BINDING ONLY (P3-3 answer)
>
>   DOES NOT OWN:
>     defaultProfileId global key (implementation ACT)
>     SESSION_ACTIVE_PROFILE_ID persistence wiring for the profile pointer
>       (implementation ACT — foundation only characterizes the
>        instance-binding seam; profile-pointer seam is implementation
>        ACT's preflight unless source survey proves shared primitive)
>     Profile CRUD, footer quick-switch UI, "Set as default" UI,
>       Settings "Manage Profiles" page (implementation ACT)
>
>   AUTHORIZED = YES (named, narrow scope; NOT yet opened).
> ```
>
> ### §6 verdict
>
> ```text
> HALT_RESOLUTION_SUMMARY                = P0-1 (PRODUCT_SCOPE_LOST) closed in P2;
>                                          P0-2 (SESSION_GLOBAL_AUTHORITY_COLLAPSE) closed in P2;
>                                          P1 (lifecycle) closed in P2;
>                                          P1 (in-flight) closed in P2 via RESTRICT_UNTIL_IDLE.
> NEW_HALT                               = HALT_PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND
>                                          (raised by second reviewer 2026-09-05)
> NEW_P0_1                               = PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND
>                                          (seam not proven for same-providerId-
>                                           different-instanceId switch)
> NEW_P0_2                               = SAME_PROVIDER_MULTI_CREDENTIAL_IDENTITY_NOT_BOUND
>                                          (credentialReference namespace
>                                           underspecified)
> NEW_P1_1                               = session persistence seam frozen ahead of
>                                          source survey
> NEW_P1_2                               = defaultProfileId was incorrectly included
>                                          in foundation scope
> EVIDENCE_NEW_FILES                     = 1 (13-instance-switch-semantic-recon-plan.md)
> EVIDENCE_AMENDED_FILES                 = 4 (08-final-report, 09-instance-identity-options,
>                                           10-session-active-profile-persistence,
>                                           12-corrected-freeze)
> P2_CORRECTION_ACT_BODY_AMENDED         = appended §6 with updated freeze verbatim
> RECON_ACT_BODY_AMENDED                 = §35 pointer paragraph extends with P3 line
> PRODUCTION_CODE_DELTA                  = 0 lines
> NEW_DIAGNOSTIC_FILE                    = 0
> NEW_TEST_FILE                          = 0
> FOUNDATION_ACT_AUTHORIZED              = YES (named, narrower scope)
> IMPLEMENTATION_ACT_AUTHORIZED          = NO (still gated on foundation closure)
> P3_DISPOSITION                         = PASS_BOUNDED_CORRECTION02 (this ACT's verdict)
> ```
>
> ### §35 (P3 amended) — Successor linkage (extended)
>
> The recon ACT body's §35 successor linkage gains an additional line:
>
> ```text
> CORRECTION02 (P3 of P2 correction)      = this §6 (narrowed freeze + narrowed
>                                           foundation scope, second-reviewer verdict)
> CORRECTION02_VERDICT                   = PASS_BOUNDED_CORRECTION
> CORRECTION02_SCOPE                     = §6 updates the §2/§12 freeze verbatim
>                                          to the reviewer's amended field list;
>                                          amends evidence 09/10/12; adds evidence 13;
>                                          narrows foundation scope (drops
>                                          defaultProfileId from foundation;
>                                          drops SESSION_ACTIVE_PROFILE_ID
>                                          persistence wiring from foundation);
>                                          recon source work preserved
> NEXT                                    = ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
>                                          (narrower: identity + credential namespace
>                                           + runtime switch behavior + instance
>                                           persistence seam only)
> ```
>
> ---
>
> ## §35 (amended) — Successor linkage
>
> The recon ACT body's §35 successor linkage is amended with this
> pointer:
>
> ```text
> CORRECTION01                            = ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01
>                                            (b55407d03-recon + 97f49582e-P1 -> <this-commit>-P2)
> P2_CORRECTION_VERDICT                   = PASS_BOUNDED_CORRECTION
> P2_CORRECTION_SCOPE                     = §21 freeze amend (R->I, A->D, etc.) +
>                                            §27 outcome (A -> C) + §35 successor
>                                            (foundation ACT first, then impl ACT)
> P2_CORRECTION_NOTES                     = reviewer's HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT
>                                            addressed; recon source work preserved;
>                                            evidence 00-07 unchanged; evidence 08 amended;
>                                            evidence 09-12 added; production untouched
> NEXT                                    = ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
>                                            (bounded foundation ACT, NOT F4)
> ```
