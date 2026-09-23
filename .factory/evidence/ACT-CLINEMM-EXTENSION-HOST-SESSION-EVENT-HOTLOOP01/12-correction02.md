# 12 — CORRECTION02

## Reviewer verdict that triggered CORRECTION02

`HALT_EHLOOP_REPAIR_AUTHORITY_STILL_BOUND_TO_TEMP_DIAGNOSTIC`.

CORRECTION01 closed the runtime-mode inversion (P0-A, P0-B)
and narrowed the EH2 classification, but the load-bearing
invariant was still structural — the production-soundness gate
lived inside the temporary diagnostic module.

## The remaining P0 (structural ownership)

V1 + CORRECTION01 had this topology:

```
extension-host-hotloop-diagnostic.ts        (TEMPORARY)
  _queueLogEnabled
  isExtensionHostHotloopQueueLogEnabled
  setExtensionHostHotloopQueueLogEnabled
  recordExtensionHostHotloopQueueLogPermitted

dogfood-diagnostic-profile.ts
  applyExtensionHostHotloopDiagnosticProfile  (TEMPORARY helper)
    env["CLINEMM_DIAG_HOTLOOP_QUEUE_LOG"] parsed
    setExtensionHostHotloopQueueLogEnabled(true|false)

sdk-session-event-coordinator.ts
  logQueueEvents
    -> consults isExtensionHostHotloopQueueLogEnabled
       (defined inside the TEMPORARY diagnostic module)

REMOVAL_TRIGGER: remove the diagnostic module.
Post-removal state:
  - the import in logQueueEvents fails to compile, OR
  - a future cleanup edit silently removes the gate and
    resurrects the hot path
```

Both outcomes are unacceptable. The gate was a production
authority masquerading as diagnostic state.

## CORRECTION02 — ownership split

```
extension-host-queue-log-policy.ts          (PERMANENT, NEW)
  shouldEmitExtensionHostQueueLog()         <- production gate
  setExtensionHostQueueLogEnabled()
  resolveExtensionHostQueueLogFromEnv()
  applyExtensionHostQueueLogPolicy()

extension-host-hotloop-diagnostic.ts        (TEMPORARY)
  counters only (sessionEvents, logQueueEventsCalls,
                 logQueueEventsLogCalls,
                 logQueueEventsSuppressedByProfile,
                 setTurnPhaseCalls, setWithWriterCalls,
                 byEventType, byWriter, ...)
  No production gate.

dogfood-diagnostic-profile.ts
  applyExtensionHostHotloopDiagnosticProfile
    -> Gate 1 (diagnostic enablement) still owned HERE
    -> Gate 2 (queue log) delegated to permanent policy via
       applyExtensionHostQueueLogPolicy(isDogfood, env)

sdk-session-event-coordinator.ts
  logQueueEvents
    -> consults shouldEmitExtensionHostQueueLog()
       (defined inside the PERMANENT policy module)
```

## Post-removal state (now feasible)

```
REMOVE: extension-host-hotloop-diagnostic.ts
        extension-host-hotloop-diagnostic-runtime.ts
        dump command
        registry entry
        package.json command declaration

REMAIN: extension-host-queue-log-policy.ts
        the applyExtensionHostQueueLogPolicy delegation in
        dogfood-diagnostic-profile.ts
        shouldEmitExtensionHostQueueLog() in logQueueEvents
```

The production gate survives the diagnostic removal cleanly.

## Code changes

apps/vscode/src/sdk/extension-host-queue-log-policy.ts (NEW):
  + module-level state _queueLogEnabled (PERMANENT, default false)
  + shouldEmitExtensionHostQueueLog()
  + setExtensionHostQueueLogEnabled()
  + resolveExtensionHostQueueLogFromEnv(isDogfood, env)
  + applyExtensionHostQueueLogPolicy(isDogfood, env)
  + Module docstring documents the load-bearing invariant
    ("the diagnostic does NOT own this gate; this module does").

apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts:
  - removed _queueLogEnabled
  - removed isExtensionHostHotloopQueueLogEnabled
  - removed setExtensionHostHotloopQueueLogEnabled
  - removed recordExtensionHostHotloopQueueLogPermitted
  - updated module docstring: "OWNS OBSERVATION ONLY"
  - REMOVAL_TRIGGER refined to list what stays vs what goes

apps/vscode/src/sdk/dogfood-diagnostic-profile.ts:
  * removed isExtensionHostHotloopQueueLogEnabled import
  * removed setExtensionHostHotloopQueueLogEnabled import
  + import applyExtensionHostQueueLogPolicy from permanent policy
  * Gate 2 logic now delegates to applyExtensionHostQueueLogPolicy
  * docstring updated: Gate 2 is OWNED by permanent policy module

