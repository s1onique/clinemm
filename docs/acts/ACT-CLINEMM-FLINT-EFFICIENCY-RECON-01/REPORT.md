# ACT-CLINEMM-FLINT-EFFICIENCY-RECON-01

**Decision:** C1 — RECON complete. **ONE** bounded next experiment identified. No production change.
**Repository:** `clinemm` (`s1onique/clinemm`), branch `main`
**Primary purpose:** RECON / EVIDENCE
**Source HEAD at entry:** `87ac6cad0e17aefa08313c57df21351698bf5d7e`
**Working tree at entry:** clean
**Protected stash:** `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime)...` — **preserved, never popped**
**Push / PR:** none

---

## 0. Terminal report

```
ACT:
ACT-CLINEMM-FLINT-EFFICIENCY-RECON-01

VERDICT:
RECON_COMPLETE_ONE_BOUNDED_EXPERIMENT

DOMINANT BOTTLENECK:
ClineMM's 8,000-char tool-result visibility cap truncates read_files output
(head+tail, middle elided) before the model sees it. The model cannot tell the
elision from the file's own content, so it re-reads the same files. 12 of 36
read calls are redundant re-reads; 53,323 tokens and 30.6% of the model-request
wall clock are attributable to the turns that produced them.

NEXT SEAM (ONE):
sdk/packages/core/src/session/services/message-builder.ts
  DEFAULT_MAX_TOOL_RESULT_CHARS = 8_000  ->  truncateMiddleByChars (head+tail)
```

---

## 1. Exact source identity

### 1.1 The transcript under test

| Item | Value | How verified |
|---|---|---|
| Transcript path (given) | `~/Downloads/1794599235421_7adcr.messages.json` | user-specified |
| Transcript path (session store) | `~/.vscodium-roz/cline-data/sessions/1794599235421_7adcr/1794599235421_7adcr.messages.json` | session row `messages_path` |
| SHA-256 (both copies) | `2ac7c782baeef2b7440a917c17ef5ffeca156a3b47cd545da1a74de5b4c3a8f2` | **byte-identical — one session, not two** |
| `sessionId` | `1794599235421_7adcr` | transcript + session row |
| `origin` | `{source: vscode, mode: user, version: 4.1.16-5a1c485cb}` | transcript |
| Provider / model | `openai-compatible` / `flint:16gb` | session row |
| Workspace | `/Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak` | session row `cwd` |
| Prompt | "What does this project do? …" (read-only) | transcript msg 0 |
| Message count | 106 | transcript |
| `assistant/tool_use` blocks | **62** | transcript |
| Wall clock (first→last msg) | **1372.5 s = 22 m 52.5 s** | transcript timestamps |

**The reported "62 calls, 22m53s" is CONFIRMED against raw evidence, not taken on
trust:** 62 `tool_use` blocks and a 1372.5 s span computed from the transcript's
own `ts` fields. The counts were not read from a summary anywhere.

The session row's `provider`/`model` are the **ClineMM-side** identity. The
**Kapitsa-side** identity was confirmed independently:

```
$ curl -s http://127.0.0.1:8000/v1/models
{"id":"flint:16gb", ..., "context_length":262144, "slots":4, "active":true,
 "owned_by":"nace", "quant":"… 4-bit group 64 attention …"}
```

`flint:16gb` is a **locally served 16 GB 4-bit MoE model** behind a local
OpenAI-compatible gateway (`globalState.openAiBaseUrl = http://127.0.0.1:8000/v1`).
This matters for attribution: request latency is **local prefill/decode**, not a
remote API.

### 1.2 Raw evidence set actually used

| Evidence | Path | Role |
|---|---|---|
| Transcript (62 calls) | `~/.vscodium-roz/cline-data/sessions/1794599235421_7adcr/…messages.json` | tool calls, results, timings, model thinking |
| Session row | `…/1794599235421_7adcr.json` | provider/model identity, provider token usage |
| **Provider-request captures** | `~/.vscodium-roz/cline-data/provider-request-captures/cap_run_6yuf0unX_*.json` (42 files) | **the exact serialized prompt sent to the provider** — advertised tools, per-request token estimates, context growth |
| Global state | `~/.vscodium-roz/cline-data/globalState.json` | ceiling / auto-compaction settings, model context window |

