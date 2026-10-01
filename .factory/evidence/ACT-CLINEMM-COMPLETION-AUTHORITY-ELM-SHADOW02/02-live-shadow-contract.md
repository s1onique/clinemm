# §5–§14 — Live shadow contract (frozen)

This document freezes the bounded implementation contract for SHADOW02.
Any drift from this contract during §17 (GREEN implementation) is a
scope violation and must be reflected here first.

## Source of truth

- Live factual record type: `ContinuationCardinalityAuthorityRecord` from
  `apps/vscode/src/sdk/continuation-cardinality-authority.ts`.
- Adapter (must be reused as-is, no shadow-side mapping):
  `adaptRecord(record)` from
  `apps/vscode/src/sdk/completion-authority-elm-replay.ts`.
- Kernel loader (must be reused as-is): `loadKernel(kernelPath)` from
  `apps/vscode/src/sdk/completion-authority-elm-replay.kernel.ts`.

## Surface (new files only)

```
apps/vscode/src/sdk/completion-authority-elm-shadow.ts
apps/vscode/src/sdk/completion-authority-elm-shadow-runtime.ts
apps/vscode/src/sdk/__tests__/completion-authority-elm-shadow02.test.ts
```

## Bounded modifications to existing files

1. `apps/vscode/src/sdk/continuation-cardinality-authority.ts` —
   restructure the early-return at line 251 to also exit when no
   shadow wants the record. After construction, fire
   `observeElmShadowFireAndForget(rec)` BEFORE returning. The shadow
   sees the SAME record the CCARD ring sees, in the same order.

2. `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` — add
   `applyElmShadowDiagnosticProfile(env)` resolver. Mirrors the
   `applyContinuationCardinalityAuthorityDiagnosticProfile` shape.
   There is NO env override matrix; the resolver reads
   `CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW` (=1/true/yes → ON;
   otherwise OFF). The kernel path is resolved by the caller
   (`extension.ts:activate`) and passed to the resolver.

3. `apps/vscode/src/extension.ts` — call

## Default-off contract

`setElmShadowEnabled(false)` is the default. The helper
`setElmShadowEnabled` records the kernel path lazily: it does NOT
load the bundle, does NOT call `Elm.Main.init`, does NOT construct
the per-session map. When disabled:

- `observeElmShadowFireAndForget` returns immediately.
- `getElmShadowRing()` returns `[]`.
- No port sends occur.
- No outbound port is subscribed.

## Authority firewall (zero callbacks)

The shadow runtime has NO outbound channel to production code. There
is no callback into the queue, presentation, CommandJobManager,
PendingPromptsController, the CCARD ring, the counters, or any TS
production state.

There is no `if (elm.violation) ...` branch anywhere in production
code. The shadow output is appended to the bounded ring and dumped
to disk; nothing else.

## Session isolation

- One `ShadowKernelSession` per `sessionId`.
- Each session owns: one `KernelHandle`, one outbound queue (FIFO of
  `KernelOutbound`), one snapshot of the latest model, one set of
  diagnostic counters for that session.
- A global cache of the compiled bundle is fine. A global Elm MODEL
  is NOT — `loadKernel` is called once per session.

## Ordering (FIFO per session)

The shadow runtime serializes inbound sends per session. When the
runtime processes one CCARD record:

1. Identify the session (by `sessionId`, fallback `taskId`).
2. Get or create the per-session `ShadowKernelSession`.
3. Push the record to the per-session FIFO queue.
4. Drive the FIFO: pop one record, call `adaptRecord`, if DIRECT
   send to `ports.inbound.send`, await one microtask, drain one
   `state`/`decode_error` outbound, append to the bounded ring.
5. Repeat until FIFO empty for this scheduling tick.

This guarantees per-session ordering. Two sessions interleaved at
the CCARD source are correctly ordered because each session has its
own FIFO and its own kernel.

The runtime is invoked fire-and-forget from

## Fail-open

If `loadKernel`, `adaptRecord`, `ports.inbound.send`, or
`drainOutbound` throws, the shadow session becomes `failed` and a
row is appended to the ring with `elmOutputKind: "kernel_error"` or
`"decode_error"`. Subsequent records for that session are still
appended (with `elmOutputKind: null`,
`reason: "shadow_disabled_after_kernel_failure"`) but no further
`inbound.send` occurs.

If the runtime itself fails to initialize (env parse error, kernel
path missing), the global shadow is `disabled` and
`setElmShadowEnabled` is called with `enabled=false`. Subsequent
events are no-ops.

No retry loops. No sleeps. No production exception propagation.

## Diagnostic output schema

Each row in `completion-authority-elm-shadow.jsonl` is one JSON
object:

```json
{
  "at": 1790840000000,
  "sessionId": "1790809530345_lrsk9",
  "sourceSeq": 7,
  "sourceStage": "submit_and_exit_seen",
  "adapterStatus": "DIRECT",
  "reason": "mapped to submit_and_exit_seen",
  "elmMsg": { "tag": "submit_and_exit_seen", "submitId": "submit-..." },
  "elmOutputKind": "state",
  "violation": null,
  "model": { "task": "active", ... }
}
```

For `INSUFFICIENT_IDENTITY` / `UNMODELED_EVENT`:

```json
{
  "at": 1790840000000,
  "sessionId": "...",
  "sourceSeq": 4,
  "sourceStage": "terminal_committed",
  "adapterStatus": "INSUFFICIENT_IDENTITY",
  "reason": "terminal_committed terminalKind=undefined is not Elm TerminalKind enum",
  "elmOutputKind": null,
  "violation": null,
  "model": null
}
```

For `decode_error`:

```json
{
  "at": 1790840000000,
  "sessionId": "...",
  "sourceSeq": 5,
  "sourceStage": "run_turn_started",
  "adapterStatus": "DIRECT",
  "elmMsg": { "tag": "run_started", ... },
  "elmOutputKind": "decode_error",
  "error": "Problem with the given value: ...",
  "violation": null,
  "model": null
}
```

## Conservation matrix

| Property | Status |
|----------|--------|
| `TS_COMPLETION_AUTHORITY_CHANGED` | `false` |
| `QUEUE_SEMANTICS_CHANGED` | `false` |
| `PRESENTATION_SEMANTICS_CHANGED` | `false` |
| `TASK_LIFECYCLE_SEMANTICS_CHANGED` | `false` |
| `CCARD_FACTUAL_SCHEMA_CHANGED` | `false` |
| `MCP_CODE_CHANGED` | `false` |
| `MYC_CODE_CHANGED` | `false` |
| `REACT_CODE_CHANGED` | `false` |
| `ELM_SOURCE_CHANGED` | `false` |
| `ELM_AUTHORITY_SEMANTICS_CHANGED` | `false` |
| `ELM_SHADOW_RUNTIME_ADDED` | `true` |
| `ELM_SHADOW_DEFAULT_OFF` | `true` |
| `MANUFACTURED_IDENTITY_COUNT` | `0` |
| `ORIGIN_REWRITE_COUNT` | `0` |

`captureContinuationCardinalityAuthorityRecord` via
`queueMicrotask(() => runtime.observe(...))` so the production call
returns immediately. The runtime then processes the FIFO on its own
tick. This proves §22 (non-blocking).

   `applyElmShadowDiagnosticProfile(process.env)` BEFORE SdkController
   construction, sibling to line 258. Register the dump command
   sibling to line 990.

4. `apps/vscode/src/registry.ts` — add
   `DumpCompletionAuthorityElmShadow` registry entry, sibling to
   line 113.

5. `apps/vscode/package.json` — add the dump command declaration.

No other production files are modified.
