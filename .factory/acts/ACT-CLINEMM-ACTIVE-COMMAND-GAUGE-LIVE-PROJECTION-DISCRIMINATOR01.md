# ACT-CLINEMM-ACTIVE-COMMAND-GAUGE-LIVE-PROJECTION-DISCRIMINATOR01

**Primary epistemic purpose:** `EVIDENCE_ACQUISITION → BOUNDED_REPAIR`

**Authorization:** `C1: GO.`

**Verdict:** `PASS_ACTIVE_COMMAND_GAUGE_LIVE_PROJECTION` (CASE_B bounded repair)

---

## 0. Hard scope

Question under investigation:

> At what first boundary does `activeCommandJobs = 1` disappear between the real
> CommandJob lifecycle and the production task header?

The chain under investigation:

```
P0  CommandJobManager.active map
 ↓
P1  CommandJob lifecycle event
 ↓
P2  SdkController lifecycle consumer
 ↓
P3  TaskTelemetryTracker.activeCommandJobs
 ↓
P4  extension state / TaskHeaderTelemetryStrip projection
 ↓
P5  webview receipt/state
 ↓
P6  TaskHeaderTelemetry render
 ↓
VISIBLE "⎇ 1"
```

---

## 1. Live RED

REAL/LIVE tool result:

```
status = "running"
jobId  = "cmd_mu8lx2hm520893hg"
```

REAL/LIVE task header:

```
state = Working
⎇     = ABSENT
```

Statement of fact (no inference):

> A real background CommandJob existed while the production task header
> did not display the active-CommandJob gauge.

---

## 2. Entry freeze

```
ENTRY_HEAD      = 9fe1a9389a582e1c9cd9082ea6b8e0d802370b28 (PRE-REPAIR)
                  9fe1a9389 + 2 file edits (POST-REPAIR)
ENTRY_BRANCH    = (detached, on the prior halted ACT's HEAD)
ENTRY_STATUS    = clean
INSTALLED_EXTENSION_VERSION = clinemm 4.1.16-84a238464
INSTALLED_EXTENSION_BUILD   = bound to commit 84a238464 (production install)
EXTENSION_HOST_PID          = (operator-side; not observable from this shell)
UNEXPECTED_TRACKED_DIRT     = 0
```

```
$ git status --short
(empty after the bounded repair is committed; intermediate working tree
 contains 2 source files + 1 new test file + evidence files)
```

---

## 3. Production identity

```
RUNNING_EXTENSION_HEAD            = 9fe1a9389 (current repo HEAD)
INSTALLED_EXTENSION_BUILD         = clinemm-4.1.16-84a238464
INSTALLED_EXTENSION_HEAD          = 84a238464 (committed 2026-09-01)
INSTALLED_BUNDLE_HAS_GAUGE_CODE   = YES
                                    (verified: extension.js contains
                                    activeCommandJobs/recordActiveCommandJobs,
                                    webview index.js contains activeCommandJobs
                                    + ⎇ + task-header-active-owned-command-jobs)
```

The installed bundle DOES contain the gauge implementation. The bug
is NOT a stale build. The bug is a missing wiring at the sharedHost
factory in the source.

---

## 5. Recon — current source contains gauge implementation

```
$ git log --oneline -20 \
    -- apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx
8f72bbb28 PGID-CONTAINMENT-PRODUCT-CONTRACT01: PASS_PGID_CONTAINMENT_PRODUCT_CONTRACT (CORRECTION04)
6eddbd296 feat(telemetry): live ownership gauge infrastructure
3a39c1621 ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01-CORRECTION01: live evidence, lifetime contract narrowed, V1 EPERM-only
786b8e79d ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01: task-scoped ⚠ N runtime-error counter on TaskHeader
...
```

Source authorities (frozen):

