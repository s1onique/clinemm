# timeline-summary.md — ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01

**Session:** `1795252560069_t82cp` · **Model:** `qwen3.8-flash-next-q2_0`
(`openai-compatible`) · **Run:** `run_3tw2rDtz` (autonomous, iterations 1–277)

**Ledger:** `timeline.jsonl` — 661 events, one JSON object per line, sanitized.

> **CORRECTION01 + CORRECTION02 notice.** This file was corrected under
> `ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION01` and again under
> `ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION02`: the compaction
> count was corrected from 257 requests to **16 payload identities** and then
> to **8 compaction events** (+ 8 enrichments) (F1); the result
> classification was relabelled to its real evidence strength and its
> fingerprint-ordering defect repaired (F2); the readiness claim was narrowed
> (F3, in `readiness-analysis.md`). The four intervals, the terminality facts
> and the H2/H5 conclusions are unchanged and were re-verified.

---

## 1. How the ledger was built

```
$ python3 tools/build-timeline.py \
    --session-dir ~/.vscodium-roz/cline-data/sessions/1795252560069_t82cp \
    --capture-dir ~/.vscodium-roz/cline-data/provider-request-captures \
    --out timeline.jsonl
wrote 661 events to timeline.jsonl     # exit 0
```

**Join method.** Each assistant turn is joined to its provider request by
**ordinal**: the autonomous run has exactly 277 assistant turns and exactly
277 provider-request captures for `run_3tw2rDtz`, and the capture correlation
carries an explicit `iteration` field. The join is therefore `DIRECT_TRACE`,
not inferred.

**Sanitization.** The ledger contains **no raw tool-result text, no command
text, no file content and no credentials**. Command lines and results appear
only as non-reversible `sha256:<16 hex>` fingerprints plus byte counts, so
that repetition and information-gain questions remain answerable without
republishing sensitive content. Verified: zero strings longer than 200
characters appear anywhere in the ledger.

**Event vocabulary.**

| `event` | Meaning |
|---|---|
| `user_turn_start` | a user-authored `<user_input>` turn (task start; operator instruction) |
| `completion_obligation_injected` | the runtime-synthetic completion-reminder message |
| `compaction_summary_present` | a `Context summary:` message in the transcript |
| `runtime_control_injected` | a harness control message (e.g. the deferred-completion continuation control) |
| `assistant_turn` | a model turn, with `tool_calls[]`, `provider_metrics`, and the joined `provider_request` |
| `tool_result` | a tool result, with `result_fingerprint`, `command_fingerprint`, `result_bytes`, `result_class` |

**CORRECTION01 F2 — the result classification.** The `information_gain` key
was a NONEMPTY check and has been **replaced** by `result_class` with the
tiers `EMPTY` / `NONEMPTY` / `CONTENT_DISTINCT`, plus an explicit
`factually_novel: "UNPROVEN_AT_THIS_LAYER"`. The legacy key is gone from the
ledger entirely.

**Evidence classes.** Every event carries `evidence_class`. All ledger events
are `DIRECT_TRACE`. Relations that could not be authoritatively joined are
labelled `UNAVAILABLE_FROM_TRACE` (exactly one such case: the reason for the
interval-B quiescence).

---

## 2. The four intervals

### A — Autonomous evidence gathering

| Property | Value |
|---|---|
| Span (UTC) | `2026-11-21T09:16:09.619Z` → `2026-11-21T12:02:54.215Z` |
| Duration | **10,004.6 s = 2 h 46 m 45 s** |
| Assistant turns | **277** |
| Provider requests | **277** (iterations 1…277, `run_3tw2rDtz`) |
| Tool calls | **371** (335 `run_commands`, 27 `fetch_web_content`, 7 `read_files`, 4 `command_status`) |
| Tool results | **371** (100 % correlated, 0 orphans) |
| Error results | 5 |
| Compaction boundaries crossed | **8 EVENTS** + 8 enrichments (257 requests carried a compacted summary — CORRECTION02 F1) |
| `submit_and_exit` calls | **0** |
| Turns with **no** tool call | **0 / 277** |
| Output tokens | sum 129,045 · p50 **380** · max **3,130** (19.1 % of the 16,384 budget) |
| Input tokens | sum 12,994,294 · max 84,216 |

