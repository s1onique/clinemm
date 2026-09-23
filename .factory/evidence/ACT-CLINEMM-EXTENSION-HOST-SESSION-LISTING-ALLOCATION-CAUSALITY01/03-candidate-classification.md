# Candidate Classification — ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01

## 1. Candidates retained after recon

These are the structural classes that survive the recon in
`02-session-listing-production-map.md`. They correspond exactly to
ACT §7 SL1..SL6:

### SL1 — `LIST_SESSIONS_REQUEST_STORM`

`UnifiedSessionPersistenceService.listSessions` is reached from at
least two production entry points:

- `SdkController.getStateToPostToWebview` (every state-post flush,
  coalesced by `StatePostDebouncer` at 50 ms trailing).
- `SdkController.getTaskHistory` (when the webview mounts the History
  view).

Both reach the same wrapper, which performs the same work
(reconcileDeadSessions + adapter.listSessions + Promise.all of title
reads). This is structurally possible.

### SL2 — `UNCHANGED_MANIFEST_REREAD`

`SessionManifestStore.readSessionManifestTitle` performs:

```ts
raw = await readFile(manifestPath, "utf8")
parsed = JSON.parse(raw)
return parsed.metadata?.title
```

There is **no in-memory cache**, **no mtime check**, and **no size
check**. The only short-circuit is on parse failure. So if the
### SL3 — `EAGER_FULL_SESSION_MATERIALIZATION`

`UnifiedSessionPersistenceService.listSessions` does:
- `scanLimit = min(requestedLimit * 5, 2000)` — scans up to 2000 rows
  for a 100-row requested limit,
- `Promise.all(rows.map(readSessionManifestTitle))` — eager title
  resolution for every returned row.

The adapter-side scan-limit expansion is independent of whether the
title resolution is needed. If only the first 50 rows' titles are
actually displayed by the webview, the remaining rows still incur the
manifest read + parse. This is structurally possible.

### SL4 — `WEBVIEW_STATE_PROJECTION_REENUMERATION`

`SdkController.getStateToPostToWebview` calls
`taskHistory.listHistory({limit: 100, hydrate: false})` UNCONDITIONALLY
on every state-post flush. State-post flushes are triggered by:

- Session events (every `assistant-message` delta, every tool_use,
  every tool_result, every status change).
- Task telemetry updates (every usage update).
- Background command lifecycle events.
- Foreground command lifecycle events.
- `toggleTaskFavorite`, `updateTaskSettings`, settings changes, etc.

For a 30-second streaming turn in the long-horizon workload, this
means potentially hundreds of state-post flushes per second, each
issuing one `listSessions`. This is structurally possible.

## 2. Candidates eliminated by recon

None of the prior candidates survive recon:

| Prior candidate | Eliminated because |
| --- | --- |
| `xmlTagsRemoval` | Not on the call chain — the profiled `listSessions` is the SDK wrapper, not the legacy task-history scrubber. |
| `normalizeUserInput` | Not on the call chain. |
| `captureContinuationCardinalityAuthorityRecord` | Continuation-cardinality is observed during task continuation, not session enumeration. |
| `PendingPromptsController.drain` | Drains the pending-prompt queue, not the session list. |
| `TurnStateTracker.setWithWriter` | Writes turn-phase, does not enumerate sessions. |

## 3. Pre-flight sanity: which SL class is the strongest prior?

Given the recon, the strongest priors (ranked) are:

1. **SL4** — `WEBVIEW_STATE_PROJECTION_REENUMERATION`: the unconditional
   call inside `getStateToPostToWebview` is the only known consumer
   that fires many times per turn.
2. **SL2** — `UNCHANGED_MANIFEST_REREAD`: no mtime/size discriminator
   is in place.
3. **SL3** — `EAGER_FULL_SESSION_MATERIALIZATION`: scan-limit is
   expanded up to 2000 rows for a 100-row request; this is a hard
   lower bound on how many manifests could be read per call.
4. **SL1** — `LIST_SESSIONS_REQUEST_STORM`: same root cause as SL4
   viewed from a different angle.

The counter-only diagnostic must distinguish among these WITHOUT
modifying the production implementation. It must record:

- `listSessionsCalls` (per caller class)
- `readSessionManifestTitleCalls` (per manifest identity)
- `uniqueManifestIds` observed
- `repeatedManifestReads` count (same identity, called more than once
  within the capture window)

If `listSessionsCalls >> 1` and one caller dominates → SL4 / SL1.
If `readSessionManifestTitleCalls >> listSessionsCalls` and the
ratios are consistent with eager per-row fan-out → SL2 / SL3.
If both ratios are small → SL6 (single necessary execution, look
inside).

## 4. Candidates NOT to investigate further in this ACT

- `Buffer.toString` is fully owned by the `listSessions` /
  `readSessionManifestTitle` subtree (§7 of the recon). It is not a
  separate root cause.
- `queryAll` is the V8 surface for the sqlite adapter's
  `listSessions` query path. It is not a separate root cause.
- The `metadataHistoryCache` (10 s, `hydrate:false`) is too short
  to amortize the long-horizon workload window; this is captured
  by the cardinality counters and does not need its own
  investigation.

## 5. Conclusion

The recon validates SL1–SL5 as structurally possible candidates.
The counter-only diagnostic must measure production cardinality
without repair so the eventual discriminator can name the actual
defect.
### SL5 — `DUPLICATE_LISTING_CONSUMERS`

Two production consumers independently enumerate:

- `getStateToPostToWebview` → `taskHistory.listHistory` → `listHistory`
  → `listSessions` (in-process).
- `getTaskHistory` → `taskHistory.listHistory` → `listHistory` →
  `listSessions` (in-process).

These consumers share the `metadataHistoryCache` so redundant calls
within the 10 s window can be amortized. But during a streaming
turn, the cache is invalidated aggressively, so the two consumers
likely still issue independent enumerations. This is structurally
possible.

### SL6 — `NO_REDUNDANT_CARDINALITY`

If the cardinality is small and the title reads are necessary, the
allocation cost lies inside one necessary execution. Possible but
unlikely given the LIVE profile attributed ~21.3% of total capture
to the `listSessions` subtree.
session set is unchanged between two `listSessions` calls, every
manifest file is re-read anyway. This is structurally possible.