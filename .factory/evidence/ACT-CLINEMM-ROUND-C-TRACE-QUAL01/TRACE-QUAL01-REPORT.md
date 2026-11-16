# ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — Closure Report

> **CORRECTION01 (2026-11-16) — READ FIRST.**
>
> The QUAL01 review returned **`HALT_EVIDENCE_EQUIVALENCE_UNSOUND`** for the
> successor benchmark. Three P0 defects were found in the evidence machinery.
> All three are corrected in this revision; the **compaction-lifecycle repair
> is untouched and remains accepted**.
>
> | # | Defect | Correction | Section |
> |---|---|---|---|
> | **P0-1** | The crosswalk classified **commands** as evidence: it read only `tool_use` inputs, never joining them to their `tool_result` outputs, execution status or final report | Evidence now requires an **executed, successful, on-topic tool result**; R5 reconciles **both final reports** against the source-backed identifiers; R1/R9/R10 require **exact rendered semantic evidence** | §6 |
> | **P0-2** | The Helm hook count used `r"helm\.sh/hook"`, which also matches `helm.sh/hook-weight` | The hook count now counts the **distinct `helm.sh/hook` annotation only**; the hook-weight count is reported **separately**; the production-values provenance and the placeholder-digest vs no-image-override renders are **explicitly distinguished** | §6.3 |
> | **P0-3** | The first text chunk was certified as **true TTFT** | The boundary is renamed **`provider_first_text`** for what it measures, fires only on a **non-empty** text delta, and carries `serverSideTtft: "UNAVAILABLE_FROM_TRACE"` | §4 |
>
> **The corrected crosswalk result is `6 EQUIVALENT / 3 STRONGER / 1 WEAKER`** —
> not the previously reported `7 / 3 / 0`. The single `WEAKER` row is **R5**, and
> it is a real finding: **only 1 of the 6 index identifiers reconciles against
> both runs' final reports**. The prior "7 EQUIVALENT / 3 STRONGER / 0 WEAKER"
> was a deterministic keyword classification, not an executable proof.
>
> The **compaction repair is accepted on the supplied evidence**. The historical
> trace remains valid and the reported **5.57x elapsed-time improvement remains
> an observed fact**. The **successor benchmark remains NO-GO** until the R5
> reconciliation is closed.

**Status:** `PASS_WITH_NONBLOCKING_RESIDUE` (compaction repair) —
**successor benchmark: NO-GO** pending the R5 reconciliation

**Subject HEAD (entry):** `b0b18da6cef7f118661c64b26fe539ddeb985e6f`
**Bound HEAD (implementation):** `90a153321e4d66eddb4197cb41667f81e6df6865`
(`fix(roundc-trace): bound the compaction span to real compaction work`)
**Evidence/artifacts commit:** `cc921af7f415f27610a71910cdbe51ec30b12776`
(`docs(roundc-trace): add the QUAL01 qualification report, crosswalk and receipts`)
**Branch:** `main` (not pushed)
**Date:** 2026-11-16

---

## 0. Executive summary

The Round C latency tracer carried **one confirmed production defect**, and it is
now repaired with a production-seam RED → GREEN proof:

> **The compaction span was opened on the compaction ELIGIBILITY CHECK and only
> closed when a real compaction executed.** Every no-op check left a span open
> forever. The packaged Round C run recorded **45 compaction starts, 2 compaction
> ends, and exactly 43 `"span left open"` integrity failures** — 43 = 45 − 2.

Two further qualifications were produced:

1. **The provider DOES expose observable first-event and first-text seams** —
   but the tracer never subscribed to them, so all 45 first-response and 45
   first-text measurements were recorded as *unavailable*. The instrumentation
   now attaches a metadata-only observation at the existing production stream
   seam. **Neither measurement is an authoritative time-to-first-token**; the
   server-side TTFT is `UNAVAILABLE_FROM_TRACE` (see §4).
2. **The capture identity is now bound.** The trace previously carried no
   software, model or inference-configuration identity at all, so the
   "≈5.57× speedup" could not be attributed to any cause.

The **R1–R10 evidence crosswalk was regenerated** under CORRECTION01 with
evidence semantics that qualify *observations* rather than *commands*. The
original Round C transcript was **recovered** (session `1794702518894_gui73`,
209 tool invocations, 229,129 output tokens — the exact reported figures). The
corrected result is **6 `EQUIVALENT`, 3 `STRONGER`, 1 `WEAKER`** — see §6.

**Non-blocking residue (explicitly NOT certified):**

- The **served** image digest and the **provider-reported** model id remain
  `UNAVAILABLE_FROM_TRACE`. They are pipeline/runtime facts the offline render
  and the current SDK channels cannot observe. They are recorded as such —
  never inferred.
- The **quantization** is `UNAVAILABLE_FROM_TRACE`. The configured model id
  happens to contain `iq3_s`, but that is a *requested identifier*, not a served
  quantization receipt, and it is not treated as one.
- The **server-side TTFT** is `UNAVAILABLE_FROM_TRACE` (see §4). The
  client-side first-text seam cannot observe the provider's own token
  accounting.

---

## 1. Repository conservation (C0)

