ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / CORRECTION03
=====================================================================

Verdict: PASS_BACKGROUND_NOTIFY_ON_TERMINAL_CORRECTION03_PRODUCTION_QUALIFIED
Reviewer: Factory causal reviewer; TypeScript/runtime engineer
Reviewer HALT: HALT_NOTIFY_ON_TERMINAL_REAL_BRIDGE_STILL_UNPROVEN
                (against correction02)

correction03 closes both P0 defects the reviewer flagged in
correction02's evidence. Each defect is addressed by a named,
scoped fix. The architectural design (bounded opt-in notify
on terminal, EPHEMERAL_ONLY, PendingPromptsController transport,
sessionId+taskId owner key, NO epoch) is RETAINED - only the
execution proof is strengthened.

----------------------------------------------------------------------
DEFECT: P0 - BCNT-WIRE-02 did not exercise the production callback
----------------------------------------------------------------------

correction02's BCNT-WIRE-02 reimplemented the SdkController closure
body inside the test:

  enqueueTerminalWake: ({ sessionId: wakeSessionId, prompt }) => {
      const active = activeSession
      if (!active || active.sessionId !== wakeSessionId) return
      void active.sdkHost.send({ sessionId: wakeSessionId, prompt, delivery: "queue" })
        .catch(...)
  }

The reviewer's HALT_NOTIFY_ON_TERMINAL_REAL_BRIDGE_STILL_UNPROVEN
correctly flagged this as a MIRRORED closure, not the ACTUAL one.
correction02's evidence said "closure that mirrors the production
shape" - and a mirror is not the original.

The proof composition was:

  real coordinator
  -> TEST-REIMPLEMENTED SdkController-shaped closure
  -> mock sdkHost.send

BCNT-WIRE-02 in isolation proved the coordinator's wake-eligibility
policy AND a closure shape that LOOKS LIKE the production one, but
NOT that the actual SdkController instance wires its actual closure
correctly.

----------------------------------------------------------------------
FIX: BCNT-WIRE-03 extracts the production callback into a named,
exported factory; the bridge test drives that factory directly
----------------------------------------------------------------------

REFACTOR (production, byte-identical behavior):

apps/vscode/src/sdk/SdkController.ts now exports a module-scope
named function:

  export function buildSdkControllerEnqueueTerminalWake(options: {
      getActiveSession: () => ActiveSession | undefined
      logger: { warn: (message: string) => void }
  }): (input: { sessionId: string; prompt: string }) => void {
      return ({ sessionId, prompt }) => {
          const active = options.getActiveSession()
          if (!active || active.sessionId !== sessionId) return
          try {
              void active.sdkHost.send({ sessionId, prompt, delivery: "queue" })
                .catch((error: unknown) => {
                    options.logger.warn(`...send() rejected for sessionId=${sessionId}...`)
                })
          } catch (error) {
              options.logger.warn(`...send() threw for sessionId=${sessionId}...`)
          }
      }
  }

The Controller constructor (~line 1076) now calls this factory
with the production seams:

  enqueueTerminalWake: buildSdkControllerEnqueueTerminalWake({
      getActiveSession: () => this.sessions?.getActiveSession(),
      logger: Logger,
  }),

The closure body is byte-identical to what the constructor used
inline (before the extraction). This is the SAME pattern that
ALREADY exists in the same file at
  buildSdkControllerEvaluateCommandToolApproval
(SdkController.ts:367), which has the explanatory comment:

  "Extracted into a named exported function so tests can exercise
   the ACTUAL callback composition (not a mirrored one)."

correction03 follows the existing pattern.

----------------------------------------------------------------------
TEST: BCNT-WIRE-03 (6 tests) drives the REAL factory
----------------------------------------------------------------------

apps/vscode/src/sdk/__tests__/background-command-notify-on-terminal01
.bcnt01-wire-03-real-callback.c24-c-bridge.test.ts imports the REAL
factory:

  import { buildSdkControllerEnqueueTerminalWake } from "@/sdk/SdkController"

