# Causal discriminator — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01

## 1. The responsible transformation

**`renderStructuredToolPayload()`** in
`sdk/packages/core/src/extensions/context/compaction-shared.ts`.

It is the *earliest* production transformation that removes the fact. The
evidence that it is the earliest:

| Step | Fact present? | How observed |
|---|---|---|
| Canonical history | YES | `1795382314359_rb19c.messages.json`, canonical index 7: the payload body is the file's numbered content. |
| Budget projection (`budget-projection/project.ts`) | YES | The payload survived the projection: the projection selects MESSAGES, and this payload was folded. The `tool_result` block reached the serializer. |
| `flattenToolResultContent()` -> `renderStructuredToolPayload()` | **NO** | Direct observation: `flattenToolResultContent([{query, result, success}])` returns exactly `"[succeeded] #1: [result omitted]"`. |
| Summarizer input (`buildSummaryRequest`) | NO | The captured provider request's summarizer input is a production artifact of this function; the body is absent. |
| Generated summary | NO | The summary says "Actual command outputs were omitted from the transcript". |
| Compacted projection / budgeting | n/a | Already absent upstream. |
| Provider preparation (`MessageBuilder.buildForApi`) | NO | The captured iteration-85 request has 0 occurrences of the marker. |

Because the fact is absent at the serializer output, **case B** (present in the
summarizer input, omitted by the summary) and **case C** (present in the
summary, removed by projection) are excluded. The case is **A**.

The discriminator is therefore *causally isolated to one function*, not inferred
from the summary's appearance.

## 2. Structural proof (ablation)

Identical canonical input; **only** the restoration differs.

| Arm | Construction | Fact present? |
|---|---|---|
| **CONTROL** | `flattenToolResultContent(payload)` — the pre-repair production projection (no tool name available) | NO — `[succeeded] #1: [result omitted]` |
| **TREATMENT** | `flattenToolResultContent(payload, "read_files")` — the SAME payload, classified as a source-attributed file read | YES — the fact, attributed to its source path |

What differs between the arms: **the tool name**, and nothing else. The canonical
input, the compaction policy, the budget, the summarizer, the task contract and
the unrelated conversation history are identical.

The four structural proofs are asserted in
`compaction.evidence-fidelity01.test.ts` as `PROOF 1` .. `PROOF 4`. The CONTROL
arm is *re-derived inside the test* from the same canonical payload, so the
ablation is observable in both directions without editing production code.

**What this establishes:** necessity for the *representation failure*. It does
**not** by itself establish that the model's later behaviour was caused by the
omission.

## 3. Behavioural causality

**`BEHAVIORAL_CAUSE_UNPROVEN`** — the earlier `BEHAVIORAL_CAUSE_SUPPORTED` was **WITHDRAWN** by
the review of `e9ab27bc8` (see `correction-record.md`, P0-4).

### Why the original claim was wrong

The first version of this document treated the `grep -rn "kc.sh build"` tool call at
`messages[5]` of the captured provider request 85 as "the model's first action after seeing the
iteration-85 compacted context".

A provider-request capture records the **input sent to the model**, not the response generated
afterwards. A tool call already present in that input cannot be the model's reaction to that
same request.

### The corrected chronology

Comparing the tool calls in request 85 against request 84:

```
req84 tool-calls: 24
req85 tool-calls: 4
--- are req85 calls present in req84? ---
IN-84  {"requests": [{"prompt": "Does this class write/persist build-time configuration ...
IN-84  {"requests": [{"prompt": "Quote the code showing how the build command persists ...
IN-84  {"commands": ["cd ... && grep -rn -l \"startup.sh\" ...
IN-84  {"commands": "cd ... && git rev-parse HEAD ...
```

**All four tool calls in request 85 were already present in request 84.** The
`grep -rn "kc.sh build"` call was issued BEFORE the boundary, so it was already in the context
when the compaction happened.

