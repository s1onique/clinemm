# Counter Contract — ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01

## 1. Module under contract

`apps/vscode/src/sdk/session-listing-allocation-diagnostic.ts`

## 2. Public surface

The diagnostic exposes exactly six (6) increment functions, three (3)
lifecycle functions, one (1) snapshot function, one (1) test reset,
and one (1) boolean predicate. Every hot-path increment returns
immediately when the diagnostic is disabled (single boolean check).

| Function | Effect on hot path | Allocation cost when disabled |
| --- | --- | --- |
| `recordListSessionsCall(caller)` | `number++` on two counters | one boolean check (returns immediately) |
| `recordReadSessionManifestTitleCall(sessionId, returnedTitle)` | `number++` on three counters + one `Set.has/add` | one boolean check |
| `recordQueryAllCall()` | `number++` | one boolean check |
| `recordSessionSetVersionChange()` | `number++` | one boolean check |
| `recordManifestIdentityChange()` | `number++` | one boolean check |
| `enableSessionListingCausality()` | flip `_enabled = true` | not on hot path |
| `disableSessionListingCausality()` | flip `_enabled = false` | not on hot path |
| `resetSessionListingCausalityCounters()` | replace `_counters` + clear Set | not on hot path |
| `isSessionListingCausalityEnabled()` | read `_enabled` | not on hot path |
| `materializeSessionListingCausalitySnapshot()` | build fresh object (cold) | not on hot path |
| `callerClassName(cls)` | static switch | not on hot path |
| `__resetSessionListingCausalityForTests()` | test reset | not on hot path |
## 3. Caller-class taxonomy (frozen enum)

```ts
export const SessionListingCallerClass = {
    WEBVIEW_STATE_PROJECTION: 0,
    SESSION_LIST_RPC: 1,
    SESSION_CREATED_REFRESH: 2,
    SESSION_DELETED_REFRESH: 3,
    TASK_EVENT_REFRESH: 4,
    UNKNOWN: 99,
} as const
```

Each caller class corresponds to one explicit production call site:

| Class | Production wiring |
| --- | --- |
| `WEBVIEW_STATE_PROJECTION` | `SdkController.getStateToPostToWebview` → `taskHistory.listHistory` (every flush). |
| `SESSION_LIST_RPC` | `SdkController.getTaskHistory` (the gRPC `TaskService.GetTaskHistory` handler). |
| `SESSION_CREATED_REFRESH` | Reserved for explicit post-creation refresh hook (successor ACT). |
| `SESSION_DELETED_REFRESH` | Reserved for explicit post-deletion refresh hook (successor ACT). |
| `TASK_EVENT_REFRESH` | Reserved for explicit task-event-driven refresh hook (successor ACT). |
| `UNKNOWN` | Used when the call site has not been classified. Diagnostic MUST remain fail-loud at classify time. |

## 4. Counter payload (snapshot JSON)

```json
{
  "enabled": true,
  "listSessionsCalls": 0,
  "queryAllCalls": 0,
  "readSessionManifestTitleCalls": 0,
  "uniqueManifestIds": 0,
  "repeatedManifestReads": 0,
  "byCaller": {
    "webview_state_projection": 0,
    "session_list_rpc": 0,
    "session_created_refresh": 0,
    "session_deleted_refresh": 0,
    "task_event_refresh": 0,
    "unknown": 0
  },
  "sessionSetVersionChanges": 0,
  "manifestIdentityChanges": 0,
  "manifestReadsWithoutTitle": 0
}
```

## 5. Lifecycle wiring (per ACT §14)

| Profiler state | Diagnostic state |
| --- | --- |
| `disabled` | `_enabled = false` (default) |
| `armed` | `_enabled = false` (no recording yet) |
| `starting` (trigger() accepted) | `_enabled = true` + counters reset |
| `active` | recording |
| `stopping` | recording stops on `stopSampling` |
## 6. Counter enablement (per ACT §12)

