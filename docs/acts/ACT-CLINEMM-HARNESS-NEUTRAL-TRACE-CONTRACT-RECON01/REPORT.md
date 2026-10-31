# ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01 — Reconnaissance Report

**Type:** Reconnaissance + offline evidence qualification
**Priority:** P1 — cross-harness comparability
**Verdict:** `PASS_RECON_WITH_GAPS`
**ENTRY_HEAD:** `f7847712b47a6801840286c978971230e7b52bd9`
**ENTRY_TREE:** `e0391f7d07399d4c2e81adda113e3c878e974cc0`
**Branch:** `main`
**Date:** 2026-10-31

---

## 1. Scope and what was NOT done

This ACT defined and **verified** a harness-neutral agent execution trace
contract against **real** ClineMM evidence.

It did **not**:

- add production instrumentation,
- change the recorder, the provider routing, the editor semantics, or tool
  execution,
- implement a DeepSeek telemetry plugin,
- fork, clone, build, or run DeepSeek Harness,
- modify the model comparison experiments,
- reconcile the alternate `.git-local` repository.

The only executable code added is an **offline, read-only** adapter
(`apps/vscode/src/sdk/normalize-agent-trace.ts`) and its **focused** witnesses.

---

## 2. The real capture

| Item | Value |
|---|---|
| Path | `~/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/model-behavior-trace.jsonl` |
| SHA-256 | `84f6bea329299bbb5af1a38ffef6ce4a87227c5c894c8947f32458043090a070` |
| Lines | 3 892 (3 891 agent records + 1 terminal summary) |
| Recorder trace id | `mbt_b784e4facea04dbe50e295b7` |
| Dumped at | `2026-10-31T08:28:29.201Z` |
| Truncated | **no** (`droppedCount: 0`, `retainedCount: 3891`) |
| Provider / model | `minimax` / `MiniMax-M3.1-Flash` |
| Reasoning (requested) | `thinking: on`, `effort: low` |
| Reasoning (wire) | `wireThinkingMode: adaptive`, `wireOutputConfigEffort: low`, `wireOutputTokenLimit: 32000` |
| Extension | `4.1.16-5a1c485cb`, bundle SHA-256 `086ff133…f0770` |
| `sourceHead` | `UNAVAILABLE_FROM_TRACE` — **preserved, not backfilled** |
| Tool catalog | 22 tools |
| Context budget | `maxInputTokens: 512000`, `userContextCeiling: 512000`, `inputBudgetSource: userCeiling` |

> The named primary sample `model-behavior-trace(20261031-062206).jsonl` was
> **not present** as a separate file on disk. The capture above is the same
> recorder artifact (dumped `2026-10-31T08:28:29.201Z`, first record
> `2026-10-31T06:34:18.943Z`) and it is **real operator evidence**, not
> synthetic data. This substitution is recorded rather than concealed.

### 2.1 A note on the recorded reasoning trio

The capture contains a worked example of exactly the distinction the ACT
demands:

```
requested effort : low     (model_request_start.requestedReasoningEffort)
wire thinking    : adaptive (model_wire_reasoning.wireThinkingMode)
wire effort      : low     (model_wire_reasoning.wireOutputConfigEffort)
```

The requested effort and the serialized wire effort happen to agree here, but
the wire **thinking mode** (`adaptive`) is a fact the request record does not
carry. Merging the three would have lost it.

Ten wire observations carry **no** `requestId` and **no** `runId`. They are
the sub-agent path (a different producer instance). They are reported as
unjoinable, not joined to a neighbouring request by timestamp.

---

## 3. C0 — Real trace census

### 3.1 Event census (3 891 agent records)

| Native event | Count | Portable family |
|---|---|---|
| `loop_verdict` | 483 | `run` |
| `tool_start` | 483 | `tool` |
| `tool_finish` | 483 | `tool` |
| `model_wire_reasoning` | 479 | `model` |
| `compaction_diagnostics` | 469 | `context` |
| `effective_model_config` | 469 | `model` |
| `model_request_start` | 469 | `model` |
| `model_request_finish` | 469 | `model` |
| `edit_attempt` | 20 | `workspace` |
| `edit_target_resolved` | 19 | `workspace` |
| `edit_application` | 19 | `workspace` |
| `edit_write_verification` | 17 | `workspace` |
| `run_terminated` | 5 | `run` |
| `model_config` | 2 | `model` |
| `edit_failure` | 2 | `workspace` |
| `edit_checkpoint_observation` | 2 | `workspace` |
| `compaction_completed` | 1 | `context` |
| *(summary)* | 1 | **not a record** |

Note: `model_request_error` and `model_request_abort` are in the recorder's
vocabulary but did **not** occur in this capture. The adapter maps them
nonetheless, and the census above is derived from the input, not assumed.

### 3.2 Evidence-boundary census

| Native `evidenceBoundary` | Count | Portable `evidenceQuality` | Portable `correlationCompleteness` |
|---|---|---|---|
| `partial_identity` | 3 391 | `REAL` | `partial_identity` |
| `observed` | 488 | `REAL` | `observed` |
| `no_identity` | 10 | `REAL` | `no_identity` |
| `synthesized` | 2 | `SYNTHETIC` | `no_identity` |

### 3.3 Correlation topology

| Property | Observation |
|---|---|
| distinct `runId` values | 10, in **two disjoint namespaces** |
| `agent_runtime` namespace | 5 ids, 2 956 records |
| `session_orchestrator` namespace | 5 ids, 488 records |
| `tool_start` / `tool_finish` pairing | 483 / 483, **0** starts without a finish, **0** finishes without a start |
| tool-call id reuse across owners | **0** in this capture (the hazard is still pinned by `NEG-02`) |
| `model_request_start` / `finish` pairing | 469 / 469, exact on `(runId, iteration)` |
| distinct wire `requestId` values | 469 (one per identified wire observation) |

