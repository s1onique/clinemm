# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01

## 0. Mission

Repair the production defect demonstrated by the latest LIVE run (LIVE05):
provider `ai_sdk_prompt` iteration 1 lacks the prime_packet despite a successful
real `myc_prime` call returning the witness for the SAME session id.

## 1. Entry trust

```text
ENTRY_HEAD=89249175c71fcbc059d26d54f5c50f7f6dbd3373
```

Untracked operator evidence exempt: `.factory/evidence/ACT-MYC-CLINEMM05-...`
and `scripts/myc-prime-witness.sh`.

## 2. Production seam inventory (REAL, from source on HEAD)

| Seam | Location |
|------|----------|
| SESSION_START_SEAM | `apps/vscode/src/sdk/sdk-task-start-coordinator.ts:246-249` |
| AUTOMATIC_PRIME_TRIGGER | `apps/vscode/src/sdk/sdk-session-lifecycle.ts:479-485` (awaited) |
| AUTOMATIC_PRIME_EXECUTOR | `apps/vscode/src/sdk/SdkController.ts:1680-1686` |
| AUTOMATIC_PRIME_RESULT_SEAM | `apps/vscode/src/sdk/myc-prime-automation.ts:140-200` |
| PRIME_RECORDER_WRITE | `lastResultBySessionId: Map<string, MycPrimeResult>` (module-level) |
| PRIME_RECORDER_KEY | `result.sessionId = startResult.sessionId` |
| AGENT_SNAPSHOT_SESSION_ID_SOURCE | `sdk/packages/agents/src/agent-runtime.ts:1033-1044` |
| AGENT_RUNTIME_CONFIG_SESSION_ID | `sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts:104` |
| BEFOREMODEL_HOOK_CREATE | `apps/vscode/src/sdk/hooks-adapter.ts:192` |
| BEFOREMODEL_HOOK_EXECUTE | `sdk/packages/agents/src/agent-runtime.ts:1936-1952` |
| PRIME_RECORDER_LOOKUP | `apps/vscode/src/sdk/hooks-adapter.ts:231,259,284` |
| PRIME_PACKET_BUILDER | `apps/vscode/src/sdk/hooks-adapter.ts:317-320` |
| PRIME_PACKET_REQUEST_MUTATION | `apps/vscode/src/sdk/hooks-adapter.ts:336` |
| PROVIDER_METADATA_CAPTURE_ID_CREATE | `apps/vscode/src/sdk/hooks-adapter.ts:347` |

## 3. Actual chronology

```text
T1  session identity exists                   — sdk-task-start-coordinator.ts:246
T2  automatic prime starts                    — sdk-session-lifecycle.ts:479
T3  automatic prime completes                 — sdk-session-lifecycle.ts:485 (awaited)
T4  recorder write occurs                     — myc-prime-automation.ts
T6  beforeModel iteration=1 executes          — agent-runtime.ts:1936
T7  recorder lookup occurs                    — hooks-adapter.ts:259
T8  provider request is emitted               — agent-runtime.ts:1978
```

```text
T1 < T2 < T3 < T4 < T6 < T7 < T8  — no race window in production seam
```

## 4. Frozen hypotheses

- H1 REJECTED: trigger is wired and awaited.
- H2 NOT IMPLICATED: production prime fires on same MCP server as successful manual call.
- H3 NOT IMPLICATED: recorder keyed by `startResult.sessionId`.
- **H5 POSSIBLY IMPLICATED**: lookup key is `snapshot.sessionId ?? snapshot.conversationId`. Production `snapshot.sessionId` comes from `AgentRuntimeConfig.sessionId` -> `CoreSessionConfig.sessionId` -> `taskSessionId`. All three should equal `startResult.sessionId` in production. The existing tests prove injection works WHEN `sessionId` is set on the runtime; they do NOT prove the production wiring preserves identity through the lifecycle.
- H6 / H7 NOT IMPLICATED (theoretically).

## 5. The real RED gap

Existing tests manually invoke `runMycPrimeOnSessionStart` from the test body,
then construct `AgentRuntime` directly with that id. The reviewer-flagged gap:
**the production seam (sdk-task-start-coordinator → SdkSessionLifecycle.startNewSession
→ sdkHost.start → onMycPrimeRequested → recorder → runtime config → snapshot)** has
not been driven end-to-end by any test.

The live failure means at least one of these transitions silently breaks in
production. We need a test that drives the WHOLE chain without manually calling
prime from the test body.