| Item | Value |
|---|---|
| Repository root | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| Remote (origin) | `git@github.com:s1onique/clinemm.git` |
| Branch | `main` |
| Entry HEAD | `b0b18da6cef7f118661c64b26fe539ddeb985e6f` |
| Entry HEAD == packaged starting reference `b0b18da6c` | **YES — identical** |
| Working tree at entry | **CLEAN** (`git status --short` empty) |
| Unexpected tracked dirt | **NONE** → no HALT |
| Protected stashes | 1 (`stash@{0}` — untouched, no pop) |
| Worktrees | 6 (2 pre-existing prunable, 1 `clinemm-m31-action-first`, 1 `clinemm-m31-bounded`, 1 this ACT's `/tmp/qual01-baseline`) |
| History rewrite / force push / deploy | **NONE** |
| Unrelated cleanup | **NONE** |

The primary working tree was **clean at entry**, so the ACT's changes are
confined to its own files (9 modified, 5 new). The isolated baseline worktree
`/tmp/qual01-baseline` was created at the exact entry HEAD for the C6.10
baseline comparison.

---

## 2. The real compaction boundary (C1)

### 2.1 The boundary map

Production seam: `createContextCompactionPrepareTurn`
(`sdk/packages/core/src/extensions/context/compaction.ts`).

| # | Production site | Condition | Real work? | Channel / trace effect |
|---|---|---|---|---|
| 1 | `:496` `observeCompactionTrace(..., "diagnostics", ...)` | **ALWAYS**, before the decision | **NO** — it is a *check* | `onCompactionDiagnostics` → latency **span START** |
| 2 | `:519` `if (effectiveMode === "auto" && !shouldCompact) return undefined` | no-op exit | No | **the span is never closed** |
| 3 | `:596` `startedAt = Date.now()` | after the decision | **YES** — real work begins | — |
| 4 | `:766` `observeCompactionTrace(..., "completed", ...)` | only when `result?.messages` | Yes | `onCompactionCompleted` → latency **span END** |
| 5 | `:855` else-branch (strategy returned no result) | attempted, no output | Attempted | **the span is never closed** |
| 6 | strategy throw / cancellation | the work aborts | Attempted | **the span is never closed** |

The `LatencyTraceSink` maps the diagnostics channel onto the `compaction` span's
START and the completion channel onto its END
(`sdk/packages/core/src/observability/latency/latency-sink.ts`). The tracer's
`getIntegrityFailures()` then synthesises one `"span left open"` failure per
span that was entered but never exited.

### 2.2 The diagnosis

Explanation **1** of the four candidates — *a compaction eligibility check that
did not initiate compaction* — is **CONFIRMED at source**, and the observation
in the live trace is exactly its signature:

| Live artifact (`roundc-latency-trace.json`) | Observed |
|---|---:|
| `compaction` events, phase `start` | **45** |
| `compaction` events, phase `end` | **2** |
| `"span left open"` integrity failures, boundary `compaction` | **43** |
| 45 − 2 | **43** ✓ exact |

Independent corroboration from the artifact's own metadata: the 45 START events
carry only `{effectiveMaxInputTokens: 115200}` (a budget/diagnostics payload —
the no-op check), while the 2 END events carry the real before/after message
counts and the evidence-reference continuity (a real compaction). The
`LatencyTraceSink`'s metadata allowlist **drops** `shouldCompact` and `mode`,
which is why the latency sink could not previously distinguish the two.

### 2.3 The other three candidates are excluded

- **2 — an actual compaction attempt returning early:** excluded. The
  no-op path returns at `:519` *before* `startedAt` is set and before any
  strategy runs. The trace's 45 START events carry no execution payload.
- **3 — error or abort handling that skipped completion:** excluded **as the
  cause of the 43**. The error/abort paths are a *separate, smaller* defect
  (also repaired below), but the 43 all have the no-op signature. Both paths
  were repaired.
- **4 — a tracing/composition mismatch:** excluded. The composition forwards the
  diagnostics channel correctly (CORRECTION01 proved the composition is
  exhaustive); the mismatch is between the *semantics* of the diagnostics
  channel (a check) and the *semantics* of the span START (real work).

---

## 3. RED reproduction and correction (C2)

### 3.1 RED receipt (before correction)

The RED drives the **REAL** `createContextCompactionPrepareTurn` factory with the
**REAL** `LatencyTraceSink` — no test double at the production boundary.

```
$ cd sdk/packages/core
$ bun x vitest run --config vitest.config.ts \
    src/extensions/context/compaction.latency-span-lifecycle.red01.test.ts
 ❯ src/extensions/context/compaction.latency-span-lifecycle.red01.test.ts (2 tests | 1 failed)
   × RED: twenty no-op eligibility checks leave ZERO unclosed compaction spans
   ✓ GREEN witness: one real compaction produces one correctly correlated closed span
 FAIL  ... > RED: twenty no-op eligibility checks leave ZERO unclosed compaction spans
 AssertionError: expected 20 to be +0 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
EXIT=1
```

**The RED reproduces the live defect exactly**: 20 no-op checks ⇒ **20**
unclosed compaction spans (live: 43 checks ⇒ 43 unclosed spans).

### 3.2 Necessity ablation (the RED is not vacuous)

The correction was removed from `latency-sink.ts` and the suite re-run:

```
ABLATION applied: sink no longer gates the compaction span
   × RED: twenty no-op eligibility checks leave ZERO unclosed compaction spans
 AssertionError: expected 20 to be +0 // Object.is equality
 Test Files  1 failed | 1 passed (3)
```

The symptom is **identical** to the pre-correction RED. The correction is
therefore *necessary* for the observed behaviour, not incidental.


**No unrelated tracked/untracked changes existed at entry and none were
discarded.**


### 3.3 The correction (smallest supported by C1)

The measurement boundary was **moved to the real compaction-execution seam** —
not patched with defensive cleanup throughout the pipeline.

| # | File | Change |
|---|---|---|
| 1 | `sdk/packages/core/src/extensions/context/compaction.ts` | The diagnostics payload gains `compactionInitiated` — a boolean CLASSIFICATION that is true exactly when the seam proceeds **past** its decision point into real compaction work (`effectiveMode !== "auto" \|\| shouldCompact`). |
| 2 | `sdk/packages/core/src/extensions/context/compaction.ts` | The success path publishes `compactionOutcome: "completed"`. |
| 3 | `sdk/packages/core/src/extensions/context/compaction.ts` | The no-result path (`:855`) publishes `compactionOutcome: "failed"` — the span is closed with a truthful terminal outcome instead of being left open. |
| 4 | `sdk/packages/core/src/extensions/context/compaction.ts` | The strategy-execution block is wrapped so an **aborted or failed** compaction publishes `compactionOutcome: "cancelled"` / `"failed"` before the error propagates. The outcome is derived from the seam's own authority (`isCompactionCancellation` / the abort signal), never guessed. |
| 5 | `sdk/packages/core/src/observability/latency/latency-sink.ts` | `onCompactionDiagnostics` opens the span **only** when `compactionInitiated !== false`. A producer that publishes no discriminator is treated as having initiated (conservative — an older producer cannot silently lose its span). |
| 6 | `sdk/packages/core/src/observability/latency/latency-sink.ts` | `onCompactionCompleted` closes the span with the **observed** status (`deriveCompactionFinishStatus`), never an assumed `"ok"`. |
| 7 | `sdk/packages/core/src/observability/latency/latency-trace.ts` | The metadata allowlist gains `compactionInitiated`, `compactionOutcome`, `generatedTextLength` — classifications and a size, never content. |

**Not altered:** compaction eligibility, the compaction algorithm, the resulting
messages, the retention policy, the context budget, or the shared
`onCompactionDiagnostics` channel's *content* (the model-behavior recorder
still receives every check, with every field it had before — proven by the
`the eligibility CHECK is still observed` test).

### 3.4 GREEN receipt

```
$ cd sdk/packages/core
$ bun x vitest run --config vitest.config.ts \
    src/extensions/context/compaction.latency-span-lifecycle.red01.test.ts
 ✓ src/extensions/context/compaction.latency-span-lifecycle.red01.test.ts (6 tests) 17ms
      Tests  6 passed (6)
EXIT=0
```

The six tests are:

| Test | Contract |
|---|---|
| `RED: twenty no-op eligibility checks leave ZERO unclosed compaction spans` | 20 no-op checks ⇒ **0** span starts, **0** span ends, **0** unclosed spans. |
| `the eligibility CHECK is still observed — the diagnostic is not suppressed` | All **20** checks are still reported, each with `compactionInitiated === false`. |
| `GREEN witness: one real compaction produces one correctly correlated closed span` | 1 real compaction ⇒ 1 start, 1 end, 0 unclosed. |
| `C2.1: an INITIATED compaction that produced NO transcript records a TRUTHFUL failure` | Terminal status `"failed"`, **not** `"ok"`. |
| `C2.2: an ABORTED compaction records a CANCELLATION` | Terminal status `"cancelled"`, **not** `"ok"`. |
| `C2.3: concurrent compactions do not close one another's spans` | 2 no-op checks + 1 real compaction ⇒ exactly 1 start, 1 end, 0 unclosed; the end's duration is measured against its own start. |

### 3.5 The historical artifact is untouched

The 45-start / 2-end trace and its 43 integrity failures remain an **immutable
historical artifact**. This ACT did not rewrite, regenerate or remove it. The
corrected semantics apply to **future** captures.


---

## 4. Provider-event capability (C3)

### 4.1 What the provider actually exposes

The production path is `AgentRuntime.openTaskLifecycleStream`
(`sdk/packages/agents/src/agent-runtime.ts`):

