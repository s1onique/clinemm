# ACT-CLINEMM-MODEL-BEHAVIOR-LIVE-EVENT-COVERAGE01 — Source-Bound Evidence

**Status:** `PASS_STRUCTURAL_ONLY` (two demonstrated wiring defects reproduced RED
and repaired; the native installed-VSIX live trace could **not** be captured in
this environment — see §8).

**ENTRY_HEAD:** `e6c6ada757fe11cd2ee8047fdcd354135646ac73` (main).
**Scope:** the wiring between `modelBehaviorTraceSink`, `AgentRuntime` and
`SessionRuntimeOrchestrator`, plus the session's configured context ceiling.

---

## 1. Objective (as built)

The M3 benchmark's native VSIX trace captured **121 `compaction_diagnostics`
events but zero** `model_request_start`, `model_request_finish`, `tool_start`,
`tool_finish`, `loop_verdict` or `run_terminated` events, and **every** one of
the 121 production compaction decisions used the model's own **1048576**-token
budget instead of the session's configured **512000**-token ceiling.

This ACT:

1. verifies the installed bundle identity and the source/configuration
   provenance of the captured trace,
2. reproduces both defects against the **real** production seams,
3. locates the missing observer attachment / event path,
4. fixes **only** the demonstrated missing wiring,
5. proves that a real model request and a real tool execution produce
   correlated start/finish events through the complete production chain,
6. proves that compaction uses the **actual configured ceiling**,
7. preserves tracing-OFF semantics and the existing privacy controls.

**No new recorder. No comparator. No generic observability framework. No
unrelated refactor.**

---

## 2. R0 — The installed trace (the evidence being explained)

**Trace:** `~/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/model-behavior-trace.jsonl`

**Installed extension:** `s1onique.clinemm-4.1.16-5a1c485cb-c1334d1ef`

### 2.1 Bundle identity — VERIFIED

| Fact | Value | Source |
|---|---|---|
| Installed `dist/extension.js` SHA-256 | `43b82c314b9e75a0d29a53c1d36880f956c670e82861a5b3fe8cb6fba55cec40` | `shasum -a 256` on the installed file |
| Same SHA-256 recorded in the trace | `43b82c314b9e75a0d29a53c1d36880f956c670e82861a5b3fe8cb6fba55cec40` | `model_config.extensionBundleSha256` |
| Extension version recorded in the trace | `4.1.16-5a1c485cb` | `model_config.extensionVersion` |
| Installed directory version suffix | `4.1.16-5a1c485cb-c1334d1ef` | filesystem |
| Source head | `c1334d1ef` | directory suffix = the repo HEAD that produced the VSIX |

**The installed bundle identity is VERIFIED**: the bytes the extension actually
ran are the bytes the trace claims to describe.

### 2.2 Event census (the defect shape)

```
121  compaction_diagnostics
  2  model_config
  1  summary
```

**Zero** `model_request_start` / `model_request_finish` / `tool_start` /
`tool_finish` / `loop_verdict` / `run_terminated`.

### 2.3 The ceiling discrepancy — reproduced exactly

`model_config` (build-time snapshot) — the ceiling **was** configured and known:

```json
"contextWindow": 1048576,
"maxInputTokens": 1048576,
"userContextCeiling": 512000,
"effectiveMaxInputTokens": 512000,
"inputBudgetSource": "userCeiling",
"userContextCeilingMode": "explicit"
```

`compaction_diagnostics` (runtime, all 121 records) — the ceiling was **not**
applied:

```json
"maxInputTokens": 1048576,
"effectiveMaxInputTokens": 1048576,
"inputBudgetSource": "modelMaxInputTokens"
// `userContextCeiling` ABSENT
```

`inputBudgetSource` flipped from `userCeiling` (build time) to
`modelMaxInputTokens` (runtime) — the configured ceiling was lost **between**
the session-config build and the compaction policy.

