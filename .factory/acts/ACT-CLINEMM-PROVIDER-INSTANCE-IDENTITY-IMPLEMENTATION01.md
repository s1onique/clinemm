# ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 — Persistence phase (entry)

> **Entry identity (auto-recorded by §0 preflight):**
>
> ```text
> ACT_ID            = ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01
> ENTRY_HEAD        = 191dd639bd61f7c291233ffdea75cdfb4cd3e441
> PREDECESSORS      = ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
>                     (closes its recon phase at commit 191dd639b)
> PREDECESSOR_STATE = FOUNDATION_RECON_PHASE        = CLOSED (§12 frozen + bound)
>                     FOUNDATION_IMPLEMENTATION_PHASE = OPEN (this ACT, RED-first)
>                     HALT_R2_REAL_PROJECTION_NOT_PROVEN = CLOSED
>                     OPENAI_ONLY_PROBE               = CHARACTERIZED, NON-BLOCKING
> BRANCH            = main
> PROD_EDITS        = AUTHORIZED  (implementation phase; RED-first per §13-§17)
> TESTS             = R3 / R4 / R5 / R-replace / Conservation (each RED→GREEN)
> ```
>
> PRIMARY_EPISTEMIC_PURPOSE =
>   Can a durable ProviderConfigurationInstance definition plus an opaque
>   instance credential reference reconstruct the exact selected connection B
>   without inheriting unrelated state from A? And does Strategy B (full session
>   reconstruction on instanceId change) survive a real SdkSessionLifecycle
>   .replaceActiveSession call end-to-end?
>
> SCOPE_FIREWALL =
>   Does NOT own ModelProfile, profiles.json, activeProfileId, defaultProfileId,
>   profile CRUD, footer picker, Settings UI, migration of profile state, favorites,
>   context-window bug, WAITING_WITHOUT_WAKE_SOURCE. These are explicitly assigned
>   to ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 (still NOT
>   AUTHORIZED at this ACT).


## §0. Reviewer verdict being executed (CLOSED)

```text
eleventh reviewer (PASS_WITH_NONBLOCKING_RESIDUE) on commit 191dd639b:

  TEMP ApiConfiguration carrier         = CHARACTERIZED AS TEMPORARY
  CLEARING SEMANTICS                    = KNOWN INSUFFICIENT
  GENERIC PROVIDER PROJECTION           = KNOWN INSUFFICIENT

  => stop improving the temporary projector
  => proceed directly to the frozen ProviderConfigurationInstance
     definition store + instance-secret persistence
  => no new architecture review before this ACT
```

The eleventh reviewer directive maps cleanly onto §12 of the recon ACT body
(committed at `191dd639b`) and onto evidence 06/06a. The recon phase froze:

```text
STORAGE_GEOMETRY                = gamma (dedicated instances.json) +
                                  beta-shaped read path
CREDENTIAL_STORAGE_PRIMITIVE    = C (instance: prefix in secrets.json;
                                  getInstanceSecret/setInstanceSecret)
SEMANTIC_CREDENTIAL_IDENTITY    = opaque credentialRef.name
PHYSICAL_SECRET_REF_ENCODING    = { kind: "secret", name: "<key>" }
RUNTIME_STRATEGY                = B (full session reconstruction on
                                  instanceId change; updateSessionModel
                                  fast path preserved for same instance)
GLOBAL_ACTIVE_INSTANCE_ID       = FORBIDDEN
R1_FIXTURE_PRIMARY              = providerId/modelId identical
                                  instances A/B; diverging
                                  baseUrl/credential/headers
R1_FIXTURE_CONSERVATION         = same instance, model A1 -> A2 =>
                                  updateSessionModel fast path preserved
R1_IN_FLIGHT_SAFETY             = rebuild deferred while isRunning
```


## §1. Implementation-phase plan (this ACT body)

The recon phase already froze WHAT. This ACT body freezes the sequence,
the RED-first discipline, and the bounded GREEN scope per requirement.

### §1.1 Required deliverables

This ACT commits four RED->GREEN pairs and a final conservation witness.
Each commit is bounded; no commit may add new architecture.

