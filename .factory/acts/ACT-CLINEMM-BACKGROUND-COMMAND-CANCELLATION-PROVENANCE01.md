# ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01

> Status: **LIVE_BOUND / CASE_CP3_CALLER_ABORT_SIGNAL /
> LIVE_CAUSALITY = ESTABLISHED /
> PRODUCTION_REPAIR = AUTHORIZED_FOR_BOUNDED_NEXT_ACT_ONLY /
> Q5 = EXONERATED /
> TSWPD = EXONERATED_GIVEN_EMPTY_ACTIVE_SET /
> TaskHeader = EXONERATED /
> CommandJobManager = BEHAVING_CORRECTLY_GIVEN_ABORT /
> NEXT = `ACT-CLINEMM-BACKGROUND-COMMAND-PROCEED-WHILE-RUNNING-ABORT-OWNERSHIP-RELEASE01` (bounded repair ACT only; do not touch Q5, TaskHeader, CommandJobManager architecture, owner/session identity, status authority, PGID helper semantics, `submit_and_exit`, or terminal row mutation in this ACT).**

Epistemic purpose: **causal discriminator with bounded repair
authorization** (per ACT §0).

```text
ENTRY_HEAD             = bab253afba4c06ce0f847f08c5718c131561565f
SOURCE_HEAD            = bab253afba4c06ce0f847f08c5718c131561565f
ACT_COMMIT_HEAD        = 640cc388131ad8071e7a2feccb456c580d1d09a5
VSIX_IDENTITY_COMMIT   = 935ef93d6 (bind dogfood VSIX identity metadata)
DOGFOOD_VSIX           = dist/clinemm-4.1.16-bjla-cancellation-provenance01.vsix
                         SHA-256 5195db3af3e3f09e95ec2dcfacfafe45694e13244d5a8957276366ce937c71e5
                         HEAD    640cc388131ad8071e7a2feccb456c580d1d09a5
BOUND_SPECIMEN         = task sessionId=1789914077854_aq4sy,
                         job cmd_mu9wmnyuhvgva8cn,
                         manager M2,
                         pre-cancel state "running",
                         terminal state "cancelled",
                         active-remove reason "cancel",
                         cleanup postcondition "gone",
                         cancellation requestOrigin "caller_abort_signal",
                         cancellation latency ~147.3 s after job insert
```

**Verdict** (per ACT mission):
```text
CANCELLATION_REQUESTER    = caller_abort_signal (CP3, mechanically
                                              classified from the
                                              job_cancellation_requested
                                              requestOrigin field on the
                                              wire; firstWriterWins=true;
                                              currentState="running" at
                                              the request boundary)
LIVE_CAUSALITY            = ESTABLISHED (causal, not just chronological)
background_cancel_rpc     = REFUTED
extension_shutdown        = REFUTED
command_deadline          = REFUTED
manager_instance_split    = REFUTED
owner_mismatch            = REFUTED
CommandJobManager         = BEHAVING_CORRECTLY_GIVEN_ABORT
Q5_BOCOR                  = EXONERATED
TSWPD_WRITER              = EXONERATED_GIVEN_EMPTY_ACTIVE_SET
TaskHeader                = EXONERATED
VscodeRunCommands BG path = BEHAVING_AS_DESIGNED_BUT_HOLDING_LEAKED_OWNERSHIP
PRIMARY_REPAIR_SEAM       = PROCEED-WHILE-RUNNING ABORT-SIGNAL OWNERSHIP TRANSFER
SECONDARY_DEFERRED        = STALE_CARD_AFTER_CANCEL
PRODUCTION_REPAIR         = NOT IN THIS ACT (bounded repair authorized
                                         for the next ACT only)
NEXT                      = ACT-CLINEMM-BACKGROUND-COMMAND-PROCEED-WHILE-
                            RUNNING-ABORT-OWNERSHIP-RELEASE01
```
## §0 — Epistemic purpose

The LIVE contradiction under investigation:

```text
UI / model-visible command:
  jobId = cmd_mu9wmnyuhvgva8cn
  card  = Backgrounded
  Cancel = visible
  status = running

BOCOR / Q5 guard:
  activeJobs = []
  guardResult = false

followed by:

TSWPD:
  writerId = session-event-turn-complete-resumable-straggler-preserve
  streaming → awaiting_followup
```

This ACT introduces the **CP** (Cancellation Provenance) diagnostic —
the `job_cancellation_requested` BJLA event with a threaded
`requestOrigin` label — to classify the LIVE occurrence as one of:

  - CP1 (background_cancel_rpc — public cancelBackgroundCommand gRPC seam)
  - CP2 (manager_dispose — legacy dispose-loop caller with no
    production callers in the current code base)
  - CP3 (caller_abort_signal — the caller's AbortSignal aborting
    inside `manager.start`)
  - CP4 (command_deadline — distinct reason="deadline")
  - CP5 (tool_cleanup — no production caller in the recon that
    cancels a registered background CommandJob on tool cleanup)
  - CP6 (extension_shutdown — controller dispose via lifecycle
    dispose via host dispose via manager dispose)
  - CP7 (other proven requester — escape only)

