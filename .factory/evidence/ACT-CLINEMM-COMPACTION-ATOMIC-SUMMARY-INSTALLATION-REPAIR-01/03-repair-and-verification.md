# ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01

## 03 — The repair, the witnesses and the verification

### 3.1 THE PRODUCTION DELTA

Three files changed, one added:

| File | Change |
| --- | --- |
| `sdk/packages/core/src/extensions/context/summary-acceptance.ts` | **NEW.** The summary acceptance contract: the terminal-status classification and the install decision. |
| `sdk/packages/core/src/extensions/context/agentic-compaction.ts` | The acceptance guard at the OWNING boundary, before the replacement history is built, before the state is updated, before the summary is persisted, before a successful result is published and before the source boundary advances. |
| `sdk/packages/core/src/extensions/context/summary-generation.ts` | The transport now records WHETHER the completion event arrived (`completed`), so "ended normally" and "ended without its completion event" are distinguishable. Nothing else changed. |

**The smallest acceptance check at the boundary that owns summary
installation.** No new provider policy registry. No textual heuristic. No
keyword scoring. No additional inference. No new semantic validation
framework. No new public enum.

The guard's shape, in the order the authority is applied:

```ts
const acceptance = classifySummaryTerminalStatus({
    incompleteReason: summaryResult.incompleteReason,
    failed: summaryResult.failed,
    completed: summaryResult.completed,
});
if (!acceptance.installable) { /* log + return undefined */ }
if (summaryResult.usedTools) { /* log + return undefined */ }
if (!rawSummary) { /* the pre-existing empty diagnostic */ }
const summary = ensureFilesSection(rawSummary, fileOps);
```

The empty-summary branch keeps its **long-standing diagnostic unchanged**
(the pre-existing `compaction.test.ts` assertion for CLINE-2911 still
passes), and the new terminal classification is reported ADDITIVELY.

### 3.2 THE WITNESS LIFECYCLE (§12)

The predecessor's defect-positive witness
`compaction.summary-completeness.red01.test.ts` asserted that the defect was
PRESENT. It has been **converted into a permanent regression gate** that
asserts the REPAIRED behaviour, keeping the predecessor's three original
observations INVERTED.

**No test in the default suite intentionally asserts that the production
defect continues to exist.** No permanent diagnostic subsystem was added.

### 3.3 THE WITNESSES

| File | Tests | What it establishes |
| --- | --- | --- |
| `sdk/packages/core/src/extensions/context/compaction.summary-completeness.red01.test.ts` | 5 | The converted completeness gate, with the A1 state-owning fixture. |
| `sdk/packages/core/src/extensions/context/compaction.summary-acceptance.repair01.test.ts` | 19 | The acceptance matrix (R1-R6), the A3 extended matrix, and the A4 accounting rows. |
| `sdk/packages/core/src/extensions/context/summary-generation.terminal-status.test.ts` | 6 | The A2 propagation witness, through the ACTUAL `generateSummary()`. |
| `sdk/packages/core/src/extensions/context/compaction.summary-acceptance.durable-persistence.repair01.test.ts` | 2 | The A1 DURABLE persistence qualification, over REAL files. |
| `sdk/packages/llms/src/providers/providers.finish-reason-length.test.ts` | 2 | The A2 OpenAI-compatible adapter mapping, through the REAL gateway and the REAL adapter. |

**32 tests, all passing.**

### 3.4 THE RED MATRIX — EVERY ROW

| Row | Case | Result |
| --- | --- | --- |
| **R1** | Non-empty summary with `incompleteReason: "max_output_tokens"` | **REJECTED** — not installed, no state saved, no success published. |
| **R2** | OpenAI-compatible response ending with `finish_reason: "length"` | **REJECTED.** The adapter mapping is proven separately against the REAL gateway + REAL adapter. |
| **R3** | `success=false` without an error string, with non-empty partial text | **REJECTED.** |
| **R4** | Apparently complete prose with an authoritative incomplete signal | **REJECTED.** The terminal signal decides, not the prose. |
| **R5** | Failed generation while a valid prior compaction state exists | **REJECTED** — the prior state is untouched, the boundary does not advance, the retained tail is unchanged. |
| **R6** | Successful generation after a rejected attempt | **INSTALLED.** The refusal does not permanently disable future compaction. |

