A turn with the nine boundaries costs ~1.6 µs of instrumentation against
a turn measured in tens of seconds.

---

## 5. Compaction evidence contract — the headline finding

The Round C summary reported that prior observations were "blank" and
that "no confirmed file content is visible from this segment".

**That claim is false, and the code proves it.** Measured against the
real evidence by `analyzeCompactionLoss`:

| Measurement | Value |
|---|---:|
| `tool_result` messages in the compacted prefix | 208 |
| …of which carried **non-empty** content | **206** |
| …of which were genuinely empty | 2 |
| `tool_result` messages retained by the sidecar | 6 |
| `tool_result` messages **dropped** | **202** |

206 of the 208 observations the summary calls blank were present and
non-empty in the source transcript. **The summary was describing the
sidecar, not the observations** — the evidence that would have let it say
otherwise was dropped by the compaction it was describing.

Other measured findings:

- The **48.94%** repeated task-contract text is structural: the contract
  is a delimited region of the session preamble, copied verbatim, and it
  accumulates across ACTs rather than replacing.
- Correlation of the retained tail is **exact**: 6 of 6 carried
  `tool_use` ids resolve against the original, using the existing
  `tool_use_id` as the key. Beyond the tail, correlation is impossible —
  202 of 208 results are unreferenced.
- Five kinds of information are lost: content, identity, provenance,
  arguments, and the **model-visible view**. The last is why the summary's
  claim is undecidable: the sidecar cannot distinguish "the result was
  empty" from "the result was dropped before the model saw it".

### The ledger

`EvidenceLedgerBuilder` produces an append-only, HEAD-bound ledger. Each
entry carries a **derived** observation id, a source **digest**, a byte
count, a verification state, finding **references** (not finding text),
and the HEAD it was captured at. Entries form a hash chain.

A forward-committing hash chain cannot, on its own, tell a shorter ledger
from a truncated one. Rather than paper over that, the ledger publishes a
**sealed anchor** (digest + entry count + HEAD), and a test asserts the
limitation explicitly rather than hiding it.

Privacy is structural: there is no field that can hold a secret, a
prompt, a file's content, a command's arguments or a command's output.

The ledger is written at the Phase 2 tracer boundaries, not at compaction
time — so the 202 dropped results are already recorded when compaction
runs. Compaction cannot destroy them, because compaction does not own
them.

Full analysis: `PHASE-4-COMPACTION-EVIDENCE.md`.

---

## 6. Executed tests and actual results

| Suite | Result |
|---|---|
| `src/observability/` | **84 pass, 0 fail** |
| `src/runtime/orchestration/` | **242 pass, 0 fail** |
| `src/extensions/tools/` | 641 pass, 7 fail, 105 skipped |
| The three suites together | 962 pass, 7 fail, 105 skipped |
| Whole `sdk/packages/core` suite | 5,100 pass, 152 fail, 165 skipped |
| Typecheck (`tsconfig.dev.json`) | 40 errors, **byte-identical to the pre-existing baseline** |

Every failure in the whole-suite run is in a file this ACT does not
touch. The failing files are:

`artifacts/cloud/publish`, `auth/codex`, `auth/server`,
`cloud/controller-websocket`, `extensions/mcp/client`,
`extensions/plugin/plugin-registry`, `extensions/plugin/plugin-sandbox`,
`extensions/tools/__tests__/skill-trigger-evals01`,
`extensions/tools/executors/bash.supervised.bash-startup-env`,
`extensions/tools/executors/editor.realpath-authority`,
`hooks/checkpoint-hooks`, `hub/client/connection-headers`,
`hub/client/proxy`, `hub/runtime-host/hub-runtime-host`,
`hub/server/boundary`, and further hub/runtime areas.

**They are pre-existing.** The whole suite was re-run with this ACT's
changes stashed and produced the **same** 32 failed / 307 passed /
152 failed test counts. No test was weakened, skipped or excluded to make
a suite green, and no unrelated exclusion was introduced.

---

## 7. Remaining latency attribution gaps

These are the boundaries that are **not yet populated by a live turn**:

| Boundary | State | What is missing |
|---|---|---|
| `request_prepared` | populated by the runtime | — |
| `provider_submitted` | populated by the runtime | — |
| `provider_first_token` | approximated at stream end | the runtime reports one finish for the whole stream, so the first token is entered and exited at the same instant — it is **not** a true first-token measurement |
| `provider_completed` | populated by the runtime | — |
| `schema_validation` | **API only** | the host that owns schema validation does not yet call `recordSchemaValidation` |
| `tool_execution` | populated by the runtime | — |
| `tool_result_delivered` | **API only** | the seam that puts the result into the conversation does not yet call `recordToolResultDelivered` |
| `provider_ready` | **API only** | the seam that builds the provider-ready request does not yet call `recordProviderReady` |
| `compaction` | **API only** | the compaction host does not yet call `recordCompaction` |

