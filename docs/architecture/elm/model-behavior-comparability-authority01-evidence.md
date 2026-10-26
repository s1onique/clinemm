# ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 — Source-Bound Evidence

**Status:** `PASS_STRUCTURAL_ONLY`
**Reviewed source:** `dca6e08d58e8691f0a5ffc703f3a646b15e410bf` (+ this ACT's diff)
**Priority:** P0 evidence correctness
**Scope:** native A/B measurement authority — effective-configuration capture,
source/build identity binding, and identity-verified run scoping.

---

## 1. Objective (as built)

Make genuine ClineMM-generated M3/M3.1 traces capable of **proving**
configuration comparability when the actual runtime configurations permit it —
while preserving the fail-closed comparator.

The predecessor (`ACT-CLINEMM-MODEL-BEHAVIOR-LIVE-PREFLIGHT01`) proved that
seven of eight material configuration dimensions were unverified, because the
native capture did not record the facts the runtime genuinely knows.

This ACT repairs the **measurement authority**, not the comparator's
conservatism:

* the **effective** configuration is now captured at the boundary where the
  values actually govern execution,
* the **installed bundle identity** is now bound to the trace,
* configuration is now correlated to a **real session / run identity**,
* and the comparator's run scoping is now **identity-verified** instead of
  timestamp-proximity based.

**Nothing was changed** in: model requests, prompts, tool execution,
compaction policy, lifecycle authority, loop-detector behavior, or React.
Every capture site remains a fire-and-forget, failure-isolated observation.

---

## 2. R0 — The authoritative-value mapping

`field → authoritative source → capture boundary → correlation identity`

| Field | Authoritative source | Capture boundary | Correlation identity |
|---|---|---|---|
| Tool count / names | `AgentRuntime` effective model request (`request.tools`) — **not** the build-time config | `AgentRuntime.generateAssistantMessage`, AFTER `prepareTurnForModelRequest` and the `beforeModel` hooks (`agent-runtime.ts`) | Real `sessionId` + `runId` (`AgentRuntimeConfig.sessionId` + live run state) |
| Reasoning effort | Effective provider request configuration (`request.options.reasoningEffort`), sourced from `buildModelOptions()` | same effective model-request boundary | Real `sessionId` + `runId` |
| Thinking enabled | Effective provider request configuration (`request.options.thinking`) | same effective model-request boundary | Real `sessionId` + `runId` |
| Max output tokens | Resolved model/request output limit (`request.options.maxTokensPerTurn`) | same effective model-request boundary | Real `sessionId` + `runId` |
| Context input budget | Actual compaction/model resolver (`resolveModelBehaviorTraceBudget`, mirroring `resolveEffectiveMaxInputTokens` → `applyUserContextCeiling` → `DEFAULT_MAX_INPUT_TOKENS`) | `createContextCompactionPrepareTurn` (`compaction.ts`) → `onCompactionDiagnostics`; build-time value via the same resolver in `buildSessionConfig()` | Session (build-time) / session + run (compaction diagnostics) |
| User ceiling | Explicit value or **verified Auto** operating mode (`normalizeUserContextCeiling` → `undefined` ⇒ Auto) | `buildSessionConfig()` (mode recorded as `userContextCeilingMode`) + compaction diagnostics | Session (build-time) |
| Model identity — selected | Persisted API configuration (`resolveModelId` / `resolveCommittedRuntimeModel`) | `buildSessionConfig()` | Session (after binding) |
| Model identity — SDK-resolved | The SDK provider/model the session actually resolved to (`sdkProviderId`, `modelId`) | `buildSessionConfig()` | Session (after binding) |
| Model identity — provider-confirmed | Only when the provider actually exposed one | never inferred | — (unavailable in the native path) |
| Extension identity — artifact | **Actual installed `dist/extension.js` bytes**, SHA-256 (`resolveInstalledBundleIdentity()`) | `buildSessionConfig()` | Session (after binding) |
| Extension identity — version | `ExtensionRegistryInfo.version` | `buildSessionConfig()` | Session (after binding) |
| Extension identity — source | Working-tree `git rev-parse HEAD` (**informational only**) | `buildSessionConfig()` — recorded as `undefined` when unknown | Session (after binding) |

### Why the effective boundary is *after* the hooks

`AgentRuntime` applies `prepareTurnForModelRequest()` and then the
`beforeModel` hooks **before** the provider stream opens, and both can rewrite
`request.tools` and `request.options`. Observing the pre-hook request would
report a toolset / reasoning policy the provider never received. The capture
therefore sits immediately before the provider stream opens — the real
request boundary.

---

## 3. R1 — RED witnesses (executable reproductions)

All witnesses live in
`apps/vscode/src/sdk/__tests__/model-behavior-comparability-authority01.test.ts`
and drive the **real** production seams: the real `AgentRuntime`
(`@cline/agents`), the real extension-host runtime, and the real comparator
script driven as a subprocess. No duplicate capture or comparator
implementation is used.

| # | RED | Witness | Gate |
|---|---|---|---|
| 1 | Native configuration missing required material fields | `G1` — a build-time config with `toolCount`/`toolNames` unavailable is reported `unverified`, never `equal` | G1 / G7 |
| 2 | `model_config` without session identity | `G2b` — the production runtime records a session-less snapshot, then `bindModelBehaviorTraceConfigToSession()` binds it to the allocated session id | G2 |
| 3 | Selected run retaining another session's unscoped configuration | `G6b` — two sessions in one recorder; the selected run inherits only its own session's configuration | G6 |
| 4 | Two unavailable values treated as equivalent (existing CORR01 regression) | `G7` — two equally-unknown reasoning efforts stay `unverified` | G7 |
| 5 | Unknown installed-source identity with no verified bundle binding | `G3b` — unknown source provenance **and** no artifact-identity proof ⇒ `unverified`, comparison refused | G3 |

**G6c is a mutation-verified RED**: reverting the comparator's
`scopeRecords` to the previous unconditional `runId === undefined` inclusion
rule makes G6c fail (an orphan record with no identity is attached to the
selected run). The fix was restored and the witness passes.

---

## 4. R2 — Source / build identity

`resolveInstalledBundleIdentity()` (already the canonical resolver used by
the allocation profiler runtime) is **reused as-is** by `buildSessionConfig()`
and by the live preflight driver.

The recorded facts are deliberately separate:

* `extensionBundleSha256` — the SHA-256 of the **actual installed
  `dist/extension.js` bytes**. This is the *artifact* identity.
* `extensionVersion` — `ExtensionRegistryInfo.version`. The *other half* of
  the build binding: a digest alone does not say which release produced it.
* `sourceHead` — the working-tree `git rev-parse HEAD`. **Informational
  only.** When it is `"unknown"` (the normal case for an installed VSIX) it
  is recorded as *unavailable*, never as a verified source identity.

The comparator's source/build parity verdict
(`assessSourceBuildParity`) applies exactly these rules:

1. Different **known** bundle digests ⇒ **incompatible** (the bytes differed,
   whatever the source provenance says).
2. Equal **known** source heads ⇒ equal.
3. Different **known** source heads ⇒ **incompatible**.
4. Equal **known** bundle digests **and** equal extension versions ⇒ a
   **verified equivalent artifact-identity proof** — the two traces ran the
   same bytes of the same release. This settles source/build parity even when
   the source provenance is unknown.
5. Otherwise ⇒ **unverified**. Unknown source provenance is *never* turned
   into a match, and comparability stays inconclusive.

---

## 5. R3 — Effective configuration

| Dimension | Where it is captured | Unknown-value rule |
|---|---|---|
| Tool count / names | effective model request | an absent toolset is `UNAVAILABLE_FROM_TRACE`, never `[]`-as-equal |
| Reasoning effort / thinking | effective provider request configuration | an omitted provider setting is **not** proof of a provider default — it stays unverified |
| Max output tokens | effective request output limit | an omitted output limit is not a known number |
| Context input budget | production compaction/model resolver | provenance (`inputBudgetSource`) is recorded alongside the number |
| User ceiling | explicit value or **verified Auto** mode | `undefined` ⇒ Auto, but only when the policy resolver confirms the mode |
| Model identity | selected and SDK-resolved identities kept **distinct** | provider-confirmed identity is never inferred |

**Material configuration changes within one run are represented, not
collapsed.** The build-time snapshot and the effective snapshot are separate
events, and the comparator layers the effective snapshot over the build-time
snapshot per run — so a toolset or reasoning change mid-run is visible as a
changed effective snapshot rather than being silently absorbed into the
first snapshot.

**M3 vs M3.1 reasoning is not forced equal.** If the two sides' effective
reasoning policies differ, the comparator reports `incompatible` and keeps
the descriptive measurements.

---

## 6. R4 — Correlation and scoping

### Capture-time identity

The build-time configuration is constructed **before** the session id exists:
`buildSessionConfig()` runs first, and the task-start coordinator allocates
the session id afterwards (`sdk-task-start-coordinator.ts`). The build-time
snapshot therefore carries **no** session identity.

The snapshot is handed to the coordinator through the
`onModelBehaviorConfigSnapshot` out-parameter and bound to the allocated
session id by `bindModelBehaviorTraceConfigToSession()`. The binding is made
by **the same authority that allocated the id** — an identity assertion, not
a timestamp-proximity guess.

The effective configuration snapshot is emitted by the `AgentRuntime` itself
and therefore carries the **real** session id and run id.

### Comparator scoping

The unconditional `record.runId === undefined` inclusion rule is **replaced**
by identity-verified inclusion:

* a record **with** a run id is included only when it is the selected run;
* a record **without** a run id is included only when it carries the session
  id that owns the selected run;
* a record with **no identity at all** is never included.

The owning session is derived from the records that actually carry the
selected run id — never from timestamps.

### Required properties

| Property | Witness |
|---|---|
| One session, one run — correct | `G6d` |
| One session, multiple runs — correct inheritance if unchanged | `G6a` (the other run's activity is excluded) |
| Two sessions, one shared recorder — no contamination | `G6b` |
| Session configuration changes — the snapshot belongs to the correct subsequent run | `G6a` + `G6b` (the effective snapshot is selected per run) |
| Unknown identity — unverified, never attached by timestamp proximity | `G6c` (mutation-verified RED) |

The `--m3-run` / `--m3.1-run` interface is unchanged.

---

## 7. R5 — Comparison conservation

The following properties are preserved (each has an executable witness):

* Unknown values are never equal by assumption — `G7`.
* Truncated traces cannot support exhaustive repetition comparison — the
  existing `truncated_capture` refusal is unchanged.
* Different verified builds remain incompatible — `G3`.
* Different effective toolsets remain incompatible — the `toolCount` /
  `toolNames` material dimensions are unchanged and now carry the *effective*
  values.
* Unverified reasoning policy remains inconclusive — `G7` / `G7b`.
* Accepted executable gates remain `UNAVAILABLE_FROM_TRACE` — the existing
  `C06` witness is unchanged.
* Repetition statistics remain heuristics — unchanged.
* Tool-call fingerprints remain privacy-preserving — unchanged.

A fully identified controlled pair achieves `compatible: true` **only** when
all required parity checks pass (`G8`).

---

## 8. R6 — Verification

| Gate | Acceptance | Result |
|---|---|---|
| G1 | Missing-field RED reproduced | ✅ `G1` |
| G2 | Real session/config identity correlated | ✅ `G2`, `G2b` |
| G3 | Installed bundle identity bound | ✅ `G3`, `G3b`, `G3c`, `G3d` |
| G4 | Actual tool schema configuration captured | ✅ `G4`, `G4b` |
| G5 | Effective reasoning/budget provenance captured where observable | ✅ `G5`, `G5b` |
| G6 | Mixed-session run-scoping tests pass | ✅ `G6a`–`G6d` |
| G7 | Unknown configuration still fails closed | ✅ `G7`, `G7b` |
| G8 | Known compatible pair can pass | ✅ `G8` |
| G9 | Trace OFF preserves execution behavior | ✅ `G9` |
| G10 | Existing recorder/comparator tests pass | ✅ 14 comparator + 10 runtime + 78 session-factory + 7 command-registration + 21 task-start-coordinator = **149 passed** |
| G11 | SDK build, TypeScript and Biome pass | ✅ `bun run build:sdk` clean; `apps/vscode` `tsc --noEmit` clean; Biome clean on every changed file (the 3 SDK lint findings and the `core/src/index.ts` organize-imports finding are **pre-existing** — verified identical with this ACT's changes stashed) |
| G12 | Exact-head artifacts and clean ACT-owned diff | ✅ `git diff --check` clean; the diff touches only the production seams, the comparator, the witnesses and the evidence |

### Additional regression checks

| Suite | Result |
|---|---|
| `sdk/packages/shared` `src/runtime` | 50 passed |
| `sdk/packages/agents` `agent-runtime.model-behavior-trace.test.ts` | 9 passed |
| `sdk/packages/core` `observability/model-behavior-trace.test.ts` | 10 passed |
| `sdk/packages/core` `extensions/context/compaction.test.ts` | 94 passed |
| `sdk/packages/core` `orchestration/session-runtime.model-behavior-trace.test.ts` | 5 passed |

**Pre-existing failures (verified identical with this ACT's changes stashed):**
`@cline/agents` 16 test files fail to load with
`TypeError: undefined is not an object (evaluating 'z.object')` — the known
zod-schema issue recorded by the predecessor ACT. The same failure occurs on
a clean tree.

**Environment note:** the sandbox denies `kill(2)` on vitest worker
processes (`EPERM`), so a large parallel vitest invocation crashes the pool
after the tests have already passed. The suites above were run per-file.

---

## 9. Live qualification

| Disposition | Status |
|---|---|
| `PASS_STRUCTURAL_ONLY` | ✅ the executable gates above |
| `PASS_LIVE_SDK` | ⏳ requires an OpenRouter credential in the qualification environment |
| `PASS_LIVE_VSIX` | ⛔ **not qualified** — the installed-VSIX Command Palette recorder could not be exercised in this environment (the extension host is not operable here). |

The SDK-level and installed-VSIX qualifications are kept **distinct**:
SDK-level evidence is never promoted to installed-VSIX evidence.

The live preflight driver (`apps/vscode/src/dev/preflight/live-preflight-model-behavior-trace.ts`)
was updated to use the corrected production capture wiring: it now records the
real installed-bundle identity and the effective-configuration channel.

---

## 10. Scope

* No new tracing framework.
* No new provenance subsystem — the session binding is a single function on
  the existing recorder.
* No worktrees, protected-stash operations, or new architecture.
* No changes to model behavior, compaction policy, loop detection, tool
  execution, lifecycle authority, or React.
