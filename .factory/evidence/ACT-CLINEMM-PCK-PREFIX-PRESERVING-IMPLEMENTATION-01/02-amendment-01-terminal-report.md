# ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — terminal report

## Identity

```text
ENTRY_HEAD:            01ecefb78ee9562532b203a1dfb7d94388013e19  (= the accepted anchor)
IMPLEMENTATION_HEAD:  the SINGLE commit of this amendment
TRACKED_DIRT:         NONE at entry; the amendment's own files only at exit
```

The accepted anchor is the repository `HEAD` at entry, so there is no
intervening commit. The protected worktrees, the protected stash and the
frozen evidence are conserved. The pre-ACT diagnostic baseline is **90**
`tsc` diagnostics.

## P0 — the publication-authority bypass

### PUBLICATION_AUTHORITY_RED: REPRODUCED

The review's finding was **confirmed by execution, not by inspection**:
`executePckAttempt()` passed `canonicalReferences: observedReferences` — the
CANONICAL set — to the publication gate, so `collectAuthorizedReferences()`
was computed and then never used.

The RED (`pck-publication-authority.red01.test.ts`) drives the **REAL**
production B′ attempt and publication path and injects OTHERWISE ADMISSIBLE
proposals — `model_reported` assurance on the non-deterministically-
establishable atom `IMPLEMENTATION_INSPECTED`, which the canonical
interpreter bounds at `model_reported` and therefore admits — that cite
references the B′ binding EXCLUDES.

Against the unrepaired production code the RED **passed**, i.e. the bypass
existed:

```text
P0.2  the gate ADMITS a proposal citing id:msg_merged_away   -> ADMITTED + INSTALLED
P0.2  the gate ADMITS a proposal citing id:msg_reasoning      -> ADMITTED + INSTALLED
P0.3  a proposal citing BOTH id:msg_task AND id:msg_merged_away -> ADMITTED + INSTALLED
```

The five excluded-reference classes required by the amendment were each
exercised: reasoning-only, merged-away, truncated, out-of-interval and
ambiguous.

### PUBLICATION_AUTHORITY_GREEN: PASS

The repair carries the request-local B′ source binding into the publication
ENFORCEMENT boundary. The gate's membership authority is now the
**effective** authority:

```text
effective = observedReferences                                   (legacy route, unchanged)
effective = authorizedReferences ∩ observedReferences            (B' route)
```

`authorizedReferences` is the intersection of the existing canonical
evidence authority (`collectObservedCanonicalReferences`) with the B′
visible-and-unambiguous source authority, so it can only ever NARROW the
legacy authority. The suffix's binding list is **advisory**; the gate is
the enforcement. The existing canonical interpreter is **not weakened** — it
is given a NARROWED INPUT.

The GREEN companion asserts, through the actual gate:

```text
id:msg_merged_away      -> ZERO admitted, ZERO installed
id:msg_reasoning         -> ZERO admitted, ZERO installed
id:does_not_exist        -> ZERO admitted, ZERO installed
[id:msg_task, id:msg_merged_away] -> ZERO admitted, ZERO installed
                                     (an authorized reference does NOT launder an
                                      unauthorized one)
```

### POSITIVE_PUBLICATION_CONTROL: PASS

A genuinely supported observation — a `tool_observed` claim citing the
authorized tool event — is **admitted and installed** through the actual
publication path. The repair did not over-block.

### NEGATIVE CONTROLS: DETECTED

Removing the load-bearing enforcement change (the `effectiveReferences`
intersection) and re-running the GREEN companion **reproduced the failure**:

```text
P0.2  FAILED   P0.3  FAILED   (P0.1, P1.1, P1.2, P0.4 PASSED)
```

The change was restored and the companion passes 6/6.

## P1 — tool-event provenance

### TOOL_EVENT_PROVENANCE: REPAIRED

`findProviderToolPositions()` collected the invocation and the result into
ONE list, and the caller rejected any reference with more than one position
— so a **normal completed tool event was `ambiguous`** and the decisive
engineering evidence could NEVER be authorized. The RED proved it against
the real `MessageBuilder` projection.

The repair represents the two sides SEPARATELY:

```text
invocation positions (tool_use)   -> counted separately
result positions     (tool_result) -> counted separately
```

- one invocation + one result -> COMPLEMENTARY evidence -> resolved;
- two invocations or two results -> `ambiguous` (a DUPLICATE identity);
- zero invocations -> `absent`;
- zero results -> the invocation is CITABLE, but the RESULT is absent, so
  the binding records no result position and the event cannot authorize an
  observed OUTCOME.