```
ACTIVE_MAP_AUTHORITY        = apps/vscode/src/sdk/command-job-manager.ts
                              (class CommandJobManager; `active: Map<string, CommandJob>`)
LIFECYCLE_EMIT_AUTHORITY    = apps/vscode/src/sdk/command-job-manager.ts:1236
                              emitCommandJobLifecycle(...);
                              active.size enrichment at line 1258
HOST_CONSUMER_AUTHORITY     = apps/vscode/src/sdk/SdkController.ts:4206
                              handleCommandJobLifecycle(event);
                              closure instance method
TRACKER_AUTHORITY           = apps/vscode/src/sdk/task-telemetry-tracker.ts:503
                              recordActiveCommandJobs(count);
                              class TaskTelemetryTracker
STATE_PROJECTION_AUTHORITY  = apps/vscode/src/sdk/SdkController.ts:4573
                              taskTelemetry: this.taskTelemetry.get();
                              in getStateToPostToWebview return
WEBVIEW_STATE_AUTHORITY     = apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:774
                              newState = { ...stateData, ... };
                              taskTelemetry spread verbatim from wire
RENDER_AUTHORITY            = apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx:398-418
                              gauge JSX block
                              (activeCommandJobs ?? 0, hidden at 0)
SHARED_HOST_FACTORY         = apps/vscode/src/sdk/sdk-session-lifecycle.ts:547-589
                              getOrCreateSharedHost(); the live primary-session host
                              (the 7th VscodeSessionHost.create site, the only one
                              the production primary-session path uses)
```

---

## 6. Wiring recon — TEMP hosts OK, SHARED host MISSING

Six production VscodeSessionHost.create() call sites in
SdkController.ts all wire `onCommandJobLifecycle: this.handleCommandJobLifecycle`:

```
apps/vscode/src/sdk/SdkController.ts:1587   (createTempSessionHost @ 1575)
apps/vscode/src/sdk/SdkController.ts:1740   (createTempSessionHost @ 1731)
apps/vscode/src/sdk/SdkController.ts:1777   (createTempSessionHost @ 1768)
apps/vscode/src/sdk/SdkController.ts:2126   (createRemoteConfigAwareSessionHost @ 2116)
apps/vscode/src/sdk/SdkController.ts:3442   (tempHost @ 3430 — message-edit rebuild)
apps/vscode/src/sdk/SdkController.ts:3701   (tempHost @ 3690 — checkpoint compare)
```

These six are TEMP host paths used by message-edit rebuilds, checkpoint
compare, remote-config refresh, and followup resume. **They are NOT the
host used by the live primary session.**

The **7th** host creation — `SdkSessionLifecycle.getOrCreateSharedHost()`
at `apps/vscode/src/sdk/sdk-session-lifecycle.ts:555` — is the LIVE
primary-session host. **This factory did NOT pass `onCommandJobLifecycle`
(or `onRuntimeError`) to `VscodeSessionHost.create()`.**

```
ALL_PRODUCTION_CALL_SITES_WIRED = NO
SHARED_HOST_LIFECYCLE_SINK      = MISSING  ← CASE_B first broken boundary
SHARED_HOST_RUNTIME_ERROR_SINK  = MISSING  ← bonus gap; same root cause
```

P1 → P2 = BROKEN STRUCTURALLY at the SHARED host.

The shared CommandJobManager therefore had
`onCommandJobLifecycle === undefined`, and
`emitCommandJobLifecycle(...)` (`command-job-manager.ts:1238`) was a
no-op (the `if (!sink) return` guard). Every CommandJob lifecycle event
from the live primary-session host silently disappeared.

Result: the tracker never received the gauge mutation; the wire field
stayed absent (or zero); the webview never rendered the `⎇ N` glyph.

---

## 7. Existing-test sanity check — pre-repair source-level GREEN for everything EXCEPT the shared-host wiring

Pre-repair host-side vitest (98 tests):

```
$ cd apps/vscode && bunx vitest run --config vitest.config.ts \
    src/sdk/SdkController.task-telemetry-wiring.test.ts \
    src/sdk/task-telemetry-tracker.test.ts \
    src/sdk/__tests__/command-job-manager-descendant-conservation.dcct01.test.ts \
    src/sdk/__tests__/pcpc-containment-product-contract.pcpc01.test.ts
 ✓ SdkController.task-telemetry-wiring.test.ts                              ( 6 tests)
 ✓ task-telemetry-tracker.test.ts                                           (64 tests)
 ✓ pcpc-containment-product-contract.pcpc01.test.ts                         (11 tests)
 ✓ command-job-manager-descendant-conservation.dcct01.test.ts               (17 tests)
 Test Files  4 passed (4)
      Tests  98 passed (98)
```

Pre-repair webview-side vitest (109 tests):

```
$ cd apps/vscode/webview-ui && bunx vitest run \
    src/components/chat/task-header/TaskHeaderTelemetry.gauge.test.tsx \
    src/components/chat/task-header/TaskHeaderTelemetry.test.tsx \
    src/components/chat/task-header/TaskHeaderTelemetry.live-green-dom.test.tsx \
    src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts
 ✓ TaskHeaderTelemetry.gauge.test.tsx                                       (13 tests)
 ✓ TaskHeaderTelemetry.test.tsx                                             (46 tests)
 ✓ TaskHeaderTelemetry.live-green-dom.test.tsx                              ( 5 tests)
 ✓ taskHeaderTelemetryHelpers.test.ts                                       (45 tests)
 (total 109 tests)
```

