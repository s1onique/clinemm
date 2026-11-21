# timeline-summary.md — ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01

**Session:** `1795252560069_t82cp` · **Model:** `qwen3.8-flash-next-q2_0`
(`openai-compatible`) · **Run:** `run_3tw2rDtz` (autonomous, iterations 1–277)

**Ledger:** `timeline.jsonl` — 661 events, one JSON object per line, sanitized.

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
| `tool_result` | a tool result, with `result_fingerprint`, `command_fingerprint`, `result_bytes`, `information_gain` |

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
| Compaction boundaries crossed | **257** |
| `submit_and_exit` calls | **0** |
| Turns with **no** tool call | **0 / 277** |
| Output tokens | sum 129,045 · p50 **380** · max **3,130** (19.1 % of the 16,384 budget) |
| Input tokens | sum 12,994,294 · max 84,216 |

**In every one of the 277 requests:** `submit_and_exit` present in the
provider-visible tool schema (277/277); the completion-obligation text
present (277/277); `maxOutputTokens = 16384` (277/277).

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

## 4. Compaction boundaries observed in the ledger

257 real boundaries are visible in the joined provider requests, where
`messages[0]` becomes a `Context summary:` user message and the message count
drops (e.g. iteration 103 → 104: **55 → 17** messages).

| Check across all 257 boundaries | Result |
|---|---|
| Summary carries `## Active task contract (authoritative)` | **257 / 257** |
| Summary carries the runtime completion obligation | **257 / 257** |
| Summary carries the canonical evidence record (`<!-- cline-evidence:begin -->`) | yes |
| Provider requests lacking the obligation text anywhere | **0 / 277** |
| Provider requests lacking the task-contract section | 20 — all **before** the first compaction (iterations 10–20), i.e. pre-existing state, not a loss |

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
After the readiness point (turn 271): **202 / 202** distinct, **0** repeats,
**186** novel results, **15** empty, **1** exact duplicate.

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
