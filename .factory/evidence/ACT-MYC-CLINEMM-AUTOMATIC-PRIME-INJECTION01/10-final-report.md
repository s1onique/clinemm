# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01 — Reclassified Final Report

```text
ACT=ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01
VERDICT=HALT_LIVE_RED_MISCLASSIFIED
VERDICT_ALT=CAPTURE_INSUFFICIENT | HALT_LIVE_RED_NOT_REPRODUCED_IN_SYNTHETIC_REAL

ENTRY_HEAD=89249175c71fcbc059d26d54f5c50f7f6dbd3373
SUBJECT_HEAD=89249175c71fcbc059d26d54f5c50f7f6dbd3373

LIVE_RED_CLASSIFICATION = REAL   (was: OPERATOR_PENDING / hypothetical)
LIVE_RED_SOURCE          = real installed Codium session on installed build
                           s1onique.clinemm-4.1.16-89249175c, captured on
                           CLINE_DIR=/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/

LIVE_RED_SESSION_ID      = 1790604494785_8zlsd
LIVE_RED_RUN_ID          = run_PdCFt9iX
LIVE_RED_ITERATION       = 1
LIVE_RED_AGENT_ID        = agent_1790604495115_kzjlkt
LIVE_RED_CONVERSATION_ID = conv_1790604495203_buhod8d
LIVE_RED_PROVIDER_MODEL  = minimax/MiniMax-M3
LIVE_RED_EXTENSION_VER   = 4.1.16-89249175c
LIVE_RED_CAPTURE_PATH    = /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data/provider-request-captures/cap_run_PdCFt9iX_1_a0d269608b88fda2.ai_sdk_prompt.1.provider-request.json
LIVE_RED_CAPTURE_BYTES   = 105805 (truncated)
LIVE_RED_CAPTURE_SHA256  = 608a23d61f9a659ca7e747c2c0ccfef475a6511d5fd84fbde6c421d82d290499
LIVE_RED_USER_MSG_COUNT  = 2 (idx 0..1, total 437 bytes)
LIVE_PROVIDER_PACKET_PRESENT     = false  (LIVE RED)
LIVE_PROVIDER_WITNESS_PRESENT    = false  (LIVE RED)
LIVE_PRIME_PACKET_COUNT_PREVIEW  = 0
LIVE_SOURCE_MYC_COUNT_PREVIEW    = 0
LIVE_MYC_LIVE05_COUNT_PREVIEW    = 0
LIVE_MANUAL_MCP_PRIME_WITNESS_PRESENT = true
LIVE_MANUAL_MCP_PRIME_PAYLOAD    = myc 0.3.14 · ws=clinemm sqlite · 24 nodes · idx ok · 2026-09-28T14:08:23.462Z ; # READY 1 of 1 ; clinemm-w3sfqggzxq9b P2 task add MYC-LIVE05-PRIME-WITNESS-20260928-170556 ; session 17906044 · 1 from other sessions hidden
LIVE_MANUAL_MCP_PRIME_SESSION_ID = 1790604494785_8zlsd
LIVE_MESSAGES_JSON_PATH   = /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data/sessions/1790604494785_8zlsd/1790604494785_8zlsd.messages.json
LIVE_MESSAGES_JSON_COUNT  = 17
LIVE_ITERATION1_INPUT_TOKENS = 28591
LIVE_AGENT_FIRST_ACTIONS  = msg[2] = first assistant turn (NO prime context); msg[4] = assistant manually invokes myc_prime + run_commands

SYNTHETIC_REAL_TEST_CLASSIFICATION = SYNTHETIC_REAL
                                     (real SdkSessionLifecycle + real McpHub +
                                      real runMycPrimeOnSessionStart + real recorder +
                                      real hooks-adapter + real AgentRuntime,
                                      BUT constructs `new AgentRuntime({sessionId, hooks})`
                                      directly, bypassing production
                                      VscodeSessionHost / LocalRuntimeHost /
                                      AgentRuntimeConfig composition.)

SYNTHETIC_REAL_TEST_RESULT         = 4/4 GREEN on HEAD 89249175c (wall_time=368ms)
SYNTHETIC_REAL_REPRODUCTION        = false (the test does NOT reproduce the LIVE RED)

REAL_LIVE_RED                      = PRESENT
ROOT_CAUSE                         = UNKNOWN_PRODUCTION_ONLY_DELTA
                                    (some production-only composition delta the
                                     SYNTHETIC_REAL test bypasses is load-bearing)
PRODUCTION_PATCH                   = NOT AUTHORIZED
TEST_CODE_CHANGED                  = true
PRODUCTION_CODE_CHANGED            = false
MYC_CODE_CHANGED                   = false
```

## Reclassified evidence classification

| Bucket | Old classification | New classification |
|---|---|---|
| existing failure (LIVE) | hypothetical / operator-pending | **REAL** (on-disk capture, agent-side messages.json) |
| focused RED | SYNTHETIC_REAL | **SYNTHETIC_REAL** (confirmed; refined scope) |
| ablation | N/A | N/A |
| postfix dogfood | DEFERRED | DEFERRED (LIVE05 is now REAL, not hypothetical) |

The most important evidence is the disagreement:

```text
REAL installed product:
    iteration-1 ai_sdk_prompt lacks prime
    RED

SYNTHETIC_REAL composed test:
    automatic prime → first request
    GREEN
```

That disagreement **does not** mean "no production bug". It means "some production-only seam the test bypasses is load-bearing". The test narrowing the search space is the new evidence.

## P0 / P1 / P2 defects acknowledged

### P0-LIVE-EVIDENCE-MISCLASSIFIED (CLOSED)
The previous closure asserted the LIVE failure was "hypothetical" and "operator-pending". Files inspected on `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data/` during this reclassification confirm the LIVE failure is REAL and on disk. REAL is no longer downgraded to hypothetical.

