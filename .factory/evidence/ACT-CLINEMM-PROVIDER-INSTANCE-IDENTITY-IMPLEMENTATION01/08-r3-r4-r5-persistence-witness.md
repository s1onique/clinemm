# 08 -- R3 / R4 / R5 persistence phase witness

> ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 entry commit.
>
> Per the eleventh reviewer on commit 191dd639b:
>
> ```text
> TEMP ApiConfiguration carrier         = CHARACTERIZED AS TEMPORARY
> CLEARING SEMANTICS                    = KNOWN INSUFFICIENT
> GENERIC PROVIDER PROJECTION           = KNOWN INSUFFICIENT
>
> => stop improving the temporary projector
> => proceed directly to the frozen ProviderConfigurationInstance
>    definition store + instance-secret persistence
> => no new architecture review before this ACT
> ```
>
> This ACT body (`.factory/acts/ACT-CLINEMM-PROVIDER-INSTANCE-
> IDENTITY-IMPLEMENTATION01.md`) freezes the implementation-phase
> sequence: R3 instance definition store -> R4 instance-secret
> namespace -> R5 typed projector (replaces the OPENAI_ONLY_PROBE)
> -> R-replace real `SdkSessionLifecycle.replaceActiveSession`
> qualification -> Conservation witness.
>
> This evidence file freezes the production-side GREEN for the
> first three pairs (R3, R4, R5). The R-replace + Conservation
> pairs are deferred to the next commit because they exercise
> the production SdkSessionLifecycle, which is the next bounded
> surface and warrants its own focused commit.

## 0. Scope (this commit)

```text
R3  instance definition store
    files: apps/vscode/src/sdk/instance-store/contracts.ts (NEW)
           apps/vscode/src/sdk/instance-store/instances-store.ts (NEW)
           apps/vscode/src/sdk/instance-store/instances-store.test.ts (NEW)

R4  instance-secret namespace
    files: apps/vscode/src/shared/storage/instance-secret.ts (NEW)
           apps/vscode/src/shared/storage/__tests__/instance-secret.test.ts (NEW)
           apps/vscode/src/core/storage/StateManager.ts (added
             getInstanceSecret/setInstanceSecret typed accessors)
           apps/vscode/src/shared/storage/index.ts (export instance-secret)

R5  typed projector (replaces OPENAI_ONLY_PROBE)
    files: apps/vscode/src/sdk/instance-store/typed-projector.ts (NEW)
           apps/vscode/src/sdk/instance-store/typed-projector.test.ts (NEW)
           apps/vscode/src/sdk/cline-session-factory.ts (added
             providerConfigurationInstanceTyped field)
           apps/vscode/src/sdk/sdk-session-config-builder.ts (builder
             branches: typed path -> applyTypedProviderInstanceToConfig;
             legacy path -> applyProviderConfigurationInstanceToConfig)
           apps/vscode/vitest.config.ts (excluded new tests)
           apps/vscode/vitest.config.c2-4-c-bridge.ts (included new tests)
           apps/vscode/tsconfig.c2-4-c-bridge.json (included new tests)
```

R-replace and Conservation are explicitly deferred to the next
commit per the ACT body plan; the current commit produces no code
on those seams.

## 1. R3 GREEN: instance definition store

The recon phase froze (evidence 06 section 2b):

```text
STORAGE_GEOMETRY = gamma (dedicated instances.json under ~/.cline/data/)

instances.json
  version
  instances: Record<instanceId, ProviderConfigurationInstance>

NO:
  activeInstanceId
  profile pointer
  global default
```

The new module `apps/vscode/src/sdk/instance-store/instances-store.ts`
honors all four invariants:

1. File layout -- InstancesStore reads/writes
   <filePath>/instances.json (the construction site decides the
   absolute path; the default is <dataDir>/instances.json).
2. Atomic-rename writes -- the same write-then-rename discipline
   as globalState.json / secrets.json (see persist()).
3. Schema-validated read -- parseInstancesFile validates the
   entire file at the boundary. A malformed file THROWS
   (InstancesStoreError), which is the recon section 6b
   fail-closed invariant: a corrupt instance file must never
   silently pick another instance.
4. No global active pointer -- the file shape is exactly
   Record<instanceId, ProviderConfigurationInstance>; there is
   no activeInstanceId, no profile pointer, no global default.

### R3 RED -> GREEN test results

```text
src/sdk/instance-store/instances-store.test.ts
  R3-01 creates A and B; reads back A==A and B==B               PASS
  R3-02 restart (close + reopen): A and B survive intact        PASS
  R3-03 missing file on disk => store starts empty, no error    PASS
  R3-04 corrupt file fails CLOSED (no silent default pick)      PASS
  R3-05 rename displayLabel does NOT change identity or key     PASS
  R3-06 delete: removed instance is no longer readable          PASS
  R3-07 fresh file matches emptyInstancesFile() exactly         PASS

7 tests, 7 GREEN.
```

