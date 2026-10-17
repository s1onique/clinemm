# ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01

**Status:** IN PROGRESS (RED + discriminator only; no repair authorized).
**Predecessor:** `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (P0 cancel-affordance
recon, recorded two unproven cancel failure mechanisms on
`sdk-task-control-coordinator.ts:76`).
**Stall class:** CANCEL_LIVENESS_NONRECOVERY
**Live evidence class:** REAL (operator-supplied live session
`1792072658032_m3gw7`, epoch 22, stateVersion 6372, SHA-256 frozen
below).

---

## §0 — Why this ACT exists

A real installed-Codium run now records a new symptom: a task sits
in `Working` and the Cancel button fails to take it out. The
on-call expert verdict is to discriminate, not to repair.

Captured facts (frozen, SHA-256 below):

| Field | Value |
|---|---|
| session | `1792072658032_m3gw7` |
| epoch | 22 |
| stateVersion | 6372 |
| legacy phase | `streaming` |
| TaskHeader | `streaming` |
| runtime status | `idle` |
| runtime `modelStreaming` | `false` |
| runtime pending tools | 0 |
| active background command jobs | 1 |
| background command | `running` (held 15 s+ at capture end) |
| webview `buttonConfig.secondaryAction` | `cancel` (ENABLED) |
| hot-loop diagnostic `overflowed` | 0 |
| max nested `handleSessionEvent` depth | 2 |

Two failure mechanisms are on the table (per the on-call
verdict, neither is proven by the captures):

- **H-A: No active session.** Cancel exits at
  `sdk-task-control-coordinator.ts:80-83` because
  `getActiveSession()` returns undefined. The displayed
  `streaming` phase is never reconciled.
- **H-B: Abort never settles.** Cancel reaches
  `await sdkHost.abort(sessionId)` at
  `sdk-task-control-coordinator.ts:95` but the promise remains
  pending. `setRunning(false)` and the resume-ask publication at
  `:104-115` never execute.

A prior cross-ACT precedent at
`vscode-run-commands-tool.ts:1081` already documents that
`cancelTask` "itself never resolves" is a real failure mode in the
coordinator vicinity (`POST-START-TIMEOUT-02`). That precedent
proves the CAPABILITY of a never-settling cancel; it does not prove
H-B fires for the webview-Cancel path here.

A prior captured precedent in
`apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts:69-88`
defines the project's diagnostic-module pattern. A prior ACT
(`ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02`) defines the
ONE-SEAM-DEFAULT-OFF-REAL-RED pattern this ACT mirrors.

---

## §1 — Frozen live RED

### Live artifacts (SHA-256 verified, see §16)

| Artifact | Path | SHA-256 (operator-supplied, file content) |
|---|---|---|
| Operator live capture (chronology) | `.factory/evidence/ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01/operator-live-capture.jsonl` | TBD-OPERATOR-SUPPLIED — to be SHA-256-pinned by the operator before CLOSE (per §16). |
| `extension-host-hotloop-diagnostic.json` (witness for `overflowed=0`, depth 2) | supplied by operator | TBD-OPERATOR-SUPPLIED — to be SHA-256-pinned by the operator before CLOSE. |

The on-call verdict states: "captures reveal a new
cancellation/liveness problem, not an obvious Elm
completion-authority defect." That verdict — together with
`overflowed=0` and depth=2 in the EHLOOP dump — IS the RED for
HOST_HOTLOOP. The discriminating RED for H-A vs H-B does NOT yet
exist; this ACT authors it.

---

## §2 — Source recon (seam map, verbatim file:line)

```text
UI click                  = webview Cancel button (TaskHeader
                           arbitration; identity-bearing dispatch)
Webview transport         = gRPC TaskService.cancelTask
                           (src/generated/grpc-js/cline/task.ts:2041)
gRPC handler              = apps/vscode/src/core/controller/task/cancelTask.ts:10
                           → controller.cancelTask()
SdkController entry       = apps/vscode/src/sdk/SdkController.ts:4152
                           (turnStateTracker.setWithWriter("resumable")
                            + telemetry.endTask + emit task_cancelled)
Coordinator entry         = apps/vscode/src/sdk/sdk-task-control-coordinator.ts:76
H-A early-return          = sdk-task-control-coordinator.ts:79-83
                           (no active session → Logger.warn → return)
