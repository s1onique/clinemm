# ACT-CLINEMM-BOUNDED-DUPLICATE-START-CONSERVATION-REPAIR01

**Status:** PASS_STRUCTURAL_ONLY — the duplicate-start conservation defect in
`TaskTelemetryTracker` is repaired, the repair is proven NECESSARY by a
controlled ablation, and the `apps/vscode` `src/sdk/` suite shows no
regression. Live UI acceptance was NOT executed.

**ENTRY_HEAD:** `0366ea5064cfc03fc6693914b6b4f365c49631fc`
**SUBJECT_HEAD:** the commit carrying this ACT (the one that follows the board
entry).

**Why this ACT exists.** `ACT-CLINEMM-TASK-HEADER-TOOL-OUTCOME-PROJECTION01`
published the OPTIONAL `outcomes` projection on the TaskHeader telemetry
strip. That projection's own documented conservation invariant is

```
outcomes.total === toolCalls
```

and the webview's `isUsableOutcomeProjection(outcomes, toolCalls)` validator
REJECTS the entire projection when the two disagree — degrading the header
back to the flat counter. The tracker, however, incremented `toolCalls` BEFORE
its duplicate-id check, so a repeated tool start broke that invariant.

## C1 — THE DEFECT (exact production seam)

`apps/vscode/src/sdk/task-telemetry-tracker.ts` →
`TaskTelemetryTracker.recordToolStartedWithId(toolCallId, toolName)`.

The cumulative `toolCalls` increment and the mechanism accumulation ran
BEFORE the duplicate-id check:

```ts
this.toolCalls += 1
this.mechanism = accumulateMechanism(this.mechanism, toolName)
const id = toolCallId === undefined || toolCallId === "" ? undefined : toolCallId
if (id !== undefined && this.toolOutcomeById.has(id)) {
    return this.get()      // <- duplicate: the counter was ALREADY bumped
}
```

A REPEATED start for an already-seen authoritative `toolCallId` therefore
bumped `toolCalls` and the mechanism bucket while deliberately NOT registering
a second outcome record. `outcomes.total` counts DISTINCT observed starts;
`toolCalls` counted start EVENTS. The two diverged, and the webview rejected
the whole projection.

## C2 — THE CARDINALITY, ESTABLISHED FROM PRODUCTION EVIDENCE

A repeated `toolCallId` is DUPLICATE DELIVERY of ONE tool call — never a
separate invocation. This was READ FROM PRODUCTION CODE, not assumed:

1. `sdk/packages/agents/src/runtime/state/task-state/update.ts` — the canonical
   TaskState reducer increments its cumulative `toolCalls` ONLY on a
   previously-unseen ID. Its own comment: "An unseen ID increments the
   cumulative toolCalls counter and adds to the set; a re-emit of an
   already-active ID is a no-op for the counter but also a no-op for the set
   (deduped)." (lines 263-266, 276-281)
2. `sdk/packages/agents/src/agent-runtime.ts` — two `tool-call-delta`s carrying
   the same id collapse into ONE assembly (the `toolAssemblies` map is keyed by
   the id), so the runtime emits exactly ONE `tool-started` per distinct call.
3. The runtime emits exactly one `tool-started` and one `onToolRuntimeOutcome`
   per execution, both carrying the same `toolCallId` — which is what makes
   id-based correlation exact in the first place.
4. The tracker's OWN documented contract already stated that a repeated start
   for the same id "does NOT double-register: the existing entry is left in
   place so the per-call outcome cardinality stays exactly one."

Therefore the CORRECT cardinality is: `toolCalls` counts DISTINCT tool-call
identities, exactly like `outcomes.total`. Counting the duplicate EVENT was
the defect.

## C3 — THE BOUNDED REPAIR

The duplicate-id check is performed FIRST, and a repeated start becomes a
complete no-op (no counter, no mechanism bucket, no record). One statement
moved; the surrounding contract is unchanged and now documents the reasoning.

Deliberately UNCHANGED (each is pinned by a dedicated witness):
- a start WITHOUT an authoritative identity has no id to dedupe on, so it is
  still counted as its own observed start and stays `pending` forever (DSC07);
- DISTINCT ids are still counted separately (DSC08);
- the mechanism projection (DSC03, DSC04), the outcome projection (DSC09),
  the wire schema, the webview validator and the runtime are all untouched.

The conserved invariant is now pinned as

```
outcomes.total === toolCalls === mechanism.total
```

for every reachable sequence of tool starts.

## C4 — THE WITNESSES (9, focused)

`apps/vscode/src/sdk/task-telemetry-tracker.test.ts`, in a dedicated
`describe` block:

| ID | Pins |
|---|---|
| DSC01 | a duplicate start does NOT inflate `toolCalls` |
| DSC02 | `outcomes.total` stays CONSERVED against `toolCalls` |
| DSC03 | a duplicate start does NOT inflate the mechanism projection |
| DSC04 | the mechanism projection stays USABLE (wire validator accepts it) |
| DSC05 | the pending bucket stays at ONE (no phantom pending) |
| DSC06 | the outcome correlation is undisturbed (the outcome lands once) |
| DSC07 | an UNIDENTIFIED start is still counted once per event |
| DSC08 | DISTINCT ids are still counted separately (no under-count) |
| DSC09 | the outcome projection is USABLE (the host never publishes a divergent pair) |