This ACT does NOT repair. The bounded repair is the next ACT's
responsibility after the LIVE specimen is captured.

## §1 — Entry state

```text
git rev-parse HEAD = bab253afba4c06ce0f847f08c5718c131561565f
git status --short = CLEAN (no uncommitted modifications)
```

HALT_UNEXPECTED_TRACKED_DIRT = NOT_TRIGGERED.

## §2 — Frozen LIVE evidence

Sources:
  - Operator-side BJLA dump produced by the dogfood VSIX
    (`clinemm-4.1.16-bjla-cancellation-provenance01.vsix`,
    SHA-256 5195db3af3e3f09e95ec2dcfacfafe45694e13244d5a8957276366ce937c71e5,
    HEAD 640cc388131ad8071e7a2feccb456c580d1d09a5).
  - The frozen REQUEST chain is recorded verbatim in
    `.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01/25-live-result.md`.
  - The frozen MUTATION chain is from the predecessor ACT
    (`ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01`).

The LIVE specimen proves, mechanically, that:

  1. `job_cancellation_requested.requestOrigin = "caller_abort_signal"`.
  2. The job was in `currentState = "running"` at the request boundary.
  3. The single manager M2 carried the job across insert, polls,
     terminate, active delete, and BOCOR guard.
  4. The first-writer-wins latch (`job.terminationPromise`) was
     unset at the moment of the request, so this is the unique
     requester for the cycle.
  5. The MUTATION chain (`command_job_termination_started` →
     `pgid_cleanup` → `process_terminality_record` →
     `job_active_removed`) followed immediately.
  6. The downstream Q5 guard returned false on the empty active set,
     and TSWPD committed `streaming → awaiting_followup`.

## §3 — Causal chain

```text
running managed job (M2, cmd_mu9wmnyuhvgva8cn)
  ↓
CALLER ABORT SIGNAL    (context.signal aborted on the foreground
                         tool/turn that started this job)
  ↓
CommandJobManager cancels job  (job_cancellation_requested →
                                 command_job_termination_started →
                                 pgid_cleanup →
                                 process_terminality_record →
                                 job_active_removed)
  ↓
active map becomes empty
  ↓
Q5 correctly returns false
  ↓
awaiting_followup
  ↓
Your turn
```

## §4 — Exoneration matrix

```text
background_cancel_rpc           = REFUTED (requestOrigin ≠
                                            "background_cancel_rpc";
                                            operator did not click
                                            Cancel; the exact jobId
                                            cancel seam was not invoked
                                            before the firstWriterWins
                                            write fired)
extension_shutdown              = REFUTED (requestOrigin ≠
                                            "extension_shutdown"; no
                                            manager_dispose_begin event
                                            in the dump; controller
                                            remained alive after the
                                            transition)
command_deadline                = REFUTED (job_active_removed.reason
                                            = "cancel", not "deadline";
                                            deadline timer never fired
                                            for this jobId within the
                                            ~147.3 s window)
manager_instance_split          = REFUTED (single manager M2 across
                                            insert, multiple polls,
                                            terminate, active delete,
                                            BOCOR guard)
owner_mismatch                  = REFUTED (queriedOwnerSessionId ==
                                            activeSessionId ==
                                            1789914077854_aq4sy)
CommandJobManager               = BEHAVING_CORRECTLY_GIVEN_ABORT
Q5_BOCOR                        = EXONERATED (guard correctly
                                            returned false on empty
                                            active set; no logic delta)
TSWPD_WRITER                    = EXONERATED_GIVEN_EMPTY_ACTIVE_SET
                                            (writer fired only because
                                            the active set was empty;
                                            the writer itself was not at
                                            fault)
TaskHeader                      = EXONERATED (projection flip was a
                                            direct consequence of the
                                            empty active set, not an
                                            independent header defect)
VscodeRunCommands BG path       = BEHAVING_AS_DESIGNED_BUT_HOLDING_LEAKED_OWNERSHIP
                                            (foreground coordinator
                                            handed the managed CommandJob
                                            to the background projection,
                                            but the original
                                            context.signal abort listener
                                            was NOT released — this is
                                            the contract defect)
```

## §5 — Architectural root cause

Per `sdk/ARCHITECTURE.md` §proceed-while-running:

> "Proceed-while-running is an explicit command lifecycle, separate
> from client or session detachment. ... The executor removes its
> abort and timeout ownership, resolves the tool call with the
> current bounded output and a temporary log path, and continues
> draining the process into that log."

The `backgroundExec` path of `VscodeRunCommands` does NOT perform
this contract step. `CommandJobManager.start(..., context)` installs
`context.signal.addEventListener("abort", listener, { once: true })`
on the caller's signal
(`apps/vscode/src/sdk/command-job-manager.ts:1947-1953`) and the
listener is NEVER released when the foreground tool returns RUNNING.
The job is supposed to be detached at that point — but the abort
listener is still attached, and any later abort on the original
signal cancels the supposedly detached job.

