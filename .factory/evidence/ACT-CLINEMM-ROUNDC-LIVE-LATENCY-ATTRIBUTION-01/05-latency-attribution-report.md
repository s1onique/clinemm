# ACT-CLINEMM-ROUNDC-LIVE-LATENCY-ATTRIBUTION-01 — Live Latency Attribution

**Verdict: `NOT_REPRODUCED`** — the suspected ~5 s tool-result floor is not a property of
the tool-result path. The elapsed time that looked like a ~5 s tool-result overhead is
measured and located: it is the **sibling tool's own execution time** inside the same
model-turn batch, observed at the earlier sibling's delivery boundary.

The dominant actionable latency cost of the 15:21 dogfood execution is **provider wait**.

---

## 1. Identity and completeness

| Item | Value |
|---|---|
| Repository | `s1onique/clinemm` (branch `main`) |
| `ENTRY_HEAD` | `575465bf5ba556fe3c7a4f9d6d3d6a0597ae19f6` (matches the expected predecessor) |
| Tracked tree | clean at entry; no branch, worktree, push, PR, reset or cleanup |
| Protected stashes / worktrees | preserved, untouched |
| Trace | `~/Downloads/roundc-latency-trace(8).json` |
| Trace SHA-256 | `b84ee4a83f3819b4a849e2d05f95c044443e3d3fb036818aef98f9b7fe96b5e1` — **verified** |
| Session / correlation | `1794892591345_7em4g` |
| Schema | `cline.roundc-latency-trace.v1` (capture profile `dogfood`) |
| Events | 418 declared / 418 actual |
| Stages | 171 declared / 171 actual |
| Unavailable | 13 declared / 13 actual (all `provider_first_text`) |
| Integrity failures | 0 declared / 0 actual |
| Truncation | `truncated: false`, 0 events / 0 unavailable / 0 integrity failures dropped |
| Production modifications | **none** |
| New diagnostic side effects | **none** — the analyzer reads the preserved trace only |

The raw trace is **PRIVATE and stays outside Git**. Only sanitized derived evidence is committed.

## 2. Wall-time attribution (exclusive, non-overlapping)

Total wall clock: **15.35 min (920,908.6 ms)**.

| Bucket | n | Total (ms) | % of wall | Median | p90 | Max |
|---|---|---|---|---|---|---|
| **Provider round trip** (submission → completion) | 18 | 810,271.9 | **87.99%** | 33,660.9 | 89,059.1 | 170,238.4 |
| Compaction (observed span) | 1 | 64,564.5 | 7.01% | 64,564.5 | 64,564.5 | 64,564.5 |
| Tool execution (executor run time) | 26 | 44,525.7 | 4.83% | 709.7 | 4,038.8 | 5,068.9 |
| Inter-boundary gaps (all stages) | 145 | 1,127.5 | 0.12% | — | — | — |
| **Sum of exclusive buckets** | | **920,489.6** | | | | |
| Reconciliation residual | | 419.1 | | | | |

### Stage breakdown (the production stage taxonomy, reused verbatim)

| Stage | n | Total (ms) | Median | p90 | Max | Counts toward exclusive wall? |
|---|---|---|---|---|---|---|
| `delivery` | 18 | 1.7 | 0.084 | 0.161 | 0.3 | yes |
| `execution` | 26 | 44,525.7 | 709.728 | 4,038.841 | 5,068.9 | **no (nested)** |
| `preparation` | 18 | 0.1 | 0.005 | 0.009 | 0.0 | yes |
| `queue` | 34 | 795.5 | 5.661 | 23.608 | 346.0 | yes |
| `transport` | 13 | 0.2 | 0.014 | 0.025 | 0.1 | yes |
| `unclassified` | 62 | 330.0 | 1.284 | 9.048 | 112.1 | yes |

