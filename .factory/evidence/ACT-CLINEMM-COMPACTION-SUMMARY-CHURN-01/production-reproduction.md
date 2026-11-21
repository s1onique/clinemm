# ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — Production Reproduction

**Verdict:** the churn reproduces against the REAL production pipeline and
the REAL live artifacts.

---

## 1. What was exercised

The disposable probe
(`.factory/evidence/ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01/tool/probe.ts`)
drives the production functions DIRECTLY. No production source was modified.

| Production function | File:line | Role |
|---|---|---|
| `projectSessionCompactionState()` | `sdk/packages/core/src/session/models/session-compaction.ts:168` | the real projector |
| `applyTaskContractToCompactedMessages()` | `sdk/packages/core/src/extensions/context/task-contract.ts:358` | the real contract carry-forward |
| `applyVerifiedEvidenceToCompactedMessages()` | `sdk/packages/core/src/extensions/context/evidence-continuity.ts:1366` | the real evidence carry-forward |
| `MessageBuilder.buildForApi()` | `sdk/packages/core/src/session/services/message-builder.ts:219` | the real provider-request seam |

No provider request was issued. No session was written. The persisted
sidecar was read only.

---

## 2. The artifacts (real, private, never committed)

| Artifact | Identity |
|---|---|
| Session | `1795229584545_t33f9` |
| Provider / model | `openai-compatible` / `qwen3.8-flash-next-q2_0` |
| Persisted sidecar | `source_message_count = 73`, `messages = 14`, `source_prefix_hash` present |
| Canonical transcript | 123 messages; 50 beyond the compaction boundary |
| Sidecar written at | `2026-11-21T03:01:47.318Z` — the iteration-26 compaction |

The sidecar's `metadata.summary` is 14,717 bytes and contains BOTH the
task-contract section (`<!-- cline-task-contract:end -->`) and the
verified-evidence section (`<!-- cline-evidence:begin -->` … `<!-- cline-evidence:end -->`)
with exactly 12 carried outcomes — the rolling `MAX_CARRIED_OUTCOMES` cap.

---

## 3. The scenario

```
H0 = canonical[0 .. 73)            the canonical history AT the compaction boundary
H1 = canonical + new successful tool call/result pair   (APPEND-ONLY)
H2 = H1 + another new successful tool call/result pair  (APPEND-ONLY)
```

The persisted sidecar is **unchanged** between the three preparations.

### Append-only invariants (verified, from `production-reproduction.json`)

```
h0IsCanonicalPrefix          : true    (H0 is byte-identical to canonical[0..73))
canonicalIsPrefixOfH1        : true    (H1 extends canonical, nothing modified)
h1IsPrefixOfH2               : true    (H2 extends H1, nothing modified)
h0MessageCount               : 73
canonicalMessageCount        : 123
h1MessageCount               : 125
h2MessageCount               : 127
sidecarUnmodified            : true    (byte-identical before and after all preparations)
```

No compaction summary was created. The sidecar's own summary was projected.

---

## 4. The result

| Outcome | summary bytes | contract present | evidence present | prose bytes |
|---|---:|---|---|---:|
| H0 | 14,838 | yes | yes | 3,468 |
| H1 | 14,850 | yes | yes | 3,468 |
| H2 | 14,853 | yes | yes | 3,468 |

### Transitions

| Transition | changeClass | summary changed | contract changed | evidence changed | prose changed | common prefix (bytes) | provider-visible changed |
|---|---|---|---|---|---|---:|---|
| H0→H1 | `VERIFIED_EVIDENCE_SECTION` | **yes** | no | **yes** | no | 14,020 | **yes** |
| H1→H2 | `VERIFIED_EVIDENCE_SECTION` | **yes** | no | **yes** | no | 14,020 | **yes** |

### The RED

