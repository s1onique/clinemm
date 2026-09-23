# Session Listing Production Map — ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01

## 1. The dominant allocation owner observed in the LIVE capture

The frozen LIVE allocation checkpoint showed a dominant `listSessions`
subtree (≈ 21.3 % of the entire captured sampled allocation) plus
`readSessionManifestTitle` (~3.85 MiB major leaf) and `Buffer.toString`
(~5.20 MiB). Both names trace back to the same production seam — the
SDK `listSessions` implementation in `sdk/packages/core` and its title
helper — but the production entry point that reaches them is on the
extension host side.

## 2. Production `listSessions` implementations

### 2.1 `UnifiedSessionPersistenceService.listSessions`

- File: `sdk/packages/core/src/session/services/persistence-service.ts:507-532`
- One-line purpose: list up to N most-recent session rows from the
  sqlite-backed persistence adapter, then **fans out one async
  manifest-title read per row**:
  ```ts
  const manifestTitles = await Promise.all(
      rows.map((row) =>
          this.manifestStore.readSessionManifestTitle(row.sessionId),
      ),
  );
  ```
- This is the seam the V8 profile attribute name `listSessions` matches.
  It is the only place in `sdk/packages/core` that calls
  `readSessionManifestTitle` for every returned row.
- It also calls `reconcileDeadSessions(scanLimit)` before enumerating —
  another production-only allocation path that fires whenever this
  method is invoked.

### 2.2 `LocalRuntimeHost.listSessions`

- File: `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1513-1524`
- One-line purpose: thin wrapper that calls `listRows(limit)` (the
  `invoke("listSessions", ...)` bridge into the worker) and projects
  the rows. **Does NOT call `readSessionManifestTitle` itself** — the
  title fan-out happens further up the chain (see 2.1 / 2.3).

### 2.3 `listSessionHistory` (projecting wrapper)

- File: `sdk/packages/core/src/runtime/host/history.ts:434-465`
- One-line purpose: walks the host's `listSessions`, then optionally
  merges manifest-history fallback rows and hydrates (calls
  `readSessionMessages` per row when `hydrate !== false`).
- This is the production-side entry point the extension host actually
  uses for any webview-visible history (see §3).
## 3. The actual production call chain (extension host → listSessions)

The complete chain from webview-visible state to
`UnifiedSessionPersistenceService.listSessions` is:

```
[webview: HistoryView / ChatView / etc.]
        |
        v
[gRPC: TaskService.GetTaskHistory]
        |
        v
[apps/vscode/src/core/controller/task/getTaskHistory.ts]    (thin delegate)
        |
        v
[apps/vscode/src/sdk/SdkController.getTaskHistory]          (SdkController.ts:4427)
        |
        v
[apps/vscode/src/sdk/SdkTaskHistory.listHistory]            (sdk-task-history.ts:389)
        |             uses cached-host when present, else spins up a VscodeSessionHost
        v
[apps/vscode/src/sdk/vscode-session-host.ts] (VscodeSessionHost.list)
        |
        v
[@cline/core: ClineCore.listHistory / list]                 (sdk/packages/core/src/ClineCore.ts:441/462)
        |
        v
[listSessionHistory]                                         (sdk/packages/core/src/runtime/host/history.ts:434)
        |
        v
[listHostSessionRows -> host.listSessions]                   (history.ts:186)
        |
        v
[LocalRuntimeHost.listSessions -> listRows -> invoke("listSessions", ...)]
## 5. The actual call-site topology that drives `listSessions` on the extension host

`SdkController.getStateToPostToWebview` is called by every state-post
flush and reads `taskHistory.listHistory({ limit: 100, hydrate: false })`
**unconditionally on every flush**. That call path is the only one
the extension host exercises in the long-horizon workload
characterized by the failing LIVE capture.

There is exactly ONE other production call site of `listHistory` in
the extension host:
- `SdkController.getTaskHistory(request)` — the `TaskService.GetTaskHistory`
  gRPC handler. This is invoked only when the webview mounts the
  History view, NOT on every state post.

So:

| Caller | Frequency in long-horizon workload | Counts toward `listSessions` |
| --- | --- | --- |
| `getStateToPostToWebview` (`taskHistory.listHistory({limit:100})`) | once per flushed state post (debounced to a 50 ms trailing window per `StatePostDebouncer`) | YES — every flush |
| `getTaskHistory` (`taskHistory.listHistory({limit:51, ...})`) | when the History view mounts / refreshes | YES — but rare |

The existing debounce window in `StatePostDebouncer` is 50 ms
trailing. During streaming it does coalesce bursts but each coalesced
flush still issues one `listHistory` call.

## 6. `SdkTaskHistory.listHistory` (the cache layer)

File: `apps/vscode/src/sdk/sdk-task-history.ts:389-446`

The cache is **already present** for `hydrate === false` calls:

```ts
private metadataHistoryCache?: {
    records: SessionHistoryRecord[]
    hostLimit: number
    createdAt: number
}

