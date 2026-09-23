# ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01 / CORRECTION01

## TL;DR

The V1 closure of this ACT was HALTED by the Factory causal
reviewer with verdict `HALT_EHLOOP_DOGFOOD_REPAIR_FALSE_GREEN`.
The reviewer correctly identified three P0 contradictions in the
V1 repair:

  P0-A. The repair was DISABLED exactly where the LIVE failure
         occurred. The `logQueueEvents` Logger.log gate was
         controlled by `isExtensionHostHotloopDiagnosticEnabled()`,
         which is itself driven by the dogfood profile. Since the
         LIVE failure was captured in the dogfood profile
         (`CLINEMM_RUNTIME_PROFILE=dogfood`), the gate was
         effectively OPEN in the exact runtime that needed the
         repair.

  P0-B. The ablation reversed RED/GREEN relative to the real
         problem. The test defined "diagnostic OFF = repaired"
         and "diagnostic ON = expensive". The LIVE failure was
         in the diagnostic-ON state (dogfood); the repair
         therefore required diagnostic-OFF, which only happens
         in the public profile.

  P0-C. The temporary diagnostic became the production-repair
         authority. `logQueueEvents` was using the diagnostic
         enablement bit as its production-soundness gate. If the
         diagnostic is ever removed (per the ACT REMOVAL_TRIGGER),
         the hot path silently returns.

  P1.   The V1 result.json listed `EH2_REDUNDANT_STATE_WRITE_STORM`
         as a root class, but the V1 packet itself observed
         `setWithWriterCalls = 302` with `~0.5 writes per
         handleSessionEvent` and explicitly stated "NOT a write
         storm". The classification was not established by the
         V1 evidence.

## CORRECTION01 bounded change

### The decoupled gate (the load-bearing fix)

The V1 single gate (`isExtensionHostHotloopDiagnosticEnabled()`)
is split into TWO independent gates:

  Gate 1 (counters / phase writes): defaulted by dogfood. Cheap.
       The diagnostic may be removed post-qualification without
       affecting production soundness.

  Gate 2 (synchronous queue-log breadcrumb): DEFAULT OFF in every
       profile. Honored ONLY in dogfood when the operator
       explicitly sets `CLINEMM_DIAG_HOTLOOP_QUEUE_LOG=<truthy>`.
       Public installs can never grant this regardless of env.

The two are decoupled so removing the diagnostic does NOT silently
re-arm the hot path. The permanent production rule is encoded in
the runtime side, not in the diagnostic.

### What changed in code

apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts
  + new module-level state _queueLogEnabled
  + new accessors isExtensionHostHotloopQueueLogEnabled()
  + new mutator setExtensionHostHotloopQueueLogEnabled()
  + new counter recordExtensionHostHotloopQueueLogPermitted()
  + module docstring expanded to document the two-gate invariant

apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  * logQueueEvents now consults isExtensionHostHotloopQueueLogEnabled()
    (independent of the diagnostic enablement bit) BEFORE any
    Logger.log call. The breadcrumb is suppressed by the permanent
    production rule in dogfood default and in public; it is
    permitted only when an explicit opt-in env knob is set.

apps/vscode/src/sdk/dogfood-diagnostic-profile.ts
  * applyExtensionHostHotloopDiagnosticProfile now resolves TWO
    gates from the environment:
      - CLINEMM_DIAG_HOTLOOP_DIAGNOSTIC (diagnostic on/off)
      - CLINEMM_DIAG_HOTLOOP_QUEUE_LOG (queue-log opt-in)
    Public profile can never grant the queue-log gate.
    Dogfood + no env var -> counters ON, log suppressed (default).
    Dogfood + CLINEMM_DIAG_HOTLOOP_QUEUE_LOG=1 -> counters ON, log on.

apps/vscode/src/sdk/__tests__/extension-host-session-event-hotloop01.ehloop01.test.ts
  + EHLOOP-PROFILE-01..04: profile resolution gates
  * EHLOOP-RED-01 rewritten: real dogfood, no opt-in -> log suppressed
  + EHLOOP-RED-02: public profile -> log suppressed (unchanged from V1)
  * EHLOOP-ABLATION-01 rewritten: same installed dogfood profile,
    only the queue-log opt-in changes the breadcrumb
  * EHLOOP-CTL-09 rewritten: counters ON does not imply breadcrumb ON
  + CTL-01/02/04/05/08/10: controls preserved from V1

### What did NOT change

apps/vscode/src/extension.ts (activation wiring + dump command)
apps/vscode/src/registry.ts (DumpExtensionHostHotloopDiagnostic id)
apps/vscode/package.json (dumpExtensionHostHotloopDiagnostic command)
apps/vscode/src/sdk/extension-host-hotloop-diagnostic-runtime.ts (dump)
apps/vscode/src/sdk/turn-state-tracker.ts (EH2 observational witness)

## New test family (13 cases, all PASS)

  EHLOOP-CTL-08               (DEFAULT_OFF state)
  EHLOOP-PROFILE-01..04       (activation helper gates)
  EHLOOP-RED-01 / RED-02      (production soundness: log suppressed
                                in real dogfood and in public)
  EHLOOP-ABLATION-01          (3-round A/B/C ablation under same
                                installed dogfood profile)
  EHLOOP-CTL-09               (counters armed, breadcrumb suppressed)
  EHLOOP-CTL-04 / 05          (drain counter hooks bounded)
  EHLOOP-CTL-10               (state-semantic delta == 0)
  EHLOOP-COMPOSE-01           (production composition)
  EHLOOP-CTL-01 / 02          (ordinary session events work)

## Conservation (UNCHANGED)

The handleSessionEvent pipeline, appendAndEmit, postStateToWebview,
setTurnPhase, setWithWriter, PendingPromptsController.drain,
notify-on-terminal, TQCB completion barrier, BTCONT deferred
continuation, CCARD ring DEFAULT_OFF, CCARD enabled does not
alter semantics, explicit user turn, fire-and-forget job, two-job
isolation - all unchanged.

## Removal trigger (corrected)

The diagnostic counters + activation helper + dump runtime +
Command Palette registration + registry entry + package.json
command declaration MUST be removed TOGETHER post-qualification.
The permanent production rule (queue-log opt-in is DEFAULT OFF in
every profile) remains in `logQueueEvents` regardless of whether
the diagnostic is removed. The removal therefore cannot resurrect
the hot path.

## LIVE qualification (PENDING - operator-driven)

Per ACT §36, the LIVE qualification must be executed by an
operator with the corrected HEAD installed:

  CLINEMM_RUNTIME_PROFILE=dogfood CLINEMM_PTAD=1 \
      code --extensionDevelopmentPath=... <some-folder>

Run a 30-second specimen at least twice:

  sh -c 'echo STARTED; sleep 30; echo FINISHED'

Acceptance:
  - dogfood profile remains enabled
  - queue log hot path is suppressed/bounded
  - no UNRESPONSIVE warning
  - no automatic CPU profile
  - no Extension Host restart

Then use `Developer: Show Running Extensions` to deliberately
record a short post-repair CPU profile; the
`logQueueEvents -> Logger.#output -> appendLine` stack should
collapse materially.

## Verdict

PASS_EXTENSION_HOST_LOGGING_HOTPATH_REPAIRED
   = V1's V1-PASS-with-claim + bounded correction to remove the
     three P0 contradictions + EH2 narrowed to NOT_ESTABLISHED +
     LIVE qualification PENDING.