and asserts (all 6 PASS):

  1. routes the wake to active session's sdkHost.send({delivery: 'queue'})
     - constructs the REAL factory with a fake getActiveSession
       (one-element active slot) and a fake logger
     - calls wake({sessionId, prompt})
     - asserts the mock sdkHost.send was called with
       { sessionId, prompt, delivery: 'queue' }
     - asserts no warn was logged
     ---> proves the active-session path routes correctly

  2. silent-drops when active sessionId != wake sessionId
     - active session is "sess-A"; wake sessionId is "sess-DIFFERENT"
     - asserts mock sdkHost.send was NOT called
     - asserts no warn was logged
     ---> proves the owner-mismatch path silently drops

  3. silent-drops when there is no active session
     - active slot is undefined; wake sessionId is "sess-A"
     - asserts no warn was logged
     ---> proves the no-active-session path silently drops

  4. logs warn on send() promise rejection and does not throw
     - mock sdkHost.send rejects with "downstream queue full"
     - asserts warn was called with "send() rejected", sessionId, and the
       rejection message
     ---> proves the rejection-swallowing path

  5. logs warn on send() synchronous throw and does not throw
     - mock sdkHost.send throws synchronously
     - asserts wake() did not throw
     - asserts warn was called with "send() threw", sessionId, and the
       throw message
     ---> proves the sync-throw-swallowing path

  6. re-reads the active session at wake time (not at factory construction)
     - factory constructed with no active session
     - first wake() silent-drops (no active)
     - active session set after construction
     - second wake() routes correctly
     ---> proves the factory captures the getActiveSession seam as a
       closure, not a static snapshot

Run command:
  bun run test:vitest:c2-4-c-bridge \\
    src/sdk/__tests__/background-command-notify-on-terminal01.bcnt01-wire-03-real-callback.c24-c-bridge.test.ts
  -> Test Files: 1 passed (1)
  -> Tests:      6 passed (6)

----------------------------------------------------------------------
DEFECT: P0 - pre-repair RED was structural absence, not behavioral RED
----------------------------------------------------------------------

correction02's pre-repair RED probe at ddcf1ad4 establishes only:

  notifyOnCompletion symbol absent
  coordinator module absent
  wake wiring absent

That is STRUCTURAL ABSENCE, not:

  parent production runtime + equivalent notify request/stimulus
  + real background terminal event -> zero PendingPrompts wake

correction02's evidence acknowledged this:

  "the pre-repair RED is not a wake-count assertion - it is an
   ABSENCE-WITNESS"

That makes correction02 honest, but the reopen condition
(parent RED reproduction) was never fully satisfied.

----------------------------------------------------------------------
FIX: option B reclassification (per reviewer preference)
----------------------------------------------------------------------

This ACT implements a NEWLY FROZEN contract
(WS-B_EXPLICIT_NOTIFY_ON_TERMINAL), not a behavior the old runtime
was already supposed to provide. There IS no old-runtime notify
request/stimulus to fire against ddcf1ad4 because the machinery did
not exist.

Per the reviewer's option B:

  RED_REQUIRED           = NO  (NEW_CONTRACT_IMPLEMENTATION)
  PREDECESSOR_ABSENCE    = STRUCTURAL
  PRE_REPAIR_BEHAVIORAL_RED = NOT_REQUIRED

The 3/3 absence probe remains as a load-bearing STRUCTURAL witness:
the contract machinery was not silently present at the parent. It
is not a behavioral RED reproduction (there is none to reproduce).

Updates:

  - 19-pre-repair-red.md - header re-labelled; footer notes that
    the probe is unchanged but now sits under option B framing
  - result.json tests.predecessor_structural_absence - replaces
    tests.pre_repair_red_absence_witness with reclassified label
    and explanatory witness text
  - 14-full-gates.txt - predecessor witness section re-labelled