```text
R3  instance definition store (RED->GREEN)
    files: apps/vscode/src/sdk/instance-store/instances-store.ts (NEW)
           apps/vscode/src/sdk/instance-store/contracts.ts (NEW)
           apps/vscode/src/sdk/instance-store/instances-store.test.ts (NEW)
    RED: create A, create B, read A==A, read B==B,
         restart store (close+reopen), read A==A, read B==B
    RED: corrupt the file => read fails closed (no silent default pick)
    GREEN: minimal ClineFileStorage-backed store; atomic-rename writes
    RESIDUE: NONE expected

R4  instance-secret namespace (RED->GREEN)
    files: apps/vscode/src/shared/storage/instance-secret.ts (NEW)
           apps/vscode/src/shared/storage/instance-secret.test.ts (NEW)
           apps/vscode/src/core/storage/StateManager.ts (added
             getInstanceSecret/setInstanceSecret typed accessors;
             InstanceSecretNameSchema via zod regex)
    RED: set secret under "instance:corp-llm" name;
         read back via getInstanceSecret; different name => undefined
    RED: rename label on instances.json does NOT change secret key
    RED: APPLY path calls getInstanceSecret only;
         DEFINE/UPDATE path calls setInstanceSecret only;
         a caller cannot write secrets via APPLY
    GREEN: zod schema InstanceSecretNameSchema; lands in secrets.json
           under "instance:" prefix (0o600 mode preserved)
    RESIDUE: typed accessor pair (getInstanceSecret/setInstanceSecret)

R5  typed projector replacing the OPENAI_ONLY_PROBE (RED->GREEN)
    files: apps/vscode/src/sdk/sdk-session-config-builder.ts
             (applyProviderConfigurationInstanceToConfig =>
              typed ProviderConfigurationInstance-aware variant)
           apps/vscode/src/sdk/instance-store/contracts.ts (the
             ProviderConfigurationInstance type itself)
           apps/vscode/src/sdk/__tests__/provider-instance-identity-r5
             -typed-projector.piif01.test.ts (NEW)
    RED: baseline A with deliberately toxic values on every relevant
         field; project B via ProviderConfigurationInstance; assert
         complete provider-relevant tuple == B
    RED: A.headers = {...}; B.headers = null (explicit clearing form);
         result.headers = cleared (NOT A.headers)
    RED: B with anthropic + claudecode provider fields =>
         result reflects B's typed projection; OPENAI_ONLY_PROBE
         limitation lifted for the typed path
    GREEN: switch on Instance.credentialRef.kind; explicit clear = null;
           per-provider projection tables (one branch per known shape)
    RESIDUE: per-provider projection tables maintained alongside
             ProviderSettingsManager; NEW kinds require schema_version bump

R-replace  real SdkSessionLifecycle.replaceActiveSession qualification
    files: apps/vscode/src/sdk/__tests__/provider-instance-identity
             -r-replace-real-lifecycle.piif01.test.ts (NEW)
    RED: an active session with provider A (full projection);
         call replaceActiveSession(B); assert the new session's
         effective config == B (not A's residual)
    GREEN: SdkSessionLifecycle.replaceActiveSession now wired through
           the typed projector (R5) instead of the OPENAI_ONLY_PROBE
    RESIDUE: this is the witness that closes
             SYNTHETIC_REAL on the lifecycle replacement (was honest
             residue in recon R2)

Conservation  same instance + model A1 -> A2 => fast path
    files: apps/vscode/src/sdk/__tests__/provider-instance-identity
             -conservation-model-fast-path.piif01.test.ts (NEW)
    RED: same instance; model changes A1 -> A2;
         updateSessionModel fast path is taken (no replaceActiveSession)
    GREEN: explicit fast-path branch in lifecycle; invariant asserted
    RESIDUE: pinned as a permanent invariant to prevent future
             refactors from accidentally upgrading the model-only
             update into a full rebuild
```


### §1.2 Sequence discipline

Each RED->GREEN pair:

1. Commit RED test (failing) -- the test must fail in a specific,
   pre-registered way (not just "test is missing").
2. Implement the bounded GREEN: minimum change to pass the RED
   without expanding scope.
3. Conservation: re-run the full PIIF bridge suite; assert no
   regression on previously-green tests.

After all five pairs land and the bridge suite is green, this ACT body
produces evidence file `08-r3-r4-r5-persistence-witness.md`.

## §2. Out of scope (explicit)

```text
- profile CRUD
- quick-switch popup
- activeProfileId persistence
- defaultProfileId
- "Set as default"
- migration UX
- cloud sync
- favorites/profile integration
```

Foundation's job is only:

```text
- definition identity (R3)
- credential identity (R4)
- typed projection (R5)
- Strategy-B application (R-replace)
- lifecycle qualification (R-replace)
- conservation invariant (Conservation)
```

## §3. Disposition

| Item                                  | Value                                              |
|---------------------------------------|----------------------------------------------------|
| FOUNDATION_RECON_PHASE                | CLOSED (predecessor ACT 191dd639b)                 |
| FOUNDATION_IMPLEMENTATION_PHASE       | OPEN (this ACT)                                    |
| PERSISTENCE_PHASE                     | AUTHORIZED (this ACT, RED-first per §1.1)          |
| MODEL_PROFILES_IMPLEMENTATION         | NOT_AUTHORIZED                                     |
| Halt conditions                       | HALT_RED_NOT_REPRODUCED (legacy); if any R3-R5     |
|                                       | test does NOT fail on the locked seed, reopen      |
|                                       | the frozen §12 invariant under that requirement.   |
| Pre-execution review required?        | NO (eleventh reviewer explicit)                    |
| ACT_HEAD_AT_AUTHOR                    | `191dd639b` (this ACT body does NOT advance it)    |
| Files added                           | `.factory/acts/ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01.md` (this file) |
| Files amended                         | (none in this entry commit)                        |

## §4. Closing rationale

The recon phase established that the temporary projector has taught us
everything useful it can. The eleventh reviewer explicitly authorized
the persistence phase without a new architecture cycle. This ACT body
opens the implementation phase with a tight RED-first sequence; each
deliverable is bounded, the success criteria are pre-registered, and
no commit may expand scope beyond the registered RED.

If a future P0 arises (e.g. R3-R5 fail to reproduce the §6b primary
fixture), it is reopened here, NOT by adding a new architecture cycle.

NO TEST EDITS, NO PRODUCTION EDITS, NO CONFIG EDITS in this entry
commit. Entry is a recon-style opening that freezes the implementation
sequence and the bounded scope, so that subsequent commits can be
executed without re-justification.

HANDOFF: stop here. Do NOT execute any R3/R4/R5 in this commit.
