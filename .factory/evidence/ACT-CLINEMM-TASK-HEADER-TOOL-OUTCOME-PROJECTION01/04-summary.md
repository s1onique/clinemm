# ACT-CLINEMM-TASK-HEADER-TOOL-OUTCOME-PROJECTION01 — evidence summary

## Verdict

`PASS_STRUCTURAL_ONLY` — the optional TaskHeader tool-outcome projection is
implemented, wired end-to-end, and covered by executable witnesses. **Live UI
acceptance was NOT executed** (no VS Code host was launched in this
environment), so this is NOT a `PASS_LIVE`.

## The authority model (unchanged by this ACT)

- `succeeded` / `failed` describe **RUNTIME TOOL EXECUTION**, never shell
  subprocess exit status.
- `control_plane` (host DENY, user rejection, runtime skip/abort) is a
  SEPARATE bucket. A pre-execution denial is **neither** a success **nor** a
  failure.
- `pending` = a tool start was observed but no authoritative outcome has
  arrived yet.
- `unknown` = an outcome whose kind the host could not classify. Counted
  conservatively; never folded into `succeeded` / `failed`.
- Correlation is **exclusively by `toolCallId`**. Chronological / positional
  fallback is forbidden (parallel tool batches complete out of order).

## Conservation invariants

```
total === succeeded + failed + pending + controlPlane + unknown
total === telemetry.toolCalls
```

Both are enforced on the HOST (the tracker holds exactly one record per
observed tool start, so `total === toolCalls` holds by construction) and
RE-CHECKED on the WEBVIEW (`isUsableOutcomeProjection`) before rendering.

## The two chokepoints that used to drop `onToolRuntimeOutcome`

The authoritative runtime outcome hook was being DROPPED by two SDK hook
merges, silently severing every downstream observer:

1. `sdk/packages/core/src/hooks/hook-file-hooks.ts` → `mergeAgentHooks` —
   `mergeHookFunction` only knows how to aggregate RESULT-BEARING hooks;
   `onToolRuntimeOutcome` is a VOID-return observation hook, so it was
   dropped. Fixed with a new `mergeObservationHook` FAN-OUT.
2. `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts`
   → `mergeRuntimeHooks` — same omission. Fixed with an explicit fan-out.

Both fixes preserve the hook's read-only observation contract: it never
mutates the outcome and never influences execution.

## Test results

| Suite | Command | Result |
| --- | --- | --- |
| Tracker + wiring | `bunx vitest run src/sdk/task-telemetry-tracker.test.ts src/sdk/task-tool-outcome-projection.wiring.test.ts --pool=threads` | **90/90 PASS** (11 RED→GREEN + 7 adversarial tracker + 8 wiring) |
| SDK hooks + orchestrator | `bunx vitest run src/hooks/hook-file-hooks.test.ts src/runtime/orchestration/session-runtime-orchestrator.test.ts --pool=threads` | **89 PASS / 3 FAIL** — the 3 failures are PRE-EXISTING (reproduced with this ACT's paths stashed; see `02-green-sdk-hooks-and-orchestrator.txt`) |
| Webview task-header family | `bunx vitest run src/components/chat/task-header/ --pool=threads` | **176/176 PASS** (53 helpers incl. 8 new outcome validators + 53 component incl. 7 new rendering tests) |
| Typecheck | `bun run check-types` (apps/vscode) | **PASS** (exit 0) |
| SDK build | `bun run build:sdk` | **PASS** |
| Webview build | `bun run build:webview` | **PASS** |

## No-regression measurement

The `src/sdk/` suite was measured BEFORE and AFTER this ACT by stashing ONLY
this ACT's paths and diffing the sorted `FAIL` lines. The two sets are
IDENTICAL (496 lines each, empty diff):

```text
ADDED failures (regressions): 0
REMOVED failures (fixed):     0
IDENTICAL SETS:                True
```

## Evidence files

- `00-red-tracker.txt` — the genuine RED (all 11 new tracker tests failed with
  `TypeError: t.recordToolStartedWithId is not a function` while the 64
  pre-existing tests passed).
- `01-green-tracker-and-wiring.txt` — 90/90 GREEN.
- `02-green-sdk-hooks-and-orchestrator.txt` — 89 PASS / 3 pre-existing FAIL.
- `03-green-webview.txt` — 176/176 GREEN.

## Production changes

- `apps/vscode/src/sdk/task-telemetry-tracker.ts` — `ToolOutcomeKind`,
  `classifyToolOutcomeKind`, `ToolOutcomeRecord`, `recordToolStartedWithId`,
  `recordToolOutcome`, `buildOutcomeSummary`, the optional `outcomes` wire
  field, and the task-reset / clear semantics.
- `apps/vscode/src/sdk/sdk-session-config-builder.ts` — attaches the
  read-only `onToolRuntimeOutcome` observer to the session hook bag.
- `apps/vscode/src/sdk/SdkController.ts` — records the tool start WITH its
  authoritative id (no double-count) and correlates the runtime outcome BY
  id onto the tracker.
- `apps/vscode/src/shared/ExtensionMessage.ts` — the `ToolOutcomeSummary`
  wire type and the optional `outcomes` field.
- `sdk/packages/core/src/hooks/hook-file-hooks.ts` — `mergeObservationHook`
  fan-out (chokepoint 1).
- `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts`
  — `mergeRuntimeHooks` fan-out (chokepoint 2).
- `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts`
  — `isUsableOutcomeProjection` wire-boundary validator.
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`
  — the conservative outcome rendering with the V1 flat fallback.

## The environment limitation is recorded, not masked

No VSIX was built or installed and NO LIVE re-run of the Task Header was
performed, so the closure is `PASS_STRUCTURAL_ONLY`, NOT `PASS_LIVE`. The
live acceptance remains the outstanding obligation.
