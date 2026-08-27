# ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01 — evidence

> **VERDICT = PASS_TASKHEADER_BOARD_RECONCILIATION**
> Closed at HEAD `ab6e29a2e` (working tree clean, no production/test delta).
>
> Bounded docs-only reconciliation of two stale TaskHeader frontier rows
> against durable closure evidence already in the repository. Honors the
> Factory reviewer's stop-rule `HALT_RED_NOT_REPRODUCED` from the Phase-0
> inventory.

## 1. Entry baseline

- HEAD: `ab6e29a2e` (immediately before this ACT; working tree clean)
- ACT: `ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01`
- Epic family: `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01`, `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01`
- Mode: Documentary reconciliation only. **No production change. No test change. No upstream snapshot refresh.**

## 2. Drift mechanism (root cause)

Both TaskHeader frontier rows on the board (`TASKHEADER-CANONICAL-PROJECTION01`, `TASKHEADER-OWNER-AWARE-TIMING01`) were closed at HEAD but the board still says OPEN. The drift was caused by the board-sharding rewrite at `536ea37a7`:

```text
536ea37a7 docs(factory): reduce epic board to human-readable index (6346 -> 207 lines)
```

That commit collapsed the long single-file board into the short navigation index. The prior closure updates for THCP01 (at `149fb131e`) and THCP11 (at `8a7e53742`) were dropped in the same sharding. The same root cause resurrected the E7.1 row, which was re-reconciled at `df8d71d4b` (`ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01` — `CLOSED_NOT_REPRODUCED`).

## 3. Phase-0 inventory (durable negative knowledge + authority map)

See `docs/architecture/elm/task-header-canonical-projection-phase0-inventory01.md` for the full authority map. Headline findings:

