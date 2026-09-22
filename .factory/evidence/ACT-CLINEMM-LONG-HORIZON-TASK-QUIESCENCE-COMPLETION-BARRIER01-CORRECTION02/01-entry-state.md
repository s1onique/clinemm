ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 / CORRECTION02 — ENTRY STATE
========================================================================================

ENTRY HEAD (start of this ACT)                   = 705b74454 (TQCB01 / CORRECTION01)
ENTRY HEAD (production ground truth)              = same

Pred CLOSED substrate (frozen):
    TQCB01 / CORRECTION01                          = PASS (Path B wired; barrier holds; conservation clean)
    BCNEX01 (presentation exactly-once)           = PASS
    BTCONT01 (deferred continuation)              = PASS
    BCTCP01 (terminal-card projection)            = PASS
    AGCONT01 (agent continuation)                 = PASS
    BCAFG01 (awaiting-followup guard)              = PASS
    LHOWA01-WIRE (authority transport)             = PASS
    PPAT01 (pending-prompt authority)              = PASS

Fresh LIVE evidence (from Factory reviewer, 2026-09-23):

    TQCB01_LIVE_BUG                               = LIVE_PROVEN
        Single-job run:
            job terminal
            → model observes canonical result
            → submit_and_exit
            → COMPLETED #1

            then

            background completion notification arrives
            → autonomous turn starts
            → "I already inspected..."
            → submit_and_exit
            → COMPLETED #2

        SECOND_STEP run: same shape, distinct jobId

        two-job run: same shape for B while A is also held

Root cause (reviewer discriminator):
    BackgroundNotifyCoordinator understood `activeNotifyCount` and
    `pendingPromptCount`, but NOT the ORTHOGONAL WAKE LIFECYCLE. There is
    a window between command_status observing terminal and the
    terminalPromise.then callback reaching `enqueueTerminalWake`:
    during that window the marker is gone (Path B drained it) but no
    wake is queued yet, so the completion barrier sees quiescent state
    and commits COMPLETED. The wake then arrives and starts an
    autonomous turn.

    Two distinct obligations exist:
        RESULT OBLIGATION    = "Has the task incorporated J's terminal result?"
        DELIVERY OBLIGATION  = "Can the runtime still autonomously inject a continuation for J?"

    The completion barrier only consulted the former. The latter was
    uncounted.

MISSION SCOPE:
    Recon → bounded correction to TQCB01 → real RED → causal discriminator →
    bounded dual-delivery arbitration repair → LIVE qualification deferral.

FIX:
    Add explicit first-writer-wins arbitration between Path A (terminal
    notification) and Path B (command_status observation). The marker
    layer is already first-writer-wins (existing code). The wake layer
    must be too: when resolveObligation supersedes an already-enqueued
    wake for the same (sessionId, jobId), the coordinator MUST call a
    host-side discard seam to remove the wake BEFORE runTurn consumes it.

Lower layers UNTOUCHED (per ACT §0 stop rules):
    - CommandJobManager
    - consumeTerminal Path A (already first-writer-wins at marker layer)
    - Q5 long-horizon predicate
    - pending-prompt transport authority
    - terminal-card projection
    - PWAOR abort ownership
    - Hub ordering machinery
    - wake prompt format
    - PROTO_DELTA = NO
    - PUBLIC_TOOL_SCHEMA_DELTA = NO