### P0-TEST-SEAM-OVERCLAIM (CLOSED — reclassified)
The new test is best classified `SYNTHETIC_REAL` (not `REAL_PRODUCTION_SEAM end-to-end`). It drives real classes but constructs the runtime directly:

```ts
const runtime = new AgentRuntime({
    model: opts.model,
    sessionId: startResultSessionId,
    conversationId,
    hooks: opts.hooks,
})
```

That guarantees both runtime-side invariants a production-only delta could violate:
- `runtime.sessionId` is the host id
- `hooks` is installed

The production composition path (`sdk-task-start-coordinator` → `VscodeSessionHost` → `LocalRuntimeHost` / `AgentRuntimeConfig` builder → runtime constructed by host → `beforeModel`) is bypassed. The test is component-composition through real classes, not a real production end-to-end run.

### P1-API-03/05/06/07-NO-EXECUTABLE-CASE (CLOSED)
The four executable tests in the new file are API-01, API-02, API-04, API-08. API-03 / API-05 / API-06 / API-07 are structurally inferred from the same scenario and should be labelled `STRUCTURAL / INFERRED` rather than executed GREEN. No new tests required for this ACT.

### P1-TEST-CODE-CHANGED-FALSE (CLOSED)
Working tree has the new test file untracked; correct values are:
- `production_code_changed = false`
- `test_code_changed = true`
- `fixture_added = true`
- `myc_code_changed = false`

### P2-GATE-SUMMARY-RESIDUE (NON-BLOCKING)
`.factory/gate-summary.json` reports `source_status=invalid` and `binding_status=EVIDENCE_INVALID`. Per policy this is non-blocking; batch later.

## Discriminator tree the live evidence opens up

The test narrowed the search to **production-only composition delta**. The next ACT must answer which specific transition is the missing link:

```text
myc_beforemodel_enter (sessionId, iteration, hooksInstalled=true)
  not fired              → hook assembly/wiring defect in the production host

myc_beforemodel_enter fired, wrong sessionId
                        → runtime config identity defect (sessionId flow)

correct sessionId, lookup MISS
                        → recorder/instance/lifetime defect (different recorder instance?)

lookup HIT, injected=false
                        → injection-guard defect (already-injected check, status filter)

injected=true, ai_sdk_prompt absent
                        → downstream request-composition loss (messages were mutated but the mutation never reached the captured provider request)
```

## Successor (per reviewer)

```text
ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01
```

Instrument just four default-off events:
- `myc_beforemodel_enter` (sessionId, iteration, hooksInstalled)
- `myc_beforemodel_lookup` (lookupKey, recordedPrimeFound, recordedPrimeSessionId)
- `myc_beforemodel_exit` (injected, reason, packetBytes)
- `myc_provider_capture_binding` (captureId, sessionId, iteration)

Constraints: no prime contents, no myc changes, no new architecture. One real dogfood run. Discriminator becomes trivial per the tree above.

## Files NOT touched (production code)

- `apps/vscode/src/sdk/hooks-adapter.ts`
- `apps/vscode/src/sdk/sdk-session-lifecycle.ts`
- `apps/vscode/src/sdk/SdkController.ts`
- `apps/vscode/src/sdk/myc-prime-automation.ts`
- `sdk/packages/agents/src/agent-runtime.ts`
- `sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts`

## Conservation (frozen per prior ACTs)

- Manual MCP `myc_prime` path: untouched
- MCP autostart (AUTOSTART01): 10/10 PASS
- Bounded MCP bootstrap (FINALIZATION-RUN-BOOTSTRAP-STALL01): 4/4 PASS
- myc-prime-automation.identity-join.red: 2/2 PASS
- myc-prime-automation.model-visible: 4/4 PASS
- myc-prime-live-diag: 14/14 PASS
- myc-prime-automation.lifecycle01 (bun): 12/12 PASS
- myc-prime-automation.lifecycle02 (bun): 4/4 PASS
- `MYC_CODE_CHANGED=false`

## Gates

```text
typecheck       PASS (bun run check-types clean)
diff_check      PASS (git diff --check clean; no tracked dirt)
production_code_changed false
test_code_changed true
fixture_added true
```

## Files added (untracked — durable evidence, not production code)

- `apps/vscode/src/services/mcp/__fixtures__/myc-prime-auto/server.mjs` (NEW, 2.2KB) — deterministic prime echo fixture
- `apps/vscode/src/sdk/__tests__/myc-prime-auto-injection01.api01-red.c24-c-bridge.test.ts` (NEW, 17.4KB, 4 tests, 368ms) — production-shape end-to-end test (SYNTHETIC_REAL class)
- `.factory/acts/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01.md` — ACT body
- `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01/{00-recon.md, 01-discriminator.md, 10-final-report.md, result.json}` — evidence

## Epic board update (pending)

The board entry for this ACT must reflect the reclassified verdict:

```text
ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01 — HALT_LIVE_RED_MISCLASSIFIED — 2026-09-28
```

The verdict is no longer `HALT_RED_NOT_REPRODUCED`. It is `HALT_LIVE_RED_MISCLASSIFIED` with a successor ACT that performs live-boundary capture, not synthetic-harness expansion.

## Final summary

The ACT's intended repair is **still not authorized**. The LIVE failure is **real, not hypothetical**, and the new test, while useful as a SYNTHETIC_REAL gate, **does not refute the live bug** — it narrows the search to a production-only composition delta. The next ACT must instrument the four boundary events on the real product and run one real dogfood to identify the exact broken transition. No production patch is to be attempted until that evidence is acquired.
