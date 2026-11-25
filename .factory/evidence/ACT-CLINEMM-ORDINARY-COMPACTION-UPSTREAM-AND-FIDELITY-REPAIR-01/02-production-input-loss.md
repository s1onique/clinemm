# ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01

## 02 — The production input loss, at the production boundary

```text
SESSION_ID:              1795491524406_mutdb
SOURCE_MESSAGE_COUNT:    244
CUT_INDEX (observed):    194
WORKLOAD:                W1, the exact historical compaction boundary
                         established by the preceding campaign
                         (ACT-CLINEMM-COMPACTION-INCREMENTAL-
                         KNOWLEDGE-LOSS-DISCRIMINATOR-01).
```

### 2.1 WHERE THE RELATIONSHIP IS LOST

The loss is NOT in the model. It is in
`sdk/packages/core/src/extensions/context/compaction-shared.ts`, in
`serializeConversation()` → `renderStructuredToolPayload()`.

`serializeConversation()` renders the canonical history into the plain text
that becomes the summarizer's input. For a tool result it calls
`renderStructuredToolPayload()`, which renders the **invocation** but
**omits the result body**:

```text
[Tool result]: <command> -> [result omitted]
```

The measured result over the W1 prefix:

```text
STRUCTURED_PAYLOADS:          123
WITH_A_COMMAND_CLASSIFICATION:   5
RESULT_BODIES_PRESENT:           0   (every successful body is "[result omitted]")
```

Only `5/123` structured payloads receive a command classification at all.
The reason is that the classification **fails closed**: a command that
contains a pipeline (`|`) or a redirection (`>`, `>>`) cannot be
unambiguously classified as a single command, so it is not classified.

**This is the loss boundary.** The invocation/result relationship becomes
unavailable in TWO independent places at the same seam:

| # | What is lost | Where |
| --- | --- | --- |
| L1 | The **result body** of every structured tool payload | `renderStructuredToolPayload()` — the body is replaced by `[result omitted]` |
| L2 | The **command classification** for most payloads | the classifier fails closed on pipelines/redirections, so ~118/123 payloads are not classified at all |

L1 alone is sufficient to destroy the relationship: even where the
invocation survives, its result does not.

### 2.2 WHY THE OMISSION EXISTS (the confidentiality rationale)

The omission is NOT an oversight. `renderStructuredToolPayload()` is a
**ClineMM-only addition** (it is ABSENT upstream at the inspected commit —
see `01-upstream-recon.md` §1.2). It exists because the summarizer input is
sent to a provider, and a raw command stdout can carry:

- credentials and tokens echoed by a failed login,
- the contents of `.env` / secret files,
- customer data in a log tail,
- private reasoning not intended for publication.

The executable controls that exist today are:

1. the **body omission** itself (`[result omitted]`),
2. the **command classification** that fails closed when a command cannot
   be safely classified,
3. the **sanitizer** (`sanitizeOutcomeText()`) applied to any body that IS
   published.

The ACT therefore requires (§8) that a faithful representation preserve
"original observed values **where authorized**" and forbids "unrestricted
raw command or stdout publication". The confidentiality controls are
load-bearing and are **conserved by this ACT**.

### 2.3 WHAT THE MODEL ACTUALLY RECEIVES

Measured on the real production path (`serializeConversation()` over the
W1 prefix):

```text
PRODUCTION_SUMMARY_INPUT_CHARS:      51 000-ish (measured; see the arms report)
[result omitted] MARKERS:            present, one per structured payload
[succeeded] MARKERS:                 present, but attached to the COMMAND,
                                      not to a value
```

The surviving signal is the *shape* of the operation (a command, and whether
it reported success), but never the *value* it produced. The decisive
propositions of O1, O4 and O7 are all **values** observed in a command
result.

### 2.4 THE RED, AT THE PRODUCTION SEAM

The production-seam RED is the one established by the preceding campaign
and re-verified here: for O1/O4/O7, the compacted context does not contain
the proposition at all. The classification recorded by the preceding
campaign was:

```text
O1  INFORMATION_MISSING_AFTER_COMPACTION
O4  INFORMATION_MISSING_AFTER_COMPACTION
O7  INFORMATION_MISSING_AFTER_COMPACTION
```

Re-verified in this ACT by direct adjudication (§05 below): the PROD arm
answers "the exit status is not stated in the context" for O1, and the
values it does state for O4/O7 are the ones the production serialization
happens to retain, not the decisive ones.

### 2.5 THE DISTINCTION THE ACT ASKS FOR

The ACT (§7) asks to distinguish, for O1/O4/O7:

| Category | O1 | O4 | O7 |
| --- | --- | --- | --- |
| Invocation omitted | no | no | no |
| Result omitted | **yes** | **yes** | **yes** |
| Invocation/result correlation lost | **yes** | **yes** | **yes** |
| Material qualification truncated | no | **yes** | **yes** |
| Complete proposition absent | **yes** | **yes** | **yes** |
| Complete proposition present but misinterpreted | no | no | no |

"Invocation omitted" is **no** for all three: the production serializer
does keep the command text. What it drops is the **result** and, with it,
the **correlation** between the operation and what it produced. The
qualification is truncated as a consequence: without the body there is
nothing to qualify.

This is a **complete-proposition-absent** failure, not a misinterpretation
failure, and not a model-capability failure.
