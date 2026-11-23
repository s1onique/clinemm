# 03 — Summarizer-request capture correlation

**Label:** `REAL` for the captured artifacts; `NOT_APPLICABLE` for the run id named
by the previous ACT.

---

## 1. The P1 correction, and what it actually changes

The previous ACT (`CORRECTION01`) recorded seven summarizer captures under run id
`cap_41f75c5386d5db78` and flagged that captures **#1–#4 predate the subject
session**, leaving **#5, #6, #7** as the potential subject-session captures.

**That numbering was derived from the FILESYSTEM MTIME of the capture files. The
authoritative field is the capture's own `timestamp`.** Re-reading the `timestamp`
field of each capture reverses the numbering:

| File | capture `timestamp` | file mtime | in subject session? |
|---|---|---|---|
| `…ai_sdk_prompt.1.provider-request.json` | **2026-11-23T01:02:12.706Z** | 2026-11-23 04:02 | **YES** |
| `…ai_sdk_prompt.2.provider-request.json` | **2026-11-23T01:14:57.428Z** | 2026-11-23 04:14 | **YES** |
| `…ai_sdk_prompt.3.provider-request.json` | **2026-11-23T01:32:30.273Z** | 2026-11-23 04:32 | **YES** |
| `…ai_sdk_prompt.4.provider-request.json` | 2026-11-22T22:09:27.030Z | 2026-11-23 01:09 | no |
| `…ai_sdk_prompt.5.provider-request.json` | 2026-11-22T22:21:01.859Z | 2026-11-23 01:21 | no |
| `…ai_sdk_prompt.6.provider-request.json` | 2026-11-22T22:42:42.417Z | 2026-11-23 01:42 | no |
| `…ai_sdk_prompt.7.provider-request.json` | 2026-11-22T22:55:35.700Z | 2026-11-23 01:55 | no |

The subject session ran `2026-11-23T00:49:48.104Z` → `2026-11-23T01:33:25.390Z`.
Only captures **#1, #2, #3** fall inside that window.

> **Correction to the carried-forward P1 statement.** The previous ACT's #5/#6/#7
> are in fact the **three pre-session** captures. The subject-session captures are
> **#1/#2/#3**. The previous ACT's *conclusion* — that the summarizer never saw
> the adjudications — is unaffected and is re-derived below from the correct
> captures. The *identity* of the subject captures is corrected here.

---

## 2. Exact joining — NOT timestamp proximity

The ACT requires an exact join, and states that "timestamp proximity alone is not
authoritative correlation". Two **independent** joins were performed. Both agree.

### 2.1 Join by timestamp proximity (supporting only)

The capture `timestamp` is compared with the canonical message timestamps:

| Capture | `timestamp` | Nearest canonical index | Δ |
|---|---|---|---|
| #1 | 2026-11-23T01:02:12.706Z | **73** (`msg_NFcQJe45`, the last message folded at 36→37) | 31 ms |
| #2 | 2026-11-23T01:14:57.428Z | **125** (`msg_7ztXgjkW`, the last message folded at 62→63) | 42 ms |
| #3 | 2026-11-23T01:32:30.273Z | 195 (a later boundary) | 75 ms |

### 2.2 Join by PAYLOAD IDENTITY (authoritative)

The serialized summarizer request renders each tool call as
`[Bot tool calls]: <name>(<input>)`. Extracting the ordered **tool-name
sequence** from each captured request and matching it against the ordered
tool-name sequence of the canonical `tool_use` blocks gives a **unique**
alignment:

| Capture | Captured tool-name sequence matches canonical tool-use index | Meaning |
|---|---|---|
| **#1** | **0 … 33** (34 calls) | the fold of canonical prefix `0..73` → **the 36→37 boundary** |
| **#2** | **34 … 57** (24 calls) | the fold continuing after the previous summary → **the 62→63 boundary** |
| **#3** | **58 … 88** (31 calls) | a later boundary |

The offsets are exactly what the production compaction semantics predict:

- The **36→37** decision is the FIRST compaction of the session, so it folds the
  canonical history from tool-use index 0.
- The **62→63** decision is the SECOND compaction. Its
  `newMessagesToFold` starts **after** the previous summary message, so it folds
  the canonical tool calls that follow the first fold's tail — hence the offset
  of 34, exactly the length of fold #1's captured sequence.

**The capture → decision correlation is EXACT on payload identity.**

**`SUMMARIZER_CAPTURE_UNBOUND` does NOT apply.** Every subject-session capture is
bound to a specific compaction decision by two independent joins.

---

## 3. The decisive measurement — what the summarizer actually received

Every subject-session summarizer request was searched for:

| Probe | capture #1 (36→37) | capture #2 (62→63) | capture #3 (later) |
|---|---|---|---|
| `[Bot thinking]` markers | **0** | **0** | **0** |
| R8 adjudication fragment | 0 | 0 | 0 |
| R7 adjudication fragment | 0 | 0 | 0 |
| R3 adjudication fragment | 0 | 0 | 0 |
| R4 narrowing fragment | 0 | 0 | 0 |
| `[Bot tool calls]` markers | 34 | 24 | 31 |
| `[Tool result]` markers | 34 | 24 | 31 |

> **The three adjudications were removed BEFORE the summarizer request was
> built.** They are not in the summarizer's input window in any form — not as a
> literal phrase, not as a paraphrase, not as a `[Bot thinking]` block.

This is the decisive historical measurement, and it is the exact behaviour the
production-seam RED reproduces.

---

## 4. What the capture does and does not prove

| Claim | Status |
|---|---|
| The summarizer's input window did not contain the adjudications | **REAL** (direct measurement of a captured production request) |
| The adjudications were therefore absent from the generated summary | **REAL** (the persisted sidecar summary contains 0 occurrences of every adjudication phrase — see `04-transformation-boundary-matrix.md`) |
| The generated summary's `## Blocked` section was truthful about its own input | **REAL** (it said the outputs were omitted; its input really did omit them) |
| How a **live model** would respond to a summarizer input that DID contain the adjudication | **NOT_EXECUTED** — no live model was run, and none is required by this ACT |

No claim in this ACT depends on live model behaviour.

---

## 5. Capture window definition

**`CAPTURE_WINDOW`** = the three subject-session summarizer-request captures of
run `cap_41f75c5386d5db78`, i.e.

```
cap_41f75c5386d5db78.ai_sdk_prompt.1.provider-request.json   2026-11-23T01:02:12.706Z  -> 36->37
cap_41f75c5386d5db78.ai_sdk_prompt.2.provider-request.json   2026-11-23T01:14:57.428Z  -> 62->63
cap_41f75c5386d5db78.ai_sdk_prompt.3.provider-request.json   2026-11-23T01:32:30.273Z  -> later boundary
```

plus the four compaction-candidate snapshots for decisions `#37#36`, `#63#62`,
`#97#96`, `#98#97` of session `1795394987994_fpu77`.

The run id named by the previous ACT (`cap_run_rX-Rbi8y`) **does not exist on this
machine** and remains **`UNAVAILABLE_FROM_TRACE`**. It is not used to support any
causal claim in this ACT.

---

## 6. Privacy

All seven capture files remain in
`~/.vscodium-roz/cline-data/provider-request-captures/` and are **PRIVATE — not
committed**. Their SHA-256 values are recorded in `artifact-hashes.json` under
`private_input_artifacts`. No capture body is reproduced in this evidence
directory.
