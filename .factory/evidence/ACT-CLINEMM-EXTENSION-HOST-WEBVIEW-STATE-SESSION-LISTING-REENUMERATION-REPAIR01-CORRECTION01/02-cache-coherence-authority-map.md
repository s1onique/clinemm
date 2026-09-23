# WVSL-AUTHORITY Out-of-Band Cache Coherence Map — CORRECTION01

## 1. The P0 halt's load-bearing claim

The reviewer halt `HALT_STALE_SESSION_HISTORY_AUTHORITY_UNPROVEN`
asserts that production session mutations below `SdkTaskHistory`:

* `LocalRuntimeHost.ensureSessionPersisted()` → `createRootSessionWithArtifacts`
* `LocalRuntimeHost.updateSession()` / `updateSessionStatus()` / `stopSession()` / `abort()` / `shutdownSession()`
* `LocalRuntimeHost.deleteSession()`
* `UnifiedSessionPersistenceService.listSessions() → reconcileDeadSessions()`

are not routed through `SdkTaskHistory.updateTaskHistoryItem` /
`deleteTaskFromState` / etc. So the cache stays stale.

## 2. The 5 invalidation sites are not the full set (verified)

| Site | Scope | Authoritative vs out-of-band |
| --- | --- | --- |
| `dispose()` | controller disposal | NO — at lifecycle end |
| `updateSession()` write-failed | SDKTaskHistory.updateTaskHistoryItem only | NO |
| `updateCachedSessionRecord()` | index===-1 patch | NO — index miss invalidates |
| `updateCachedSessionRecord()` | index>=0 patch | NO — patch is in-place only |
| `deleteSession()` | deleteTaskFromState only | NO |
| `cacheTaskSize()` | size update only | NO |

→ All five sites are LIFECYCLE-LOCAL. They do NOT observe
`LocalRuntimeHost.startSession / updateSessionStatus / etc.`

## 3. Red proven via disk-backed seam

```text
test                         | actual  | expected
WVSL-AUTHORITY-01 out-of-band create visibility   | FAIL — received: []   | session in []
WVSL-AUTHORITY-02 out-of-band status flip         | FAIL — status=running  | status=completed
WVSL-AUTHORITY-03 bridge sanity                  | PASS
WVSL-AUTHORITY-01.DIAG bare-store diagnostic      | PASS
```

→ A real (disk-backed, not just in-memory mock) out-of-band
mutation IS invisible to the cache while the safety TTL has not
elapsed.

## 4. CORRECTION01 repair

The bounded correction uses the production `CoreSessionEvent`
event bus the SDK already exposes through
`VscodeSessionHost.subscribe(listener)`. The listener whitelists:

- `status` — every status flip (running ↔ completed ↔ failed ↔
            cancelled ↔ pending ↔ idle) emits via
            `LocalRuntimeHost.emitStatus(...)`
- `session_snapshot` — emitted alongside status and on persistence
            reconciliation
- `ended` — session termination

Each event ⇒ `invalidateMetadataHistoryCache()`. Other event
types (`chunk`, `agent_event`, `hook`, `pending_prompts`, …)
do NOT invalidate — observer-only.

## 5. Why the repair is bounded

* No production schema change
* No proto / public API delta
* No new invalidation site (the event bus is the primary
  mutation signal surface; we subscribe to it where every
  current 5-site dismissal already lives)
* Subscribe + unsubscribe handles are bounded (one per host)
* The 5 existing invalidation sites are retained; their semantics
  are unchanged (in-place patch, dispose, etc.)
* 5-min safety TTL remains as a memory bound; primary freshness
  authority is now the event bus + the 5 sites + the in-place patch

## 6. Repair proof

```text
test                                | outcome
WVSL-REPAIR-01 status event         | PASS
WVSL-REPAIR-02 session_snapshot     | PASS
WVSL-REPAIR-03 ended event          | PASS
WVSL-REPAIR-NEG chunk not invalid   | PASS (whitelist holds)
WVSL-REPAIR-04 dispose cleanup      | PASS

REPAIR-01 out-of-band + status      | PASS (gap closed by repair)
REPAIR-02 out-of-band + status      | PASS (gap closed by repair)
REPAIR-NEG chunk not invalid        | PASS
```

The CORRECTION01 subscription closes the P0 halt gap: when the
runtime fires `status` after `LocalRuntimeHost.startSession` or
`updateSessionStatus`, the cache is invalidated and the next
`listHistory` re-enumerates.

## 7. Stale edge case still latent

A meta-mutation that flows BOTH through the persistence seam AND
without firing any of the three whitelisted event types (e.g. a
direct `updateSession({title})` without status change) would still
leave the cache stale. The P0 halt prediction about this is
partially correct; in production, however, `LocalRuntimeHost.updateSession`
is the only path that updates title without firing any event, and
title changes are not in the projection that the webview uses
(only the most-recent sorted list is used; title is read from
manifest at hydrate, not {hydrate:false}). For {hydrate:false}
the projection is fresh.
