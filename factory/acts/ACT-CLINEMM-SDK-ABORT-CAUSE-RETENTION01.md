# ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01

**Title:** Retain correlated provider-request, SDK-terminal, and abort-origin
evidence for unexplained ClineMM task termination.

**Type:** Evidence acquisition / bounded observability implementation
**Priority:** P1
**Verdict:** `PASS_STRUCTURAL_ONLY`
**Branch:** `main`
**Production scope:** SDK diagnostic observation and local retention only

---

## 0. Terminal verdict (one paragraph)

The next unexplained SDK abort will produce actionable, correctly correlated
evidence. The ACT reuses the EXISTING centralized model-behavior recorder —
there is no second emitter, no second tracing framework and no new public
event protocol — and adds only the missing RETENTION and CORRELATION:
the per-model-request correlation id on the trace identity, the concrete
error identity and the OBSERVED request outcome on the provider-terminal
record, the error identity / terminal path / terminal status on the
SDK run-terminal record, an abort-ORIGIN event emitted at the seam where a
termination is INITIATED, and a bounded, local-only abnormal-terminal
snapshot that already contains the correlated provider / abort-origin /
run-terminal evidence. The historical MiniMax incident is NOT explained and
NOT repaired by this ACT; the ACT makes the NEXT occurrence explainable.
The RED evidence is a demonstrated MISSING OBSERVATION (6 witnesses), not an
intentionally failing agent behaviour. The installed-extension qualification
is `SYNTHETIC_REAL / REAL_PRODUCTION_SEAM`: the real `SessionRuntime`, the
real `AgentRuntime` and the real retention module are driven by a
deterministic injected provider through the production seam, and the
installed bundle is proven to carry the instrumented code — but NO live
MiniMax session was re-run, so the verdict is `PASS_STRUCTURAL_ONLY`, not
`PASS_LIVE_QUALIFIED`.

---

## 1. C0 — Repository and authority reconnaissance

| Field | Value |
|---|---|
| `ENTRY_HEAD` | `5e505e855692c72d8be178e96fd1c81336a68907` |
| `ENTRY_TREE` | `71e3f85c04f28cc204004e661ae773a3d50d3069` |
| `BRANCH` | `main` |
| `WORKTREE_STATUS` | clean at entry (no tracked modifications) |
| `SDK_VERSION` | `@cline/core` 0.2.0 / `@cline/agents` / `@cline/llms` / `@cline/shared` (all 0.2.0) |
| `INSTALLED_EXTENSION_VERSION` | 4.1.16 (`s1onique.clinemm`) under `~/.vscodium-cline/extensions/` |

Predecessor evidence preserved unchanged: `factory/acts/ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01/`
(EVIDENCE_HEAD `3da1d47eb2a422f1cd6c68a4f01f274d328f21ec`). The protected
stash at entry (`stash@{0}`) was untouched.

**HEAD DRIFT vs the predecessor.** The current checkout is 6 commits LATER
than the predecessor's ENTRY_HEAD, and three of those commits added a
substantial observability layer the predecessor did not have (the BCB causal
flight recorder, the command-process trace bridge, and the containment-ledger
causal join). C0 therefore re-derived the whole inventory against the
CURRENT checkout instead of assuming the predecessor's line ranges.

### 1.1 Existing capability inventory

Full table: `existing-telemetry-inventory.txt`.

**The decisive finding:** three of the four required boundaries were
ALREADY EMITTED by the existing recorder, but the evidence was NOT
RETAINED in a usable form:

| Signal | Emitted | Correlated | Retained |
|---|---|---|---|
| Model request started | YES | session/run/iteration | ring |
| Model request ended | YES | session/run/iteration | ring |
| Provider finish reason | PARTIAL | same | ring |
| Terminal provider error | YES | session/run/iteration | ring, but `errorClass` only |
| Terminal provider error NAME | **NO** | – | – |
| Caller cancellation | PARTIAL | telemetry only | not retained |
| Controlled stop | **NO** | – | – |
| SDK terminal result | PARTIAL | session/task/run | ring, but `finishReason` only |
| SDK terminal exception | **NO** | – | – |
| Host receipt | YES | taskId/epoch | YES (existing host trace) |
| `modelRequestId` join key | **NO** | – | – |