The invocation-only case is enforced through the narrowed canonical view: a
tool result that is not visible is absent from the interpreter's input, so
the existing interpreter cannot establish the outcome.

## AUTHORIZED_INTERVAL_ENFORCEMENT: PASS

The interval is the compaction decision's own source authority
(`countCanonicalSourceMessages` over `canonicalSourceMessages`). A reference
beyond it is `out_of_interval` **even when it is visible** — tested with a
bounded interval over a visible reference (`id:msg_call` at canonical index
2, outside a one-message interval).

## TRUNCATION_AND_COALESCING: PASS

- **Coalescing**: the production projection merges a user message into a
  preceding tool-result message and DROPS the merged message's canonical
  id. The merged reference is `absent` -> non-authorizing. It cannot gain
  authority through another message's id, because the narrowed canonical
  view DROPS the merged message entirely.
- **Truncation**: a reference whose provider-visible content carries a
  truncation marker the canonical content did not is `truncated` ->
  non-authorizing.

## SOURCE COMPLETENESS (P1)

The predecessor's eligibility condition required only ONE resolved
reference. That is insufficient: a resolved USER-message reference is not the
decisive engineering evidence.

The route now requires at least one **authorized tool event** — an event
whose invocation AND result are both provider-visible. When the decisive
evidence is absent or truncated while an unrelated user-message reference
remains resolved, the route selects **A BEFORE the dispatch**
(`no_decisive_evidence`), so the legacy source is preserved rather than
silently degraded, and **no additional inference is issued**.

## REAL_TRANSPORT_WITNESS: PASS

`pck-real-transport.test.ts` drives the **production** composition with an
injected `fetch` returning **synthetic SSE**:

```text
compaction activation
  -> B' selection (the real route)
  -> the actual production summary-generation transport (generateSummary)
  -> the actual provider handler (createHandlerAsync)
  -> an INJECTED fetch
  -> the REAL stream parser (the production `for await` consumer)
  -> the actual PCK publication gate
  -> the actual installation decision
```

The production stream consumer is **not** replaced by a test-owned
consumer; only the HTTP boundary is test-owned. The captured HTTP wire body
is the REAL resolved request.

## TOOL_EXECUTION_DENIAL: PASS

A syntactically valid **mutation** tool call with concrete arguments
(`run_commands` with `{"commands":["rm -rf /workspace"]}`) is injected
alongside otherwise valid checkpoint JSON, with the parent's mutation-tool
schema advertised on the wire:

```text
tool_call_attempted               YES (the transport's usedTools flag)
admitted_records                  0
installed_records                 0
tool_driven_additional_inference  0   (MEASURED: exactly ONE PCK physical request)
```

The executor/approval facts remain structural (the new modules import no
executor, MCP or approval surface), which the amendment permits for
properties that cannot be dynamically observed.

### CANONICAL_HISTORY_CONSERVATION: PASS (repaired)

G8 and G13 now assert the **EXACT canonical history object supplied to
production execution** — the seam accepts a caller-supplied history and
the assertions observe that same object — rather than a separately
constructed fixture. The disconnected workspace assertion was **REMOVED**;
the tool-execution denial is now measured at the real execution boundary.

### LEGACY_CONSERVATION: PASS

The legacy A route's authority is the canonical authority, unchanged. The
effective-authority intersection applies only when the B′ route is selected,
so the legacy path is byte-identical.

## LIVE CAPTURE CORRELATION (P6)

The capture was corrected. Each identity is now DISTINCT, and none
substitutes for another:

| Field | Source |
|---|---|
| `runCohortId` | the SHARED prefix-forensics cohort id (`getPrefixForensicsCohortId()`) — the run identity, and the join with the prefix-forensics capture |
| `sessionId` | the session identity |
| `decisionId` | the compaction decision identity |
| `preparationRequestId` | the CURRENT preparation identity |
| `lastDispatchedRequestId` | **ABSENT** at the PCK boundary, with `lastDispatchedRequestIdAvailable: false`. The absence is preserved; it is never inferred from timestamp proximity. |
| `pckLogicalRequestId` | the PCK LOGICAL request identity |
| `pckPhysicalAttemptId` | the PCK PHYSICAL attempt identity — the join key with the provider's own capture |
| `resolvedInferencePolicyId` | the ACTUAL resolved policy, captured at the policy's OWN resolution boundary (`resolvePckInferencePolicy`), not the selected one |
| `gateAdmittedRecordCount` | the gate's admitted count |
| `installedRecordCount` | the count actually INSTALLED — a DISTINCT field |
| `physicalAttemptCount` | the physical attempt cardinality; the WIRE retry cardinality stays with the provider's own capture |
| `inputTokens` / `cacheReadTokens` | presence semantics: ABSENT means UNKNOWN, `0` means reported zero |

