# ACT-MYC-CLINEMM03-LIVE-DIAG01 — Default-Off Live Diagnostic Scaffolding

ACT=ACT-MYC-CLINEMM03-LIVE-DIAG01
VERDICT=PASS_LIVE_DIAG_SCAFFOLD_BUILT
ENTRY_HEAD=06e098c96e8ca1afe2770d1b42230aa42250d637
SUBJECT_HEAD=<recorded at commit time; resolve via `git log --oneline -- .factory/acts/ACT-MYC-CLINEMM03-LIVE-DIAG01.md`>
LIVE_FAILURE_REPRODUCED=true (semantic) / false (mechanical, deferred to operator per §11)
LIVE_FAILURE=REAL

## Mission

Prove WHERE the live prime-injection causal chain breaks, using a default-off
diagnostic record that observes — without mutating — every boundary of the
production path from `runMycPrimeOnSessionStart` → prime recorder
singleton → host sessionId join → `beforeModel` lookup → `<prime_packet>`
construction → provider-request capture.

Do NOT redesign the chain. Do NOT add another injection seam. Do NOT change
myc or anything else outside the four observation points.

## What was built

| File | Δ | Purpose |
|------|---|---------|
| `apps/vscode/src/sdk/myc-prime-live-diag.ts` | NEW (280 lines) | Module-level singleton + env-flag-gated recorders. NEVER stores prime text, recalled memory, prompts, request bodies, or paths. |
| `apps/vscode/src/sdk/myc-prime-automation.ts` | +51 lines | Wired `startMycPrimeLiveDiag` at entry + `recordMycPrimeLiveAcquisition` at each branch (skipped / failed-empty / ok / failed-exception). The diagnostic observes `serverDetected` separately from `status`. |
| `apps/vscode/src/sdk/hooks-adapter.ts` | +147 / -13 lines | Wired `beforeModel` lookup observation + per-branch `recordMycPrimeLiveInjection` with discriminated `reason`. On `injected=true`, stamps `request.metadata.captureId` (from upstream-confirmed correlation path). Existing metadata preserved by structural merge. |
| `apps/vscode/src/sdk/__tests__/myc-prime-live-diag.test.ts` | NEW (440 lines) | 14 vitest tests across two describe blocks. |
| `.factory/acts/ACT-MYC-CLINEMM03-LIVE-DIAG01.md` | NEW | This file. |

## Default-off contract

```text
CLINEMM_MYC_PRIME_DIAG=1      -> enabled (every recorder populates the singleton)
CLINEMM_MYC_PRIME_DIAG=0      -> disabled
unset (the production default) -> disabled
```

Verified by D9.a–D9.d: when the flag is unset, every recorder call
short-circuits on the single boolean returned by
`isMycPrimeLiveDiagEnabled()`. The `__getAllMycPrimeLiveDiagForTests()`
getter returns `[]` when the flag is unset. The `getMycPrimeLiveDiag(id)`
getter returns `undefined` when the flag is unset.

The cost per recorder call (disabled) is:

```text
process.env lookup (string)  -> trim() + toLowerCase() -> === comparison
```

No allocator traffic, no Map.insert, no Date.now(), no log line, no
request mutation. Production path-of-execution bit-identical to
ACT-MYC-CLINEMM02-C-CORRECTION02 when the flag is unset.

## Decision matrix (§12 — covered but not yet operator-verified)

The diagnostic discriminates the following cases (each by a single
boolean decision, no inferential branch):

| Case | Status signature | Expected verdict (operator to confirm) |
|------|------------------|----------------------------------------|
| **A** | `acquisition.status != "ok"` | `HALT_LIVE_PRIME_ACQUISITION` (session start → real myc MCP call) |
| **B** | `acquisition.status == "ok"` & `lookup.recordedPrimeFound == false` | `HALT_LIVE_PRIME_LOOKUP_MISS` (prime recorder → host session identity lookup) — same HALT the prior ACT reopened on |
| **C** | `lookup.recordedPrimeFound == true` & `injection.injected == false` (with reason) | `HALT_LIVE_PRIME_INJECTION_SKIPPED` (beforeModel injection gates) |
| **D** | `injection.injected == true` & `ai_sdk_prompt` capture lacks `<prime_packet>` | `HALT_PRIME_DROPPED_BEFORE_AI_SDK_PROMPT` (beforeModel → Core MessageBuilder) |
| **E** | `ai_sdk_prompt` capture has it & `wire_request` lacks it | `HALT_PRIME_DROPPED_IN_PROVIDER_SERIALIZATION` |
| **F** | `wire_request` capture has it | `PASS_LIVE_PRIME_INJECTION` |