Fence raise               = sdk-task-control-coordinator.ts:92
                           (raiseCancelFence: bumpEpoch + clearApproved)
SDK abort                 = sdk-task-control-coordinator.ts:95
                           → sdkHost.abort(sessionId)
                           → vscode-session-host.ts:524 (try/catch AbortError)
                           → local-runtime-host.ts:1394 (LocalRuntimeHost.abort)
                             ├ teamRuntime?.cancelOutstandingWork(reason)
                             ├ session.agent.abort(reason)
                             └ (no awaited boundary at the host layer)
Post-abort publication    = sdk-task-control-coordinator.ts:104-115
                           (setRunning(false) + appendAndEmit resume_task
                            + postStateToWebview)
```

### First currently-unobservable production boundary

The current coordinator boundary hides FOUR sub-boundaries inside
`cancelTask()`. They are needed to discriminate H-A vs H-B
cleanly:

```text
C1  cancel_request        (entry; pre active-session check)
C2  cancel_accepted       (active session present, fence raised)
C3  abort_invoked         (await sdkHost.abort started)
C4  abort_completed       (await sdkHost.abort settled, no throw OR throw caught)
C5  cancel_published      (setRunning(false) + appendAndEmit + postStateToWebview returned)
```

- **(H-A) signature**: `cancel_request` increments, but
  `cancel_accepted` does NOT increment. (The active-session
  check returns early.) All downstream counters stay 0.
- **(H-B) signature**: `cancel_request`,
  `cancel_accepted`, and `abort_invoked` all increment, but
  `abort_completed` does NOT (the await never settles).
  `cancel_published` therefore never runs.

These counters are the minimum surface needed to discriminate
the two hypotheses without violating the one bounded seam budget.

---

## §3 — Required new observation seam (one bounded set)

### What we add

ONE new diagnostic module —
`apps/vscode/src/sdk/cancel-liveness-diagnostic.ts` — that owns
five bounded counters (`cancel_request`, `cancel_accepted`,
`abort_invoked`, `abort_completed`, `cancel_published`) plus a
bounded `byActiveSession` map (key = `sessionId || "<none>"`,
max 32 entries).

Frozen names (per ACT §3 contract; renaming is a breaking
change for downstream tests):

- counters: `cancelRequestCalls`, `cancelAcceptedCalls`,
  `abortInvokedCalls`, `abortCompletedCalls`,
  `cancelPublishedCalls`
- bucket: `byActiveSession`
- overflow field: `overflowed`
- helper: `isCancelLivenessDiagnosticEnabled`,
  `setCancelLivenessDiagnosticEnabled`,
  `resetCancelLivenessDiagnostic`,
  `getCancelLivenessDiagnosticSnapshot`

Capture sites (exactly five, all in
`sdk-task-control-coordinator.ts`):

1. `cancel_request` — first line of `cancelTask()`,
   BEFORE `clearPending`. Captures `hasActiveSession` and
   `activeSessionId` (or `null`).
2. `cancel_accepted` — immediately after the
   `if (!activeSession) return` guard, BEFORE
   `raiseCancelFence()`. Captures `activeSessionId`.
3. `abort_invoked` — immediately BEFORE
   `await sdkHost.abort(sessionId)`. Captures
   `activeSessionId`. Records `t0` in a small `Map<sessionId, t0>`.
4. `abort_completed` — immediately AFTER the try/catch around
   `await sdkHost.abort` (i.e. after the catch falls through
   to the post-abort code), BEFORE `setRunning(false)`.
   Captures `activeSessionId` and elapsed ms.
5. `cancel_published` — AFTER
   `await this.options.postStateToWebview()` resolves,
   at the very end of `cancelTask()`. Captures
   `activeSessionId`.

### Why this seam set

The five counters are the minimum needed to discriminate H-A vs
H-B without leaking state into the wire, the webview, or the
public protocol. They are the load-bearing witnesses the next
ACT will need to author a fix (or declare CAPTURE_INSUFFICIENT
if the bug is not in the cancel pipeline at all).

### Activation

Activation is wired EXACTLY as the existing EHLOOP /
CCARD / BJLA / BOCOR / THSICAP / TSWPD pattern: a single
helper in `dogfood-diagnostic-profile.ts`
(`applyCancelLivenessDiagnosticProfile(isDogfood)`), called
from `extension.ts:activate` next to the existing
sibling activations. There is NO new env var, NO override
matrix, NO parser. The dogfood profile is the SOLE gate.

A separate
`apps/vscode/src/sdk/cancel-liveness-diagnostic-runtime.ts`
hosts the dump adapter (mirrors
`extension-host-hotloop-diagnostic-runtime.ts`).
DUMP_FILE = `cancel-liveness-diagnostic.json`.

The diagnostic is REMOVABLE. The closure trigger is in §15.

---

## §4 — RED reproduction (production-shape)

### RED properties (per ACT §11)

1. REAL `SdkTaskControlCoordinator` with REAL `TaskOperationFence`.
2. REAL `SdkSessionLifecycle` (the seam under test).
3. Controlled SDK host (a hand-written
   `SdkSessionHost`-shape test double that simulates
   `abort()` with an explicit gate — resolves on
   `releaseAbort()`, OR `await`s forever to model H-B).
4. No direct test-body call to the suspected boundary.
5. No fake `cancel_published` / `cancel_accepted`.
6. No test-owned constant asserting itself.
7. No arbitrary sleeps as the causal mechanism.
8. A small injected dependency at the actual failing boundary
   is allowed (the test double's `abort`).

### RED shape — H-A test (active session present vs absent)

Given the diagnostic is ON, the coordinator wired with
REAL `SdkSessionLifecycle`, and a hand-written
`SdkSessionHost` test double:

- **RED-A1 (active session present, abort resolves)**:
  `cancel_request == 1`, `cancel_accepted == 1`,
  `abort_invoked == 1`, `abort_completed == 1`,
  `cancel_published == 1`. The post-state is published.
- **RED-A2 (active session absent, post-restoration)**:
  `cancel_request == 1`, `cancel_accepted == 0`,
  `abort_invoked == 0`, `abort_completed == 0`,
  `cancel_published == 0`. The post-state is NOT published.
  The displayed phase is NOT reconciled.
- **RED-B (abort never settles — controlled via the test
  double's deferred release)**:
  `cancel_request == 1`, `cancel_accepted == 1`,
  `abort_invoked == 1`, `abort_completed == 0` (after
  a short fixed wall-clock wait — NOT a sleep; the
  diagnostic is the synchronous reader of the
  `Map<sessionId, t0>`-anchored in-flight count),
  `cancel_published == 0`. A bounded timeout
  (`MAX_ABORT_WAIT_MS = 250` in the test) confirms
  the await is the only blocker.

### RED stop rule

If none of RED-A1 / RED-A2 / RED-B reproduces (the
counters are not emitted at the production sites):
`HALT_RED_NOT_REPRODUCED` — keep the diagnostic
(default-off), do NOT repair.

If RED-A1 / RED-A2 reproduce but RED-B does not
(the bug is not in the cancel pipeline itself):
`CAPTURE_INSUFFICIENT` — keep the diagnostic until
the next ACT can locate the actual stuck boundary.

---

## §5 — Discrimination matrix (verbatim)

| Hypothesis | Counters expected (post one Cancel click) |
|---|---|
| Healthy | `1, 1, 1, 1, 1` |
| H-A: no active session | `1, 0, 0, 0, 0` |
| H-B: abort never settles | `1, 1, 1, 0, 0` |
| H-C (defensive — fence raises but post-state fails) | `1, 1, 1, 1, 0` |

A live capture (when the operator runs the dogfood
profile in a real session that exhibits the symptom) MUST
match one of these four rows. The discriminator therefore
narrows the open hypothesis space to at most one row
per session, with H-C as a defensive safety net.

---

## §6 — Scope freeze (per ACT §18)

The following are explicitly NOT touched by this ACT:

- `apps/vscode/src/sdk/SdkController.ts:4152` — the
  `SdkController.cancelTask` entry (fence + telemetry +
  emit task_cancelled happen BEFORE the coordinator is
  reached; they are part of the upstream path and
  irrelevant to H-A vs H-B).
- `apps/vscode/src/sdk/vscode-session-host.ts:524` — the
  `VscodeSessionHost.abort` wrapper (synchronous pass-through;
  not a boundary).
- `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1394` —
  the `LocalRuntimeHost.abort` body (not on the H-A/H-B
  discriminator path: it returns synchronously after
  `session.agent.abort(reason)`).
- `apps/vscode/src/sdk/team-runtime/*` — teamRuntime
  cancellation ownership (out of scope; not the
  H-A/H-B boundary).
- Elm TaskHeader arbitration — explicitly out of scope
  per the on-call verdict ("This also explains why we
  should not immediately change Elm TaskHeader
  arbitration: the selector receives `streaming` from
  the host and faithfully selects it.").
- launchd / tart / Tart guest — explicitly out of scope
  per the on-call verdict.
- The general Factory review of recent ACTs — explicitly
  out of scope per the on-call verdict.

Required conservation rerun (frozen per ACT §17): the
existing EHLOOP / CCARD / BJLA / BOCOR / THSICAP / TSWPD
diagnostic activations MUST still pass when the new
diagnostic is OFF in public builds (i.e. default-off
contract enforced). The new diagnostic MUST NOT introduce
a new env knob.

Do NOT reopen unrelated existing failures.

---

## §7 — Repair authorization

ONLY if the live capture from a real dogfood session
matches one of {H-A, H-B, H-C} cleanly and the next ACT
authors a fix. This ACT authors ONLY the diagnostic
and the RED test. Budget for the next ACT (if
authorized):

```text
production files <= 2
  (sdk-task-control-coordinator.ts + ONE of:
   SdkController.ts / sdk-session-lifecycle.ts /
   vscode-session-host.ts / local-runtime-host.ts)
new public API = 0
new protocol fields = 0
new retry loop = 0
new polling loop = 0
myc changes = 0
queue redesign = 0
teamRuntime redesign = 0
launchd/tart = 0
Elm changes = 0
```

---

## §8 — HALT conditions

```text
HALT_RED_NOT_REPRODUCED          — RED-A1/RED-A2/RED-B all fail
HALT_CAPTURE_INSUFFICIENT        — RED-A1/RED-A2 reproduce but
                                   live capture does not match
                                   any of {H-A, H-B, H-C}
HALT_SCOPE_EXPANSION_REQUIRED    — production file budget exceeded
HALT_NEW_P0                      — different boundary appears
                                   in next live run
HALT_DOGFOOD_PROFILE_BROKEN      — conservation rerun fails
HALT_NO_NEW_ENV_KNOB             — diagnostic introduces
                                   an env knob or override
```

---

## §9 — Live qualification (per ACT §21)

Operator-driven (the dogfood profile is the only
production activation path; ClineMM does not launch
Codium):

```text
DIAGNOSTIC_ENABLED_BY_DOGFOOD_PROFILE = true
LIVE_CAPTURE_CANCEL_REQUEST = 1
LIVE_CAPTURE_MATCHES_ONE_OF_HEALTHY_OR_HA_HB_HC = true
LIVE_POSTFIX_RESUME_ASK_PUBLISHED = (H-A → false;
                                     H-B → false;
                                     H-C → false;
                                     Healthy → true)
```

---

## §10 — Success criteria (per ACT §25)

```text
FIVE_COUNTERS_PRESENT                = true
DEFAULT_OFF_CONTRACT_ENFORCED        = true
DOGFOOD_PROFILE_GATE_PRESENT         = true
NO_NEW_ENV_KNOB                      = true
NO_PROTOCOL_FIELD                    = true
NO_WEBVIEW_FIELD                     = true
NO_STATE_SEMANTIC_DELTA              = true
RED_A1_REPRODUCES                    = required
RED_A2_REPRODUCES                    = required
RED_B_REPRODUCES                     = required
DISCRIMINATION_MATRIX_PINNED         = required
CONSERVATION                         = PASS
TYPECHECK                            = PASS
VSCODE_PREPUBLISH                    = PASS
DIFF_CHECK                           = PASS
EXACT_HEAD_ARTIFACT_BOUND            = required
```

---

## §11 — Implementation head identity (per ACT §19)

```text
ENTRY_HEAD              = <discovered at ACT start>
IMPLEMENTATION_HEAD     = <discovered post-commit>
SUBJECT_HEAD            = IMPLEMENTATION_HEAD
CLOSURE_HEAD            = <discovered post board-row commit>
```

---

## §12 — Stop condition

```text
Author the five-counter diagnostic.
Reproduce RED-A1, RED-A2, RED-B.
Pin the discrimination matrix.
Stop. No repair. No Elm change. No launchd change.
The next ACT decides what to fix, if anything.
```

---

## §13 — Files (this ACT)

- `apps/vscode/src/sdk/cancel-liveness-diagnostic.ts` (new, ~80 LoC,
  five counters, bounded `byActiveSession` map, default-off
  enablement, five `record*` helpers, `is*Enabled`,
  `set*Enabled`, `reset*`, `getSnapshot`).
- `apps/vscode/src/sdk/cancel-liveness-diagnostic-runtime.ts` (new,
  ~30 LoC, dump adapter mirroring
  `extension-host-hotloop-diagnostic-runtime.ts`).
- `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` (modified
  IN-PLACE; exactly five capture sites in `cancelTask()`;
  no other code paths touched).
- `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` (one new
  `applyCancelLivenessDiagnosticProfile` helper, ~25 LoC; no
  other code touched; existing helpers unchanged).
- `apps/vscode/src/extension.ts` (one new sibling activation
  call, ~5 LoC, next to the existing EHLOOP / CCARD / BJLA
  / BOCOR / THSICAP / TSWPD activations).
- `apps/vscode/src/sdk/__tests__/cancel-liveness-diagnostic.red.test.ts`
  (new; the RED-A1 / RED-A2 / RED-B tests, plus the
  discrimination-matrix test).
- `apps/vscode/package.json` (one new Command Palette
  registration: `cline.debug.dumpCancelLivenessDiagnostic`,
  mirroring the existing EHLOOP dump command).
- `apps/vscode/src/registry.ts` (one new entry, mirroring the
  existing EHLOOP dump entry).
- `.factory/acts/ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01.md`
  (this file).
- `.factory/evidence/ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01/`
  (RED output, conservation output, frozen live capture).

---

## §14 — Conservation (per ACT §17)

Existing diagnostic activations that MUST remain
default-off in public builds:

- EHLOOP (`extension-host-hotloop-diagnostic.ts`)
- CCARD (`continuation-cardinality-authority.runtime-capture.ts`)
- BJLA (`background-job-liveness-authority.ts`)
- BOCOR (`background-owner-correlation.ts`)
- THSICAP (`host-ownership-capture/index.ts`)
- TSWPD (`turn-state-writer-provenance.ts`)

The new diagnostic is a sibling of these. The
dogfood profile resolver is the SOLE gate; there is
no new env var, no override matrix, no parser. Public
builds MUST see `isCancelLivenessDiagnosticEnabled() === false`.

---

## §15 — Removal trigger

When the next ACT (or the operator) confirms the
discriminated boundary and a fix is GREEN on live
qualification — OR the diagnostic is classified
`CAPTURE_INSUFFICIENT` — this ACT's full surface
MUST be removed TOGETHER:

- `cancel-liveness-diagnostic.ts`
- `cancel-liveness-diagnostic-runtime.ts`
- the five capture sites in
  `sdk-task-control-coordinator.ts:76-117`
- the `applyCancelLivenessDiagnosticProfile` helper in
  `dogfood-diagnostic-profile.ts`
- the `extension.ts:activate` activation call
- the Command Palette registration
- the registry entry
- the `package.json` command declaration
- the RED test
- this ACT and its evidence directory

The structural test that pins this invariant is the
`__tests__/cancel-liveness-diagnostic.red.test.ts`
file's `tearDown` block (counters always reset;
diagnostic always off after test).

---

## §16 — Live capture freeze

The operator-supplied live capture for session
`1792072658032_m3gw7` (epoch 22, stateVersion 6372) is
pinned to
`.factory/evidence/ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01/operator-live-capture.jsonl`.
The SHA-256 of that file is recorded in
`SHA256SUMS` once the operator freezes it. The EHLOOP
dump JSON is pinned at
`.../extension-host-hotloop-diagnostic.json.snapshot`
with its SHA-256 in the same `SHA256SUMS`.

Until the operator freezes these files, the ACT
remains in the RED + discriminator state. CLOSE is
not authorized.

---

## §17 — Why a separate diagnostic module, not a counter on the existing ones

The existing EHLOOP counter observes session-event
reentry; CCARD observes run/turn cardinality; BJLA
observes background-job liveness; BOCOR observes
background-job ownership. None of them observes the
Cancel pipeline. A separate module keeps the
REMOVAL_TRIGGER (§15) atomic and prevents the EHLOOP
counter from sprouting a "cancelled" field that would
outlive the bug.