**Every row REPRODUCED.** None is `NOT_REPRODUCED`.

### 3.5 THE A3 EXTENDED MATRIX

| Case | Classification | Result |
| --- | --- | --- |
| Content filtering with partial text | `known_incomplete` | REJECTED |
| Partial text + contradictory success | `known_incomplete` | REJECTED (the negative signal overrides the success flag) |
| Partial text + contradictory failure | `known_failed` | REJECTED |
| Unexpected tool-call termination | `known_complete` + tool-call fact | REJECTED |
| Whitespace-only output | the pre-existing empty branch | REJECTED, with the long-standing diagnostic preserved |
| Legacy completion with genuinely unavailable finish-reason metadata | `legacy_completion_status_unavailable` | **INSTALLED** (legacy conserved) |
| Transport failure | the transport error propagates; the EXISTING bounded fallback to basic compaction runs | unchanged |
| Cancellation at the compaction level | the PRE-EXISTING semantics (the summarizer is not signalled) | unchanged, asserted as conservation |
| Cancellation inside the transport | the error propagates; the seam re-throws it rather than falling back | unchanged |

### 3.6 THE ATOMICITY AND CONSERVATION WITNESSES (§9)

Every one of these is asserted against the **actual state-aware
prepare-turn composition**, not a helper-only acceptance test:

| Conservation | Result |
| --- | --- |
| Rejected candidate does not replace existing state | **CONSERVED** (the prior state object is byte-identical) |
| Source boundary does not advance | **CONSERVED** (`source_message_count` and `source_prefix_hash` unchanged) |
| Previously installed summary remains unchanged | **CONSERVED** |
| Retained tail remains unchanged | **CONSERVED** (`messages` unchanged) |
| No rejected text reaches resumed provider projection | **ABSENT** |
| No success receipt for a rejected compaction | **ABSENT** (the notice is `compaction-skipped`, `phase: "skipped"`) |
| Working-context token accounting not derived from rejected text | **CONSERVED** (no `tokensAfter`/`tokensSaved`/`messagesAfter` on the skipped notice) |
| Successful-compaction accounting not incremented | **CONSERVED** (`captureCompactionSkipped`, not `captureCompactionExecuted`) |
| Cancellation retains its existing semantics | **CONSERVED** |
| Empty-summary behaviour remains unchanged | **CONSERVED** (the pre-existing diagnostic and `likelyCause` are intact) |
| Normally completed summary installs successfully | **CONSERVED** |
| A later successful attempt can recover | **CONSERVED** (R6) |
| PCK DEFAULT OFF remains unchanged | **UNCHANGED** (no PCK file touched) |
| Experimental source-bound evidence DEFAULT OFF remains unchanged | **UNCHANGED** (no source-bound file touched) |
| Task-contract and verified-outcome mechanisms unchanged | **UNCHANGED** (no carry-forward file touched) |
| No unbounded repeat of the same failing decision | **CONSERVED** (the summarizer is asked exactly ONCE) |

**CALLBACK-LEVEL state installation** is established by the matrix and the
converted completeness gate. **DURABLE persistence** is established
SEPARATELY by the dedicated suite, which drives the REAL
`SessionManifestStore` over REAL files in a REAL temporary directory and
RELOADS through the store's own reader. The two claims are not conflated.

### 3.7 THE NECESSITY ABLATION (§10)

The acceptance guard was removed with all other changes preserved.

```text
REMOVED: the classifySummaryTerminalStatus() call and the two guard branches
RESULT:  19 tests FAILED (the primary invalid-installation RED and every
         dependent row)
RESTORED: 32 tests PASSED
```