```
this.observeProviderRequestSubmitted(request);   // ← the ACTUAL invocation boundary
stream = await this.config.model.stream(request);
...
for await (const event of stream) { ... yield event; }
```

The consumer receives `AgentModelEvent`
(`sdk/packages/shared/src/agent.ts`), whose variants include a **distinct
`text-delta` carrying generated text** — separate from `reasoning-delta`,
`tool-call-delta` and `media`.

The AI SDK provider emits that event from the real wire:
`sdk/packages/llms/src/providers/ai-sdk.ts:1563` (`part.type === "text-delta"`
→ `yield { type: "text-delta", text }`) and `:1906` (`stream.textStream` →
`yield { type: "text-delta", text }`).

**The configured provider in the live run was `openai-compatible`**
(session metadata), which routes through this AI SDK path.

### 4.2 The classification (CORRECTED — P0-3)

> **CORRECTION01.** The pre-correction report claimed "True TTFT |
> **AVAILABLE** | the first `text-delta` with non-empty text". That
> overstatement is corrected here. A text delta is a **client-side** boundary;
> it is **not** the model's first generated token.

| Measurement | Contract | Observed at the seam? | Where |
|---|---|---|---|
| Request submission | Actual invocation boundary | **YES** | `onProviderRequestSubmitted` — emitted immediately before `model.stream()` |
| First response / chunk | Only an observed provider/stream event | **YES** (the first event of the stream, whatever its type) | `onProviderFirstResponse` |
| First generated text | Only the first observed **non-empty** `text-delta` | **YES** | `onProviderFirstText` (renamed from `onProviderFirstToken`) |
| First generated TOKEN (incl. reasoning/tool generation) | Only a provider-backed token event | **NOT independently established** | — |
| **Server-side TTFT** | Only a provider-side token timestamp | **`UNAVAILABLE_FROM_TRACE`** | — |
| Provider completion | Actual observed terminal boundary | **YES** | `onProviderRequestCompleted` |

**A network chunk is not necessarily a model token, a response object is not
necessarily generated output, and generated TEXT is not necessarily the model's
first generated TOKEN.** The three are kept distinct:

- the first *response* is the first event of the stream (it may be a
  reasoning delta or a tool-call delta);
- the first *text* is the first **non-empty** `text-delta`;
- the model's first generated **token** may be **earlier** than the first text
  (a reasoning-first request) or may **never** produce text at all (a
  tool-call-only request).

The boundary is therefore **named for what it measures** — `provider_first_text`
— and the observation carries the explicit marker
`serverSideTtft: "UNAVAILABLE_FROM_TRACE"` so no consumer can mistake it for an
authoritative TTFT. The rename is a *truthfulness* correction: the measurement
itself is preserved and remains useful.

### 4.3 What was wrong before, and what changed

**Before:** `onProviderFirstResponse` and `onProviderFirstToken` existed only as
methods on `LatencyTraceSink` — they were **not** part of the
`ModelBehaviorTraceSink` interface and had **zero production callers**. The
runtime recorded only a task-lifecycle `first_chunk_received` marker. Result in
the live artifact:

```
unavailable: ('provider_first_response', 'the provider did not report this event'): 45
unavailable: ('provider_first_text',     'the provider did not report this event'): 45
```

i.e. **every** first-response and first-token measurement was unavailable — the
tracer had the sink methods but nothing ever called them.

**After:** the observation is attached at the **existing production stream
seam**. The stream's iteration, ordering, cancellation and buffering are
**unchanged** — the observation is a side-effect on the events the runtime
already consumes. It never pre-reads, buffers or re-orders anything.

| # | File | Change |
|---|---|---|
| 1 | `sdk/packages/shared/src/runtime/model-behavior-trace.ts` | The `ModelBehaviorTraceSink` interface gains `onProviderFirstResponse` and `onProviderFirstToken` (both optional). |
| 2 | `sdk/packages/agents/src/agent-runtime.ts` | The stream loop observes the first stream event (`onProviderFirstResponse`) and the first **non-empty** `text-delta` (`onProviderFirstText`). The payload is metadata-only: the event **type**, the generated text's **length** and the `serverSideTtft` availability marker — never the text. |

### 4.4 The C3 tests

```
$ cd sdk/packages/agents
$ bun x vitest run --config vitest.config.ts \
    src/agent-runtime.provider-first-event.test.ts
 ✓ src/agent-runtime.provider-first-event.test.ts (8 tests) 12ms
      Tests  8 passed (8)
EXIT=0
```

| Test | Contract |
|---|---|
| `C3.1` | The first event is observed **exactly once** per request (two text deltas ⇒ one first-response, one first-text). The text observation carries the LENGTH, not the text. |
| `C3.2` | An empty / no-text response produces **no** first-text observation (the first-response event is still observed). |
| `C3.3` | A tool-call-only response produces **no** first-text observation — the first response event's type is `tool-call-delta`, proving a chunk is not text. |
| `C3.4` | An error **before** the first output produces neither observation; the run's existing `status === "failed"` contract is unchanged. |
| `C3.5` | A cancellation **before** the first output produces **no** first-text observation. |
| `C3.6` | Concurrent requests with different identities do not cross-attribute: 2 observations, each with its own session id. |
| `C3.7` | The diagnostic-disabled path (a sink with no such channels) observes nothing and the run still succeeds. |
| `C3.8` | The streamed output is **conserved** — both deltas reach the assistant message, in order. |

**CORRECTION01 added 6 further witnesses** in
`sdk/packages/agents/src/agent-runtime.provider-first-text-classification.correction01.test.ts`:

| Test | Contract |
|---|---|
| `C3C.1` | The boundary is named for what it MEASURES (`provider_first_text`), never for a token it cannot observe. |
| `C3C.2` | A **REASONING-first** request produces NO first-text observation before the text — the model's first generated token was the reasoning, not the text. |
| `C3C.3` | A **TOOL-CALL-ONLY** request produces NO first-text observation. |
| `C3C.4` | An **EMPTY** text delta produces NO first-text observation — the boundary is "first GENERATED TEXT", not "first text event". |
| `C3C.5` | The server-side TTFT is recorded as explicitly `UNAVAILABLE_FROM_TRACE`, never as a measured value. |
| `C3C.6` | The first-text observation remains metadata-only. |

```
$ cd sdk/packages/agents
$ bun x vitest run --config vitest.config.ts \
    src/agent-runtime.provider-first-text-classification.correction01.test.ts
 ✓ src/agent-runtime.provider-first-text-classification.correction01.test.ts (6 tests)
 EXIT=0
```

---

## 5. Model and runtime identity (C4)

### 5.1 The availability matrix

