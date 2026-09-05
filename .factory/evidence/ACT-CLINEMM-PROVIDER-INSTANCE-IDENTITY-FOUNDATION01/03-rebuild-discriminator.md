# 03 — Current runtime rebuild discriminator (recon stream 1c)

Recon date: foundation ACT entry (pre-R0).
Scope: what production seams cause the API handler to be rebuilt today,
and what semantic event triggers each rebuild. Per ACT body §9.

This is the baseline against which R0's
`CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY` is measured.

---

## 1. The single rebuild scheduler

**`apps/vscode/src/sdk/sdk-session-rebuild-scheduler.ts`** (93 lines):

```text
type SessionRebuildReason =
  | "provider"
  | "mcpTools"
  | "terminalExecutionMode"
  | "sessionAutoApprovalOverride"
```

There are exactly four rebuild reasons today. Three of them are mode/state
changes (MCP tools refreshed, terminal execution mode flipped, session
auto-approval override toggled). The fourth — `provider` — is the one this
ACT cares about.

Behavior:

```text
SdkSessionRebuildScheduler.request(reason, rebuild):
  - inserts (reason, rebuild) into pending map
  - calls drainIfIdle()
  - drainIfIdle fires the rebuild ONLY when:
      activeSession exists AND !activeSession.isRunning
  - the rebuild is awaited; the next pending rebuild is then attempted
    (also only when idle)
```

So rebuilds are **passive** and **idle-gated**. They never fire mid-task.
This is a deliberate "wait for the next idle point" contract.

---

## 2. The provider-rebuild trigger (the upstream c31f33e mechanism)

**`apps/vscode/src/sdk/sdk-provider-change-coordinator.ts`** (131 lines):

```text
SdkProviderChangeCoordinator.handleApiConfigurationChanged(previous, next):
  1. mode = current mode (plan | act)
  2. previousProvider = providerForMode(previous, mode)
  3. nextProvider     = providerForMode(next, mode)
  4. if previousProvider === nextProvider:
       return  (no rebuild; canonical spelling only changes are filtered)
  5. activeSession = sessions.getActiveSession()
     if !activeSession: log "next task will use new provider", return
  6. rebuilds.request("provider",
       () => this.restartActiveSessionForProviderChange())
```

`providerForMode(config, mode)` returns the canonical legacy spelling of
the configured provider for the given mode (e.g.
`planModeApiProvider ?? actModeApiProvider` with `toLegacyApiProvider`
normalization to handle `openai` vs `openai-compatible` spelling drift).

**The discriminant:** `previousProvider !== nextProvider`. Nothing else.
The rebuild path is fired ONLY when the providerId changes (after
canonical-spelling normalization).

`restartActiveSessionForProviderChange()` then:

1. Calls `sessions.replaceActiveSession(...)` which disposes the old
   `sdkHost` (Cline session runtime) and constructs a new one via
   `sessionConfigBuilder.build({ cwd, mode })`.
2. The new session calls `buildSdkProviderConfig(configuration, mode)`
   on first handler construction, picking up the new providerId /
   modelId / baseUrl / apiKey / headers / etc.
3. Logs the session transition; if the new session has a different
   sessionId, updates the task proxy.

---

## 3. What is NOT a rebuild trigger today

By inspection of `sdk-provider-change-coordinator.ts`:

```text
  - baseUrl change (for the same providerId): NOT a rebuild trigger.
  - apiKey / credential change (for the same providerId):
      NOT a rebuild trigger.
  - headers change (for the same providerId): NOT a rebuild trigger.
  - providerSpecificConfig change (for the same providerId):
      NOT a rebuild trigger.
  - region change (for bedrock, vertex, etc.):
      NOT a rebuild trigger.
  - modelId change (for the same providerId): NOT a rebuild trigger
      (modelId is read at handler construction; a plain modelId swap
      is picked up by the next request without a session rebuild).
```

The discriminant is solely `providerId` (after canonical-spelling
normalization via `toLegacyApiProvider`).

---

## 4. The "mode-specific" qualifier

`providerForMode` checks the **mode-specific** provider field:

```text
mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
```

This means a provider change in **plan mode** triggers a rebuild only
when the active session is in plan mode, and vice versa. The current
mode is read from `stateManager.getGlobalSettingsKey("mode")`.

The implication for R0 / R1: the rebuild discriminator is **mode-scoped**,
not globally-scoped. A future ProviderConfigurationInstance identity
that lives in one mode but not the other still has to honor this
mode-scoping.

---

## 5. Idle-gating: what happens if a user changes provider mid-task

Per `sdk-session-rebuild-scheduler.ts`:

```text
drainIfIdle:
  if (this.drainInFlight || this.pending.size === 0 ||
      !activeSession || activeSession.isRunning) {
    return
  }
```

If the user changes provider while the session is running (mid-task,
streaming a response, etc.):

- `activeSession.isRunning` is true.
- `drainIfIdle` early-returns.
- The rebuild sits in `pending` until the next `sessionBecameIdle()` or
  `runExclusive(...)` call.

Until that happens, the live task continues with the OLD providerId /
OLD handler. The user sees the new providerId in the UI, but the
in-flight request is unaffected. **This is the in-flight safety
property MP RECON §21 named `NEVER_MUTATE_CURRENT_REQUEST`.**

For the foundation ACT's R1 outcome C (in-place mutation), this means:

```text
  Even on the LIVE same-providerId config flip, today's rebuild path
  would NOT fire (same providerId). The in-flight request is unaffected
  by the rebuild discriminator, regardless of whether same-providerId
  config changes ever become rebuild-triggering.

  So R1's secondary assertion (no in-flight mutation) is trivially
  satisfied by today's scheduler for same-providerId changes: the
  rebuild path simply does not engage.

  But the PRIMARY assertion (NEXT_EFFECTIVE_CONNECTION == B after
  switch) is ALSO not satisfied by today's scheduler for same-provider
  changes: even when the session becomes idle and the next request
  fires, today's `buildSdkProviderConfig` will still read the same
  `openAiApiKey` / `openAiBaseUrl` fields, which carry whichever
  value was last written to the providerId-keyed slot.
```

This is the R0 baseline: today's scheduler treats same-providerId
config flips as a no-op for rebuild purposes, and same-providerId
config flips DO NOT produce a different next effective connection
because the storage shape collapses them.

---

## 6. R0 prediction (before evidence; to be measured)

Per the reviewer's stated prior: **NO / NO / NO**.

- `CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = NO`
  (no second identity dimension in storage; collapse at providerId).
- `CURRENT_SEAM_MUTATES_FULL_CONNECTION       = NO`
  (same providerId-keyed field re-read on the next request).
- `CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY   = NO`
  (rebuild discriminator is providerId-only, not config-identity).

R0 in evidence file `04-r0-current-seam-witness.md` freezes what is
actually measured. The prior is overridden by evidence; if any of the
three is `YES`, that finding is the load-bearing R0 result and changes
the foundation ACT's design constraints.