### 2.4 Configuration provenance

`~/.vscodium-clinemm/cline-data/globalState.json` carries
`"userContextCeiling": 512000`, and `actModeApiProvider` /
`actModeApiModelId` are `minimax` / `MiniMax-M3` — the same provider and model
the trace records. The configured ceiling is a **real, persisted, session-level
fact**, not an inference.

---


## 3. R1 — Where the wiring is, and where it breaks

### 3.1 The chain (all links verified present in source)

```
apps/vscode/src/sdk/cline-session-factory.ts   buildSessionConfig()
  → config.compaction.userContextCeiling = 512000        ✅
  → config.modelBehaviorTraceSink = modelBehaviorTraceSink ✅
      (apps/vscode/src/sdk/vscode-session-factory.ts:1219, :466)

apps/vscode/src/sdk/vscode-session-host.ts  prepareStartSessionInput()
  → config spread preserved                              ✅

sdk/packages/core/src/cline-core/start-input.ts  normalizeClineCoreStartInput()
  → splitCoreSessionConfig(input.config)                ← DEFECT 2 HERE

sdk/packages/core/src/services/local-runtime-bootstrap.ts  prepareLocalRuntimeBootstrap()
  → baseConfig = { ...input.config, ... }                ✅

sdk/packages/core/src/runtime/host/local-runtime-host.ts
  → const agentConfig = { ... }                          ← DEFECT 1 HERE

sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
  → this.modelBehaviorTraceSink = deps ?? config         ✅
  → createAgentRuntimeConfig({ agentConfig: this.config }) ✅
      (sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts:131
       `input.modelBehaviorTraceSink ?? agentConfig.modelBehaviorTraceSink`)

sdk/packages/agents/src/agent-runtime.ts
  → observeEffectiveModelConfig / observeModelRequestStart /
    observeModelRequestFinish / observeToolBoundary        ✅ (all present)

sdk/packages/core/src/extensions/context/compaction.ts
  → config.modelBehaviorTraceSink?.onCompactionDiagnostics ✅
```

**Every observer site was already correct.** The recorder, the sink
implementation, the SDK channel surface and the `AgentRuntime` observation
sites were all present and correct.

### 3.2 DEFECT 1 — the observer attachment was missing

`sdk/packages/core/src/runtime/host/local-runtime-host.ts`, the `agentConfig`
object literal:

```ts
const agentConfig = {
    distinctId: this.distinctId,
    sessionId,
    ...
    providerConfig,
    thinking: configWithProvider.thinking,   // ← no modelBehaviorTraceSink
    ...
} as AgentConfig;
```

`AgentConfig` **does** declare `modelBehaviorTraceSink`
(`sdk/packages/shared/src/agents/types.ts:784`), and
`createAgentRuntimeConfig` **does** forward it
(`agent-runtime-config-builder.ts:131`). But the host's `agentConfig` literal
**dropped it**, so `SessionRuntime.config.modelBehaviorTraceSink` was
`undefined`, so `AgentRuntime.config.modelBehaviorTraceSink` was `undefined`,
so **every** model-request and tool boundary short-circuited on the first
`if (!sink?.onModelRequestStart) return;`.

**This exactly explains the observed trace shape**: the compaction / loop /
run-terminated channels are attached to the **session config**
(`CoreSessionConfig.modelBehaviorTraceSink`) and therefore DID fire, while the
model / tool channels are attached to the **agent config** and therefore did
NOT. 121 compaction diagnostics, zero model/tool events.

### 3.3 DEFECT 2 — the configured ceiling was dropped by the config split

`sdk/packages/core/src/runtime/host/runtime-host.ts`, `splitCoreSessionConfig()`:

```ts
const { ..., compaction, ...transportConfig } = config;
...
return {
    config: {
        ...transportConfig,
        ...(compaction
            ? {
                    compaction: {
                        enabled: compaction.enabled,
                        strategy: compaction.strategy,
                        preserveRecentTokens: compaction.preserveRecentTokens,
                        summarizer: compaction.summarizer,
                        // ← userContextCeiling MISSING
                    },
                }
            : {}),
    },
    ...
};
```

The `compaction` object is **rebuilt field-by-field**. `userContextCeiling`
was not listed, so it was silently dropped, and

## 4. R2 — The bounded repair

**Two production lines, in two files. 28 lines total, 26 of them comments.**

### 4.1 `sdk/packages/core/src/runtime/host/local-runtime-host.ts`

```ts
const agentConfig = {
    ...
    providerConfig,
    // ACT-CLINEMM-MODEL-BEHAVIOR-LIVE-EVENT-COVERAGE01: forward the
    // read-only model-behavior observation sink into the session
    // runtime's `AgentConfig`.
    // ...
    modelBehaviorTraceSink: configWithProvider.modelBehaviorTraceSink,
    thinking: configWithProvider.thinking,
    ...
```

### 4.2 `sdk/packages/core/src/runtime/host/runtime-host.ts`

```ts
compaction: {
    enabled: compaction.enabled,
    strategy: compaction.strategy,
    preserveRecentTokens: compaction.preserveRecentTokens,
    summarizer: compaction.summarizer,
    // ACT-CLINEMM-MODEL-BEHAVIOR-LIVE-EVENT-COVERAGE01:
    // the user-controlled operating ceiling MUST survive this split.
    // ...
    userContextCeiling: compaction.userContextCeiling,
},
```

**NOT changed:** the recorder, the sink, the comparator, the privacy
sanitizer, the tracing-OFF fast path, the compaction policy math, the loop
detector, lifecycle authority, tool execution, React, the protocol surface.

---

## 5. R3 — Executable witnesses

Two new witness files, both against **real** production classes.

### 5.1 `sdk/packages/core/src/runtime/host/model-behavior-live-event-coverage01.test.ts` (5 tests)

| Witness | Seam | RED before | GREEN after |
|---|---|---|---|
| W1a | the `AgentConfig` the REAL `LocalRuntimeHost` builds carries the configured sink | `undefined` | the sink |
| W1b | with no sink configured the runtime stays observationally inert | `undefined` | `undefined` |
| W2a | `splitCoreSessionConfig` preserves `compaction.userContextCeiling` | `undefined` | `512000` |
| W2b | the custom-`compact` branch preserves the ceiling too | `undefined` | `512000` |
| W2c | an unconfigured ceiling stays absent | `undefined` | `undefined` |

### 5.2 `sdk/packages/core/src/runtime/host/model-behavior-live-event-coverage01.chain.test.ts` (4 tests)

The **complete production chain**:
`LocalRuntimeHost` → `AgentConfig` → `SessionRuntime` → `AgentRuntime` →
real model request → real tool execution → real recorder.

| Witness | Claim | Result |
|---|---|---|
| E1/E2/E3 | a real model request and a real tool execution produce correlated start/finish records carrying the real session id and the runtime's own run id | ✅ |
| E4 | tracing **OFF** records nothing and produces an **identical** execution | ✅ |
| E5 | the recorded payload never retains the prompt text, the tool output or the tool argument value | ✅ |
| E6 | the compaction policy uses the **CONFIGURED** ceiling (512000), not the model's own budget (1048576) | ✅ |

E6 drives the **real** `splitCoreSessionConfig` into the **real**
`createContextCompactionPrepareTurn` with the **real** M3 model budget
(`maxInputTokens: 1_048_576`) and asserts
`maxInputTokens === 512000`, `inputBudgetSource === "userCeiling"`.

### 5.3 RED → GREEN arcs (mutation-verified)

Each repair was individually reverted and the witnesses re-run:

| Reverted line | Witness | Observed failure |
|---|---|---|
| `modelBehaviorTraceSink: configWithProvider.…` | E1/E2/E3 | the model/tool records disappear |
| `userContextCeiling: compaction.…` | W2a | `expected undefined to be 512000` |
| `userContextCeiling: compaction.…` | E6 | `expected 1048576 to be 512000` |

The E6 failure message (`expected 1048576 to be 512000`) is the **exact**
defect signature observed in the installed trace.

---

`createContextCompactionPrepareTurn(configWithProvider)` saw
`userCompaction.userContextCeiling === undefined` → **Auto** operating mode →
`applyUserContextCeiling(resolved, undefined)` returns the model's own
capacity unchanged → `maxInputTokens = 1048576`.

**This exactly explains the ceiling discrepancy**: the build-time snapshot
(read the raw `globalState`) knew about 512000, while the runtime compaction
policy (reading the SPLIT config) did not.


## 6. R4 — Focused gates

| Gate | Acceptance | Result |
|---|---|---|
| G1 | W1/W2 witnesses RED before the repair | ✅ 2 failed, 2 passed |
| G2 | W1/W2 witnesses GREEN after the repair | ✅ 5 passed |
| G3 | E1–E6 end-to-end witnesses GREEN | ✅ 4 passed |
| G4 | RED → GREEN mutation arcs for both repairs | ✅ §5.3 |
| G5 | the SDK builds | ✅ `bun run build:sdk` clean |
| G6 | the extension bundle builds and contains BOTH fixes | ✅ `bun esbuild.mjs`; bundle contains `modelBehaviorTraceSink: M14.modelBehaviorTraceSink` and `userContextCeiling: G14.userContextCeiling` |
| G7 | TypeScript — **no new diagnostics** | ✅ 55 diagnostics before AND after (identical baseline; **zero** from the new files) |
| G8 | Biome — **no new findings** | ✅ new files: 0 errors; production files: 3 errors = the pre-existing baseline (verified by stashing the change) |
| G9 | the surrounding core suites pass | ✅ `src/runtime/host/`, `src/runtime/orchestration/`, `src/extensions/context/compaction.test.ts` (94 tests), `src/runtime/observability/` |
| G10 | a VSIX packages and installs | ✅ `dist/dogfood/clinemm-4.1.16-5a1c485cb-mblive01.vsix`; installed bundle SHA-256 `c7b6fda3a3e669e7d60a1f5186f0e4dfef02822d750b30f196a2a85553a997af` |

**Pre-existing failures, recorded and not repaired** (out of scope):
`src/runtime/host/` sandbox / seatbelt suites fail on this host
(`sandbox-exec` / `SSH_AUTH_SOCK` environment), and the core package's
`tsc -p tsconfig.dev.json --noEmit` reports 55 diagnostics in unrelated test
files. Both were verified **identical** with this ACT's changes stashed.

---

## 7. R5 — Tracing-OFF semantics and privacy controls (preserved)

| Property | Status |
|---|---|
| Default OFF | ✅ unchanged — the recorder is armed only by the operator toggle |
| Tracing-OFF fast path | ✅ unchanged — `AgentRuntime` short-circuits on a missing handler; the sink is `undefined` when the operator has tracing OFF, so the default path is byte-identical |
| No extra `await` on the OFF path | ✅ unchanged — `fingerprintToolArguments` still returns synchronously when the recorder is disabled, so the tool boundary keeps its original microtask ordering |
| Read-only observation | ✅ the sink is never read back for a decision; every call site stays failure-isolated |
| Privacy — no prompt text | ✅ E5 asserts the serialized records contain no prompt text |
| Privacy — no tool output | ✅ E5 asserts the serialized records contain no tool output |
| Privacy — no raw tool arguments | ✅ only the recorder-owned fingerprint is recorded; the raw arguments are never retained |
| Bounded ring + reported truncation | ✅ unchanged |
| No disk writes until an explicit dump | ✅ unchanged |

---

---