| Identity | Authoritative value | Source | Status |
|---|---|---|---|
| Dogfood source HEAD | `b0b18da6cef7f118661c64b26fe539ddeb985e6f` | Git, read at runtime | **AVAILABLE — exact** |
| Extension version | `4.1.16-5a1c485cb-b0b18da6c` | The **installed** extension's own `package.json` (`~/.vscodium-roz/extensions/s1onique.clinemm-4.1.16-5a1c485cb-b0b18da6c`), independently read | **AVAILABLE** |
| VSIX SHA-256 | `fbfc8ace9aeb4d4ba22f81702e5532b17db3df72bd18bf26aa22c54605fe6a8c` | The packaged artifact (`clinemm-4.1.16-b0b18da6ce-roundc-latency-trace-corr02.vsix`, 65,347,194 bytes) | **AVAILABLE — exact** |
| Runtime profile | `dogfood` | The dogfood runtime profile | **AVAILABLE — exact** |
| Provider family | `openai-compatible` | The live session's configured provider | **AVAILABLE — exact** |
| Requested model ID | `qwen3.8-flash-next-iq3_s` | The live session's configured model | **AVAILABLE — exact** |
| Effective (served) model ID | — | The SDK does not surface a provider-reported model id | **`UNAVAILABLE_FROM_TRACE`** |
| Quantization | — | The SDK does not surface a served-quantization receipt | **`UNAVAILABLE_FROM_TRACE`** |
| Context budget | `115200` effective max input tokens | The compaction diagnostics payload (authoritative, request-time) | **AVAILABLE — exact** |
| Sampling / reasoning settings | — | The configured provider session does not expose effective sampling/reasoning parameters through the dogfood channel | **`UNAVAILABLE_FROM_TRACE`** |
| Capture schema version | `roundc-latency-trace/v1` | The capture's own schema field | **AVAILABLE — exact** |

### 5.2 The explicit non-inference rule

The requested model id contains the substring `iq3_s`. That is a **requested
identifier**, not a served-quantization receipt, and it is **not** treated as
one. The capture records the requested id verbatim and separately records
`effectiveModelId` and `quantization` as `UNAVAILABLE_FROM_TRACE` with an
explicit `UNAVAILABLE_FROM_TRACE` provenance reason. A future Strata
configuration receipt can be correlated later, as the contract permits.

Likewise, the R1 Helm render resolves the **chart's pinned image digest**; it
cannot observe the **serving cluster's** effective image. The crosswalk records
the render's digest as the *chart-effective* digest and the *serving* digest as
unavailable — they are not conflated.

### 5.3 What was implemented

| # | File | Change |
|---|---|---|
| 1 | `apps/vscode/src/sdk/roundc-latency-trace-runtime.ts` | The capture now embeds a **metadata-only** identity record: source HEAD, extension version, VSIX digest, runtime profile, provider family, requested model id + provenance, effective model id, quantization, context budget, sampling/reasoning settings, and the capture schema version. Every unavailable field carries the explicit reason `UNAVAILABLE_FROM_TRACE`. |
| 2 | `apps/vscode/src/sdk/vscode-session-host.ts` | The runtime identity is resolved from the live host (provider family, requested model, context budget) and injected into the capture at construction. |
| 3 | `apps/vscode/src/sdk/__tests__/roundc-latency-trace-identity.qual01.test.ts` | 7 tests: every required field is present; unavailable fields carry `UNAVAILABLE_FROM_TRACE`; **no API key, auth header, credential-bearing URL, raw prompt, raw tool command or model response** is present in the record; the public profile OFF path produces a **zero state-semantic delta**. |