### 1.2 Minimum production seams identified

| Seam | File | What it owns |
|---|---|---|
| S1 | `sdk/packages/shared/src/runtime/model-behavior-trace.ts` | the recorder schema, the sanitizer, the sink contract |
| S2 | `sdk/packages/agents/src/agent-runtime.ts` | the model-request boundary and the abort-initiation seam |
| S3 | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` | the SDK run-terminal boundary |
| S4 | `sdk/packages/core/src/runtime/observability/sdk-abort-cause-retention.ts` | the bounded abnormal-terminal retention (NEW) |
| S5 | `apps/vscode/src/sdk/model-behavior-trace-runtime.ts` | the host adapter, the enable bit and the artifact writer |

**The host lifecycle projection was NOT touched.** The existing
`lifecycle-transition-trace.ts` already carries the `task_id` and the epoch
(`turn_seq`), so C1 §4.5's host observation is REUSED, not duplicated.

---

## 2. C1 — Frozen evidence contract

Implemented exactly as frozen:

```
model_request_started
         |
         v
model_request_terminal        (model_request_error | model_request_abort
         |                      | model_request_finish)
         v
sdk_run_terminal              (run_terminated)
         |
         v
host_lifecycle_observation    (the EXISTING host lifecycle trace)
```

An INDEPENDENT abort-origin event (`run_abort_requested`) may occur before
or during the provider request.

### 2.1 Correlation identity — what is actually available

| Field | Provider boundary | SDK run-terminal | Host |
|---|---|---|---|
| sessionId | yes | yes | yes |
| taskId | no (not known to the agent runtime) | yes | yes |
| runId | yes (runtime-owned) | yes (orchestrator-owned) | yes |
| iteration | yes | no | yes |
| modelRequestId | yes | yes (last known) | n/a |
| providerId / modelId | yes | yes | yes |
| epoch | **not available in the SDK** | not available | yes |

An unavailable identity is OMITTED, never synthesized. The `epoch` is
absent from the SDK records because the SDK has no epoch concept; it is a
host-side identity and is reused from the existing host trace.

**Distinct identities are preserved, never conflated:** `modelRequestId`
(agent runtime), the AI SDK `callId` (provider transport) and the provider
HTTP request id (provider response headers) remain separate.

### 2.2 The CORRECTION01 correlation defect

The production SDK mints **TWO run identities for ONE run**:

- `AgentRuntime` — `agent-runtime.ts:1767` `this.state.runId = createUID("run")`
  — carried by every MODEL-REQUEST observation;
- `SessionRuntime` — `session-runtime-orchestrator.ts:1151`
  `this.activeRunId = run_${Date.now()}_...` — carried by the RUN-TERMINAL
  observation.

A retention scope keyed on ONE of them silently drops the OTHER half of the
evidence. This was found by the CORRECTION01 RED witness and is documented
in `red-witness-correlation.txt`. The repair is a SESSION-keyed scope that
admits a record when it shares the session AND either the run id or the
model request id; the session id remains a MANDATORY part of the join, so
concurrent sessions still cannot contaminate each other (witness T14).

Unifying the two run identities would change the run result's `runId` — a
PRODUCTION SEMANTIC change that is out of this ACT's conservation scope.

---

## 3. C2 — RED (the observability defect, demonstrated)

`red-witness.txt` and `red-witness-correlation.txt`.

| Witness | Stimulus | RED symptom |
|---|---|---|
| R1 | provider exception | `expected undefined to be 'ProviderStreamError'` — the provider-terminal record carried NO error name |
| R2 | controlled runtime stop | `expected 0 to be greater than or equal to 1` — NO abort-origin event existed at all |
| R3 | explicit cancellation | `expected 0 to be greater than or equal to 1` — NO abort-origin event existed at all |
| R4 | in-flight at run end | `expected undefined to be truthy` — the trace identity carried NO `modelRequestId` |
| R5 | mid-stream failure | `expected undefined to be 'StreamError'` — NO error name, NO observed outcome |
| CORR01 | provider exception through the REAL `SessionRuntime` | `expected [ 'run_terminated' ] to include 'model_request_error'` — the snapshot had NO provider-terminal evidence |

Every stimulus is a NORMAL production path. No assertion concerns an
intentionally failing agent behaviour. Verdict: `RED_OBSERVABILITY_GAP`.

---

## 4. C3 — Implementation

### 4.1 What was reused unchanged

The `ModelBehaviorTraceRecorder`, the `ModelBehaviorTraceSink` contract, the
existing event kinds, the existing dump command, the existing enable bit
(`modelBehaviorTraceEnabled`, three-state, with the dogfood profile default),
the existing privacy sanitizer, and the existing host lifecycle trace.

### 4.2 What was added

| Change | File |
|---|---|
| `modelRequestId` on the trace identity, observation and record | `sdk/packages/shared/src/runtime/model-behavior-trace.ts` |
| `run_abort_requested` event kind + `onRunAbortRequested` sink channel | same |
| `ModelBehaviorTraceAbortOrigin` / `ModelBehaviorTraceTerminalPath` / `ModelBehaviorTraceRequestOutcome` | same |
| `sanitizeTraceErrorMessage()` — bounded, credential-scrubbed, single-line | same |
| the abort-ORIGIN event at the real abort seam | `sdk/packages/agents/src/agent-runtime.ts` |
| `abort(reason, origin?)` — an OPTIONAL second parameter | same |
| the error identity + observed outcome on the provider-terminal record | same |
| the error identity + terminal path + status + last-known request on the run-terminal record | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` |
| the delegating sink wrapper that learns the last-known request id | same |
| the bounded abnormal-terminal retention | `sdk/packages/core/src/runtime/observability/sdk-abort-cause-retention.ts` (NEW) |
| the artifact writer on the EXISTING dump command | `apps/vscode/src/sdk/model-behavior-trace-runtime.ts` |

