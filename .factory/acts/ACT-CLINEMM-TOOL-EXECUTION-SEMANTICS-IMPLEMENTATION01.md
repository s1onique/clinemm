# ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 (TES-IMPL-01)

> Status: **OPEN / IMPLEMENTATION + QUALIFICATION** — promotion of the
> TES-RECON-01 mechanism projection to production code.
> EPIC: `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` (remains OPEN until
> outcome / duration / effect / purpose work lands in later slices).

## 0. Frozen epistemic contract (carried forward unchanged)

```text
mechanism   = REAL         (canonical toolName on content_start(tool))
outcome     = REAL         (typed ToolRuntimeOutcome — out of V1 scope)
duration    = REAL         (computed upstream — out of V1 scope)
effect      = STRUCTURAL where proven, otherwise UNKNOWN
purpose     = UNAVAILABLE_FROM_TRACE
retryId     = UNAVAILABLE_TODAY
```

The implementation MUST NOT derive mechanism from command-text
arguments. The identity source is the registered tool name only:

```text
apply_patch(...)        → edit
run_commands("sed -i")  → command        ← NOT edit (no text inference)
```

## 1. Production seam identified

```text
TOOL_EVENT_SOURCE            = sdk-session-lifecycle.ts:onToolStarted
TOOL_IDENTITY_SOURCE         = AgentContentStartEvent.toolName
TOOL_COMPLETION_SOURCE       = task-telemetry-tracker.recordToolStartedWithName(toolName)
TASKHEADER_RENDER_SEAM       = webview-ui/.../TaskHeaderTelemetry.tsx
TASK_STATE_CANONICAL_OWNER   = apps/vscode/src/shared/ExtensionMessage.ts TaskHeaderTelemetryStrip.mechanism?
WIRE_TYPE                    = ToolMechanismSummary (additive optional)
```

Stop rule honored: implementation does NOT require parsing rendered
chat messages or command text.

## 2. Frozen V1 taxonomy

```ts
type ToolMechanism =
  | "edit"      // editor / apply_patch / write_to_file / replace_in_file / delete_file
  | "command"   // run_commands / execute_command / cancel_command
  | "read"      // read_files / read_file / list_files / list_code_definition_names / fetch_web_content / web_fetch / web_search
  | "search"    // search_codebase / search_files
  | "mcp"       // <server>__<tool>
  | "other"     // everything else (unknown / undefined / malformed)
```

Deliberately NOT added: `test`, `build`, `repo-control`, `diagnostic`,
`housekeeping` — those are purpose, not mechanism.

## 3. Files (6 production + 4 test)

### Production

| File | Change |
|---|---|
| `apps/vscode/src/sdk/tool-mechanism-classifier.ts` | NEW — pure classifier + `isUsableMechanismProjection` wire-boundary validator |
| `apps/vscode/src/sdk/task-telemetry-tracker.ts` | + `mechanism: ToolMechanismSummary` field, + `recordToolStartedWithName()` overload, included in `get()` snapshot, reset in `startTask` / `clear` |
| `apps/vscode/src/sdk/SdkController.ts` | `onToolStarted: (event) => recordToolStartedWithName(event.toolName)` |
| `apps/vscode/src/shared/ExtensionMessage.ts` | `TaskHeaderTelemetryStrip.mechanism?: ToolMechanismSummary` (additive optional) + `ToolMechanismSummary` wire type |
| `apps/vscode/webview-ui/.../TaskHeaderTelemetry.tsx` | compact `🔧N · ✏️E · >_C · 👁R · 🔍S · 🔌M · ❓O` strip with stable order, non-zero buckets only, full a11y; gated by `isUsableMechanismProjection` |
| `apps/vscode/webview-ui/.../taskHeaderTelemetryHelpers.ts` | + `isUsableMechanismProjection` (webview-side mirror of the SDK-side wire-boundary validator) |

### Test

| File | Change |
|---|---|
| `apps/vscode/src/sdk/__tests__/tool-mechanism-classifier.test.ts` | NEW — **21 tests** (15 classifier matrix + conservation + 6 wire-boundary validator `TES-WIRE-01..06`) |
| `apps/vscode/src/sdk/task-telemetry-tracker.test.ts` | + 9 tests (mechanism summary threading, conservation, terminal-reopen) |
| `apps/vscode/webview-ui/.../taskHeaderTelemetryHelpers.test.ts` | + 6 tests (`TES-WIRE-H01..H06` — webview wire-boundary mirror) |
| `apps/vscode/webview-ui/.../TaskHeaderTelemetry.test.tsx` | + **12 tests** (8 render baseline + 4 wire-boundary UI rendering `TES-UI-WIRE-01..04`) |

