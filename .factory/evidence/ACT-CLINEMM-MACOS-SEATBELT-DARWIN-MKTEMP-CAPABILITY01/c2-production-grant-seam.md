# C2 Production Grant Seam (spec §8, §41, §42)
# ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2

TIMESTAMP_UTC = 2026-08-26T11:00Z
LABEL          = REAL_PRODUCTION_SEAM

## Grant point (where real authority attaches)

`CommandExecutionPlanEntry.executionCapability` on the entry that
satisfies the reviewed `/usr/bin/mktemp` authorization. The
authority flows from:

  policy layer (CommandExecutionPlan builder)
   --> typed per-command channel (AgentToolContext.perCommandExecutionCapability)
   --> manager.start() job record (CommandJob.executionCapability)
   --> Seatbelt CommandCapability.createOnlyRoots
   --> Seatbelt profile generator
   --> file-write-create (subpath "<canonical>")

## Mapping (exhaustive, spec §17 / §45)

```ts
function capabilityFromJobExecution(
  capability: InternalExecutionCapability | undefined,
): readonly string[] {
  switch (capability?.kind) {
    case "filesystem-create-only":
      return capability.roots
    case "factory-binding-probe":
    case undefined:
      return []
    default:
      return assertNeverExhaustiveCapabilityKind(capability)
  }
}
```

The exhaustive switch guards against silent authority drop on future
InternalExecutionCapability variants (spec §18).

## Files touched

- `sdk/packages/core/src/runtime/sandbox/types.ts`           -- added `createOnlyRoots`
- `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts` -- `file-write-create` emission
- `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts` -- canonicalization + propagation
- `apps/vscode/src/sdk/command-job-manager.ts`                -- conversion (exhaustive switch)
- `apps/vscode/src/sdk/command-job-manager.ts` (snapshot)      -- perCommandExecutionCapability projection

## Command-text parsing? ABSENT.

Spec §43 forbids parsing raw command text downstream of authorization.
No `if (command.includes("mktemp"))` style code in
CommandJobManager, sandbox-policy, SeatbeltBackend, or profile
generator. Authority flows purely from the typed channel.
