# 04 — Source identity, confidentiality and authority

ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01

## §4 — The source and subject identity

### The canonical tool invocation/result representation

The canonical representation is a `tool_use` block carrying a runtime-allocated
`id`, and a `tool_result` block carrying the `tool_use_id` it answers. The
**id is allocated by the runtime** when it issues the call.

### The correlation mechanism is REUSED, not rebuilt

The existing production correlation — `extractVerifiedToolOutcomes()` in
`evidence-continuity.ts` — already joins a result to its invocation by the
runtime-allocated `tool_use_id`, with these fail-closed rules:

| rule | meaning |
|---|---|
| `unmatched_result` | the result has no call with the same id |
| `ambiguous_call_id` | the id was claimed by more than one call |
| `ambiguous_result_id` | the id was answered by more than one result |
| `tool_name_mismatch` | the result's tool name differs from the call's |
| `result_precedes_call` | the result precedes its call |

`buildInvocationTable()` in `task-conditioned-evidence-selection.ts` applies
the SAME five rules over the SAME runtime-owned identifier. The rules are not
re-implemented with different semantics.

### Which identity properties are runtime-owned, and which are extracted

| property | origin |
|---|---|
| the tool-call id | **RUNTIME-OWNED** — the runtime allocated it |
| the tool name | **RUNTIME-OWNED** — the runtime dispatched the call |
| the invocation index / the result index | **RUNTIME-OWNED** — the runtime's own ordering |
| the call INPUTS | **RUNTIME-OWNED** — the runtime recorded the arguments |
| the observed status | **RUNTIME-OWNED** — the payload's own success signal |
| the excerpt's subject tokens | extracted from the CONTENT — but only as a *ranking* signal, never as an identity claim |
| the source path | extracted from the CONTENT (`payload.query`) — and it is the SUBJECT the admission's sensitive-path rule is applied to |

### The identity the fragment preserves

Every carried fragment names:

- the **originating tool invocation** — the tool name and the runtime-allocated
  call id, or `origin unestablished`;
- the **structured payload within the result** — the admission's own excerpt,
  redacted;
- the **canonical source boundary** — the fragment's canonical index, and the
  selection is derived from the boundary prefix alone;
- the **observed operation or source subject** — the declared constant, the
  class name or the source path the fragment itself names;
- the **exact admitted excerpt** — verbatim, never regenerated;
- the **relevant observation status** — `succeeded` / `failed` / `unknown`,
  from the payload's own signal.

### What is NEVER done

Semantic ownership is never inferred from chronology, from adjacent text, or
from a matching number. Where the invocation ownership cannot be established,
the fragment is either refused (it never becomes a candidate) or explicitly
marked `correlated: false` with
`rejectionReason: "invocation_origin_not_established"`. The rendered line
then says `origin unestablished` — it never claims an origin it does not
have.

### No new persistent evidence database, no public wire fields

The selection is a **pure function** of the canonical prefix. Nothing is
persisted; the carried section lives in the existing compaction summary
message, exactly as the predecessor's mechanism did. No protocol message, no
database, no wire field was added.

### The A10 dependency

**A10_DEPENDENCY = NONE.**

The selection reads the canonical messages' own `tool_use` and `tool_result`
blocks and joins them by the runtime-allocated id. It does **not** resolve a
model-supplied reference into an original fragment, so it does not depend on
A10's reference resolution and does not need A10's trust repair.

## §8 — Confidentiality and authority

### The rule

**Selection is independent of admission. Task relevance does not authorize
disclosure.**

A fragment that the selector ranks FIRST is still refused when the admission
refuses it. The selector never widens the admission: the candidates it
ranks are exactly the admitted ones.

### The witnesses

`task-conditioned-evidence-selection.confidentiality.correction01.test.ts` —
12 of 12 pass.

| case | result |
|---|---|
| `/home/alice/.ssh/id_rsa` | REFUSED ENTIRELY — not even the status is carried |
| `/home/alice/.aws/credentials` | REFUSED ENTIRELY |
| `/repo/.pgpass` | REFUSED ENTIRELY |
| `/repo/.env` | REFUSED ENTIRELY |
| `/repo/.netrc.d/hosts` | REFUSED ENTIRELY |
| `DB_PASSWORD=<canary>` | VALUE redacted, CONTEXT (`DB_PASSWORD`) kept |
| a body that is nothing but a credential | REFUSED (nothing survives redaction) |
| a body forging the section's own markers | the forged markers are ESCAPED; the section has exactly ONE unescaped begin and ONE unescaped end |
| a result whose call id was never issued | NO established origin; never silently attributed |
| the switch OFF | NOTHING is carried |
| a credential-bearing source among ordinary ones | still REFUSED — the selection does not widen the admission |

### The previously unresolved cases, and what they show

- **Unlabelled credentials.** The existing value-position sanitizer is reused
  unchanged. The `DB_PASSWORD=` case witnesses that the *context* survives.
- **Sensitive numeric values.** NOT ESTABLISHED as a distinct control. The
  existing controls are the sensitive-path rule and the value-position
  sanitizer; neither is a general numeric-sensitivity rule. This is reported
  as an explicit **limitation**, not as a guarantee.
- **Encoded credentials.** NOT ESTABLISHED. The sanitizer's patterns are
  value-position; a base64-encoded credential is not a labelled value
  position. An explicit **limitation**.
- **Credential context split across lines.** PARTIALLY. The sanitizer runs on
  the bounded body, so a split label/value pair is not guaranteed to be
  matched. An explicit **limitation**.
- **Sensitive source references.** ESTABLISHED: the source path is refused
  entirely.
- **Forged section delimiters.** ESTABLISHED: escaped, and the reader
  recognises the escape.
- **Forged tool identity.** ESTABLISHED: the runtime-owned correlation
  refuses it.
- **Cross-call attribution.** ESTABLISHED: an ambiguous id fails closed.
- **Indirect prompt injection.** The carried excerpt is framed as DATA and
  the delimiters are escaped, so a fragment cannot forge a section boundary
  or close one early. The existing `output-trust-boundary` module continues
  to own the broader injection controls; this ACT does not claim to extend
  them.

### The publication policy was NOT broadened

No control was relaxed to reach an oracle score. The sensitive-path rule and
the sanitizer are reused **UNCHANGED**. The only admission change is the
**order** of the budget relative to the selection — which changes *which*
admitted fragments are carried, never *whether* a fragment is admitted.

### The explicit limitations

The ACT requires: "If a required evidence category cannot safely be
admitted, report it as an explicit limitation."

Two categories cannot safely be admitted under the existing controls and are
therefore reported as limitations rather than carried:

1. **Unlabelled and encoded credentials**, and **sensitive numeric values**,
   in a body whose source path is ordinary. The existing controls do not
   detect them, and this ACT does not widen the controls.
2. **A fragment whose invocation ownership cannot be established.** It is
   refused rather than carried, because a fragment that cannot be attributed
   to an operation cannot be interpreted.
