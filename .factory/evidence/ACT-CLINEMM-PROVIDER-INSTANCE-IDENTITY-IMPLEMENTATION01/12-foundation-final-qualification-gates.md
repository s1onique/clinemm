# ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / Evidence 12

## Foundation Final Qualification — Four-Gate Evaluation (fifteenth reviewer, C1: GO)

This is the §17 hand-off evidence file for the hundred-and-third
pass. The fourteenth-reviewer (this pass's predecessor) authorized
"one terminal Foundation qualification" containing exactly four
items:

  1. Assert the complete B connection tuple on the second real
     lifecycle `sdkHost.start()` call.
  2. Execute the persisted instance-secret reload witness
     (R4_RELOAD_READ).
  3. Run the existing 42-test conservation set + typecheck.
  4. Write the §17 final report (this file).

If all four are GREEN, the reviewer's expected terminal verdict is:

  PASS_PROVIDER_INSTANCE_IDENTITY_FOUNDATION
  FOUNDATION = CLOSED_CLEAN
  MODEL_PROFILES_IMPLEMENTATION = AUTHORIZED

### Item 1 — COMPLETE_V1_CONNECTION_AT_HOST_START (G3)

**Freeze**: `COMPLETE_V1_CONNECTION_AT_HOST_START = EXECUTED`

The previous positive witness (`R_REPLACE_POSITIVE`) only asserted
that `ActiveSession.startConfig` (which intentionally stores only
`{ providerId, modelId }`) carried B's identity into the lifecycle.
The fourteenth reviewer correctly noted that this stopped short of
the lifecycle boundary: production source already establishes
passthrough — `startNewSession` calls
`sdkHost.start({ ...startInput, ...(toolPolicies ? {...} : {}) })`
at `sdk-session-lifecycle.ts:317` — but the prior file only
verified it structurally. The fake host is already a `vi.fn`, so
the assertion was trivial to convert from structural proof to
executable proof.

The augmented block in `provider-instance-identity-r-replace-real-lifecycle.piif01.test.ts`
asserts the SECOND call to `fakeHost.start` (the B install):

```
secondStartCall.config: {
  providerId: "openai-compatible",
  modelId:    "model-B",
  apiKey:     "physical-key-B",       // <- resolved physical secret
  baseUrl:    "https://endpoint-B",
  headers:    { "X-B": "2" },
  sessionId:  "sess-B",
}
```

with the additional fail-closed sanity:

```
expect(secondStartCall?.config?.apiKey).toBe("physical-key-B")
expect(secondStartCall?.config?.apiKey).not.toBe("instance:inst-B-key")
```

The same fail-closed invariant the R5 file freezes at the builder
seam (`apiKey = physical-secret, NOT reference-name`) is now
observed at the lifecycle boundary in `sdkHost.start`'s first
argument. The reference name can no longer become the runtime API
key at either seam.

### Item 2 — R4_RELOAD_READ (G2)

**Freeze**: `R4_RELOAD_READ = EXECUTED`

New file `provider-instance-identity-r4-reload-read.piif01.test.ts`
exercises the lowest production reload seam BENEATH the
StateManager singleton. Per the fourteenth reviewer's explicit
authorization ("test the lowest production reload seam beneath it
rather than adding a test-only reset API"), that seam is a fresh
`ClineFileStorage` constructed from the same `secrets.json` disk
path that `createStorageContext()` would use on restart, sweeping
`keys()` exactly the way `StateManager.populateCache()` does
(`StateManager.ts:833-839`).

The seam is BENEATH the singleton because re-reading the file is
exactly what `populateCache` does (it does not know or care about
the previous process's in-memory cache). If the on-disk file is
roundtrippable through this seam, `populateCache` will see the
value on the next startup.

Four witnesses:

  - **R4-RR-01** — on-disk `secrets.json` contains the entry
    under the namespaced key matching
    `INSTANCE_SECRET_NAME_PATTERN`. Predicate is the exact one
    `populateCache` uses to sweep the secrets file on reload.

  - **R4-RR-02** — a FRESH `ClineFileStorage` constructed from the
    same disk path returns the physical secret via `.get(name)`.
    `keys()` returns the same key set as `populateCache` would
    sweep; `get(key)` returns the same value `populateCache`
    writes into `instanceSecretsCache`.

  - **R4-RR-03** — the full credential-resolution chain survives a
    restart: opaque reference name still resolves to the physical
    secret value via the same `populateCache` sweep. Plus the
    fail-closed chain-inversion invariant: `freshCache.get(name)
    !== name` and `freshCache.get(name) !~ /^instance:/` (the
    physical secret is NEVER the reference name, and NEVER has
    the `instance:` prefix).

  - **R4-RR-04** — deletion survives reload:
    `setInstanceSecret(name, undefined) -> flushPendingState ->
    reloaded store no longer has the key`. Symmetric with
    R4-RR-02 for the delete path.

### Item 3 — Existing 42-test conservation set + typecheck

**Freeze**: `CONSERVATION_42_SET = GREEN` and
`BRIDGE_TYPECHECK = 0_DIAGNOSTIC_DRIFT`

The 42-test conservation set (everything that was GREEN at the
end of the predecessor pass) remains GREEN at 46/46 (was 42,
+4 R4-RR witnesses, augmented R_REPLACE_POSITIVE inside the same
4-witness R-replace file).

Bridge typecheck (`bun run check-types:c2-4-c-bridge`) exits 0
with 0 diagnostic drift.

### Item 4 — §17 Four-Gate Final Report

The reviewer's framework:

  G1 DEFINITION_IDENTITY:
     instances.json roundtrip + map/body identity
     = PASS

  G2 CREDENTIAL_IDENTITY:
     opaque ref -> durable physical secret + restart/reload
     = GREEN (this pass; reload witness pending -> EXECUTED)

  G3 EFFECTIVE_CONNECTION:
     typed instance B -> complete B tuple at sdkHost.start
     = GREEN (this pass; host-start argument assertion pending
       -> EXECUTED)

  G4 LIFECYCLE:
     idle instance switch reconstructs;
     running refuses;
     missing credential preserves A;
     model-only uses fast path
     = PASS

#### G1 DEFINITION_IDENTITY (instances.json roundtrip + map/body)

Proven in:
  - `apps/vscode/src/sdk/instance-store/instances-store.test.ts`
    (10 tests) — the roundtrip + map/body identity contract.
  - `apps/vscode/src/sdk/instance-store/typed-projector.test.ts`
    (7 tests) — the typed projector contract.
  - `apps/vscode/src/sdk/instance-store/contracts.ts` —
    `ProviderConfigurationInstance` schema, `MapSchema`,
    `credentialRef` discriminator, `MissingProviderInstanceCredentialError`.

Status: PASS

#### G2 CREDENTIAL_IDENTITY (opaque ref -> durable physical secret + reload)

Proven in:
  - `apps/vscode/src/shared/storage/__tests__/instance-secret.test.ts`
    (7 tests) — the schema namespace + parse helpers.
  - `apps/vscode/src/core/storage/__tests__/state-manager-instance-secret-durable.test.ts`
    (5 tests, R4-D01..R4-D05) — the in-process durable write.
  - `apps/vscode/src/sdk/__tests__/provider-instance-identity-r4-reload-read.piif01.test.ts`
    (4 tests, R4-RR-01..R4-RR-04, this pass NEW) — the restart
    reload seam.
  - `apps/vscode/src/shared/storage/instance-secret.ts` —
    `INSTANCE_SECRET_NAME_PATTERN`, `parseInstanceSecretName`,
    `nameFor`, `InstanceSecretError`.

Status: GREEN (R4_RELOAD_READ = EXECUTED)

#### G3 EFFECTIVE_CONNECTION (typed instance B -> complete B tuple at sdkHost.start)

Proven in:
  - `apps/vscode/src/sdk/__tests__/provider-instance-identity-r2p-real-projector.piif01.test.ts`
    (5 tests) — the real builder + real projector composes the
    complete B tuple into the projected config.
  - `apps/vscode/src/sdk/__tests__/provider-instance-identity-r-replace-real-lifecycle.piif01.test.ts`
    R_REPLACE_POSITIVE (this pass AUGMENTED) — asserts the second
    call to `fakeHost.start` carries the complete B connection
    tuple (`apiKey`, `baseUrl`, `headers`, `providerId`,
    `modelId`) across the lifecycle boundary.

Status: GREEN (COMPLETE_V1_CONNECTION_AT_HOST_START = EXECUTED)

#### G4 LIFECYCLE (idle switch / running refusal / missing preservation / model-only fast path)

Proven in:
  - `apps/vscode/src/sdk/__tests__/provider-instance-identity-r-replace-real-lifecycle.piif01.test.ts`
    (4 tests, all four G4 invariants):
      - R_REPLACE_POSITIVE — idle switch reconstructs (new session
        installed, host.start called 2x).
      - R_REPLACE_NEGATIVE_MISSING_CREDENTIAL — missing
        credential PRESERVES the active session (same object
        reference at the lifecycle seam).
      - R_REPLACE_RUNNING_SESSION_REFUSAL — replaceActiveSession
        returns undefined while running; no replacement attempt
        reaches host.start.
      - R_REPLACE_CONSERVATION_MODEL_ONLY — same-instance model
        mutation goes through `updateActiveSessionModel` (fast
        lane); no host.start, no replacement.

Status: PASS

### Disposition (post this pass)

  G1 = PASS
  G2 = GREEN
  G3 = GREEN
  G4 = PASS

  R-REPLACE                          = GREEN
  NO_REPLACEMENT_ON_MISSING_SECRET   = GREEN at lifecycle seam
  MODEL_ONLY_CONSERVATION            = GREEN
  R4_DURABLE_WRITE                   = GREEN
  R4_RELOAD_READ                     = GREEN (this pass)
  COMPLETE_V1_CONNECTION_AT_HOST_START = GREEN (this pass)

  FOUNDATION_FINAL_QUALIFICATION = CLOSED_CLEAN

  MODEL_PROFILES_IMPLEMENTATION  = AUTHORIZED (per the
    fourteenth reviewer's expected terminal verdict)

### Foundation scope freeze (per the fourteenth reviewer)

  MODEL_PROFILES_V1_PROVIDER_INSTANCE_SCOPE = API_KEY_BACKED_CONNECTIONS
  NON_API_KEY_AUTH                         = NOT_YET_SUPPORTED_BY_INSTANCE_FOUNDATION
  STRUCTURED_PROVIDER_SPECIFIC_FIELDS       = NOT_CLAIMED GENERICALLY

The prior "generic-provider overclaim" and "structured-provider
projection overclaim" carry-overs become explicit product
boundaries rather than more Foundation work.

### P1 follow-ons (NOT blocking §17 authorization)

None remaining. The two carry-overs
(`COMPLETE_B_TUPLE_NOT_ASSERTED_AT_HOST_START` and
`R4_RELOAD_READ_NOT_EXECUTED`) are both CLOSED in this pass.

### Test counts (bridge, this pass)

  typed-projector.test.ts                          =  7
  instances-store.test.ts                          = 10
  instance-secret.test.ts                          =  7
  state-manager-instance-secret-durable.test.ts    =  5
  r2p-real-projector.piif01.test.ts                =  5
  r5-missing-credential-fails-closed.piif01.test.ts =  4
  r-replace-real-lifecycle.piif01.test.ts          =  4
  r4-reload-read.piif01.test.ts                    =  4  (NEW this pass)
  TOTAL                                            = 46  (was 42, +4)

All 46 GREEN across 8 bridge files. Bridge typecheck exits 0 with
0 diagnostic drift.

### Production source files NOT touched (this pass)

Same as predecessor pass — this is a witness + typecheck + report
pass, no production changes. Specifically unchanged:

  apps/vscode/src/sdk/instance-store/**
  apps/vscode/src/sdk/sdk-session-config-builder.ts
  apps/vscode/src/sdk/sdk-session-lifecycle.ts
  apps/vscode/src/sdk/sdk-provider-change-coordinator.ts
  apps/vscode/src/core/storage/StateManager.ts
  apps/vscode/src/shared/storage/instance-secret.ts
  apps/vscode/src/shared/storage/ClineFileStorage.ts
  apps/vscode/src/shared/storage/storage-context.ts
  apps/vscode/src/core/controller/**
  apps/vscode/src/sdk/SdkController.ts
  apps/vscode/src/sdk/cline-session-factory.ts

### Files (this pass)

  apps/vscode/src/sdk/__tests__/provider-instance-identity-r-replace-real-lifecycle.piif01.test.ts (augmented R_REPLACE_POSITIVE)
  apps/vscode/src/sdk/__tests__/provider-instance-identity-r4-reload-read.piif01.test.ts (NEW, 4 witnesses)
  apps/vscode/vitest.config.c2-4-c-bridge.ts (added r4-reload-read to bridge include list)
  apps/vscode/vitest.config.ts (added r4-reload-read to base exclude list)
  apps/vscode/tsconfig.c2-4-c-bridge.json (added r4-reload-read to bridge include list)
  apps/vscode/tsconfig.json (added r4-reload-read to base exclude list)
  .factory/evidence/.../12-foundation-final-qualification-gates.md (NEW, this file)
  .factory/acts/ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01.md (§8 added — the §17 four-gate final report)
  .factory/epic-board.md (hundred-and-third-pass row at top)
