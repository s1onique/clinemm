# ACT-CLINEMM-CANONICAL-EVIDENCE-CONTINUITY-LIVE-01 — Qualification report

**Verdict: `PASS_CANONICAL_CONTINUITY_LIVE`**

**Repository:** `s1onique/clinemm` · **Branch:** `main`
**ENTRY_HEAD:** `8c3351e56d949b514f60bbfde0735e756ed082ca` (discovered, not assumed)
**Adjudicated session:** `1794892591345_7em4g` (dogfood, `vscode` source, completed, exit 0)
**Evidence package:** `.factory/evidence/ACT-CLINEMM-CANONICAL-EVIDENCE-CONTINUITY-LIVE-01/`

**No production change was made.** Production source under `sdk/`, `apps/`, `src/` and `proto/`
is byte-identical to HEAD. No estimator, policy, coefficient, protocol field or telemetry
field was touched. No RED test was manufactured for an unreproduced defect, because no
persistence defect was reproduced.

---

## 1. The question this ACT answers

RC-02 established **why** the compaction fired. It explicitly left RC-04 open, recording the
`20 → 3` evidence-reference transition as *"an observation only"*:

> "The 17 dropped working-context references are recorded as an observation only; whether the
> corresponding canonical evidence survived is out of scope for this ACT."

This ACT closes that question with **live artifacts and identity-level evidence**.

The critical distinction the ACT brief draws is the one that decides the verdict:

> "The 17 dropped references are a **working-context observation**, not evidence of canonical
> loss."

The measurement below shows that this distinction holds, and it does so **per identity**, not
by aggregate count.

---

## 2. Entry and safety

| Check | Result |
|---|---|
| Repository | `s1onique/clinemm` (`origin git@github.com:s1onique/clinemm.git`) |
| Branch | `main` |
| Working tree at entry | **clean** — 0 porcelain lines |
| ENTRY_HEAD | `8c3351e56d949b514f60bbfde0735e756ed082ca` (via `git rev-parse HEAD`) |
| Expected entry (from the brief) | `d68def3ae2ddcb635bfbb34955f2cd561205d9c0` — the **parent** of the actual HEAD |
| Difference | exactly one commit (`8c3351e56`, ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01), which adds one rule to the macOS Seatbelt profile and touches **no** compaction / session-persistence / canonical-message code |
| Stashes | preserved — none created, none manipulated |
| Worktrees | preserved — none created, none removed; the protected recovery worktree `recovery/protected-stash-20261117` is intact |
| Push / PR / reset / new worktree | **none** |
| New dogfood session | **none** — the authoritative live evidence was already present |

---

## 3. Authoritative live evidence

### 3.1 The preserved trace

| Field | Value |
|---|---|
| Path | `~/Downloads/roundc-latency-trace(8).json` |
| SHA-256 | `b84ee4a83f3819b4a849e2d05f95c044443e3d3fb036818aef98f9b7fe96b5e1` — **MATCH** |
| Bytes | 350,052 |
| Schema | `cline.roundc-latency-trace.v1` |
| Session / correlation id | `1794892591345_7em4g` — **MATCH** |
| Profile / model | `dogfood` / `qwen3.8-flash-next-iq3_s` |
| Events | 418, no truncation, 0 integrity failures |

### 3.2 The persisted session artifacts (discovered, not assumed)

Located from the session id under the ClineMM session storage root
`~/.vscodium-roz/cline-data/sessions/1794892591345_7em4g/`:

| Artifact | Role | Schema ver | Bytes | SHA-256 |
|---|---|---|---|---|
| `1794892591345_7em4g.messages.json` | **CANONICAL_TRANSCRIPT** | 1 | 394,572 | `b48b0f94ebc003a3a92bbf226fca3126433ec8d986d763a73e73ef258cf4e9b4` |
| `1794892591345_7em4g.compaction.json` | **COMPACTION_STATE** | 1 | 73,907 | `20461b286e3adc353f6f91d5e7314ef8eac38465a165650d8f0be14b2892a7bc` |
| `1794892591345_7em4g.json` | SESSION_MANIFEST | 1 | 2,345 | `0192cfca5cdd8a2afe1e916d33fbbf045035f466e4380cba0ed1e8aa9e68be3f` |