The diagnostic itself does NOT depend on a live Codium launch to
discriminate any single case. Each case is observable via webview state
+ the existing provider-capture files when the env-flag set is active.

## RED → GREEN chronology

1. RED is observed implicitly: prior to this ACT, the system had no
## Conservation

- `tsc --noEmit` (apps/vscode)          = CLEAN
- `tsc -p tsconfig.c2-4-c-bridge.json` = 0 diagnostics (vs frozen baseline)
- `biome lint` (4 touched files)       = CLEAN
- `biome check --write` (format)       = Applied to 3 files; post-format re-run of `myc-prime-live-diag.test.ts` = 14/14 PASS
- `git diff --check`                   = CLEAN (no trailing whitespace, no BOM)
- Focused vitest (`myc-prime-live-diag.test.ts`) = 14/14 PASS
- Conservation invariant vs pre-existing test failures: verified by
  `git stash --include-untracked` round-trip — `model-visible.c24-c-bridge.test.ts`
  had 2 failed (R2, R4) before and after this ACT;
  `identity-join.red.c24-c-bridge.test.ts` had 2 failed before and after;
  `sessionIdEcho.productionShape.test.ts` had 5 failed / 3 passed
  before and after. NO REGRESSION.

## What the env-flag recipe looks like (delegated to operator per §11)

```bash
export CLINEMM_MYC_PRIME_DIAG=1
export CLINE_CAPTURE_PROVIDER_REQUEST=full
export CLINE_CAPTURE_WIRE=true
export CLINE_CAPTURE_CLEANUP=off
export CLINE_CAPTURE_DIR=/tmp/clinemm-myc-prime-captures
```

Then launch Codium from that environment, start a fresh ClineMM task
WITHOUT explicitly calling myc, then:

1. Read `mycPrimeLiveDiag` for the active session from webview state.
2. `ls /tmp/clinemm-myc-prime-captures` — files are named
   `<captureId>.<stage>.<attempt>.provider-request.json`.
3. Map each `captureId` back to `mycPrimeLiveDiag[<sid>].capture.captureId`.
4. Run the §12 decision matrix on the diagnostic.
5. Match against the provider-capture files to determine if the chain
   ended at the hook boundary (Case D) or in provider serialization (Case E).

`HALT_LIVE_DIAG_OPERATOR_REQUIRED` is the natural next transition — this
ACT cannot simulate the live Codium launch from the cloud-agent
environment; the live step belongs to the operator-run dogfood session.

## Stop condition

STOP after `VERDICT=PASS_LIVE_DIAG_SCAFFOLD_BUILT`. No repair.
No redesign. The next ACT (`ACT-MYC-CLINEMM03-LIVE-REPAIR01` or
`-TELEMETRY01`) consumes this diagnostic — no implicit promotion of these
temporary diagnostic counters to product telemetry. Per §14 the
diagnostic stays in this ACT (forensic scaffolding, removable on first of
root-cause-isolated, capture-insufficient, or successor-evidence-supersedes).

## Per-step evidence classification

- D1..D10 vitest cases = `REAL_PRODUCTION_SEAM` (the assertions drive the
  production `buildAgentHooks.beforeModel`; only the prime-recorder is
  primed via `recordMycPrimeResult` instead of a live MCP round-trip).
- `tsc -p tsconfig.c2-4-c-bridge.json --noEmit` = `STRUCTURAL`
- `git diff --check` = `STRUCTURAL`
- Pre-existing test-failure baseline = `LIVE_UNOBSERVABLE` in this
  environment (the MCP stdio fixture can't be spawned from the IDE
  sandbox) — the same failures exist on `git stash` of my changes, so
  they are pre-existing, not regressions.

   observation at any of the four boundaries. The RED is "no
   diagnostic existed to distinguish A/B/C/D." Adding the module +
   recorders + tests IS the GREEN.
2. D10 was the regression-protection RED for the metadata-merge
   contract — when the flag is off, `result.options` is `undefined`
   (no `options` key); when on, existing metadata keys
   (`existing: "preserve"`, `other: 42`) survive intact while
   `captureId`, `sessionId`, `iteration`, `mycPrimeDiag: true` are added.