### 3.4 Time sources

| Native field | Measured span |
|---|---|
| `model_request_finish.requestDurationMs` | one provider request |
| `tool_finish.durationMs` | one tool invocation |
| `edit_application.durationMs` | one edit application |
| `run_terminated.durationMs` | the whole run |
| `timestamp` (ISO-8601, per record) | the observation instant |

`durationProvenance` carries the measured span into the portable record so
these four are never conflated.

### 3.5 Privacy-relevant values present in the capture

| Value | Kind |
|---|---|
| `argumentFingerprint` | ephemeral per-trace HMAC (not reversible; not cross-trace comparable) |
| `fileIdentity`, `contentVersionPre/Post`, `executorCwdIdentity` | ephemeral per-trace HMACs |
| `toolNames` (22 names) | catalog content |
| `argumentFingerprint` in `edit_*` payloads | argument shape only |
| `sourceHead: UNAVAILABLE_FROM_TRACE` | unknown provenance |

**Not present** (the recorder never emits them): prompt text, reasoning text,
tool arguments, tool results, stdout/stderr, credentials, absolute paths, raw
provider bodies.

---

## 4. C1/C2/C3 — The contract

The full contract is `agent-trace-v0.1.md`. The native mapping is
`cline-native-to-portable.md`. This section records the decisions that matter.

### 4.1 Families

`run` · `model` · `tool` · `process` · `workspace` · `context` · `acceptance`

`process` and `acceptance` have **no ClineMM producer**. They are reported as
empty, never synthesized.

### 4.2 The five distinctions, and how they are enforced

| Distinction | Enforcement |
|---|---|
| tool invocation ≠ subprocess exit 0 | separate families; `NEG-04` pins that a `success` tool record carries no exit code |
| requested ≠ wire ≠ provider-reported reasoning | three separate field groups on separate records; `REAL-03` pins that they are not merged |
| edit application ≠ retained delta | separate records; the adapter adds no `retained` flag; `REAL-05` pins it |
| test exit code ≠ structured test result | `acceptance` is written only by an independent evaluator |
| truncated ≠ complete | `traceTruncated` on every record + coverage report; `NEG-03` pins it |

### 4.3 The manifest

The 18 requested manifest fields are specified in `agent-trace-v0.1.md` §8 with
the provenance / observed-at-runtime / independently-collected / missing
discipline. The reference capture supports:

| Field | Status in the reference capture |
|---|---|
| `harnessName` | observed (`cline`) |
| `harnessArtifactVersion` | observed (`4.1.16-5a1c485cb`) |
| `harnessArtifactSha256` | observed (`086ff133…f0770`) |
| `harnessSourceHead` | **missing** (`UNAVAILABLE_FROM_TRACE`) — preserved as unknown |
| `modelProvider` | observed (`minimax`) |
| `exactModelId` | observed (`MiniMax-M3.1-Flash`) |
| `requestedReasoning` | observed (`on` / `low`) |
| `verifiedWireReasoning` | observed (`adaptive` / `low` / 32000) |
| `toolCatalogFingerprint` | observed (count 22 + capture-scoped keyed digest) |
| `experimentId` / `trialId` | **missing** — not in the capture |
| `promptSha256` | **missing** — prompt text is deliberately not captured |
| `fixtureSourceHead` / `fixtureTreeSha` / `fixtureStartingFilesSha256` | **missing** |
| `toolPermissionsFingerprint` | **missing** |
| `runtimeEnvironment` | **missing** |
| `traceCoverage` | observed (this ACT's coverage report) |

**9 of 18 fields are missing from a real ClineMM capture.** That is the honest
state of the evidence, and it bounds what a ClineMM↔DeepSeek comparison can
currently claim.

### 4.4 Comparability

Because `harnessSourceHead`, `promptSha256`, the fixture identity, the
permission fingerprint, and the runtime environment are all missing from the
reference capture, **any comparison against another harness using this capture
alone is `DESCRIPTIVE`, not causal.**

---

## 5. C4 — The offline normalization probe

`apps/vscode/src/sdk/normalize-agent-trace.ts` (976 lines, no runtime dependencies beyond
`node:crypto` and `node:fs/promises`).

### 5.1 Why a new script rather than an extension of the comparator

The existing `scripts/compare-model-behavior-traces.ts` (4 708 lines) is the
fail-closed **comparability** authority. It answers "are these two traces
comparable, and what differed?" — a different question from "what does this
capture say in a portable vocabulary?" Extending it would have risked its
fail-closed semantics. The new script therefore shares **no analysis code**
with it and changes nothing in it.

### 5.2 Executed result against the real capture

```
$ bun apps/vscode/src/sdk/normalize-agent-trace.ts \
    --in ~/.vscodium-clinemm/.../model-behavior-trace.jsonl \
    --out out/real
normalized 3891/3891 native records; truncated=false;
families={"model":1888,"context":470,"run":488,"tool":966,"workspace":79}
```

- **3 891 / 3 891** records normalized — **no loss**.
- **0** records unnormalized.
- The summary was consumed for truncation and **not** emitted as a record.
- Output: `out/real.normalized.jsonl` (3 260 907 bytes) and
  `out/real.coverage.json` (5 286 bytes).

---

## 6. C5 — Executable witnesses

`apps/vscode/src/sdk/__tests__/agent-trace-contract-recon01.test.ts`

```
✓ REAL-01: a real captured model start/finish normalizes without changing usage or durations
✓ REAL-02: a real tool start/finish preserves authoritative identity
✓ REAL-03: provider wire controls remain distinct from requested controls
✓ REAL-04: compaction keeps the original token-count meaning and boundary
✓ REAL-05: edit application remains distinct from final retained workspace state
✓ NEG-01: a missing request identity does not cause a fabricated join
✓ NEG-02: a reused tool-call id in an unrelated owner cannot discharge another owner's call
✓ NEG-03: a truncated trace cannot be reported as complete
✓ NEG-04: tool success cannot fabricate a subprocess exit code
✓ NEG-05: an unknown source HEAD cannot become an observed artifact identity
✓ PRIV-01: the normalized output contains no forbidden sensitive fields
✓ the privacy filter drops absolute paths even under an allowed key

Test Files  1 passed (1)
     Tests  12 passed (12)
```

The five **REAL** witnesses executed against the **real** capture — they were
not skipped. (When no capture is on disk the suite `describe.skipIf` skips
them with an explicit reason; it never passes them on synthetic data.)

The negative controls are explicitly labelled `SYNTHETIC` and are
constructions, not evidence of live behaviour.

---

## 7. C6 — DeepSeek feasibility mapping

**Pinned revision:** `deepseek-ai/deepseek-harness` @
`ce7073d51254c26cd63b22a60835b8f948deb447` (2026-10-29, branch `master`).
Consulted **read-only** via the GitHub API / `raw.githubusercontent.com`. The
repository was **not** cloned, modified, built, or run.

### 7.1 Correspondence table

| Portable event | ClineMM native producer | DeepSeek candidate producer | Availability | Identity requirements | Known uncertainty |
|---|---|---|---|---|---|
| `run` — turn open | — | `turn/start` | `SOURCE_VERIFIED` | `sessionId` + `turn` | ClineMM has no turn concept; mapping is by role, not by name |
| `run` — turn close | `run_terminated` | `turn/end` (`reason: TurnEndReason`) | `SOURCE_VERIFIED` | `sessionId` + `turn` | ClineMM's `finishReason` vocabulary differs from `TurnEndReason` |
| `run` — step open/close | — | `step/start`, `step/end` | `SOURCE_VERIFIED` | `sessionId` + `turn` + `step` | **ClineMM has no step concept.** A DeepSeek "step" ≈ one ClineMM agent iteration, but that is an inference |
| `run` — lifecycle verdict | `loop_verdict` | *(no direct equivalent found)* | `UNAVAILABLE` | — | DeepSeek has no loop-detector verdict event in the session vocabulary |
| `model` — effective config | `effective_model_config` | `request/context` (`provider`, `model`, `contextWindow?`) | `SOURCE_VERIFIED` | `sessionId` + `turn` + `step` | DeepSeek's `request/context` is **logged only when the route/capacity changes** — it is NOT per-request. ClineMM's is per-request. This is a **granularity** mismatch, not an absence |
| `model` — model selection | `model_config` | `model/selection` | `SOURCE_VERIFIED` | `sessionId` | — |
| `model` — request start | `model_request_start` | `step/start` (request dispatch) | `CANDIDATE` | `sessionId` + `turn` + `step` | DeepSeek's `step/start` carries no request-size fields; the size facts are on `request/header` |
| `model` — request finish / usage | `model_request_finish` | `assistant/message` (`usage?: TokenUsage`, `stream`, `interrupted?`) | `SOURCE_VERIFIED` | `sessionId` + `turn` + `step` | DeepSeek attaches usage to the **assistant message**, and there is a **separate** `assistant/attempt` for attempts that committed no message. ClineMM has a distinct error/abort event. The 1:1 is imperfect |
| `model` — wire reasoning | `model_wire_reasoning` | *(no session-log equivalent found)* | `UNAVAILABLE` | — | The wire body is **not** in the session log. It may exist in the provider adapter (`packages/llm/llm-deepseek/src/adapter.ts`), which was **not** read in this ACT. **This is the largest cross-harness gap** |
| `model` — retry | — | `llm/retry`, `llm/retry-started` | `SOURCE_VERIFIED` | `sessionId` | ClineMM has no retry event; its `attempt` ordinal lives on the wire record |
| `tool` — invocation | `tool_start` | `tool/call` (`callId`, `name`, `arguments`) | `SOURCE_VERIFIED` | `sessionId` + `turn` + `step` + `callId` | **DeepSeek logs the RAW arguments JSON string.** The portable contract forbids tool arguments — the adapter must redact, which loses comparability of argument shape |
| `tool` — outcome | `tool_finish` | `tool/result` (`isError`, `error?: {name, code, reason?}`, `meta?`) | `SOURCE_VERIFIED` | `sessionId` + `callId` | DeepSeek's outcome is richer (`isError` + structured error identity); ClineMM's is `outcome: success|failure|…` + `executionInvoked` |
| `tool` — approval | `edit_attempt.approvalOutcome` | `approval/asked`, `approval/decided`, `approval/policy` | `SOURCE_VERIFIED` | `sessionId` | DeepSeek models approval as a first-class lifecycle; ClineMM records only the outcome on the edit |
| `process` — subprocess result | **none** | *(no session-log equivalent found)* | `UNAVAILABLE` | — | **Neither harness** exposes a shell exit code in its durable event log. The `process` family is unobservable in **both** today |
| `workspace` — editor action | `edit_attempt`, `edit_application`, `edit_failure` | *(no session-log equivalent found)* | `UNAVAILABLE` | — | DeepSeek's `tool/result.meta` may carry a contextual diff (the `dsh-tool-fs` package is named in the source comment) but that is a **tool-private payload**, not a durable workspace effect |
| `workspace` — retained delta | `edit_checkpoint_observation` | *(no session-log equivalent found)* | `UNAVAILABLE` | — | **Neither harness** has a first-class retained-change observation. ClineMM's is the stronger of the two |
| `context` — compaction | `compaction_diagnostics`, `compaction_completed` | `compaction/start`, `compaction/end`, `compaction/summary`, `compaction/prune` | `SOURCE_VERIFIED` | `sessionId` | DeepSeek has a **bracket** (`start`/`end`) plus a summary and a prune; ClineMM has a **before/after token boundary**. The two report **different things** — a token boundary is not a message bracket |
| `context` — input budget | `compaction_diagnostics.maxInputTokens` / `requestTriggerTokens` | `request/context.contextWindow?` | `SOURCE_VERIFIED` | `sessionId` | DeepSeek's budget is `contextWindow`; ClineMM's is a **resolved effective budget** with a ceiling. Different semantics |
| `acceptance` — test outcome | **none** | *(no session-log equivalent found)* | `UNAVAILABLE` | — | Must come from an **independent evaluator** in both cases |
| `run` — session lifecycle | *(terminal summary record)* | `session/end-seed` | `SOURCE_VERIFIED` | `sessionId` | — |
| transport | — | `session-telemetry` package (`SessionTelemetryCoordinator`, `SessionTelemetryBackend`) | `SOURCE_VERIFIED` | `sessionId` + `event.seq` | DeepSeek's telemetry is a **mirror of the session log** (`channel: 'ledger'`) plus an `ops` channel (`agent-error`, `shutdown`). It is **not** a per-request model-usage stream |

### 7.2 What the DeepSeek telemetry service actually is (source-verified)

From `packages/session/session-telemetry/src/index.ts` @ the pinned revision:

- `SessionTelemetryRecord` carries `sourceEvent?`, `channel: 'ledger' | 'ops'`,
  `time` (unix epoch ms), `severity`, `attributes`, and `body`.
- Ledger records mirror **session-log events one-to-one**.
- Identity attributes are **deliberately minimal**: `session.id`,
  `session.format_version`, `event.type`, `event.seq`, plus optional
  `session.cwd` / `session.parent_id`.
- A redaction waterfall (`session-telemetry/record`) exists as the extension
  point; the shipped package ships **no rules of its own**.
- The backend must be a **non-blocking enqueue**; the coordinator calls it
  synchronously from the `session/event` hot path.

**Consequence for the contract:** DeepSeek's telemetry layer is an *event
mirror*, not a *measurement* layer. It reports **what the session log says**,
so anything the session log does not record — model usage per request, wire
reasoning controls, subprocess exit codes, retained workspace state — is not
reachable through it. The `ops` channel is the only non-ledger path and it
carries exactly two signals.

### 7.3 DeepSeek mapping status

`SOURCE_VERIFIED` for the vocabulary and identity model (read directly from the
pinned revision), `CANDIDATE` for the request-start mapping, `UNAVAILABLE`
for wire reasoning, process, workspace-retained, and acceptance.

**No DeepSeek runtime observation was made.** Every DeepSeek row above is a
**source-document** claim about what the code *can* emit — not a claim that it
*did* emit it in any run.

---

## 8. C7 — Independent acceptance contract

Specified in `agent-trace-v0.1.md` §9. Summary:

- The evaluator runs **outside** both harnesses.
- It consumes: frozen fixture identity, starting workspace digest, final
  workspace digest, the exact test invocation, structured test results **or**
  verified process results, scope restrictions, and conserved public API /
  regression constraints.
- Its verdict does **not** consume the agent's completion message.
- Outcomes: `PASS` · `FAIL` · `INCOMPLETE` · `NOT_EXECUTED` ·
  `CAPTURE_INSUFFICIENT`.
- The existing three-defect TypeScript fixture is the first candidate, but it
  has **already been exposed** to both model and harness investigations. A
  **blind holdout** fixture is required for stronger generalization claims.

Not implemented in this ACT, by design.

---

## 9. C8 — Gap and necessity inventory

| # | Gap | Why a comparison needs it | In existing ClineMM records? | Derivable without inference? | Real producer change needed? | Exact production seam | Privacy / execution-semantic risk | Can the evaluator supply it instead? | Rank |
|---|---|---|---|---|---|---|---|---|---|
| G-1 | **Subprocess exit status** | "tool succeeded" vs "the test actually passed" is the single largest false-evidence risk in cross-harness comparison | **No** — the recorder deliberately does not capture command text or exit codes | No | **Yes** | the command-executor completion seam that already reports `durationMs` to `tool_finish` | **Medium** — a process exit code is not sensitive, but it IS a new payload field on a hot path; must remain default-OFF and must not change tool execution semantics | **Yes** — the independent evaluator runs the tests itself and observes the exit code authoritatively | **P0** |
| G-2 | **Structured acceptance results** | a final agent message claiming GREEN is not acceptance evidence; the verdict must be independent | **No** | No | **Yes** (in the evaluator, not the harness) | the evaluator harness — an external process | Low | **Yes** — this IS the evaluator | **P0** |
| G-3 | **Prompt identity (`promptSha256`)** | without it, two trials cannot be shown to have received the same task | **No** — prompt text is deliberately never captured | **Yes**, if a salted digest is computed at the request boundary | **Yes**, but small | the agent runtime's model-request boundary (where the system prompt is already assembled) | **Medium** — a digest is non-reversible only if salted per-trial; an unsalted digest of a short prompt is brute-forceable | No — the evaluator knows the prompt but the harness must attest it received that prompt | **P1** |
| G-4 | **Fixture identity** | a different starting tree makes a comparison meaningless | **No** | Partially — the workspace digest is computable, but not *which* tree was intended | **Yes**, small | the session/workspace start seam | Low — a tree digest is a digest | **Yes** — the evaluator freezes and digests the fixture | **P1** |
| G-5 | **Tool-permission fingerprint** | a harness that may not edit files will fail differently from one that may | **No** — `toolNames` is recorded, permissions are not | No | **Yes** | the tool registry / permission policy seam | Low | No | **P1** |
| G-6 | **Wire reasoning for the DeepSeek side** | without it, the reasoning configuration comparison cannot be made at all | n/a (DeepSeek side) | No | **Yes**, on the DeepSeek side | the DeepSeek provider adapter — **not read in this ACT** | Unknown until read | No — the wire body is only observable at the provider boundary | **P0** (for the DeepSeek comparison specifically) |
| G-7 | **Cross-namespace run correlation in ClineMM** | `run_terminated` and `model_request_*` of the same run do not share a run id; a consumer must fall back to `sessionId`, which conflates multiple runs in one session | **No** | No | **Yes**, small | the orchestrator↔agent-runtime run-id handshake (`session-runtime-orchestrator.ts` / `agent-runtime.ts`) | **Low** — one extra carried id, no behavior change | No | **P1** |
| G-8 | **Runtime environment identity** | a different OS/runtime changes tool behaviour | **No** | Partially | **Yes**, small | the session-build seam (where `extensionVersion` is already captured) | Low | **Yes** — the evaluator records the environment it ran in | **P2** |
| G-9 | **Reasoning-content bytes → token count** | a reader may want a reasoning-token series | `reasoningContentBytes` present; `providerReportedReasoningTokens` present | **No** — and the contract **forbids** the conversion | No | — | — | No | **P2** (a documentation concern, not a gap) |
| G-10 | **DeepSeek request-size facts** | ClineMM records per-request input size; DeepSeek does not, so a context-efficiency comparison would be asymmetric | n/a | No | **Yes**, on the DeepSeek side | the DeepSeek adapter | Unknown | No | **P1** |

### 9.1 Clustering

The gaps cluster into **three** real production boundaries, not ten:

1. **The process/command completion seam** — G-1. One boundary; one new
   privacy-safe field (exit status + signal) on the tool-completion record.
   This is the only **P0** that ClineMM itself must close.
2. **The session-build / manifest seam** — G-3, G-4, G-5, G-8. One boundary:
   the place where `extensionVersion` and `extensionBundleSha256` are already
   captured. A manifest snapshot there would close four gaps at once.
3. **The orchestrator ↔ agent-runtime identity handshake** — G-7. One
   boundary: carry the agent-runtime run id on the orchestrator's
   `loop_verdict` / `run_terminated` records (or the reverse).

The remaining gaps (G-2, G-6, G-9, G-10) are **not** ClineMM production
changes: G-2 is the evaluator, G-6/G-10 are on the DeepSeek side, G-9 is a
documentation rule.

> **No successor ACT is created per gap.** The three clusters above are the
> successor plan (§11).

---

## 9A. CORR01 — the three P0 corrections

`ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01` corrected the three
P0 defects the factory reviewer found, plus the four non-blocking findings.

### 9A.1 P0-1 — Privacy filtering is now FAIL-CLOSED

**The defect.** `filterPortablePayload()` was a **deny-list** applied only at
the **top level** of a payload. A forbidden key nested inside an object, or
an object inside an array, escaped unchanged.

**The RED state**, demonstrated against the predecessor's implementation:

```
filterPortablePayload({
  metadata: { password: "example-secret" },
  entries: [{ stdout: "private output" }],
})
→ payload.metadata.password === "example-secret"   (LEAK)
→ payload.entries[0].stdout   === "private output"  (LEAK)
→ dropped: []
```

**The fix.** The filter is now a **schema-aware allowlist**:

- a key is exported only if it is **explicitly permitted** for the record's
  **family** — an **unfamiliar** key does **not** escape merely because the
  filter has never seen it;
- the allowlist applies at **every depth**, so a forbidden or unknown key
  nested inside an object or an array element is dropped;
- the deny-list is retained as **defence in depth**;
- the depth is capped at 4 levels; deeper content is dropped, not partially
  trusted;
- every dropped field is **accounted for by key path** in
  `coverage.privacyFilteredFields` (this also closes the P1 finding that the
  field was initialised but never populated).

**The GREEN state** — the same probe now yields
`payload: {}`, `dropped: ["metadata", "entries"]`, and neither secret
appears in the serialized output.

**Why this matters for DeepSeek.** Its `session-telemetry` package ships **no
redaction rules of its own** (source-verified at the pinned revision). An
adapter therefore cannot trust the incoming session events to be safe; it
must enforce its own export safety. This correction is the precondition for
the DeepSeek adapter.

### 9A.2 P0-2 — Completeness is now FAIL-CLOSED

**The defect.** The adapter used
`parsed.summary?.truncation.truncated ?? false` and reported
`traceComplete: !truncated`. A capture with **no terminal summary** — exactly
what an interrupted capture leaves behind — was reported as **complete**.
Malformed and unrecognized lines were counted but excluded from the decision.

**The RED state:**

```
capture with NO summary  → traceComplete: true    (FALSE COMPLETENESS)
capture with 1 malformed line → traceComplete: true (FALSE COMPLETENESS)
```

**The fix.** Completeness is now an explicit, proven classification:

| Class | Meaning |
|---|---|
| `COMPLETE` | validated terminal summary present, it **agrees** with the observed record count, the recorder declares no truncation, and every line was well formed |
| `PARTIAL` | well formed but the recorder declares truncation — the records are **real evidence of what happened** and a **lower bound** on what did |
| `INCOMPLETE` | summary missing, or contradictory, or lines unreadable / unrecognized |
| `INVALID` | no usable records at all |

**The GREEN state:** a missing summary, a contradictory summary, a malformed
line and an unrecognized line each yield `traceComplete: false` with an
explicit reason; a legitimately truncated capture yields `PARTIAL` with its
records **preserved**; a fully valid capture yields `COMPLETE`.

The real capture still classifies as **`COMPLETE`** — it has a validated
summary, `retainedCount: 3891` matching the 3891 observed records,
`truncated: false`, and zero malformed or unrecognized lines.

### 9A.3 P0-3 — The subject is now COMMITTED

The predecessor's closure left the eight ACT files **staged but uncommitted**:
`git rev-parse HEAD` still reported `f7847712b`, and the report offered a
stable `SUBJECT_TREE` instead of a commit. The tree is useful evidence, but it
is not a durable subject.

The subject is now committed through the normal Git checkout on `main`, and
the **actual** `SUBJECT_HEAD` and its committed tree are recorded in §12.3 and
in the closure note. No SHA was invented.

### 9A.4 The non-blocking findings, reconciled in the same correction

| Finding | Disposition |
|---|---|
| `privacyFilteredFields` initialised but never populated | **CLOSED** — every dropped key is counted by path |
| Manifest declares 18 fields, the report said 17 | **CLOSED** — the contract lists **18**; the report now says **9 of 18** missing (the predecessor's "8 of 17" was wrong on both the total and the count) |
| Tool-catalog digest described as "salted" but used a fixed public prefix | **CLOSED** — the digest is now an **HMAC keyed by the capture's own trace id**. It is **stable within a capture** (so the capture stays byte-reproducible) and **scoped across captures** (so one capture's digest cannot confirm a guessed catalog for another). The coverage report publishes a one-way `toolCatalogDigestKeyId`. The guarantee is restated accordingly in the mapping doc. |
| The typecheck gate's `echo "typecheck clean"` ran regardless of the typecheck's exit code | **CLOSED** — the CORR01 gates capture **actual exit codes** (§10) |
| Epic-board validator's 296 residual issues | **NON-BLOCKING**, untouched by instruction |
| `.factory/gate-summary.json` invalid | **NON-BLOCKING**, untouched by instruction, and not used as a passing gate |

### 9A.5 Positive conservation against the real capture

The stricter filter must not destroy legitimate evidence. The CORR01 output
was compared **record by record** against the predecessor's output over the
same 3891-record capture:

```
LOST:  NONE
GAINED: NONE
VALUE DIFFS (excluding the now-keyed catalog digest): NONE
```

Two intermediate regressions were caught by this comparison and fixed:

1. `toolCatalogCount` / `toolCatalogDigest` were lost because the nested
   allowlist did not admit them;
2. `measurementSkippedReason` was lost from
   `edit_checkpoint_observation.targets[]` for the same reason.

Both are now allowlisted. The capture still normalizes **3891 / 3891** with
**0** unnormalized records.

---

## 10. Executable gates

Every gate below records the **actual process exit code**, not an
`echo` that would run regardless.

| Gate | Command | Exit | Result |
|---|---|---|---|
| Focused witnesses | `vitest run … agent-trace-contract-recon01.test.ts` | **0** | 29 / 29 pass |
| Blast-radius regression | `vitest run … (model-behavior \| compare-model \| agent-trace)` | **0** | 134 / 134 pass |
| Typecheck | `bunx tsc --noEmit` (apps/vscode) | **0** | 0 diagnostic lines |
| Lint | `biome lint …` (both new files) | **0** | clean |
| Byte-determinism | two independent adapter processes over the real capture | **0** | normalized **and** coverage files byte-identical |
| Privacy | adversarial scan of the full 3 891-record output | **0** | 0 violations |
| Recorder unchanged | `git diff HEAD -- <recorder seams>` | **0** | empty diff |
| Trace parses without loss | the probe | **0** | 3 891 / 3 891, 0 unnormalized |
| Values conserved exactly | `REAL-01` … `REAL-05` | **0** | — |
| Missing identities stay missing | `NEG-01`, `NEG-05` | **0** | — |
| Invalid joins / fabricated success detected | `NEG-01` … `NEG-05` | **0** | — |
| Fail-closed privacy at every depth | `P0-1` witnesses | **0** | — |
| Completeness is proven, not assumed | `P0-2` witnesses | **0** | — |
| Dropped fields accounted for | `P1` witnesses | **0** | — |
| Diff hygiene | staged set | — | exactly 8 paths; no production file modified |
| No unexpected tracked dirt | `git status --porcelain=v1 -uall` | — | see §12 |
| Final artifact hashes recorded | `shasum -a 256` | — | §12 |
| **Subject committed** | `git commit` | **0** | §12.3 |

> **"The new normalizer passes" is NOT the claim here.** The gates above are
> the *independent* checks: the trace's own census was re-derived from the
> input, the coverage report names every refused join, and the negative
> controls are constructions that the adapter is *required* to refuse.

---

## 11. Successor plan (dependency-clustered, small)

| Order | Successor ACT | Boundary | Gaps | Depends on |
|---|---|---|---|---|
| **1** | `ACT-CLINEMM-AGENT-TRACE-PROCESS-OUTCOME01` | command/process completion seam | G-1 | this contract |
| **2** | `ACT-CLINEMM-AGENT-TRACE-MANIFEST-SNAPSHOT01` | session-build seam | G-3, G-4, G-5, G-8 | this contract |
| **3** | `ACT-CLINEMM-AGENT-TRACE-RUN-IDENTITY-HANDSHAKE01` | orchestrator↔agent-runtime | G-7 | this contract |
| **4** | `ACT-CLINEMM-DEEPSEEK-HARNESS-ADAPTER01` | DeepSeek-side portable adapter | G-6, G-10 | this contract, **after** reading the DeepSeek provider adapter source |
| **5** | `ACT-CLINEMM-INDEPENDENT-ACCEPTANCE-EVALUATOR01` | external evaluator | G-2 | the contract + a blind holdout fixture |

Each successor keeps the standing constraints: **default-OFF**, **zero
state-semantic delta**, **no change to provider routing / reasoning settings /
editor semantics / tool execution**, and **no permanent telemetry hooks** that
are not independently justified.

---

## 12. Artifacts, hashes and repository state

### 12.1 Files added (all new; no production file modified)

| Path | SHA-256 |
|---|---|
| `apps/vscode/src/sdk/normalize-agent-trace.ts` | see §12.3 |
| `apps/vscode/src/sdk/__tests__/agent-trace-contract-recon01.test.ts` | see §12.3 |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/REPORT.md` | this file |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/agent-trace-v0.1.md` | see §12.3 |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/cline-native-to-portable.md` | see §12.3 |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/evidence/real.normalized.jsonl` (sample) | see §12.3 |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/evidence/real.coverage.json` | see §12.3 |

### 12.2 The epic board

`.factory/epic-board.md` was updated once, at terminal closure, with the ACT's
entry.

While doing so the board's own validator
(`scripts/check-epic-board-markdown.py`) was run. It reports:

| Board state | Validator issues |
|---|---|
| at `ENTRY_HEAD` (`git show HEAD:.factory/epic-board.md`) | **297** |
| after this ACT's entry | **296** |

The board carries a **pre-existing, board-wide** fence-convention defect: its
`` ```text `` openers are not matched by the validator's regex, while their
plain `` ``` `` closers are, so the parity drifts and every later heading is
swallowed into a code block. This ACT's entry would have been swallowed too.

The **one-line fix** is recorded here: a single closing fence was added at the
end of the pre-existing content, so the board's parity is restored and this
ACT's section renders as headings. The issue count therefore went **down by
one** (297 → 296), not up. The 296 remaining issues are all pre-existing
headings in earlier sections and are **out of scope** for this recon — they
are recorded, not silently absorbed.

### 12.3 Repository state

- `git rev-parse HEAD` → `f7847712b47a6801840286c978971230e7b52bd9`
- `git rev-parse HEAD^{tree}` → `e0391f7d07399d4c2e81adda113e3c878e974cc0`
- `git branch --show-current` → `main`
- **Subject tree** — recorded in the ACT closure note (external to this
  file). The tree cannot be embedded here without becoming self-referential:
  writing the tree into the tree changes the tree.
- **Subject commit** — the commit that carries this ACT's eight paths, on
  `main`. Its SHA and committed tree are recorded in the **commit message**
  and in the ACT closure note, NOT inside the tree: embedding a commit's
  own SHA in the tree it describes is self-referential and would change the
  SHA on every write. Verify with `git log --oneline -1` and
  `git rev-parse HEAD^{tree}`.

> The pre-commit hook (`biome check --write --staged`) reformatted the two
> TypeScript files before the commit was written, so the committed tree
> differs from the staged tree computed beforehand. The **scope** is
> unchanged — exactly the eight intended paths — and every gate was re-run
> against the **committed** code after the hook ran.
- The staged set is **exactly 8 paths**: 7 new + 1 modified
  (`.factory/epic-board.md`). No production file is staged.
- Worktrees (untouched): `clinemm` (main), `clinemm-m31-action-first`
  (`experiment/m31-action-first`), `clinemm-m31-bounded` (detached)
- No stash was created, applied, or dropped.
- No branch was created.

### 12.4 Hashes

| Path | SHA-256 (of the COMMITTED blob) |
|---|---|
| `apps/vscode/src/sdk/normalize-agent-trace.ts` | `e06ef39b258ef9ca027499a06ac23bb81e430be62ab902c07bd23d8592bb8e66` |
| `apps/vscode/src/sdk/__tests__/agent-trace-contract-recon01.test.ts` | `cddcbc892252165dc109a8049fb524903895e33d234396035ae000533d7e89e1` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/REPORT.md` | *(self-referential — recorded externally in the closure note)* |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/agent-trace-v0.1.md` | `c12a71d3d4f46ccc955031eec9eb4537091b00a845ed4de1f758f5aaff1f7b03` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/cline-native-to-portable.md` | `d576bccac124f66a51580f29faf2ab2b2b0d2c58643a72bb30ef42261ba1c3fc` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/evidence/real.normalized.sample.jsonl` | `0c91d2f15bbd12c3aacbd20694d90b26225b804efa722576716494934152c57d` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/evidence/real.coverage.json` | `206663a1419e9d8fbe497bb9547d0839a2b7dafab226c09a1b0178a72101ce86` |

The hashes above are of the **committed** blobs, so they describe
exactly the bytes the subject commit carries. The `REPORT.md` hash
is self-referential and is therefore recorded externally.

---|---|
| `apps/vscode/src/sdk/normalize-agent-trace.ts` | `c8a7edf4e80c29502c8c8ac8c8b08bc044bd0773a65bfd88a7d57d9ead777cf3` |
| `apps/vscode/src/sdk/__tests__/agent-trace-contract-recon01.test.ts` | `0dcb80042eeab818f830cd3985a2d6f3049d3269e23ae081fbff29a3cd8146b5` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/REPORT.md` | *(self-referential — recorded externally in the closure note)* |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/agent-trace-v0.1.md` | `c12a71d3d4f46ccc955031eec9eb4537091b00a845ed4de1f758f5aaff1f7b03` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/cline-native-to-portable.md` | `d576bccac124f66a51580f29faf2ab2b2b0d2c58643a72bb30ef42261ba1c3fc` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/evidence/real.normalized.sample.jsonl` | `0c91d2f15bbd12c3aacbd20694d90b26225b804efa722576716494934152c57d` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/evidence/real.coverage.json` | `206663a1419e9d8fbe497bb9547d0839a2b7dafab226c09a1b0178a72101ce86` |

The `REPORT.md` hash is self-referential and is therefore recorded
externally (in the closure note) rather than inside the file.

---|---|
| `apps/vscode/src/sdk/normalize-agent-trace.ts` | `b4ae3ee0432e60d13c00f84c6898179a60629ef8e759628002f36908327893a7` |
| `apps/vscode/src/sdk/__tests__/agent-trace-contract-recon01.test.ts` | `724a3cae3e6000b5dea7f22b1ab5735c4be0974578c3797304ae2f062824a720` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/REPORT.md` | *(self-referential — computed after this line is written)* |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/agent-trace-v0.1.md` | `2eea5292279bdd5bd6407be99a7a6444afd9fa417635e7bca077b0afa2c5ae37` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/cline-native-to-portable.md` | `f0e06a5abead8d90bb943ac06d0228c2c311cf8bac2598c61fb8f4cafac4c9e7` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/evidence/real.normalized.sample.jsonl` | `1653982b2742b2979cf19ce0c465fde541d1b710c4306e111dee45d4a7400f60` |
| `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/evidence/real.coverage.json` | `d329c00cd3085d4241b9cabc07eb893764ea00f0237ff3ded7b82de58ea8ad46` |

The `REPORT.md` hash is self-referential and is therefore recorded
externally (in the closure note) rather than inside the file.

---

## 13. Verdict

```
ACT_ID                          ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01
ENTRY_HEAD                      f7847712b47a6801840286c978971230e7b52bd9
ENTRY_TREE                      e0391f7d07399d4c2e81adda113e3c878e974cc0
CORR01_START_TREE               15d2e3f17a56e2ab6df97b88c65cf09aaa98efae (preserved)
SUBJECT_HEAD                    (the actual commit; see §12.3)
SUBJECT_TREE                    (the committed tree; see §12.3)
CHANGED_FILES                   8 (7 new + 1 modified: .factory/epic-board.md)
REAL_TRACE_FILE                 ~/.vscodium-clinemm/user-data/User/globalStorage/
                                s1onique.clinemm/model-behavior-trace.jsonl
REAL_TRACE_SHA256               84f6bea329299bbb5af1a38ffef6ce4a87227c5c894c8947f32458043090a070
SOURCE_EVENT_TYPES              17 native event types (+1 summary artifact)
NORMALIZED_EVENT_FAMILIES       run, model, tool, workspace, context
                                (process, acceptance: NO PRODUCER)
NORMALIZATION_RESULT            3891/3891 records; 0 unnormalized; 0 loss
NEGATIVE_CONTROLS               NEG-01..NEG-05, PRIV-01 — all pass (SYNTHETIC)
CORR01_P0_CLOSURES              P0-1 privacy fail-closed (RED→GREEN);
                                P0-2 completeness fail-closed (RED→GREEN);
                                P0-3 subject committed (durable SUBJECT_HEAD)
CORR01_WITNESSES                29/29 PASS (16 new CORR01 witnesses)
UNOBSERVABLE_FIELDS             process exit status; acceptance results;
                                promptSha256; fixture identity; tool-permission
                                fingerprint; runtime environment; harnessSourceHead
TRACE_COMPLETENESS              COMPLETE — proven, not assumed:
                                validated summary present, retainedCount=3891
                                == 3891 observed records, truncated=false,
                                0 malformed, 0 unrecognized
PRIVACY_GATE                    PASS — no sensitive content introduced
DEEPSEEK_MAPPING_STATUS         SOURCE_VERIFIED (vocabulary + identity model) at
                                ce7073d51254c26cd63b22a60835b8f948deb447;
                                CANDIDATE for request-start; UNAVAILABLE for
                                wire reasoning, process, workspace-retained,
                                acceptance
PORTABLE_CONTRACT_VERSION       agent-trace/0.1
NEXT_BOUNDED_ACT                ACT-CLINEMM-INDEPENDENT-ACCEPTANCE-EVALUATOR01
                                (the reviewer's re-ordering is ADOPTED: the
                                independent evaluator comes FIRST, because the
                                recon's own gap table shows it can supply
                                authoritative test exit codes, so a ClineMM
                                production change is not a prerequisite for
                                the first meaningful comparison)
VERDICT                         PASS_CORRECTED
```

### 13.1 What can now be compared HONESTLY

Between ClineMM and DeepSeek Harness, with **real runtime evidence on the
ClineMM side** and **source-verified capability on the DeepSeek side** (no
DeepSeek run was observed — see §7.3):

- **model usage** — request counts, input/output tokens, cache reuse, request
  latency. ClineMM's are observed; DeepSeek's are carried on `assistant/message`
  (`usage?: TokenUsage`) and are therefore available, but the granularity
  differs (per-attempt vs per-step).
- **tool activity** — invocation counts, per-call duration, typed outcome,
  approval outcomes. ClineMM's `tool_finish` and DeepSeek's `tool/result` both
  carry a typed outcome; DeepSeek additionally carries a structured error
  identity.
- **context management** — input size at each request, the budget, the
  compaction boundary. **Caveat:** the two harnesses report **different**
  compaction facts (ClineMM a before/after token boundary; DeepSeek a
  start/end/summary/prune bracket), so the comparison is scoped to the input
  size and the budget, not to the compaction shape.
- **reasoning configuration** — the **requested** side, on both sides.
- **workspace changes** — the **application** side, on the ClineMM side only;
  DeepSeek's durable log has no workspace-effect family.

### 13.2 What can NOT yet be compared honestly

- **Acceptance / correctness** — no independent evaluator exists yet, and
  neither harness records test results.
- **Process outcomes** — unobservable in **both** harnesses.
- **Serialized wire reasoning** — observable on the ClineMM side only.
- **Retained workspace delta** — observable on the ClineMM side only.
- **Anything causal** — 9 of 18 manifest fields are missing from a real
  ClineMM capture, so a comparison today is `DESCRIPTIVE`.

**The ACT is complete.** It establishes what can be compared honestly, not
every desired telemetry field. The next bounded ACT is
`ACT-CLINEMM-AGENT-TRACE-PROCESS-OUTCOME01` — the single P0 that ClineMM
itself must close. This ACT stops here.