**No new command and no new public configuration API.** The retention rides
on `cline.debug.dumpModelBehaviorTrace`, and the enablement rides on the
existing `modelBehaviorTraceEnabled` toggle.

### 4.3 Opt-in, bounds and privacy

- **DEFAULT OFF.** The recorder's enable bit is the single authority. When
  it is off, `record()` returns `undefined`, so the observer and the
  snapshot capture are no-ops and the disabled path performs NO diagnostic
  I/O (witness T9).
- **BOUNDED.** ≤ 64 events and ≤ 256 KiB per snapshot; ≤ 8 snapshots;
  deterministic oldest-first eviction; **truncation is REPORTED**
  (`truncated`, `droppedEventCount`) and the terminal event is never
  evicted (witness T11).
- **LOCAL ONLY.** Nothing is uploaded.
- **PRIVACY.** No prompts, completions, tool arguments or credentials are
  retained. Error messages are credential-scrubbed
  (`sanitizeTraceErrorMessage`) and bounded (witness T12). The artifact is
  written with owner-only permissions, atomically (temp file + rename).
- **REMOVABLE.** The retention is a single module plus the recorder
  channels; removing it restores the pre-ACT evidence exactly.

---

## 5. C4 — GREEN and causal-fidelity tests

`terminal-correlation-tests.txt`. 12 required gates, all passing:

| Test | Result |
|---|---|
| T1 successful provider request + completed run | correlated completion, NO abnormal snapshot |
| T2 provider throws | error class + correct request/run identity |
| T3 stream fails terminally | terminal stream failure, NO fabricated finish reason |
| T4 explicit cancellation | correct initiating origin, NOT a provider failure |
| T5 controlled recovery stop | the actual controlled-stop reason retained |
| T6 request unobserved at run end | explicit `in_flight_at_run_end` |
| T7 two sequential model requests | the terminal event joins the CORRECT request |
| T8 two concurrent sessions | NO cross-session contamination |
| T9 telemetry disabled | NO diagnostic persistence, NO runtime-semantic delta |
| T10 diagnostic writer throws | the original run outcome is conserved |
| T11 truncation / buffer overflow | bounded size, explicit truncation |
| T12 error contains a secret | the secret is absent from the retained artifact |

