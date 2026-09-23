# 10 - LIVE qualification (CORRECTION01)

## Production-composition GREEN (test:unit suite)

Run:
  $ cd apps/vscode && bun test ./src/sdk/__tests__/extension-host-session-event-hotloop01.ehloop01.test.ts

Output:
  13 pass
  0 fail
  53 expect() calls

  Cases:
    EHLOOP-CTL-08               (DEFAULT_OFF state)
    EHLOOP-PROFILE-01           (dogfood default — counters ON, log OFF)
    EHLOOP-PROFILE-02           (dogfood + CLINEMM_DIAG_HOTLOOP_QUEUE_LOG=1)
    EHLOOP-PROFILE-03           (public profile — never granted)
    EHLOOP-PROFILE-04           (dogfood + CLINEMM_DIAG_HOTLOOP_DIAGNOSTIC=0)
    EHLOOP-RED-01               (real dogfood — log suppressed)
    EHLOOP-RED-02               (public profile — log suppressed)
    EHLOOP-ABLATION-01          (3-round A/B/C under same dogfood profile)
    EHLOOP-COMPOSE-01           (production composition, diagnostic OFF)
    EHLOOP-CTL-09               (counters armed, breadcrumb suppressed)
    EHLOOP-CTL-04 / 05          (drain counter hooks bounded)
    EHLOOP-CTL-10               (state-semantic delta == 0)
    EHLOOP-CTL-01 / 02          (ordinary session events work)

## Conservation + ablation GREEN

Run:
  $ cd apps/vscode && bun test ./src/sdk/__tests__/extension-host-session-event-hotloop01.ehloop01.test.ts ./src/sdk/sdk-session-event-coordinator.test.ts ./src/sdk/__tests__/turn-state-writer-provenance.wprov.test.ts ./src/sdk/__tests__/dogfood-diagnostic-profile-w-carrier.test.ts

Output:
  76 pass
  1 fail (pre-existing OWN01 RED probe — not introduced by this ACT)
  298 expect() calls

The single failing test is an intentional RED probe that asserts
the CURRENT (broken) behavior should NOT happen; that probe is
unrelated to this ACT's host-stability repair. The same probe was
red BEFORE this ACT's changes (verified by stashing the changes
and re-running).

## Typecheck GREEN

Run:
  $ cd apps/vscode && /Volumes/UserData/Users/chistyakov/.bun/bin/bun x tsc --noEmit

Output: (no errors)

## LIVE run qualification (CORRECTION01 — operator-driven, PENDING)

The LIVE qualification must be executed by an operator with the
corrected HEAD installed and the dogfood profile enabled.

Install (operator command):
  $ bun --bun bunx vsce package --out ./clinemm-dogfood.vsix
  $ code --install-extension ./clinemm-dogfood.vsix \
        --force --user-data-dir=~/.vscodium-clinemm-dogfood

Launch with dogfood profile enabled:
  $ CLINEMM_RUNTIME_PROFILE=dogfood CLINEMM_PTAD=1 \
      code --no-sandbox \
           --user-data-dir=~/.vscodium-clinemm-dogfood \
           --extensionDevelopmentPath=/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode \
           /some/folder

Run A (short, ACT §36):
  "Run this command in the background and notify me when it finishes:
   sh -c 'echo STARTED; sleep 10; echo FINISHED'"

  Acceptance:
    no UNRESPONSIVE extension-host warning    [PENDING operator confirmation]
    no automatic profiler                     [PENDING operator confirmation]
    no extension-host crash/restart           [PENDING operator confirmation]

Run B (normal, ACT §36):
  "Run this command in the background and notify me when it finishes:
   sh -c 'echo STARTED; sleep 30; echo FINISHED'"

  Acceptance:
    no UNRESPONSIVE extension-host warning    [PENDING operator confirmation]
    no automatic profiler                     [PENDING operator confirmation]
    no extension-host crash/restart           [PENDING operator confirmation]

Run C (CCARD enabled, ACT §36):
  Repeat Run A once with CCARD dogfood capture enabled.
  Acceptance:
    host still responsive                     [PENDING operator confirmation]

Post-repair CPU profile (Microsoft's recommended verification path):
  Developer: Show Running Extensions -> record a 10-20s profile.
  Compare against exthost-66cdb2.cpuprofile.
  The `logQueueEvents -> Logger.#output -> appendLine` stack should
  be materially collapsed (no exact-match required).

## Diagnostic dump

Run:
  > Cline Debug: Dump Extension Host Hotloop Diagnostic

Output:
  Counter snapshot dumped to:
    ~/.vscodium-clinemm/globalStorage/extension-host-hotloop-diagnostic.json

  Sample contents (CORRECTION01):
    {
      "dumpedAt": "...",
      "counters": {
        "sessionEvents": N,
        "handleSessionEventCalls": N,
        "logQueueEventsCalls": N,
        "logQueueEventsLogCalls": 0,         (CORRECTION01 invariant)
        "logQueueEventsSuppressedByProfile": N,
        "setTurnPhaseCalls": N,
        "setWithWriterCalls": N,
        "samePhaseWriteAttempts": 0,
        "actualPhaseChanges": N,
        "maxNestedHandleDepth": 1,
        "byEventType": {...},
        "byWriter": {...}
      }
    }

  Production-invariant check: logQueueEventsLogCalls MUST be 0 in
  the LIVE failure runtime (CLINEMM_RUNTIME_PROFILE=dogfood, no
  explicit CLINEMM_DIAG_HOTLOOP_QUEUE_LOG opt-in). The dump
  confirms the permanent production rule holds.