private readonly metadataHistoryCacheTtlMs = 10_000

private canUseMetadataHistoryCache(options): boolean {
    return options.hydrate === false
}
```

and:

```ts
if (cached && cached.hostLimit >= hostLimit
## 7. `Buffer.toString` ownership

`Buffer.toString` appears in the profile with ≈ 5.20 MiB. On the
production chain, `Buffer.toString` is invoked:

- Inside `readSessionManifestTitle` (implicit `Buffer.toString("utf8")`
  when `readFile(path, "utf8")` decodes the bytes to a string before
  `JSON.parse`).
- Inside the `reconcileDeadSessions` pass (when scanning `idle`,
  `running`, `pending` status buckets).
- Inside `JSON.parse` itself for very large manifests.

So the `Buffer.toString` attribution is fully owned by the
`listSessions`/`readSessionManifestTitle` subtree — it is **NOT a
separate root cause**.

## 8. No existing per-call debounce/cache/memoization on `listSessions`

- `UnifiedSessionPersistenceService.listSessions` does NOT memoize
  results.
- `SessionManifestStore` does NOT cache the parsed manifest OR its
  title.
- The only cache layer is `SdkTaskHistory.metadataHistoryCache` (10 s,
  `hydrate:false` only), which lives above the production `listSessions`
  call and is invalidated by usage updates.

## 9. `queryAll` appearance in the captured ancestry

The ACT brief mentions `queryAll` in the captured ancestry. The
production code does not expose a function literally named `queryAll`,
but the underlying operation matches the sqlite adapter's
`listSessions` path — it is the `SELECT ... FROM sessions ORDER BY
started_at DESC LIMIT N` (or equivalent) executed by the persistence
adapter. The `queryAll` attribution in the V8 profile corresponds to
the V8 engine's internal C++ call site for that query path, surfaced
as a stack frame.

## 10. Webview/state paths that can request session lists

| Path | Production wiring | Frequency |
| --- | --- | --- |
| State publication | `SdkController.getStateToPostToWebview` → `taskHistory.listHistory({limit:100, hydrate:false})` | every flush |
| History view mount | `TaskService.GetTaskHistory` → `controller.getTaskHistory` → `taskHistory.listHistory({limit:51, ...})` | webview-driven, rare |
| Hub RPC `session.list` | not invoked from the extension host (the local runtime bypasses the hub) | n/a |
| Direct `ClineCore.list()` | not invoked from the extension host (CLI-only path) | n/a |

## 11. Invalidation authority already present

`SdkTaskHistory` invalidates `metadataHistoryCache` in two places:

- `invalidateMetadataHistoryCache()` — called from `updateTaskHistory`,
  `updateTaskUsage`, and the `dispose` path.
- TTL expiry (`now - cached.createdAt >= 10_000 ms`).

There is no upstream invalidation authority for the underlying
`listSessions` call — every cache miss re-enumerates the canonical
adapter.

## 12. Summary — what recon proved

1. The LIVE profile's `listSessions` subtree is the SDK's
   `UnifiedSessionPersistenceService.listSessions` reached through
   `getStateToPostToWebview` (every state flush) and through
   `getTaskHistory` (webview History mount).
2. `readSessionManifestTitle` is called ONCE per returned row inside
   that wrapper — it is not separately cached or debounced.
3. Title resolution is **eager, per enumeration, with no mtime / size
   discriminator** — every call re-reads every manifest file.
4. The existing `metadataHistoryCache` (10 s, `hydrate:false` only)
   amortizes SOME of the load but is invalidated aggressively and is
   too short to amortize the 30-second workload window.
5. `Buffer.toString` is owned by the same subtree — there is no
   independent root cause to investigate.
6. The captured `queryAll` frame corresponds to the adapter's
   sqlite query path invoked from `listSessions`.

This recon satisfies the ACT §6 requirement of producing the
production map BEFORE any counter-only instrumentation is added.
    && now - cached.createdAt < this.metadataHistoryCacheTtlMs) {
    const result = cached.records.slice(offset, offset + limit)
    return result
}
```

Implications for the cardinality investigation:

- `getStateToPostToWebview` calls with `hydrate: false`, so it can
  hit the 10-second cache.
- `getTaskHistory` also calls with `hydrate: false`, so it ALSO can
  hit the cache.
- HOWEVER, the cache is invalidated eagerly:
  - `invalidateMetadataHistoryCache()` is called from `updateTaskHistory`
    and `updateTaskUsage`.
  - Cache lifetime is 10 s; during a long-horizon workload the
    streaming turn will invalidate it many times (each tool result
    that updates usage triggers a `postStateToWebview` AND an
    `updateTaskUsage` → cache wipe).
  - The cache TTL of 10 s is much shorter than the 30-second workload
    window, so it does NOT amortize the entire window.

This means the **dominant load on `listSessions` is NOT amortized by
the existing cache during the long-horizon workload**. Every flush
that follows a usage update will bypass the cache and re-enumerate.
                                                              (local-runtime-host.ts:1513 / 2983)
        |
        v
[UnifiedSessionPersistenceService.listSessions]              (persistence-service.ts:507)
        |
        +-- reconcileDeadSessions(scanLimit)                  (persistence-service.ts:534)
        |
        +-- adapter.listSessions({ limit: scanLimit })       (sqlite-backed adapter)
        |
        +-- Promise.all(rows.map(manifestStore.readSessionManifestTitle))
                                                              (session-manifest-store.ts:124)
                  |
                  v
             readFile + JSON.parse + metadata.title pull
             (the dominant readSessionManifestTitle leaf)
```

