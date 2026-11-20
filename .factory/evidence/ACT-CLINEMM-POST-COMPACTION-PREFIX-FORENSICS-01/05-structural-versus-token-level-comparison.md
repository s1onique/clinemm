# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — Structural vs Token-Level Comparison

---

## 1. The question

The ACT requires that the structural difference be correlated with the
engine's observed token position **7,053** (P40 Kurchatov rejected
checkpoints) and with the observed reuse plateau **3,895** tokens — but only
after the exact Strata chat template and tokenizer have been validated
against the actual serving configuration.

The ACT is explicit that the following are NOT interchangeable:

* a message index;
* a JSON byte offset;
* an estimated token count;
* the selected reusable checkpoint length.

---

## 2. Can the token boundary be reproduced offline?

### Verdict: **NO — `TOKEN_BOUNDARY_UNAVAILABLE`.**

The exact Strata chat template and tokenizer are NOT available offline.

| Route | Method | Live result (2026-11-20, this ACT) |
|---|---|---|
| `http://192.168.50.111:8080/health` | GET | **200** — `{"status":"ok","max_context":131072,"model":"qwen3.8-flash-next-iq3_s","loaded":true,"service":"strata"}` |
| `http://192.168.50.111:8080/v1/tokenize` | GET | **404** |
| `http://192.168.50.111:8080/tokenize` | GET | **404** |
| `http://127.0.0.1:8000/tokenize` (local engine) | GET | **404** |
| `http://127.0.0.1:8000/health` (local engine) | GET | **200** — `{"status":"ok"}` (a DIFFERENT provider; out of scope) |

This independently re-confirms the prior ACT's finding
(`ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01/tokenizer-authority.md`):
**the installed Strata exposes no tokenizer-only route.** The unmerged Strata
`/tokenize` PR is not present and was not transplanted.

### 2.1 Why the Anthropic counting route is not a substitute

`/v1/messages/count_tokens` exists on Strata, but the prior ACT measured it
to be **NOT format-equivalent** for a request that carries tools: it
under-counts by a deterministic, schema-dependent amount per tool (9 / 17 /
26 tokens for the shapes measured), because the Anthropic route renders a
shorter tool-schema block than the OpenAI route does. ClineMM's real requests
ALWAYS carry tools, so the route is not an authority for the request as a
whole. Using it would substitute a different serialization for the one the
engine actually saw.

### 2.2 The estimator is explicitly NOT a substitute

ClineMM's conservative token-budget estimator is **not** used. It is a
byte-ratio heuristic for a BUDGET decision, not a model tokenizer, and
substituting it would produce a token position that was never the engine's.

---

## 3. The consequence

Because no verified tokenizer/template is available:

* **`FIRST_TOKEN_DIFFERENCE = N` is NOT asserted.** The ACT does not claim a
  token offset.
* The structural difference is retained in full and independently:
  * the first differing MESSAGE INDEX: **11 / 27 / 41**;
  * the changed PART TYPE: `tool-result`;
  * the changed BYTE LENGTH: 26,426 → 317 / 17,380 → 332 / 16,522 → 318;
  * the producing SEAM: `MessageBuilder.replaceOutdatedReadContent()`.

### 3.1 What is and is not reconciled with 7,053

| Figure | Source | Reconciled with the structural diff? |
|---|---|---|
| **7,053** | Engine's rejected-checkpoint first-mismatch position (P40 Kurchatov diagnostics) | **NO.** A token position in the engine's accounting; no verified tokenizer available to convert the structural diff into a token position. |
| **3,895** | Observed provider reuse depth (P40 and RTX 5060 Ti traces) | **NO — not claimed.** The ACT explains the plateau MECHANISM (an in-place rewrite in the early history invalidates the prefix from that block's start), but does not assert that the reuse depth equals any specific message index, byte offset or estimator value. |
| **26,426 bytes** | The rewritten tool result in M1 | Structural fact, measured. |

### 3.2 The mechanism claim, stated precisely

The ACT claims the following, and nothing stronger:

> A historical `read_files` tool result is rewritten IN PLACE between two
> consecutive requests. The rewrite occurs at message index 11 of 24 (M1), at
> the same role, the same position and the same `toolCallId`, and it replaces
> ~26 KB of content with a ~289-byte marker. Because the rewrite is in the
> EARLY history, every provider prefix cache that included that block is
> invalidated from the block's start — which is exactly the shape of a
> shallow, STICKY reuse plateau that persists across subsequent requests
> until the history is rebuilt.

The ACT does **not** claim the plateau depth equals any token figure computed
offline, because no verified tokenizer is available to compute it.

---

## 4. Structural comparison summary

| Layer | Status | Result |
|---|---|---|
| Structural (message / part / tool / system / stage) | **ACHIEVED** | The earliest model-facing difference is isolated and bound to its producing seam. |
| Token-level (model tokenizer) | **UNAVAILABLE** | `TOKEN_BOUNDARY_UNAVAILABLE` — no tokenizer route on the installed Strata; no template/tokenizer identity to validate. |

The structural diff is independently sufficient for the ACT's success
criterion: the earliest causal difference between consecutive model-facing
requests is identified, and the client-side mutation is distinguished from a
server-side checkpoint limitation (the client-side mutation is PRESENT; the
server-side checkpoint limitation is NOT the explanation, because D5's
precondition — a stable request prefix — is not met).
