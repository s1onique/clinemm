# 08 — Semantic Duplication

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** search for shared semantic concepts and inspect implementations.
**Evidence label:** STRUCTURAL + MANUAL_INSPECTION

---

## A. Path authority (commands vs editor)

| Field | `editor-path-authority.ts` (host) | `command-policy/path-authority.ts` (core) |
|---|---|---|
| LOC | 351 | 708 |
| Layer | `apps/vscode/src/sdk/` | `sdk/packages/core/src/runtime/command-policy/` |
| Canonicalization | `fs.realpathSync` (sync, full canonical) | `path.resolve` (lexical only, V1 scope) |
| Output enum | `"inside" \| "outside" \| "unavailable"` | `conforming: boolean + reason` |
| Failure semantics | Fail-closed: realpath failure → `"unavailable"` | Fail-closed: lexical-conformance failure → ASK |
| Used by | `SdkDiffEditCoordinator` (editor / apply_patch) | `CommandPolicy.evaluate(...)` |
| Fork-only? | YES | YES |

**Classification:** `DOMAIN-SPECIFIC_VARIANT` — NOT a TRUE_DUPLICATION.

**Reasoning:** Per `path-authority.ts:8-13` ("V1 SCOPE: LEXICAL_WORKSPACE_CONTAINMENT only. We do not use realpath at the policy layer"), the core policy is intentionally lexical to be pure/deterministic. The editor path-authority uses realpath to defeat symlink-escape attacks. These are *different* security primitives with different threat models. Per ACT §23: "shared canonical-path observation primitive = useful; shared policy = WRONG".

**However:** the two implementations both compute "is X inside workspace?" with different precision. If a future ACT wants to add realpath to the command-policy path authority, it would close the symlink-escape gap that the editor ACT specifically closed for editor / apply_patch. That's a known follow-up — `path-authority.ts` says "A symlink inside the project that points outside it lexically passes containment; the structural fix is a follow-up ACT (REALPATH_WORKSPACE_CONFINEMENT)".

## B. Auto-approval chain

| Field | `isToolAutoApproved` (host) | `getCommandHostAuthorization` (host) | `readToolAutoApproveGlobally` (core) |
|---|---|---|---|
| Layer | `apps/vscode/src/sdk/sdk-tool-policies.ts:1072` | `apps/vscode/src/sdk/sdk-tool-policies.ts:360` | `sdk/packages/core/src/services/global-settings.ts` |
| Scope | Generic tools (read/edit/browser/MCP) | Command tools only (typed envelope) | Global settings reader |
| Returns | `boolean` | `CommandHostAuthorization` (typed object with `mode`, `pathAuthorityEvidence`, etc.) | `boolean \| undefined` |

**Classification:** `DOMAIN-SPECIFIC_VARIANT` — different precision.

`isToolAutoApproved` is explicitly documented (line 1065) as "Kept for backwards compatibility with existing UI logic" and "MUST NOT be used for command tools. Command tools require the typed `CommandHostAuthorization` flow". So the fork has *already* migrated command tools to a typed flow; `isToolAutoApproved` is a compatibility wrapper.

The precedence chain (per `SdkController.ts:455-475`):
```
getCommandHostAuthorization -> SessionAutoApprovalOverride -> SeatbeltAuthorityEnvelope -> approve/ask
```

is explicit and documented. **NOT a duplication** — but a layered chain with documented precedence.

## C. Tool policy / auto-approve surface

- `apps/vscode/src/shared/AutoApprovalSettings.ts` — host-side storage schema
- `sdk/packages/core/src/types/chat-schema.ts:autoApproveTools` — core schema
- `sdk/packages/core/src/services/global-settings.ts` — core global settings reader/writer

The host keeps the schema that ships to the webview; the core has its own canonical schema and reader. The host **also reads** from core's `readGlobalSettings()`. This is a **two-schema duplication** with bridge between them. Per `global-settings.ts` comments, `toolAutoApprove` is the canonical in the core; the host's `AutoApprovalSettings` (which contains `actions.*` and many sub-fields) is a richer shape.