No filesystem-wide search was used; the location follows from the session id and the session
manifest's own `messages_path` / `compaction_path` fields.

### 3.3 The adjudicated event (from the trace)

---

## 4. Live continuity qualification — the measurements

All of the following were produced by driving the **real production seam**
(`sdk/packages/core/src/session/models/session-compaction.ts`) against the **real persisted
artifacts** of this session. The auditor is committed as `tool/audit.ts` and exits non-zero
on any failure. It emits opaque identities, hashes, counts and classifications only.

### 4.1 Canonical identity and ordering across the compaction boundary

| Check | Observed |
|---|---|
| Canonical message count | **46** |
| Unique message ids | **46 / 46** — 0 duplicates |
| `ts` monotonicity violations | **0** |
| `tool_use` blocks | 26 |
| `tool_result` blocks | 26 |
| Orphan tool results (no matching call) | **0** |
| Orphan tool uses (no matching result) | **0** |
| Ordering violations (result not after its call) | **0** |

The canonical transcript is **intact and strictly ordered** across the compaction boundary.

### 4.2 The compacted state is bound to its canonical prefix

| Check | Stored | Observed | Result |
|---|---|---|---|
| `source_message_count` | 34 | canonical[0..33] | **MATCH** |
| `source_last_message_key` | `id:msg_qU4pQ33J` | canonical[33].id | **MATCH** |
| `source_prefix_hash` | `sha256:5eea2fcb91f3d935e65c96a83afa00077823da2120efb520012c26f0b4f91e58` | recomputed with the production algorithm over the live canonical prefix | **EXACT MATCH** |

The stored prefix hash was reproduced **byte for byte** by the production
`createSessionCompactionState` over the live canonical prefix. The compaction state is
therefore bound to exactly the canonical prefix it claims — not to a re-derived or
approximate transcript.

### 4.3 The 20 → 3 reference transition, reproduced exactly

