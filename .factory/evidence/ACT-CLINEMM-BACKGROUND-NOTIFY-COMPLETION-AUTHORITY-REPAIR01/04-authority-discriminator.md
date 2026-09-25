# 04 - Authority Discriminator: H1 vs H2 vs H3

## Live defect (proven)

For jobId `cmd_mugvhy92x7rm527e` in taskId `1790335441241_5g7oe`:

- `run_commands(notifyOnCompletion=true)` → running, J
- originating turn: `command_status(J, waitMs=30000)` → blocks
- originating turn: `submit_and_exit #1` → verified=true
- wake arrives (terminal-wake prompt, BackgroundNotifyCoordinator origin)
- wake turn: `submit_and_exit #2` → verified=true

`semantic_terminal_completion_count(J) == 2`. WAKE_CARDINALITY(J)=1,
terminal_committed(J)=1. The defect is the DUPLICATE
terminal-completion authority for one notify-owned background job.

## Race identified (coordinator seam)

`BNCA-RED-01` (./src/sdk/__tests__/background-notify-completion-authority-fire-and-forget-red01.bnca-red01.test.ts)
proves that the existing dual-delivery arbitration fails when:

  Path A: `BackgroundNotifyCoordinator.consumeTerminal(...)`
          → `enqueueTerminalWake` is FIRE-AND-FORGET
            (mirror of SdkController.ts:738
             `void active.sdkHost.send(...).catch(...)`)

  Path B: `BackgroundNotifyCoordinator.resolveObligation(...)`
          (called by `command_status` after observing terminal state)
          → `discardQueuedWake` is FIRE-AND-FORGET
            (mirror of `discardQueuedWakeForJobIdOnHost` which
             does NOT await `host.pendingPrompts("delete", ...)`)

The discard's `list()` runs synchronously AFTER `consumeTerminal`'s
`enqueue()` has queued a microtask. The list returns `[]` because
the wake has not yet landed. The discard returns `not_found`. The
wake later lands and fires a second autonomous turn.

## Pre-repair observable defect

`BNCA-RED-01` first test asserts `sink.list(sessionId).length === 1`
— i.e., the wake survives the discard attempt. Pre-repair, this
assertion PASSES (defect confirmed). Post-repair (H1), the discard
seam is unreachable for notify-owned jobs because Path B is
suppressed at the `command_status` tool level.

## Discriminators evaluated

### D1 — prevent blocking terminal wait for wake-owned J (H1)

Hypothesis: `command_status(J, waitMs>0)` for a notify-owned active J
should return immediately (state=running) and signal that the
notification owns the terminal wait. The originating turn cannot
claim terminal-completion authority for J.

Selection criteria mapping:

| Criterion                  | H1 verdict            | Notes                                       |
|----------------------------|-----------------------|---------------------------------------------|
| A. Intent                  | MATCH                 | User asked for deferred notification         |
| B. Reliability             | MATCH                 | Original turn may end before J finishes     |
| C. Race safety             | MATCH                 | Only wake owns terminal completion           |
| D. Multi-job isolation     | MATCH                 | Per-jobId consult; independent               |
| E. Explicit polling        | MATCH                 | Non-blocking read still works                |
| F. No model dependence     | MATCH                 | Framework enforces; model cannot escape      |

H1 is the preferred direction.

### D2 — consume wake authority when origin consumes terminal (H2)

Hypothesis: originating turn may legitimately block on
`command_status`; if it consumes terminal result, the wake must
stand down.

Problem: standing down the wake requires synchronous cancellation
of an already-enqueued wake. The discard seam is fire-and-forget
(proven broken above). Even if the discard worked synchronously,
the originating turn's submit_and_exit would still race with the
wake's runTurn start.

Verdict: H2 preserves the dangerous race. REJECTED unless H1
proves impossible (it does not — see recon).

### D3 — atomic claim operation (H3)

Hypothesis: add an internal claim token. First successful
origin/wake wins; the loser becomes a no-op.

Problem: H3 is the most general but adds the most state. It does
not reduce complexity compared to H1; it only rephrases the race.
H1 enforces the right invariant at the highest semantic level
(the model cannot simultaneously block-wait AND claim completion).

Verdict: H3 is unnecessary if H1 holds. REJECTED.

## Selected: H1

`command_status(J, waitMs>0)` for a notify-owned active J returns
state=running with a structured message indicating the wake owns
the terminal wait. The originating turn cannot synchronously
wait a notify-owned job to terminal state. This removes the race
entirely at the tool layer.

## H1 contract (bounded repair)

For jobId `J`:

  if `BackgroundNotifyCoordinator.hasActiveNotify(J)`:
    if `waitMs > 0`:
      # Notify-owned active job: the wake owns terminal
      # completion. The originating turn may NOT block-wait
      # to terminal state.
      return {
        ok: true,
        jobId: J,
        state: "running",          # truthful: terminal not yet observed
        notification: "pending",    # structured signal
        stdout: "",                 # empty: not delivered here
        stderr: "",
        deadlineRemainingMs: ...,
        elapsedMs: ...,
      }
    else:
      # Non-blocking status read: behavior unchanged.
      # Snapshots remain readable; terminal observation is
      # still permitted (just NOT consumed as a completion
      # claim — Path B resolveObligation is suppressed
      # only when waitMs > 0 AND the job is notify-owned
      # AND the state is non-terminal).
      ... existing path ...

  else:
    # Not notify-owned: existing behavior unchanged.
    ... existing path ...

The exact shape of the return payload is refined in
`05-repair-ablation.txt` (the GREEN test artifact).

## Reopen conditions

If any of these appears during live qualification:

- non-notify command_status(waitMs>0) regression
- terminal_committed > 1
- wake_created > 1
- C4->C8 correlation breaks
- OOM repair reopens

→ HALT and revisit.
