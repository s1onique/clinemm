# 14 — Package Boundary Diff

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** for each suspicious item, ask "would upstream place this in shared/llms/agents/core/host?".
**Evidence label:** STRUCTURAL + EXTERNAL_REFERENCE (upstream `sdk/ARCHITECTURE.md`)

---

## Reference model (upstream)

```
@cline/shared    — low-level reusable contracts/utilities
@cline/llms      — model/provider schemas, catalogs, handler creation
@cline/agents    — stateless agent runtime loop and tool orchestration
@cline/core      — stateful orchestration, sessions, persistence, runtime composition, config/settings, compaction
host apps        — UI / host lifecycle / host-specific approval surfaces
```

Key rules:
- **Provider-specific behavior → `@cline/llms`**
- **Stateful orchestration / settings mutations → `@cline/core` services**
- **Stateless runtime loop + tool orchestration → `@cline/agents`**
- **Host-specific approvals → host apps**
- **`@cline/agents` must not own:** session persistence, provider settings storage, RPC lifecycle, host-specific approvals

## Suspect items

### 1. Host adapter layer (`apps/vscode/src/sdk/`)

**Upstream placement:** Should not exist as a distinct layer. Host apps normally compose against `@cline/core`/`@cline/sdk`.

**Cline-- reality:** 250 files of host-side adapter code that wraps `@cline/core` / `@cline/agents` and adds fork-specific transport/state-projection logic.

**Classification:** `INTENTIONAL_FORK_EXTENSION`. The fork chose to add an explicit SDK-adapter layer to centralize the host↔SDK wiring. This is documented in upstream's recent migration towards an SDK model. Not a violation, but a *fork-specific extension* of the boundary.

### 2. `clinemm` → `@cline/agents` direct dependency

**Upstream placement:** Hosts compose against `@cline/core` (which re-exports the public agents surface). Direct host→agents access is a smell.

**Cline-- reality:** `apps/vscode` has `@cline/agents` in its `dependencies`.

**Classification:** `BOUNDARY_VIOLATION_CANDIDATE`. Either the host legitimately uses types from `@cline/agents` (e.g. `TaskState`, `AgentRuntimeEvent`) that `@cline/core` doesn't re-export, or the host could be tightened to compose only against `@cline/core` + `@cline/sdk`. Requires source inspection to resolve.

### 3. `cline-hub-webview` → `@cline/ui`

**Upstream placement:** A host-app webview should compose against `@cline/shared` (low-level contracts) and not against `@cline/ui` if `@cline/ui` is meant to be host-agnostic and shared.

**Cline-- reality:** `apps/cline-hub/src/webview` imports `@cline/ui`.

