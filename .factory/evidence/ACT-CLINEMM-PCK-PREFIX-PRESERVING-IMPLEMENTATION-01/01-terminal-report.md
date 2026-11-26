# ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — terminal report

## Identity

```text
ACT_ID:               ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01
ENTRY_HEAD:           cc733df911a1776708c9131f8a37fcc555ae5f61
IMPLEMENTATION_SUBJECT_HEAD: cc733df911a1776708c9131f8a37fcc555ae5f61
IMPLEMENTATION_HEAD:  the SINGLE commit of this ACT
FINAL_HEAD:           the single commit of this ACT; a commit cannot carry its own
                         hash, so `git log cc733df9..HEAD` lists the exact range
TRACKED_DIRT:         NONE at entry; the ACT's own files only at exit
```

The accepted historical anchor `cc733df9` IS the repository `HEAD` at entry, so the
anchor is the entry head and no intervening commit exists.

## Gates

```text
REQUIRED_RED:                   REPRODUCED
BOUNDED_GREEN:                  PASS (19/19 focused)
LEGACY_CONSERVATION:            PASS
PARENT_HISTORY_CONSERVATION:    PASS
PRODUCTION_TOOL_EXECUTION_DENIAL: PASS
ACT_OWNED_TYPECHECK_DIAGNOSTICS: 0 (baseline 90 == baseline 90)
ACT_OWNED_LINT_DIAGNOSTICS:      0
```

## C0 — the parent request authority

The authority available at the PCK activation boundary
(`generatePreCompactionKnowledgeCheckpoint`,
`sdk/packages/core/src/extensions/context/compaction.ts`) is the **current
provider-visible projection** of the canonical history:

| Fact | Value at the boundary |
|---|---|
| Last physically dispatched ordinary request | NOT separately retained. The runtime keeps only `previousRequestInputTokens` (a count) and `preparationRequestId` (an identity); the dispatched message array is not retained. |
| Current canonical history | `context.messages` — available. |
| Current provider-visible projection | `context.apiMessages` — available. It IS the real projection: the runtime's extension message builders followed by `MessageBuilder.buildForApi` (`session-runtime-orchestrator.ts:1919-1929`). |
| Effective provider configuration | Resolved at the transport, per request, from `resolveSummarizerConfig`. |
| Actual tool schema / tool choice | The runtime's tool inventory, projected onto the wire triple (`name`, `description`, `inputSchema`) by `projectProviderVisibleToolSchema`. |

**THE DISTINCTION IS RECORDED.** The boundary holds the CURRENT projection, which may
contain messages added since the last dispatch. The implementation does **not** claim
the current projection is the last dispatched request, and it does not reconstruct one.

**THE ACTUALLY SHARED PREFIX.** Because the dispatched request's array is not retained,
the shared prefix with the last dispatched request is **not computable from repository
state**. The implementation therefore establishes prefix conservation against the
*current* projection — the strongest available authority — and leaves the cache-residency
claim to live qualification.

**A MATERIAL FINDING (empirical).** `MessageBuilder.buildForApi` **MERGES** a user
message that follows a tool-result-only user message INTO that predecessor, and the
merged message's canonical id is **DROPPED** from the projection. Probed directly:

```text
canonical ids: m1,m2,m3,m4,m5,m6
provider  ids: m1,m2,m3,m5,m6      <- m4 is GONE (merged into m3)
```

This is the recon's "precise missing seam" made concrete: a canonical reference can
exist in the canonical history and have **no** provider-visible position the model can
resolve.

## The B′ composition

```text
ordinary parent projection (context.apiMessages, verbatim, in order)
    + ONE appended user message carrying the extraction suffix
    = auxiliary inference request
```

- The parent's **system prompt** is carried verbatim (`context.systemPrompt`).
- The parent's **visible tool schema** is carried verbatim (the wire triple).
- The **conversation is not duplicated**: the suffix carries the contract, the objective,
  the authorized interval, the bindings and the bounded observation metadata — never a
  second copy of the transcript (asserted: the suffix does not contain the transcript).
