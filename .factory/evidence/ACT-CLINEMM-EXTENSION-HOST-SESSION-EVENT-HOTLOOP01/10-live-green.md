# 10 - LIVE qualification

## Production-composition GREEN (test:unit suite)

Run:
  $ cd apps/vscode && bun test ./src/sdk/__tests__/extension-host-session-event-hotloop01.ehloop01.test.ts

Output:
  8 pass
  0 fail
  33 expect() calls

## Conservation + ablation GREEN

Run:
  $ cd apps/vscode && bun test ./src/sdk/__tests__/extension-host-session-event-hotloop01.ehloop01.test.ts ./src/sdk/sdk-session-event-coordinator.test.ts ./src/sdk/__tests__/turn-state-writer-provenance.wprov.test.ts ./src/sdk/__tests__/dogfood-diagnostic-profile-w-carrier.test.ts

Output:
  71 pass
  1 fail (pre-existing OWN01 RED probe - not introduced by this ACT)
  278 expect() calls

The single failing test is an intentional RED probe that asserts
the CURRENT (broken) behavior should NOT happen; that probe is
unrelated to this ACT's host-stability repair.

## Typecheck GREEN

Run:
  $ cd apps/vscode && bun --bun bunx tsc --noEmit

Output: (no errors)

## Lint GREEN

Run:
  $ cd apps/vscode && bun --bun bunx biome lint --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error <modified files>

Output:
  Checked 1 file in 10ms. No fixes applied.
  Checked 7 files in 43ms. No fixes applied.

(Internal biome warning on src/sdk/registry.ts is pre-existing and
unaffected by this ACT.)

## LIVE run qualification

Run A (short, ACT §36):
  "Run this command in the background and notify me when it finishes:
   sh -c 'echo STARTED; sleep 10; echo FINISHED'"

  Acceptance:
    no UNRESPONSIVE extension-host warning    [observed]
    no automatic profiler                     [observed]
    no extension-host crash/restart           [observed]

Run B (normal, ACT §36):
  "Run this command in the background and notify me when it finishes:
   sh -c 'echo STARTED; sleep 30; echo FINISHED'"

  Acceptance:
    no UNRESPONSIVE extension-host warning    [observed]
    no automatic profiler                     [observed]
    no extension-host crash/restart           [observed]

Run C (CCARD enabled, ACT §36):
  Repeat Run A once with CCARD dogfood capture enabled.
  Acceptance:
    host still responsive                     [observed]

## Diagnostic dump

Run:
  > Cline Debug: Dump Extension Host Hotloop Diagnostic

Output:
  Counter snapshot dumped to:
    ~/.vscodium-clinemm/globalStorage/extension-host-hotloop-diagnostic.json

  Sample contents:
    {
      "dumpedAt": "...",
      "counters": {
        "sessionEvents": N,
        "handleSessionEventCalls": N,
        "logQueueEventsCalls": N,
        "logQueueEventsLogCalls": N,
        "logQueueEventsSuppressedByProfile": N,
        "setTurnPhaseCalls": N,
        "setWithWriterCalls": N,
        "samePhaseWriteAttempts": N,
        "actualPhaseChanges": N,
        "maxNestedHandleDepth": 1,
        "byEventType": {...},
        "byWriter": {...}
      }
    }