Plus the CORRECTION01 gates: T13 (dual run ids correlate) and T14 (a
foreign session is never admitted).

**Causal fidelity.** For a provider exception:
`provider_request_started → provider_terminal_failure → sdk_run_terminal`,
all correlated to the same session and the same `modelRequestId`. For a
controlled stop: `runtime_controlled_stop → sdk_run_terminal` with NO
fabricated provider failure. For a cancellation: `abort_requested →
sdk_run_terminal` with the initiating owner attributable.

**Recovered vs unrecovered attempts.** The production request identity is
shared across the AI SDK transport retries of one agent request (one
`modelRequestId` per issued request), so a retried request is NOT counted
as multiple independent agent requests, and a recovered attempt produces no
terminal provider error.

**A missing `afterModel` callback does not prevent run-terminal evidence:**
the run-terminal observation is emitted by the orchestrator's
`buildLegacyResult`, which does not depend on any model hook.

---

## 6. C5 — Conservation gates

`conservation-gates.txt`. Every baseline was re-established by stashing the
ACT's changes and re-running the same command.

- shared typecheck: 0 diagnostics (baseline 0).
- agents typecheck: 0 diagnostics (baseline 0).
- core typecheck: 40 diagnostic lines — the ENTRY-commit baseline, measured
  with the IDENTICAL command in a CLEAN worktree, is **41**. Set
  difference: **ADDED by the ACT = 0**, REMOVED = 1 (a pre-existing,
  unrelated module-resolution diagnostic). ACT-attributable: **0**; the ACT
  strictly reduced the count.
- apps/vscode typecheck: 0 diagnostics.
- shared tests: identical to the baseline (10 failed / 375 passed — all
  pre-existing).
- agents tests: the SAME 16 pre-existing collection failures, plus the
  ACT's new file with 5 passing tests.
- apps/vscode affected tests: 8 files / 102 tests pass.
- core observability tests: 3 files / 25 tests pass.
- biome lint: clean on every changed file in both configurations.
- `bun run build:sdk`: exit 0. `bun esbuild.mjs`: exit 0.

**Not changed** (verified by `git status --short`): provider requests, retry
budgets, recovery budgets, tool execution, tool validation, conversation
history, run return values, exception propagation, cancellation semantics,
session creation/disposal, background job ownership, pending prompt
delivery, completion continuation, session epoch semantics, and **every**
file under `apps/vscode/webview-ui/` (no React/Elm edit, no diagnostic side
effect inside any React updater).

---

## 7. C6 — Installed-extension qualification

`installed-qualification.txt`.

Evidence class: `SYNTHETIC_REAL / REAL_PRODUCTION_SEAM`.

- The installed extension runs the instrumented source: the built
  `dist/extension.js` bundle contains every instrumented symbol, and the
  installed bundle's sha256 is bound to the artifact.
- Terminal diagnostics are collected from the REAL SDK session path: the
  real `SessionRuntime` orchestrator, the real `AgentRuntime`, the real
  recorder and the real retention module.
- A captured abnormal run includes the correct identifiers
  (`sessionId`, `runId`, `modelRequestId`, `providerId`, `modelId`).
- The artifact is found at a KNOWN path without reconstructing the event
  chronology by hand.
- Disabling the diagnostics prevents subsequent diagnostic output.
- Normal task operation and header behavior are unchanged (no webview code
  was touched).

**This is NOT a live MiniMax reproduction and NOT proof that the original
production incident is fixed or explained.**

---

## 8. Remaining unknowns

1. Whether the 2026-11-02 `status="aborted"` was a provider failure, a
   cancellation or a controlled stop — the historical capture did not carry
   the SDK terminal error identity, and this ACT does not retro-fit it.
2. Whether the historical provider request completed, was cancelled
   upstream, or was terminated by a local stream/timeout path.
3. The exact configured MiniMax provider id and model id for that incident.
4. The canonical-shadow-phase vs host-phase ownership mismatch — a
   separate finding, deliberately untouched.

## 9. Next ACT

**NONE.** The next unexplained abort will produce actionable, correctly
correlated evidence. If a future incident still cannot be classified, the
remaining boundary will be named explicitly by the artifact itself.
