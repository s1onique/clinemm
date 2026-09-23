# Webview Session List Authority Map — ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01

## 1. The webview state projection call chain

The defect surface is the *webview_state_projection* caller (per
`ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01`
result.json). Its call chain:

```
[webview: state-post flush, every coalesced burst]
        |
        v
[SdkController.getStateToPostToWebview]                  (SdkController.ts:≈5000-5200)
        |
        v
[taskHistory.listHistory({limit:100, hydrate:false})]   (SdkController.ts:5113-5115)
        |
        v
[SdkTaskHistory.listHistory]                              (sdk-task-history.ts:387-431)
        |
        v
[VscodeSessionHost.listHistory]                           (via withHistoryHost)
        |
        v
[ClineCore.listHistory -> listSessionHistory]             (sdk/packages/core/src)
        |
        v
[UnifiedSessionPersistenceService.listSessions]          (sdk/packages/core/src/session/services/persistence-service.ts:507)
        |
        v
[SessionManifestStore.readSessionManifestTitle per row]  (sdk/packages/core/src/session/stores/session-manifest-store.ts:124)
```

A state-post flush debounces to a 50 ms trailing window via
`StatePostDebouncer`; each coalesced flush fires exactly one
`listHistory({hydrate:false})` call.

## 2. The webview-state-projection listHistory call site (load-bearing)

`apps/vscode/src/sdk/SdkController.ts` lines ≈5111-5115:

```ts
const sdkTaskHistory = await withListSessionsCaller(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION, () =>
    this.taskHistory.listHistory({ limit: 100, hydrate: false }),
)
```

This call is unconditional on every state-post flush. There is no
caller-side cache.

## 3. Existing `metadataHistoryCache` in `SdkTaskHistory`

File: `apps/vscode/src/sdk/sdk-task-history.ts`

### 3.1 Cache shape (line 204-208)

```ts
private metadataHistoryCache?: {
    records: SessionHistoryRecord[]
    hostLimit: number
    createdAt: number
}
private readonly metadataHistoryCacheTtlMs = 10_000
```

### 3.2 Cache hit predicate (line 393-400)

```ts
const cached = useCache ? this.metadataHistoryCache : undefined
if (cached && cached.hostLimit >= hostLimit && now - cached.createdAt < this.metadataHistoryCacheTtlMs) {
    const result = cached.records.slice(offset, offset + limit)
    return result
}
```

The predicate is **time-only**: `age < 10s`. There is no dirty bit,
no mutation authority gate. Every TTL window forces one full
rematerialization even when nothing changed.

### 3.3 Cache fill (line 423-428)

After a successful host enumeration, when `useCache === true`, the
merged records are written into the cache with the wall-clock
`createdAt` timestamp.

### 3.4 Cache usage constraint

`canUseMetadataHistoryCache(options)` (line 374-376) returns
`options.hydrate === false`. This means the webview_state_projection
call (`hydrate: false`) IS eligible to use the cache; the only thing
stopping it from being reused is the TTL.

## 4. Existing invalidation / patch hooks in `SdkTaskHistory`

These are the mutation authorities already present (5 sites, all
private to `SdkTaskHistory`):

| Site | Line | Trigger | Effect on cache |
| --- | --- | --- | --- |
| `dispose()` | 322-324 | shutdown | `metadataHistoryCache = undefined` |
| `updateSession()` — write failed | 579 | host.update returned `{updated:false}` | invalidates |
| `updateCachedSessionRecord()` — index === -1 | 356 | updating a sessionId not in cache (e.g. brand-new task) | invalidates |
| `deleteSession()` | 613 | task deleted | invalidates |
| `cacheTaskSize()` | 739 | artifact size back-fill write to host.update | invalidates |

In-place patching (preserves cache, re-sorts):

| Site | Line | Trigger | Effect on cache |
| --- | --- | --- | --- |
| `updateCachedSessionRecord()` — index >= 0 | 358-365 | `updateSession` succeeded and session is in cache | in-place patch + re-sort |

Indirect callers that drive these hooks:

| Caller | Path |
| --- | --- |
| `updateTaskHistoryItem(item)` (line 595) | → `updateSession(item.id, item)` |
| `updateTaskUsage(taskId, usage)` | → `updateSession` → patch |
| `toggleTaskFavorite(...)` | routes through `updateTaskHistoryItem` → `updateSession` → patch |
| `deleteTaskFromState(id)` (line 635) | → `deleteSession` → invalidate |
| `deleteAllTaskHistory(...)` (line 645+) | → `deleteSession` per id → invalidate |

## 5. The listHistory cache cache-hit counts during the LIVE capture

The LIVE capture showed 6 webview_state_projection listSessions
calls in a 30 s window. The cache TTL is 10 s, so this means at
least 3 cache windows elapsed (and possibly 4 if the first projection
landed just after a window boundary). Of those 6 calls, only the
*first* was effectively a "fresh" enumeration; subsequent calls were
TTL-driven re-enumerations despite no mutation.

This matches `6 × 149 = 894` manifest-title reads.

