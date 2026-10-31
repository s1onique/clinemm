# ACT-CLINEMM-BOUNDED-DUPLICATE-START-CONSERVATION-REPAIR01 — Evidence Summary

**ENTRY_HEAD:** `0366ea5064cfc03fc6693914b6b4f365c49631fc` (detached HEAD, worktree
`clinemm-m31-bounded`).

**VERDICT:** `PASS_STRUCTURAL_ONLY`. The duplicate-start conservation defect is
repaired, the repair is proven NECESSARY by a controlled ablation, and the
`apps/vscode` `src/sdk/` suite shows no regression. **Live UI acceptance was
NOT executed**, so this is NOT `PASS_LIVE`.

## The defect

`TaskTelemetryTracker.recordToolStartedWithId()` incremented the cumulative
`toolCalls` counter and the mechanism bucket BEFORE its duplicate-id check:

```ts
this.toolCalls += 1
this.mechanism = accumulateMechanism(this.mechanism, toolName)
const id = ...
if (id !== undefined && this.toolOutcomeById.has(id)) {
    return this.get()      // duplicate: counter ALREADY bumped
}
```

A REPEATED start for an already-seen authoritative `toolCallId` therefore
bumped `toolCalls` and the mechanism bucket while deliberately NOT registering
a second outcome record. The result was a divergence:

```
outcomes.total  (DISTINCT observed starts)  !=  toolCalls  (start EVENTS)
```

The webview's strict `isUsableOutcomeProjection(outcomes, toolCalls)` validator
rejects the whole projection on that divergence, silently degrading the Task
Header back to the flat counter.

## The cardinality, established from production evidence (not assumed)

A repeated `toolCallId` is DUPLICATE DELIVERY of ONE tool call — never a
separate invocation:

1. `sdk/packages/agents/src/runtime/state/task-state/update.ts` — the canonical
   TaskState reducer increments its cumulative `toolCalls` ONLY on a
   previously-unseen ID ("a re-emit of an already-active ID is a no-op for the
   counter").
2. `sdk/packages/agents/src/agent-runtime.ts` — two `tool-call-delta`s carrying
   the same id collapse into ONE assembly (the `toolAssemblies` map is keyed by
   the id), so the runtime emits exactly ONE `tool-started` per distinct call.
3. The runtime emits exactly one `tool-started` and one `onToolRuntimeOutcome`
   per execution, both carrying the same `toolCallId` — which is what makes
   id-based correlation exact.
4. The tracker's own documented contract already stated that a repeated start
   for the same id "does NOT double-register: the existing entry is left in
   place so the per-call outcome cardinality stays exactly one".

Therefore the CORRECT cardinality is: `toolCalls` counts DISTINCT tool-call
identities, exactly like `outcomes.total`.

## The bounded repair

`apps/vscode/src/sdk/task-telemetry-tracker.ts` — the duplicate-id check is
performed FIRST, and a repeated start is a complete no-op (no counter, no
mechanism bucket, no record). One statement moved; no other behaviour touched.

Deliberately UNCHANGED:
- A start WITHOUT an authoritative identity has no id to dedupe on, so it is
  still counted as its own observed start (and stays `pending` forever).
- DISTINCT ids are still counted separately.
- The mechanism projection, the outcome projection, the wire schema, the
  webview validator and the runtime are all untouched.

## Conservation invariant pinned

```
outcomes.total === toolCalls === mechanism.total
```

for every reachable sequence of tool starts.

## Gates

| Gate | Result |
|---|---|
| Focused tracker suite | `91 passed` (9 new DSC witnesses) |
| Focused tracker + wiring suites | `99 passed` (2 files) |
| RED (production reverted to HEAD) | `6 failed \| 85 passed` — DSC01, DSC02, DSC03, DSC06, DSC08, DSC09 go RED |
| Necessity ablation | removing ONLY the reorder returns exactly those 6 RED; the repair restores GREEN |
| `apps/vscode` `check-types` | PASS (exit 0) |
| Biome check on both touched files | PASS (0 errors) |
| `src/sdk/` no-regression | FAIL-file-set IDENTICAL HEAD vs AFTER; total delta +9 == the new witnesses |

## Evidence files

- `00-red-tracker.txt` — the RED run (production reverted to HEAD)
- `02-ablation-production-reverted.txt` — the controlled necessity ablation
- `03-green-tracker-and-wiring.txt` — the GREEN run
- `04-no-regression-sdk-suite.txt` — the HEAD-vs-AFTER no-regression measurement
- `05-summary.md` — this summary

## Live qualification status

NOT EXECUTED. No VSIX was built or installed and no live Task Header was
observed. The evidence above is source-level and structural only.