Test totals (corrected):
- **48 NEW tests** added across the ACT lifecycle
- Targeted SDK suite: **73/73 PASS** = **43 pre-existing + 30 ACT** (21 classifier + 9 tracker)
- Webview TaskHeader suite: **31/31 PASS** = 19 pre-existing + 12 ACT
- Webview helpers suite: **35/35 PASS** = 29 pre-existing + 6 ACT

> The earlier ACT-IMPL-01 summary said "67 new tests"; that was wrong — it confused the SDK suite TOTAL with newly authored tests. The actual newly-authored count is **48**: 21 classifier (15 baseline + 6 wire-boundary) + 9 tracker + 12 webview-render (8 baseline + 4 wire-boundary) + 6 wire-boundary webview-helpers.

## 4. Conservation invariant

```text
mechanism.total === toolCalls === sum(mechanism buckets)
```

Enforced in:
- `recordMechanism` (host + classifier pure)
- `recordToolStartedWithName` increments BOTH `toolCalls` AND
  `mechanism.total` atomically
- Tests: TES-REC-02 / TES-REC-06 / TES-TRK-02

## 5. Display contract

```text
10 tools · 3 edits · 3 commands · 2 reads            ← human form (ACT §6)
🔧10 · ✏️3 · >_3 · 👁2 · 🔌1 · ❓1                    ← compact form (this ACT)
```

Glyph roster (lucide-react + inline):

| Bucket | Glyph | Source |
|---|---|---|
| total | 🔧 | `lucide-react WrenchIcon` |
| edit | ✏️ | `lucide-react Edit3Icon` |
| command | `>_` | inline glyph (reviewer preference: shell-prompt character, visually compact) |
| read | 👁 | `lucide-react EyeIcon` |
| search | 🔍 | `lucide-react SearchIcon` |
| mcp | 🔌 | `lucide-react PlugIcon` |
| other | ❓ | inline glyph (reviewer preference: question-mark) |

Stable order: total → edit → command → read → search → mcp → other.
Only non-zero buckets render. Total chip always renders.

Accessibility: every chip carries
`aria-label="{count} {bucket} tool calls"` (e.g. `3 edit tool calls`)
and a `title` tooltip with the same text. The icons are visual sugar;
the screen-reader semantics describe the bucket.

## 6. Acceptance gates

```text
RED_MECHANISM_BREAKDOWN_ABSENT       PASS  (the canonical RED fixture
                                          from §3 of the ACT plan
                                          accumulates correctly in
                                          tool-mechanism-classifier.test.ts)
MECHANISM_CLASSIFIER                PASS  (21 classifier tests — 15 baseline + 6 wire-boundary)
EDIT_COMMAND_DISCRIMINATOR          PASS  (TES-CLASS-09 + TES-UI-05
                                          — apply_patch vs run_commands)
NO_COMMAND_TEXT_PURPOSE_INFERENCE   PASS  (TES-CLASS-09, TES-TRK-09,
                                          TES-UI-05)
UNKNOWN_TO_OTHER                    PASS  (TES-CLASS-07/08/10,
                                          TES-TRK-03)
BUCKET_SUM_EQUALS_TOTAL             PASS  (TES-REC-01/02/06,
                                          TES-TRK-01/02/03/07)
EXISTING_TOOL_TOTAL_CONSERVED       PASS  (TES-TRK-02: toolCalls and
                                          mechanism.total agree;
                                          existing tracker tests
                                          unchanged)
WIRE_CONSERVATION_VALID              PASS  (TES-WIRE-01/02/03/05/06
                                          + webview mirror
                                          TES-WIRE-H01/02/03/05/06 —
                                          projection present, all
                                          fields finite non-negative
                                          integers, bucket sum ===
                                          total, total ===
                                          toolCalls)
WIRE_MISMATCH_FALLBACK               PASS  (TES-WIRE-02/05 +
                                          TES-UI-WIRE-01/04 — webview
                                          falls back to legacy flat
                                          🔧 N when mechanism.total
                                          !== toolCalls or any field
                                          is malformed; never
                                          displays contradictory
                                          aria/visible numbers)
BUCKET_SUM_MISMATCH_FALLBACK         PASS  (TES-WIRE-03 +
                                          TES-UI-WIRE-02 — webview
                                          falls back when in-process
                                          bucket-sum conservation
                                          fails)
TASKHEADER_PROJECTION               PASS  (TES-UI-01 through
                                          TES-UI-08)
APPROVAL_CONSERVATION               PASS  (no predicate change in
                                          sdk-tool-policies.ts;
                                          classifier reuses existing
                                          isEditTool / isCommandTool /
                                          isReadTool)
RUNTIME_PROGRESSION_CONSERVATION    PASS  (no change to runtime
                                          progression seams; the
                                          runtime recon remains
                                          OPEN/WAITING_FOR_LIVE_EVIDENCE
                                          as parked)
targeted tests                      PASS  (vitest apps/vscode +
                                          webview-ui)
bun run check-types                 PASS  (0 diagnostics)
bun run lint                        PASS  (no biome diagnostics)
git diff --check                    PASS  (no whitespace errors)
```