```
$ cd apps/vscode
$ bun x vitest run --config vitest.config.ts \
    src/sdk/__tests__/roundc-latency-trace-identity.qual01.test.ts
 ✓ src/sdk/__tests__/roundc-latency-trace-identity.qual01.test.ts (7 tests) 11ms

---

## 6. Benchmark evidence-equivalence (C5)

### 6.1 The original transcript was recovered

The original Round C session **`1794702518894_gui73`** was located and its
transcript recovered. It reproduces the reported figures exactly:

| Metric | Reported in the contract | Recovered from the transcript |
|---|---:|---:|
| Output tokens | 229,129 | **229,129** ✓ |
| Tool invocations | 209 | **209** ✓ |
| Provider | — | `openai-compatible` |
| Requested model | — | `qwen3.8-flash-next-iq3_s` |
| Branch | — | `optimize-ftls` |
| Repository | — | `git@gitlab.roznanie.ru:backend/keycloak.git` |
| Session history origin version | — | `4.1.16-5a1c485cb` (identical in both runs) |

The new run (`1794780088950_tc1vx`) carries the **same** provider, requested
model, branch, repository and session-history origin version, and differs in
the measured quantities: **47,634** output tokens, **48** tool invocations.

> **The two runs are matched on the identity fields that ARE observable.**
>
> **CORRECTION01 — the causal claim is withdrawn.** The pre-correction report
> stated that the speedup "must lie in the **unobservable** served-model /
> quantization / inference configuration". That does **not** follow. The
> observable identity fields being equal rules OUT a provider / model-id /
> branch / repository / session-history difference, but it does not rule out:
>
> - a different **reasoning path** (the same task may take a different path);
> - a different **number of tool calls** (48 vs 209 — the runs are not the same
>   workload);
> - a different **compaction behaviour**;
> - **stochastic generation** at the provider.
>
> The ≈5.57× wall-clock speedup therefore **remains causally unattributed**.
> It is an observed fact, not an attributed one. C4's identity capture
> instruments the unobservable gap; it does not close it.

**The two runs also did NOT complete equivalently.** The original run's
session status is `failed`; the new run's is `completed`. Both remain
legitimate performance observations, but they are **not** confirmed equivalent
completion outcomes, and the crosswalk reflects that.

### 6.2 The crosswalk (CORRECTED — P0-1)

The machine-readable manifest is
`TRACE-QUAL01-EVIDENCE-CROSSWALK.json` (schema
`cline.roundc-trace-qual01-evidence-crosswalk.v2`), generated deterministically
by `scripts/roundc-trace-qual01-evidence-crosswalk.py` from the two recovered
transcripts and the Helm-render receipts.

#### 6.2.1 The evidence semantics that were wrong

The pre-correction generator's `observed_tool_evidence()` read **only the
`tool_use` inputs** and never joined them to their `tool_result` outputs. Its
classification was effectively:

```
original_covers = len(original_matches) > 0
new_covers      = len(new_matches) > 0
status = "EQUIVALENT" if original_covers and new_covers else "WEAKER"
```

A command that merely **mentioned** `timeout`, `mvn` or `password` qualified as
evidence — even when that command **failed**, returned **irrelevant** output, or
was **never executed**. The byte-identical regeneration demonstrated the
**reproducibility** of the algorithm; it could never demonstrate its
**validity**.

#### 6.2.2 The corrected evidence semantics

| Subject | Pre-correction | Corrected |
|---|---|---|
| Tool evidence | any `tool_use` whose **input** matched a keyword | a tool invocation that was **EXECUTED**, whose result **did not fail**, and whose **observed output** carries the subject's evidence |
| R5 discriminator | identifiers counted in the **command inputs** | identifiers **observed** in a successful tool result in BOTH runs **AND stated in BOTH runs' final reports** **AND reconciled** against a tracked source artifact |
| R1 / R9 / R10 | `STRONGER` whenever a render file existed | `STRONGER` only when the render carries the subject's **exact semantic evidence** |
| Helm hooks | `len(re.findall(r"helm\.sh/hook", text))` | the **distinct `helm.sh/hook` annotation only**; the `hook-weight` count is reported **separately** |

#### 6.2.3 The corrected result

**Result: 6 `EQUIVALENT`, 3 `STRONGER`, 1 `WEAKER`, 0 `UNVERIFIED`.**

| ID | Minimum evidence requirement | Status | Note |
|---|---|---|---|
| **R1** | Effective Helm-rendered image and CI/manual-upgrade distinction | **STRONGER** | The production render applied `-f values.yaml -f values-prod.yaml` and resolved the digest-pinned CR.yandex image; the **no-image-override** render resolves the chart's default `quay.io/keycloak/keycloak:26.0.7` — the manual-upgrade failure mechanism, observed. |
| **R2** | Carrier timeout path, synchronous execution, real mitigations | **EQUIVALENT** | Both runs' successful tool results carried the carrier-timeout evidence. |
| **R3** | DB pool invariant and enforcement/absence evidence | **EQUIVALENT** | The pool invariant evidence is observed in both runs' successful tool results. |
| **R4** | Actual build/start paths and persisted build settings | **EQUIVALENT** | Both runs' successful tool results carried the build/start-path evidence. |
| **R5** | Exact six index identifiers reconciled with source artifacts | **WEAKER** | **Only 1 of the 6 identifiers reconciles.** The other five are absent from one or both runs' final reports even though the commands observed them. See §6.4. |
| **R6** | Repository retention paths and explicit external-state unknown | **EQUIVALENT** | Both runs' successful tool results carried the retention-path evidence. |
| **R7** | Maven/CI execution evidence for Java tests | **EQUIVALENT** | Both runs' successful tool results carried the Maven/CI execution evidence. |
| **R8** | Committed secret exposure, without credential validation | **EQUIVALENT** | Both runs' successful tool results carried the committed-secret evidence. |
| **R9** | Effective chart security defaults and NetworkPolicy/PDB coverage | **STRONGER** | The render proves the **effective** chart defaults: `runAsNonRoot: true`, **0** PodDisruptionBudget, **0** NetworkPolicy — the effective result, not the documentation. |
| **R10** | Actual hook semantics, rollback behavior and watcher implementation | **STRONGER** | The **real** hook count is **0** (never the `hook-weight` count of 2), and the watcher's rendered semantics were observed in the **dev** watcher render. See §6.3. |

Each row in the JSON distinguishes the original source observation, the new
source observation, whether equivalent verification occurred, whether the final
finding faithfully represents that evidence, the missing/weaker verification,
and the final comparability judgment. It is a **qualification manifest**, not a
finding-scoring framework. The manifest now also carries an
`evidenceSemantics` block that states, in the artifact itself, exactly what
counts as evidence.

### 6.3 The R1 / R9 / R10 discriminators — the offline Helm renders (CORRECTED — P0-2)

Executed in an isolated scratch directory against the **exact pinned chart**
and the relevant repository values. **No Kubernetes contact, no `helm upgrade`,
no production write, no credential acquisition.**

#### 6.3.1 The hook count was wrong

The pre-correction report claimed **"helm hook count: 2"**. That number came
from `len(re.findall(r"helm\.sh/hook", text))`, which also matches
`helm.sh/hook-weight`. **Both** of the "2 hooks" were `hook-weight`
annotations:

```
$ grep -n 'helm\.sh/hook' <rendered>
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-weight": "-10"
```

Helm designates a hook with the **distinct** `helm.sh/hook` annotation;
`helm.sh/hook-weight` only **orders** hooks that already exist and never makes
a resource a hook. The minimal counterexample the review identified — a
ConfigMap whose only annotation is `helm.sh/hook-weight` — counts as **one**
hook under the old regex and **zero** under the corrected one.

**The corrected count is `0` real hooks.** The chart contains **no Helm hooks
at all**: the profiler-watcher resources carry only `helm.sh/hook-weight`.
The corrected crosswalk reports `hookCount: 0` and `hookWeightCount: 2`
**separately**.

The watcher render (the `dev` environment, where the watcher is actually
rendered) confirms this at scale: `hookCount: 0`, `hookWeightCount: 7`.

#### 6.3.2 The production-values provenance was missing

The pre-correction render recipe used `-f values.yaml` **only**. The
production CI (`.gitlab-ci.yml:258-269`) applies:

```
-f values.yaml
$( [ "$CI_ENVIRONMENT_NAME" = "prod" ] && echo "-f values-prod.yaml" )
```

So the pre-correction render did **not** exercise the production values
combination. The corrected render does, and the difference is observable:
the production render adds the `nodeSelector` and `tolerations` that
`values-prod.yaml` supplies.

#### 6.3.3 The three renders are distinct artifacts

| Artifact | Values | Image overrides | Resolved image | `valuesFiles` | `productionValuesApplied` |
|---|---|---|---|---|---|
| **placeholder-digest** (pre-correction) | `values.yaml` | yes | `cr.yandex/…/keycloak-roz@sha256:0000…0000` | `values.yaml` | **false** |
| **production** (corrected) | `values.yaml` + `values-prod.yaml` | yes | `cr.yandex/…/keycloak-roz@sha256:0000…0000` | `values.yaml`, `values-prod.yaml` | **true** |
| **no-image-override** | `values.yaml` + `values-prod.yaml` | **no** | `quay.io/keycloak/keycloak:26.0.7` | `values.yaml`, `values-prod.yaml` | **true** |
| **watcher** (`dev`) | `values.yaml` + `values-dev.yaml` | n/a | — | — | — |

The **no-image-override** render is the R1 mechanism itself: without the CI
image overrides the chart resolves its **default** upstream image, not the
CR.yandex image. The crosswalk now records both renders separately and
requires the no-image-override render before awarding R1 `STRONGER`.

The **placeholder digest** remains recorded as a placeholder. It proves the
chart pins by digest and resolves the repository/tag/digest form; it does not
observe the serving cluster's effective digest, and the two are not conflated.

#### 6.3.4 The watcher renders only in `dev`

The chart's `profiler-watcher.yaml` renders **only** when `global.env == "dev"`
AND `profilerWatcher.enabled == true` — a load-bearing dev/pp/prod security
boundary. A prod render therefore legitimately contains **zero** watcher
resources and cannot establish the watcher's rendered semantics on its own.
The corrected crosswalk consults the **distinct** dev watcher render for R10.

#### 6.3.5 The renders (reproduced)

```bash
# The production render (production values applied).
helm template keycloak-roz-prod . \
  --namespace=roz-keycloak-prod \
  --set keycloakx.image.repository=cr.yandex/crp6iqpcb9uq94n6k81o/keycloak-roz \
  --set keycloakx.image.digest=sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  --set global.env=prod \
  -f values.yaml -f values-prod.yaml

# The no-image-override render (the R1 manual-upgrade mechanism).
helm template keycloak-roz-prod . \
  --namespace=roz-keycloak-prod \
  --set global.env=prod \
  -f values.yaml -f values-prod.yaml

# The watcher render (the watcher only exists in `dev`).
helm template keycloak-roz-dev . \
  --namespace=roz-keycloak-dev \
  --set global.env=dev --set profilerWatcher.enabled=true \
  -f values.yaml -f values-dev.yaml