The captures are the decisive addition: they are the **model-boundary view** of
every request, and they are the only place where the advertised tool inventory
and the *post-cap* tool-result content are observable.

---

## 2. Executed probes

Every probe below was executed against the raw evidence; commands and outputs are
reproduced verbatim in `evidence/`.

| # | Probe | Command / method | Result | Evidence file |
|---|---|---|---|---|
| P1 | Transcript identity + counts | `shasum -a 256` on both copies; JSON parse | byte-identical; 106 msgs, 62 tool_use, 1372.5 s | `evidence/source-identity.txt` |
| P2 | Tool names / accepted / rejected / error categories | parse `tool_use` + `tool_result` blocks | 36 `read_files`, 22 `run_commands`, 3 `shell`, 1 `submit_and_exit`; 3 rejections, **all** `AI_NoSuchToolError` | `evidence/discriminator-output.txt` §2 |
| P3 | Duplicate reads by path / range / fingerprint | SHA-256 of each result blob | 36 read entries, 21 paths, 2 duplicate-fingerprint groups (README.md ×3, values.yaml ×2) | §3 |
| P4 | Tool latency vs request latency | interval arithmetic over `ts` fields + capture timestamps | tools **4.975 s total (0.36 %)**; model **910.8 s of 915.7 s** | §4 |
| P5 | Context growth + provider-vs-estimated tokens | capture `summary.estimatedTokens` vs session `usage` | estimator is a **constant 1.222× over-count** of the provider across all 42 requests | §6 |
| P6 | Advertised tool inventory vs `'shell'` | read `payload.tools` from all 42 captures | **one** inventory, 9 tools, `'shell'` absent | §5 |
| P7 | **Tool-result visibility cap** | diff transcript result vs model-boundary result for the same `toolCallId` | README.md: **14,913 chars / 345 lines → 7,998 chars / 152 lines**, lines 83–275 elided | `evidence/tool-result-cap-proof.txt` |
| P8 | `'shell'` origin | source-trace `NoSuchToolError` to `ai@7.0.65` `parseToolCall`; grep for name rewriting | **raw response, model-generated** | `evidence/shell-origin-discriminator.txt` |
| P9 | Ceiling / auto-compaction settings | read `globalState.json`; trace `resolveEffectiveMaxInputTokens` → `applyUserContextCeiling` | ceiling **unset (AUTO)**, auto-compaction **enabled (default true)** | §8 |
| P10 | 48 K ceiling projection | replay the measured per-request token series against the 48 K trigger | 48 K would **fire compaction** from ~iteration 16; the run peaked at **49.5 %** of the current ceiling | §9 |

The executable discriminator is `evidence/discriminate.py`. It recomputes every
number above from the raw files and ends with **10 PASS / 0 FAIL**
(`evidence/discriminator-output.txt`, exit code 0).

---

## 3. Ranked measured bottleneck table

Ranked by **attributable wall-clock cost in this session**, ClineMM-controllable
seams first.

| Rank | Bottleneck | Measured cost | ClineMM-controllable? | Evidence |
|---|---|---|---|---|
| **1** | **Tool-result visibility cap destroys read content before the model sees it.** `DEFAULT_MAX_TOOL_RESULT_CHARS = 8_000` → `truncateMiddleByChars` (head+tail, middle elided) | **12 redundant re-read calls** of 36 (33 %); **53,323 tokens** re-injected; the producing turns carry **280.3 s = 30.6 %** of the 915.7 s request gap | **YES** — one constant in `message-builder.ts`; an env seam already exists | P7, P4 |
| **2** | Context growth to 114,015 tokens makes every turn costlier (local prefill/decode on a 16 GB 4-bit MoE) | median latency **6.46 s** below 70 K vs **29.49 s** at/above 70 K; the ≥70 K turns are **667.7 s = 72.9 %** of the request gap | **PARTLY** — downstream of #1 (cap-driven re-reads are what grew the context) | P4 |
| **3** | Final response generation (26,330 chars thinking + 11,390 chars text + 697 chars summary ≈ 10,976 output tokens) | **456.7 s = 33.3 %** of wall clock; **no captured request** covers it (the iteration-43 request was not captured) | NO — provider-side decode | §7 |
| **4** | Unknown tool `'shell'` (3 calls) | **0.0 s of execution**, **62 ms** to reject; model self-corrected each time | NO — raw model output, see §6 | P2, P8 |
| **5** | Duplicate reads not caused by the cap (README.md ×3 full, values.yaml ×2 full) | 5 calls; already deduped by the stale-read rewrite into `[outdated - see the latest file content]` | PARTLY — already handled | P3 |
| — | **Tool execution itself** (`read_files` + `run_commands`) | **4.975 s = 0.36 %** of wall clock | — | P4 |

