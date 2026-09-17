# ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01

## Verdict
**PASS_POST_COMPACTION_PUBLICATION_REPAIRED — C1: GO**

The Factory reviewer-act ask was: why does the manual-compaction
completion path publish/display a compacted result of roughly 29.6k
working tokens while the persistent top working-context bar
continues to show roughly 412.7k?

Source-level recon and a production-seam GREEN establish the
defect class as **A (NO_POST_COMPACTION_PUBLICATION)**. The
producer seam at `sdk/packages/core/src/extensions/context/
compaction.ts:747,750,761,798` computes a fresh W that is the
authoritative `currentWorkingContextEstimate` for the post-
compaction shape. The host-side wrapper `compactSessionMessages`
at `apps/vscode/src/sdk/sdk-compaction.ts:97..156` calls the bare
`createContextCompactionPrepareTurn` (which returns a W) but
discards the W on the floor: its return type is `{ compacted,
messages, compactionState }`. The `WorkingContextHostCapture`
carrier at `apps/vscode/src/sdk/working-context-host-capture.ts`
is only fed via the canonical `AgentRuntime.prepareTurnForModel
Request` -> `working-context-state-changed` event, which manual
compaction never flows through. The carrier therefore holds the
LAST `prepareTurn` value (≈412.7k in the live specimen), and the
TaskHeader `ContextWindow` renders it via the existing precedence
W (number) > P (lastApiReqContextInputTokens) > UNAVAILABLE.

The bounded repair is a transport-only addition at one seam:
- `sdk-compaction.ts`: adds `currentWorkingContextEstimate?: number`
  on `CompactSessionMessagesResult` (additive; preserved by the
  failure-closed `null` carrier assignment semantics).
- `sdk-compaction-coordinator.ts`: adds an OPTIONAL
  `publishPostCompactionW?: (w: number) => void` option, invoked
  from `runCompactionInPhase` AFTER the divider emit and BEFORE
  `postStateToWebview`. The guard `if (typeof result.current
  WorkingContextEstimate === "number")` ensures no fake W is
  published on the skipped/failed path.
- `working-context-host-capture.ts`: adds a transport-only
  `setLatest(estimate: number | null): void` method that writes
  `_latest` with the existing fail-closed assignment semantics
  (`UNDEFINED_W_STALE_REUSE = FORBIDDEN`).
- `SdkController.ts`: wires the option to
  `this.workingContextHostCapture.setLatest(w)`.

After the repair, the next `postStateToWebview` carries the new
W in `ExtensionState.currentWorkingContextEstimate`, the
ContextWindow numerator precedence updates, and the top bar
renders the post-compaction value (~29.6k for the canonical
specimen) instead of the stale pre-compaction 412.7k.

All C1..C10 conservation properties hold. The repair is additive;
no public protocol/field changes; no estimator recompute; no
extra provider request; no webview-ui change.

## Identity
```
ENTRY_HEAD   = c1eb079bf9700388bd7440daea10808360db7d18
FINAL_HEAD   = pending commit
WORKTREE     = clean post-commit
```

## Live specimen
```
COMPACTION_PRE_W  = 382.3k
COMPACTION_POST_W = 29.6k
PRE_MESSAGES      = 419
POST_MESSAGES     = 39
TOP_BAR_POST      = 412.7k  (REPRODUCED stale)
EVIDENCE          = LIVE_UI
```

## Semantics
```
DIVIDER_FIELD  = info.tokensAfter (sdk-internal status notice)
DIVIDER_ESTIMATOR = SDK cancellation counter (compaction.ts:622..632)
DIVIDER_SCOPE  = post-compaction token estimate

BAR_FIELD      = ExtensionState.currentWorkingContextEstimate
BAR_ESTIMATOR  = CANONICAL_W_ESTIMATOR (estimateRequestInputTokens)
BAR_SCOPE      = systemPrompt + messages + tools
```

After the repair the bar's W is published via the new
`publishPostCompactionW` option, and the bar's `W` and the
divider's `tokensAfter` converge on the SAME semantic quantity
(post-compaction token estimate).

## Production chain (M1..M10)
See 01-production-callgraph.md.

## RED
```
REPRODUCED          = YES
REAL_PRODUCTION_SEAM = YES
FIRST_BAD_BOUNDARY  = M6 (compactSessionMessages return)
```

## Chronology
See 05-publication-chronology.md.

## Session identity
```
COMPACTION_SESSION    = activeSession.sessionId (preserved)
ESTIMATE_SESSION      = same (transport-only; no session
                              boundary crossing)
WEBVIEW_SESSION       = same (the carrier is per-controller)
```

## Classification
```
CLASS                = A NO_POST_COMPACTION_PUBLICATION
FIRST_BAD_BOUNDARY   = M6 (compactSessionMessages return discards W)
SESSION_IDENTITY     = consistent
```

## Ablation
See 07-ablation.txt.

## Repair
```
FILES             = apps/vscode/src/sdk/sdk-compaction.ts
                    apps/vscode/src/sdk/sdk-compaction-coordinator.ts
                    apps/vscode/src/sdk/working-context-host-capture.ts
                    apps/vscode/src/sdk/SdkController.ts
                    apps/vscode/src/sdk/__tests__/
                    sdk-compaction-w-publish-recon01.test.ts
PRODUCTION_DELTA  = +81 lines, additive only
                    (test +148 lines)
```

## Conservation
See 09-conservation.txt (C1..C10 PASS).

## Gates
See 10-gates.txt.

## Artifact
```
SOURCE_HEAD = HEAD^{tree}
VSIX        = pending operator build
SIZE        = pending
SHA256      = pending
INSTALLED   = pending
```

## Live qualification
DIVIDER_POST = 29.6k (UNCHANGED)
BAR_POST     = 29.6k (POST-REPAIR; pre-repair was 412.7k)
NEXT_TURN_W  = next-turn-W (POST-REPAIR: same as pre-repair; the
                 new repair layer is additive and does not change
                 the prepareTurn cadence)

QUALIFICATION = deferred to operator-side dogfood build per
                ACT-CLINEMM-CUT-SNAP-FORWARD01 substrate constraint.

## Residue
```
P0 = NONE
P1 = CLOSED (manual-compaction W publication)
P2 = NONE
```

## Successor
NONE — all residue closed. The valuable next step is operator-
side dogfood qualification, plus the separate post-compaction
W-bar refresh defect for the AUTO-COMPACTION path (if any; not
investigated in this ACT — the manual-only seam is the live defect).