**The mutation is a cache-prefix stability counterexample, not a semantic
correctness bug.** The section is at the TAIL of the summary (the common
prefix is 14,020 of ~14,850 bytes), yet the summary's content changes, and
the summary is the FIRST provider-visible message. A prompt cache can only
reuse a checkpoint over an unchanged prefix, so the whole downstream
checkpoint chain is invalidated.

The isolation of the producing function is exact:

- `contractChanged: false` — the task-contract section is byte-identical.
- `proseChanged: false` — the generated summary prose is byte-identical.
- `evidenceChanged: true` — the verified-evidence section is the ONLY
  thing that moved.

The producing function is
`applyVerifiedEvidenceToCompactedMessages()`
(`evidence-continuity.ts:1366`), which re-derives the ledger from the
canonical history at `evidence-continuity.ts:1370` and replaces the section
at `evidence-continuity.ts:1394`/`:1403`.

The RED is retained as an isolated, runnable receipt:
`sdk/packages/core/src/extensions/context/compaction.summary-churn01.red.test.ts`,
runnable with `bun run test:red:summary-churn01`. It is EXCLUDED from the
default suite so it never blocks the normal gate.

---

## 5. The live capture corroboration

`live-transition-matrix.json` builds the transition matrix from the
preserved prefix-forensics captures of the SAME live session.

| Stage | transitions | summary changed | unchanged | same byte length BUT changed |
|---|---:|---:|---:|---:|
| `runtime_projection` | 44 | 19 | 25 | 7 |
| `ai_sdk_prompt` | 44 | 19 | 25 | 7 |
| `wire_request` | 44 | 20 | 24 | 7 |

The per-stage fingerprints are IDENTICAL for the same iteration, so the
mutation is introduced at `runtime_projection` — inside
`createCompactionStateAwarePrepareTurn()` — and propagated verbatim to the
wire.

### The live transitions required by the ACT

| Transition | messages | summary bytes | changed | class |
|---|---|---|---|---|
| 25→26 (compaction boundary) | 71 → 15 | 10,114 → 14,761 | **yes** | `SUMMARY_CARRIER_CHANGED` |
| 26→27 (first continuation) | 15 → 18 | 14,761 → 14,802 | **yes** | `SUMMARY_CARRIER_CHANGED` |
| 27→28 (mutation, no length change) | 18 → 21 | 14,802 → 14,802 | **yes** | `SUMMARY_CARRIER_CHANGED` |
| 30→31 (**negative control**) | 26 → 28 | 14,802 → 14,802 | **NO** | `UNCHANGED` |
| 31→32 (renewed mutation) | 28 → 31 | 14,802 → 14,802 | **yes** | `SUMMARY_CARRIER_CHANGED` |
| 33→34, 37→38 (later mutations) | 34→37, 43→46 | 14,802→14,810, 14,810→14,794 | **yes** | `SUMMARY_CARRIER_CHANGED` |

Across iterations 26→39 the summary changed on **12 of 13** adjacent
transitions. The system prompt fingerprint and the ordered tool inventory
were **byte-stable across every single transition**.

### Section-level attribution of the LIVE mutation — the stated limitation

The preserved prefix-forensics captures record only FINGERPRINTS and byte
counts, never raw content. A fingerprint establishes that two contents
DIFFER; it cannot say WHICH section differs. Therefore:

- **The live mutation is attributed to the summary carrier** — structurally:
  it is the first user message, the largest text part, the
  `compaction_summary` carrier, and it is the only message whose
  fingerprint changed while the system prompt and tool inventory stayed
  byte-stable.
- **The live mutation is attributed to the VERIFIED-EVIDENCE SECTION by the
  OFFLINE reproduction**, which uses the SAME session's real sidecar and
  real canonical transcript and the real production functions, and which
  reproduces the change with `contractChanged: false` and
  `proseChanged: false`.

The two are combined by the shared artifact identity (same session, same
sidecar `updated_at` = the iteration-26 compaction timestamp, same model),
not by a claim that the live captures contain section-level attribution.
They do not, and this ACT does not pretend otherwise.