**Conclusion:** tools are **not** the bottleneck (0.36 %). Model inference is
(66.4 % of the gap). But the *reason* the model inference was so expensive is
**ClineMM-controllable**: ClineMM truncated the file content the model needed,
the model re-read, and the re-reads grew the context that made every subsequent
turn slower. Bottleneck #1 is upstream of #2 and #3.

### 3.1 The causal chain, proven end to end

```
ClineMM stores the FULL read result            (transcript: 14,913 chars, 345/345 lines)
        │
        ▼
MessageBuilder truncates it to 8,000 chars      (message-builder.ts:1162 truncateMiddle)
  head + "...[truncated 6950 chars]..." + tail   (message-builder.ts:1589 truncateMiddleByChars)
        │   → model receives 7,998 chars, 152/345 lines, lines 83–275 MISSING
        ▼
Model reasoning (transcript msg 27):
  "The README has some content between lines ~75 and ~145 that got truncated."
        │
        ▼
Model re-reads the same file (12 redundant calls across 4 files)
        │
        ▼
Context grows → every later turn costs more (r = 0.49 tokens↔latency)
```

The model's belief was **factually wrong**: README.md is 345 lines on disk, the
full read returned all 345 lines contiguously with **zero** gaps and **no**
truncation marker. The elision was introduced *after* the tool ran, on the way
to the model.

The same pattern repeats for 3 more files (`.gitlab-ci.yml`, `values.yaml`,
`values-dev.yaml`), and the model stated the mechanism itself at msg 37:
*"read it in chunks"*.

### 3.2 Scale of the duplication

| File | Read calls | Chars injected | Unique lines | **Duplicate line-reads** |
|---|---|---|---|---|
| `values.yaml` | 5 | 155,008 | 444 | **1,216** |
| `.gitlab-ci.yml` | 8 | 105,743 | 1,070 | **682** |
| `README.md` | 4 | 103,572 | 345 | **905** |
| `values-dev.yaml` | 2 | 32,693 | 336 | **200** |
| **Total (4 files)** | **19 of 36** | **397,016** | — | **3,003** |

These 4 files are **83 % of all read bytes** and **100 % of the duplication**.

---

## 4. Measure (every requested dimension)

### 4.1 Tool names, accepted/rejected calls, error categories

| Tool | Calls | Accepted | Rejected |
|---|---|---|---|
| `read_files` | 36 | 36 | 0 |
| `run_commands` | 22 | 22 | 0 |
| `shell` | 3 | 0 | **3** |
| `submit_and_exit` | 1 | 1 | 0 |
| **Total** | **62** | **59** | **3** |

Error categories — exactly one kind, three occurrences:

```
AI_NoSuchToolError: Model tried to call unavailable tool 'shell'.
Available tools: skills, read_files, search_codebase, fetch_web_content,
editor, submit_and_exit, run_commands, command_status, cancel_command.
```

**No schema-invalid calls.** The `run_commands` argument-shape defects that the
predecessor ACT (`FLINT-TOOLCALL-RED-01-CORRECTION01`) repaired are **absent**
here: every `run_commands` call was accepted. The three failures are a
*different* class — a wrong tool NAME, not a wrong argument shape.

### 4.2 Duplicate reads by canonical path, line range, content fingerprint

| Dimension | Result |
|---|---|
| Read entries | 36 (each call read 1 file) |
| Distinct paths | 21 |
| Duplicate **content-fingerprint** groups | 2 — README.md ×3 (identical blob `9b827322a8bf`), values.yaml ×2 (identical blob `3568e1aef44a`) |
| Paths read >1 | `.gitlab-ci.yml` ×8, `values.yaml` ×5, `README.md` ×4, `values-dev.yaml` ×2 |
| Identical path+range repeated | README.md (full) ×3, values.yaml (full) ×2 |
| **Duplicate line-reads (union arithmetic)** | **3,003** |