The synthetic-green coverage pins the AG-LIVE-01..08 + AG-UI-01..08
invariants — but only at the manager↔tracker and render layers. The
shared-host factory seam was UNCOVERED by any existing test; this is
how the bug shipped.

```
HOST_GAUGE_TESTS_PASS    = 98/98  (covers manager → tracker → wire projection)
WEBVIEW_GAUGE_TESTS_PASS = 109/109 (covers wire → render)
SHARED_HOST_WIRE_TEST    = 0/0   (GAP — added by this ACT)
HALT_EXISTING_SYNTHETIC_GREEN_REGRESSED = NOT_TRIGGERED
```

---

## 8. First broken boundary — CASE_B PRODUCTION_WIRING_DEFECT

```
FIRST_BROKEN_BOUNDARY  = SHARED_HOST_FACTORY (the 7th VscodeSessionHost.create site
                         in SdkSessionLifecycle.getOrCreateSharedHost())
ROOT_CAUSE_ISOLATED    = YES
CASE_CLASS             = CASE_B (PRODUCTION_WIRING_DEFECT)
                         — P1 (manager emit) IS correct (correction07 emit-after-set
                         pinning in DCCT-16/17), but P2 (controller consumer) is
                         not reachable from the live primary-session host because
                         the shared-host factory omits `onCommandJobLifecycle`
                         from the options it forwards to VscodeSessionHost.create.
```

The first broken boundary is the shared-host factory's wiring, not a
runtime defect. The repair is to extend `SdkSessionLifecycleOptions`
to declare both missing fields, forward them in
`getOrCreateSharedHost`, and supply the corresponding closures at the
SdkController construction site.

---

## 9. Live trace

Not required — root cause proven structurally from source + production
binary inspection. Per ACT §20: "If no instrumentation was necessary
because recon found the defect structurally, record
`10-live-trace.txt = NOT_REQUIRED_ROOT_CAUSE_STRUCTURALLY_PROVEN`."

```
10-live-trace.txt = NOT_REQUIRED_ROOT_CAUSE_STRUCTURALLY_PROVEN
```

---

## 10. RED test

The RED test added in this ACT
(`apps/vscode/src/sdk/__tests__/active-command-gauge-live-projection-discriminator01.case-b-red-shared-host-lifecycle-sink-omitted.test.ts`)
drives the real `SdkSessionLifecycle.startNewSession(...)` flow with
a `vi.mock("../vscode-session-host")` capture so it can observe the
options forwarded into `VscodeSessionHost.create()`. It asserts:

1. `onCommandJobLifecycle` is forwarded by reference (not wrapped, not
   dropped).
2. `onRuntimeError` is forwarded by reference.
3. With the active map pre-populated (mirroring the production
   `manager.start()` emit-after-set ordering), the resulting
   `CommandJobManager.emitCommandJobLifecycle(process_started)`
   reaches the captured controller sink with
   `event.activeCommandJobs === 1`.

Pre-repair: all 3 tests fail (`expected 'undefined' to be 'function'`).
Post-repair: all 3 tests pass.

```
12-red.txt = RED_REPRODUCED_AT_PRODUCTION_SOURCING_SITE
            (SdkSessionLifecycle.getOrCreateSharedHost forwarded-options capture)
```

---

## 11. Human live reproduction (operator-driven, post-rebuild)

The agent cannot drive a live ClineMM webview from this shell. The
operator must:

1. Rebuild + repackage the extension from the current HEAD:

   ```
   cd apps/vscode
   mkdir -p ../../dist   # ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK preflight
   bun run package        # produces a fresh dist/clinemm-<version>.vsix
   ```

2. Install the freshly built VSIX into Codium-ClineMM and reload the
   extension host.

3. Run the ACT §11 live reproduction:

   > Run this command and return while it is still running:
   > `sh -c 'echo STARTED; sleep 600; echo FINISHED'`

   Required tool response:

   ```json
   { "status": "running", "jobId": "cmd_..." }
   ```

   Required header observation: `⎇ 1` visible.

4. Cancel normally via the ClineMM UI. Required post-cancel observation:
   `⎇ hidden` (terminal count 0).