The capture remains DEFAULT-OFF (`CLINEMM_PCK_PREFIX_CAPTURE=1`), bounded
(every field is a scalar; no content, prompt, tool argument or credential),
failure-isolated and removable (one module, one env var). The record is
only CONSTRUCTED when the capture is enabled.

## GENERATION_POLICY_DISPOSITION

The configured `qwen-strata-v1` policy is **KEPT** — no executable
production finding required a bounded correction. The predecessor's
**unsupported assertion** that generation-side settings cannot influence
rendered prompt tokens is **CORRECTED**: reasoning effort and
structured-output settings MAY be consumed by provider-specific rendering
logic. The evidence distinctions are now stated explicitly:

```text
REQUEST_CONFIGURATION:  OBSERVED_AT_PROVIDER_BOUNDARY
MESSAGE_PREFIX:         QUALIFIED_IN_TESTED_SCOPE
HTTP_WIRE_PREFIX:       QUALIFY_WITH_REAL_SERIALIZER
RENDERED_TOKEN_PREFIX:  UNKNOWN
ACTUAL_CACHE_RESIDENCY:  NOT_EXECUTED
ENGINE_PREFILL_DURATION: NOT_EXECUTED
```

JSON equality is **not** substituted for token equality anywhere.

## PROJECTION AUTHORITY (P4)

The suffix's positions are now labelled with their COORDINATE SYSTEM:
`checkpoint projection (MessageBuilder.buildForApi output)`. They are NOT
claimed to be final HTTP-wire or rendered-token positions — the transport's
serializer re-frames the messages (it renders the system prompt as a
separate channel or as `messages[0]`, and it mints a fresh id per rendered
message). The limitation is explicitly classified, not hidden.

## REMAINING_SOURCE_ACCEPTANCE

**Operator acceptance has NOT been granted.** The verdict remains *pending*.

The proposed experimental acceptance is restricted to the same verified
local inference route and requires:

- reasoning remains non-authorizing as extraction evidence — **ESTABLISHED**
  (a reasoning-only reference resolves to `private_reasoning`);
- publication authority is externally enforced — **ESTABLISHED** (the
  effective authority is enforced at the gate, not in the prompt);
- no new external recipient — **ESTABLISHED** (the auxiliary request goes
  to the same provider configuration the checkpoint already used);
- no ordinary-history mutation — **ESTABLISHED** (the exact canonical
  object supplied to production is byte-identical after the attempt);
- no default rollout — **ESTABLISHED** (the route is default-off);
- the W1 knowledge benchmark remains mandatory — **NOT EXECUTED here**.

The private-reasoning **wire exposure** remains a bounded source-acceptance
decision: B′ carries the parent's private reasoning to the provider because
prefix preservation requires carrying the parent's messages unchanged. It is
WIRE-VISIBLE but not an AUTHORIZED_EXTRACTION_SOURCE.

## Gates

```text
FOCUSED_TESTS:       19/19 (prefix-preserving) + 6/6 (publication authority)
                     + 4/4 (real transport) = 29/29
AFFECTED_TESTS:      181/181 (the PCK directory)
                     1509/1511 (extensions/context + runtime/host), 2 skipped
TYPECHECK_DELTA:     0 (90 == the 90-diagnostic pre-ACT baseline)
LINT_DELTA:          0 (biome check --diagnostic-level=error clean)
RED_1 (C1 receipt):  3/3 passed — the B' composition is present
RED_2 (P0 receipt):  3 FAILED — the bypass and the tool-event ambiguity are
                     the observed defects, now repaired
NEGATIVE_CONTROLS:   the P0 enforcement ablation REPRODUCED P0.2/P0.3
```

No intentionally failing tests are in the default suite: both RED files are
excluded from `vitest.config.ts` and are runnable on demand through
`bun run test:red:pck-prefix-preserving` and
`bun run test:red:pck-publication-authority`.

## VERDICT

```text
READY_FOR_EXPERIMENTAL_LIVE_QUALIFICATION_PENDING_SOURCE_ACCEPTANCE
```

The review's blocking finding — the unbound publication authority — is
**confirmed, repaired and qualified**. The tool-event provenance defect and
the source-completeness gap are repaired. The production tool-execution
denial is now witnessed through the real transport, the real provider
handler, the real stream parser and the real installation decision.

The verdict is unchanged in FORM: operator source acceptance has NOT been
granted, so it remains pending. The bounded private-reasoning wire exposure
and the W1 knowledge benchmark are the outstanding acceptance items.

No live inference was executed. No prefix-cache improvement and no live PCK
quality is claimed.