- The suffix is **request-local**: it is never persisted, and it is not an ordinary
  conversation message (asserted against the compacted production transcript).
- The auxiliary branch uses the **existing isolated inference path**
  (`generateSummary` → `createHandlerAsync` → `handler.createMessage`). The ordinary
  agent execution loop is never entered.
- The **ordinary-agent tool availability is unchanged**: the parent's schema is
  advertised for rendering parity, and the auxiliary branch holds **no executor** — the
  projected schema carries only `name`/`description`/`inputSchema`.

**The configuration key** (discovered from the sibling PCK features' existing mechanism):

```text
CLINEMM_PCK_PREFIX_PRESERVING_ENABLED=1
```

DEFAULT-OFF. The value must be exactly `1` or `true` (case-insensitive). The sibling
capture flag is `CLINEMM_PCK_PREFIX_CAPTURE=1` (also default-off).

## C3 — source visibility and provenance

### C3.1 The canonical reference → provider-visible position binding

`buildProviderVisibleBindings` (`provider-visible-binding.ts`) computes the
request-local binding from the REAL `(canonical history, provider-visible projection)`
pair. It resolves on the canonical message id, which the production projection
**preserves for every message that survives** and **drops for a message it merges**.
A reference resolves only when it is simultaneously:

1. **within the authorized source interval**,
2. **visible** (exactly one provider-visible position),
3. **unambiguous** (not more than one position), and
4. **not reasoning-only**.

Every other case yields a distinct, observable reason: `out_of_interval`, `absent`,
`ambiguous`, `private_reasoning`, `truncated`. An unresolved binding is
**non-authorizing**: `collectAuthorizedReferences` returns only the resolved ones, and
only those are offered for citation in the suffix.

**Coverage of the applicable transformations** (each exercised):

| Transformation | Disposition |
|---|---|
| System-message insertion | The parent's system prompt is carried verbatim as the request's system channel; it is never part of the message array, so no message index shifts. |
| Multiple content blocks | A canonical message's blocks map to the provider message's blocks; the tool-call reference resolves to a **block** position. |
| Tool-call / tool-result pairs | The tool-call id resolves to the provider position of its `tool_use`/`tool_result` blocks. |
| Message coalescing | The merged-away canonical message has **no** position → `absent` → non-authorizing. |
| Filtered content | A canonical reference with no provider position → `absent`. |
| Truncated content | A truncation the projection introduced → `truncated` → non-authorizing. |
| Signed and unsigned reasoning | A reasoning-only message → `private_reasoning` → non-authorizing. |

### C3.2 Private reasoning

The parent projection **carries the parent's private reasoning to the wire** — signed
`thinking` blocks are present in the provider-visible projection (probed: the assistant
message renders as `thinking|text`). The legacy controlled view excluded them.

**Disposition:** the B′ variant **exposes** the parent's private reasoning on the wire,
because preserving the parent's prefix requires carrying the parent's messages
unchanged. The exposure is **not** silently expanded into the *authorized extraction
source*: a canonical message that consists only of reasoning resolves to
`private_reasoning` and is **never** citable. The reasoning is WIRE-VISIBLE but not an
AUTHORIZED_EXTRACTION_SOURCE.

**The exact trade-off for operator acceptance:** B′ preserves the parent's prefix by
carrying the parent's messages verbatim, which necessarily carries the parent's private
reasoning to the provider. The alternative — dropping the reasoning blocks — would
change the rendered prefix and defeat the purpose. The mitigation is that reasoning is
not an authorized extraction source, so it cannot become published working knowledge.

### C3.3 Observation status

The suffix carries **runtime-owned** observation metadata only:
`<toolCallId> tool=<name> status=succeeded|failed`. The status is the production
`classifyToolResultSuccess` classification (any `success:false`/`isError:true` fails the
whole result; no affirmative success leaves it unverified → not successful). The tool
**output is not copied** into the suffix — the parent projection already carries it, and
the suffix is request-local. A failed observation stays distinguishable from a
successful one.

### C3.4 Truncation

The projection truncates in the MIDDLE (`truncateMiddleByChars`: head + marker + tail),
so decisive evidence can fall out of the middle. The binding compares the canonical
content with the provider-visible content and rejects a reference whose provider-visible
content carries a truncation marker the canonical content did not → `truncated` →
non-authorizing. **No assurance is granted on material the model cannot see.**

### C3.5 The authorized interval

The interval is the compaction decision's own source authority:
`countCanonicalSourceMessages(context.messages)` over
`canonicalSourceMessages(context.messages)`. A canonical reference beyond the interval
is `out_of_interval` **even when it is visible** — data physically visible in the parent
projection is not automatically authorized for extraction. Tested with a bounded
interval over a visible reference.

## C4 — actual tool execution denial

The production composition exercised is:

```text
compaction decision
  -> PCK request construction (the real MessageBuilder projection + the suffix)
  -> isolated inference transport (the real generateSummary, injected at the
     provider-handler boundary)
  -> provider stream parser (the real stream consumption)
  -> PCK result validation (the real runPckAttempt)
  -> publication or rejection (the real publication gate)
```

A syntactically valid checkpoint JSON is injected **alongside** a tool call through the
real provider transport, with the parent's mutation-tool schema advertised:

```text
failureReason             = tool_call_attempted
acceptedRecords           = 0
accepted                  = false
transportInvocations      = 1     <- MEASURED: no tool-driven additional inference
workspaceMutations        = 0     <- MEASURED: the fixture directory is unchanged
approvalEscalations       = 0     <- structural: the branch imports no approval surface
executorInvocations       = 0     <- structural: the branch imports no executor
```

The executor/approval facts are established **structurally** by an import-closure scan
of the three new production modules (zero `executors/`, zero `mcp`, zero `approval`
imports) — supplementary to, not a substitute for, the production-path witness above.
The tool schema carried by the auxiliary request is the **wire triple only**, so the
branch holds no executor to invoke.

## C5 — generation policy

The configured PCK policy (`qwen-strata-v1`) is
`reasoning_effort=none`, `temperature=0.1`, `max_tokens=1024`,
`response_format=json_object`. All four are **generation-side** parameters: none is a
message, so none can change the rendered prompt tokens. The policy is applied to a NEW
configuration and never mutates the shared one, so it cannot leak into the ordinary
request.

**DISPOSITION: the configured PCK inference policy is NOT silently disabled.** It still
applies to the B′ request exactly as it applies to the legacy request. The rendered
message prefix is unchanged by it, and that is captured and asserted.

**A RECORDED FINDING.** The transport's serializer mints a **fresh id and timestamp**
for every rendered message. The message ids are per-request transport artifacts and are
NOT part of the provider's prompt rendering, so the cached prefix is determined by the
**content** — which the assertions pin byte-for-byte.

**What remains uncertain:** whether the provider's engine hashes the tool schema and
the system prompt into the same cache key as the message content. The implementation
preserves BOTH the system prompt and the tool schema verbatim, so it is conservative
under either hashing discipline. The successor must still distinguish **time-to-first-
token** from **actual engine prefill duration**: only the former is observable from this
repository.

**The 180,000 ms deadline is unchanged.** The B′ route uses the same
`resolvePckDeadlineMs()` deadline and the same `createPckAbortHandle` cancellation
authority.

## C6 — conservation and adversarial controls

| Control | Result |
|---|---|
| Feature disabled → legacy PCK conserved | PASS (one message, the closed contract's own system instruction, no tools advertised) |
| Feature enabled and eligible → B′ selected | PASS (the parent's system instruction) |
| Missing parent authority → A selected | PASS (`no_parent_authority`) |
| Missing/ambiguous provenance → A selected | PASS (`no_resolved_bindings`) |
| Parent system prompt and tool schema unchanged | PASS |
| Identical leading serialized messages | PASS (byte-identical) |
| First divergence at the appended suffix | PASS (exactly one message appended, at the tail) |
| Parent branch unchanged after auxiliary completion | PASS (the canonical array is byte-identical; the suffix is absent from the compacted transcript) |
| Unsupported reference rejected | PASS |
| Reference outside the authorized interval rejected | PASS |
| Invisible/ambiguous reference cannot gain publication authority | PASS |
| Private-reasoning-only reference cannot gain publication authority | PASS |
| Failed observation distinguishable from success | PASS (runtime-owned status) |
| Tool-call attempt installs nothing | PASS |
| Stale source-prefix result installs nothing | PASS (pre-existing `stale_source_prefix` path, unchanged) |
| Ordinary parent history unchanged by a failed auxiliary attempt | PASS |
| Fallback selection deterministic and observable | PASS (the route is resolved BEFORE dispatch; the reason is logged) |

**Fallback discipline.** The route is selected **before** the dispatch. An ineligible
B′ never reaches the provider. A failed B′ attempt does **not** launch a second
inference: the attempt budget and the deadline authority are unchanged, and the
transport invocation count is measured at exactly 1.

**Activation authority.** The B′ route is selected by the **runtime**, from the
runtime's own parent projection and the runtime's own bindings. No user text, tool
result or retrieved document can activate it, and no such content can grant tool
authority: the activation is a runtime-owned environment flag plus a runtime-owned
authority object.

## C7 — executable qualification gates

```text
FOCUSED_TESTS:      19/19 PASS (pck-prefix-preserving.test.ts)
AFFECTED_TESTS:     171/171 PASS (the PCK directory)
                    1499/1501 PASS, 2 skipped (src/extensions/context + src/runtime/host)
TYPECHECK:          90 diagnostics == the 90-diagnostic pre-ACT baseline; 0 in
                    ACT-owned files
LINT:               biome check --diagnostic-level=error: clean on every touched file
```

**THE NEGATIVE CONTROL.** The load-bearing implementation was temporarily removed (the
three production files were stashed) and the RED re-run:

```text
R1.1/R1.2  PASS   (the legacy PCK request is independent)
R1.3       PASS   (it does not preserve the parent's leading message sequence)
R1.4       FAIL   (the B' composition is absent)   <- the required RED
```

The implementation was restored, and the RED then passed 3/3. The RED is excluded from
the default suite and is runnable on demand through
`bun run test:red:pck-prefix-preserving`. There are no intentionally failing tests in
the normal suite.

## C8 — live capture readiness

The successor's minimum capture configuration is **existing infrastructure plus ONE
bounded addition**:

| Field | Source |
|---|---|
| run identity | `CLINEMM_PREFIX_FORENSICS=1` — the cohort id |
| session identity | `CLINEMM_PREFIX_FORENSICS=1` — `sessionId` |
| parent request identity | `CLINEMM_PREFIX_FORENSICS=1` — `preparationRequestId` |
| PCK request identity | **NEW** — `providerRequestId` (the transport's own physical request id, `gw_<nanoid>`) |
| compaction decision identity | **NEW** — `decisionId` |
| route | **NEW** — `route` (`b_prime` / `legacy`) |
| route/model identity | `CLINEMM_PREFIX_FORENSICS=1` — `providerId`, `modelId` |
| request purpose | **NEW** — `purpose` (always `pck`) |
| effective generation policy | **NEW** — `inferencePolicyId` |
| input tokens | `CLINEMM_USAGE_OBSERVABILITY=1` — and **NEW** `inputTokens` |
| cache-read tokens | `CLINEMM_USAGE_OBSERVABILITY=1` — and **NEW** `cacheReadTokens` |
| request duration | **NEW** — `durationMs` |
| extraction outcome | **NEW** — `extractionOutcome` |
| publication outcome | **NEW** — `publishedRecordCount` |

The **NEW** fields are produced by `pck-capture.ts`, which is DEFAULT-OFF
(`CLINEMM_PCK_PREFIX_CAPTURE=1`), bounded (every field is a scalar; the record never
carries content, a prompt, a tool argument or a credential), explicitly removable (one
module, one env var) and free of disabled-mode semantic changes (the disabled path
performs no serialization, no hashing and no filesystem access). It joins with the
provider's own captures on the physical provider request id.

**HONESTLY UNOBSERVABLE from this repository:** the **actual engine prefill duration**.
The provider reports time-to-first-token and cache-read tokens; the engine's own
prefill time is a serving-internal fact. The successor must not conflate the two.

## Remaining source-acceptance decisions

1. **Private reasoning on the wire.** B′ carries the parent's private reasoning to the
   provider, because prefix preservation requires carrying the parent's messages
   unchanged. It is excluded from the authorized extraction source, so it cannot become
   published working knowledge. **This requires explicit operator acceptance.**
2. **Coalesced canonical references.** A canonical message the projection merges away
   is `absent` and non-authorizing. The model therefore cannot cite it. If the operator
   wants such content citable, the projection would have to stop dropping the id —
   which is a change to `MessageBuilder`, outside this ACT's scope.
3. **Truncated sources.** A reference whose provider-visible content was truncated is
   non-authorizing. If decisive evidence falls beyond the truncation boundary, that
   request's B′ route yields fewer authorized references — and if it yields none, the
   route falls back to A before dispatch.

## Production source delta

| File | Change |
|---|---|
| `precompaction-knowledge-checkpoint/provider-visible-binding.ts` | NEW — the request-local canonical-reference → provider-visible-position binding. |
| `precompaction-knowledge-checkpoint/prefix-preserving-request.ts` | NEW — the extraction suffix, the composition and the route selection. |
| `precompaction-knowledge-checkpoint/prefix-preserving-route.ts` | NEW — the default-off opt-in and the parent-authority assembly. |
| `precompaction-knowledge-checkpoint/pck-capture.ts` | NEW — the default-off, bounded C8 capture. |
| `precompaction-knowledge-checkpoint/runtime.ts` | The route's request reaches the transport; the attempt is wrapped so the capture observes every outcome; the provider request id and usage are propagated. |
| `extensions/context/compaction.ts` | The parent authority and the capture context are assembled at the activation boundary; the route is selected before dispatch. |
| `extensions/context/summary-generation.ts` | The isolated transport accepts an explicit message array and an explicit tool schema; the physical provider request id is surfaced. |
| `runtime/host/local-runtime-host.ts` | The production host forwards the route's message array and tool schema to the transport. |
| `vitest.config.ts`, `package.json` | The RED witness is excluded from the default suite and is runnable on demand. |

**No ordinary-agent production-semantic change.** The ordinary request, the ordinary
system prompt, the ordinary tool availability and the ordinary compaction are unchanged.

## Verdict

```text
READY_FOR_EXPERIMENTAL_LIVE_QUALIFICATION_PENDING_SOURCE_ACCEPTANCE
```

The production composition is safe and structurally qualified: the required RED is
reproduced, the bounded GREEN passes, the legacy route is conserved, the canonical
history and the parent branch are conserved, and the actual tool execution is denied
at the production boundary with measured (not hardcoded) evidence.

The verdict is **not** `READY_FOR_PCK_PREFIX_PRESERVING_LIVE_QUALIFICATION` because the
bounded source-visibility change — the parent's private reasoning reaching the provider
on the auxiliary request — still requires explicit operator acceptance.

**No prefix-cache improvement and no live PCK quality is claimed from this offline
ACT.** The rendered-token prefix is established at the request-construction and
provider-boundary levels; the actual cache residency and the actual engine prefill
duration are live observations reserved to the successor. The W1 knowledge benchmark
remains the semantic acceptance oracle and was not executed here.
