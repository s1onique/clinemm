# ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01

## 04 — Summary completeness (§11): a concrete RED, preserved separately

```text
CMP-04:   OPENED — with the exact owning boundary
RED:      REPRODUCED — preserved as a witness suite
REPAIR:   NOT IN THIS ACT (the ACT forbids combining an unrelated
          summary-installation repair with the input-fidelity repair)
```

### 4.1 THE OWNING BOUNDARY

The owning boundary is `runAgenticCompaction()` in
`sdk/packages/core/src/extensions/context/agentic-compaction.ts`, together
with `generateSummary()` in
`sdk/packages/core/src/extensions/context/summary-generation.ts`.

### 4.2 WHAT THE PRODUCTION CODE DOES

`generateSummary()` **does** collect the provider-reported incompleteness:

```ts
// summary-generation.ts
let incompleteReason: string | undefined;
...
} else if (chunk.type === "done") {
    if (!chunk.success && chunk.error) throw new Error(chunk.error);
    incompleteReason = chunk.incompleteReason ?? incompleteReason;
    failed ||= !chunk.success;
}
...
return { text, reasoningChars, failed, usedTools, incompleteReason };
```

`incompleteReason` is documented in the provider stream contract as the
reason the response is incomplete — for example `max_output_tokens`.

**No decision is made on it.** `runAgenticCompaction()` only asks whether a
summary EXISTS:

```ts
const rawSummary = summaryResult.text.trim();
if (!rawSummary) {
    // ...warn with a likelyCause, skip the compaction...
}
const summary = ensureFilesSection(rawSummary, fileOps);
...
buildSummaryMessage({ summary, fileOps, tokensBefore, userRunSpan })
```

So the asymmetry is:

| Provider outcome | Production behaviour |
| --- | --- |
| **EMPTY** response | the compaction is SKIPPED, a warning is logged with a `likelyCause`, the previous context is retained |
| **INCOMPLETE** response (`incompleteReason` set, e.g. output-token exhaustion) | the truncated text is installed as the summary, replacing the compacted history. **No warning. No log. No marker.** |
| **CANCELLED** | `options.signal?.throwIfAborted()` propagates the abort; the compaction is not installed |
| **TRANSPORT FAILURE** | `if (!chunk.success && chunk.error) throw new Error(chunk.error)` — the error propagates; the compaction is not installed |
| **FAILED** (`success === false`, no error) | `failed` is set, but the caller does not act on it either |

**The EMPTY and the INCOMPLETE cases behave oppositely, and the INCOMPLETE
case is the dangerous one**: it silently replaces usable context with a
continuation note that stops mid-sentence.

### 4.3 THE WITNESS SUITE

`sdk/packages/core/src/extensions/context/compaction.summary-completeness.red01.test.ts`

It drives the REAL production seam —
`createCompactionStateAwarePrepareTurn()` →
`createContextCompactionPrepareTurn()` → the production summarizer
transport → `buildSummaryMessage()` → `createSessionCompactionState()` →
`MessageBuilder.buildForApi()` — with a provider that reports
`incompleteReason: "max_output_tokens"` and returns a summary truncated
mid-sentence.

```text
R1: the provider-reported incompleteness REACHES the compaction seam
R2: the TRUNCATED summary IS installed, replacing the compacted history
R3: NOTHING records the incompleteness
    - not the persisted compaction metadata
    - not the provider-visible continuation
    - not the log
```

**Result: 3 passed (the RED is CONFIRMED — the defect is present).**

R2 and R3 together are the defect. A test suite that asserts the defect is
present is a *witness*, not a *gate*: it passes now and it must FAIL once
CMP-04 is repaired. That inversion is deliberate and is recorded in the
file's own header.

### 4.4 WHY THE REACHABILITY IS REAL, NOT THEORETICAL

Upstream issue **#14732** ("incomplete summary installed silently") is
OPEN upstream at the inspected commit, and the upstream PR **#14741**
("retry and warn when the summarizer truncates") is OPEN and UNMERGED.
Upstream's own diagnosis is that the user's `max output tokens` setting is
applied to summarizer requests, so a low setting truncates the summary
itself.

That is the same code path this fork runs. The upstream fix was NOT
adopted here because:

1. it is unmerged upstream and carries a broader retry/warn behaviour
   change than this ACT authorises, and
2. the ACT explicitly forbids combining an unrelated summary-installation
   repair with the input-fidelity repair.

**The witness is therefore preserved and CMP-04 is opened**, with the
owning boundary named above.

### 4.5 THE CONFIDENCE BOUNDARY

`incompleteReason` is only populated by providers that REPORT it. A
provider that silently truncates without reporting is not covered by this
RED. The RED covers the reported case, which is the case the upstream
issues document.