Applying the production reference definition
(`collectToolCallReferenceIds` — a tool result's `tool_use_id`) to the live artifacts:

| Quantity | Trace | Live recomputation | Result |
|---|---|---|---|
| References before | 20 | 20 | **EXACT** |
| References after | 3 | 3 | **EXACT** |
| Retained | 3 | 3 | **EXACT** |
| Dropped | 17 | 17 | **EXACT** |
| Replaced | 0 | 0 | **EXACT** |

The live artifacts reproduce the trace's transition **exactly**, including the
`replaced = 0` discriminator that rules out an equal-count, disjoint-reference substitution.

### 4.4 Identity-level conservation of the 17 dropped references — the decisive result

Aggregate counts cannot prove identity conservation. Each of the 17 identities was therefore
correlated against the canonical transcript, and the owning canonical message id was
recorded:

| Class | Count | Meaning |
|---|---|---|
| Dropped from working context, **identity-named in the summary's verified-outcome section** | **9** | The identity survived into the model-facing projection, by id. |
| Dropped from working context, **not carried**, **canonical record present** | **8** | The identity is absent from the model-facing projection; its canonical record is nevertheless present and intact. |
| Dropped from working context, **canonical record MISSING** | **0** | — |

**All 17 dropped reference identities are present in canonical storage, each mapped to a
unique canonical message, with no id churn (0 duplicates).**

The complete per-reference disposition of all 20 working-context references is in
`canonical-continuity-audit.json` → `evidenceReferenceContinuity.perReference`.

> **This is the answer to RC-04.** The 17 dropped references were dropped from the
> **model-facing working context**, not from the canonical record. Nine are carried forward
> by identity into the summary's `## Verified tool outcomes (canonical record)` section;
> the remaining eight remain available in canonical storage and were recoverable by
> correlation against it. **No canonical evidence was lost.**

Note the precision of the claim: this ACT does **not** claim that all 17 references
"survived" in the working context. Nine did. Eight were omitted from the projection — a
**working-context omission** — and their conservation is established at the **canonical**
layer, by identity. The distinction is recorded explicitly in the audit's per-reference
table rather than collapsed into a single number.


---

## 5. Is the canonical transcript append-only? Can compaction mutate it?

**Determination: the canonical transcript is append-only in production, and compaction can
neither replace, remove nor mutate a previously persisted canonical record.**

This is established from the implementation, in four independent ways (see `source-map.md`
§2 for the citations):

1. **The compaction result is a request-scoped projection.** `agent-runtime.ts:4875-4883`
   builds a **new** `AgentModelRequest` and returns it. `state.messages` — the canonical
   history — is never assigned, spliced or truncated by compaction.
2. **No persistence path truncates the canonical list.** `messages.slice(...)`,
   `messages.splice(...)` and `messages.length = ...` do not occur on the canonical
   transcript in `agent-runtime.ts` or `local-runtime-host.ts`. The single `splice` in the
   agent runtime is a hook-context **insertion**.
3. **Separate artifacts.** The canonical transcript and the compaction sidecar are
   distinct files with distinct schemas and distinct SHA-256s. Writing the sidecar cannot
   rewrite the transcript.
4. **Cryptographic binding.** The sidecar carries a SHA-256 over the canonical prefix, and
   the production projector refuses to project — and the host refuses to persist — when the
   recomputed hash differs.

The live artifacts corroborate this: the sidecar's `updated_at`
(`2026-11-17T05:26:46.573Z`) precedes the canonical transcript's `updated_at`
(`2026-11-17T05:31:52.789Z`), and the canonical tail's timestamps are strictly later than
the boundary prefix's. The canonical history **kept growing after** the compaction was
persisted.

---

## 6. Executable qualification — gates and actual results

### 6.2 Existing real-production-seam test suites

```
cd sdk/packages/core && bun x vitest run --config vitest.config.ts \
  src/session/models/session-compaction.test.ts \
  src/extensions/context/evidence-continuity.test.ts \
  src/extensions/context/task-contract-conservation.test.ts
→ Test Files 3 passed (3);  Tests 103 passed (103)

bun x vitest run --config vitest.config.ts \
  src/extensions/context/compaction.test.ts \
  src/extensions/context/compaction.live.test.ts \
  src/extensions/context/compaction.roundc-fidelity-recon02.test.ts \
  src/extensions/context/compaction.decision-capture.conservation.test.ts \
  src/extensions/context/compaction.tool-result-shape-red.test.ts \
  src/extensions/context/compaction.working-context-authority-publish.test.ts \
  src/extensions/context/task-contract-conservation.historical.test.ts \
  src/extensions/context/task-contract-budget-authority.test.ts
→ Test Files 7 passed | 1 skipped (8);  Tests 163 passed | 2 skipped (165)

bun x vitest run --config vitest.config.ts \
  src/observability/latency/latency-boundaries.integration.test.ts \
  src/observability/latency/latency-sink.compaction-token-evidence-capture01.test.ts
→ Test Files 2 passed (2);  Tests 20 passed (20)
```

**Totals: 12 files, 286 tests passed, 3 skipped, 0 failed.** No new permanent test was
added — the seam was already covered by these suites, and this ACT's live auditor drives the
same production functions against the real artifacts.

### 6.3 Control coverage against the ACT's required controls

| Required control | Where it is discharged | Result |
|---|---|---|
| Canonical transcript remains unchanged by compaction projection | Live check 14 (byte-identical) + `agent-runtime.ts:4875-4883` | **PASS** |
| Compaction state binds to the correct canonical prefix | Live checks 5, 6 (count + boundary key + exact hash reproduction) | **PASS** |

---

## 8. Bounded limitations (stated, not papered over)

1. **Scope is one session and one compaction.** The verdict qualifies the observed event in
   session `1794892591345_7em4g`. It does not qualify every compaction scenario.
2. **The eight not-carried references are conserved at the CANONICAL layer, not in the
   model-facing prompt.** Their canonical records are present and identity-matched. Whether
   the *model* should have seen them is a **summarization-quality** question, deliberately
   outside this ACT's scope (and outside its verdict's claim).
3. **The installed extension bundle is not this repository HEAD.** The trace's
   `identity.sourceHead` is `UNAVAILABLE_FROM_TRACE`; the bundle SHA-256 identifies the
   installed runtime only. The live artifacts, however, are **self-verifying**: the stored
   prefix hash is reproduced by the production algorithm at this repository HEAD, which
   proves the persisted sidecar and the persisted canonical transcript are mutually
   consistent under the current implementation.