The primary invalid-installation RED returns without the guard. The guard is
therefore load-bearing.

**No adapter propagation change was necessary**, so no separate
transport-level ablation was required: the `length` -> `max-tokens` ->
`incompleteReason` mapping was already correct, as §02 records. The
independent adapter witness stands on its own.

### 3.8 THE UPSTREAM COMPARISON (§11)

| Item | Value |
| --- | --- |
| Issue | **cline/cline#14732** — "Agentic compaction installs a truncated summary silently when incompleteReason is set" — **OPEN** |
| PR | **cline/cline#14741** — "fix(agentic-compaction): retry and warn when the summarizer truncates" — **OPEN, UNMERGED** |
| Upstream commit examined | `34c104e6fc49781cda4adcd73ffdccd8f029fef9` (upstream/cline, fetched read-only; the branch and the remotes were NOT modified) |

**The upstream PR was NOT merged wholesale.** Its behaviour is
**retry-and-warn-and-install**: "If the retry is truncated too, the summary is
still installed — skipping would grow the context, which is what compaction
exists to prevent."

**That is NOT equivalent to this ACT's invariant.**
`KNOWN_INCOMPLETE_SUMMARY_MUST_NOT_REPLACE_USABLE_CONTEXT` requires the
candidate NOT to replace the working context at all. Upstream still installs
it (with a warning and a metadata marker). The upstream approach was
therefore NOT adopted; the applicable part of it — the observation that
`incompleteReason` must reach a decision — was.

**No upstream retry authority was taken.** This ACT adds **no** automatic
retry: a rejected candidate returns "no compaction" and the summarizer is
asked exactly once.

### 3.9 THE VERIFICATION ACTUALLY RUN (§13)

| Gate | Result |
| --- | --- |
| Existing completeness witness (converted) | **5 passed** |
| Repaired production-seam matrix | **19 passed** |
| A2 propagation witness | **6 passed** |
| A1 durable persistence qualification | **2 passed** |
| Adapter completion-mapping test (the `llms` package) | **2 passed** |
| Context suite (`src/extensions/context/`) | **1 216 passed / 2 skipped** (88 files) — was 1 187 / 2 skipped before this ACT; **zero new regressions** |
| The `llms` package suite | **1 176 passed / 4 skipped**, with **17 pre-existing failures** in `ai-sdk-reasoning` and `community.process-hygiene` — **the identical failing identities** as the baseline (verified by stash-and-rerun) |
| Typecheck (`tsconfig.dev.json`) | **45 errors, unchanged from the baseline**; **zero** in the ACT-owned files |
| SDK build (`bun run build:sdk`) | **SUCCEEDED** |
| Biome on the touched files | **clean** |
| `git diff --check` | **clean** |
| Secret scan on the new files | **clean** |

```text
ACT_OWNED_DIAGNOSTICS=0
NEW_REGRESSIONS=0
```

No unrelated full-repository baseline campaign was repeated. The two
pre-existing `llms` failure identities were compared against the baseline
directly (stash the change, re-run, compare) rather than assumed.

### 3.10 WHAT WAS DELIBERATELY NOT DONE

- No live inference request. The `llms` adapter witness uses a deterministic
  HTTP/SSE substitute; the core witnesses use a deterministic transport
  substitute.
- No model comparison, no provider or model configuration change.
- No PCK revival, no PCK vocabulary expansion, no source-bound evidence
  activation.
- No raw command-result publication expansion, no new evidence-selection
  heuristics, no sanitizer expansion, no command-classification expansion.
- No native-message summarizer integration.
- No general retry-policy redesign. The existing unrelated transport retry
  behaviour is unchanged.
- No Kurchatov or Strata modification, no LEAMAS repair, no B06 repair.
- No VSIX packaging or installation.
- No permanent diagnostic subsystem.