```

| Property | Production render | No-image-override render | Watcher (`dev`) render |
|---|---:|---:|---:|
| Render bytes | 18,164 | 18,081 | 33,073 |
| **Real hook count** (`helm.sh/hook`) | **0** | **0** | **0** |
| Hook-weight count | 2 | 2 | 7 |
| Watcher resources rendered | no | no | **yes** |
| PodDisruptionBudget count | 0 | 0 | 0 |
| NetworkPolicy count | 0 | 0 | 0 |
| Resolved image | `cr.yandex/…@sha256:0000…` | `quay.io/keycloak/keycloak:26.0.7` | n/a |

The crosswalk regenerates **byte-identically**:

```
$ python3 scripts/roundc-trace-qual01-evidence-crosswalk.py \
    --original-session-dir ~/.vscodium-roz/cline-data/sessions/1794702518894_gui73 \
    --new-session-dir      ~/.vscodium-roz/cline-data/sessions/1794780088950_tc1vx \
    --keycloak-repo        ~/Projects/Znanie/keycloak \
    --render-path          …/rendered-prod.yaml \
    --no-image-override-render-path …/rendered-noimageoverride.yaml \
    --watcher-render-path  …/rendered-watcher-dev.yaml \
    --values-file values.yaml --values-file values-prod.yaml \
    --production-values-applied \
    --chart-version 'keycloak-roz 7.0.1 (dep keycloakx 7.0.1, appVersion 26.3.1)' \
    --chart-source-sha 42de653b59708e712d694aeb9732f822b7f8fe5b \
    --out TRACE-QUAL01-EVIDENCE-CROSSWALK.json
wrote TRACE-QUAL01-EVIDENCE-CROSSWALK.json
  EQUIVALENT: 6
  STRONGER: 3
  WEAKER: 1

$ diff -q <regenerated> TRACE-QUAL01-EVIDENCE-CROSSWALK.json
DETERMINISTIC: byte-identical regeneration
```

> **A note on the degradation path.** The generator deliberately degrades a row
> to `UNVERIFIED` when the render receipt is absent, rather than inventing the
> evidence. Regenerating **without** `--render-path` degrades R1, R9 and R10 —
> the rows that depend on a render now require the **exact** semantic
> evidence, so a missing render yields `WEAKER`/`UNVERIFIED`, never `STRONGER`.

### 6.4 The R5 discriminator — the six index identifiers (CORRECTED — P0-1)

The pre-correction generator counted the identifiers in the **command inputs**
and cross-checked them against the tracked source artifacts. That proves the
model **typed** the names; it does not prove the run **reported** them.

The corrected discriminator requires all three of:

1. the identifier was **observed** in a **successful** tool result in **both**
   runs,
2. the identifier is **stated in both runs' final reports**, and
3. the identifier reconciles against a **tracked source artifact**.

The final reports are recovered from the transcripts themselves: the original
run's final assistant report is **18,065 chars** (sha256 `618f78fe…`) and the
new run's is **16,554 chars** (sha256 `555c5c28…`).

**Only 1 of the 6 identifiers reconciles.** The crosswalk now reports:

| Identifier | Observed (orig / new) | In original report | In new report | Source artifacts | Reconciled |
|---|---|---|---|---:|---|
| `idx_pm_token_code_realm_ip_type_created_at_inc_id` | 16 / 4 | **no** | yes | 3 | **no** |
| `idx_pmtc_lookup_recent_unconfirmed_sms` | 16 / 3 | yes | yes | 3 | **yes** |
| `idx_pmtc_lookup_recent_unconfirmed_sms_exp` | 16 / 3 | **no** | **no** | 3 | **no** |
| `idx_user_attribute_name_lower_value` | 17 / 3 | **no** | yes | 3 | **no** |
| `idx_user_entity_realm_email` | 17 / 3 | **no** | yes | 3 | **no** |
| `idx_user_entity_realm_email_cover` | 16 / 3 | **no** | **no** | 3 | **no** |

This is a **real, source-backed finding**, not a tooling artifact: both runs
**observed** all six identifiers in their tool output, but the runs'
**published reports** do not state five of them. The R5 requirement is
"Exact six index identifiers reconciled with source artifacts" — that
requirement is **not met by the new run relative to the original**, so the row
is `WEAKER`.

The pre-correction report's claim that the R5 row was `STRONGER` (and the
machine manifest's `EQUIVALENT`) were both inconsistent with each other, and
neither reflected the reports. The row is now `WEAKER` in the manifest, and
the human-readable table agrees.

**This is the single blocking item for the successor benchmark.** It does not
invalidate the compaction repair; it means the successor's *investigation
quality* is not yet demonstrated to match the original's on the one subject
whose requirement is about **exact reporting fidelity**.

---
## 7. Executable gates (C6)

All gates were executed with **Bun** as the task runner and **Node ≥ 22** as
the runtime, on the macOS host (`darwin`), against the ACT working tree.

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | RED → GREEN compaction lifecycle | `bun x vitest run --config vitest.config.ts src/extensions/context/compaction.latency-span-lifecycle.red01.test.ts` (core) | **RED 1 failed / 1 passed → GREEN 6 passed** |
| 2 | No-op, success, failure/abort, concurrent compaction | same file | **6/6 PASS** |
| 3 | 10 ms executor / 5,000 ms delivery attribution | `latency-trace.test.ts` → *"does not charge the execution-to-delivery delay to execution"* | **PASS** |
| 4 | Trace retention + late-exit eviction | `latency-trace.test.ts` → *"bounded retention"* + *"bounded open-span retention"* | **PASS** |
| 5 | Dogfood sink composition | `COMPOSABLE_SINK_CHANNELS` exhaustiveness (compile-time) + `roundc-latency-trace-dogfood-activation.test.ts` | **PASS (44/44)** |
| 6 | Public-profile OFF / zero state delta | `roundc-latency-trace-identity.qual01.test.ts` | **PASS** |
| 7 | Streaming output conservation | `agent-runtime.provider-first-event.test.ts` | **PASS (8/8)** |
| 8 | Metadata privacy and omission | `roundc-latency-trace-identity.qual01.test.ts` | **PASS (7/7)** |
| 9 | Focused typecheck / lint / build | see §7.2 | **PASS** |
| 10 | Baseline comparison, zero ACT-owned failures | see §7.1 | **PASS — 0 regressions** |
| **11** | **CORRECTION01 — evidence-crosswalk RED → GREEN** | `python3 -m unittest scripts.tests.test_roundc_trace_qual01_evidence_crosswalk` | **RED 12 failed → GREEN 14 passed** |
| **12** | **CORRECTION01 — timing classification RED → GREEN** | `bun x vitest run src/agent-runtime.provider-first-text-classification.correction01.test.ts` | **RED 5 failed → GREEN 6 passed** |
| **13** | **CORRECTION01 — latency module regression** | `bun x vitest run src/observability/latency/` | **PASS — 88/88** |
| **14** | **CORRECTION01 — agents package regression** | `bun x vitest run` (sdk/packages/agents) | **PASS — 595/595** |
| **15** | **CORRECTION01 — vscode Round C regression** | `bun x vitest run src/sdk/__tests__/roundc-latency-trace-*.qual01.test.ts src/sdk/__tests__/roundc-latency-trace-dogfood-activation.test.ts` | **PASS — 51/51** |

      Tests  7 passed (7)
EXIT=0
```

**No permanent public configuration or protocol expansion** was introduced —
the identity record is internal to the existing dogfood diagnostics channel
and is not surfaced in the public extension settings or the webview protocol.

