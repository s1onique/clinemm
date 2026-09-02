
# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

## State (seventeenth-pass, 2026-09-03)

```text
W producer                = CLOSED
W cadence                 = CLOSED
runtime state             = CLOSED
runtime publication       = CLOSED
durable transition tests  = CLOSED
HOST_PUBLICATION          = COMPOSED PROOF / ACCEPTED
VSCode projection         = OPEN
NO_INDEPENDENT_W_SCALAR_ON_EVENT = TRUE
P0 / P1 / P2              = NONE
NEW_REVIEW_ROUND          = NO
C1                        = GO_P3
```

Reviewer on bb5588150:
```text
PASS. C1: GO_P3.
```

## P3 contract (verbatim from reviewer)

### Architecture-first, no new protocol field before
### the first missing edge is known

Required chain (top-down):

```text
AgentRuntime
  snapshot.currentWorkingContextEstimate = W
        +
  working-context-state-changed
        |
        v
LocalRuntimeHost / core session projection
        |
        v
SdkController / webview state
        |
        v
ChatView / TaskHeader
        |
        v
ContextWindow numerator
```

### First P3 sub-step (BEFORE any code)

Map every boundary in the chain (already-receives-event,
can-read-snapshot, currently-carries-W). Stop at the
FIRST missing edge. No code change before the table is
complete for all 5 rows.

```text
| Boundary                       | Already receives runtime event? | Can read runtime snapshot? | Currently carries W? |
| ------------------------------ | ------------------------------: | -------------------------: | -------------------: |
| LocalRuntimeHost               |                             yes |                        yes |                    ? |
| core session snapshot/event    |                               ? |                          ? |                    ? |
| SdkController state            |                               ? |                          ? |                    ? |
| ExtensionState/webview message |                               ? |                        n/a |                    ? |
| ChatView token projection      |                             yes |                        n/a |     no — currently P |
```

### P3 RED (synthetic sentinels, real projection seam)

```text
P = 364_900
W = 271_337
working-context-state-changed
  snapshot.W = 271_337
no new api_req_started
expected:
  TaskHeader context numerator = 271_337
actual at HEAD:
  numerator = 364_900 (P)

271_337 deliberately synthetic.
Do NOT use 264.3k as oracle (screenshot evidence only).
```

### UNDEFINED_W contract

```text
UNDEFINED_W_STALE_REUSE = FORBIDDEN

Acceptable outcomes (W === undefined):
  A. numerator falls back to P
  B. numerator becomes unavailable / unknown

Forbidden:
  stale previous W displayed as current

Fallback choice: PENDING. Read existing component
contract (ContextWindow.tsx line 167 null fallback;
getLastApiReq.ts last api_req_started walk) before
deciding. Observed hints (read but not decided):
  - ContextWindow returns null when tokenData is falsy
  - getLastApiReqContextInputTokens walks modifiedMessages
    for the last api_req_started with
    tokensIn + cacheReads + cacheWrites — this is the
    "P" path P3 replaces.
```

### CONSERVATION (mechanically searchable)

```text
apps/vscode MUST NOT import / use:
  estimateRequestInputTokens
  estimateMessageTokens
for this projection.
The host is transport only.
W is transported, never recomputed.
```

### CONSERVATION (provider and Strategy-D)

```text
P remains available for provider / request metrics.
H_b / H_a remain compaction telemetry.
getApiMetrics Strategy-D stays untouched
  (getLastApiReqContextInputTokens continues to drive
   provider-activity contexts; P3 changes the webview
   bar's numerator only).
```

## Disposition

```text
STATE_BIND_CLOSED                = PROVEN
STATE_BIND_IMPLEMENTATION        = PASS
STATE_BIND_DURABLE_TEST          = PROVEN
  (real two-iter in one execute(),
   sanity-verified via production revert)

PUBLICATION_BIND_CLOSED          = PROVEN
PUBLICATION_BIND_IMPLEMENTATION  = PASS
PUBLICATION_BIND_DURABLE_TEST    = PROVEN
  (vacuous witnesses replaced;
   publisher-side fail-closed companion added)

HOST_PUBLICATION                 = COMPOSED PROOF
                                     / ACCEPTED

NO_INDEPENDENT_W_SCALAR_ON_EVENT = TRUE

P0 = NONE
P1 = NONE
P2 = NONE (factory bloat only — addressed by compacting
           this ACT body and entry-freeze)
NEW_REVIEW_ROUND                 = NO
C1                               = GO_P3
```

## Commit lineage

```text
commit 7: STATE_BIND            (aec3ff0c6)
commit 8: PUBLICATION_BIND      (05ccaaf66)
commit 9: TEST_CORRECTION       (bb5588150)
         + P2_TERMINOLOGY
                                └─ C1: GO_P3

(future)
        VSCODE_PROJECTION      (separate bounded commit)
                                └─ C1: GO_???
```

## Next bounded cycle (separate commit)

```text
PRODUCTION_RUNTIME_DELTA = none this commit
                          (entry-freeze / ACT / board only)

P3 first sub-step:
  1. Fill the 5-row boundary table. Stop at the FIRST
     missing edge.
  2. Make the smallest change at that edge.
  3. P3 RED with synthetic sentinels.
  4. GREEN.
  5. Dogfood actual post-compaction bar.

No Factory historical bloat in P3.
```

PRODUCTION_RUNTIME_DELTA = entry-freeze / ACT / board only
TYPECHECK_DELTA          = ZERO
DEFAULT_SUITE_STATE      = GREEN
NEW_REVIEW_ROUND         = NO
C1                       = GO_P3