## C5 — RED → GREEN → ABLATION (necessity)

- **RED:** with the production file reverted to `HEAD`, the focused suite
  reports `6 failed | 85 passed` — DSC01, DSC02, DSC03, DSC06, DSC08, DSC09
  go RED. (DSC04, DSC05, DSC07 stay green: they assert the properties the
  defect did NOT break, which is exactly what makes them useful as
  no-under-count controls.)
- **GREEN:** with the repair applied, `91 passed`.
- **ABLATION:** removing ONLY the reorder returns exactly those 6 RED
  failures; the repair restores GREEN. The change is therefore NECESSARY,
  not cosmetic.

## C6 — GATES

| Gate | Result |
|---|---|
| Focused tracker suite | `91 passed` |
| Focused tracker + wiring suites | `99 passed` (2 files) |
| RED (production reverted) | `6 failed \| 85 passed` |
| Necessity ablation | exact RED set restored, then GREEN |
| `apps/vscode` `check-types` | PASS (exit 0) |
| Biome check on both touched files | PASS (0 errors) |
| `src/sdk/` no-regression (whole suite) | total +9, passed +9, failed +0, failed FILES +0 |
| `src/sdk/` no-regression (batched, per-file fail-SET) | FAIL-file-set IDENTICAL HEAD vs AFTER |

## C7 — NO-REGRESSION MEASUREMENT

The `apps/vscode` `src/sdk/` whole suite was run for BOTH arms with the SAME
command in the SAME sandbox:

```
  HEAD  (production reverted to 0366ea506, 9 DSC witnesses ABSENT)
   Test Files  110 failed | 322 passed | 5 skipped (437)
        Tests  520 failed | 4348 passed | 55 skipped (4923)

  AFTER (repair applied, 9 DSC witnesses PRESENT)
   Test Files  110 failed | 322 passed | 5 skipped (437)
        Tests  520 failed | 4357 passed | 55 skipped (4932)

  total   delta: +9   == the 9 new DSC witnesses
  passed delta: +9   == those same 9 witnesses going green
  failed delta:  0   == no test regressed
  failed FILES delta: 0 == no file entered the failing set
```

The 520 failing tests across 110 files are the STANDING BASELINE of this
tree — they reproduce with this ACT's production paths reverted to pure HEAD,
and they are NOT owned by this ACT. This is corroborated against the
predecessor ACT, which recorded the identical 4923 -> 4932 progression and
stated its own sorted FAIL sets were "496 lines each with an EMPTY diff".

A SECOND, per-file comparison was made with the JSON reporter in 13 batches
of 40 files, because the batched run survives the sandbox's vitest worker
teardown `EPERM` and compares by test id:

```
HEAD :  total 1801 | passed 1529 | failed 250
AFTER:  total 1810 | passed 1557 | failed 253
total delta: +9  == the 9 new DSC witnesses

FAIL-file-set (excluding one pre-existing flaky file):
  HEAD  count: 48
  AFTER count: 48
  ADDED (regressions): []
  REMOVED (fixed)     : []
  IDENTICAL SETS: True
```

SCOPE NOTE (honest limitation): the batched comparison covered 1810 of the
whole suite's 4932 tests — many `src/sdk` files error on import under this
sandbox and contribute no tests. The whole-suite arms above are therefore
the PRIMARY measurement (total / passed / failed / files), and the batched
comparison is the SECONDARY one that pins the exact per-file fail-SET.

ONE pre-existing failure is excluded from the per-file set and is NOT caused
by this ACT: `sdk-interaction-coordinator.session-autonomy.test.ts` fails
3/23 (a seatbelt / session-override authority failure). It was PROVEN
pre-existing by reverting the production tracker to PURE HEAD and re-running
that file isolated — it still fails 3/23, twice in a row. It does not touch
the telemetry tracker.

## C8 — PRODUCTION CHANGES

- `apps/vscode/src/sdk/task-telemetry-tracker.ts` — the duplicate-id check
  moved BEFORE the `toolCalls` increment and the mechanism accumulation in
  `recordToolStartedWithId`; the method's contract comment now records the
  cardinality and the TaskState-reducer citation.

No Elm kernel, no protocol, no webview reducer, no schema change, no runtime
change, no change to the mechanism or outcome projection semantics.

## WHAT IS STILL NOT CLAIMED

No VSIX was built or installed and no live Task Header was observed, so the
installed artifact is NOT exact-head and the acceptance above is
source-level and structural only. The live acceptance remains the outstanding
obligation.

## Evidence

- `.factory/evidence/ACT-CLINEMM-BOUNDED-DUPLICATE-START-CONSERVATION-REPAIR01/`
  (`00-red-tracker.txt`, `02-ablation-production-reverted.txt`,
  `03-green-tracker-and-wiring.txt`, `04-no-regression-sdk-suite.txt`,
  `05-summary.md`, `06-whole-suite-after.txt`)