**In every one of the 277 requests:** `submit_and_exit` present in the
provider-visible tool schema (277/277); the completion-obligation text
present in the request (277/277, measured over the whole request — it lives
in `messages[0]` after the first compaction and in `messages[1]` before it);
`maxOutputTokens = 16384` (277/277).

### B — Gap between the last autonomous activity and the first operator instruction

| Property | Value |
|---|---|
| Last autonomous assistant turn (index 648) | `2026-11-21T12:02:54.215Z` |
| Last autonomous provider request (iteration 277) | `2026-11-21T12:02:29.293Z` |
| Operator instruction (index 650) | `2026-11-21T12:31:44.747Z` |
| **Silent gap** | **1,730.5 s = 28 min 50 s** |

The last autonomous turn contained a `run_commands` call whose result was
delivered (index 649). **No provider request was issued for iteration 278.**
The reason is `UNAVAILABLE_FROM_TRACE` — the artifact does not record it, and
this ACT does not invent one.

### C — Operator-directed synthesis

| Property | Value |
|---|---|
| Operator instruction (index 650) | `2026-11-21T12:31:44.747Z` |
| Content | an operator-authored `<user_input mode="act">` instructing the model to stop evidence collection and produce the R1–R10 verdict matrix from evidence already collected |
| Completion obligation re-injected (index 651) | `2026-11-21T12:31:44.748Z` |
| Provider request | `run_OH-JHT6v` iteration 1, `2026-11-21T12:31:44.935Z` — **tool schema unchanged (9 tools, `submit_and_exit` present)** |
| Assistant turns | 1 |
| Tool calls | 0 |

The operator turn used a **different run id** (`run_OH-JHT6v`) from the
autonomous run (`run_3tw2rDtz`) — the boundary is visible in the capture
correlation itself, not just in the transcript.


### D — Post-intervention completion and final artifact

| Seq | Event | Timestamp (UTC) |
|---|---|---|
| 652 | assistant turn → `submit_and_exit` (16,148 output tokens, 5,085-char summary) | `12:41:00.451Z` |
| 653 | tool result → `submit_and_exit` = `"submitted (verified=true)"` | `12:41:00.555Z` |
| 654 | harness control: `completion_continuation_control` — **2 held terminal observations** | `12:41:00.699Z` |
| 655 | completion obligation re-injected | `12:41:00.704Z` |
| 656 | assistant turn → 2 × `command_status` (consume the 2 held jobIds) | `12:43:05.133Z` |
| 657–658 | tool results → both `command_status` calls observed | `12:43:05.148Z` / `.150Z` |
| 659 | assistant turn → `submit_and_exit` (re-issued, 5,569-char summary) | `12:44:39.926Z` |
| 660 | tool result → `submit_and_exit` = `"submitted (verified=true)"` | `12:44:39.949Z` |

**This phase is a positive control for the completion route only.** It is
never used to claim that phase A autonomously converged: phase D ran under an
operator instruction to stop investigating, which is precisely what phase A
lacked.

---

## 3. Terminality

| Event | Count | Where |
|---|---|---|
| Autonomous `submit_and_exit` | **0** | phase A |
| Post-intervention `submit_and_exit` | **2** | phases D (indexes 652, 659) |
| Session terminality | `status: "completed"`, `exit_code: 0`, `ended_at 2026-11-21T12:58:05.429Z` | session manifest |

The `task.completed` event for this session is therefore sourced from
`submit_and_exit` (the completion route), **not** from the non-interactive
`shutdown` fallback — confirming that the completion path itself functioned
in this session.

---

## 4. Compaction boundaries observed in the ledger (CORRECTION01 F1)

