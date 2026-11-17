# ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — Qualification Report

**Verdict: `HALT_CAPTURE_CONTRACT_INCOMPLETE` -> bounded correction applied.
CODE-level verdict is `PASS_CAPTURE_QUALIFIED`. The LIVE dispatch leg is
`PENDING_OPERATOR_BUILD`** (the operator builds the exact-head dogfood
VSIX manually; the instruction to stop building was received during the
run).

**Source HEAD (discovered, not assumed):** `f39ffb732a03a4e755c179c7202b65b7d2c1491f`
**Branch:** `main` · **Remote:** `git@github.com:s1onique/clinemm.git`
**Production estimator changes:** NONE · **Strata modifications:** NONE
**Unmerged Strata `/tokenize` PR:** not transplanted, not used

---

## 0. The bounded correction (review cycle 1)

An independent review of the first implementation returned
`HALT_CAPTURE_CONTRACT_INCOMPLETE` with four P0 defects and one adjacent
P1. All five were corrected in one bounded pass. No new tracing
architecture was introduced, the estimator was not touched, and no context
threshold or compaction policy was changed.

| Defect | Correction |
|---|---|
| **P0-1 — the 8 MiB / 64 MiB limits did not constrain ACTUAL writes.** `flush()` computed the truncation flag and then wrote the COMPLETE serialized candidate anyway, so a 20 MiB candidate landed on disk while its receipt claimed `snapshotComplete: false`. Successive flushes also rewrote retained candidates without removing obsolete files, so the in-memory 12-candidate cap did not bound the directory. | The oversized candidate is now **REJECTED BEFORE ANY BYTE IS WRITTEN** and reported as a metadata-only rejection receipt. The store tracks the files it owns, derives the byte/count totals from that map so the reported totals are the ACTUAL on-disk totals, and **removes superseded files** so the in-memory retention cap is also an on-disk file cap. `chmod` is applied to the directory and to every file the store writes, because `mkdir`/`writeFile` `mode` only applies to NEWLY created entries. |
| **P0-2 — fingerprinting ran even with diagnostics disabled.** `prepareModelRequest()` unconditionally executed `this.activeDispatchRecord = this.buildProviderDispatchRecord(request)`, which re-projects the provider-visible messages, re-runs the token estimator, canonicalizes the projection and computes a synchronous SHA-256 — on every ordinary request, including public-profile requests. | The guard is now **AT THE PRODUCER**. `isProviderDispatchRecordRequired(sink)` (new, in `@cline/shared`) reports whether any consumer of the dispatch record exists; when it does not, the record is not built at all and the projection/hash work never executes. |
| **P0-3 — the private capture was not dogfood-only.** The arming function checked only the opt-in variable, and the storage resolver fell back to `~/.cline/data`, so a full prompt/tool-argument capture could land in the shared default data directory. | Arming now requires BOTH the explicit opt-in AND the established closed-runtime dogfood identity (`CLINEMM_RUNTIME_PROFILE === "dogfood"`, exact-match, fail-closed — the same marker the dogfood diagnostic profile already consumes). The storage root resolves ONLY from `CLINE_DATA_DIR` or `<CLINE_DIR>/data`; there is **no implicit `~/.cline/data` fallback**, and the capture is NOT armed when neither is set. |
| **P0-4 — the exported latency trace lost the new correlation fields.** `LatencyTraceSink` recorded `observation.payload` only, while the authoritative `preparationRequestId` / `modelRequestId` live on the OBSERVATION; and the finite metadata allowlist did not carry the new fields. The exported JSON therefore could not establish the join, even though the direct recording-sink tests passed. | The sink now projects the observation identity onto the metadata bag, and the finite `LATENCY_METADATA_ALLOWLIST` carries `preparationRequestId`, `modelRequestId`, `decisionId`, `decisionJoinAuthority`, `estimatedFinalInputTokens`, `finalProjectionFingerprint` (+ its representation/version/producer) and `providerFamily` / `providerVisibleMessageCount` / `toolSchemaCount`. The allowlist is still the privacy boundary: only identifiers, counts, digests and classifications pass. |
| **P1 — the candidate snapshot was not deep-copied, and the filtered options could diverge from the pre-filter fingerprint.** | `record()` now deep-copies and freezes the candidate BEFORE the first asynchronous boundary, so a later mutation of the live request objects cannot change what the "exact" snapshot represents. The write boundary still re-applies the option allowlist as defence in depth. |

### 0.1 The gates that prove each correction

