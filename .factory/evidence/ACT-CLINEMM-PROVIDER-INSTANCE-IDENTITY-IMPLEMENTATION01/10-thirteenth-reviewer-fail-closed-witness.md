# 10 — Thirteenth-reviewer fail-closed witness

## Bounded correction of HALT_MISSING_INSTANCE_SECRET_FAILS_OPEN

The thirteenth reviewer raised `HALT_MISSING_INSTANCE_SECRET_FAILS_OPEN`
on commit fa61ff5be: the builder resolved
`stateManager.getInstanceSecret(instance.credentialRef.name)` and the
projector converted an `undefined` return into `cfg.apiKey = null`,
silently letting reconstruction proceed on a broken durable instance.

## What changed

1. New error class `MissingProviderInstanceCredentialError` in
   `apps/vscode/src/sdk/instance-store/contracts.ts`. Carries both
   `instanceId` and `credentialRefName` so catch sites can surface a
   clear "broken instance" message.

2. `SdkSessionConfigBuilder.build()` checks
   `resolvedApiKey === undefined || resolvedApiKey === ""` BEFORE
   calling the projector and throws
   `MissingProviderInstanceCredentialError`. The Promise rejects; no
   replacement occurs; the active session remains unchanged.
3. `applyTypedProviderInstanceToConfig(config, instance,
   resolvedApiKey: string)` — projector signature is now
   non-nullable. A runtime guard at the top of the projector
   re-throws the same error class if any caller bypasses the
   builder and passes `undefined` / `null` / `""`.

4. R5-04 and R5-06 tests in
   `apps/vscode/src/sdk/instance-store/typed-projector.test.ts`
   were rewritten to freeze the CORRECT invariant (throw, not
   `apiKey = null`). R5-07 (new) covers the empty-string
   case.

5. New file
   `apps/vscode/src/sdk/__tests__/provider-instance-identity-r5-missing-credential-fails-closed.piif01.test.ts`
   with four builder-level fail-closed witnesses:
     - PIIF01_R5_MISSING_CREDENTIAL_BUILDER_REJECTS
## Test results

```
bridge config (6 files):
  instance-store/instances-store.test.ts                                10 GREEN
  instance-store/typed-projector.test.ts                                 7 GREEN
  shared/storage/__tests__/instance-secret.test.ts                       7 GREEN
  core/storage/__tests__/state-manager-instance-secret-durable.test.ts   5 GREEN
  sdk/__tests__/provider-instance-identity-r2p-real-projector.piif01.test.ts  5 GREEN  (regression)
  sdk/__tests__/provider-instance-identity-r5-missing-credential-fails-closed.piif01.test.ts  4 GREEN  (NEW)
  TOTAL                                                                  38 GREEN  (was 33)

bridge typecheck:  bun run check-types:c2-4-c-bridge  →  OK (0 diagnostic)
```

## What is no longer halted

R-replace (`SdkSessionLifecycle.replaceActiveSession` real
qualification) is authorized to proceed once this commit lands.

## What's still on the follow-on list (P1, not blocking)

  - R4_RELOAD_READ NOT_EXECUTED — process-restart-roundtrip
    witness for StateManager instance secrets.
  - Generic-provider scope overclaim — claim should be
    `API_KEY_BACKED_INSTANCE_IDENTITY = SUPPORTED` only.
  - Structured-provider projection overclaim — R5 covers
    common-field geometry only.

These are P1 follow-ons, not halt conditions.
     - PIIF01_R5_EMPTY_CREDENTIAL_BUILDER_REJECTS
     - PIIF01_R5_RESOLVED_CREDENTIAL_BUILDER_PROJECTS
     - PIIF01_R5_REJECTION_ABORTS_BEFORE_PROJECTION

