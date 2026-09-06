# ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / 09
## Twelfth Reviewer Bounded Correction Witness

Commit base: `6356e912a` (ninety-ninth-pass, R3+R4+R5 partial GREEN under HALT)

## Scope

Applies the bounded correction the twelfth reviewer demanded on the
ninety-ninth-pass HALTs. The prior commit's HALT was:

  > TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED:
  > `setOrClear(cfgAny, "apiKey", conn.apiKeyRef?.name)` writes the
  > reference name `"instance:inst-B-key"` into `CoreSessionConfig.apiKey`
  > instead of the resolved secret.

Follow-on P1 (also from the twelfth reviewer):

  - CREDENTIAL_AUTHORITY_DUPLICATED: `ProviderConfigurationInstance.credentialRef`
    (REQUIRED) and `ProviderConnection.apiKeyRef` (OPTIONAL) coexisted.
  - `parseInstanceCredentialRef` accepted `name="openAiApiKey"` (no
    `instance:` enforcement).
  - `parseInstancesFile` did not check `k === parsed.instanceId`.
  - R4 tests did not exercise `setInstanceSecret`/`getInstanceSecret`/
    `persistInstanceSecretsBatch`/`populateCache`.
  - R5-03 generic-provider claim overstated.

## What was changed (corrections applied)

### P0-1 — Credential resolution is now in the builder (not the projector)

`apps/vscode/src/sdk/sdk-session-config-builder.ts` now resolves the
credential BEFORE calling the projector:

```ts
if (input.providerConfigurationInstanceTyped) {
    const instance = input.providerConfigurationInstanceTyped
    const resolvedApiKey = this.options.stateManager.getInstanceSecret(
        instance.credentialRef.name,
    )
    applyTypedProviderInstanceToConfig(config, instance, resolvedApiKey)
    return config
}
```

The projector (`apps/vscode/src/sdk/instance-store/typed-projector.ts`)
was changed to take a `resolvedApiKey: string | undefined` argument.
It is now physically impossible for the projector to produce the wrong
contract `cfg.apiKey === "instance:inst-B-key"`:

  - `resolvedApiKey === undefined` -> `cfg.apiKey = null` (explicit clear)
  - `resolvedApiKey === "secret-B-value"` -> `cfg.apiKey = "secret-B-value"`

The reference name is no longer passed through to the projector at all.

### P0-2 — Single credential authority

`ProviderConnection.apiKeyRef` was DELETED from
`apps/vscode/src/sdk/instance-store/contracts.ts`:

  - The field is removed from the `ProviderConnection` interface.
  - `parseProviderConnection` now THROWS if a `apiKeyRef` key is
    present in the connection object (the previous P0-2 ambiguity).

There is now exactly ONE credential authority on a
`ProviderConfigurationInstance`: the top-level `credentialRef`.

### P1 follow-on — Brand-typed credential name

`InstanceCredentialRef.name` is now a brand-typed `InstanceSecretName`
instead of `string`. `parseInstanceCredentialRef` rejects any name
that does not match `INSTANCE_SECRET_NAME_PATTERN`:

  - `name: "openAiApiKey"` -> throws `InstancesContractError("...must
    match the instance-secret namespace...")` at the persistence boundary.
  - This means a malformed file can never alias the closed
    `SECRETS_KEYS` union.

### P1 follow-on — Map key == parsed instanceId

`parseInstancesFile` now enforces
`k === parsed.instanceId` for every entry. A tampered file with
`{"inst-A": {..., "instanceId": "inst-EVIL"}}` fails closed with
`InstancesContractError("...map key must equal parsed instanceId...")`.

### P1 follow-on — Real StateManager durable roundtrip

New test file:
`apps/vscode/src/core/storage/__tests__/state-manager-instance-secret-durable.test.ts`

5 tests, all GREEN:

  R4-D01 setInstanceSecret -> flush -> secrets.json contains the entry
         under the namespaced key only (NOT under `openAiApiKey` or `apiKey`)
  R4-D02 setInstanceSecret(name, undefined) -> flush -> secrets.json
         removes the entry
  R4-D03 getInstanceSecret returns undefined for a never-written name
  R4-D04 two instances with diverging secrets are isolated on disk
  R4-D05 credential-resolution chain inversion:
         `getInstanceSecret(name)` returns the RESOLVED secret value,
         NOT the reference name

## Test counts (post-correction)

| Suite | Tests | Status |
|-------|-------|--------|
| `instance-store/instances-store.test.ts` (R3 + 3 new fail-closed) | 10 | GREEN |
| `instance-store/typed-projector.test.ts` (R5 + 2 inversion) | 6 | GREEN |
| `shared/storage/__tests__/instance-secret.test.ts` (R4 schema) | 7 | GREEN |
| `core/storage/__tests__/state-manager-instance-secret-durable.test.ts` (R4 durable, NEW) | 5 | GREEN |
| `sdk/__tests__/provider-instance-identity-r2p-real-projector.piif01.test.ts` (R2p regression) | 5 | GREEN |
| **TOTAL** | **33** | **GREEN** |

## What survives

  - R3 fail-closed corruption (R3-04)
  - R3 identity preservation across close/reopen (R3-02)
  - R3 rename-safe display label (R3-05)
  - R3 delete semantics (R3-06)
  - Clearing semantics: undefined = preserve, null = clear (R5-02, R5-04)
  - Strategy B (R2p regression stays GREEN)
  - Bridge-config zod workaround

## What was promoted (no longer hangs)

  - R-replace (`SdkSessionLifecycle.replaceActiveSession` real
    qualification): the twelfth reviewer's halt on this has been
    lifted because the credential-binding chain is now GREEN.
    R-replace remains a TODO for the next pass.

## Verification

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd apps/vscode
bun run vitest --config vitest.config.c2-4-c-bridge.ts \
    src/sdk/instance-store/ \
    src/shared/storage/__tests__/instance-secret.test.ts \
    src/core/storage/__tests__/state-manager-instance-secret-durable.test.ts \
    src/sdk/__tests__/provider-instance-identity-r2p-real-projector.piif01.test.ts
# 5 files, 33 tests, all GREEN

bun run check-types:c2-4-c-bridge
# OK -- 0 diagnostic(s) match the frozen baseline.
```

