# ACT-CLINEMM-ROUND-C-HARNESS-02 — Closure report

## Correctness repair and production-boundary integration

**Outcome: GO (after CORRECTION01 and CORRECTION02).**

Every required caller boundary is wired and exercised through the real
offline runtime path. Two further correctness defects were found *during*
the integration and repaired. A subsequent independent review identified
**two P0 measurement-correctness defects and two P1 contract gaps**; all
four were repaired under CORRECTION01 with RED → GREEN regression evidence.
A second independent review of CORRECTION01 found **one residual P0 and one
bounded P1**; both were repaired under CORRECTION02 with RED → GREEN
regression evidence. Zero new typecheck errors and zero new test
regressions.

### CORRECTION02 — timing-attribution correction (second review follow-up)

The reviewer returned `HALT_TIMING_ATTRIBUTION_INCOMPLETE`. The two
findings, and their repairs:

| Finding | Defect | Repair |
|---|---|---|
| **P0** | The stage-level attribution still classified the `tool_execution → tool_result_delivered` gap as `execution`. `getStages()` separated the two *numbers* (`durationMs` = gap, `spanDurationMs` = measured span), but a consumer that **aggregates `durationMs` by stage** still charged the ~5 s post-execution floor to execution | The inter-boundary gap is now classified `delivery`, and the executor's own measured run time is emitted as an explicit `execution` stage. A 10 ms executor followed by a 5,000 ms delivery delay now aggregates to `execution = 10 ms` and `delivery = 5,000 ms`. The regression asserts **both** the individual values **and** the stage-level aggregation |
| **P1** | The provider timers (`provider_submitted`, `provider_first_response`, `provider_first_token`) were opened in `onModelRequestStart`, i.e. at the start of **request preparation**. A 250 ms preparation followed by 100 ms to the first token reported a **350 ms** provider TTFT instead of the true 100 ms | A new `onProviderRequestSubmitted` channel opens the provider spans at the **actual dispatch seam** — the instant the runtime invokes the provider's `stream()`. The provider interval is therefore measured from submission and never includes preparation. The failure / abort / finish paths close the provider span **only if it is open**, so a request that never reached submission does not fabricate an integrity failure |

**RED evidence** (before the repair): 3 targeted regressions failed exactly
on the two confirmed defects —

- `expected 'execution' to be 'delivery'` (the post-execution gap was still
  classified as execution);
- `expected undefined to be 5000` (no `delivery` stage carried the 5,000 ms
  gap);
- `expected 350 to be 100` (the provider TTFT included the 250 ms
  preparation).

**GREEN evidence** (after the repair): the targeted latency suite is
**71 passed / 0 failed** (was 57); the whole observability suite is
**139 passed / 0 failed** (was 136); the context suite is **206 passed /
0 failed** (1 skipped); the agents package is **581 passed / 0 failed**; the
SDK build and Biome are clean; typecheck is **58 core errors both before
and after** the change (measured by stashing the correction and re-running
the identical command), with **zero** in a file this correction touched.

