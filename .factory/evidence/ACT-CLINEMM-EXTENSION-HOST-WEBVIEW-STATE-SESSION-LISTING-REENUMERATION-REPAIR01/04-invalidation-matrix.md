# Invalidation Matrix — ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01

## Scope

The webview-state-projection cache (`SdkTaskHistory.metadataHistoryCache`)
must invalidate precisely when session-history data changes in a way
that affects the projected list, and MUST NOT invalidate on any
other signal.

## Decision key

- `YES` = the projection must reflect this mutation on the next read.
- `NO (patch)` = the projection must reflect this mutation, and the
  cache can be patched in place without a re-enumeration.
- `NO` = the projection does not need to change.

## Mutation classification

| Mutation | Class | Already covered? | Mechanism in code |
| --- | --- | --- | --- |
| **session created** (brand-new task) | YES | YES | `initTask` → `updateTaskHistoryItem(newHistoryItem)` → `updateSession` → `updateCachedSessionRecord` (index === -1) → `invalidateMetadataHistoryCache()` (sdk-task-history.ts:356). The next listHistory will see the new session. |
| **session deleted** | YES | YES | `deleteTaskFromState` → `deleteSession` → `invalidateMetadataHistoryCache()` (sdk-task-history.ts:613). |
| **title changed** | YES (patch) | YES | `updateTaskHistoryItem` → `updateSession` → `updateCachedSessionRecord` patches the record's prompt + metadata in place (sdk-task-history.ts:358-365). |
| **visible metadata changed** (favorited, tokens, cost, model, cwd) | YES (patch) | YES | same path as title. |
| **active task token/cost updates** (streaming partial updates) | YES (patch) | YES | `updateTaskUsage` → `updateSession` → in-place patch. The cache's `updatedAt` is bumped (sdk-task-history.ts:585-589) so recency ordering is preserved. |
| **per-turn usage / telemetry update** | YES (patch) | YES | same as above. |
| **artifact size back-fill** | YES | YES | `cacheTaskSize` → `host.update` → `invalidateMetadataHistoryCache()` (sdk-task-history.ts:739). |
| **write failed** (optimistic-concurrency retry exhausted / session deleted out from under write) | YES | YES | `updateSession` invalidates explicitly to avoid showing a fake updated record (sdk-task-history.ts:579). |
| **streaming partial assistant text** | NO | n/a | The session-list projection does NOT include message text. Token totals/cost are patched; the text itself is not in the list projection. |
| **tool_use / tool_result** | NO | n/a | Same reasoning. The list projection is title + metadata + tokens + cost; tool telemetry is in chat-view state, not history. |
| **arbitrary session event** | NO | n/a | No invalidation. |
| **webview state-post flush** | NO | n/a | The defect target: webview flush is NOT permission to rematerialize. |
| **active session lifecycle events** (subscribed/unsubscribed/started/stopped) | NO | n/a | The list projection does not change; the active session's metadata in the list is patched via the in-place path on the next `updateSession`. |
| **dispose** | YES | YES | `dispose()` invalidates (sdk-task-history.ts:324). |

## Forbidden "any session event → invalidate" pattern

The pattern `any session event → invalidate` reproduces the defect
under a new name. The cache must be patched or left alone based on
whether the projection actually changed.

## Why this matrix is sufficient

The defect surface is `webview_state_projection`. Every code path
that mutates the projected list is captured in the existing 5
invalidation sites + the in-place patch path. The only signal that
fires for each webview flush but does NOT correspond to an actual
list projection change is "session event with no projected metadata
delta" — and the cache must NOT invalidate on that signal.

## Repair target

Change the cache-hit predicate's TTL from "10s" to a large safety
bound. The mutation authorities listed above continue to invalidate
correctly. The cache is reused across webview flushes that don't
mutate the projected list.