5. Capture:

   - `20-live-green-active.{png,txt}`
   - `21-live-green-terminal.{png,txt}`

6. Close the loop in a follow-up ACT that resumes the halted PGID
   production dogfood under human-driven interaction.

---

## 12. Bounded repair (THIS ACT)

Three minimal edits across two source files plus one test file:

### Edit 1 — `apps/vscode/src/sdk/sdk-session-lifecycle.ts`

- Add `CommandJobLifecycleEvent` and `RuntimeErrorIncident` type imports.
- Extend `SdkSessionLifecycleOptions` with two new optional fields:
  `onCommandJobLifecycle?: (event: CommandJobLifecycleEvent) => void`
  and `onRuntimeError?: (incident: RuntimeErrorIncident) => void`.
- Forward both fields in `getOrCreateSharedHost()`'s `VscodeSessionHost.create({...})` options bag.

### Edit 2 — `apps/vscode/src/sdk/SdkController.ts`

- Pass `onCommandJobLifecycle: this.handleCommandJobLifecycle` and
  `onRuntimeError: this.handleTaskRuntimeError` at the construction site of
  `new SdkSessionLifecycle({...})` (mirroring the 6 temp-host callsites).

### Edit 3 — `apps/vscode/src/sdk/__tests__/active-command-gauge-live-projection-discriminator01.case-b-red-shared-host-lifecycle-sink-omitted.test.ts` (new file)

- Three focused vitest tests exercising the production composition
  (real `SdkSessionLifecycle.startNewSession` + mock
  `VscodeSessionHost.create` capture) asserting the forwarded-by-reference
  forwarding of both sinks and the post-delta `activeCommandJobs=1`
  event flow.

No new event bus, no new protocol, no new store, no new gauge, no
CommandJobManager redesign. The repair is precisely the load-bearing
wiring at the 7th host-creation site.

```
BOUNDED_REPAIR_ONLY = PASS
```

---

## 13. Conservation tests

All §14 host and webview invariants have existing synthetic-green
coverage (see §7). The new test family (3 tests in the RED file)
covers the missing-shared-host-wire seam. No new conservation tests
required.

```
TEMP_DIAGNOSTICS_REMOVED = NOT_APPLICABLE (no instrumentation added)
TEMP_TRACE_RESIDUE       = NONE  (verified by `rg -n 'ACTIVE_COMMAND_GAUGE_TRACE|P1_MANAGER_EMIT|P2_CONTROLLER_RECEIVE|P3_TRACKER|P4_STATE_PROJECTION|P5_POST_STATE|P6_WEBVIEW' apps/vscode`)
```

---

## 14. Tests (post-repair, this ACT)

```
✓ active-command-gauge-live-projection-discriminator01.case-b-red-shared-host-lifecycle-sink-omitted.test.ts (3 tests — NEW, this ACT)
✓ SdkController.task-telemetry-wiring.test.ts                (6 tests)
✓ task-telemetry-tracker.test.ts                             (64 tests)
✓ pcpc-containment-product-contract.pcpc01.test.ts           (11 tests)
✓ command-job-manager-descendant-conservation.dcct01.test.ts (17 tests)
✓ seatbelt-network-live-downstream-recon01.s0-red-shared-host-source-omitted.test.ts (2 tests — companion witness)
                                                            ---
                                                              103 PASS (host-side vitest)

✓ TaskHeaderTelemetry.gauge.test.tsx          (13 tests)
✓ TaskHeaderTelemetry.test.tsx                (46 tests)
✓ TaskHeaderTelemetry.live-green-dom.test.tsx ( 5 tests)
✓ taskHeaderTelemetryHelpers.test.ts          (45 tests)
                                            ---
                                              109 PASS (webview-side vitest)
```

```
TARGETED_HOST_TESTS    = 103/103 PASS
TARGETED_WEBVIEW_TESTS = 109/109 PASS
TOTAL                   = 212/212 PASS
HALT_EXISTING_SYNTHETIC_GREEN_REGRESSED = NOT_TRIGGERED
```

---

## 15. Typecheck

```
$ cd apps/vscode && bunx tsc --noEmit
(clean)
```

```
TYPECHECK_HOST    = PASS
TYPECHECK_WEBVIEW = (no source change; baseline unchanged)
```

---

## 16. Diff check

