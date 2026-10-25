# R4 — Disposition

**The production-seam RED REPRODUCES.** This ACT is therefore NOT
`HALT_RED_NOT_REPRODUCED`, and NOT `CAPTURE_INSUFFICIENT`: the required post-terminal
boundary IS observable (the LIVE provenance, the LIVE BCB capture, the LIVE Elm
counters, the LIVE projection captures and the LIVE webview capture are all present and
all mutually consistent), and the defect is reproducible at the REAL production seam.

**Production changes: NOT authorized during reproduction.** The repair below is the
PROPOSED bounded repair ACT; it is NOT implemented here.

## The exact missing authority transition / projection failure

**MISSING AUTHORITY TRANSITION (the defect):**

> When the BCB HOLDS the C10, the host MUST publish a TRUTHFUL NON-RUNNING phase.
> Today it publishes NOTHING: `sdk-session-event-coordinator.ts:3781-3787` registers
> the deferred marker and returns, leaving the phase at its last ACTIVE value
> (`streaming`). With the runtime already terminated, no later event can repair it.

**UNGUARDED WRITER (the proximate cause of the surviving seq):**

> `sdk-session-event-coordinator.ts:3279` — the `pending_prompt_submitted` branch
> writes `streaming` unconditionally. It was the LAST writer in the LIVE run
> (seq 132499) and it re-asserts `streaming` even over an already-terminal phase
> (proved by R3-01).

**NOT a projection failure.** The Elm TaskHeader selector and the webview button
selector faithfully render the host state (R2-01..R2-04).

## The proposed bounded repair ACT

**ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01** (successor).

### Boundary 1 — the hold path publishes a truthful non-running phase

At the BCB hold site (`sdk-session-event-coordinator.ts:3781-3787`), when the C10 is
HELD, publish the EXISTING `resumable` phase — the established "the run was abandoned
before it produced a terminal response" affordance already used by the containment-failure
hold (`session-event-turn-complete-containment-failed-resumable`,
`sdk-session-event-coordinator.ts:1259`) and by the cancel path
(`SdkController.ts:4297`).

- NO new phase is introduced.
- NO `completed` is written. The completion stays held; the C10 is still withheld.
- The Elm authority and the BCB HOLD are untouched.
- The deferred marker is still registered and still preserved.

### Boundary 2 — the pending-prompt writer does not re-assert `streaming` over a terminal phase

At `sdk-session-event-coordinator.ts:3279`, do not write `streaming` when the current
authoritative phase is already a TERMINAL phase (`completed` / `error` / `resumable`).
The BCB marker may ALSO suppress it while the runtime is inactive.

- The writer identity is preserved (`session-event-pending-prompt-submitted`) so the
  LIVE provenance shape remains comparable.
- NO automatic `completed` is introduced.
- The `sessions.setRunning(true)` call is left alone (it is the session-lifecycle
  fact, not the phase).

### Preserved invariants (the repair MUST NOT break these)

| Invariant | Where it is preserved |
|-----------|----------------------|
| BCB HOLD | The hold branch still registers the marker and still withholds the C10. |
| Elm authority | `checkElmCompletionAuthority` is NOT touched; the C10 still requires `authorize`. |
| Containment safety | `unresolvedContainmentFailuresForOwner` / `...AtCommitBoundary` are NOT touched. |
| Epoch conservation | The deferred marker identity triple `(sessionId, taskId, epoch)` is NOT changed; the epoch-supersession clears are NOT changed. |
| No premature `completed` | The repair writes `resumable`, never `completed`. |
| No React updater side effects | The repair is host-side only; no webview reducer / React change. |
| No new protocol field | No wire field is added. |
| Writer provenance | A new writerId (if the repair adds one) must be added to the CLOSED `TurnStateWriterId` union in `apps/vscode/src/shared/turn-state-writer-provenance.ts` AND to `turn-state-writer-provenance.equiv01.test.ts`. |

### Negative witness for premature `completed` (required by the brief)

The PTWCR01 suite already carries the negative witness and it must stay GREEN after the
repair:

- R1-02 / R1-05: with the BCB hold present, `completed` is NEVER reached, for ANY Elm
  verdict (`authorize` / `hold` / `failure`), and NO `task_completion_committed` C10
  record is produced.
- R3-04: after the obligation is CONSUMED, the completion proceeds ONLY through the
  Elm/C10 authority (exactly one C10, marker cleared).

### The GREEN assertions the repair ACT must flip

| Test | Current (RED) | Required (GREEN) |
|------|----------------|------------------|
| R1-01 | `currentPhase === "streaming"` | `currentPhase === "resumable"` and NO terminal phase is fabricated as `completed` |
| R3-01 | the pending-prompt writer clobbers `completed` | the writer does NOT re-assert `streaming` over a terminal phase |
| R1-04 | unchanged | unchanged (the no-hold path still commits `completed`) |
| R1-05 | unchanged | unchanged (the negative witness) |
| R3-04 | unchanged | unchanged (the release path) |

## Not-a-liveness-failure escape (explicitly NOT taken)

The brief allows classifying the case as "not yet a liveness failure" if the only
issue is legitimate pending work with a truthful held projection. **That escape does
not apply.** The obligation is legitimate and is captured (§ R1-03), but the LIVE
projection (`legacy/streaming` → `Working` + `Cancel`) is NOT a truthful held
projection — it claims ACTIVE work while the runtime is `aborted` with zero model
streaming and zero pending tools.

## Scope compliance

- No speculative phase change.
- No automatic `completed`.
- No bypass of the BCB, Elm or containment guards.
- No React updater side effects.
- No new protocol field.
- No worktree or stash manipulation.
- No unrelated H03 corrections.
- Existing diagnostics and tests were reused; no new tracing framework was added.

The ONLY repository change in this ACT is the reproduction suite
(`apps/vscode/src/sdk/__tests__/post-terminal-working-cancel-repro01.ptwcr01.test.ts`)
plus this evidence and the board entry.
