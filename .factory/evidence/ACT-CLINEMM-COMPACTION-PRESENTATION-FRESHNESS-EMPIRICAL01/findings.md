# ACT-CLINEMM-COMPACTION-PRESENTATION-FRESHNESS-EMPIRICAL01

> **Status:** EMPIRICAL_REPORT_ONLY / NO_PRODUCTION_CODE_CHANGE /
> NO_NEW_REVIEW_ROUND / NOT_A_FORMAL_ACT
>
> **Purpose:** verify on `HEAD = cb5b52239` whether the two
> compaction-token defects the Factory ACT designer identified
> ("presentation truth repair", see prompt 2026-09-02) are
> still RED in the form their proposed RED tests would assert,
> or whether prior ACTs already closed them and a different
> defect remains live.
>
> **Authority:** this report is a sanity check, NOT a new
> ACT. The Factory causal reviewer has the next move.

## §0 — Factory disposer's hypothesis

The disposer's prompt hypothesised two defects:

- **DEFECT A — ACCOUNTING TRUTH.** Displayed before/after/header
  values mix or transform incompatible token-accounting
  domains (e.g. apply an H-space compaction ratio to a P-space
  provider observation).
- **DEFECT B — PUBLICATION FRESHNESS.** Compaction completes,
  authoritative state changes, but progress/header projection
  remains stale until the next ordinary task-state publication.

And proposed opening
`ACT-CLINEMM-COMPACTION-PRESENTATION-TRUTH-REPAIR01` once
those subcases bound.

## §1 — Empirical verification at HEAD = cb5b52239

### 1.1 Defect A: arithmetic/domain truth

ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01
(commit `cb5b52239`) applied Strategy-D. The consumer-side
cross-scale ratio transfer was removed in
`apps/vscode/src/shared/getApiMetrics.ts:174-225` (both
`getLastApiReqTotalTokens` and
`getLastApiReqContextInputTokens`). Evidence:

```text
HEAD commit:         cb5b52239 (Strategy-D applied; ACT CLOSED)
getLastApiReqTotalTokens:           genuine disjoint-bucket sum
getLastApiReqContextInputTokens:    genuine disjoint-bucket sum
Ratio transfer (shrinkFraction):    REMOVED

bun test src/shared/__tests__/getApiMetrics.test.ts:
  24 pass, 0 fail
  R0-A witness (INVERTED-INVARIANT) GREEN at HEAD
  G2 (consumer-seam regression oracle)        GREEN
  G3 (genuine-truth restoration)               GREEN
  G4 (positive compatibility, no compaction)   GREEN
  G5 (presentation conservation)               GREEN
```

The post-fix `getLastApiReqContextInputTokens` returns the
LAST `api_req_started` observation's disjoint bucket sum
**unchanged**. The divider's H-space compaction ratio is no
longer transferred.

**Verdict on DEFECT A: CLOSED at HEAD.** No RED reproduction
is possible without re-introducing the bad ratio transfer.

### 1.2 Defect B: immediate publication after compaction

The `SdkCompactionCoordinator.runCompaction` `finally`-block
at `apps/vscode/src/sdk/sdk-compaction-coordinator.ts:365-396`
publishes a trailing `postStateToWebview()` **unconditional
on exit** (success / throw / skip). The webview's last
received snapshot therefore always carries the restored
entry `TurnPhase`, not the in-flight `compacting` phase.
Evidence:

```text
src/sdk/sdk-compaction-coordinator.restore-publication.test.ts
  (CSR01–CSR08 + CSR_PROBE_success / CSR_PROBE_failure)
  10/10 PASS under node v26 + vitest
src/sdk/__tests__/sdk-compaction-coordinator.task-header-projection.thcp11.test.ts
  (THCP11-P1a / P1b / P1c / P1d / P1e / P1f)
  6/6 PASS under node v26 + vitest
```

The restoration also handles the throw path: the trailing
publication's failure is observable, logged, and does not
mask the original compaction error.

**Verdict on DEFECT B: CLOSED at HEAD.** The webview no longer
gets stuck on `compacting` after a manual `/compact`.

### 1.3 New live symptom (NOT defect A or B)

After Strategy-D and the post-restore publication, the
following behaviour remains live and reproducible:

```text
State before compaction:
  api_req_started: tokensIn = 364_900, cacheReads = 0
  (no other api_req_started, no later divider)

Compaction runs and completes successfully:
  compaction divider: tokensBefore = 364_900, tokensAfter = 264_300
  (status = "completed", mode = "manual")

State published to webview (post-restore publication lands):
  modifiedMessages = [api_req_started(364.9k), compaction(364.9k → 264.3k)]
```

The webview's
`getLastApiReqContextInputTokens(modifiedMessages)` walks the
last `api_req_started` it finds. The ONLY `api_req_started`
in the array is the pre-compaction one, so it returns
`364_900`. The divider value pair is rendered by
`apps/vscode/webview-ui/src/components/chat/CompactionRow.tsx`
directly from the parsed `ClineCompactionInfo` payload, which
**does not feed back into the header bar**.

Observed UI:

```text
Header bar (tokenData.used):  364.9k
Divider text:                 Context compacted (manual) · 364.9k → 264.3k tokens
```

These are truthful in their own domains (P-space and
H-space respectively) but the user reads both as "context
size" and perceives them as inconsistent. Reproduction:

```ts
// src/shared/__tests__/post-compaction-bar.freshness.test.ts
// (temporary, removed after this turn)
const messages = [
  { say: "api_req_started", text: JSON.stringify({ tokensIn: 364_900, cacheReads: 0 }) },
  { say: "compaction", text: JSON.stringify({
      status: "completed", mode: "manual",
      tokensBefore: 364_900, tokensAfter: 264_300 }) },
]
assert.equal(getLastApiReqContextInputTokens(messages), 364_900)
// passes (GREEN) — but the user-perceived behaviour is that
// the bar disagrees with the divider.
```

This was re-confirmed by direct bun:test execution (2 pass /
0 fail) on `HEAD = cb5b52239`. After a NEW `api_req_started`
arrives with `tokensIn = 264_300`, the bar correctly updates
to `264.3k` (the genuine post-compaction provider observation).

## §2 — Disposition

The proposed
`ACT-CLINEMM-COMPACTION-PRESENTATION-TRUTH-REPAIR01` is
**NOT the right vehicle** for what the disposer's prompt
called "presentation truth repair" as of this turn:

- Its DEFECT A RED is **already GREEN** at HEAD (Strategy-D
  applied; 24/24 G1-G5 GREEN; the bad ratio transfer is
  gone).
- Its DEFECT B RED is **already GREEN** at HEAD (CSR01-CSR08
  + THCP11-P1a..P1f GREEN under node v26 + vitest; the
  trailing post-restore publication is wired).

Opening the proposed ACT and running the proposed RED tests
would either be a no-op (defects already closed) or — worse —
duplicate the existing recon/repair closure paths. That violates
the Factory doctrine "real/live failure → RED reproduction →
repair": there is no live failure in DEFECT A or DEFECT B
to reproduce.

The actual live symptom is a **third defect (defect C)**:
post-compaction header-bar staleness — the divider carries
the post-compaction `tokensAfter` value, but
`getLastApiReqContextInputTokens` walks `api_req_started`
only and never sees that value. The header bar stays at the
pre-compaction P-space value until the next API request.

### Conservation

- The §0 frozen contract from
  `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01`
  (separated truth domains + invariants I1-I7) is unchanged
  by this report. Defect C does NOT mix domains — it is a
  projection-coherence defect at the WEBVIEW seam, not an
  accounting defect.
- The recon's CASE_S1 label-only option (`ContextWindow.tsx:175`
  "Current tokens used in this request") remains a candidate
  for the presentation residue — it is a separate fix from
  defect C.
- `getApiMetrics.ts:174-225` MUST NOT be modified to recover
  by reading the compaction divider's `tokensAfter` and
  substituting it for the missing provider observation. That
  would violate I1-I3 (additive arithmetic across the
  H/P boundary). The honest fix is at the UI / webview
  projection seam, not at the metrics consumer.

### Recommended next move (NOT pre-decided)

The factory causal reviewer should consider one of:

- **(α) Narrow recon-only ACT** (e.g.
  `ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01`):
  bind the actual post-compaction staleness boundary,
  classify whether it is (1) a UI rendering defect (label /
  source discrimination), (2) a state-publication defect
  (the divider value pair never reaches a published
  field), or (3) a projection-coherence defect (header
  bar and divider disagree and need an explicit semantic
  reconciliation), THEN author a bounded repair.
- **(β) Wire-contract ACT** (the original CASE_S3 wire-
  contract-overload follow-on the recon ACT contemplated):
  add a `kind` discriminator to the compaction notice so
  the consumer can mechanically distinguish the H-space
  divider value from a P-space provider observation; this
  is the only fix that addresses both (1) defect C and (2)
  the CASE_S1 label residue in a single bounded change.
- **(γ) Hold** until the file-tool workspace-realpath lane
  binds a real creator (it is `HOLD_FOR_LIVE_BIND` today
  and `SECURITY P0` per the disposer's priority ordering).

Whichever path the reviewer picks, it MUST NOT open a
re-con of A or B (they are closed at HEAD), and it MUST
NOT touch the H-space producer, the P-space consumer, or
the compactor entry points.

## §3 — Operational action

1. This evidence file lands as an EMPIRICAL_REPORT_ONLY
   commit; no production code change; no new review round.
2. The epic detail file is updated to record that DEFECT A
   and DEFECT B are closed at HEAD, and that a third defect
   (header-bar freshness / projection coherence) remains
   live and is the correct next recon target.
3. The epic-board row for "Context / compaction" is updated
   to reflect the actual state of the repair ACT (CLOSED via
   commit `cb5b52239`) and the new live defect.
4. The proposed
   `ACT-CLINEMM-COMPACTION-PRESENTATION-TRUTH-REPAIR01` is
   NOT opened in this commit. Opening it without
   first re-classifying defect A and defect B would
   duplicate work that has already landed and would
   force the reviewer into a redundant cycle.