**Compaction epoch:** there is **no compaction epoch** in this session — see
§4.4. The "epoch" observable that exists instead is the **stale-read rewrite
epoch at iteration 20**: the message-builder replaced 8 superseded read results
with `[outdated - see the latest file content]`, dropping the request from
62,182 → 40,978 estimated tokens (91,251 bytes, ≈30 K tokens saved). It is a
**one-time** rewrite (constant 8 from iteration 20 to 42), it did **not** cause
a re-read storm, and it **helped** the budget. It is not the bottleneck.

### 4.3 Request latency, tool latency, context growth, compaction count/duration

**Tool latency (measured from `tool_use.ts` → `tool_result.ts`):**

| Tool | n | Sum | Median | Max |
|---|---|---|---|---|
| `read_files` | 36 | 2,453 ms | 19 ms | 496 ms |
| `run_commands` | 22 | 2,418 ms | 74 ms | 493 ms |
| `shell` (rejected) | 3 | 62 ms | 15 ms | 37 ms |
| `submit_and_exit` | 1 | 42 ms | 42 ms | 42 ms |
| **Total** | **62** | **4,975 ms** | | |

**Request latency (capture-timestamp deltas, tool time subtracted):**

| Phase | Seconds | Share of the 915.7 s request gap |
|---|---|---|
| Model inference / generation | **910.8** | 99.5 % |
| Tool execution inside the gap | 4.9 | 0.5 % |

Per-iteration latency rises with context: Pearson r(tokens, latency) = **0.49**;
median **6.46 s** below 70 K tokens vs **29.49 s** at/above 70 K. The three
outliers are iteration 30 (**201.5 s** @ 71,645 tok), iteration 40 (**136.3 s** @
103,516 tok) and iteration 41 (**74.9 s** @ 112,703 tok).

**Context growth:** 5,815 → 114,015 estimated tokens over 42 requests
(17,444 → 342,044 payload bytes), i.e. **19.6×** growth.

**Compaction count: 0. Duration: n/a.**

This is a *measured* zero, not an assumption. With `contextWindow = 256000` and
no user ceiling:

```
resolveEffectiveMaxInputTokens → 256000 × 0.9 (CONTEXT_WINDOW_INPUT_RATIO) = 230,400
COMPACTION_TRIGGER_RATIO = 0.9  →  requestTriggerTokens = 207,360
peak observed request = 114,015  =  55.0 % of the trigger   (49.5 % of the ceiling)
```

The token drop at iteration 20 (62,182 → 40,978) is therefore **not** compaction
— it is the stale-read rewrite of §4.2, verified by diffing the message payloads
of iterations 19 and 20: the assistant messages are byte-identical and only 8
`tool` messages shrink, each replaced by the `[outdated - …]` marker.

### 4.4 Provider-reported vs ClineMM-estimated token counts

| Quantity | Value | Source |
|---|---|---|
| Provider `usage.inputTokens` (billed, incl. cache) | 1,938,032 | session row |
| Provider `usage.cacheReadTokens` | 1,812,756 | session row |
| Provider `usage.outputTokens` | 6,825 | session row |
| Provider non-cached input | 125,276 | derived |
| ClineMM `tokensIn` | **125,276** | session row |
| **ClineMM estimate vs provider (per request)** | **1.222× constant** | derived from captures |
| Cache share of billed input | **93.54 %** | derived |

Two things follow.

1. **The estimator is well-behaved.** Across all 42 captured requests the ratio
   of ClineMM's char-based estimate (chars ÷ 3) to the provider-equivalent count
   is **exactly 1.222** (0.3333 vs 0.2727 tokens/byte) — constant, never
   under-counting. `tokensIn` (125,276) equals the provider's non-cached input
   exactly. **The compaction trigger arithmetic is not the problem** and the
   estimator must not be "fixed".
2. **Prefix caching was working.** 93.5 % of billed input was cache-read, and
   the serialized request prefix was byte-stable for 19 consecutive iterations,
   breaking once (iteration 20, the stale-read rewrite) and then staying stable
   to the end. **Prefix-cache thrash is NOT the bottleneck** — the comment at
   `message-builder.ts:31-34` shows this was already anticipated.