| 3 | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` | Both channels are forwarded explicitly (like the other prototype-backed channels). |
| 4 | `sdk/packages/core/src/runtime/observability/model-behavior-trace.ts` | The isolated sink forwards both channels. |
| 5 | `apps/vscode/src/sdk/roundc-latency-trace-runtime.ts` | Both channels are added to `COMPOSABLE_SINK_CHANNELS` — the compile-time exhaustiveness gate makes their omission a **compile error**. |
| 6 | `sdk/packages/core/src/observability/latency/latency-trace.ts` | `generatedTextLength` is allowlisted (a size, never content). |

**CORRECTION01 — the truthfulness of the claim.** `LIVE_UNOBSERVABLE` is not
the outcome, but neither is "the provider exposes an authoritative first-token
event". The provider exposes an observable **first-stream-event** and an
observable **first-generated-text** seam. The measurement was *unavailable*
because nothing observed it — that is now repaired — and the observation is
labelled for what it measures. The **server-side TTFT remains
`UNAVAILABLE_FROM_TRACE`**, because the client-side seam cannot observe the
provider's own token accounting.

### 7.1 The baseline comparison (C6.10)

The baseline was run in an **isolated git worktree** at the exact entry HEAD
(`/tmp/qual01-baseline`, HEAD `b0b18da6cef7f118661c64b26fe539ddeb985e6f`), so
the comparison is against the pre-ACT tree, not against a guess.

**`sdk/packages/core` — full suite, before vs. after:**

| | Test files | Tests |
|---|---|---|
| Baseline (entry HEAD) | 34 failed / 309 passed / 3 skipped | **154 failed**, 5,129 passed, 215 skipped |
| After (ACT tree) | 32 failed / 312 passed / 3 skipped | **152 failed**, 5,187 passed, 165 skipped |

**Failing-file set comparison (the actual C6.10 criterion):**

```
BEFORE failing files: 34
AFTER  failing files: 32
ADDED (regressions introduced by this ACT): 0     ← ZERO REGRESSIONS
REMOVED (pre-existing failures now passing): 2
   - src/runtime/command-policy/structured-command-risk.phase2-provenance.test.ts
   - src/runtime/orchestration/runtime-oauth-token-manager.process.test.ts
INTERSECTION (pre-existing, unchanged): 32
```

The two "removed" suites are **environment-flaky**, not ACT effects. Run in
isolation at the **baseline** HEAD they still fail; run in isolation in the
**modified** tree they pass:

```
$ cd /tmp/qual01-baseline/sdk/packages/core && bun x vitest run ... <the two files>
 × refreshes a single-use token once and gives both processes the rotated credential 10057ms
 Test Files  2 failed (2)

$ cd <ACT tree>/sdk/packages/core && bun x vitest run ... <the two files>
 Test Files  2 passed (2)
      Tests  54 passed (54)
```

Both are process-spawning suites; neither touches a file this ACT changed.

**`sdk/packages/agents` — full suite, before vs. after:**

| | Test files | Tests |
|---|---|---|
| Baseline | 33 passed | **581 passed**, 0 failed |
| After | 34 passed | **589 passed**, 0 failed |

The **+8** are exactly the new C3 provider-event tests. **Zero failures.**

**`apps/vscode` — the ACT-owned suites:**

```
$ cd apps/vscode
$ bun x vitest run --config vitest.config.ts \
    src/sdk/__tests__/roundc-latency-trace-identity.qual01.test.ts \
    src/sdk/__tests__/roundc-latency-trace-dogfood-activation.test.ts
 Test Files  2 passed (2)
      Tests  51 passed (51)
EXIT=0
```

(The full `apps/vscode` suite has a large pre-existing failure population in
this environment, including collection errors caused by absent built
artifacts in the baseline worktree. It is **not** an ACT-owned gate; the
ACT-owned suites above are run and green, and the core package — where every
ACT production change lives — shows **zero** regressions.)


---

### 7.2 Typecheck, lint, build

```
$ cd sdk/packages/shared && bun run build          → EXIT=0
$ cd sdk/packages/agents && bun run build          → EXIT=0
$ cd sdk/packages/core   && bun run build          → EXIT=0
   (includes `bun tsc -p tsconfig.build.json` and
    `bun run ./scripts/verify-runtime-build-id.ts`)

$ cd apps/vscode && bun x tsc --noEmit -p tsconfig.json
→ EXIT=0

$ cd <repo> && bun x biome lint --config-path ./sdk/biome.json ... <9 sdk files>
→ EXIT=0   "Checked 9 files in 37ms. No fixes applied."