## 6. RED fixture

`apps/vscode/src/services/mcp/__fixtures__/myc-prime-auto/server.mjs`
- Echoes back deterministic prime payload containing `MYC-AUTO-PRIME-WITNESS-<fixed>`.
- Mirrors production `myc prime` shape: `{content: [{type: "text", text: ...}]}`.

## 7. RED test file (API-01 discriminator)

`apps/vscode/src/sdk/__tests__/myc-prime-auto-injection01.api01-red.c24-c-bridge.test.ts`
- Drives REAL production seam up to the model adapter.
- Does NOT manually invoke `runMycPrimeOnSessionStart`.
- Uses a real SdkSessionLifecycle-like driver with real `buildAgentHooks`,
  real recorder, real McpHub, real scripted model.
- Asserts FIRST request contains `<prime_packet source="myc" session="S">`
  containing `MYC-AUTO-PRIME-WITNESS-<fixed>`.

If the live defect is reproducible, API-01 RED on HEAD.

## 8. Gates

- `bun run check-types`
- `bun run vscode:prepublish`
- `git diff --check`

Plus focused test suite: API-01..API-10.

## 9. Conservation

- Manual MCP `myc_prime` (model tool) must continue to work.
- MCP autostart (AUTOSTART01 10/10) preserved.
- Bounded MCP bootstrap (FINALIZATION-RUN-BOOTSTRAP-STALL01 4/4) preserved.
- Completion authority (PCCA01, CPA01, BCB01-C4, CCARD) preserved.
- `MYC_CODE_CHANGED=false`.

## 10. Production delta budget

1–2 production files + 1 focused test file. If discriminator points at
`McpHub`, `PendingPromptsController`, completion coordinator, or provider
adapter: `HALT_WRONG_SEAM`.

## 11. Closure reclassification (REVIEWER P0)

Initial closure verdict: `HALT_RED_NOT_REPRODUCED` (production-shape RED test
went GREEN on HEAD; "LIVE05 was hypothetical / operator-pending").

Reviewer P0: closure misclassified a REAL live RED as hypothetical.

Reclassified verdict: `HALT_LIVE_RED_MISCLASSIFIED`
(also expressed as `CAPTURE_INSUFFICIENT` or
`HALT_LIVE_RED_NOT_REPRODUCED_IN_SYNTHETIC_REAL`).

The actual evidence on disk
(`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data/`):

```text
LIVE_RED_SESSION_ID      = 1790604494785_8zlsd
LIVE_RED_RUN_ID          = run_PdCFt9iX
LIVE_RED_ITERATION       = 1
LIVE_PROVIDER_PACKET_PRESENT  = false
LIVE_PROVIDER_WITNESS_PRESENT = false
LIVE_MANUAL_MCP_PRIME_WITNESS_PRESENT = true
LIVE_PRIME_PAYLOAD = myc 0.3.14 · ws=clinemm sqlite · 24 nodes · idx ok ·
                     2026-09-28T14:08:23.462Z ;
                     # READY 1 of 1 ;
                     clinemm-w3sfqggzxq9b  P2 task
                       add MYC-LIVE05-PRIME-WITNESS-20260928-170556
```

The new test is best classified `SYNTHETIC_REAL` (component-composition
through real classes, but constructs `new AgentRuntime({sessionId, hooks})`
directly, bypassing production host/config-builder composition). The composed
GREEN vs real RED is the most important evidence: some production-only
composition delta the test bypasses is load-bearing.

## 12. Successor ACT (NOT in this ACT)

```text
ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01
```

Instrument just four default-off events on the real product:
- `myc_beforemodel_enter` (sessionId, iteration, hooksInstalled)
- `myc_beforemodel_lookup` (lookupKey, recordedPrimeFound, recordedPrimeSessionId)
- `myc_beforemodel_exit` (injected, reason, packetBytes)
- `myc_provider_capture_binding` (captureId, sessionId, iteration)

No prime contents, no myc changes, no new architecture. One real dogfood run.
The discriminator becomes trivial:

```text
no beforemodel_enter
    → hook assembly/wiring defect

beforemodel_enter, wrong sessionId
    → runtime config identity defect

correct sessionId, lookup MISS
    → recorder/instance/lifetime defect

lookup HIT, injected=false
    → injection guard defect

injected=true, ai_sdk_prompt absent
    → downstream request-composition loss
```

Do NOT patch production code in this ACT. Do NOT build another synthetic
harness. Acquire the missing live-boundary evidence first.