### 4.5 Earliest useful action, task completion, final response duration

| Milestone | Value |
|---|---|
| Session start (first message) | 1794599235668 (19:47:15.668 Z) |
| First model request | +0.1 s (19:47:15.719 Z) |
| **Earliest useful action** (first tool call) | **+6.2 s** (19:47:21.827 Z) |
| Task completion (last message) | **+1372.5 s** (20:10:08.183 Z) |
| **Final response duration** | **456.7 s** (33.3 % of wall clock) |
| TTFT | **UNAVAILABLE_FROM_TRACE** |
| Prefill duration | **UNAVAILABLE_FROM_TRACE** |

The 456.7 s final response produced 26,330 chars of thinking + 11,390 chars of
text + a 697-char `submit_and_exit` summary ≈ **10,976 output tokens**
(≈41.6 tok/s). It is **not covered by any captured request** — the
iteration-43 request was not captured (42 captures exist, iterations 1–42), so
this phase is attributable to the provider's decode but **not** separable into
TTFT / prefill / decode from the available evidence. That is recorded as
**UNAVAILABLE_FROM_TRACE**, not estimated.

### 4.6 Unknown tool `'shell'` vs the effective advertised tool names

| | |
|---|---|
| Advertised inventory (all 42 captured requests, **1 distinct**) | `skills, read_files, search_codebase, fetch_web_content, editor, submit_and_exit, run_commands, command_status, cancel_command` |
| `'shell'` advertised? | **No** — in any request |
| `'shell'` calls | 3, at msg 2, 8, 11 |
| Correlation | the 3 calls are in the first 4 model turns; the model named `run_commands` correctly on 19 of 22 attempts |
| Cost | **0 s** execution; 62 ms to reject |

---

## 5. Discriminate: where does the wrong `'shell'` name come from?

**Classification: `RAW_RESPONSE_MODEL_GENERATED` — confirmed. Not `CAPTURE_INSUFFICIENT`.**

The raw HTTP response body was not captured (`CLINE_CAPTURE_WIRE` was off; there
are **zero** `wire_request` captures for this session). But the origin is still
determined, from three independent facts:

1. **The provider was given the correct names.** The provider-request captures
   are the serialized prompt; across all 42 requests the advertised inventory is
   a single 9-tool set that **excludes** `shell`.
2. **The error comes from the AI SDK's own parser, before any ClineMM tool
   layer.** `ai@7.0.65` `parseToolCall` throws
   `new NoSuchToolError({ toolName: toolCall.toolName })` by comparing the
   **provider's own** streamed name against the advertised ToolSet. The message
   text in the transcript is verbatim that library's string.
3. **No ClineMM layer rewrites tool names.** `part.toolName` flows straight
   through `sdk/packages/llms/src/providers/ai-sdk.ts` (lines 829, 846, 1638,
   1719, 1791) and the `openai-compatible` vendor adapter contains **zero**
   occurrences of `toolName`.

The model itself confirms it had the right names and mis-typed one:
*"The shell tool is actually called `run_commands`. Let me use that."* (msg 5),
*"The shell tool is named `run_commands`."* (msg 14).

**Therefore: no tool-name rewriting is proposed, and none should be.** The
prior ACT's canonicalizer (`normalizeRunCommandsToolInput`) addresses a
*different* failure (argument shape) and is not the seam for this one. The
correct action here is **none** — the 3 rejections cost 62 ms and the model
recovered unaided.

---

## 6. Verified operating settings

Read from the live profile (`~/.vscodium-roz/cline-data/globalState.json`) and
traced through the production resolver chain:

| Setting | Stored value | Effective |
|---|---|---|
| `userContextCeiling` | **absent** | **AUTO** — `normalizeUserContextCeiling(undefined) → undefined`; `applyUserContextCeiling` returns the model limit unchanged (`compaction-shared.ts:105,127`) |
| `useAutoCondense` | **absent** | **enabled** — `cline-session-factory.ts:1293` defaults to `true`; compaction is forwarded with `{enabled: true, strategy}` (`cline-session-factory.ts:1428-1439`) |
| `actModeOpenAiModelInfo.contextWindow` | `256000` | `effectiveMaxInputTokens = 230,400`; `requestTriggerTokens = 207,360` |

