# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01 — Discriminator (RECLASSIFIED)

## Test: API-01 — production-shape RED

**Composed test result:** 4/4 GREEN on HEAD `89249175c` (368ms).
**Classification of the test:** `SYNTHETIC_REAL` (component-composition
through real classes, but constructs `new AgentRuntime({sessionId, hooks})`
directly — bypassing production host/config-builder composition).

The new test
`apps/vscode/src/sdk/__tests__/myc-prime-auto-injection01.api01-red.c24-c-bridge.test.ts`
drives the REAL `SdkSessionLifecycle.startNewSession` → real `runMycPrimeOnSessionStart`
→ real `getMycPrimeResult` → real `buildAgentHooks.beforeModel` → real `AgentRuntime`
chain. The test body never directly calls `runMycPrimeOnSessionStart`. The only
prime invocation is the production automatic-prime path wired through
`SdkSessionLifecycle.onMycPrimeRequested`.

**Test result:**

```text
✓ API-01: the production seam delivers exactly one prime_packet in iteration 1
✓ API-02: automatic prime fires exactly once even when the runtime loops
✓ API-04: snapshot.sessionId is the HOST sessionId (not the agent conversationId)
✓ API-08: no-prime case (helper returns skipped) MUST NOT inflate the first request
```

Excutable cases only: API-01, API-02, API-04, API-08.
Structural/inferred (no executable test): API-03, API-05, API-06, API-07.

The prime packet is correctly injected on iteration 1 with the correct session id,
the witness is present, and later iterations do not re-inject. The identity-join
invariant holds: `startResult.sessionId = SESSION_ID` and `conversationId` is
distinct (`conv_<ts>_<rand>` format).

## Causal discriminator output (SYNTHETIC_REAL chain)

```text
AUTO_PRIME_TRIGGERED                       = true  (real SdkSessionLifecycle.startNewSession awaits onMycPrimeRequested)
AUTO_PRIME_STATUS                          = ok    (deterministic fixture returns witness text)
AUTO_PRIME_SESSION_ID                      = SESSION_ID  (echoes input.config.sessionId)

PRIME_RECORDER_WRITE_OCCURRED              = true  (lastResultBySessionId.set(SESSION_ID, ...))
PRIME_RECORDER_SESSION_ID                  = SESSION_ID

BEFOREMODEL_ITERATION                      = 1
BEFOREMODEL_SNAPSHOT_SESSION_ID            = SESSION_ID  (AgentRuntimeConfig.sessionId flows through snapshot())
BEFOREMODEL_LOOKUP_KEY                     = SESSION_ID  (snapshot.sessionId ?? snapshot.conversationId)
BEFOREMODEL_LOOKUP_HIT                     = true

INJECTION_ATTEMPTED                        = true
INJECTION_RESULT                           = true (messages replaced with prime packet)
INJECTION_REASON                           = ok

FIRST_REQUEST_PACKET_PRESENT               = true
FIRST_REQUEST_WITNESS_PRESENT              = true
FIRST_REQUEST_PACKETS                      = 1  (exactly one)
FIRST_REQUEST_PACKET_SESSION_ATTR          = SESSION_ID
LATER_REQUESTS_PACKETS                     = 0
```

## REAL LIVE evidence (RECLASSIFIED, was incorrectly downgraded to hypothetical)

```text
LIVE_RED_SESSION_ID          = 1790604494785_8zlsd
LIVE_RED_RUN_ID              = run_PdCFt9iX
LIVE_RED_ITERATION           = 1
LIVE_RED_AGENT_ID            = agent_1790604495115_kzjlkt
LIVE_RED_CONVERSATION_ID     = conv_1790604495203_buhod8d
LIVE_RED_PROVIDER_MODEL      = minimax/MiniMax-M3
LIVE_RED_EXTENSION_VER       = 4.1.16-89249175c
LIVE_RED_CAPTURE_PATH        = /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data/provider-request-captures/cap_run_PdCFt9iX_1_a0d269608b88fda2.ai_sdk_prompt.1.provider-request.json
LIVE_RED_CAPTURE_BYTES       = 105805  (truncated)
LIVE_RED_CAPTURE_SHA256      = 608a23d61f9a659ca7e747c2c0ccfef475a6511d5fd84fbde6c421d82d290499
LIVE_RED_USER_MSG_COUNT      = 2
LIVE_PROVIDER_PACKET_PRESENT = false
LIVE_PROVIDER_WITNESS_PRESENT = false
LIVE_MANUAL_MCP_PRIME_WITNESS_PRESENT = true
LIVE_MANUAL_MCP_PRIME_PAYLOAD = "myc 0.3.14 · ws=clinemm sqlite · 24 nodes · idx ok · 2026-09-28T14:08:23.462Z ; # READY 1 of 1 ; clinemm-w3sfqggzxq9b P2 task add MYC-LIVE05-PRIME-WITNESS-20260928-170556 ; session 17906044"
```

## Verdict (RECLASSIFIED)

```text
HALT_LIVE_RED_MISCLASSIFIED
ALT: CAPTURE_INSUFFICIENT | HALT_LIVE_RED_NOT_REPRODUCED_IN_SYNTHETIC_REAL
```

The disagreement is the most important evidence:

```text
REAL installed product:
    iteration-1 ai_sdk_prompt lacks prime
    RED

SYNTHETIC_REAL composed test:
    automatic prime → first request
    GREEN
```

The test does NOT refute the live bug — it narrows the search to a
production-only composition delta. Specifically, the test bypasses
production `VscodeSessionHost` / `LocalRuntimeHost` / `AgentRuntimeConfig`
composition by constructing the runtime directly. The two dimensions a
production-only delta could violate are runtime `sessionId` and hook
installation — both of which the test guarantees.

The LIVE failure is **REAL, not hypothetical**, and a production patch
**is not authorized**. The next ACT (`ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01`)
must acquire live-boundary evidence before any patch attempt.

## Successor (NOT in this ACT)

```text
ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01
```

Instrument just four default-off events on the real product:
- `myc_beforemodel_enter` (sessionId, iteration, hooksInstalled)
- `myc_beforemodel_lookup` (lookupKey, recordedPrimeFound, recordedPrimeSessionId)
- `myc_beforemodel_exit` (injected, reason, packetBytes)
- `myc_provider_capture_binding` (captureId, sessionId, iteration)

Constraints: no prime contents, no myc changes, no new architecture.
One real dogfood run. Discriminator becomes trivial:

```text
no beforemodel_enter        → hook assembly/wiring defect
enter, wrong sessionId      → runtime config identity defect
correct sessionId, lookup MISS → recorder/instance/lifetime defect
lookup HIT, injected=false  → injection guard defect
injected=true, ai_sdk_prompt absent → downstream request-composition loss
```

## Conservation

All existing tests pass on HEAD:
```text
myc-prime-automation.identity-join.red.c24-c-bridge.test.ts  2/2 PASS
myc-prime-automation.model-visible.c24-c-bridge.test.ts      4/4 PASS
myc-prime-live-diag.test.ts                                 14/14 PASS
myc-prime-auto-injection01.api01-red.c24-c-bridge.test.ts    4/4 PASS  (NEW)
```

Plus MCP suite:
```text
mcpSessionAutostart01.test.ts                                10/10 PASS
finalizationRunBootstrapStall01.test.ts                       4/4 PASS
```

Production code unchanged. `MYC_CODE_CHANGED=false`.
`production_code_changed=false`. `test_code_changed=true`. `fixture_added=true`.
