# 16 — Local Architecture Invariants

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** derive from evidence in §1–§15. Do not invent.
**Evidence label:** STRUCTURAL + EXECUTED (where existing tests prove an invariant)

---

## Inventory

| # | Invariant | Evidence label | Strength |
|---:|---|---|---|
| 1 | The package dependency graph is acyclic and one-way (shared → llms → agents → core → sdk → hosts) | STRUCTURAL | Observed; zero cycles, zero reverse-layer edges in 37 edges |
| 2 | Every `*coordinator.ts` in the host adapter is constructed exactly once in `SdkController.ts` and takes a single `*Options` object | STRUCTURAL | Read all 15 coordinator files |
| 3 | `CommandJobManager` is the **only** host-side lifecycle owner of subprocess supervision; no other coordinator owns a subprocess | STRUCTURAL | Read all 15 coordinator files; only `CommandJobManager` integrates sandbox |
| 4 | `SdkController.ts` is the **only** composition root in `apps/vscode/src/sdk/`; every coordinator + bridge + capture is wired through it | STRUCTURAL | Read constructor code |
| 5 | The canonical `TaskState` lives in `@cline/agents`; the host shadow is a drift-detector, not a parallel authority | EXECUTED | The whole `task-state-shadow-*` cluster is structured around `TaskShadowComparator` producing `TaskShadowDivergence` records |
| 6 | Path authority has two distinct implementations with explicit precision differences (realpath vs lexical); they are NOT redundant | STRUCTURAL | `editor-path-authority.ts:23-27` documents realpath; `path-authority.ts:8-13` explicitly says "V1 SCOPE: LEXICAL_WORKSPACE_CONTAINMENT only" |
| 7 | The fork's working-context carrier has a documented *assignment* contract: `UNDEFINED_W_STALE_REUSE = FORBIDDEN` (always overwrite, including `undefined` → `null`) | EXECUTED | `working-context-host-capture.ts:174-181` documents this; tests at `sdk-compaction-coordinator.legacy-turnstate-coherence.*` exercise the rule |
| 8 | All command-tool approval flows go through the typed `CommandHostAuthorization` envelope; the legacy `isToolAutoApproved` boolean is documented as "must not be used for command tools" | STRUCTURAL | `sdk-tool-policies.ts:1063-1066` |
| 9 | The fork's `temporaryExternalCanonicalRoots` parameter is bound to a fresh-read for every approval evaluation (no caching across calls) | EXECUTED | `ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03` + CORRECTION05 close the fresh-read threading |
| 10 | Settings keys declared in the host shared layer (`apps/vscode/src/shared/storage/state-keys.ts`) are mirrored from `@cline/core` `chat-schema.ts`; the host keeps the webview projection, the core keeps the canonical | STRUCTURAL | Read both files |
| 11 | The `SessionAutoApprovalOverride` is transient (not persisted); it has explicit `clearActiveOverride()` vs `clearPendingArm()` semantics to support `clearTask`/`cancelTask` | STRUCTURAL | `session-auto-approval.ts:26-35, 80-81, 366-370` |
| 12 | The fork's `TaskShadowCoordinator` is the **only** observation funnel for state-mutating ingresses into the TaskState shadow (RUNTIME_CANONICAL / RUNTIME_RECONSTRUCTED / HOST_TASK / HOST_RECOVERY) | STRUCTURAL | `task-state-shadow-coordinator.ts:11-21` documents the contract |
| 13 | The fork's `cline-session-factory.ts` is a transitional bridge: it reads canonical from `ProviderSettingsManager` (`@cline/core`) but falls back to legacy `ApiConfiguration` fields | STRUCTURAL | `cline-session-factory.ts:526, 559, 682, 704` all have explicit "legacy fallback" comments |
| 14 | The fork's editor / apply_patch approval path uses `realpath` for canonicalization to defeat symlink-escape attacks; the command-policy path uses lexical containment (V1) | STRUCTURAL | `editor-path-authority.ts:23-27` vs `path-authority.ts:8-13` |
| 15 | The fork's `turnState` field on `ExtensionState` is *legacy* and retained for non-thinking consumers; `ThinkingPresentationProjection` is the partial migration target | STRUCTURAL | `ExtensionMessage.ts:155-237` documents the deferred migration explicitly |

## Invariants F0 explicitly does NOT claim

- "Working-context has one writer" — this is **NOT** an invariant today (the `setLatest` bypass exists). It is a *desired invariant* that the recommended ACT would establish.
- "Path authority has one canonical" — also NOT an invariant. The two implementations are intentional but their *policies* (lexical vs realpath) are distinct.
- "Settings mutations flow only through `@cline/core`" — NOT an invariant in this fork. The host shared layer has its own settings surface.

