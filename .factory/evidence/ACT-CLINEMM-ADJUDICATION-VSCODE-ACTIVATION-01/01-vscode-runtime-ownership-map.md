# 01 — VS Code runtime ownership map (G1)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Classification:** REAL_PRODUCTION_SEAM (source-level recon of the installed extension's own production tree)

## G1.1 The real initialization chain

The initial repository search looked for `openSession`. **That method does not exist.**
The SDK's session-start entrypoint is `LocalRuntimeHost.startSession(input: StartSessionInput)`.

The ACTUAL production chain, traced from the VS Code extension activation down to
the runtime configuration that reaches `LocalRuntimeHost`:

```
apps/vscode/src/sdk/SdkController.ts                (extension-host controller)
  -> apps/vscode/src/sdk/sdk-task-start-coordinator.ts
       initTask(prompt, images, files, historyItem, taskSettings)
         -> options.sessionConfigBuilder.build({ prompt, images, files, historyItem,
                                                 taskSettings, cwd, mode, ... })
            |
            v
       apps/vscode/src/sdk/sdk-session-config-builder.ts
         SdkSessionConfigBuilder.build(input: SessionConfigInput)
           -> buildSessionConfig(input)                <-- CONFIG PRODUCER (base)
           -> (post-projections: hooks, provider instance)
            |
            v
       apps/vscode/src/sdk/cline-session-factory.ts
         export async function buildSessionConfig(input: SessionConfigInput): Promise<CoreSessionConfig>
           (cline-session-factory.ts:1097)
           -> builds `const config: CoreSessionConfig = { ... }`  (line 1402)
            |
            v
       apps/vscode/src/sdk/cline-session-factory.ts
         buildStartSessionInput(config, input) -> ClineCoreStartInput   (line 1605)
            |
            v
       apps/vscode/src/sdk/vscode-session-host.ts
         VscodeSessionHost.start(input)  (line 573)
           -> prepareStartSessionInput(input)  (line 395, the named lambda)
           -> this.inner.start(prepared)  -> ClineCore.startSession(input.config)
            |
            v
       sdk/packages/core/src/ClineCore.ts  -> LocalRuntimeHost.startSession(input)
            |
            v
       sdk/packages/core/src/runtime/host/local-runtime-host.ts
         startSession(input)                    (line 695)
           -> startResolvedSession(...)          (line 761)
              -> prepareLocalRuntimeBootstrap({ input: startInput, ... })
                 (sdk/packages/core/src/services/local-runtime-bootstrap.ts)
                   -> `const config: CoreSessionConfig = { ...baseConfig, providerConfig, ... }`  (line 596)
                      <-- baseConfig is the VS Code-supplied CoreSessionConfig, so
                          `adjudication` rides through the SPREAD unchanged
              -> const configWithProvider = bootstrap.config    (local-runtime-host.ts:1001)
                 -> ADJUDICATION SEAM (local-runtime-host.ts:1078-1320)
```

### The exact function that creates the runtime configuration

**`buildSessionConfig()` in `apps/vscode/src/sdk/cline-session-factory.ts:1097`** is the
function that creates the runtime configuration. It is reached through
`SdkSessionConfigBuilder.build()` (`apps/vscode/src/sdk/sdk-session-config-builder.ts:37`),
which is invoked by `SdkTaskStartCoordinator.initTask()`
(`apps/vscode/src/sdk/sdk-task-start-coordinator.ts:243`).

The `VscodeSessionHost.prepareStartSessionInput` lambda is a **second** configuration
pipeline, but it only ADDS fields (`telemetry`, `extraTools`, `modelBehaviorTraceSink`)
and spreads `inputWithRemoteConfig.config`. It does not own the adjudication contract
and does not need to change.

## G1.2 Existing task-specific configuration (the seam to reuse)

`buildSessionConfig` already reads, for THIS task:

| Fact | Source in `buildSessionConfig` |
|---|---|
| Task identity | `input.historyItem` (resume) / `config.sessionId` allocated by the task-start coordinator |
| Workspace root | `input.cwd` / `input.workspaceRoot` -> `config.cwd`, `config.workspaceRoot` |
| User-authorized task options | `input.taskSettings: Partial<Settings>` |
| Runtime configuration | the `const config: CoreSessionConfig = {...}` literal at line 1402 |
| Provider configuration | `resolveApiKey` / `resolveModelId` / `resolveBaseUrl` + `providerConfig` |
| Session restoration identity | `config.sessionId`; resume path re-reads `SessionManifest` in `LocalRuntimeHost.startSession` |
| Existing optional feature switches | `config.checkpoint.enabled`, `config.compaction.{enabled,strategy,userContextCeiling}`, `config.enableSubmitAndExit` |

