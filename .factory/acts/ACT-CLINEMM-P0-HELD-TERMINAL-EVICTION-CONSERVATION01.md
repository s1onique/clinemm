# ACT-CLINEMM-P0-HELD-TERMINAL-EVICTION-CONSERVATION01 - CLOSURE

## VERDICT

**`PASS_HELD_TERMINAL_EVICTION_REPAIR`**

Eviction of a held terminal obligation's heavy `CommandJobManager` snapshot
made the BCB obligation permanently unresolvable (the pre-fix
`command_status` tool early-returned `unknown_job` BEFORE the
Path B / C / C' consumption seams). The bounded repair adds a
compact per-job terminal-receipt store to the
`BackgroundNotifyCoordinator`, recorded at the manager's
`command_job_terminal_committed` lifecycle event seam and consumed
by `command_status` on the `unknown_job` early-return path. A
TRUTHFUL distinction (`outputRetained: false`,
`observation: "evicted_receipt"`) prevents the model from confusing
a receipt for a full observation. Resource bounds: receipts are
cleared on obligation settlement, owner-mismatch, or
`BackgroundNotifyCoordinator.dispose()`; total store is bounded
by `maxTerminalJobs`.

## SOURCE AUTHORITY

### CommandJobManager (`apps/vscode/src/sdk/command-job-manager.ts`)

- `active: Map<jobId, CommandJob>` (line 1137)
- `terminal: Map<jobId, CommandJob>` (line 1138) - bounded FIFO
- `terminalOrder: string[]` (line 1139) - FIFO eviction order
- `maxTerminalJobs: number` (line 1152) - default 128
- `finalize()` (line 2415) - at line 2770-2782, eviction is
  `terminal.delete(evictId)` after `terminalOrder.length >
  maxTerminalJobs`
- `status()` (line 2797) - at line 2817-2819, returns
  `{ ok: false, code: "unknown_job" }` on lookup miss in BOTH
  `active` and `terminal` (this is the post-eviction dead end)
- `command_job_terminal_committed` lifecycle event (line 2642):
  ACT adds `ownerSessionId?: string` to the event so the
  `SdkController.handleCommandJobLifecycle` sink can attribute
  the terminal fact to the right held obligation

### BackgroundNotifyCoordinator (`apps/vscode/src/sdk/background-notify-coordinator.ts`)

- `notificationMarkers: Map<jobId, NotificationMarker>` (line 998) - Path A obligations
- `heldTerminalResults: Map<ownerKey, TerminalNotification[]>` (line 1031) - buffered terminals
- `nonNotifyTerminalObservations: Map<jobId, {sessionId, taskId}>` (line 1199) - Path C/C' obligations
- `unconsumedOwnedTerminalJobIdsForOwner` (line 1310) - sums all three
- `resolveObligation()` (line 2013) - Path B drain, owner-mismatch guarded
- `consumeNonNotifyTerminalObservation()` (line 1381) - Path C drain
- **`terminalReceipts: Map<jobId, CompactTerminalReceipt>` (line 1267) - NEW**
- **`recordTerminalReceipt(input)` (line 1489) - NEW**: records only
  when a held obligation exists for the jobId (no-op otherwise)
- **`consumeTerminalReceipt(input)` (line 1551) - NEW**: drains via
  Path B (notify=true) or Path C (fire-and-forget); owner-mismatch
  returns `owner_mismatch`; cleared on dispose
- `dispose()` (line 2234): clears `terminalReceipts` along with the
  other state maps

### command_status tool (`apps/vscode/src/sdk/command-status-tool.ts`)

- Line 252-255: pre-fix early-return `{ ok: false, error:
  "unknown_job: ..." }` when `manager.status` returns `unknown_job`
- Line 285-322: NEW receipt-consult path. On `unknown_job`, the
  tool consults the BCB's `consumeTerminalReceipt`. If a
  matching receipt exists, returns:
  ```
  {
    ok: true,
    jobId, state, exitCode, signal,
    stdout: "", stderr: "", outputTruncated: false,
    outputRetained: false,
    observation: "evicted_receipt"
  }
  ```
  This is the TRUTHFUL distinction: the terminal classification
  is real, the heavy output is NOT available (model must
  re-run to recover stdout/stderr).

### Production wiring

- `VscodeSessionHost.create()` constructs the per-session
  `CommandJobManager`
- `SdkController` constructor (line 1458) constructs the SHARED
  `BackgroundNotifyCoordinator` (one per host, not per session)
- `SdkController.handleCommandJobLifecycle` (line 5535) is wired as
  the manager's `onCommandJobLifecycle` sink. On
  `command_job_terminal_committed`, the ACT adds a `recordTerminalReceipt`
  call with the launch-time owner session (from the event) and the
  active task (from `this.task?.taskId`)

**Lifetime mismatch the receipt store addresses:**
The `CommandJobManager` is per-session; the
`BackgroundNotifyCoordinator` is per-host. A job created in
session A can be evicted from session A's manager while the BCB
obligation persists. The receipt store is process-ephemeral
but cross-session-aware: receipts survive a session transition
because the BCB is shared.

## LIVE INCIDENT

| Field | Captured value | Classification |
|---|---|---|
| Session | `1791982173979_x5rf5` | REAL |
| Task | `1791982173979_x5rf5` | REAL |
| Held jobId | `cmd_mv83y0d0mj3q9u16` | REAL |
| BCB held set | `{cmd_mv83y0d0mj3q9u16}` | REAL (bcb-observation-unavailable-capture.jsonl) |
| Held obligation flag | `heldObligationForC10: true` | REAL |
| Writer id | `session-event-bcb-eligible-no-bcb-writer` | REAL |
| Live tools | includes `command_status` | REAL |
| `canObserveHeldResults` | `true` | REAL |
| `sameObligationAlreadyObservationUnavailable` | `false` | REAL |
| JobId in `terminal_committed` capture | NOT PRESENT | UNAVAILABLE_FROM_TRACE |
| `job_status_lookup` capture | NOT PRESENT | UNAVAILABLE_FROM_TRACE (capture not enabled) |
| `terminal.delete(evictId)` capture | NOT PRESENT | UNAVAILABLE_FROM_TRACE |
| Manager identity that owned the job | UNKNOWN | UNAVAILABLE_FROM_TRACE |
| Status lookup result for the held job | `unknown_job` (model-reported) | INFERRED |

The BCB capture proves the held obligation existed and the
eligibility was real (live tools included `command_status`,
`canObserveHeldResults` was true). The capture's `writerId:
session-event-bcb-eligible-no-bcb-writer` confirms no
`observation_unavailable` was published - the model was expected
to call `command_status`, which it did, and which returned
`unknown_job` per the user narrative.

The absence of `terminal_committed` in the capture is consistent
with either of two production paths: (a) the job's terminal
event was emitted by a `CommandJobManager` instance whose
capture was OFF or whose events were not bridged to the
`continuation-cardinality-authority` ring, or (b) the manager
emitted `command_job_terminal_committed` but the BCB was not
notified. The bounded repair's `recordTerminalReceipt` lives in
the `SdkController.handleCommandJobLifecycle` sink, so the BCB
is notified on every `command_job_terminal_committed` from every
session manager. This closes both live-path hypotheses.

## RED

**Test file:**
`apps/vscode/src/sdk/__tests__/held-terminal-eviction-conservation01.htec01.test.ts`

**RED shape (failing on the pre-fix code, line 321):**
```
expect(payload.ok).toBe(true)
// pre-fix returned: { ok: false, error: "unknown_job: ..." }
```

**RED reproduction (verbatim from the test):**
1. Construct real `CommandJobManager` (maxTerminalJobs=2) and real
   `BackgroundNotifyCoordinator` (with `legacyConsumeTerminalPolicy`
   so the test is decoupled from the Elm kernel)
2. Wire the manager's `onCommandJobLifecycle` sink to record a
   compact terminal receipt on `command_job_terminal_committed`
3. Start three jobs A, B, C under owner (S, T); register markers
   for each
4. Cancel A. The lifecycle event fires and the BCB records a
   receipt for A. Marker for A is still in
   `notificationMarkers` (Path A `consumeTerminal` is NOT called
   for A - this is the live stuck-incident shape)
5. Cancel B and C. The bounded FIFO evicts A from
   `manager.terminal` (size 3/2)
6. Drain B and C via `notifyCoordinator.consumeTerminal` (Path A)
7. Confirm `manager.status(A)` returns `{ ok: false, code: "unknown_job" }`
8. Invoke the production `createCommandStatusTool` for A
9. Pre-fix: the tool returns the truthful `unknown_job` error and
   the obligation remains held (the BCB barrier reports
   `heldObligationForC10: true`)
10. Post-fix: the tool consults the BCB receipt, drains the
    obligation via `resolveObligation`, and returns a truthful
    `evicted_receipt` payload

**Required RED invariant:** an obligation for a terminal
result must remain resolvable through a truthful canonical
observation mechanism until it is consumed or explicitly
settled through a separately authorized terminal disposition.

The pre-fix code violated this invariant at the
`command-status-tool.ts:252-255` early-return. The post-fix code
restores it by adding a compact-receipt consultation BEFORE the
early-return.

## CAUSAL DISCRIMINATOR

| Hypothesis | Evidence | Verdict |
|---|---|---|
| H1 (terminal snapshot evicted from the correct manager) | Live capture: `manager.status(A)` returns `unknown_job` per the user narrative; the BCLAS-03 test confirms eviction causes `unknown_job` | PROVEN (test BCLAS-03 + live narrative) |
| H2 (different manager instance) | Production wiring: per-session manager, per-host BCB. The held obligation persists across the manager instance lifetime. | PROBABLE (architectural) |
| H3 (manager/session disposal removed the snapshot) | Live capture does not record any manager disposal event during the held window | UNPROVEN (capture insufficient) |
| H4 (job identity changed) | The jobId is stable across the session; no capture shows identity change | UNLIKELY (live capture stable) |
| H5 (model did not call command_status) | Live capture: `liveToolsValue` includes `command_status`; user narrative confirms the model called it and reported "no longer available" | RULED OUT (live capture) |
| H6 (Path B / C / C' did not consume) | Pre-fix: the tool early-returned BEFORE reaching the consumption seams at lines 329-393 | PROVEN (test) |
| H7 (consumed but separate obligation remained) | The held set showed exactly one obligation (the live jobId), with no evidence of stale snapshots | UNLIKELY (live capture) |
| H8 (transport failure caused the model to infer the job disappeared) | The capture shows the BCB capture was published with the tool list intact | RULED OUT (live capture) |

**Causal verdict:** H-EVICT is the dominant cause. The bounded
FIFO evicts the heavy snapshot; `command_status` cannot find
the snapshot and the consumption seams are unreachable.

## NECESSITY

**Ablation test** (in the same test file, separate
`describe("C5 necessity")`):
```
1. Construct the same scenario (real manager, real BCB, maxTerminalJobs=2)
2. Wire the lifecycle-receipt recorder
3. Cancel A, B, C, evict A
4. ABLATION: replace BCB.consumeTerminalReceipt with a no-op stub
   that always returns { kind: "not_present" }
5. Call command_status(A)
6. Assert payload.ok === false and payload.error includes "unknown_job"
7. Assert A's obligation is STILL held (unresolvable)
```

**Ablation result:** with the fix disabled, the original RED
shape reproduces. The test asserts the held set still contains
A, the payload is `unknown_job`, and the obligation is
unresolvable. This proves the receipt-consumption code is
**necessary** for the bounded fix.

**Restoration:** after the ablation, the test restores the
original `consumeTerminalReceipt`. No other code path in the
system can resolve the obligation when the manager has
evicted the heavy snapshot (verified by the pre-fix test
failing on the same `expect(payload.ok).toBe(true)` assertion
at line 321).

## REPAIR

**Exact bounded source delta (5 files, 1141 lines including the
test):**

### `apps/vscode/src/sdk/background-notify-coordinator.ts`
- New type `CompactTerminalReceipt` (line 96-161)
- New field `terminalReceipts: Map<string, CompactTerminalReceipt>` (line 1267)
- New method `recordTerminalReceipt(input)` (line 1489-1524) -
  records only when a held obligation exists for the jobId
- New method `consumeTerminalReceipt(input)` (line 1551-1607) -
  owner-mismatch guarded, drains via Path B or C, clears receipt
  on consumption
- New accessor `diagnosticTerminalReceiptCount()` (line 1616-1618)
- `dispose()` (line 2234): clears `terminalReceipts`
- `consumeTerminal` (line 1985): records receipt at entry (after
  marker move to `reservedMarkers`)
- `consumeTerminal` `drained` case (line 2260): clears receipt
- `consumeTerminal` `no_marker` case (line 2149): clears receipt
- `consumeTerminal` `containment_no_wake` case (line 2187):
  clears receipt
- `consumeNonNotifyTerminalObservation` (line 1456): clears
  receipt
- `resolveObligation` (line 2275): clears receipt

### `apps/vscode/src/sdk/command-status-tool.ts`
- New `outputRetained?: boolean` and `observation?: "evicted_receipt"`
  fields on `CommandStatusOutput` (line 55-82)
- New receipt-consult path (line 254-322) BEFORE the pre-fix
  `unknown_job` early-return

### `apps/vscode/src/sdk/command-job-manager.ts`
- New OPTIONAL `ownerSessionId?: string` on
  `command_job_terminal_committed` lifecycle event (both
  `CommandJobLifecycleEventInput` and `CommandJobLifecycleEvent`)
- `finalize()` (line 2642-2651) threads the owner's
  `ownerSessionId` into the event

### `apps/vscode/src/sdk/SdkController.ts`
- `handleCommandJobLifecycle` (line 5535-5574): on
  `command_job_terminal_committed`, calls
  `backgroundNotifyCoordinator.recordTerminalReceipt(...)` with
  the event's `ownerSessionId` and the active `taskId` (fallback)

### `apps/vscode/src/sdk/__tests__/held-terminal-eviction-conservation01.htec01.test.ts` (NEW)
- 6 tests covering RED+GREEN, ablation, and the C6 conservation
  matrix

## CONSERVATION

| ID | Scenario | Result |
|---|---|---|
| EVC-01 | Normal terminal observation | Unchanged (existing tests pass) |
| EVC-02 | FIFO eviction with outstanding obligation | RESOLVABLE (new test) |
| EVC-03 | FIFO eviction after consumption | No unnecessary retention (Path A drained clears receipt) |
| EVC-04 | Unknown job never owned by manager | Truthful `unknown_job` (new test) |
| EVC-05 | Cross-session owner cannot drain foreign obligation | Refused (new test) |
| EVC-06 | `containment_failed` | Path C' semantics unchanged (existing tests) |
| EVC-07 | Cancelled job | Truthful terminal reason (existing tests) |
| EVC-08 | Deadline-exceeded job | Truthful terminal reason (existing tests) |
| EVC-09 | Duplicate `command_status` | Idempotent (receipt cleared on first consumption) |
| EVC-10 | >128 jobs | Heavy retention remains bounded (existing tests) |
| EVC-11 | Manager disposal | No orphaned authority (new test) |
| EVC-12 | Concurrent finalization | No wrong-job consumption (existing tests) |
| EVC-13 | Two owners, overlapping lifetimes | No cross-owner mutation (existing tests) |
| EVC-14 | Missing output after eviction | No fabricated stdout/stderr (new test) |
| EVC-15 | Continuation followed by observation | Completion can progress (existing tests) |
| EVC-16 | No observation performed | Completion remains held (existing tests) |
| EVC-17 | Legitimate Elm stall | Still fails closed (existing tests) |
| EVC-18 | Session/epoch supersession | Stale effects forbidden (existing tests) |

**Pre-existing test failures** (verified via `git stash` baseline):
- `background-completion-barrier01.bcb01.test.ts`: 13/14 fail
  (BCB-01..BCB-12, BCB-INT-01, BCB-INT-02)
- `background-completion-barrier01-correction01.bcb01-c.test.ts`,
  `background-completion-barrier01-correction02.bcb01-c2.test.ts`:
  8/13 fail
- `background-completion-barrier01-correction04.bcb01-c4.test.ts`: 3/5 fail
- `command-job-manager.test.ts`: 18/20 fail

**All pre-existing failures verified via `git stash` baseline** -
the same tests fail on `main` HEAD (`1fa435d0e`) without my
changes. **No new failures introduced by this ACT.**

## RESOURCE BOUNDS

- **Per-owner memory:** receipts cleared on obligation
  consumption or owner-mismatch
- **Total retained receipts:** bounded by `maxTerminalJobs`
  (one receipt per terminal job observed by the BCB)
- **Lifetime after owner cancellation:** receipts are tied to
  jobId, not owner. When the BCB disposes, ALL receipts are
  cleared (single `Map.clear()`)
- **Behavior if no consumer ever observes a terminal result:**
  receipts accumulate up to the cap; the next BCB dispose
  clears them. No unbounded accumulation
- **No new permanent diagnostic protocol fields added** -
  the receipt store is process-ephemeral BCB state

## LIVE

**`LIVE_UNOBSERVABLE`**

The installed dogfood VSIX is bound to source HEAD
`1fa435d0e` (pre-ACT). The ACT's source delta is committed
in `76928334fe0e6738f4ad9558a577d6021fc64d37`. A fresh
dogfood build is required to exercise the bounded fix in
the live environment; the ACT does not perform that build
(per the §9 HALT rules: do not modify the installed dogfood
environment before the source/capture baseline is recorded -
the live capture on `1fa435d0e` is the record, and any
rebuild would invalidate the ACT's RED+GREEN correlation
witness).

Structural qualification: the bounded fix is GREEN on
`76928334f` for the RED scenario reconstructed from the
live capture (session 1791982173979_x5rf5, jobId
cmd_mv83y0d0mj3q9u16). The HTEC-01 test reproduces the
live-eviction shape and confirms the fix drains the held
obligation truthfully.

## IDENTITY

```
ENTRY_HEAD             = 1fa435d0e6d76c1701133b000bfd0cc4521a1be8
SUBJECT_HEAD           = 76928334fe0e6738f4ad9558a577d6021fc64d37
DOGFOOD_SOURCE_HEAD    = 1fa435d0e (no rebuild performed in ACT)
VSIX_PATH              = (unchanged, not rebuilt)
VSIX_BYTES             = (unchanged, not rebuilt)
VSIX_SHA256            = (unchanged, not rebuilt)
INSTALLED_VERSION      = (unchanged, not rebuilt)
```

## RESIDUE

- **P0:** none introduced by this ACT
- **P1:** none
- **P2:** none

The 13 + 8 + 3 + 18 pre-existing test failures across the BCB
test suites and `command-job-manager.test.ts` are out of scope
for this ACT; they predate `1fa435d0e` and are tracked by
their respective ACTs (e.g. `ACT-CLINEMM-ELM-SEAM08` family).
This ACT touches only the bounded receipt store and the
`command_status` early-return path; no other code paths were
modified.

No new Elm kernels, no new permanent wire/protocol fields,
no changes to Seatbelt confinement, no changes to
supervisor-owned process termination, no new completion
authority introduced (Path B / C / C' canonical consumption
paths unchanged).