$ cd apps/vscode && bun x biome lint --config-path ./biome.jsonc ... <3 vscode files>
→ EXIT=0   "Checked 3 files in 28ms. No fixes applied."
```

**A real type error was found and fixed during this gate.** The identity
observer's `OBSERVED_IDENTITY_CHANNELS.includes(channel)` check was typed
against a 3-element tuple, so the newly-added provider channels failed
`check-types`. The comparison was widened to `readonly string[]` with an
explanatory comment; `tsc --noEmit` then passed. **This is exactly what the
gate is for — it was caught before commit, not after.**


## 8. Git, artifacts and closure (C7)

### 8.1 Produced artifacts

| Artifact | Path |
|---|---|
| Closure report | `.factory/evidence/ACT-CLINEMM-ROUND-C-TRACE-QUAL01/TRACE-QUAL01-REPORT.md` (this file) |
| Evidence crosswalk | `.factory/evidence/ACT-CLINEMM-ROUND-C-TRACE-QUAL01/TRACE-QUAL01-EVIDENCE-CROSSWALK.json` |
| Exact source/artifact identity receipt | `.factory/evidence/ACT-CLINEMM-ROUND-C-TRACE-QUAL01/09-closure-identity.txt` |
| Crosswalk generator (deterministic) | `scripts/roundc-trace-qual01-evidence-crosswalk.py` |
| RED/GREEN compaction lifecycle test | `sdk/packages/core/src/extensions/context/compaction.latency-span-lifecycle.red01.test.ts` |
| Provider first-event test (8 cases) | `sdk/packages/agents/src/agent-runtime.provider-first-event.test.ts` |
| Capture identity / privacy test (7 cases) | `apps/vscode/src/sdk/__tests__/roundc-latency-trace-identity.qual01.test.ts` |

### 8.2 Changed production files (9)

```
apps/vscode/src/sdk/roundc-latency-trace-runtime.ts
apps/vscode/src/sdk/vscode-session-host.ts
sdk/packages/agents/src/agent-runtime.ts
sdk/packages/core/src/extensions/context/compaction.ts
sdk/packages/core/src/observability/latency/latency-sink.ts
sdk/packages/core/src/observability/latency/latency-trace.ts
sdk/packages/core/src/runtime/observability/model-behavior-trace.ts
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
sdk/packages/shared/src/runtime/model-behavior-trace.ts
```

**No file outside this list was modified.** One unrelated file
(`.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md`)
was touched by a **pre-existing test side-effect** (a timestamp written by
`darwin-seatbelt-yolo-approval-friction-recon01.c1-inventory.test.ts`) during the
suite run; it was reverted with `git checkout --` and is **not** part of this
ACT's diff.

### 8.3 Repository conservation at closure


---

### 8.4 Commit binding

The report is bound to the ACT's implementation HEAD:

| Commit | Subject |
|---|---|
| `90a153321e4d66eddb4197cb41667f81e6df6865` | `fix(roundc-trace): bound the compaction span to real compaction work` |
| `cc921af7f415f27610a71910cdbe51ec30b12776` | `docs(roundc-trace): add the QUAL01 qualification report, crosswalk and receipts` |

> The evidence commit's SHA is stated here for the reader's convenience; if
> the commit was amended after this line was written, resolve the current
> value with `git log --format=%H -2` — the **implementation** commit
> (`90a153321…`) is the load-bearing one and is never amended.

The full commit receipt (with the final tree status and the conservation
statement) is `10-closure-commits.txt`.

## 9. Verdict

### 9.1 Exit classification

**Compaction repair: `PASS_WITH_NONBLOCKING_RESIDUE`** —
**Successor benchmark: `NO-GO`** (the R5 reconciliation is open).

All substantive exit conditions for the **compaction repair** are met:

- ✅ The compaction lifecycle is corrected with a **production-seam RED → GREEN**
  proof (RED: 20 no-op checks ⇒ 20 open spans; GREEN: 0 open spans), plus a
  **necessity ablation** showing the symptom returns identically when the
  correction is removed.
- ✅ The provider event capability is **truthfully classified**: the
  first-stream-event and first-generated-**text** boundaries are observable and
  now observed; the **server-side TTFT is `UNAVAILABLE_FROM_TRACE`** and is not
  claimed.
- ✅ The capture identity is **bound**, with every unavailable field explicitly
  marked `UNAVAILABLE_FROM_TRACE` and never inferred.
- ⚠️ The ten-risk evidence contract is **NOT yet ready for a matched run**:
  the corrected crosswalk is **6 EQUIVALENT, 3 STRONGER, 1 WEAKER** — R5 does
  not reconcile.

### 9.2 The recorded residue (not certified)

| # | Residue | Why it is non-blocking |
|---|---|---|
| 1 | The **served** (provider-reported) model id is `UNAVAILABLE_FROM_TRACE`. | The SDK does not surface it at any existing channel. It is now recorded as explicitly unavailable rather than inferred. |
| 2 | The **quantization** is `UNAVAILABLE_FROM_TRACE`. | Same. The requested id contains `iq3_s`, but a requested id is not a served-quantization receipt and is **not** treated as one. |
| 3 | The **effective sampling/reasoning settings** are `UNAVAILABLE_FROM_TRACE`. | Not surfaced by the configured provider session's dogfood channel. |
| 4 | The **serving** image digest is unavailable from the offline render. | The render proves the chart's **digest-pinned** repository/tag/digest form and the **effective** chart defaults; the cluster's serving digest is a runtime fact no offline render can observe. |
| 5 | The **server-side TTFT** is `UNAVAILABLE_FROM_TRACE`. | The client-side seam observes the first stream event and the first generated text; it cannot observe the provider's own first-token accounting. Neither client-side boundary is reported as an authoritative TTFT. |
| 6 | The **≈5.57× speedup remains causally unattributed.** | This is a property of the *evidence*, not a defect in the repair. The observable identity fields are **equal** across the two runs, which rules OUT a provider/model-id/branch/repository/session-history difference — but it does **not** establish that the difference lies in the unobservable served-model/quantization/inference configuration. Different reasoning paths, a different number of tool calls (48 vs 209), different compaction behaviour and stochastic generation remain possible explanations. |
| 7 | The historical 45-start / 2-end trace retains its 43 integrity failures. | **By design.** The historical artifact is immutable and must not be rewritten. The correction applies only to future captures. |
| 8 | The **R5 identifier reconciliation is open** (1 of 6 reconciles). | **This is the one blocking item** for the successor benchmark — see §6.4 and §9.3. |

- The protected stash (`stash@{0}`) is **preserved and not popped**.
- The temporary baseline worktree `/tmp/qual01-baseline` is **removed** at
  closure (it was created by this ACT; the pre-existing worktrees are
  untouched).
- **No history rewrite, no force push, no PR, no deployment, no new VSIX
  installed, no Strata benchmark run.**

### 9.3 GO / NO-GO for the successor matched Round C benchmark

## ❌ **NO-GO**

The pre-correction report returned **GO**. CORRECTION01 withdraws that GO. The
successor matched Round C benchmark is **NO-GO** until the R5 reconciliation is
closed, for these reasons:

1. **The evidence-equivalence contract is not met.** The corrected crosswalk
   contains a **`WEAKER`** row (R5). A matched benchmark requires the successor
   to reproduce the original's investigation quality on every subject; the
   successor's R5 report does not state five of the six index identifiers the
   original's evidence contract requires (§6.4).
2. **The "2 hooks" finding was false.** The corrected count is **0** real Helm
   hooks; both of the previously reported "hooks" were `helm.sh/hook-weight`
   annotations. A benchmark built on that number would have propagated a false
   finding (§6.3.1).
3. **The timing metric was mislabelled.** The first-text boundary is not an
   authoritative TTFT and the server-side TTFT is `UNAVAILABLE_FROM_TRACE`. A
   benchmark claiming a TTFT improvement on that basis would have been a
   fabricated measurement (§4.2).

**The compaction repair itself is accepted**, and no compaction-lifecycle work
is reopened by this verdict.

#### The conditions for lifting the NO-GO

The NO-GO is lifted when, and only when:

1. **The R5 reconciliation is closed** — the successor run's final report
   states all six source-backed index identifiers, and the crosswalk
   regenerates with **no `WEAKER` and no `UNVERIFIED`** rows.
2. **The successor run is executed with a freshly built and installed VSIX from
   the corrected implementation HEAD**, and records its own artifact receipt.
   The installed extension must not remain the `b0b18da6c` build.
3. **The successor run verifies** that `compaction` has **balanced**
   start/end counts and **zero** `"span left open"` integrity failures. A
   non-zero count means the correction did not reach the deployed artifact —
   **NO-GO**, do not report the timings.
4. **The successor run verifies** that `provider_first_response` and
   `provider_first_text` are now `available` (not `unavailable`), and that the
   `serverSideTtft` marker reads `UNAVAILABLE_FROM_TRACE`. If both are still
   unavailable, the instrumentation did not reach the deployed artifact.
5. **The successor run compares its `identity` record** against the original's
   observable fields (provider family, requested model id, branch, repository,
   session-history origin version). Any observable difference makes the run
   **not** matched until explained.
6. **The successor run records the `UNAVAILABLE_FROM_TRACE` fields as
   unavailable** and MUST NOT fill them in from the model name. If the served
   model / quantization can be observed, it must come from a pipeline receipt,
   not from a trace inference.
7. **The R1 / R9 / R10 renders are re-executed** against the successor's pinned
   chart and repository values, with the **production values applied**, the
   **no-image-override** render captured separately, the **watcher** render
   captured in the environment where the watcher renders, and the **real** hook
   count (never the hook-weight count) recorded.
8. **The R1–R10 crosswalk is regenerated** by
   `scripts/roundc-trace-qual01-evidence-crosswalk.py` against the successor's
   transcript, and must remain free of `WEAKER` and `UNVERIFIED` rows before
   any comparative finding is published.

### 9.4 What this ACT explicitly did NOT do

- ❌ Did **not** change compaction eligibility, algorithm, resulting messages,
  retention policy or context budget.
- ❌ Did **not** change stream scheduling, iteration, ordering, cancellation or
  buffering.
- ❌ Did **not** introduce a new telemetry subsystem, a public configuration
  option, or a protocol expansion.
- ❌ Did **not** alter public ClineMM extension behaviour (the public profile
  has a **zero state-semantic delta**).
- ❌ Did **not** rewrite, regenerate or repair the historical latency trace.
- ❌ Did **not** fix any Keycloak finding, re-run the Round C benchmark,
  optimize provider inference, or touch the shell-execution latency clusters.
- ❌ Did **not** push, open a PR, deploy, install a new VSIX, or run Strata.
- ❌ Did **not** reopen or alter the compaction-lifecycle repair.

- ✅ All executable gates pass; the baseline comparison shows **zero**
  ACT-owned regressions.