| Defect | Gate |
|---|---|
| P0-1 | `P0-1: an oversized candidate is REJECTED BEFORE the write — the disk stays bounded`; `P0-1: repeated captures keep the ACTUAL disk file count and byte total bounded`; `P0-1: a SUPERSEDED control candidate is REMOVED from disk`. Each asserts the REAL directory contents and byte totals, not the returned flag. |
| P0-2 | `P0-2: with NO sink, the dispatch-record projection and fingerprint NEVER execute` spies on the runtime's own `buildProviderDispatchRecord` and proves: no sink -> 0 calls; a sink without the dispatch-record channels -> 0 calls; a sink with those channels -> >= 1 call (so the gate is real, not a blanket disablement). |
| P0-3 | `the private capture is armed ONLY by an explicit separate opt-in AND the dogfood identity`; `P0-3: a REGULAR profile can NEVER arm the capture, even with the opt-in set` (ten non-dogfood profile values); `P0-3: the storage root FAILS CLOSED — there is no implicit ~/.cline/data fallback`; `P0-3: a PERMISSIVE pre-existing directory and file are CORRECTED, not inherited`. |
| P0-4 | `latency-sink.compaction-token-evidence-capture01.test.ts` exercises the COMPLETE production export path `AgentRuntime -> LatencyTraceSink -> sanitized trace JSON`: the decision, the submission and the completion share the EXACT preparation identity; the attempt identity is distinct; the fingerprint and the measurement survive the export; and no request CONTENT leaks. |
| P1 | `P1: the captured snapshot is IMMUTABLE — a later mutation cannot change it`. |

### 0.2 RED -> GREEN was demonstrated for every gate

Each new witness was run against a deliberately reverted implementation and
observed to FAIL, then observed to PASS with the correction restored:

| Gate | RED (reverted implementation) | GREEN (corrected) |
|---|---|---|
| P0-1 / P0-3 | 3 of 14 capture-store tests FAILED | 14 of 14 PASS |
| P0-2 | the P0-2 witness FAILED (1 failed / 7 passed) | 8 of 8 PASS |
| P0-4 | 4 of 5 export-path tests FAILED | 5 of 5 PASS |


## 1. What this ACT established

The ACT's objective was to eliminate the missing evidence boundary. Two
gaps existed, and both are now closed in production code.

### 1.1 The identity gap — CLOSED