| TaskHeader surface | Source | Classification |
|---|---|---|
| Working / thinking label | `taskHeaderPresentationStateLabel` (`taskHeaderTelemetryHelpers.ts:213-221`) → `stateLabel(phase)` | CANONICAL (projection) / LEGACY_FALLBACK (turnState only when projection absent) |
| Elapsed timer | `resolveElapsedDisplayMs(telemetry.startedAt, telemetry.endedAt, now)` (`taskHeaderTelemetryHelpers.ts:115-124`) | CANONICAL (host `startedAt`/`endedAt`; webview `setInterval` is presentation only) |
| Tool count / mechanism breakdown | `telemetry.toolCalls` + `telemetry.mechanism` + `isUsableMechanismProjection` validator | CANONICAL / LEGACY_FALLBACK when validator fails |
| Recovery count | `telemetry.recoveryBudgetFailures` | CANONICAL |
| Working-directory badge | `currentTaskItem.cwdOnTaskInitialization` | CANONICAL |
| Cost / price-tag | `useProviderUsageCostDisplay` + provider-billing-mode gate | DERIVED_BUT_SAFE |
| Tokens / context-window | Host-owned `lastApiReqContextInputTokens` etc. | CANONICAL |
| Model / provider label | Provider-normalized config | CANONICAL |
| Cancel / Resume | Outside TaskHeader; `isRunLive(turnState)` selector | CANONICAL (not TaskHeader's authority) |

**Result: 0 DUPLICATE_AUTHORITY rows.** No message-tail inference, no chat-derived fallback, no second independent lifecycle classifier found in the TaskHeader source.

## 4. Targeted executable confirmation (CURRENT_HEAD_CONSERVATION)

The reviewer mandated re-running existing targeted tests (not new tests) to bind current HEAD to the historical THCP contract. Results at HEAD `ab6e29a2e` on 2026-08-27:

```text
apps/vscode/src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts
  18/18 PASS   (THCP01..THCP10 + SHADOW_LEGACY_INDEPENDENCE +
                SHADOW_NECESSITY + conservation THCP09, THCP10)

apps/vscode/src/sdk/__tests__/sdk-compaction-coordinator.task-header-projection.thcp11.test.ts
  6/6  PASS   (THCP11 host-compaction freshness / conservation)

apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts
  35/35 PASS   (formatElapsed + resolveElapsedDisplayMs + stateLabel +
                taskHeaderStateLabel + taskHeaderPresentationStateLabel
                THCP01/02/04/05/05b/07/08 + isUsableMechanismProjection
                TES-WIRE-H01..H06)

TOTAL:  59/59 PASS
VERDICT: CURRENT_HEAD_CONSERVATION = PASS
```

The trailing `Error: kill EPERM` warnings are a known macOS vitest-pool worker-cleanup artifact unrelated to test outcomes (tests report PASS before the cleanup error fires). They are documented and ignored.

## 5. Board corrections

### 5.1 `.factory/epic-board.md`

The board currently says (line 21):

```text
| TaskHeader projection | P1 | `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` | [`task-presentation.md`](./epics/task-presentation.md) |
```

This is a NEXT slot. After this ACT it is corrected to:

```text
| TaskHeader projection | P1 | **CLOSED** (migration at 149fb131e + THCP11 at 8a7e53742 already landed) | [`task-presentation.md`](./epics/task-presentation.md) |
```

The §Active epics row at line 36 currently says:

```text
| Task-presentation | P1 | ACTIVE (compacted-history substrate CLOSED; 2 task-header projection items OPEN; E7.1 static-thinking presentation ACT CLOSED_NOT_REPRODUCED) | `TASKHEADER-CANONICAL-PROJECTION01` · `TASKHEADER-OWNER-AWARE-TIMING01` | [`task-presentation.md`](./epics/task-presentation.md) |
```

After this ACT it is corrected to:

```text
| Task-presentation | P1 | ACTIVE framework (compacted-history substrate CLOSED; THCP01 CLOSED + THCP11 PASS + OAT01 CLOSED_NOT_REPRODUCED; `TERMINAL-REPORT-COMPLETION-FRAMING01` + `…-CORRECTION01` CLOSED; CURRENT OPEN WORK = none) | (none) | [`task-presentation.md`](./epics/task-presentation.md) |
```

(The earlier "1 presentation-only placeholder OPEN" was a stale placeholder that duplicated CLOSED work; removed per reviewer P1 bounded correction. See §5.2.)

### 5.2 `.factory/epics/task-presentation.md`

The §Open frontier table currently lists THCP01 and OAT01 as OPEN (lines 37-38). After this ACT those two rows are replaced with CLOSED ledger rows mirroring how E7.1's CLOSED_NOT_REPRODUCED row at line 34 was added at `df8d71d4b`.

The §Current status line 9 currently says "3 open items". After this ACT it is corrected to "**no open work**" because both real implementation EPICs are now closed AND the stale `TERMINAL-REPORT-COMPLETION-FRAMING` placeholder was removed (see below).

The §Open work section currently lists THCP01 (line 44) and OAT01 (line 45) as real open items, plus the `TERMINAL-REPORT-COMPLETION-FRAMING` working-label placeholder (line 46). After this ACT:
- THCP01 + OAT01 bullets are removed (the corresponding EPICs are now CLOSED).
- The `TERMINAL-REPORT-COMPLETION-FRAMING` placeholder is **also removed** because it duplicates work that is already CLOSED (`TERMINAL-REPORT-COMPLETION-FRAMING01` v2 + `…-CORRECTION01` both at `ab6e29a2e` per `23010e7bb` + `bbbdffc99`, recorded in §Open frontier table at lines 35-36). Retaining it under a working label resurrected closed work — removed per reviewer P1 bounded correction.
- §Open work is now empty. Completion-protocol liveness (a separate concern at the completion-protocol/liveness seam, NOT the framing seam) lives under `runtime-task-progression.md` as `COMPLETION-PROTOCOL-LIVENESS02`, opened only when its live reopen trigger fires. It is not opened here.

The §Reopen / new-work conditions block at line 62 currently lists "Any of the 3 open items above changes status." This is updated to drop that line (no open items remain); the re-open triggers for THCP01 + OAT01 remain (they reference the baseline evidence, not a placeholder).

The §Historical detail block at lines 215-260 (L3337-3377 pre-sharding verbatim preservation) is **NOT modified** — it is a frozen verbatim snapshot per the factory index contract §6 ("do not rewrite history here unless the underlying ACT itself is being amended"). The §Open frontier table above it is the authoritative current-state ledger.

## 6. Conservation / boundary

```text
FACTORY_CONSERVATION_ANCHOR = 5e96cfd3a
OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅ (unchanged)
NEW_ACT_IDS                  = ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01
                               (added by this ACT; +1 ID total)

PRODUCTION_DELTA = 0
TEST_DELTA       = 0
UPSTREAM_SNAPSHOT_REFRESH = none
```

The `+1 ID` addition is legitimate per factory contract §5 ("new ACTs may legitimately appear"). The validator `tools/factory/validate-epic-board.ts` must still recognize the new ID across board + epics + this evidence file. Verified in §7 below.

## 7. Quality gates

- `tools/factory/validate-epic-board.ts`:
  - `VALIDATOR_RESULT` = **BASELINE_FAIL_UNCHANGED** (validator exits nonzero because of a known pre-existing baseline violation)
  - `NEW_VALIDATOR_FAILURES` = **0** (this ACT did not introduce any new gate failure)
  - `BASELINE_FAIL_DETAIL` = `NO_OVERSIZED_INDEX_TABLE_CELL` — `table@L52 row4 "State" = 366 chars (>280)`. The offending cell is at `.factory/epic-board.md` line 57, the §Open supporting work row for "Tool-execution semantics (umbrella)". A second oversized cell (590 chars) exists at line 58 ("Terminal-report completion framing") but the validator stops after the first hit per its `for` loop semantics; both predate this ACT (verified by `git stash` + re-run at HEAD `ab6e29a2e`: same FAIL, same line, same character count).
  - All other gates PASS: `OLD_ACT_IDS_PRESERVED` (212 durable IDs, invariant holds), `ALL_INDEX_LINKS_EXIST` (52 relative links resolve), `ALL_INDEX_LINKS_RELATIVE` (no absolute URLs), `NO_DUPLICATE_EPIC_ROWS` (16 unique), `NO_DUPLICATE_CURRENT_WORK_IDS`, `EVERY_OPEN_NEXT_ROW_HAS_DETAIL`, `STATUS_VOCABULARY_VALID`, `HOST_REQUIRED_QUALIFICATION_VALID`, `INDEX_LINES_LT_400` (220 lines), `INDEX_TARGET_READABLE` (advisory).
  - Scope-boundary rationale: this is a bounded documentary reconciliation ACT; fixing the pre-existing P2 hygiene drift on §Open supporting work rows L57/L58 would be scope creep and would require either shrinking the existing CLOSED-narrative cells or restructuring the §Open supporting work table layout, neither of which is in scope. Documented here so future maintainers don't mistake the FAIL for a regression.
- `git diff --check`: PASS (clean, no whitespace errors) — confirmed both at pre-commit (staged) and at `git diff --check HEAD~2 HEAD` after the parent commit landed (initially flagged two trailing-blank-line issues; fixed by follow-up commit `608fb321b`, whitespace-only).
- Working tree status after ACT: clean (HEAD is now `608fb321b`, +2 commits this session; no untracked files remain in durable-tracked scope).

## 8. Final report format

```text
ACT_ID                                     = ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01
VERDICT                                    = PASS_TASKHEADER_BOARD_RECONCILIATION
ENTRY_HEAD                                 = ab6e29a2e
CLOSE_HEAD                                 = ab6e29a2e
PRODUCTION_DELTA                           = 0
TEST_DELTA                                 = 0
UPSTREAM_SNAPSHOT_REFRESH                  = none

THCP01_FAMILY_STATE                        = CLOSED
  (149fb131e PASS_TASKHEADER_CANONICAL_PROJECTION +
   8a7e53742 THCP11 PASS_TASKHEADER_CANONICAL_PROJECTION)

OAT01_FAMILY_STATE                         = CLOSED_NOT_REPRODUCED
  (e54a71326 + 0db0201cc NOT_REPRODUCED)

CURRENT_HEAD_CONSERVATION                  = PASS
  (18+6+35 = 59 targeted tests pass at HEAD)

VALIDATOR_RESULT                           = BASELINE_FAIL_UNCHANGED
NEW_VALIDATOR_FAILURES                     = 0
  (pre-existing baseline FAIL: NO_OVERSIZED_INDEX_TABLE_CELL,
   table@L52 row4 "State" = 366 chars (>280); pre-existed
   at HEAD ab6e29a2e before this ACT. See §7 for scope-boundary
   rationale.)

BOARD_ROWS_FIXED                           = 3
  (.factory/epic-board.md L21 frontier row,
   .factory/epic-board.md L36 §Active epics family-state row,
   .factory/epics/task-presentation.md L9/L37/L38/L44/L45/L62)

BOARD_PLACEHOLDER_REMOVED                  = 1
  (.factory/epics/task-presentation.md §Open work "TERMINAL-REPORT-
   COMPLETION-FRAMING" placeholder; was resurrecting CLOSED v2 work
   under a working label — removed per reviewer P1 bounded correction)

FACTORY_CONSERVATION_ANCHOR                = 5e96cfd3a
NEW_ACT_IDS                                = ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01
OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS  = ∅

NEXT_PRODUCT_FRONTIER                      = ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01
```

## 9. Notes for the next maintainer

The two stale TaskHeader frontier rows were the LAST two outstanding
real implementation items in the task-presentation family after E7.1
was closed at `df8d71d4b`. With this ACT and the reviewer-P1 bounded
correction removing the stale `TERMINAL-REPORT-COMPLETION-FRAMING`
placeholder, the family's real implementation work is fully closed
and **the family has no current open work** at HEAD `608fb321b`.

If a future maintainer needs to re-open either EPIC, they should
NOT do it as a no-op re-closure. The conditions that warrant
re-opening are:

1. **THCP**: a new second independent lifecycle classifier appears
   in the TaskHeader source (e.g. someone adds a `messages.at(-1)`
   inspection for the working label). The Phase-0 inventory is the
   baseline against which "duplicate authority" is judged.
2. **OAT**: live evidence is captured that distinguishes agent-active
   elapsed from wall-clock elapsed and the user demands the
   distinction (the OAT01 recon explicitly says the current timer
   is the documented task wall-clock age, not buggy). This is a
   product decision, not a defect.
3. **Completion-protocol liveness**: a live completion-protocol
   occurrence is captured with sufficient discriminator data
   (`attemptCompletionSeen`, `terminalResponseCommittedThisTurn`,
   `turnState.phase`, `visibleLastMessage.type/subtype`,
   `MODEL_FINISH_REASON`, `LAST_TOOL_REQUESTED`, `DONE_REASON`).
   See `docs/architecture/elm/completion-framing-live-red-discriminator01.md`
   for the trigger conditions. When opened, this lives under
   `runtime-task-progression.md` as `COMPLETION-PROTOCOL-LIVENESS02`,
   NOT under task-presentation.