**Classification:** `DOMAIN-SPECIFIC_VARIANT` — the host schema is a richer, webview-shaped projection of the core's simpler global setting. They are not interchangeable.

## D. Path extraction (multiple sites)

- `path-authority.ts` extracts command operands
- `editor-path-authority.ts` extracts editor targets
- `apply_patch` is invoked separately in `SdkDiffEditCoordinator` (per ACT §23)

Per ACT §23's conclusion: "shared policy = WRONG; shared canonical-path observation primitive = useful". F0 records that these are three distinct extractions and explicitly **does NOT recommend deduplication**.

## E. Workspace root resolution

- `apps/vscode/src/sdk/workspace-root.ts:resolveWorkspaceRootPath` (27 LOC)
- `apps/vscode/src/sdk/workspace-root.ts:resolveWorkspaceManagerPaths` (helper)
- `SdkController.getWorkspaceRoot()` (private method)
- `apps/vscode/src/shared/storage/state-keys.ts` does not store workspace

**Classification:** single canonical resolution path (the `workspace-root.ts` helpers + `SdkController.getWorkspaceRoot()`), with two helper functions. Not a duplication.

## F. Compaction state → webview (W projection)

- `WorkingContextHostCapture` (host, fork-only) — caches W from runtime events
- `sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts` (core, fork-modified) — tests the ratio
- `getStateToPostToWebview()` (host, fork-modified) — publishes W to webview

**Classification:** PROJECTION chain. Single canonical at runtime, two-step projection: runtime → `WorkingContextHostCapture` → `ExtensionState.currentWorkingContextEstimate` → webview. The first step has the dual-writer SHADOW problem noted in §6.

## G. `working-context-state-changed` handling

Only one consumer (`WorkingContextHostCapture.observe`). NOT duplicated.

## H. Recovery policy

- `sdk/packages/agents/src/runtime/recovery/policy.ts` — `RecoveryPolicy` (fork-only)
- `sdk/packages/agents/src/runtime/recovery/index.ts` — `RecoveryPolicyConfig`

Both fork-only. No upstream analogue. **NOT a duplication.**

## I. Task state shadow vs canonical `TaskState`

- `@cline/agents` `TaskState` — canonical
- `TaskStateShadow` (fork-only) — host-side parallel structure with explicit drift detection

**Classification:** intentional SHADOW. By-design. NOT a duplication.

## J. `cline-session-factory.ts` (1,238 LOC) — the largest duplication risk

This file contains:
- `resolveApiKey(providerId, config)` — provider-by-provider API key resolution
- `resolveModelId(providerId, mode, config)` — provider-by-provider model ID resolution with `legacyField` fallback
- `resolveBaseUrl(providerId, config)` — provider-by-provider base URL resolution
- `resolveOpenAiCompatibleMaxTokens(config, mode)` — token limits
- `resolveCommittedRuntimeModel(...)` — runtime model resolution
- `resolveOllamaProviderConfig(config, modelId)` — Ollama-specific resolution

The pattern: per-provider fallback to legacy `ApiConfiguration` fields (`planModeSapAiCoreModelId` / `actModeSapAiCoreModelId` etc.).

**Classification:** `DOMAIN-SPECIFIC_VARIANT` against the SDK's `providerSettingsManager`. The SDK already has a `providers.json` schema. This file is the **legacy fallback bridge** for provider/model/key resolution. Per §7, this is an ACTIVE_MIGRATION bridge — the canonical is in the SDK, the legacy is preserved as fallback.

## Summary

The fork has **deliberately minimized true semantic duplication** by routing different policies through different paths. The two path-authority implementations look like a duplication but are domain-specific variants with different precision and threat models (per their header comments).

The biggest **structural risk** is `cline-session-factory.ts` — not because it duplicates logic, but because it is the **legacy-fallback bridge** for provider/model/key resolution. The SDK has its own canonical, and the host keeps a parallel resolver that falls back to legacy `ApiConfiguration` fields. As more providers move to the SDK's `providers.json`, the fallbacks become dead code, but they are still wired.

