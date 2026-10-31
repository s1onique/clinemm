# `agent-trace/0.1` — Harness-Neutral Agent Execution Trace Contract

**ACT:** `ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01`
**Status:** candidate contract, frozen for `PASS_RECON` review
**Reference implementation:** `apps/vscode/src/sdk/normalize-agent-trace.ts`
**Reference witnesses:** `apps/vscode/src/sdk/__tests__/agent-trace-contract-recon01.test.ts`

---

## 1. Purpose

`agent-trace/0.1` is a **portable** description of what an agent harness actually
did during a run. It exists so that two independent harnesses can be compared
on axes that mean the same thing in both:

| Axis | What it answers |
|---|---|
| model usage | how many requests, how many tokens in/out, how much cache reuse |
| execution time | how long each observable span took, and **what** it measured |
| tool activity | which tools ran, with what typed outcome, for how long |
| reasoning configuration | what was **requested**, what was **serialized**, what the provider **reported** |
| context management | how large the input got, when compaction fired, what it saved |
| workspace changes | what the editor did, and what **survived** to the end |
| correctness evidence | what an **independent** evaluator concluded |

The contract is deliberately **not** a telemetry product, a data model for a
database, or an OpenTelemetry attribute set. It is a **record shape** and a
**set of rules about what a record may claim**.

---

## 2. Non-dependencies (the contract's defining constraints)

The contract MUST NOT depend on:

- any harness's class names or runtime architecture;
- any harness's event names or plugin interfaces;
- a particular model provider;
- a particular tool catalog;
- a particular editor implementation;
- a particular telemetry backend or exporter.

The ClineMM-native mapping in `cline-native-to-portable.md` is the *adapter*,
not the contract. Deleting that mapping would leave the contract intact.

---

## 3. Record shape

One JSON object per line (JSONL). Every record carries:

```jsonc
{
  "contract": "agent-trace/0.1",       // REQUIRED
  "recordId": "<adapter-local>",        // REQUIRED, deterministic, NOT causal
  "harness": "<harness-name>",          // REQUIRED
  "nativeEventId": 7,                   // REQUIRED — the source's own id
  "nativeEventType": "model_request_start", // REQUIRED — the source's own type
  "sourceOrder": 7,                     // REQUIRED — the source's ordering
  "nativeTraceId": "<source trace id>", // REQUIRED
  "family": "model",                    // REQUIRED — the portable family
  "sourceEvidenceBoundary": "partial_identity", // REQUIRED — verbatim
  "evidenceQuality": "REAL",            // REQUIRED — the portable vocabulary
  "correlationCompleteness": "partial_identity", // REQUIRED
  "timestamp": "2026-10-31T06:34:19.546Z",       // REQUIRED
  "durationMs": 3002,                   // OPTIONAL — never invented
  "durationProvenance": "provider_request_wall_clock", // REQUIRED when durationMs present
  "identity": { /* see §4 */ },         // REQUIRED
  "payload": { /* family-specific */ }, // REQUIRED
  "traceTruncated": false               // REQUIRED
}
```

### 3.1 The terminal summary is NOT a record

A source capture may end with a **summary** line (a dump artifact carrying
truncation metadata). The summary is:

- **recognized separately** from agent events,
- **consumed** for truncation status,
- **never emitted** as a portable record.

Emitting it as a record would present a dump artifact as an observation.

---

## 4. Identity

```jsonc
{
  "sessionId": "...",          // harness session, when established
  "taskId": "...",             // harness conversation/task, when established
  "runId": "...",              // harness run, when established
  "runIdNamespace": "agent_runtime",  // REQUIRED when runId present
  "iteration": 12,             // harness iteration, when established
  "providerId": "...",         // OPTIONAL — the contract is provider-neutral
  "modelId": "...",            // OPTIONAL
  "wireRequestId": "req_...",  // OPTIONAL — the provider-transport join key
  "toolCallId": "call_..."     // OPTIONAL — the tool-call join key
}
```

### 4.1 Rules

1. **Missing stays missing.** An identity the source did not establish is
   **absent** — never `null`, never `""`, never a generated id.
