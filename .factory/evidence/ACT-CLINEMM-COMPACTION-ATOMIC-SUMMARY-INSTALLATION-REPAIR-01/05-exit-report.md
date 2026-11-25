# ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01

## 05 — Exit report

```text
ACT_ID:      ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01
ENTRY_HEAD:  071305731a4a85acc71cea5bd77dbae49d959d51
SUBJECT_HEAD:7d57559acdfb4f030ab45e2ad8bc43febb01f234
VERDICT:     GO_COMPACTION_FIDELITY_REPAIR
```

### 5.1 WHAT THIS ACT ESTABLISHED

**1. The primary RED was recovered and REPRODUCED at ENTRY_HEAD.** The
predecessor's defect-positive witness passed 3/3 at the entry commit,
asserting that a provider-reported-INCOMPLETE summary was installed exactly
like a complete one. The defect was real, reachable and at the boundary the
predecessor named.

**2. The completion-status authority was mapped, and the one real loss was
found.** `incompleteReason` and `failed` were propagated correctly all the
way to `runAgenticCompaction()` and were simply **UNUSED**. The one signal
that WAS lost was whether the transport's completion event arrived at all, so
"the stream ended normally" and "the stream ended without its completion
event" were indistinguishable. That single field was added.

**3. The OpenAI-compatible `finish_reason: "length"` mapping was confirmed
correct and needed NO change.** `length` -> `max-tokens` (`ai-sdk.ts`) ->
`incompleteReason: "max_tokens"` (`compat.ts`) -> `SummaryGenerationResult`.
The A2 rule — "if propagation is already correct, do not modify it" — was
followed: nothing was changed, and the mapping is now pinned by a witness
that drives the REAL gateway and the REAL adapter.

**4. The acceptance contract is in place at the OWNING boundary.** A known
incomplete, known failed, cancelled, empty, tool-call-terminated or
prematurely-terminated candidate is refused BEFORE the replacement history is
built, the state is updated, the summary is persisted, a success is
published, or the source boundary advances. The prior valid state and the
canonical history are therefore untouched by construction.

**5. Every RED-matrix row REPRODUCED and is now GREEN.** R1 through R6, plus
the A3 extended rows and the A4 accounting rows. None is `NOT_REPRODUCED`.

**6. The predecessor's evidence classifications were CORRECTED offline**, from
existing artifacts only, with no campaign re-run and no inference request.
The material corrections are the O4 adjudication (the predecessor adjudicated
O4 against an observed set the O4 oracle does not establish), the cache
authority (string comparison, not engine tokens), the production-arm
classification (a reconstructed helper composition, not a state-aware
production execution), the historical source binding (unestablished), and
the production-arm summary completeness (unavailable from the trace).

### 5.2 THE ONE THING THAT WAS NOT FIXED, AND WHY

`runAgenticCompaction()` does not pass the compaction's abort signal to
`generateSummary()`. A cancellation signalled at the COMPACTION level
therefore does not interrupt the summarizer transport. This is **pre-existing**
— identical at ENTRY_HEAD — and this ACT **conserves** it, because the ACT
repairs the ACCEPTANCE decision and must not silently alter the cancellation
contract. It is recorded in §02.5 and asserted as conservation in the suite.

### 5.3 WHY UPSTREAM'S FIX WAS NOT ADOPTED

Upstream #14741 is OPEN and UNMERGED, and its behaviour is
**retry-and-warn-and-install**: if the retry also truncates, the summary is
**still installed**. This ACT's invariant is stricter —
`KNOWN_INCOMPLETE_SUMMARY_MUST_NOT_REPLACE_USABLE_CONTEXT` — and the two are
not equivalent. Upstream's retry authority was NOT taken either: this ACT
adds no automatic retry, and a rejected candidate returns "no compaction"
after asking the summarizer exactly once.

### 5.4 THE VERIFICATION ACTUALLY RUN

| Gate | Result |
| --- | --- |
| The five new/converted suites | **32 passed** |
| Context suite | **1 216 passed / 2 skipped** (88 files), zero new regressions |
| The `llms` package suite | **1 176 passed**, 17 **pre-existing** failures with **identical identities** to the baseline |
| Typecheck | **45 errors**, unchanged from the baseline; zero in the ACT-owned files |
| SDK build | **SUCCEEDED** |
| Biome / `git diff --check` / secret scan | **clean** |

### 5.5 THE SCOPE EXCLUSIONS WERE RESPECTED

No live inference request. No PCK revival, PCK vocabulary expansion or
source-bound evidence activation. No raw command-result publication
expansion, no new evidence-selection heuristics, no sanitizer or
command-classification expansion. The experimental fidelity candidate remains
NOT_AUTHORIZED_FOR_ACTIVATION and the predecessor's research scripts were
not executed. No native-message summarizer integration. No model comparison
or model configuration change. No Kurchatov or Strata modification, no
LEAMAS repair, no B06 repair. No general retry-policy redesign. No VSIX
packaging or installation.

**CMP-02 and CMP-03 are preserved as independent work.** No successor ACT is
started automatically.

### 5.6 THE RECOMMENDED SUCCESSOR (not started automatically)

The `renderStructuredToolPayload()`-scoped fidelity repair identified by the
predecessor, still subject to a formal confidentiality decision, and still
measured with the SAME W1 workload, the SAME O1/O4/O7 questions and the SAME
cache discriminator. This ACT does not start it.