## 6. Other call sites of `taskHistory.listHistory`

| Caller | File:Line | Use of cache | Notes |
| --- | --- | --- | --- |
| `getStateToPostToWebview` (webview flush) | SdkController.ts:5113 | YES (`hydrate:false`) | **the defect site** |
| `getTaskHistory` (gRPC RPC) | SdkController.ts:4438 | YES (`hydrate:false`) | rare; webview mounts History view |
| `deleteTaskFromState` | sdk-task-history.ts:635 → `deleteSession` then re-`listHistory` | YES | delete path |
| `deleteAllTaskHistory` | sdk-task-history.ts:645+ | YES | bulk delete |
| `findHistoryItem` | not listHistory | n/a | single-record path |

The contract is preserved: `getTaskHistory` (the gRPC RPC) and
`getStateToPostToWebview` (the webview flush) both go through the
same cache. Cache reuse benefits both; this is desired and
intentional (per ACT §9 explicit session-list RPC conservation).

## 7. State-post debounce path

`StatePostDebouncer` (50 ms trailing window) coalesces state-post
flushes. It does NOT debounce or batch across the listHistory call
inside `getStateToPostToWebview` — every coalesced flush still
executes one `listHistory`. The repair is at the cache layer, not
the debouncer (per ACT §6: prefer invalidation authority over TTL).

## 8. Existing "dirty" or revision authority?

**None.** The current contract is "fresh if age < 10s". The
invalidation hooks *do* exist (5 sites listed in §4) and they all
correctly clear the cache when they fire; they just don't *extend*
the freshness horizon when nothing mutates. There is no explicit
revision counter or dirty bit.

## 9. Classification

Per ACT §5 candidate repair classes, this is **WR2**:

> **WR2 — cache exists but TTL is sole authority**
>
> Replace time-only validity with:
> `valid until mutation`
> TTL may remain as a safety bound, but it must not be the primary
> correctness authority.

Justification:
- A cache and an invalidation seam both exist.
- Mutation hooks already invalidate correctly when they fire.
- The defect is the time-only contract, not the absence of authority.
- No new dirty-bit is required: the existing
  `invalidateMetadataHistoryCache()` calls ARE the dirty signal.
  When nothing fires, the cache remains.

## 10. Repair design

### 10.1 Single primary change

In `sdk-task-history.ts`, change the cache-hit predicate from:

```ts
if (cached && cached.hostLimit >= hostLimit && now - cached.createdAt < this.metadataHistoryCacheTtlMs) {
```

to (the predicate is structurally identical; the TTL constant is
renamed and lifted from 10 s to a much larger safety bound):

```ts
if (cached && cached.hostLimit >= hostLimit && now - cached.createdAt < this.metadataHistoryCacheSafetyTtlMs) {
```

and rename `metadataHistoryCacheTtlMs` →
`metadataHistoryCacheSafetyTtlMs` with a large value (5 minutes).
The safety TTL's only purpose is to bound memory if a process
somehow never mutates.

**Mutation authority (primary):** the 5 existing
`invalidateMetadataHistoryCache()` call sites in §4 — these are
already correct and authoritative.

### 10.2 Why this satisfies WR2 and not WR1

It is NOT WR1 (existing invalidation hooks mark cache stale) because
the existing contract has the cache **explicitly age-out** as the
primary freshness source. Changing the contract to "mutation
authority invalidates; TTL is only a safety net" is the WR2 path.

### 10.3 Why no new dirty bit is needed

`invalidateMetadataHistoryCache()` already sets
`this.metadataHistoryCache = undefined`. The field's
presence/absence IS the dirty signal. A boolean
`metadataHistoryProjectionDirty` would be redundant.

### 10.4 Why no manifest-title cache

Per ACT §21, manifest caching is forbidden in this ACT. The
`repeatReadsSameSessionId` counter is candidly named and does NOT
establish SL2.

### 10.5 What is NOT touched

- `UnifiedSessionPersistenceService.listSessions()` (sdk packages core)
  — global persistence semantics unchanged.
- `SessionManifestStore.readSessionManifestTitle()` — no mtime/size
  cache added.
- The 5 invalidation call sites — only the TTL value is renamed
  and lifted.
- `getTaskHistory` (gRPC RPC) — passes through the same cache; the
  change preserves its existing semantics (per ACT §9 WVSL-CTL-01).
- `StatePostDebouncer` — untouched; the repair is at the cache.
- `SLAC01` diagnostic, the V8 allocation profiler, the
  `recordReadSessionManifestTitleCall` counter — all permanent.
- AsyncLocalStorage caller-context machinery — untouched.

## 11. Conservation list

| Suite / test | Target |
| --- | --- |
| SLAC01 | 16/16 PASS unchanged |
| ALLOCAUTH01 | 25/25 PASS unchanged |
| BCNT01 | unchanged |
| TQCB01 | unchanged |
| BTCONT01 | unchanged |
| CCARD01 | unchanged |
| existing `sdk-task-history.test.ts` cache tests | extended, not regressed |
| existing `getStateToPostToWebview` projection tests | unchanged |