2. **A record id is not an identity.** `recordId` is a deterministic
   adapter-local handle for de-duplication and citation. It confers **no**
   causal authority. A reader that treats `recordId` as a correlation key is
   misusing the contract.
3. **Namespaces are explicit.** When a harness has more than one id namespace,
   the namespace travels **with** the id. Two ids from different namespaces are
   never equal, even when the strings match.
4. **`wireRequestId` is a transport-scoped join key.** It identifies one
   serialized provider request. It is **not** a model-loop iteration and is
   **not** comparable to another harness's request id.
5. **`toolCallId` is owner-scoped.** The pair
   `(sessionId, runId, toolCallId)` identifies a call. The bare `toolCallId`
   does not: two owners may issue the same id.

---

## 5. Event families

| Family | Purpose | Native ClineMM producers |
|---|---|---|
| `run` | harness/session lifecycle and termination | `loop_verdict`, `run_terminated` |
| `model` | requests, provider routing, reasoning controls, usage, latency | `model_config`, `effective_model_config`, `model_request_start`, `model_request_finish`, `model_wire_reasoning` |
| `tool` | tool invocations, typed runtime outcomes, duration | `tool_start`, `tool_finish` |
| `process` | **actual** subprocess/job results, where independently observable | **none in ClineMM** |
| `workspace` | editor actions, filesystem effects, retained changes | `edit_attempt`, `edit_target_resolved`, `edit_application`, `edit_failure`, `edit_write_verification`, `edit_checkpoint_observation` |
| `context` | compaction, input budgets, cache observations | `compaction_diagnostics`, `compaction_completed` |
| `acceptance` | test outcomes and independent correctness evidence | **none in ClineMM** |

A family with no producer in a given harness is **reported as empty**, never
synthesized. `process` and `acceptance` are exactly that in ClineMM today.

---

## 6. The five distinctions the contract MUST preserve

These are the failure modes that make cross-harness comparison dishonest.
Each is a **rule**, not a convention.

### 6.1 A tool invocation is NOT a subprocess exit

```
tool invocation completed      ≠      shell subprocess exited 0
```

A shell command can fail while the enclosing tool completes successfully. The
`tool` family and the `process` family are separate. A `tool` record **may not**
carry an exit code unless the source observed one at the process boundary.

Where no authoritative process outcome exists, the process fact is
**unobservable** — never inferred from the tool outcome.

### 6.2 Reasoning is THREE facts

| Fact | Meaning |
|---|---|
| requested | what the **user/harness configuration** asked for |
| wire | what was actually **serialized** onto the provider wire |
| provider-reported | what the **provider said it consumed** |

For example:

```
requested effort: low        (requestedReasoningEffort)
wire thinking mode: adaptive (wireThinkingMode)
wire effort: low             (wireOutputConfigEffort)
```

These are **separate observations** and a contract consumer may compare them
across harnesses **only** as separate series. Merging them loses the single
most important cross-harness fact: whether a harness's configuration actually
reaches the provider.

> **Never infer provider reasoning-token counts from reasoning-content bytes.**
> Bytes are a transport artifact; tokens are a provider-reported accounting
> fact. The `model` family carries them as distinct fields and no rule may
> convert one into the other.

### 6.3 Editing is FOUR stages

```
editor invocation  →  editor application  →  write verification  →  retained final delta
```

- **invocation** — the edit was requested.
- **application** — the write layer performed the write.
- **verification** — an independent read-back observed the bytes on disk.
- **retained delta** — a checkpoint observed the target state at the END.

A successful application does **not** prove the change survived. Conversely,
the absence of an editor event does **not** prove no file changed: shell
commands and other tools may modify files.

Only a **checkpoint observation** may support a retained-change claim.

### 6.4 A test command's exit code is not a structured test result

And a final agent message claiming `GREEN` is not acceptance evidence.

The `acceptance` family is populated by an **independent evaluator** that runs
outside the harness (§9). A harness MUST NOT write into it on its own behalf.

### 6.5 A truncated trace is never complete

If the source reports truncation, then:

- `traceTruncated` is `true` on **every** record derived from that capture,
- the coverage report states the drop count and the dropped sequence range,
- any aggregate computed from that capture is a **lower bound**, not a total.