## 2. R4 GREEN: instance-secret namespace

The recon phase froze (evidence 06a section 4):

```text
CREDENTIAL_STORAGE_PRIMITIVE  = C (minimal instance-scoped secret
                                 namespace)
Reserved "instance:" prefix in secrets.json
New typed accessor pair (getInstanceSecret / setInstanceSecret)
Manual schema InstanceSecretNameSchema (regex / ^instance:.+$/)
```

The new module apps/vscode/src/shared/storage/instance-secret.ts
provides:

- INSTANCE_SECRET_NAME_PATTERN = /^instance:.+$/ -- the regex
- InstanceSecretName -- brand-typed string wrapper
- parseInstanceSecretName(raw) -- brand-check + throw on invalid
- nameFor(instanceId) -- canonical instance:<instanceId> builder
- InstanceSecretError -- fail-closed error type

The StateManager gained:

- setInstanceSecret(name, value) -- DEFINE/UPDATE writer (the
  APPLY path MUST NOT call this; the discriminator is the call
  site, not the accessor's signature)
- getInstanceSecret(name) -- APPLY reader
- listInstanceSecretNames() -- diagnostics
- pendingInstanceSecrets -- debounced-write tracking
- persistInstanceSecretsBatch -- flushes pending writes through
  the same setBatch path as persistSecretsBatch (single
  atomic-rename write to secrets.json)
- populateCache seeds the in-memory cache from secrets.json
  on construction (sweep for instance:-prefixed keys)

### R4 RED -> GREEN test results

```text
src/shared/storage/__tests__/instance-secret.test.ts
  R4-01 parseInstanceSecretName accepts only the 'instance:' prefix    PASS
  R4-02 parseInstanceSecretName rejects non-prefixed names             PASS
  R4-03 parseInstanceSecretName rejects a non-string                  PASS
  R4-04 nameFor builds a namespaced key from an instanceId            PASS
  R4-05 nameFor rejects empty instanceId                              PASS
  R4-06 the regex matches what the schema says it matches             PASS
  R4-07 InstanceSecretName is brand-distinct from arbitrary string    PASS

7 tests, 7 GREEN.
```

The StateManager additions are exercised by type-check (the
existing sdk-session-config-builder tests + the recon phase
R1/R2/R2p tests still pass, and the new typed projector reaches
the StateManager type through coreSessionConfig /
providerConfigurationInstanceTyped boundaries).

## 3. R5 GREEN: typed projector (replaces OPENAI_ONLY_PROBE)

The recon phase froze (evidence 06 section 5b):

```text
RUNTIME_STRATEGY = B (full session reconstruction on instanceId
                     change; updateSessionModel fast path
                     preserved for same instance)
R1_FIXTURE_PRIMARY = providerId/modelId identical instances A/B
                     with diverging baseUrl, credential, headers
```

The new module apps/vscode/src/sdk/instance-store/typed-projector.ts
exposes applyTypedProviderInstanceToConfig(config, instance),
which:

1. Honors explicit null as clearing -- the OPENAI_ONLY_PROBE
   collapsed null to "preserve baseline" (silent bleed); the
   typed projector distinguishes undefined (= preserve) from
   null (= clear). See setOrClear().
2. Covers non-OpenAI-compatible provider shapes -- the legacy
   OPENAI_ONLY_PROBE only knew about openAiApiKey /
   openAiBaseUrl / openAiHeaders. The typed projector handles
   anthropic, claudecode, aws, gcp, oca, sap, ollama, and the
   rest of the provider-id matrix (see
   OPENAI_COMPATIBLE_PROVIDER_IDS).
3. Routes through connection.apiKeyRef.name -- the secret value
   is NEVER embedded on the instance record (the recon
   PROFILE_CONTAINS_RAW_SECRET = NO invariant); the typed
   projector surfaces the resolved key name (under secrets.json)
   and the runtime resolves the physical value at apply time.

### R5 RED -> GREEN test results

```text
src/sdk/instance-store/typed-projector.test.ts
  R5-01 positive binding: A+B -> result reflects B                    PASS
  R5-02 clearing semantics: B.headers=null -> result.headers=null      PASS
  R5-03 generic provider shape: B with anthropic providerId           PASS
  R5-04 conservation: partial instance preserves baseline fields      PASS

4 tests, 4 GREEN.
```

The legacy OPENAI_ONLY_PROBE path is unchanged and still
exercised by the recon-phase R2p test:

```text
src/sdk/__tests__/provider-instance-identity-r2p-real-projector.piif01.test.ts
  R2p1 positive binding (legacy OPENAI_ONLY_PROBE)                       PASS
  R2p2 clearing semantics (legacy OPENAI_ONLY_PROBE)                     PASS
  R2p3 mode discriminator (legacy OPENAI_ONLY_PROBE)                     PASS
  R2p4 generic provider boundary (legacy OPENAI_ONLY_PROBE)              PASS
  R2p conservation no-override (legacy OPENAI_ONLY_PROBE)                PASS

5 tests, 5 GREEN.  No regression on the recon R2p GREEN.
```

## 4. Combined run

```text
$ cd apps/vscode && bun vitest run --config vitest.config.c2-4-c-bridge.ts \
    src/sdk/instance-store/instances-store.test.ts \
    src/sdk/instance-store/typed-projector.test.ts \
    src/shared/storage/__tests__/instance-secret.test.ts \
    src/sdk/__tests__/provider-instance-identity-r2p-real-projector.piif01.test.ts

 Test Files  4 passed (4)
      Tests  18 passed (18)
```

## 5. Type-check results

```text
$ cd apps/vscode && bun tsc --noEmit -p tsconfig.c2-4-c-bridge.json
# (zero diagnostics)

$ cd apps/vscode && bun tsc --noEmit -p tsconfig.json
# Pre-existing diagnostics only:
#   - src/sdk/__tests__/provider-instance-identity-r1a-red.piif01.test.ts
#     (Cannot find module @cline-internal/core/... -- pre-existing)
#   - src/sdk/__tests__/provider-instance-identity-r2-strategy-b.piif01.test.ts
#     (same pre-existing module-resolution issue)
#   - src/sdk/cline-session-factory.test.ts
#     (pre-existing ollamaApiOptionsCtxNum field issue)
# No new diagnostics introduced by this commit.
```

## 6. Conservation matrix (the OPENAI_ONLY_PROBE stays valid)

The recon-phase R2p test (provider-instance-identity-r2p-
real-projector.piif01.test.ts) was the witness that
characterized the OPENAI_ONLY_PROBE as TEMPORARY. This commit
preserves all 5 R2p tests GREEN:

- R2p1 / R2p2 / R2p3 / R2p4 / R2p: 5/5 GREEN.

The OPENAI_ONLY_PROBE limitation is now an EXPLICIT, HONESTLY
CHARACTERIZED path that the recon phase froze; the typed projector
REPLACES it for new callers via providerConfigurationInstanceTyped,
but the legacy OPENAI_ONLY_PROBE path remains in place for back-
compat with the recon R2/R2p test corpus and the legacy
providerConfigurationInstance carrier.

A future commit may delete the OPENAI_ONLY_PROBE entirely; that
is out of scope here per the eleventh reviewer's directive
("do not expand it into a giant generic mapper").

## 7. Out of scope (explicit)

```text
- R-replace (real SdkSessionLifecycle.replaceActiveSession qualification)
- Conservation witness (same instance + model A1 -> A2 => fast path)
- profile CRUD
- quick-switch popup
- activeProfileId persistence
- defaultProfileId
- "Set as default"
- migration UX
- cloud sync
- favorites/profile integration
- deleting the OPENAI_ONLY_PROBE (deferred)
```

## 8. Disposition

| Item                                  | Value                                              |
|---------------------------------------|----------------------------------------------------|
| FOUNDATION_RECON_PHASE                | CLOSED (predecessor ACT 191dd639b)                 |
| FOUNDATION_IMPLEMENTATION_PHASE       | OPEN                                                |
| R3 instance definition store          | GREEN                                              |
| R4 instance-secret namespace          | GREEN                                              |
| R5 typed projector (replaces probe)   | GREEN                                              |
| OPENAI_ONLY_PROBE                     | CHARACTERIZED, NON-BLOCKING, BACK-COMPAT           |
| R-replace real lifecycle qualification | DEFERRED to next commit                           |
| Conservation witness (model fast path)| DEFERRED to next commit                           |
| MODEL_PROFILES_IMPLEMENTATION         | NOT_AUTHORIZED                                     |
| New P0 from this commit               | NONE                                              |
| New P1 from this commit               | NONE (the OPENAI_ONLY_PROBE / typed split is by    |
|                                       | design per the recon freeze)                      |
| Halt conditions                       | NONE -- R3/R4/R5 all GREEN with the bridge config |
|                                       | (the pre-existing vitest+zod infra issue applies   |
|                                       | to the base config only)                          |
| Pre-execution review required?        | NO (eleventh reviewer explicit)                    |
| ACT_HEAD_AT_AUTHOR                    | 191dd639b                                          |