**The existing precedent for a nested, opt-in, task-scoped config block is
`config.compaction`** (`cline-session-factory.ts:1428-1440`): a conditional spread of a
nested object that the SDK runtime-builder reads. The adjudication contract is the
exact same shape, and `CoreSessionConfig.adjudication?: CoreAdjudicationConfig`
ALREADY EXISTS in `sdk/packages/core/src/types/config.ts:324`.

**There is NO second configuration pipeline to create.** The SDK-side consumer is
already fully wired; only the VS Code PRODUCER side is missing.

## G1.3 Actual activation state

Measured by exhaustive search of the production VS Code source tree:

```
$ grep -rn 'adjudication' apps/vscode/src --include='*.ts'
apps/vscode/src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts:45
apps/vscode/src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts:407
```

Both hits are the unrelated English word "adjudication" inside an unrelated
`HALT_CAUSAL_CLAIM_INVALID adjudication` comment in a DIFFERENT ACT's test file.
`apps/vscode/proto` has zero hits.

| Field | State |
|---|---|
| `adjudication.enabled` | **NOT_SUPPLIED** |
| `adjudication.vocabulary` | **NOT_SUPPLIED** |
| `adjudication.revisionResolver` | **NOT_SUPPLIED** |
| `adjudication.secretProvider` | **NOT_SUPPLIED** |

The whole `adjudication` object is absent from the config the VS Code producer
builds, so `configWithProvider.adjudication?.enabled` is `undefined` (falsy) in
`LocalRuntimeHost.startResolvedSession`, and NO registry is created
(`local-runtime-host.ts:1081`), NO compaction adjudication seam is installed
(`local-runtime-host.ts:1096`), and NO publication instruction is applied
(`local-runtime-host.ts:1266`).

## G1.4 Recon exit

```
CONFIG_PRODUCER:          apps/vscode/src/sdk/cline-session-factory.ts :: buildSessionConfig()  (line 1097)
                          (reached via apps/vscode/src/sdk/sdk-session-config-builder.ts :: SdkSessionConfigBuilder.build()  (line 37)
                           and apps/vscode/src/sdk/sdk-task-start-coordinator.ts :: SdkTaskStartCoordinator.initTask()  (line 243))
CONFIG_CONSUMER:          sdk/packages/core/src/runtime/host/local-runtime-host.ts :: LocalRuntimeHost.startSession()/startResolvedSession()
                          -> configWithProvider = bootstrap.config  (line 1001) -> adjudication seam (lines 1078-1320)
TASK_AUTHORITY_SOURCE:    apps/vscode/src/sdk/sdk-task-start-coordinator.ts :: SdkTaskStartCoordinator.initTask()
                          -> SessionConfigInput (prompt/images/files/historyItem/taskSettings/cwd/mode)
                          -> SessionConfigInput.taskSettings: Partial<Settings>
WORKSPACE_IDENTITY_SOURCE: buildSessionConfig's `cwd` / `workspaceRoot` (from initTask's getWorkspaceRoot())
                          -> CoreSessionConfig.cwd / .workspaceRoot
SECRET_STORAGE_OWNER:     apps/vscode/src/core/storage/StateManager.ts  (file-backed secrets.json, mode 0o600)
                          (StateManager.get().getSecretKey / setSecret)
REVISION_RESOLVER_OWNER:  NOT YET WIRED. The existing git helpers live in
                          apps/vscode/src/utils/git.ts (getLatestGitCommitHash, getGitRemoteUrls) and
                          apps/vscode/src/sdk/git-telemetry.ts (rev-parse HEAD). A VS Code adapter must
                          be built on these; no second Git abstraction is required.
ACTIVATION_STATE:         NOT_SUPPLIED
```

**The production path IS established, so `HALT_WRONG_PRODUCTION_SEAM` does NOT apply.**
The missing-wiring defect is CONFIRMED and located precisely: the VS Code producer
(`buildSessionConfig`) never supplies `config.adjudication`, so the SDK consumer
never activates the contract.