### 6.6 Completeness is fail-closed (CORR01)

ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P0-2) replaced the
predecessor's boolean `traceComplete` with an explicit classification.

| Classification | Meaning |
|---|---|
| `COMPLETE` | a validated terminal summary is present, it agrees with the observed record count, the recorder declares no truncation, and every line was well formed |
| `PARTIAL` | the capture is well formed but the recorder declares it truncated — the retained records are **real evidence of what happened**, and a **lower bound** on what did |
| `INCOMPLETE` | the terminal summary is missing, contradicts the observed records, or lines could not be parsed / were not recognized |
| `INVALID` | the capture contains no usable agent records at all |

**A missing summary is NOT a complete capture.** A capture interrupted before
its summary leaves exactly that state, and promoting it would turn partial
evidence into a complete benchmark result.

Every non-`COMPLETE` classification **names its reasons** in the coverage
report. A conforming adapter MUST NOT report completeness it cannot prove.

---

## 7. Evidence quality

The portable vocabulary:

```
REAL
LIVE
REAL_PRODUCTION_SEAM
SYNTHETIC_REAL
SYNTHETIC
STRUCTURAL
INFERRED
SIMULATED
NOT_EXECUTED
UNAVAILABLE_FROM_TRACE
LIVE_UNOBSERVABLE
```

Two axes are kept **separate**, because collapsing them is how a trace ends up
claiming more than it knows:

| Axis | Field | Question it answers |
|---|---|---|
| evidence kind | `evidenceQuality` | **How** do we know this? |
| correlation completeness | `correlationCompleteness` | **Can** we join it to anything? |

A record can be `REAL` (directly observed) and `no_identity` (unjoinable).
That combination is the honest description of a real fact we cannot attribute.

### 7.1 Mapping rules

- A source's own `evidenceBoundary` labels **describe correlation**, not
  evidence kind. `observed` / `partial_identity` / `no_identity` therefore map
  to `correlationCompleteness`, **not** to `evidenceQuality`.
- A source's per-payload **provenance** (the producing layer) **does** describe
  evidence kind, and **wins** when present.
- `partial_identity`, `observed`, and `synthesized` are **never** promoted to a
  stronger evidence claim by the adapter.
- When the mapping is ambiguous, the portable record says
  `UNAVAILABLE_FROM_TRACE` rather than choosing.

The concrete ClineMM mapping is tabulated in `cline-native-to-portable.md`.

---

## 8. Experiment manifest

A manifest describes ONE trial. It is **harness-independent**.

```
experimentId
trialId
harnessName
harnessSourceHead
harnessArtifactVersion
harnessArtifactSha256
modelProvider
exactModelId
requestedReasoning
verifiedWireReasoning
promptSha256
fixtureSourceHead
fixtureTreeSha
fixtureStartingFilesSha256
toolCatalogFingerprint
toolPermissionsFingerprint
runtimeEnvironment
traceCoverage
```

**These are REQUESTED fields, not claims that any harness records all of
them.** Every field must declare:

- **where it came from** (the capture / an independent collection / nothing),
- **whether it was observed at run time**,
- **whether it was collected independently**,
- **whether it is missing**.

### 8.1 The unavailable-sentinel rule

For an old capture with `sourceHead: UNAVAILABLE_FROM_TRACE`, that fact is
**preserved**. A checkout HEAD from today is **never** retroactively assigned
to a past run. "The source revision is unknown" is itself comparable evidence.

### 8.2 Comparable trials

Two trials are **directly comparable** only when the experimental dimensions
are controlled or explicitly accounted for:

| Dimension | Field |
|---|---|
| starting fixture / tree | `fixtureSourceHead`, `fixtureTreeSha`, `fixtureStartingFilesSha256` |
| prompt | `promptSha256` |
| model and effective reasoning | `exactModelId`, `requestedReasoning`, `verifiedWireReasoning` |
| tool availability and permissions | `toolCatalogFingerprint`, `toolPermissionsFingerprint` |
| harness artifact | `harnessSourceHead`, `harnessArtifactVersion`, `harnessArtifactSha256` |
| runtime environment | `runtimeEnvironment` |
| stopping policy | (harness-specific; must be stated) |
| acceptance evaluator | (must be the same evaluator) |