**CORRECTION01 F1 — the parent ACT's "257 compaction boundaries" was a
request count mistaken for an event count.** A compacted summary *persists*
across many requests. The authoritative discriminator for a NEW compaction is
a change in the carried summary's **identity**, because a new compaction
replaces the summary.

```
$ python3 tools/compaction_probe.py --capture-dir <private> --out compaction-probe.json
provider requests total                       : 277
requests carrying a compacted summary (STATE) : 257
requests without a compacted summary          : 20
distinct summary generations                  : 16
compaction EVENTS observed (identity change)  : 16
```

| Measure | Value |
|---|---|
| Provider requests total | 277 |
| Requests carrying a compacted summary (**state**) | **257** |
| Requests without a compacted summary | 20 (iterations 1–20, i.e. before the first compaction) |
| Distinct provider-visible summary payloads | **16** |
| **Distinct compaction generations** (contract-stripped identity) | **8** |
| **Compaction EVENTS** (new generation) | **8** |
| **Generation transformations** (enrichment, NOT a compaction) | **8** |

**CORRECTION02.** CORRECTION01 counted 16 compaction events by tracking the
carried summary's *payload* identity. That still overcounted: the payload
identity also changes when an existing generation is enriched with a
duplicated contract heading. In all 8 adjacent pairs the only change is
+2 lines (one blank, one duplicated `## Active task contract (authoritative)`
heading), +41 bytes and +2 provider-visible messages. The generation
identity is therefore computed on the **contract-stripped** summary.

Compaction events occur at iterations **21, 55, 82, 104, 130, 164, 203, 240**;
enrichments at **22, 56, 83, 105, 131, 165, 204, 241**.

| Retention check (over the 257 requests carrying a summary) | Result |
|---|---|
| Carries `## Active task contract (authoritative)` | **257 / 257** |
| Carries the runtime completion obligation | **257 / 257** |
| Carries the canonical evidence record (`<!-- cline-evidence:begin -->`) | **257 / 257** |
| Provider requests lacking the obligation text anywhere | **0 / 277** |

What is **not** established: that the canonical evidence was preserved *in
full* across a compaction — the `<!-- cline-evidence:begin -->` record is a
bounded projection; the probe verifies its **presence**, not its
**completeness**.

---

## 5. Tool-call profile

| Tool | Autonomous calls | Post-intervention calls |
|---|---|---|
| `run_commands` | 335 | 0 |
| `fetch_web_content` | 27 | 0 |
| `read_files` | 7 | 0 |
| `command_status` | 4 | 2 |
| `submit_and_exit` | **0** | **2** |

Distinct command payloads: **369 / 371** autonomous (2 executed twice).
After turn 271: **202 / 202** distinct, **0** repeats, **186**
`CONTENT_DISTINCT` bodies, **15** empty, **1** exact duplicate.

**CORRECTION01 F2 — the stronger measurement.** Body-level diversity is not
information gain. Per-source novelty (same source, previously-unseen lines)
is the mechanically verifiable form:

| Measure | Value |
|---|---|
| Source-attributable reads | 136 |
| Reads adding ≥1 previously-unseen line from that source | **129** |
| Pure re-reads | **7** |
| Total new distinct lines added | **4,388** |
| Distinct sources read | 50 |

`FACTUALLY_NOVEL` (decision-relevant) remains **UNPROVEN** — that would
require an independent adjudication of R1–R10.

---

## 6. Reproducing this summary

```
cd .factory/evidence/ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01
python3 tools/build-timeline.py \
  --session-dir ~/.vscodium-roz/cline-data/sessions/1795252560069_t82cp \
  --capture-dir ~/.vscodium-roz/cline-data/provider-request-captures \
  --out timeline.jsonl
python3 tools/readiness-probe.py \
  --session-dir ~/.vscodium-roz/cline-data/sessions/1795252560069_t82cp \
  --out readiness-probe.json
```

Both tools are read-only with respect to the private data directory and write
only sanitized output.