The probe file itself is unchanged: it still verifies the three
absence assertions via `git show <parent>:<path>` (no filesystem
ENOENT) and reports 3/3 PASS at ddcf1ad4.

----------------------------------------------------------------------
NON-REGRESSION EVIDENCE (correction03)
----------------------------------------------------------------------

The constructor's callback refactor from inline closure to named
factory is byte-identical. The following still pass:

  - apps/vscode typecheck: bunx tsc --noEmit -> 0 errors
  - BCNT01 unit tests: 24/24 PASS
    (background-command-notify-on-terminal01.bcnt01.test.ts)
  - BCNT-WIRE-01 (bridge): 1/1 PASS
    (LocalRuntimeHost.runTurn -> PendingPromptsController.enqueue seam)
  - Predecessor structural absence: 3/3 PASS at ddcf1ad4
    (background-command-notify-on-terminal01.bcnt01-pre-repair-red.probe.test.ts)

----------------------------------------------------------------------
ARCHITECTURE UNCHANGED
----------------------------------------------------------------------

  - WS-B_EXPLICIT_NOTIFY_ON_TERMINAL contract unchanged
  - notifyOnCompletion = false default unchanged
  - sessionId + taskId / NO epoch lifetime unchanged
  - marker registration bound to state === "running" unchanged
  - truncateToByteCap code-point iteration + reserve fixed overhead
    unchanged
  - PendingPromptsController.enqueue via sdkHost.send({delivery:
    "queue"}) unchanged
  - EPHEMERAL_ONLY persistence unchanged

The callback extraction is a host-side refactor (named exported
function instead of inline closure) with byte-identical behavior.

----------------------------------------------------------------------
OUTSTANDING (NOT IN SCOPE for correction03)
----------------------------------------------------------------------

  - LIVE positive + LIVE negative dogfood scenarios - DEFERRED to
    operator dogfood VSIX cycle (cloud agent context lacks
    vsce:prepublish + sideload infrastructure; production-shaped
    executable coverage qualifies per §46 + §47 of the ACT).
  - Stale-card projection - OUT_OF_SCOPE; successor
    ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01.

Per the reviewer's explicit instruction:
  "Do not revisit architecture, terminal reasons, truncation,
   contract text, or gate-summary machinery."
correction03 is exactly the bounded fix the reviewer prescribed:
close the production bridge proof + reclassify the predecessor
absence under option B. Nothing else is touched.

----------------------------------------------------------------------
EVIDENCE INDEX (correction03)
----------------------------------------------------------------------

  14-full-gates.txt                  test command list + green counts
  19-pre-repair-red.md               option B reclassification header
  24-correction-03.md                this evidence file
  result.json                        verdict + corrected counts + tests

----------------------------------------------------------------------
FILES TOUCHED (correction03)
----------------------------------------------------------------------

Production:
  apps/vscode/src/sdk/SdkController.ts
    + import { type ActiveSession } from "./cline-session-factory"
    + export function buildSdkControllerEnqueueTerminalWake(...)
      (extracted from the constructor inline closure; byte-identical body)
    - inline enqueueTerminalWake closure at ~line 996
    + constructor now calls buildSdkControllerEnqueueTerminalWake
      with the production seams

Tests:
  apps/vscode/src/sdk/__tests__/background-command-notify-on-terminal01
    .bcnt01-wire-03-real-callback.c24-c-bridge.test.ts
    NEW (6 tests - drives the REAL factory)
  apps/vscode/vitest.config.c2-4-c-bridge.ts
    + added the new test file to the include list
  apps/vscode/vitest.config.ts
    + added the new test file to the exclude list (bridge-only)

Evidence:
  .factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01/
    14-full-gates.txt              rewritten for correction03
    19-pre-repair-red.md           option B reclassification header
    24-correction-03.md            NEW
    result.json                    verdict + tests + correction03_fixes

  .factory/epic-board.md           board updated to CORRECTION03 state