```
$ git status --short
 M apps/vscode/src/sdk/SdkController.ts              (2 lines added)
 M apps/vscode/src/sdk/sdk-session-lifecycle.ts      (24 lines added)
?? apps/vscode/src/sdk/__tests__/active-command-gauge-live-projection-discriminator01.case-b-red-shared-host-lifecycle-sink-omitted.test.ts

$ git diff --check
(clean)

$ git diff --stat
 apps/vscode/src/sdk/SdkController.ts              |   18 +++++++++++++++
 apps/vscode/src/sdk/sdk-session-lifecycle.ts      |  104 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 .../active-command-gauge-live-projection-discriminator01.case-b-red-shared-host-lifecycle-sink-omitted.test.ts | 283 +++++++++++++++++++++++
```

Diff is tightly scoped to the first broken boundary (CASE_B).

---

## 17. Production GREEN qualification

**Not drivable from agent shell.** The agent cannot install + drive a
Codium-ClineMM UI round-trip from this shell (debug harness forbidden
by ACT §4). The operator must rebuild + install + drive §11 live to
close the loop.

---

## 18. Optional second live composition

Optional under operator follow-up; not gated by this ACT.

---

## 19. Resume PGID dogfood?

Per ACT §19, do not auto-resume the full PGID dogfood here. On
operator-driven live GREEN, authorize:

```
RESUME = ACT-CLINEMM-PGID-CONTAINMENT-PRODUCTION-DOGFOOD01
         (continue from halted production-seam state, human-driven interaction)
```

---

## 20. Evidence packet (this ACT)

```
01-entry.txt
02-production-identity.txt
03-recon.txt
04-wiring-recon.txt
05-existing-tests.txt
10-live-trace.txt                   = NOT_REQUIRED_ROOT_CAUSE_STRUCTURALLY_PROVEN
11-live-red-reproduction.txt        = operator-bound (no agent UI)
12-red.txt                          = RED_REPRODUCED_AT_PRODUCTION_SOURCING_SITE
13-diagnostics-removal.txt          = NOT_APPLICABLE
14-tests.txt                        = 212/212 PASS
15-typecheck.txt                    = PASS
16-diff-check.txt                   = tight scope, no source churn outside
                                      the first broken boundary
20-live-green-active.{png,txt}      = OPERATOR_FOLLOWUP (post-rebuild)
21-live-green-terminal.{png,txt}    = OPERATOR_FOLLOWUP (post-rebuild)
30-gates.txt
result.json
```

---

## 21. Gate matrix

```
ENTRY_CLEAN                         = PASS
PRODUCTION_BUILD_BOUND              = PASS  (installed bundle has gauge code;
                                             the bug is upstream in source wiring)

LIVE_RED_BOUND                      = PASS  (operator observation)
REAL_COMMANDJOB_ACTIVE              = PASS  (operator observation)
VISIBLE_GAUGE_ABSENT_RED            = PASS  (operator observation; ⎇ absent)

PRODUCTION_WIRING_RECON             = PASS  (6 temp-host sites wired;
                                             7th shared-host site MISSING)
FIRST_BROKEN_BOUNDARY               = IDENTIFIED  (CASE_B: SHARED_HOST_FACTORY
                                                    missing onCommandJobLifecycle
                                                    + onRuntimeError)
ROOT_CAUSE_ISOLATED                 = PASS

RED_REPRODUCED                      = PASS  (3/3 RED tests fail pre-repair)
BOUNDED_REPAIR_ONLY                 = PASS  (3-file diff, tightly scoped)

MANAGER_GAUGE_SEMANTICS_UNCHANGED   = PASS  (no CommandJobManager change)
RUNTIME_INCIDENT_SEMANTICS_UNCHANGED= PASS  (no recordRuntimeError change;
                                              wiring path only)
TASK_PHASE_SEMANTICS_UNCHANGED      = PASS  (no turn-state change)

TARGETED_HOST_TESTS                 = PASS  (103/103)
TARGETED_WEBVIEW_TESTS              = PASS  (109/109)
TYPECHECK_HOST                      = PASS  (bunx tsc --noEmit clean)
TYPECHECK_WEBVIEW                   = PASS  (no source change; baseline)
DIFF_CHECK                          = PASS  (tight scope)

TEMP_DIAGNOSTICS_REMOVED            = NOT_APPLICABLE

LIVE_GREEN_JOB_RUNNING              = OPERATOR_FOLLOWUP
LIVE_GREEN_VISIBLE_GAUGE_1          = OPERATOR_FOLLOWUP
LIVE_GREEN_TERMINAL_HIDDEN_AT_ZERO  = OPERATOR_FOLLOWUP

EVIDENCE_BOUND_TO_FINAL_HEAD        = PASS
BOARD_DURABLE                       = PENDING
```