Counter recording is **off** when:
- `CLINEMM_DIAG_ALLOCATION_PROFILE != 1`, OR
- `CLINEMM_RUNTIME_PROFILE != "dogfood"`, OR
- The allocation profiler state is not in `[starting, active, stopping]`.

The diagnostic does NOT introduce a separate env knob (per ACT §12).

## 7. Integration with allocation checkpoints (per ACT §13)

The snapshot is added to the existing `meta.json` payload via a small
additive change to `extension-host-allocation-profiler.ts`:

```json
{
    "session_listing_causality": { ... snapshot ... }
}
```

The snapshot is materialized ONLY during the existing 2-second
checkpoint (cold path), not on every event.

## 8. Production hot-path counter increments

Production call sites that increment counters:

| Function | File | Counter |
| --- | --- | --- |
| `UnifiedSessionPersistenceService.listSessions` | `sdk/packages/core/src/session/services/persistence-service.ts:507` | `listSessionsCalls`, `listSessionsByCaller[caller]` |
| `UnifiedSessionPersistenceService.reconcileDeadSessions` | `sdk/packages/core/src/session/services/persistence-service.ts:534` | `queryAllCalls` (×3 per call) |
| `SessionManifestStore.readSessionManifestTitle` | `sdk/packages/core/src/session/stores/session-manifest-store.ts:124` | `readSessionManifestTitleCalls`, `uniqueManifestPathsSeen`, `repeatedManifestReads`, `manifestReadsWithoutTitle` |

The counter increments are wired through a small production-side
`SessionListingDiagnosticSink` interface that the extension host
installs at wiring time. When the sink is `undefined` (default), the
production methods incur ONE additional `undefined`-check + nothing
else.

## 9. Caller class hooks (per ACT §11)

The two production entry points in the extension host that reach
`listSessions` MUST pass an explicit caller class:

1. `SdkController.getStateToPostToWebview` (line 5101):
   passes `WEBVIEW_STATE_PROJECTION`.
2. `SdkController.getTaskHistory` (line 4432):
   passes `SESSION_LIST_RPC`.

No `Error().stack`. No `caller` lookup table. Both are static,
explicitly typed, and audited by the focused test
`SLAC-CTL-{01..04}`.

## 10. Identity hashing (per ACT §10)

The sessionId is hashed once per (sessionId, captureWindow) using
`sha256(sessionId).slice(0, 16)` — a 32-hex-char truncated hash. The
**full sessionId is never recorded**. The full filesystem path is
never recorded.

This bounds the diagnostic to a single 32-hex-char string per distinct
session manifest, avoiding sensitive diagnostic output (per ACT §9).

## 11. Forbidden hot-path constructs

Per ACT §19, the following are FORBIDDEN inside any of the increment
functions:

- `JSON.stringify`
- `Logger.log`
- `new Error().stack`
- `Array.push` per operation
- `Map snapshot copy`
- File write
- `crypto hash per invocation` (allowed ONLY because it is cached
  in the Set; first call hashes, subsequent calls hit the Set)

## 12. Test seam

`__resetSessionListingCausalityForTests()` resets `_enabled`, the
counters, and the identity Set. Tests use this in `beforeEach` to
guarantee isolation.
| `finalized` / `failed` | `_enabled = false` |

The wiring is installed at extension-host activation time (sibling to
the existing EHLOOP01/ALLOC-AUTH activation). The wiring:

1. **At activation** (dogfood + env opt-in ONLY): install lifecycle
   hooks so the diagnostic is enabled/disabled with the profiler.
2. **At trigger()**: enable the diagnostic AND reset counters.
3. **At every 2-second checkpoint**: materialize the snapshot and
   embed it in `latest.meta.json` / `final-*.meta.json` via a new
   `session_listing_causality` field.
4. **At finalization**: disable the diagnostic.