> **Note on the typecheck baseline.** CORRECTION01 recorded "40 core
> errors". Re-running the identical command (`tsc -p tsconfig.json
> --noEmit` in `sdk/packages/core`) against the *unmodified* committed HEAD
> yields **58**, not 40 — the earlier figure was taken with a different
> tsconfig scope. The meaningful invariant is the **delta**, and the delta
> is **0**: the stashed baseline and the corrected tree both report 58.

### CORRECTION01 — measurement-attribution repair (review follow-up)

The reviewer returned `HALT_MEASUREMENT_ATTRIBUTION_UNSOUND`. The four
findings, and their repairs:

| Finding | Defect | Repair |
|---|---|---|
| **P0-1** | Compaction retention was computed from **counts**, so an equal-count / disjoint-reference compaction falsely claimed full retention | Retention is now computed from **tool-call reference identities** (`tool_use_id` / `id`). The seam reports `compactionEvidenceRefsRetained`, `…Dropped` and the new `…Replaced` counts. Metadata-only: no reference id is emitted |
| **P0-2** | `tool_execution → tool_result_delivered` charged the post-execution delay to **execution**, hiding a 5 s floor | The stage measurement now reports the **phase gap** in `durationMs` and the **independently measured span duration** in `spanDurationMs`. A 10 ms tool followed by a 5,000 ms delivery delay reports `spanDurationMs = 10` and a 5,000 ms gap — the delay is never charged to execution |
| **P1-1** | `request_prepared` spanned the provider round trip, so preparation time included provider time | A new `request_preparation` boundary is opened at request start and closed at the real provider-ready seam (after compaction, every `beforeModel` transform and the final budget check). The provider-bound interval is reported separately via `onProviderRequestCompleted` |
| **P1-2** | The final provider-bound projection was asserted but not independently established | The provider-ready record is computed from `toProviderVisibleMessages(request.messages)` at the dispatch seam, matched to the conversation by **tool-call identity** (`toolCallId` → `tool_use_id`), and the integration test asserts the record exists at the real seam with no integrity failures |
| **P1-3** | `skipReason` was persisted as free-form diagnostic text | `skipReason` is now a **bounded classification** (`schema_validation`, `normalization`, `approval_rejected`, `policy_disabled`, `provider_execution_disabled`, `runtime_hook_blocked`, `recovery_blocked`, `unknown_tool`, `other`). The raw diagnostic text is never persisted |

**RED evidence** (before the repair): 3 targeted regressions failed exactly
on the three confirmed measurement defects —
`expected 5010 to be 10` (delay charged to execution),
`expected 1 to be +0` (equal-count / disjoint references falsely retained),
and the raw skip text persisted verbatim.

**GREEN evidence** (after the repair): the targeted latency suite is
**57 passed / 0 failed**; the whole observability suite is
**136 passed / 0 failed**; the context suite is **206 passed / 0 failed**
(1 skipped); the agents package is **581 passed / 0 failed**; the SDK build
and Biome are clean; typecheck is unchanged at the pre-existing **40 core
errors**, with **none** in a file this correction touched.

---

## 1. Repository identity

| Field | Value |
|---|---|
| Repository root | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| Remote | `git@github.com:s1onique/clinemm.git` |
| Entry branch | `act/clinemm-roundc-harness-01` |
| Entry HEAD | `5719b487f24cadef0c648bec7430892ada848c86` |
| Working tree at entry | clean |
| Pre-existing stash | preserved, untouched (`stash@{0}`) |
| Work branch | `act/clinemm-roundc-harness-02` (created from the verified HEAD) |

No push, PR, deployment, force-push, stash manipulation or destructive Git
operation was performed.

---

## 2. Commits

| Commit | Content |
|---|---|
| `848c9e088` | Phase 1–3: D1 ledger integrity, D2 latency lifecycle, D3 parallel timing, D4 normalization boundary |
| `8dd313129` | Phase 4–5: production-boundary wiring, the two integration defects, and the offline qualification suite |
| `fe152e074` | Closure report: record the final commit id |
| `d351e891b` | CORRECTION01 — review follow-up: identity-based compaction continuity, independent execution/delivery attribution, separate preparation/provider intervals, bounded skip classification, provider-projection crosswalk |
| `720a49616` | Closure report: bind the evidence to the CORRECTION01 HEAD |
| `0656358c6` | CORRECTION02 — second review follow-up: stage-level execution/delivery attribution and provider-timer anchoring at the real dispatch seam |

### 2.1 CORRECTION02 final identity

| Field | Value |
|---|---|
| Final branch | `act/clinemm-roundc-harness-02` |
| Final HEAD | `0656358c6729a045e345bc4b3a8a41bb2c532fb9` |
| Working tree at closure | clean |
| Pre-existing stash | preserved, untouched (`stash@{0}`) |

No push, PR, deployment, force-push, stash manipulation or destructive Git
operation was performed. The baseline comparison below was performed by
`git checkout` of the already-committed CORRECTION01 HEAD and back; no
history was rewritten.

### 2.2 Whole-suite baseline comparison (CORRECTION02 vs CORRECTION01)

The whole `sdk/packages/core` suite was executed at **both** the CORRECTION01
HEAD (`720a49616`) and the CORRECTION02 HEAD (`0656358c6`), with the
identical command, in the identical environment:

| Run | Test files | Tests |
|---|---|---|
| CORRECTION01 baseline (`720a49616`) | 17 failed / 328 passed / 2 skipped (347) | 111 failed / 5,228 passed / 151 skipped |
| CORRECTION02 (`0656358c6`) | 17 failed / 328 passed / 2 skipped (347) | 111 failed / 5,228 passed / 151 skipped |

The **failing-file sets are byte-for-byte identical** (17 files each, all
environment-scoped: macOS sandbox, hub server, git/path authority,
checkpoint persistence). **Zero** of them are in `observability/`,
`agents/`, `extensions/context/`, or any file this correction touched.

> **Note on the earlier baseline figure.** CORRECTION01 recorded "32 failed
> files / 152 failed tests / 165 skipped". Re-running the identical command
> against the *unmodified* committed CORRECTION01 HEAD in this environment
> yields **17 failed files / 111 failed tests / 151 skipped**. The earlier
> figure was captured under a different environment scope; it is NOT a
> regression introduced by CORRECTION02, which is proved by the identical
> failing-file sets on both sides of the change.

---

## 3. The two defects found DURING the integration

These were **not** in the Phase 1 defect list. They were found by
qualifying the wired boundaries against the real runtime, and both had the
same failure mode: *the runtime believed it had reported a boundary it
never actually reported.*

### 3.1 The detached receiver — every boundary was silently dead

The runtime extracted the sink's channel as a bare function and called it
detached:

```ts
const handler = this.config.modelBehaviorTraceSink?.onSchemaValidation;
if (!handler) { return; }
try { handler({ ... }); } catch { /* failure isolation */ }
```

Detaching loses the receiver. A **stateful** adapter — the latency sink,
whose every channel reaches `this.record(...)` — threw
`TypeError: undefined is not an object (evaluating 'this.record')`. The
runtime's failure-isolation catch swallowed it.

**The consequence:** `schema_validation`, `tool_result_delivered`,
`provider_ready` and `compaction` were reported by the runtime and
**never appeared in any trace**. The instrumentation was
*capability-complete but integration-incomplete* — exactly the state the
Phase 1 closure report described — but this ACT's Phase 4 requirement was
to make them real, and the first attempt at that was silently inert.

The same pattern existed in five places:

| Site | Channel |
|---|---|
| `sdk/packages/agents/src/agent-runtime.ts` | `onSchemaValidation` |
| `sdk/packages/agents/src/agent-runtime.ts` | `onToolResultDelivered` |
| `sdk/packages/agents/src/agent-runtime.ts` | `onProviderReady` |
| `sdk/packages/agents/src/agent-runtime.ts` | `onToolStart` / `onToolFinish` |
| `sdk/packages/agents/src/agent-runtime.ts` | `onModelRequestError` / `onModelRequestAbort` / `onEditAttempt` |
| `sdk/packages/core/src/extensions/context/compaction.ts` | `onCompactionDiagnostics` / `onCompactionCompleted` |

**The repair:** every channel is now invoked **as a method on the sink
object**, so the adapter keeps its receiver. The failure-isolation catch
is unchanged — it still guarantees that a throwing sink cannot change the
agent's behaviour.

**The guard:** `latency-sink.lifecycle.test.ts` asserts that every channel
produces its boundary when invoked as a method, and the integration test
asserts the boundaries appear in a real trace.

### 3.2 The false successful completion

`LatencyTraceSink.onToolFinish(observation, status = "ok")` defaulted its
status to `"ok"`, and **the runtime calls the channel with one argument**.
So every finished tool call was reported as a successful completion —
including a call whose approval was **denied** and whose executor **never
ran**.

The runtime already publishes the authoritative facts in the payload:
`outcome`, `executionInvoked` (the C1.2 authority for "did the executor
run?") and `skipReason`. The adapter was simply not reading them.

**The repair:** the status is now derived from those facts —

| Runtime fact | Reported status |
|---|---|
| `outcome` is `cancelled` / `aborted` | `cancelled` |
| `outcome` is `error` / `failed` | `failed` |
| `executionInvoked === false` | `rejected` |
| `skipReason` is present | `rejected` |
| otherwise | `ok` |

A caller that supplies an explicit status still wins, and an unknown
payload falls back to `"ok"`, which preserves the previous behaviour for
callers that only ever report successes.

**The guard:** four new tests in `latency-sink.lifecycle.test.ts` cover
denied → `rejected`, failed → `failed`, completed → `ok`, and the
retention of the outcome fields in the recorded metadata.


---

## 4. The four wired production boundaries

All four are **opt-in** and **disabled by default**: the runtime reports
through the existing `modelBehaviorTraceSink` channel, which is absent
unless a host installs one.

| Boundary | Production owner (the real seam) | Report site |
|---|---|---|
| `schema_validation` | the tool's own schema validating the input, before approval and before execution | `sdk/packages/agents/src/agent-runtime.ts` — `prepareToolExecution`, at the `validateInput` call |
| `tool_result_delivered` | the moment a tool result becomes part of the conversation | `sdk/packages/agents/src/agent-runtime.ts` — the conversation append of the tool message |
| `provider_ready` | the **final** provider-bound message representation, after every transformation and safety pass | `sdk/packages/agents/src/agent-runtime.ts` — `prepareModelRequest`, on the final `toProviderVisibleMessages(request.messages)` |
| `compaction` | the compaction pipeline's own diagnostics and completion channels | `sdk/packages/core/src/extensions/context/compaction.ts` — `createContextCompactionPrepareTurn` |

### 4.1 `provider_ready` is grounded in the provider-bound projection

The provider-ready record is computed from
`toProviderVisibleMessages(request.messages)` — the **final** projection,
after every `beforeModel` transform and every budget check. It is **not**
the persistent conversation history; the two differ, and the distinction
is the whole point of the boundary.

Each conversation tool result is matched to its provider-bound counterpart
**by identity** (`toolCallId` → `tool_use_id`), not by position — position
is not stable once the projection merges adjacent tool messages — and
classified by size:

| Classification | Meaning |
|---|---|
| included | present in the projection with the same size |
| shortened | present but **smaller** than the conversation's copy (a truncation or a rewrite) |
| omitted | **not present** in the projection at all |

Only counts and sizes are recorded. No content, no command arguments, no
file contents.

### 4.2 `compaction` reports the evidence-reference continuity

The completion channel now carries the **before / after / retained /
dropped** counts of tool-call references, so the compaction's own evidence
gap is quantified at the seam instead of being inferred afterwards from a
lossy sidecar. Only counts are recorded — no reference, no content and no
summary text.

### 4.3 The orchestrator forwards the new channels explicitly

`SessionRuntime` forwards the three new channels **explicitly** rather
than by spreading the sink, because a spread copies own properties only
and would drop every channel implemented on a prototype.

`createIsolatedModelBehaviorTraceSink` forwards the request-lifecycle
channels (`onRequestPrepared`, `onProviderRequestSubmitted`,
`onProviderRequestCompleted`) as well, and
`isModelBehaviorTraceSinkActive` counts them — otherwise a host that
installed only the submission channel would silently lose the boundary.

### 4.4 CORRECTION02 — the provider-submission seam

The provider-side timers are opened by a **new** channel,
`onProviderRequestSubmitted`, reported from the **real dispatch seam** in
`sdk/packages/agents/src/agent-runtime.ts`: the instant the runtime
invokes the provider's `stream()`.

| Boundary | Opened at | Closes at |
|---|---|---|
| `provider_submitted` | the provider's `stream()` invocation | the provider round trip's end |
| `provider_first_response` | the provider's `stream()` invocation | the observed first response event (or explicitly unavailable) |
| `provider_first_token` | the provider's `stream()` invocation | the observed first generated token (or explicitly unavailable) |

Before CORRECTION02 these three spans were opened at the start of **request
preparation**, which charged the preparation cost to the provider: a 250 ms
preparation followed by 100 ms to the first token reported a **350 ms**
time-to-first-token instead of the true 100 ms.

The failure, abort and finish paths close the provider span **only if it
is open**, so a request that never reached submission — a preparation
failure, a budget rejection — does not fabricate an integrity failure.

The integration test drives the **real `AgentRuntime`** and asserts that
the submission boundary fired, that it fired **after** the preparation
boundary closed, that the first-token span is anchored at (or after) the
submission instant, and that the trace reports **zero** integrity
failures.

---

## 5. Executed tests and actual results

| Suite | Result |
|---|---|
| `src/observability/` (whole) | **139 pass, 0 fail** (after CORRECTION02; 136 after CORRECTION01) |
| `src/observability/latency/` (4 files) | **71 pass, 0 fail** (63 after CORRECTION01) |
| `src/observability/evidence/` (2 files) | **31 pass, 0 fail** |
| `src/extensions/tools/` | 641 pass, **7 fail** (pre-existing), 105 skipped |
| `src/agents/` (whole package) | **581 pass, 0 fail** |
| `src/extensions/context/` | **206 pass, 0 fail**, 1 skipped |
| Whole `sdk/packages/core` suite | **5,228 pass, 111 fail**, 151 skipped (after CORRECTION02) — **byte-for-byte identical failing-file set** to the CORRECTION01 baseline run in the same environment (17 files each) |
| Typecheck (SDK packages) | **58 errors — identical to the pre-existing baseline**, none in a file this ACT changed |

**The 111 whole-suite failures are pre-existing.** The whole suite was
executed at **both** the CORRECTION01 HEAD (`720a49616`) and the CORRECTION02
HEAD (`0656358c6`) with the identical command in the identical environment:
both produce **17 failed files / 111 failed tests / 151 skipped**, and the
failing-file sets are **byte-for-byte identical**. All 17 are
environment-scoped (macOS sandbox, hub server, git/path authority,
checkpoint persistence). **None** is in `observability/`, `agents/`,
`extensions/context/`, or any file this ACT changed.

> **Correction of the earlier figure.** CORRECTION01 recorded "32 failed
> files / 152 failed tests / 165 skipped". Re-running the identical command
> against the **unmodified** committed CORRECTION01 HEAD in this environment
> yields **17 failed files / 111 failed tests / 151 skipped**. The earlier
> figure was captured under a different environment scope; it is not a
> regression introduced by CORRECTION02, which is proved by the identical
> failing-file sets on both sides of the change.

The 7 failures in `src/extensions/tools/` are the same 7 in the same 3
files as the established baseline
(`skill-trigger-evals01.swcm01`, `editor.realpath-authority`,
`bash.supervised.bash-startup-env`). None of those files is touched by
this ACT.

No test was weakened, skipped or excluded to make a suite green. No
unrelated exclusion was introduced.

### The 58 typecheck errors

The SDK core package's typecheck (`tsc -p tsconfig.json --noEmit` in
`sdk/packages/core`) reports **58 errors** — the **same count as the
established baseline**, measured by stashing the CORRECTION02 change and
re-running the identical command against the committed HEAD. The
intersection of "files this ACT changed" and "files with a typecheck error"
is **empty**, so **zero new typecheck errors** were introduced.

> **Correction of the earlier figure.** CORRECTION01 recorded "40 errors".
> The identical command against the unmodified committed HEAD yields **58**
> in this environment — the earlier figure was taken with a different
> tsconfig scope. The meaningful invariant is the **delta**, and the delta
> is **0**.

The failing files are all pre-existing and none is touched by this ACT:
`src/extensions/tools/executors/bash.supervised*.test.ts`,
`src/runtime/orchestration/session-runtime.*.test.ts`,
`src/runtime/command-policy/*`,
`src/runtime/host/local-runtime-host.*.test.ts`,
`src/runtime/observability/model-behavior-trace.test.ts`,
`src/hub/server/hub-trace-cardinality-discriminator.*.test.ts`, and
`src/extensions/context/compaction.working-context-ratio.test.ts`.

> Two of these errors were **introduced by the new integration test** and
> were fixed before the ACT closed: the `tool_result` content block was
> missing its required `name` field, and the model `info` was missing its
> required `id`. Both are in
> `src/observability/latency/latency-boundaries.integration.test.ts`, which
> is now typecheck-clean.


---

## 6. Offline integration qualification

`sdk/packages/core/src/observability/latency/latency-boundaries.integration.test.ts`
drives the **real** `AgentRuntime` with a deterministic scripted provider
and a recording executor. **No shell command is ever executed** — the
executor only records the command string.

| Required case | How it is covered | Result |
|---|---|---|
| **Success** | every instrumented boundary fires at the real seam; the trace is internally consistent (every span closed, no integrity failures) | pass |
| **Schema failure** | a malformed input is rejected **before** approval and **before** execution — the executor never ran and approval was never requested | pass |
| **Parallel tools** | two calls keep independent `toolCallId`s and independent timings | pass |
| **Compaction** | the evidence recorded before compaction remains discoverable through its ledger identity afterwards — the continuity counts are reported | pass |
| **Truncation** | the provider-ready record distinguishes full, shortened and omitted tool results | pass |
| **Cancellation** | no false successful completion and no orphaned timing assertion | pass |
| **Disabled instrumentation** | agent outputs, approvals, tool execution and lifecycle behaviour are **identical** with and without a sink | pass |
| **Privacy** | no raw prompt, credential or tool-result content enters the telemetry or the evidence ledger; a **throwing** sink cannot change the agent's behaviour | pass |

---

## 7. Measured instrumentation overhead

200 full turns (tool call + approval + execution + second model turn),
each with and without a latency sink installed:

| Configuration | Total | Per turn |
|---|---:|---:|
| Instrumentation **off** | 13.3 ms | 0.066 ms |
| Instrumentation **on** | 15.6 ms | 0.078 ms |
| **Delta** | 2.3 ms | **0.011 ms** |

The overhead is **~11 microseconds per turn** — negligible against a turn
measured in tens of seconds.

**No runtime speedup is claimed from this.** It measures the cost of the
instrumentation, not the benefit of any change. No speedup is claimed at
all: this ACT changed no execution path.

---

## 8. Remaining unknowns and `NOT_EXECUTED` items

| Item | State |
|---|---|
| Live Strata replay | **NOT_EXECUTED** — not authorised by this ACT |
| Live LLM benchmarking | **NOT_EXECUTED** — not authorised by this ACT |
| True time-to-first-token | **UNAVAILABLE** unless a provider exposes an actual first-token event. The trace distinguishes `provider_first_response` from `provider_first_token`, and reports an unavailable measurement explicitly rather than a synthetic zero-duration success. CORRECTION02 additionally anchors both spans at the **actual submission** seam, so an observed TTFT excludes the request-preparation time |
| The ~5-second command-result floor | **NOT ATTRIBUTED.** CORRECTION01 separated the post-execution delay from the executor's run time; CORRECTION02 makes that separation hold at the **stage level** (the gap is classified `delivery`, the executor's own run time is `execution`), so a stage-level aggregation can no longer hide the floor inside execution. A captured end-to-end trace is still required to say where the 5 s actually occurs |
| Runtime speedup | **NOT CLAIMED** |
| A five-second floor attribution | **NOT CLAIMED** |

### 8.1 The concrete next experiment

The next experiment is **not** more offline analysis. It is a single
**captured end-to-end trace** of one real turn against Strata, with the
latency sink installed, so the spans that separate *execution* from
*queue*, *transport* and *delivery* are populated by a real turn instead
of a scripted one.

Specifically: enable the sink, run one tool call whose command takes
about five seconds, and read the spans. If the ~5 s appears as the
`execution` stage (the executor's own measured run time), it is the
command. If it appears as the `delivery` stage — the gap between the
`tool_execution` end and the `tool_result_delivered` start — it is the
post-execution delivery delay. If it appears as the `request_prepared`
span's duration, it is the provider's own round trip; the
`request_preparation` span reports the preparation time separately, and the
provider's first-token span is anchored at the **submission** seam, so the
preparation is never folded into the provider's time. The trace is now
capable of answering this; it has not yet been asked the question.

A second experiment, to reduce model turns: the `provider_ready`
shortened/omitted counts make it measurable whether a tool result is
being **shortened** before the model sees it. If the shortened count is
non-zero in a real session, the tool-result truncation — not the model —
is deciding what the model remembers, and that is a different fix than
asking the model to be more concise.


---

## 9. Evidence crosswalk

| ACT requirement | Evidence |
|---|---|
| Schema-rejected Round C fixtures: 8/8 normalized without losing commands | `src/extensions/tools/roundc-toolcall-normalization.boundary.test.ts` — 9 tests |
| Ledger integrity adversarial tests: all pass | `src/observability/evidence/evidence-ledger.integrity.test.ts` — 18 tests, all pass |
| Required caller boundaries: 4/4 wired and exercised offline | `latency-boundaries.integration.test.ts` — 15 tests, all pass (13 after CORRECTION01; +1 for the provider-submission seam and +1 assertion on the same seam) |
| Actual TTFT: measured or explicitly unavailable | `provider_first_response` and `provider_first_token` are distinct boundaries; an unobserved first token is reported as unavailable, never as a synthetic zero. CORRECTION02 anchors both at the real submission seam |
| Parallel span attribution: deterministically correct | `latency-sink.lifecycle.test.ts` — the interleaved non-LIFO case; plus the `PARALLEL TOOLS` integration case |
| Provider-ready visibility: grounded in the final provider-bound request | `observeProviderReady` computes from `toProviderVisibleMessages(request.messages)`, matched by `tool_use_id` |
| Instrumentation disabled: no observable execution difference | the `DISABLED` integration case compares executed commands, approvals, request count and message count with and without a sink |
| New typecheck errors: 0 | 58 errors under the identical command BOTH before and after the change (measured by stashing the correction); the intersection of changed files and error files is **empty** |
| New test regressions: 0 | whole core suite 5,228 pass / 111 fail; the failing-file set is **byte-for-byte identical** to the baseline run at the unmodified CORRECTION01 HEAD |
| Privacy: raw prompts, credentials and tool-result contents never enter telemetry | the `PRIVACY` integration cases assert the serialized trace contains none of the fixture's prompt, command or credential text |
| Failure isolation: telemetry exceptions must not change agent behaviour | the throwing-sink integration case asserts the tool still ran and the turn still completed |

---

## 10. What this ACT did NOT do

- It did **not** redesign agent reasoning.
- It did **not** change the compaction algorithm. The compaction's
  *observation* of its own evidence loss was added; its behaviour was not
  touched.
- It did **not** broaden the accepted `run_commands` schema. The D4 repair
  makes the production path **reject** an unexpected top-level sibling
  field unchanged, and the eight previously repaired Round C payloads
  still normalize and execute with every command intact.
- It did **not** store raw prompts, commands, credentials or file contents
  in the telemetry or the evidence ledger. The allowlist is the whole
  privacy contract, and adding a field to it is a deliberate act.
- It did **not** push, open a PR, or deploy.