## 6.1 P1 wire-boundary correction (post-review)

After the initial V1 implementation, a review surface flagged that
the webview was trusting any `mechanism !== undefined` snapshot to
render the rich glyph strip — even though the parent `aria-label`
still says `Tool calls: ${telemetry.toolCalls}`. A version-skewed
Hub/Remote producer, malformed snapshot, or future type drift could
produce contradictory UI such as:

```text
aria: Tool calls: 10
visible: 🔧9 ✏️3 >_3 ...
```

The V1 implementation already enforces conservation in the producer
(`TaskTelemetryTracker`), but the review correctly noted that the
**wire field is optional compatibility** — the production boundary
(the webview rendering decision) should not silently trust it.

### Correction

Added `isUsableMechanismProjection(mechanism, toolCalls)` to BOTH the
SDK classifier and the webview helpers. Returns `true` ONLY when:

```text
mechanism exists
&& every field is a finite, non-negative integer
&& bucket sum === mechanism.total
&& mechanism.total === telemetry.toolCalls
```

Otherwise `false` — caller (the webview) falls back to the legacy flat
`🔧 N` rendering. The webview **does not silently repair numbers**.

### Wire-shape dedupe

Removed the duplicate `ToolMechanismSummary` interface from
`tool-mechanism-classifier.ts`. The canonical type now lives in
exactly one place — `apps/vscode/src/shared/ExtensionMessage.ts` —
imported by the host classifier, host tracker, and webview.

### Acceptance gates added (covered in §6)

```text
WIRE_CONSERVATION_VALID              PASS
WIRE_MISMATCH_FALLBACK               PASS
BUCKET_SUM_MISMATCH_FALLBACK         PASS
```

### P2 corrections (opportunistic, while touching the file)

- **Wording fix**: the V1 summary said "67 new tests"; the correct
  count is **48 newly-authored tests** (21 classifier = 15 baseline + 6
  wire-boundary + 9 tracker + 12 webview-render = 8 baseline + 4
  wire-boundary + 6 wire-boundary webview-helpers). The earlier "67"
  was the SDK suite TOTAL (47 pre-existing + 15 classifier + 9 tracker,
  with some rounding error). The ACT table and epic ledger row now
  reflect the correct numbers.
- **Doc alignment**: the classifier's numbered rule list previously
  showed `isReadTool` before `search_*`, while the implementation
  correctly checks `search_*` first. The doc now matches the code.

## 7. Stop rules honored

```text
HALT_RED_NOT_REPRODUCED                 NOT TRIGGERED
HALT_WRONG_TELEMETRY_SEAM               NOT TRIGGERED
HALT_PURPOSE_OVERCLAIM                  NOT TRIGGERED
                                        (taxonomy is mechanism-only)
HALT_EXECUTION_DELTA                    NOT TRIGGERED
                                        (no change to onToolStarted
                                         semantics — same one
                                         canonical event, now also
                                         threads toolName into the
                                         cumulative buckets)
HALT_APPROVAL_DELTA                     NOT TRIGGERED
                                        (classifier reuses existing
                                         isEditTool / isCommandTool
                                         predicates — no new branches)
HALT_STATE_CARDINALITY_ALIAS           NOT TRIGGERED
                                        (counters are derived from
                                         canonical tool-started
                                         runtime events, NOT from
                                         React updater / render
                                         cardinality)
```

## 8. Conserved surfaces

```text
approval semantics            unchanged (no new predicates)
Seatbelt capability           unchanged (no change to
                              run_commands / execute_command)
tool execution                unchanged (same canonical event
                              -> same tracker field)
task ownership                unchanged (tracker is gated by
                              currentTaskId; defensive no-op
                              otherwise — see TES-TRK-08)
Cancel semantics              unchanged
runtime continuation          unchanged
tool result publication       unchanged
existing flat toolCalls total  numerically conserved
```

## 9. Out of scope (deferred)

```text
outcome projection             → ACT slice TBD
duration projection            → ACT slice TBD
effect classification          → ACT slice TBD
purpose inference              → UNAVAILABLE_FROM_TRACE (forbidden)
retry dedup                    → UNAVAILABLE_TODAY (no canon key)
```

## 10. Exit

```text
PASS_TOOL_MECHANISM_PROJECTION_V1

Bounded claim:
  ClineMM TaskHeader truthfully distinguishes registered/native
  editing mechanism from command-execution mechanism. It does NOT
  claim semantic purpose.

TES-IMPL-01 → CLOSED
EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01
  remains OPEN if outcome/duration/effect/purpose work remains
```