apps/vscode/src/sdk/sdk-session-event-coordinator.ts:
  * removed isExtensionHostHotloopQueueLogEnabled import
  + import shouldEmitExtensionHostQueueLog from permanent policy
  * logQueueEvents now consults shouldEmitExtensionHostQueueLog()
  * inline comment updated to reference the permanent module

apps/vscode/src/sdk/__tests__/extension-host-session-event-hotloop01.ehloop01.test.ts:
  + EHLOOP-POLICY-01: permanent policy module exists
  + EHLOOP-POLICY-02: public + env override -> never granted
  + EHLOOP-POLICY-03: dogfood default -> suppressed
  + EHLOOP-POLICY-04: dogfood + opt-in -> enabled
  + EHLOOP-POLICY-05: dogfood + non-truthy -> suppressed
  + EHLOOP-REMOVAL-01 (STRUCTURAL): removing the temp diagnostic
        must not re-open the hot path. The diagnostic is OFF
        AND the policy is OFF -> breadcrumb suppressed. The
        diagnostic is still OFF but the policy is ON -> breadcrumb
        fires. This is the load-bearing structural test.
  + EHLOOP-REMOVAL-02 (STRUCTURAL): diagnostic module does NOT
        export the legacy queue-log symbols.
  + EHLOOP-REMOVAL-03 (STRUCTURAL): the coordinator source
        imports from the permanent policy module.

## Gates

| Gate | Result |
|------|--------|
| bun test extension-host-session-event-hotloop01.ehloop01.test.ts | 21/21 PASS (was 13/13) |
| bun test focused regression | 111/112 PASS (1 pre-existing OWN01 RED probe unrelated) |
| bun --bun bunx tsc --noEmit (apps/vscode) | clean |

## Conservation (UNCHANGED from V1 + CORRECTION01)

handleSessionEvent pipeline, appendAndEmit, postStateToWebview,
setTurnPhase, setWithWriter, PendingPromptsController.drain,
notify-on-terminal, TQCB completion barrier, BTCONT deferred
continuation, CCARD ring DEFAULT_OFF, CCARD enabled does not
alter semantics, explicit user turn, fire-and-forget job,
two-job isolation - all unchanged.

## Classification (UNCHANGED from CORRECTION01)

EH1_LOG_QUEUE_EVENTS_SYNCHRONOUS_BREADCRUMB_STALL = ESTABLISHED.
EH2_REDUNDANT_STATE_WRITE_STORM = NOT_ESTABLISHED (observational
only).

## Removal trigger (corrected, FINAL)

Post-qualification, remove TOGETHER:

  - apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts
  - apps/vscode/src/sdk/extension-host-hotloop-diagnostic-runtime.ts
  - the host-side dump command
  - the registry entry
  - the package.json command declaration

  - the diagnostic enablement half of
    applyExtensionHostHotloopDiagnosticProfile
    (the queue-log delegation to applyExtensionHostQueueLogPolicy
    STAYS)

KEEP FOREVER:

  - apps/vscode/src/sdk/extension-host-queue-log-policy.ts
  - the applyExtensionHostQueueLogPolicy delegation in
    dogfood-diagnostic-profile.ts
  - shouldEmitExtensionHostQueueLog() in logQueueEvents

The permanent production rule (queue-log is DEFAULT OFF) lives
in the permanent module. Removing the diagnostic does not
silently re-arm the hot path.

## LIVE qualification (PENDING, operator-driven — UNCHANGED)

Per ACT §36 with the corrected HEAD installed:
```
CLINEMM_RUNTIME_PROFILE=dogfood CLINEMM_PTAD=1 \
    code --extensionDevelopmentPath=...
```
Run a 30-second specimen at least twice. Acceptance:
  - dogfood profile remains enabled
  - queue log hot path is suppressed/bounded (regardless of
    diagnostic state — REMOVAL-01 invariant)
  - no UNRESPONSIVE warning
  - no automatic CPU profile
  - no Extension Host restart

Then Developer: Show Running Extensions -> record a 10-20s
profile; compare against exthost-66cdb2.cpuprofile; the
logQueueEvents -> Logger.#output -> appendLine stack should
collapse materially.

## Verdict

PASS_EXTENSION_HOST_LOGGING_HOTPATH_REPAIRED
  + bounded CORRECTION01 closed P0-A / P0-B runtime-mode inversion
  + CORRECTION02 closed the structural ownership P0
  + EH2 narrowed to NOT_ESTABLISHED
  + LIVE qualification PENDING