**Classification:** `BOUNDARY_VIOLATION_CANDIDATE`. Depends on whether `@cline/ui` is genuinely host-agnostic (in which case the import is fine) or VS-Code-aware (in which case it shouldn't be shared across hosts).

### 4. `cline-core` and `vscode` packages inside `apps/vscode/standalone/runtime-files/`

**Upstream placement:** Standalone runtime files are normally bundled into a single CLI binary, not as separate packages with their own `package.json`.

**Cline-- reality:** Two nested `package.json` files at `apps/vscode/standalone/runtime-files/cline-core` and `.../vscode`, with `private: false`, `publishable: false`, source LOC ~1,520 combined. These appear to be **stubs** for bundled standalone artifacts.

**Classification:** `LEGACY_LAYOUT`. Likely artifacts of an older packaging approach. No production code under them. Should be folded into the esbuild script or removed.

### 5. Fork-only command-policy subsystem (`sdk/packages/core/src/runtime/command-policy/`)

**Upstream placement:** Per `command-policy-types.ts`, "The host delegates ALLOW". So command policy belongs in `@cline/core` (stateful orchestration). Per upstream rule "settings mutation belongs in core services, not host-specific file writes", command policy lives correctly in `@cline/core`.

**Cline-- reality:** The whole `command-policy/` subsystem (12+ files, ~3,000 LOC) is fork-only inside `@cline/core/src/runtime/command-policy/`.

**Classification:** `FORK_REQUIREMENT`. The fork needed a structured command policy because it has security primitives (path authority, seatbelt, sandbox) that upstream does not have. This is correctly placed in `@cline/core`, not `@cline/llms` (it is not provider-specific).

### 6. `runtime/sandbox/macos/` (seatbelt, ssh-agent authority)

**Upstream placement:** Per upstream ARCHITECTURE.md, sandbox/seatbelt is host-app territory (host-specific approval surfaces). Putting it in `@cline/core` is a boundary risk.

**Cline-- reality:** `sdk/packages/core/src/runtime/sandbox/macos/` (seatbelt-backend.ts, ssh-agent authority) lives inside `@cline/core`. The host (`CommandJobManager`) consumes it.

**Classification:** `BOUNDARY_VIOLATION_CANDIDATE`. The fork has *some* sandbox logic in `@cline/core` (cross-platform abstractions, evidence builders) and *some* in the host (`apps/vscode/src/sdk/command-job-manager.ts`, `sandbox-policy.ts`). The boundary is fuzzy. The factory's recent seatbelt ACTs (`ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01`, `CORRECTION02`) suggest this boundary has been a friction point.

### 7. The shadow system (20 files in `apps/vscode/src/sdk/task-state-shadow-*` + `apps/vscode/src/sdk/host-ownership-capture/`)

**Upstream placement:** Should be either in `@cline/core` (stateful orchestration) or removed.

**Cline-- reality:** All in `apps/vscode/src/sdk/`. Drift-detection is host-only because it detects *host* divergence from canonical.

**Classification:** `FORK_REQUIREMENT`. The shadow is *not* provider-specific and not a webview concern. Its placement in the host adapter is OK because it is host-bridge-shaped. But if upstream ever adopts a similar pattern, the shadow cluster could move to `@cline/core` cleanly.

### 8. `cline-session-factory.ts` (1,238 LOC)

**Upstream placement:** A provider/model/key resolution layer like this would belong in `@cline/llms` (provider schemas) or `@cline/core` (settings orchestration).

**Cline-- reality:** Lives in the host adapter. Falls back to legacy `ApiConfiguration` fields.

**Classification:** `ACTIVE_MIGRATION` bridge (per §7). The migration target is the SDK's `providers.json` (managed by `ProviderSettingsManager` in `@cline/core`). Once migration completes, this host-side fallback bridge should become deletable, OR the canonical should move up into `@cline/core`.

### 9. `apps/vscode/src/shared/storage/state-keys.ts` (88 planMode/actMode keys)

**Upstream placement:** Settings keys belong in `@cline/core` (per upstream rule "settings mutation belongs in core services").

**Cline-- reality:** 88 planMode/actMode setting keys are declared in the **host** layer (`apps/vscode/src/shared/storage/state-keys.ts`). The host then translates these into `@cline/core` via `readToolAutoApproveGlobally()` etc.

**Classification:** `BOUNDARY_VIOLATION_CANDIDATE`. Per upstream, the canonical settings shape lives in `@cline/core`. The host keeps its own mirror schema. This is structurally a fork-specific decision but creates a Model Profiles prerequisite problem (see §28).

## Net assessment

The fork's package boundaries are mostly clean. There are **three BOUNDARY_VIOLATION_CANDIDATEs**:

1. **Host → `@cline/agents` direct dependency.** Resolvable by tightening the dependency to `@cline/core`/`@cline/sdk`.
2. **Sandbox/seatbelt logic split** between `@cline/core` and host. Resolvable by deciding which layer owns the canonical sandbox abstraction.
3. **Settings keys in host shared** that mirror core schema. This is the **Model Profiles precondition risk**: if Model Profiles wants to extend the settings shape, it has to coordinate across two layers.

There are also **two ACTIVE_MIGRATION bridges** (cline-session-factory.ts + provider-migration) that account for the largest amount of legacy-fallback code.

There are **two LEGACY_LAYOUT items**:
- The nested `cline-core` / `vscode` packages in `apps/vscode/standalone/runtime-files/`
- The `apps/vscode/.vscode-test/*` test fixture tree (excluded from F0 inventory, but visible in `find` output)

