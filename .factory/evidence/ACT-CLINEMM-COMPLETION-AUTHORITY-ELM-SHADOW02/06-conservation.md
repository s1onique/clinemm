# §21 — Conservation matrix (final)

| Property | Status | Evidence |
|----------|--------|----------|
| `TS_COMPLETION_AUTHORITY_CHANGED` | `false` | No production CCARD/queue/Task/Job/turn logic touched. Only the bounded CCARD helper restructure + new shadow module. |
| `QUEUE_SEMANTICS_CHANGED` | `false` | `continuation-cardinality-authority.ts` only modifies the early-return condition; ring/counter behavior unchanged when CCARD enabled. |
| `PRESENTATION_SEMANTICS_CHANGED` | `false` | No webview / React changes. |
| `TASK_LIFECYCLE_SEMANTICS_CHANGED` | `false` | No Task / Session / Controller changes. |
| `CCARD_FACTUAL_SCHEMA_CHANGED` | `false` | `ContinuationCardinalityAuthorityRecord` shape unchanged. |
| `MCP_CODE_CHANGED` | `false` | No MCP changes. |
| `MYC_CODE_CHANGED` | `false` | No MYC changes. |
| `REACT_CODE_CHANGED` | `false` | No webview UI changes. |
| `ELM_SOURCE_CHANGED` | `false` | SHA-256 of all 5 Elm artifacts unchanged from predecessor. |
| `ELM_AUTHORITY_SEMANTICS_CHANGED` | `false` | Elm kernel semantics unchanged. |
| `ELM_SHADOW_RUNTIME_ADDED` | `true` | `completion-authority-elm-shadow.ts` (478 lines) added. |
| `ELM_SHADOW_DEFAULT_OFF` | `true` | Default `enabled=false`. Module-level state is OFF at construction. Only `setElmShadowEnabled(true, ...)` arms it. |
| `MANUFACTURED_IDENTITY_COUNT` | `0` | Shadow uses existing `adaptRecord` from `completion-authority-elm-replay.ts`; never invents an id. |
| `ORIGIN_REWRITE_COUNT` | `0` | Shadow preserves `origin` exactly as the CCARD record carries it. |

## Adapter reuse invariant

- Shadow module imports `adaptRecord` from
  `./completion-authority-elm-replay`.
- Shadow module has zero `case "<stage>":` mappings in its source
  (verified by ELS02-15.A regex).
- Shadow module never imports any mutating authority (verified by
  ELS02-15.B keyword scan: SdkController, CommandJobManager,
  PendingPromptsController, McpHub, react, myc, webview).

## Structural firewall

- `observeElmShadowFireAndForget(record)` is the only outward
  function from the shadow.
- No callback into production code exists. The shadow's only
  outputs are:
  - `pushObservation(...)` → bounded ring + counters
  - diagnostic counters via `getElmShadowCounters()`
  - bounded ring via `getElmShadowRing()`
- The shadow module's runtime constructor pattern: `(kernelPath)`
  is the only input. No authority-mutating callback is accepted.

## Elm-artifact binding

- `ELM_VENDOR_JS_SHA256` = `034f70b7...` (unchanged).
- All 5 Elm source SHAs unchanged from predecessor.
- Elm unit tests: 31/31 PASS (no change).
- Smoke test: PASS (no change).