The first genuinely NEW tool call after the boundary (request 86) is:

```
{"commands": ["cd ... && git rev-parse HEAD && git branch --show-current && git status --porcelain | head -30", ...]}
```

— re-establishing **repository identity**, not re-seeking the R4 `kc.sh build` fact.

And the canonical transcript shows the `read_files` of `startup.sh` occurs **exactly once**, at
canonical index 6. The model never re-read `startup.sh` after the boundary.

### The corrected disposition

| Claim | Disposition |
|---|---|
| The fact was removed from the provider-visible projection | `REPRODUCED` |
| The model re-investigated the R4 fact afterwards | `NOT_OBSERVED` |
| Behavioural causality | **`BEHAVIORAL_CAUSE_UNPROVEN`** |

### What this does and does not affect

It does **not** weaken the repair's justification. The preservation contract this ACT asserts is
a **fidelity** contract: a source-verified fact remains **accessible** in the provider-visible
working context. The RED is a fidelity assertion, not a behavioural-convergence claim, and it
stands: the fact WAS lost from the provider-visible projection, and the corrected projection
restores it.

It does mean the ACT no longer claims that the omission caused the session's failure to
converge. The historical session never produced the required R1-R10 verdict matrix for many
reasons, and the malformed-tool-call issue (`commands: null`) is an explicitly separate causal
chain that this ACT does not touch.

## 4. Repair selected (Option B — summarizer input fidelity)

The repair operates at the identified transformation and at the deterministic
carry-forward seam, in the two existing modules. It introduces **no** new
subsystem, **no** generic knowledge database, **no** model-based adjudication
and **no** new public protocol.

### The supported result class

A **source-attributed file read**: a `read_files` result payload whose `query` is
the file path and whose `result` is that file's content.

Why this class is safe to carry and a command's stdout is not:

- A file read's payload **identifies the source** it came from, and its body
  **IS the source text**. The agent was already reading that file; the content
  was already in its context.
- A command's stdout has **no attribution**: it is arbitrary program output
  that may contain anything the program printed, including a credential. The
  pre-existing design (`evidence-continuity.ts`) deliberately refused to carry it
  because "no regex can be made safe for arbitrary output". That refusal is
  **preserved unchanged**.

The class is selected by the tool NAME on the `tool_result` block — the same
data-shape-driven selection the module already uses for `read_files` file
operations in `extractFileOps()`.

### Fail-closed conditions

A file fact is carried only when ALL hold:

1. The result's tool is the source-file read tool.
2. The payload carries an affirmative `success: true` and no failure signal.
3. The query names a source path (a path-like string; a `:start-end` range
   suffix is stripped so the attribution names the SOURCE, not the window).
4. The result is a non-empty string.
5. For the deterministic carry-forward only: the result carries **exactly one**
   payload, so the file attribution is unambiguous.

### Bounds

- `SOURCE_FILE_FACT_CHAR_LIMIT = 2_000` characters per carried excerpt — a
  fixed constant, independent of the transcript size.
- The excerpt is marked when truncated (`...[truncated N chars]`), so a cut
  excerpt is never presented as complete.
- The read tool's line-number gutter (`<n> | `) is stripped: it is a
  presentation artifact of the reader, not part of the source.
- The section delimiters are escaped, so a carried file body cannot open or
  close the generated section and forge a new authority.

### What the repair deliberately does NOT do

- It does not copy arbitrary command output.
- It does not redact-with-regex arbitrary output and call it safe.
- It does not rewrite the summarizer's prose. The historical summary's "the
  outputs were omitted" claim is a **model assertion**, and the canonical record
  is the authority. The repair places the FACT next to the claim so the model
  can adjudicate it; it does not silence the model.
- It does not expand `MAX_CARRIED_OUTCOMES`. That budget is an
  execution-outcome budget, not a semantic-evidence guarantee, and this ACT
  does not change it.
