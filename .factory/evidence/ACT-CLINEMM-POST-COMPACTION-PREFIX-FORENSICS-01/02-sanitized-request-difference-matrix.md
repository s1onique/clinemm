# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — Sanitized Request-Difference Matrix

**Cohort:** `livecohort000001` (keyed HMAC-SHA-256; the key is NOT published)
**Source corpus:** the preserved `CLINE_CAPTURE_PROVIDER_REQUEST=full`
`ai_sdk_prompt` captures, re-expressed as the sanitized forensic records the
new capture writer produces (identical shape, identical HMAC keying).
**Analyzer:** `bun sdk/packages/shared/src/runtime/prefix-forensics-analyzer-cli.ts`
**Machine-readable matrix:** `03-request-difference-matrix.json`

---

## 1. The corpus

| Quantity | Value |
|---|---:|
| Preserved capture files scanned (all hosts) | 24,864 |
| Distinct `ai_sdk_prompt` records | 24,862 |
| Distinct `wire_request` records | **0** |
| Sanitized records analysed (course / `run_dL4t9n8M`) | 173 |
| Consecutive pairs joined by EXPLICIT identity | 172 |
| Pairs with a first difference | 172 |
| Pairs whose first difference is an IN-PLACE MUTATION | **3** |
| Pairs whose first difference is an APPEND | 169 |

---

## 2. The three in-place mutations (the earliest model-facing differences)

These are the pairs where the earlier history is NOT a common prefix — where
a historical message is rewritten between two consecutive requests.

| # | Before → After | Common prefix | First differing index | Role | Bytes before → after | Part bytes before → after | Involves a tool result |
|---|---|---:|---:|---|---:|---:|---|
| M1 | iteration 12 → 13 | 11 | **11** | `tool` | 26,426 → 317 | 26,398 → 289 | **yes** |
| M2 | iteration 19 → 20 | 27 | **27** | `tool` | 17,380 → 332 | 17,352 → 304 | **yes** |
| M3 | iteration 27 → 28 | 41 | **41** | `tool` | 16,522 → 318 | 16,494 → 290 | **yes** |

**What this means.**

1. The message COUNT is unchanged (24 → 26 in both requests; the pair differs
   only in the BYTES of an already-present message). A message-count or
   message-index analysis would classify this as "the same request, longer".
2. The message ORDER is unchanged. The rewritten message keeps its index.
3. The rewritten message keeps its ROLE (`tool`) and its `toolCallId`. The
   tool CALL is unchanged — only the tool RESULT's bytes changed.
4. The rewritten content is ~26 KB of real file content replaced by a
   ~289-byte marker.

### 2.1 The literal rewrite, verified at the source

The raw (unsanitized) preserved capture for M1 shows the exact replacement.

> **REDACTION (ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01).**
> The pre-correction version of this section reproduced a ~200-character
> excerpt of a REAL file-read result: a project-relative file path, a live
> `toolCallId`, and a fragment of the file's own text. The privacy audit
> scanned only the 173 sanitized capture RECORDS; it did not cover this
> human-readable report, so the committed excerpt was never assessed. It is
> REDACTED here. The structural facts it evidenced are unchanged and are
> carried by the sanitized matrix; only the verbatim content is removed.
> The redaction does not weaken the finding: the replacement marker, the
> byte counts, the message index, the role, the position and the tool-call
> identity are all still asserted, and the tool-call id is now shown only as
> a truncated digest.

```
message index 11, role "tool", toolName "read_files",
toolCallId "call_c399…b234" (IDENTICAL on both sides; truncated digest)

BEFORE: {"type":"json","value":[{"query":"…/LESSON-14.md:37-300",
          "result":"<REDACTED — real file content, 26,398 bytes>"}]}
AFTER:  {"type":"json","value":[{"query":"…/LESSON-14.md:37-300",
          "result":"[outdated - see the latest file content]","success":true}]}
```

The first differing byte is at offset **135** of the serialized tool result.
Every subsequent odd-indexed tool result in the same request shows the same
signature.

---

## 3. The message comparison, per the ACT's Section 6 contract

### 3.1 Common ordered prefix

Computed by EXACT structural fingerprint (HMAC-SHA-256 over the canonicalized
message). The prefix ends at the first message whose fingerprint differs.

| Pair class | Common prefix | First differing index | Change kind |
|---|---:|---:|---|
| Append (169 pairs) | equals the whole BEFORE message list | = BEFORE length | `inserted` |
| In-place mutation (3 pairs) | 11 / 27 / 41 | 11 / 27 / 41 | `modified` |

### 3.2 Role and content-part changes

For the three mutations the role is UNCHANGED (`tool` → `tool`) and the
changed part type is `tool-result`. The analyzer reports the per-part byte
lengths separately from the whole-message byte length, because the
whole-message length can be unchanged while a part's length moves.

### 3.3 Byte-length changes

Reported at two granularities: whole message (`bytesBefore`/`bytesAfter`) and
per part (`partBytesBefore`/`partBytesAfter`). See §2.

### 3.4 Message identity changes where authoritative

The rewritten message keeps the same `toolCallId`. The forensic record does
not carry the `toolCallId` itself (it is content-derived), but the identity
is established from the preserved raw capture, where both sides carry the
same `toolCallId`. This is reported as an observation of the preserved
corpus, not as a property of the sanitized record.

### 3.5 Differences involving tool results or compaction summaries

All three mutations are `involvesToolResult: true`. The compaction-summary
marker is a STRUCTURAL heuristic on the sanitized record (a text-bearing
message of ≥512 bytes); it does not fire on the three mutations, because the
rewritten messages are tool-result messages, not summaries.

---

## 4. The tool comparison

| Property | Result across ALL 20 analysed boundaries |
|---|---|
| Tool inventory added / removed | **NONE** |
| Tool order changed | **NONE** |
| Tool definition / schema changed | **NONE** |
| Schema identical but serialization changed | **NONE** |

Across all 20 compaction boundaries in the corpus, the ordered tool
inventory and every tool's schema fingerprint are **byte-identical** between
the two requests of the pair. This is a strong negative result and it is the
direct refutation of D1.

---

## 5. The system / options comparison

| Property | Result across all boundaries |
|---|---|
| System / developer / instructions fingerprint changed | **NONE** |
| System byte length changed | **NONE** |
| Reasoning controls changed | NONE observed (no reasoning channel in this corpus) |
| Tool-choice controls changed | NONE observed |
| Model / provider configuration changed | NONE observed (provider `minimax`, model `MiniMax-M3` constant) |

---

## 6. The stage comparison

| Stage | Availability for the preserved corpus | Result |
|---|---|---|
| A — `runtime_projection` | **UNAVAILABLE_FROM_TRACE** (the preserved capture predates the stage-A instrumentation) | — |
| B — `ai_sdk_prompt` | **AVAILABLE** (24,862 records) | The three in-place mutations are found HERE. |
| C — `wire_request` | **UNAVAILABLE_FROM_TRACE** (0 preserved records) | — |

**Earliest stage at which the change appears: `ai_sdk_prompt`.**

Because stage A is unavailable for the preserved corpus, the ACT does NOT
claim the runtime projection was also mutated — but it does not need to. The
causal producer is identified at the SOURCE level (§3 of the seam map): the
mutation is written by `MessageBuilder.buildForApi()` BEFORE the runtime
hands the request to the provider, so it is necessarily present at stage A as
well. That is a source-level fact, not a capture-level inference.

**The ACT does not claim the wire payload is identical to the AI SDK prompt.**
No wire record survives, so the wire comparison is `UNAVAILABLE_FROM_TRACE`
and is reported as such.