This is the contract defect the LIVE specimen proves.

## §32 — Conservation invariants (post-LIVE)

C1–C15 (see `.factory/evidence/.../19-conservation.txt`) STILL HOLD
post-LIVE. The bounded repair ACT is responsible for keeping them
holding; this ACT does not modify any production code.

## §34 — Stop rule

STOP after (a) the cancellation requester is proven and (b) the
bounded repair is authorized. Do NOT change Q5, TaskHeader,
CommandJobManager architecture, owner/session identity, status
authority, PGID helper semantics, `submit_and_exit`, or terminal
row mutation. One cancellation request. One caller. One repair.

The cancellation requester is proven (`caller_abort_signal`). The
bounded repair is authorized for the next ACT.

## §35 — Next ACT (C1: GO)

`ACT-CLINEMM-BACKGROUND-COMMAND-PROCEED-WHILE-RUNNING-ABORT-OWNERSHIP-RELEASE01`
— bounded repair that removes the caller's `AbortSignal` listener
from the managed background `CommandJob` at the
foreground→background handoff, while preserving:

  - before handoff: caller `AbortSignal` still cancels the foreground
    command (CP3 behavior for the tool/turn it owns)
  - after handoff: caller `AbortSignal` no longer owns the detached
    CommandJob (CP3 must NOT fire on the detached job)
  - explicit background Cancel (CP1, `cancelBackgroundCommand` gRPC):
    still cancels by exact `jobId`
  - extension shutdown (CP6): still cancels every active job via
    the manager dispose loop
  - deadline semantics (CP4): still fires the deadline timer
    independently of the caller's signal
  - tool-cancellation propagation (`sdkHost.abort(sessionId)`):
    unchanged — does not touch background CommandJobs at this seam

The RED for the next ACT is tiny:

```text
start managed command with AbortSignal (foreground tool → background
job via CommandJobManager.start({...}, context))
→ proceed/background handoff completes (foreground tool returns RUNNING
   with the jobId)
→ abort original signal (simulating the originating turn abort)
→ command MUST remain running
```

Current behavior (per LIVE `cmd_mu9wmnyuhvgva8cn`) reproduces:

```text
abort original signal
→ job_cancellation_requested(requestOrigin="caller_abort_signal",
                              firstWriterWins=true,
                              currentState="running")
→ command_job_termination_started
→ cancelled
```

The bounded repair is similarly tiny:

```text
on successful foreground→background handoff in the backgroundExec
  path of VscodeRunCommands:
  - capture the AbortSignal that was attached to the foreground tool
  - on handoff completion (foreground tool returns RUNNING with jobId):
      remove the abort listener from the CommandJob
      clear job.abortSignal and job.abortListener so a future
        call cannot fire it
  - re-check: if context.signal has already aborted between the
    start() call and the handoff completion, treat that as a
    pre-handoff cancel (still fire the listener once) — i.e. the
    race between "signal aborts" and "tool returns RUNNING" must
    be resolved in favour of "no handoff, treat as cancel"
```

## §36 — Secondary stale-card issue (DEFERRED)

The screenshot still shows the old `Backgrounded` card and Cancel
button after the authoritative job has been cancelled. This is a
**stale-card/projection issue, not the causal root of `Your turn`**,
and is deferred to a separate ACT. It is recorded as
`STALE_CARD_AFTER_CANCEL = OBSERVED / DEFERRED`.

## §37 — Evidence inventory

```text
01-entry-state.txt                                (entry state)
02-live-predecessor-freeze.md                     (predecessor freeze)
03-cancellation-authority-map.md                  (production caller
                                                   inventory)
04-recon.txt                                      (recon)
05-hypotheses.md                                  (CP1-CP7 hypotheses)
06-diagnostic-delta.md                            (BJLA delta)
07-provenance-tests.txt                           (BCP test plan)
08-build-before-live.txt                          (pre-LIVE build)
09-vsix-identity.txt                              (VSIX identity)
14-cancellation-timeline.md                       (extended with
                                                   LIVE specimen)
15-causal-classification.txt                      (LIVE_BOUND /
                                                   CASE_CP3)
16-red.txt                                        (RED — N/A;
                                                   instrumentation
                                                   qualified)
17-ablation.txt                                   (CP3 ablation)
18-repair-diff.txt                                (REPAIR_DIFF = NONE
                                                   in this ACT)
19-conservation.txt                               (C1-C15 HOLD)
20-green.txt                                      (GREEN proof)
21-live-qualification.md                          (LIVE_BOUND, closed)
22-diagnostic-removal.txt                         (diagnostic-removal
                                                   plan)
23-gates.txt                                      (G1-G12, including
                                                   LIVE_RESULT gates)
25-live-result.md                                 (NEW — single-source
                                                   LIVE specimen)
result.json                                       (LIVE_BOUND /
                                                   CASE_CP3_BOUNDED_REPAIR_AUTHORIZED)
```