**Overlap accounting.** A stage is the *gap* between an `end` event and the next `start`
event; the gap does not include the previous span's own duration. The `execution` stage is
the executor's run time, **nested inside** the `tool_execution` span, so it is **not** part
of the gap sum — adding them would double-count. `request_prepared` and `provider_submitted`
cover the *same* interval and are counted once. Verified: gap stages are pairwise
disjoint (0 overlaps), all 26 `execution` stages are nested in their tool span, and the
stage table rebuilt from the events matches the trace's own stage array exactly.

## 3. The priority discriminator: does a ~5 s tool-result floor exist?

**No.** Measured on 26 independently identified tool
executions, joined by the authoritative `toolCallId`:

```
post_execution_delivery_delay_ms = tool_result_delivered.start − tool_execution.end
```

| Statistic | Value (ms) |
|---|---|
| n | 26 |
| min | 0.021 |
| median | 0.276 |
| p90 | 711.346 |
| **max** | **4022.851** |
| **≥ 5,000 ms** | **0** |

The production-classified `delivery` stage (the `tool_execution → tool_result_delivered`
gap) is at most **0.295 ms**, median **0.084 ms**. There is no ~5 s floor on the
tool-result path.

### Where the ~4 s apparent overhead actually occurs

Two tools show a ~4 s post-execution delivery delay
(4,015.3, 4,022.9 ms). They are the
**earlier siblings** of two-call model turns. The runtime executes a model turn's tool calls
as a batch and delivers every result only after the whole batch resolves
(`agent-runtime.ts`: `executeToolCalls` → `Promise.all` over the parallel group; the caller
then emits `observeToolResultDelivered` per result). So an earlier sibling's result cannot
be delivered until its later sibling has finished.

Verified numerically on all **8** multi-call batches
(8 comparisons):