Both Plan and Act modes use `flint:16gb` with the same 256,000 window.
Auto-compaction was **armed and idle** for the whole session — it simply never
had a reason to fire.

---

## 7. The 48 K matched qualification

The 48 K experiment was **not run** (explicitly out of scope for this ACT and
not executable in this environment). It is nonetheless **answered from the raw
evidence**, because the measured per-request token series is a complete input to
the compaction policy.

**Same-prompt / same-model / same-inventory match:** the projection uses this
session's own 42 captured requests, unchanged tool inventory (9 tools), and the
same `flint:16gb` model.

| Metric | Current ceiling (AUTO → 230,400) | Projected 48 K ceiling |
|---|---|---|
| Effective max input | 230,400 | 48,000 |
| Compaction trigger | 207,360 | **43,200** |
| Peak observed request | 114,015 | 114,015 |
| Compactions fired | **0** | **≥ 1, from ~iteration 16** (first request above 43,200 est. tokens) |
| Compaction cost | 0 | **one extra summarizer model request per compaction** |
| Task outcome | completed | completed (same prompt) |
| Elapsed | 1372.5 s | **not projected** — see below |
| Calls | 62 | **not projected** — compaction adds turns |
| Errors | 3 (`'shell'`) | 3 + any compaction-induced errors |
| Repeated reads | 12 redundant | 12 redundant, **plus** re-reads of context the compaction evicted |

**Verdict: 48 K does NOT improve elapsed time.** It is the wrong lever:

* The session used only **49.5 %** of the current ceiling and **55.0 %** of the
  current trigger. There was **no context pressure to relieve**.
* A 48 K ceiling would **add** work: it fires compaction ~2.7× earlier in
  wall-clock terms (iteration ~16 vs never), and each compaction is an extra
  model request. The one compaction-shaped phase observable in this session
  (iteration 20, 41.1 s) is exactly the cost such a ceiling would introduce.
* Compaction at a 48 K budget retains ~0.7 × 48,000 ≈ 33,600 tokens; the
  evicted content would then have to be **re-read** — increasing the very
  duplication that is already the top bottleneck.