Every call to `UnifiedSessionPersistenceService.listSessions` triggers:

1. ONE `adapter.listSessions(scanLimit)` call to the persistence adapter,
2. ONE `reconcileDeadSessions(scanLimit)` pre-pass (which itself issues
   THREE `adapter.listSessions` calls — one per non-terminal status
   bucket),
3. ONE `manifestStore.readSessionManifestTitle` async call per returned
   row (`Promise.all`), each of which `await readFile` + `JSON.parse`
   + a single property pull.

So under the profiled leaf names: `listSessions` (the wrapper that
calls Promise.all on N row titles), `readSessionManifestTitle` (the
per-row async reader), `Buffer.toString` (the implicit utf8 decoder
that `readFile(path, "utf8")` performs), and the anonymous extension.js
frames are all the SAME chain viewed from different levels.

## 4. Title resolution cadence (lazy / per session / per enumeration / eager / conditional)

The production path is:

- **Per enumeration** (every `listSessions` call reads every row's
  manifest title)
- **Eager** within that enumeration (all title reads happen inside
  `Promise.all` BEFORE the wrapper returns the rows)
- **Not cached anywhere on the production seam** — `manifestStore` has
  no in-memory cache for `metadata.title`
- **Not stale-tolerant** — even if no row changed, every call re-reads
  every manifest file

No mtime / size / inode check is performed before the read. The only
short-circuit is on parse failure (returns `undefined`).