> observed delivery delay − (next sibling's execution + inter-call gap)
> → max |residual| = **0.209 ms**, mean **0.0944 ms**

The elapsed time is therefore **the sibling tool's own execution time**, re-attributed to the
earlier sibling's delivery boundary. It is not a per-result delivery cost. The sibling
attribution rests on the shared authoritative `modelRequestId` batch identity plus that
numerical residual — not on chronological adjacency.

## 4. Dominant actionable cost

**Provider round-trip wait — 810,271.9 ms (87.99% of wall, n=18).**
The largest single round trip is 170,238.4 ms.

Host-side orchestration is negligible by comparison: request preparation 0.109 ms total,
provider-ready 0.3 ms total, tool-result delivery 0.2 ms total, schema validation 0.2 ms
total. The queue gap is 795.5 ms over 34 samples (max 346.0 ms).

Second-largest: **one compaction, 64,564.5 ms** (7.01%),
`compactionOutcome: completed`, 34 → 6 messages, 17 evidence references dropped. Its window
was verified to contain **no other boundary event**, so it is disjoint from provider and tool
activity — reported as exclusive wall time for *this session only*, not as a general property.

## 5. Boundary classification

| Required boundary | Classification |
|---|---|
| Provider submission → completion | **MEASURED** (18 round trips) |
| First-token / first-text | **MEASURED for 5 of 18**; `UNAVAILABLE_FROM_TRACE` for 13 |
| Server-side TTFT | `UNAVAILABLE_FROM_TRACE` (all observations) |
| Model-request preparation | **MEASURED** (18 requests) |
| Orchestration | **MEASURED** (provider-ready, schema validation, queue gaps) |
| Tool dispatch → execution → terminal outcome | **MEASURED** (26 executions, joined by `toolCallId`) |
| Tool terminal outcome → subsequent model submission | **MEASURED** (n=25; median 31.8 ms, p90 4,050.8 ms, max 64,709 ms) |
| Compaction start → completion | **MEASURED** (1 span, 64,564.5 ms) |
| UI and host boundaries | `UNAVAILABLE_FROM_TRACE` — the trace records no UI/webview or extension-host boundary |
| Time to first edit | `NOT_APPLICABLE` — this Keycloak task was read-only |

## 6. Evidence limitations honoured

- `provider_first_text` unavailable for 13 observations — **TTFT never synthesized**.
- Provider request duration is **not** called inference computation time; no server-side time inferred.
- The compaction duration is an **observed span**, reported as exclusive only after verifying
  its window holds no other boundary event.
- Read-only task ⇒ time-to-first-edit is `NOT_APPLICABLE`, not zero.
- Chronological adjacency was **never** promoted to causal identity.
- Absent boundaries are classified `UNAVAILABLE_FROM_TRACE`.

## 7. Executable controls

All **8** controls **PASS** (`03-executable-controls.json`). After CORRECTION01, C6 and C7 are
**derived checks** that can fail, C8 is a labelled structural assertion, and the verdict is
**derived** from the measured facts — see §7b.

| Control | Requirement | Result |
|---|---|---|
| C1 | Exact source-trace identity and request census. | **PASS** |
| C2 | All tool terminal events joined to actual command/call identities. | **PASS** |
| C3 | No double-counting of nested or overlapping spans. | **PASS** |
| C4 | Stage totals reconciled with wall time. | **PASS** |
| C5 | Missing first-text observations reported explicitly. | **PASS** |
| C6 | Tool-result latency hypothesis evaluated against observed distributions. | **PASS** |
| C7 | No production modifications or new diagnostic side effects. | **PASS** |
| C8 | Evidence limitations honoured (no synthesis, no unobserved inference). | **PASS** |

## 7b. CORRECTION01 — the evidence generator's derived controls

The review of this ACT raised **one bounded P1**: in `tool/emit_evidence.py`, controls
**C6, C7 and C8 were marked PASS unconditionally**, and the verdict was emitted as a
**fixed string** (`"verdict": "NOT_REPRODUCED"`). The same generator could therefore
report success for a future trace that violated the contract.

**Corrected.** The verdict and every derived control outcome are now **computed from the
measured facts** of the trace under analysis.

| Control | Before | After |
|---|---|---|
| C6 | `True` (constant) | **Derived check**: passes only when the hypothesis was actually evaluated against a sufficient sample of independently identified tool executions, with the *registered* floor discriminator applied to that whole sample |
| C7 | `True` (constant) | **Real repository check**: inspects unstaged, staged and untracked state across `sdk/ apps/ src/ proto/ webview-ui/` and scans the analyzer/generator for a production emission site (a probe) |
| C8 | `True` (constant) | **Structural / manual assertion**, explicitly labelled `executable: false` — these are properties of the *analysis* (no TTFT synthesized, no server-side time inferred, adjacency not promoted to causality) that no program can observe. Each claim now carries the machine-checkable fact backing it where one exists |
| Verdict | fixed string | **Derived** by `derive_verdict()` from the C1 completeness contract and the C6 measured coverage/floor result |

The derived verdict rules, in order: an incomplete or truncated trace ⇒ `CAPTURE_INSUFFICIENT`;
fewer than **20** independently identified tool executions ⇒ `CAPTURE_INSUFFICIENT` (below
that coverage, "no floor observed" is indistinguishable from "not observed"); otherwise the
floor is either reproduced or not — `REPRODUCED` / `NOT_REPRODUCED` are then the only
admissible verdicts.

### Failing-control witness

`tool/test_failing_control_witness.py` — **21 checks, all passing**. It proves the
corrected generator *fails* on a violating trace:

| Witness | Adversarial condition | Required outcome |
|---|---|---|
| W1 | coverage below the registered minimum | `CAPTURE_INSUFFICIENT`, C6 **FAILS** |
| W2 | trace fails its completeness contract | `CAPTURE_INSUFFICIENT` |
| W3 | the floor **is** reproduced | `REPRODUCED` (the generator is not pinned to `NOT_REPRODUCED`) |
| W3b | discriminator applied to only part of the sample | C6 **FAILS** |
| W3c | unregistered floor threshold | C6 **FAILS** |
| W6 | clean / unstaged / untracked / staged production edit | C7 **FAILS** on all three modification kinds |
| W4 | the real trace | `NOT_REPRODUCED`, C6 **PASSES** (so the negatives are not satisfied by always failing) |
| W5 | generator source | consumes the derived verdict; no hardcoded verdict; C6 not unconditional |

**Discriminating power** (`tool/run_witness_discrimination_check.sh`): the witness **PASSES**
against the corrected code and **FAILS** against the pre-correction code at commit
`ab5ee16ec` with `AttributeError: module 'attribute_latency' has no attribute
'derive_verdict'`, and the pre-correction generator is confirmed to hardcode the verdict and
to mark **C6, C7 and C8** PASS unconditionally. A witness that cannot fail is not a witness.

The C7 witnesses run against a **throwaway git repository** in a temp dir; the real
repository is never modified. **No new diagnostic infrastructure was introduced** — the
correction is confined to the evidence generator, the analyzer and the witness.

The measured findings of this ACT are **unchanged** by the correction: the verdict for this
session is still `NOT_REPRODUCED`, still derived from 26 independently identified tool
executions with 0 at or above the registered 5,000 ms floor.

## 8. Disposition

**`NOT_REPRODUCED`.** The ~5 s tool-result floor is absent from 26
independently identified tool executions (0 at or above 5,000 ms; max 4,022.851 ms). The
hypothesis is not repaired — it is refuted at the authoritative boundary and the elapsed
time it appeared to describe is located in the sibling tool's execution time.

The dominant actionable latency cost **is** identified: provider round-trip wait, 88.0% of
wall time. No speculative optimization is proposed here; no production change is authorized
by this ACT.

## 9. Evidence package

| File | Content |
|---|---|
| `00-identity-record.json` | repository, preservation, trace identity, completeness |
| `01-stage-attribution-table.json` | exclusive wall buckets, stage breakdown, overlap accounting |
| `02-causal-classification.json` | verdict + its derivation, discriminator, sibling attribution, boundary classification |
| `03-executable-controls.json` | the 8 executable controls and their evidence (CORRECTION01: C6/C7 derived, C8 structural) |
| `04-tool-execution-timeline.json` | all 26 tool executions with authoritative joins |
| `05-latency-attribution-report.md` | this report |
| `tool/attribute_latency.py` | the read-only analyzer (CORRECTION01: adds `derive_verdict` / `derive_c6_check`) |
| `tool/emit_evidence.py` | the evidence generator (CORRECTION01: derived C6/C7/C8 and derived verdict) |
| `tool/test_failing_control_witness.py` | CORRECTION01 failing-control witness (21 checks) |
| `tool/run_witness_discrimination_check.sh` | CORRECTION01 witness discrimination check |
| `analysis/attribution.json` | full machine-readable analyzer output |

Reproduce:

```bash
cd .factory/evidence/ACT-CLINEMM-ROUNDC-LIVE-LATENCY-ATTRIBUTION-01
python3 tool/attribute_latency.py "$HOME/Downloads/roundc-latency-trace(8).json" analysis
```

### Production sources inspected (read-only)

- `sdk/packages/core/src/observability/latency/latency-trace.ts` — `STAGE_BOUNDARIES`,
  `classifyLatencyStage`, `LatencyTracer.getStages()` (the stage and overlap rules reused here).
- `sdk/packages/core/src/observability/latency/latency-sink.ts` — `LatencyTraceSink`
  (boundary semantics; `markUnavailableIfOpen` for first-response / first-text).
- `sdk/packages/agents/src/agent-runtime.ts` — `executeToolCalls` / `executeParallelGroup`
  / `observeToolResultDelivered` (the batch delivery mechanism).
- `sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts` — `resolveToolExecution`
  (`maxParallelToolCalls` default 8 ⇒ `toolExecution: "parallel"`).