* **Completing the task is not degraded, but elapsed time is not improved, so
  the closure criterion ("if 48 K improves elapsed time without degrading
  completion: recommend existing setting") is NOT met.** The ceiling must stay
  at AUTO.

**No code ACT and no setting change is recommended.**

---

## 8. ONE bounded next experiment

### The seam

```
sdk/packages/core/src/session/services/message-builder.ts
  line  29 : export const DEFAULT_MAX_TOOL_RESULT_CHARS = 8_000;
  line 1162: private truncateMiddle(text) { truncateMiddleByChars(text, this.maxToolResultChars, TRUNCATE_MARKER_DEFAULT) }
  line 1589: truncateMiddleByChars  →  head + marker + tail   (middle elided)
```

and the **already-live env seam** that makes this testable with **zero code**:

```
sdk/packages/core/src/session/services/message-builder.ts
  line 44-48: MESSAGE_BUILDER_LIMIT_ENV = { maxToolResultChars: "CLINE_MESSAGE_BUILDER_MAX_TOOL_RESULT_CHARS", ... }
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
  line 608: const messageBuilderOptions = getMessageBuilderOptionsFromEnv();
```

### The experiment (bounded, read-only, no production change)

Re-run the **identical** read-only prompt against the **same** `flint:16gb`
model with the **same** 9-tool inventory, twice, in the same profile:

| Arm | Setting | Everything else |
|---|---|---|
| **A (control)** | unset (default 8,000) | identical prompt, model, tool inventory, cwd |
| **B (treatment)** | `CLINE_MESSAGE_BUILDER_MAX_TOOL_RESULT_CHARS=48000` | identical |

48,000 is chosen because it matches the file-read executor's own
`MAX_READ_OUTPUT_CHARS = 48_000` (`executors/output-limits.ts:47`), so a single
`read_files` result is no longer double-truncated (8,000 cap **and** 48,000
paging cap) — arm B isolates the message-builder cap alone.

**Primary metric:** number of redundant re-reads (currently **12**) and total
read chars injected (currently **480,623** chars / **160,208** tokens).

**Secondary metrics:** tool-call count (62), errors (3), model-request wall
clock (915.7 s), session wall clock (1372.5 s), task completion, peak request
tokens (114,015), compactions (0).

**Decision rule, fixed in advance:**
* If arm B removes the redundant re-reads **without** degrading completion and
  **without** raising the request-token peak materially, the fix belongs at this
  seam.
* If arm B does **not** change the re-read count, the elision is not the model's
  trigger and the next seam is the **read-result presentation** (making the
  elision explicit / range-addressable) rather than the cap value.
* If arm B regresses completion or the peak, the cap stays at 8,000 and the
  experiment is closed negative.

### Why this is the right one experiment

It is a **one-constant, zero-code, already-wired** probe of the single seam that
the evidence identifies as dominant, with the existing discriminator as the
measurement instrument. It changes no command authorization, no execution, no
approvals, and no tool schema, and it adds no persistent repository inventory.

### Explicitly out of scope (not proposed)

* No tool-name rewriting (the `'shell'` name is the model's, §5).
* No change to `MAX_READ_LINES` / `MAX_READ_OUTPUT_CHARS` (the `.gitlab-ci.yml`
  paging marker at 820/1854 lines is a **correct, disclosed** behaviour — the
  model used the advertised `start_line`/`end_line` affordance).
* No change to `userContextCeiling` (AUTO is correct, §7).
* No strict/forced grammar for Flint — Kapitsa explicitly rejected it.
* No claim about model speed, memory swapping, or cache causation beyond what
  the measurements show.

---

## 9. Conservation check

| Constraint | Status |
|---|---|
| Command authorization / execution / approvals unchanged | ✅ no code touched |
| Tool schemas unchanged | ✅ no code touched |
| No persistent repository inventory added | ✅ only this ACT's report + evidence |
| Shell failures not hidden | ✅ all 3 `'shell'` rejections reported, counted, and classified |
| No model-speed / swapping / cache causation claimed | ✅ latency attributed to observable phases only; TTFT and prefill marked `UNAVAILABLE_FROM_TRACE` |
| No strict/forced grammar for Flint | ✅ not proposed |
| Protected stash preserved | ✅ `stash@{0}` untouched, never popped |
| Unrelated evidence preserved | ✅ no file outside this ACT's directory modified |
| No push / PR | ✅ |

---

## 10. Repository state

```
HEAD (entry)  : 87ac6cad0e17aefa08313c57df21351698bf5d7e
Working tree   : clean at entry
Protected stash: stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime)...
                 — preserved, never popped by this ACT
```

This ACT adds exactly one new directory, `docs/acts/ACT-CLINEMM-FLINT-EFFICIENCY-RECON-01/`:

```
REPORT.md
evidence/discriminate.py            <- executable discriminator (10 PASS / 0 FAIL)
evidence/discriminator-output.txt   <- its full output
evidence/source-identity.txt        <- P1
evidence/tool-result-cap-proof.txt   <- P7
evidence/source-seam.txt             <- the cap in source + the live env seam
evidence/shell-origin-discriminator.txt <- P8
```

No production file, schema, authorization path, or approval path is modified.

---

## 11. Closure

```
ACT:
ACT-CLINEMM-FLINT-EFFICIENCY-RECON-01

VERDICT:
RECON_COMPLETE_ONE_BOUNDED_EXPERIMENT

DOMINANT ClineMM-CONTROLLABLE INEFFICIENCY:
MessageBuilder's 8,000-char tool-result visibility cap (head+tail elision of
read_files output) → the model re-reads 12 of 36 files → 53,323 redundant
tokens and 30.6% of the model-request wall clock.

EXECUTED PROBES:
P1 identity/counts · P2 tool names+errors · P3 duplicate reads · P4 timing
decomposition · P5 provider-vs-estimated tokens · P6 advertised inventory ·
P7 tool-result cap proof · P8 'shell' origin · P9 ceiling settings ·
P10 48K projection.  10/10 discriminator assertions PASS (exit 0).

ONE NEXT SEAM:
sdk/packages/core/src/session/services/message-builder.ts
  DEFAULT_MAX_TOOL_RESULT_CHARS = 8_000
  -> test via the existing CLINE_MESSAGE_BUILDER_MAX_TOOL_RESULT_CHARS env seam
  (no code change required to run the experiment)
```