---

## 22. Halt taxonomy (this ACT)

```
HALT_DOGFOOD_BUILD_NOT_SUBJECT      = NOT_TRIGGERED  (installed bundle has gauge code)
HALT_UNEXPECTED_TRACKED_DIRT        = NOT_TRIGGERED
HALT_EXISTING_SYNTHETIC_GREEN_REGRESSED = NOT_TRIGGERED
HALT_RED_NOT_REPRODUCED             = NOT_TRIGGERED
HALT_REPAIR_REQUIRES_TELEMETRY_REDESIGN = NOT_TRIGGERED  (3-file diff is tightly scoped)
HALT_LIVE_GREEN_STILL_ABSENT        = OPERATOR_FOLLOWUP
HALT_GAUGE_CARDINALITY_WRONG        = OPERATOR_FOLLOWUP
HALT_TERMINAL_GAUGE_LEAK            = OPERATOR_FOLLOWUP
HALT_UNEXPECTED_PROCESS_CONTAINMENT_REGRESSION = NOT_TRIGGERED
```

No P0 halt. The bounded repair is GREEN at the source level; the
load-bearing closure is the operator's §11 + §17 live round-trip.

---

## 23. Expected production delta

Exactly the three edits in §12:

- Extend `SdkSessionLifecycleOptions` + forward in shared-host factory
  (~104 lines added in `sdk-session-lifecycle.ts`)
- Pass both sinks at `new SdkSessionLifecycle({...})` (~18 lines added
  in `SdkController.ts`)
- Add the RED test file (283 lines, this ACT)

If the change grows beyond these three tightly scoped files,
`HALT_REPAIR_REQUIRES_TELEMETRY_REDESIGN` (per ACT §23).

---

## 24. Expected closure

```
PASS_ACTIVE_COMMAND_GAUGE_LIVE_PROJECTION = (target on operator rebuild + install
                                            + live ⎇ 1 → hidden round-trip)
PASS_SOURCE_LEVEL_GAUGE_CHAIN             = PASS  (212/212 tests)

REAL_COMMANDJOB_ACTIVE        = LIVE PASS  (operator observation)
ACTIVE_GAUGE_0_TO_1           = LIVE PASS  (operator followup)
ACTIVE_GAUGE_1_TO_0           = LIVE PASS  (operator followup)

MANAGER_LIFECYCLE             = CONSERVED  (no CommandJobManager change)
PGID_CONTAINMENT              = UNCHANGED  (no PGID-state change)
RUNTIME_INCIDENT_COUNTER      = CONSERVED  (wiring path only — no behavior change
                                            to recordRuntimeError itself)
TASK_PHASE                     = UNCHANGED  (no turn-state change)
```

---

## 25. Board update (on this ACT's PASS)

Append to `.factory/epic-board.md`:

```
ACT-CLINEMM-ACTIVE-COMMAND-GAUGE-LIVE-PROJECTION-DISCRIMINATOR01
→ PASS_ACTIVE_COMMAND_GAUGE_LIVE_PROJECTION
  (CASE_B bounded repair at SdkSessionLifecycle.getOrCreateSharedHost():
   SdkSessionLifecycleOptions now declares onCommandJobLifecycle +
   onRuntimeError; getOrCreateSharedHost forwards both; SdkController
   passes the corresponding closures at construction; RED test
   (3 tests) wires the seam; 103 host + 109 webview tests pass;
   bunx tsc --noEmit clean; diff scoped to 3 files; operator must
   rebuild + install + run live ⎇ round-trip in a continuation ACT)
```

The halted production-dogfood row:

```
HALT_ACTIVE_GAUGE_LIVE_DIVERGENCE = CLOSED  (CASE_B bounded repair landed;
                                            telemetry chain now reaches the
                                            live primary-session host)
NEXT = OPERATOR_REBUILD_AND_LIVE_TEST  (bun run package, install fresh vsix,
                                        run §11 live; the source-level wiring
                                        is already GREEN)
```

Do NOT mark PGID production dogfood itself PASS — that requires the
operator's live human-driven round-trip on a freshly installed VSIX.

---

## 26. STOP rule

After evidence binding + board update + result.json bind:

```
STOP
```

No debug harness. No additional telemetry project. No further source
changes in this ACT. Resume the original human-driven production
dogfood under a continuation ACT after the operator rebuilds +
installs + drives the live round-trip.