If a material difference remains uncontrolled, the comparison is labelled
**`DESCRIPTIVE`**, not causal.

---

## 9. Independent acceptance contract (specification only)

A future evaluator runs **outside** both harnesses. It consumes:

1. frozen fixture identity,
2. starting workspace digest,
3. final workspace digest,
4. the exact test invocation,
5. structured test results **or** verified process results,
6. scope restrictions,
7. conserved public API and regression constraints.

Its result is **independent of the agent's completion message**. The agent's
final message is not an input to the verdict.

### 9.1 Outcome states

```
PASS
FAIL
INCOMPLETE
NOT_EXECUTED
CAPTURE_INSUFFICIENT
```

- `PASS` — the evaluator ran, the gates passed, the constraints held.
- `FAIL` — the evaluator ran and a gate failed.
- `INCOMPLETE` — the evaluator ran but the work was not finished.
- `NOT_EXECUTED` — the evaluator did not run.
- `CAPTURE_INSUFFICIENT` — the capture lacks what the verdict needs.

### 9.2 Fixture status

The existing three-defect TypeScript fixture is the first candidate, but it has
**already been exposed** to both model and harness investigations. Stronger
generalization claims require a **blind holdout** fixture.

---

## 10. Privacy rules

A portable record MUST NOT contain:

- prompt or message content,
- reasoning text,
- tool arguments or raw tool results,
- credentials,
- absolute file paths,
- unredacted source code,
- full provider request bodies.

A portable record MAY contain **fingerprints** whose provenance and privacy
properties have been **verified** — for example an ephemeral keyed digest of
tool arguments, which is stable within a trace and unrecoverable across
traces.

A tool **catalog** is content. Comparing catalog **size** across harnesses
requires a count and a **keyed, capture-scoped** digest, not the names. The
digest must be **stable within one capture** (so the capture is
byte-reproducible) and **scoped across captures** (so one capture's digest
cannot confirm a guessed catalog for another).

### 10.1 The filter is FAIL-CLOSED (CORR01)

ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P0-1) replaced the
predecessor's **deny-list** filter with a **schema-aware allowlist**:

- A key is exported only if it is **explicitly permitted** for the record's
  family. An **unfamiliar** key does **not** escape merely because the filter
  has never seen it.
- The allowlist applies at **every depth**. A forbidden or unknown key
  nested inside an object, or inside an array element, is **dropped**.
- Every dropped field is **accounted for** — by key path — in the coverage
  report, so the loss is visible rather than silent.

The deny-list is retained as **defence in depth**: a key on it is rejected
even if a future allowlist edit would otherwise admit it.

A conforming adapter MUST NOT export a nested value it has not itself
classified. This is load-bearing for a DeepSeek adapter, whose session
telemetry ships **no redaction rules of its own**: an adapter cannot trust
the incoming events to be safe.

The adapter MUST NOT introduce sensitive content the source deliberately
omitted.

---

## 11. Conformance checklist

An adapter conforms when:

- [ ] every record carries `contract`, `harness`, `nativeEventId`,
      `nativeEventType`, `sourceOrder`, `family`, `evidenceQuality`,
      `correlationCompleteness`, `timestamp`, `identity`, `payload`,
      `traceTruncated`;
- [ ] the source summary is consumed, not emitted;
- [ ] no identity is invented to fill a hole;
- [ ] no join uses timestamp proximity;
- [ ] id namespaces are carried explicitly and never crossed;
- [ ] `tool` and `process` facts are never conflated;
- [ ] requested / wire / provider-reported reasoning stay distinct;
- [ ] editor application and retained delta stay distinct;
- [ ] the `acceptance` family is written only by an independent evaluator;
- [ ] truncation is carried on every record and in the coverage report;
- [ ] the coverage report names every refused join;
- [ ] the privacy rules of §10 hold on the emitted file;
- [ ] the filter is **fail-closed**: an unfamiliar key does not escape, at
      any depth (§10.1);
- [ ] every dropped field is accounted for in the coverage report;
- [ ] completeness is **proven**, not assumed: a missing, malformed,
      contradictory or unrecognized capture is explicitly not `COMPLETE`
      (§6.6).