4. **13 `provider_first_text` events are unavailable** in the trace ("the provider did not
   report this event"). None is a compaction boundary and none affects this adjudication.
5. **The 34-message candidate was never submitted.** Its 108,280 tokens are a production
   estimate and remain labelled `UNLABELLED`; the 15,607-token provider response describes
   the submitted post-compaction request only.
6. **No property was classified `LIVE_UNOBSERVABLE` or `CAPTURE_INSUFFICIENT`.** Every
   property the ACT required — canonical identity and ordering, the prefix binding, the
   per-reference disposition, the resume reconstruction and the rejection contract — was
   observable in the live artifacts and was measured. The eight omitted references are a
   measured classification (`working-context omission, canonical record present`), not an
   unobservable one.

---

## 9. Board update (RC-04)

| Stage | Status |
|---|---|
| RC-01 independent calibration | **Unchanged** — production estimator unchanged, coefficients not refit, frozen calibration preserved |
| RC-02 observed trigger causality | **Unchanged** — QUALIFIED, explicit scope (one observed event) |
| **RC-04 canonical evidence continuity** | **QUALIFIED — `PASS_CANONICAL_CONTINUITY_LIVE`** |
| RC-03, RC-05 … RC-08 | **Unchanged** |

**RC-04 in detail.** The live canonical artifacts of session `1794892591345_7em4g` establish
that the 17 working-context-dropped evidence references were **not** lost from the canonical
record. 9 of the 17 are carried into the model-facing summary by identity (the production
`## Verified tool outcomes (canonical record)` section); the other 8 are omitted from the
model-facing projection but their canonical records are present, identity-matched and
intact. All 46 canonical messages survive with unique ids, strict ordering, complete
tool-call/tool-result pairing (26/26, 0 orphans), and a byte-identical transcript after
projection. The compaction state binds to its canonical prefix by an exactly reproduced
SHA-256, and invalid or mismatched prefix hashes are rejected by the production contract.
Resume reconstructs the working context as sidecar + canonical tail without rewriting
canonical history.

---

## 10. Verdict

**`PASS_CANONICAL_CONTINUITY_LIVE`**

Live canonical evidence and production-source checks establish preservation of the relevant
original records, their identities and ordering across compaction.

The qualification rests on the session's **actual artifacts**, joined by the production
algorithms themselves — the stored prefix hash was reproduced from the live canonical
prefix, the 20 → 3 reference transition was reproduced exactly, and each of the 17 dropped
identities was correlated against canonical storage individually. No structural or synthetic
evidence was promoted to live proof, and no aggregate count was used as a substitute for
identity-level conservation.

**Success is a qualified answer about actual evidence preservation — not another compaction
implementation.** Nothing in the compaction implementation was changed.

| Resumed context incorporates canonical messages appended after the compaction boundary | Live check 10 | **PASS** |
| Mismatched or invalid prefix hashes are rejected / handled per the verified contract | Live checks 11, 12, 13 + `session-compaction.test.ts` "rejects when the canonical prefix was edited before the boundary" | **PASS** |
| Tool-result identity and ordering remain conserved in canonical storage | Live checks 2, 3, 4, 15 (26/26 pairing, 0 orphans, 0 ordering violations) + per-reference identity census | **PASS** |
| Captured privacy boundaries remain enforced | §7 below + `latency-boundaries.integration.test.ts` (15 tests passed) | **PASS** |

### 6.4 No defect reproduced

The live session exposed **no** reproducible canonical persistence or attribution defect.
Because no defect was reproduced, **no RED test was constructed**, and — as the ACT brief
requires — **no repair was made**. The eight references omitted from the model-facing
projection are a **working-context omission** governed by the deliberate design of the
generated summary (a lossy projection), not a persistence defect: their canonical records
are intact and recoverable.

---

## 7. Privacy verification

The evidence package contains **only bounded metadata, opaque identities, hashes,
classifications and counts**. No canonical message text, no private prompt and no
tool-result payload was committed.

| Check | Result |
|---|---|
| Distinctive canonical / summary strings (≥40 chars) tested against the exported trace | **326** |
| Of those, found verbatim in the trace | **0** |
| Distinctive canonical / summary strings tested against the **committed evidence package** | **336** |
| Of those, found verbatim in the committed package | **1** — `## Verified tool outcomes (canonical record)`, which is the **exported production constant** `EVIDENCE_SECTION_HEADING` (`evidence-continuity.ts:211`), not canonical content |
| Private workspace / repository references in the committed package | **0** — no private project name, no private repository URL, no checkpoint commit id (all checked by marker scan; none present) |
| Private workspace path occurrences in the trace | **0** |
| Tool-call ids in the trace | 26 — opaque identifiers already on the `LATENCY_METADATA_ALLOWLIST` (`toolCallId`) |
| Raw canonical messages committed | **no** |
| Raw compaction sidecar committed | **no** |
| Raw trace committed | **no** |

The committed audit contains message ids, tool-call ids, hashes, counts and boolean
classifications. The private workspace root and cwd are redacted in `identity.json`. The two
absolute paths that do appear (`storageRoot`, `sourceTrace.path`) are the **local evidence
locations** for the ClineMM storage root and the operator's Downloads folder — they are not
the private workspace under adjudication, and they carry no session content.



### 6.1 The live auditor (production seam × live artifacts)

```
bun run tool/audit.ts \
  --session-dir <session dir> --out canonical-continuity-audit.json
→ AUDIT PASSED: all live continuity checks green          (exit 0)
```

**15 / 15 live checks PASS, 0 FAIL.** The auditor's `verdictInputs` gate covers:

| # | Live check | Result |
|---|---|---|
| 1 | Sidecar parses under the production schema | PASS |
| 2 | Canonical transcript is complete (46 messages) | PASS |
| 3 | Canonical message ids are unique (0 duplicates) | PASS |
| 4 | Canonical `ts` is strictly non-decreasing (0 violations) | PASS |
| 5 | `source_last_message_key` resolves to canonical[count-1] | PASS |
| 6 | Stored prefix hash reproduces from the live canonical prefix | PASS |
| 7 | Resume projection is defined against the live canonical transcript | PASS |
| 8 | Projection = sidecar messages + canonical tail | PASS |
| 9 | Projection tail is identity-equal to the canonical tail | PASS |
| 10 | Resume incorporates canonical messages appended after the boundary | PASS |
| 11 | Mismatched prefix hash is rejected | PASS |
| 12 | Tampered `source_message_count` is rejected | PASS |
| 13 | Oversized `source_message_count` is rejected | PASS |
| 14 | Canonical transcript is byte-identical after projection | PASS |
| 15 | `tool_use` / `tool_result` pairing is complete (0 orphans) | PASS |

### 4.5 Resume reconstructs the working context without rewriting canonical history

Driving the production `projectSessionCompactionState` against the live artifacts:

| Check | Observed |
|---|---|
| Projection defined | **YES** — 18 messages = 6 sidecar + 12 canonical tail |
| Canonical tail identity conserved in the projection | **YES** — every tail message id matches positionally |
| Canonical messages appended after the boundary are incorporated | **YES** — an appended canonical message appears in the projection (18 → 19) |
| Canonical transcript byte-identical after projection | **YES** |
| Canonical message count unchanged after projection | **YES** |

The resume path reconstitutes the intended working context **from** canonical storage and
appends the canonical tail — it does not rewrite the canonical history. The production
source confirms the same structurally: `agent-runtime.ts:4875-4883` returns a **new** request
object and never mutates `state.messages`.

### 4.6 Invalid state is rejected according to the verified production contract

| Injected fault | Production behaviour |
|---|---|
| Mismatched `source_prefix_hash` | **REJECTED** — `projectSessionCompactionState` returns `undefined` |
| Tampered `source_message_count` (34 → 40) | **REJECTED** — the recomputed hash over the first 40 messages does not match |
| Oversized `source_message_count` (> canonical length) | **REJECTED** |

This matches the verified contract in `session-compaction.ts:168-198` and the host's
`canPersistCompactionState` gate (`local-runtime-host.ts:2159-2186`), which refuses to
**persist** an unprojectable state.


| Field | Value |
|---|---|
| Decision | `1794892591345_7em4g#13#12` (ordinal 12) |
| Preparation request id | `req_wdW3TYdm` |
| Model request id | `model_request_rNzg1ix3UpKYZkDIeI99B` |
| Compaction | 34 → 6 working-context messages; 20 → 3 evidence references (17 dropped, **0 replaced**) |
| Outcome | `completed`, duration **64,564.481 ms** |
| Post-compaction provider input | **15,607** tokens |