**Pre-ACT.** The compaction decision seam could not reach the request
identity. The source said so explicitly: the request id "is minted in
`streamPreparedRequest`, AFTER this seam returns", so the decision carried
its OWN `(sessionId, iteration, decisionOrdinal)` identity. The
decision -> dispatch -> usage join was therefore
`INFERRED_CHRONOLOGICAL_PAIRING`. PARITY01 had already recorded this as
hypothesis **H5** ("request-correlation error — NOT EXCLUDED as the primary
cause"), which is precisely why PARITY01 could not upgrade its projection
to a measurement.

**Post-ACT.** The runtime's early `req_` identity is forwarded verbatim
through the existing internal prepare-turn context onto the decision
record, and from there onto the provider dispatch and the provider
completion records. The join is now an EXACT key, never a timestamp
proximity. A new `decisionJoinAuthority` field states plainly whether the
join is `AUTHORITATIVE` or `UNAVAILABLE` — it is never reported as
authoritative when the id is absent.

### 1.2 The content gap — CLOSED

**Pre-ACT.** The decision record carried metadata only. The exact
pre-compaction candidate could not be reconstructed from it, because by the
time anyone could read it the canonical history had already moved on.

**Post-ACT.** An explicitly opt-in, dogfood-only PRIVATE capture preserves
the already-prepared inputs at the decision boundary, BEFORE any
compaction runs. The stateful `MessageBuilder` is never called again, and
no captured object is mutated. The representation is
`CLIENT_DECISION_CANDIDATE_EXACT` — explicitly NOT
`SERVER_FORMATTED_PROMPT_EXACT`, because the provider still applies its own
chat template and tokenization.

---

## 2. The live Strata measurement (C1.3 / C4)

Target: `http://192.168.50.111:8080` (the remote Strata server; the
locally installed `kapitsa` v0.2.35 on `:8000` is a DIFFERENT provider and
is out of scope). Model `qwen3.8-flash-next-iq3_s`, `n_ctx 131072`.

### 2.1 Route inventory

`/v1/tokenize` **does not exist** on the installed Strata (404 on GET and
POST). This independently confirms the unmerged Strata tokenizer PR is
absent, and the ACT did not transplant it. **C4 option A is UNAVAILABLE.**

`/v1/messages/count_tokens` **does** exist (POST only; a GET returns 404,
which a GET-only probe would have mis-read as absence).

### 2.2 Equivalence — the decisive measurement

A controlled A/B against live Strata: identical content submitted through
`count_tokens` (Anthropic shape) and through `/v1/chat/completions`
(OpenAI shape, `max_tokens: 1`), comparing the route's count with the
provider's ACTUAL reported `usage.prompt_tokens`.

- **Without tools: EXACT.** Delta 0 in 4 of 4 shapes (simple 55/55, system
  62/62, long text 1252/1252, tool-result turn 79/79).
- **With tools: a deterministic per-tool UNDER-count.** -9 (empty schema),
  -17 (1 property), -26 (2 properties), -34 (2 tools). A tool-count sweep
  at a fixed tool shape isolates it as exactly linear: -26 per tool for
  n = 0..4.
- **Mechanism.** `tool_choice: "none"` makes the OpenAI route drop the
  tools entirely (55 = the no-tool count) while `count_tokens` still
  returns 271. The two routes render the tool block differently. The
  per-tool offset is a function of the tool SCHEMA, not a fixed constant,
  so it cannot be recovered from the request alone without
  reimplementing the OpenAI-side tool serialization — which is exactly the
  unmerged PR's job.

**Classification: `TOKENIZER_FORMAT_NOT_EQUIVALENT`** for the full
OpenAI-compatible request. The route IS an exact authority for the
system-prompt-and-messages portion, but ClineMM's real requests always
carry a tool inventory, which the production estimator explicitly bills
(`requestOverheadTokens`; PARITY01 measured ~5,692 tokens on the historical
session). So it cannot certify the candidate as a whole.

### 2.3 The provider usage contract — confirmed at the source

```json
"usage": { "prompt_tokens": 296, "completion_tokens": 1,
           "prompt_tokens_details": { "cached_tokens": 0 } },
"timings": { "cache_n": 0, "prompt_n": 296, ... }
```

`prompt_n` equals `prompt_tokens`, so the reported prompt count is the
COMPLETE prompt and `cached_tokens` is a SUBSET of it. This confirms, from
the provider itself, the contract PARITY01 had inferred from the AI SDK.
The production completion record preserves it and it is pinned by a
witness.

---

## 3. The conservation gates

| Gate | Result |
|---|---|
| RED -> GREEN | PASS — the RED witness pins the pre-ACT shape; the bounded correction added 6 more RED->GREEN witnesses (3 P0-1/P0-3 capture-store, 1 P0-2 runtime, 4 P0-4 export-path) |
| Exact request/attempt correlation | PASS — preparation identity, attempt identity and decision identity all distinct and correctly scoped, AND surviving the sanitized latency-trace export |
| Privacy negative controls | PASS — credential allowlist, 0700/0600 permissions (including correction of a permissive pre-existing directory), explicit rejection of oversized candidates, explicit removal, AND dogfood-only fail-closed arming |
| Diagnostics-OFF non-interference | PASS — identical execution result, usage and dispatched message count; AND the dispatch-record projection/hash work provably does not execute when no consumer is present |
| New ACT-owned typecheck errors | NONE — shared 0, agents 0, core 0 new in touched files |
| Biome clean | PASS — 14 touched files, no findings |
| New attributable baseline failures | NONE — core baseline 152 failed / 5379 passed; with the ACT + bounded correction: 111 failed / 5455 passed. The 16 remaining failing files are all pre-existing baseline files (bash supervisor, editor realpath authority, hub server, hub runtime host, macOS sandbox, checkpoint/persistence); NONE is ACT-owned. |
| SDK build | PASS — `bun run build:sdk` succeeded (shared + agents rebuilt after the shared barrel gained `isProviderDispatchRecordRequired`) |
| Extension bundle / VSIX | NOT BUILT — operator builds manually |

**One regression was found and fixed during the work, and it is recorded
because it is instructive.** The first implementation computed the content
fingerprint with an ASYNCHRONOUS WebCrypto digest on the request-preparation
path. That introduced a suspension point which the production retry-backoff
tests — which drive the runtime with fake timers — could not advance; 10
agent-runtime tests timed out. The fingerprint is now computed with a
dependency-free SYNCHRONOUS FIPS 180-4 SHA-256, which adds NO suspension
point, so the request, the tool inventory, the token budget and the provider
dispatch are bit-for-bit identical to the un-instrumented path. The
synchronous digest is itself witnessed against `node:crypto` at every block
boundary.

---

## 4. What this ACT did NOT establish

**It did NOT establish that ClineMM compacted unnecessarily.** The
classification is `PASS_CAPTURE_QUALIFIED`, not
`REPRODUCED_ESTIMATOR_CAUSALITY`.

The composition the success criterion demands has three legs, and only two
are in place:

| Leg | Status |
|---|---|
| A correctly correlated, actually submitted request with measured provider tokens | **IMPLEMENTED AND WITNESSED**; the live rows await the operator-built VSIX |
| An exact but unsubmitted pre-compaction client candidate | **IMPLEMENTED AND PRIVACY-WITNESSED**; the live capture awaits the operator-built VSIX |
| A genuinely equivalent tokenizer or controlled provider measurement for that candidate | **NOT AVAILABLE** — the only counting route is not format-equivalent for a tool-bearing request |

Until leg three exists, the estimate-versus-provider gap for the EXACT
candidate cannot be measured, so premature compaction remains unproven.

---

## 5. Limitations

1. **The live dispatch leg is incomplete.** No ClineMM request was
   dispatched against live Strata by this run. The operator-built
   exact-head VSIX is required to produce the authoritative
   request-to-usage rows and the live private candidate.
2. **`count_tokens` is not an authority for a tool-bearing request.** The
   per-tool offset is schema-dependent and cannot be derived from the
   request alone.
3. **The controlled minimal-generation probe (C4 option C) was PREPARED,
   not run.** No shadow request was issued against the live Strata
   instance, per the ACT's constraint. The probe's design, its single
   intentionally changed field (`max_tokens: 1`), its tool-execution ban
   and its equivalence requirement are specified in
   `tokenizer-authority.md`.
4. **The request-level retry path has a pre-existing reachability
   limitation** that this ACT records but does not change (see
   `boundary-map.md` section 4): a provider failure that throws out of
   `model.stream()` propagates past `withProviderErrorRetry`, which
   classifies a RETURNED turn. Changing that would be a retry-logic
   change, which this ACT does not authorize.
5. **The `capability` of the fingerprint is a CONTENT fingerprint of the
   client-side representation.** It is not a claim of byte-identical
   provider-wire content; the provider adapter may still transform the
   request afterwards. The representation identifier and producer are
   recorded precisely so that no consumer can mistake one for the other.

---

## 6. Successor recommendation

**One bounded estimator-repair ACT, gated on the missing measurement.**

The repair must not start until the candidate's TRUE token count exists.
The recommended sequence:

1. **Complete the live capture.** Operator builds the exact-head VSIX,
   installs it into the isolated `~/.vscodium-clinemm` dogfood profile,
   and runs one bounded disposable task, exporting the metadata. The
   private capture requires ALL THREE of:
   - `CLINEMM_RUNTIME_PROFILE=dogfood` (the established closed-runtime
     dogfood identity; exact-match, fail-closed), AND
   - `CLINE_PRIVATE_COMPACTION_CANDIDATE_CAPTURE=1` (the separate explicit
     private opt-in), AND
   - `CLINE_DATA_DIR` (or `CLINE_DIR`) pointing at the isolated dogfood
     storage root — there is NO `~/.cline/data` fallback, so the capture
     fails closed when the root is not explicit.

   That produces the authoritative request-to-usage rows AND at least one
   complete private candidate. If a natural compaction is impractical, use
   a clearly labelled isolated probe configuration — do NOT silently change
   the benchmark's context settings.

2. **Measure the candidate exactly.** The candidate's tool schemas and
   messages are captured. Two bounded options:
   - (A) Run the prepared minimal-generation probe (operator opt-in
     required) with the captured candidate's exact messages, system prompt,
     tools and template settings, `max_tokens: 1`, no tool execution. The
     provider-reported `prompt_tokens` is then the candidate's count,
     PROVIDED the probe's formatted prompt is proven equivalent to the
     candidate's (verified by a paired observation with and without the
     tool inventory). If equivalence cannot be established, the result is
     `SHADOW_PROBE_NOT_EQUIVALENT`, not a count.
   - (B) Derive the tool-schema offset from a paired observation of the
     same tools with and without the message body, and add it to the exact
     `count_tokens` result for the messages+system portion. This route is
     exact for the messages and system today; only the tool block needs
     the paired measurement.

3. **Then, and only then, evaluate a repair.** If a trusted count for the
   exact candidate falls BELOW the actual trigger while the production
   estimator is at or above it, `REPRODUCED_ESTIMATOR_CAUSALITY` is
   established. The repair must remain conservative on dense content, keep
   the underestimate factor as the safety net, retain the system prompt,
   tool schemas, JSON framing and image accounting, preserve the
   provider-usage contract, and keep every fail-closed path intact. A
   genuinely oversized control MUST still compact.

**Stop condition honoured:** this ACT produced evidence and a
classification. It did not modify the estimator, change any context
threshold, or start another full Round C.