The instrumentation is therefore **capability-complete but
integration-incomplete**. The four `API only` boundaries have working,
tested recording paths and no caller.

**Consequently, the ~5-second command-result floor is NOT yet
attributed.** The tracer can separate execution from queue, transport and
delivery, but no live turn has exercised the separation.

---

## 8. Concrete next experiment for reducing model turns

The session ran **186 model turns** over 7,654,504 ms, of which
**6,857,595 ms (89.6%)** was model time. The dominant cost is the
number of round trips, not the tool work: 209 tool invocations for 186
model turns is close to one tool call per turn, so the model is
re-entering the conversation for essentially every command.

**The experiment:** measure whether the model can be asked for the
*batch* it already intends to run, rather than one call at a time.

Concretely, on a replay of the same 397-message transcript:

1. Instrument `provider_ready` to record, for each request, the number of
   tool calls the model asked for and the number it executed.
2. Compare against the Round C baseline: **193** `run_commands`
   invocations carrying **675** command strings — a mean of **3.5
   commands per call**. The batching capability already exists and is
   already being used.
3. The hypothesis to test: for the 8 schema-rejected calls, the model
   issued a follow-up turn to re-issue the commands in a shape it guessed
   would be accepted. **That is 8 avoidable model turns.** With the
   bounded normalisation in place, those follow-up turns should no longer
   be needed.
4. Measure the delta in model turns and in model time on the same
   transcript, with the normalisation enabled and disabled.

**Expected effect:** ~8 fewer model turns out of 186, i.e. ~4.3%. This
is a **hypothesis, not a result** — it requires the live provider-ready
instrumentation and a controlled replay, neither of which has been run.

The larger lever, if the hypothesis holds, is the **command-result
delivery** seam: if a result is delivered in a form the model can act on
without re-reading the source, the model needs fewer turns to complete a
batch. That is exactly what the `provider_ready` boundary would
measure, and it is why that boundary is the one to wire next.

---

## 9. All `NOT_EXECUTED` items

| # | Item | Why |
|---|---|---|
| N1 | **Live Strata replay** | Not authorised. The ACT states a live replay against Strata is NOT_EXECUTED unless explicitly authorised separately. No authorisation was given. |
| N2 | **Controlled end-to-end runtime comparison** | Requires N1. Consequently **no performance-improvement claim is made**, and the 127-minute runtime is not claimed to have improved. |
| N3 | **Live population of the four `API only` boundaries** | `schema_validation`, `tool_result_delivered`, `provider_ready`, `compaction` have tested recording paths but no production caller. |
| N4 | **True first-provider-token measurement** | The runtime reports a single stream finish; the first-token boundary is currently entered and exited at the same instant. |
| N5 | **Measurement of the ~5-second command-result floor** | Blocked on N3 — the separation of execution from queue/transport/delivery has never run against a live turn. |
| N6 | **The §8 model-turn experiment** | Blocked on N3 (`provider_ready`) and N2 (controlled comparison). |
| N7 | **Populating the evidence ledger during a live session** | The Round C session predates the instrumentation. The ledger is implemented and tested, but the session it would describe was never instrumented. |
| N8 | **Raw session dumps committed** | Deliberately NOT done. The raw Round C dumps are not committed; all tests use sanitised or synthetic fixtures. |
| N9 | **Compaction redesign** | Out of scope by the ACT. The contract is specified; no memory subsystem is proposed and no compaction behaviour is changed. |
| N10 | **Push / PR** | Prohibited by the ACT. |

---

## 10. Safety statement

- **No command in the Round C evidence was executed**, by the profiler, the
  normaliser, or any test. The profiler parses; the test executors
  exercise the executor without a shell.
- **Transcript text is never interpreted as an instruction.** Every
  module that reads a recorded session treats it as opaque data.
- **No secret, credential or raw content is recorded** by the tracer or
  the ledger.
- **No raw session dump is committed.**
- **No push, no PR, no destructive Git operation, no production system
  touched.**

---

## 11. What GO would have required, and what is still missing

The ACT's GO criterion is: *"Offline replay passes, instrumented boundaries
are validated, schema corrections pass regression tests, and no unsafe
behaviour was introduced."*

| Criterion | Met |
|---|---|
| Offline replay passes | ✅ all 14 baseline assertions reproduce exactly |
| Instrumented boundaries are validated | ⚠️ **partially** — the tracer and sink are validated by 34 tests; four boundaries have no production caller |
| Schema corrections pass regression tests | ✅ 43 tests; preview/execution equivalence verified |
| No unsafe behaviour introduced | ✅ |

The third criterion is not fully met, which is why the verdict is
**PARTIAL** rather than GO.