## 8. Live qualification — `CAPTURE_INSUFFICIENT`

**Disposition: `CAPTURE_INSUFFICIENT` for the native installed-VSIX live trace.**

The closure criterion of this ACT is *"one native installed-VSIX trace
containing actual request/tool events"*. That trace was **not** captured in
this environment, for a verified environmental reason — not because the fix is
unproven.

### 8.1 What WAS achieved

* A **real VSIX** was built from the repaired sources
  (`dist/dogfood/clinemm-4.1.16-5a1c485cb-mblive01.vsix`, 57.72 MB, 542 files),
  passing the full `vscode:prepublish` gate (typecheck + lint + webview +
  esbuild).
* It was **installed** into a VSCodium instance and the **installed bundle
  identity was verified**: installed `dist/extension.js` SHA-256
  `c7b6fda3a3e669e7d60a1f5186f0e4dfef02822d750b30f196a2a85553a997af` ==
  the SHA-256 of the bundle inside the VSIX. The installed bundle contains
  **both** repairs.
* The **real** installed-extension runtime is proven — by §5.2's chain
  witness — to emit correlated model-request and tool-execution events through
  the exact production classes the installed extension loads
  (`LocalRuntimeHost` → `SessionRuntime` → `AgentRuntime`), with the real
  recorder and the real privacy sanitizer.

### 8.2 What BLOCKED the native trace (verified, environmental)

1. **GUI launch is denied by the sandbox.** Launching the VSCodium binary
   against the writable instance exits with **SIGSEGV (139)**;
   `open -a` fails with `-54` ("launch denied"). The pre-existing instances
   under `~/.vscodium-*` were started outside this sandbox.
2. **The `~/.vscodium-*` trees are read-only to this sandbox.** Every write
   attempt fails with `EPERM: operation not permitted` —
   including `codium --install-extension` into the very instance that produced
   the original trace
   (`mkdir '/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/.…'`),
   and including the `user-data/logs/…` directory creation.
3. Only `/tmp` and the repository are writable.

### 8.3 Why this is `CAPTURE_INSUFFICIENT`, not a defect claim

The native trace is **not** claimed. The three source-level facts that the
native trace would have exercised are each independently proven executable:

| Source-level fact | Executable proof |
|---|---|
| the sink reaches `AgentRuntime` | W1a + E1/E2/E3 (real chain, real runtime) |
| a real model request + tool execution emit correlated events | E1/E2/E3 (real `AgentRuntime`, real tool) |
| compaction uses the configured ceiling | E6 (real split → real compaction policy; RED message `expected 1048576 to be 512000` matches the trace exactly) |

**No new recorder, comparator, framework or refactor was introduced to reach
this point.** The repair is two lines in two existing seams.

### 8.4 What a follow-up run needs

A host where the agent can (a) launch the VSCodium GUI and (b) write to the
target `~/.vscodium-*` tree. The prepared artifacts are ready:

* VSIX: `dist/dogfood/clinemm-4.1.16-5a1c485cb-mblive01.vsix`
* expected installed bundle SHA-256:
  `c7b6fda3a3e669e7d60a1f5186f0e4dfef02822d750b30f196a2a85553a997af`
* operator steps: `cline.debug.toggleModelBehaviorTrace` → run a session that
  makes a model request and a tool call → `cline.debug.dumpModelBehaviorTrace`
* expected: `model_request_start` / `model_request_finish` / `tool_start` /
  `tool_finish` records present, and `compaction_diagnostics.maxInputTokens`
  == `512000`.

---

## 9. Scope

* **2 production lines** in 2 existing files (+ 26 lines of explanatory
  comments).
* **2 new witness files** (9 tests).
* **No new recorder, comparator, generic observability framework, or unrelated
  refactor.**
* No change to model behavior, prompts, tool execution, compaction policy
  math, the loop detector, lifecycle authority, the protocol surface, or React.
* No dependency additions. No worktrees.
