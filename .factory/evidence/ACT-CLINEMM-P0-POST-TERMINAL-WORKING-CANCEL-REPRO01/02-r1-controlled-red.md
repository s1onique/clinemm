# R1 — Controlled production-seam RED

**Verdict: the RED REPRODUCES.**

## The harness

`apps/vscode/src/sdk/__tests__/post-terminal-working-cancel-repro01.ptwcr01.test.ts`

The REAL `SdkSessionEventCoordinator` and the REAL `TurnStateTracker` are driven. Only
the OUTER world is stubbed — the session lifecycle, the Elm authority verdict (the
established `getElmCompletionAuthorityDecision` injection seam), the BCB obligations
(`getUnconsumedOwnedTerminalResultCount` / `getUnconsumedOwnedTerminalJobIds`), and the
capability projection (`liveTools`). Those are exactly the inputs the coordinator is
DESIGNED to consult. **No production seam is re-implemented.**

The LIVE facts are used verbatim:

- the four held jobIds from the LIVE `bcb-observation-unavailable-capture.jsonl`
  (`cmd_mvo9fosf9tyu4xb3`, `cmd_mvo9fosftrej06ye`, `cmd_mvo9fosfbixo2qfc`,
  `cmd_mvo9hvbop47y3i42`);
- the LIVE capability probe (`liveTools` includes `command_status`, so
  `canObserveHeldResults === true` and the BCB took the ENQUEUE branch, NOT the
  `observation_unavailable` blocked branch — consistent with the LIVE capture's
  `writerId: "session-event-bcb-eligible-no-bcb-writer"`);
- the LIVE `done(reason:"aborted")` event shape
  (`LocalRuntimeHost.completeAbortedInteractiveTurn`,
  `sdk/packages/core/src/runtime/host/local-runtime-host.ts:2351`);
- the LIVE `pending_prompt_submitted` event shape (`PendingPromptService`,
  `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:658`).

## The reproduced sequence (R1 §4 of the brief)

1. A task is streaming — `tracker.setWithWriter("streaming", …, "task-start-init-task")`.
2. Autonomous work causes a valid Q5 deferral — the BCB obligation (4 unconsumed
   terminal results / 4 held jobIds) is set.
3. The Q5 path reaches `awaiting_followup` — the LIVE provenance shows
   `session-event-turn-complete-resumable-straggler-preserve` writing
   `awaiting_followup` at seq 132079.
4. A pending-prompt continuation re-enters `streaming` —
   `session-event-pending-prompt-submitted` writes `streaming` at seq 132080.
5. Completion is attempted — the C9 capture fires (`submit_and_exit_seen`).
6. BCB holds its terminal obligations — `deferredCompletionBarrier` registered; the hold
   path writes NO phase.
7. The run terminates — `done(reason:"aborted")`.
8. Capture: runtime status, BCB marker, tracker phase, presentation.

## Independent observation of the remaining BCB obligations

**REQUIRED BY THE BRIEF — SATISFIED.** R1-03 observes the obligation INDEPENDENTLY of
the phase assertion:

```ts
const marker = h.deferredMarker()               // the deferred-completion-barrier marker
expect(marker).toBeDefined()
expect(marker?.sessionId).toBe(h.activeSessionId)
expect(heldJobIdsOf(h)).toEqual([...LIVE_HELD_JOB_IDS])   // the FOUR named jobIds
```

The obligation is REAL and NAMED, not a zero-count artifact.

## The RED assertion (R1-01)

```ts
expect(h.tracker.currentPhase).toBe("streaming")   // an ACTIVE phase
const terminalPhases = h.phaseWrites.filter((w) =>
    ["completed", "error", "resumable", "awaiting_followup"].includes(w.phase))
expect(terminalPhases).toEqual([])                  // NO terminal phase, ever
expect(h.phaseWrites.at(-1)?.writerId)
    .toBe("session-event-pending-prompt-submitted") // the LIVE last writer
```

### The RED criterion from the brief

> "The RED criterion is a state/presentation conservation violation: an inactive
> runtime is indefinitely presented as actively Working/Cancel without a valid
> active-work authority or a truthful held/recovery projection."

**SATISFIED — and it is NOT the "legitimate pending work" escape.**

The brief allows this escape: *"If the only issue is legitimate pending work, capture
the exact obligation and classify the case as not yet a liveness failure."*

That escape does **NOT** apply here, for two independent reasons:

1. **There is no valid active-work authority.** The runtime is `aborted`
   (LIVE: `runtimeStatus: "aborted"`, `runtimeModelStreaming: false`,
   `runtimePendingToolCount: 0`) and the shadow agrees
   (`shadowStatus: "aborted"`, `shadowRecoveryState: "recovering"`,
   `shadowModelStreaming: false`, `shadowPendingToolCount: 0`). The host claims
   ACTIVE work; the runtime says there is none.
2. **The projection is not a truthful HELD projection.** The brief's legitimate case
   requires a "truthful held/recovery projection". The LIVE projection is
   `legacy/streaming` → `Working` + `Cancel` — an ACTIVE claim. A truthful held
   projection would be `resumable` (the established "the run was abandoned" affordance)
   or `error`.

**The exact obligation is captured** (the four jobIds, above) — and it is an
OBSERVATION obligation, not a liveness obligation. The agent can consume it via
`command_status` (the LIVE capability probe proves `command_status` IS available).

## The negative witness for premature `completed` (brief §4)

**REQUIRED — SATISFIED.** R1-02 and R1-05:

- R1-02: `c10Records()` is EMPTY and `completionCommitCount() === 0` and
  `currentPhase !== "completed"`.
- R1-05: for EVERY Elm verdict (`authorize`, `hold`, `failure`) while the BCB holds,
  `completionCommitCount() === 0`, `c10Records()` is EMPTY, and
  `currentPhase !== "completed"`.

**The suite therefore does NOT assert that C10 must commit while an obligation
remains** — it asserts the opposite: that C10 MUST NOT commit, and that the phase
must not be `completed`.

## Why `completed` is NOT the right answer

The LIVE capture has two C9 attempts and ZERO C10 commits, and the Elm authority
counters show `authorize: 0` / `hold: 5` / `failure: 4`. The Elm kernel never
authorized. The task was NOT complete — the completion was legitimately withheld. The
correct terminal projection is a NON-RUNNING one (`resumable`), never `completed`.

## R2 — Causal discriminators

| Case | Required distinction | Result | Evidence |
|------|----------------------|--------|----------|
| Valid BCB HOLD, active continuation | Do not falsely report completed | **PROVEN** | R1-05: no `completed` under any Elm verdict while the hold is present. |
| Held observations consumed, no remaining obligations | Completion may proceed only through proper Elm/C10 authority | **PROVEN** | R3-04: after the obligation is consumed, `reevaluateDeferredCompletionBarrier` commits exactly one C10 and the phase becomes `completed`; the marker is cleared. |
| Terminal runtime, Elm HOLD | No C10; truthful non-running or held presentation | **PARTIALLY PROVEN** | No C10: PROVEN (R1-05). Truthful non-running presentation: **NOT PROVEN — this is the defect.** The phase stays `streaming`. |
| Terminal runtime, Elm AUTHORIZE | Correct final phase when all guards pass | **PROVEN** | R1-04: with the obligation removed, the C10 commits and the phase is `completed`. |
| Continuation delivered but not enqueued | Do not claim consumption | **PROVEN (live)** | The LIVE delivery counter reports `pendingPromptEnqueuedObserved: null` — the suite does NOT claim consumption from it. The LIVE `continuation-cardinality-authority.jsonl` independently records `pending_prompt_enqueued` (seq 2139) + `pending_prompt_dequeued` (seq 2141), so the prompt WAS enqueued and drained. |
| Continued turn eventually completes | Phase and buttons converge | **PROVEN** | R3-04 (phase converges to `completed`) + R2-03 (buttons converge to the truthful affordance, NOT `Cancel`). |
| Stale epoch/session notification | Cannot alter the current task | **PROVEN** | R3-05: a `notifyAgentTurnDone` for another session and a `pending_prompt_submitted` for another session leave the tracker snapshot byte-identical. |

### The projection seams are NOT the defect (R2-01..R2-04)

| Assertion | LIVE fact | Reproduced |
|-----------|-----------|------------|
| R2-01: Elm selector returns `legacy/streaming` for (shadow=`completed`, legacy=`streaming`, stamp=missing) | `selectedPhase: "streaming"`, `selectedSource: "legacy"` | **YES — byte-identical** |
| R2-02: the webview button selector returns `Cancel` for `streaming` | `secondaryText: "Cancel"`, `secondaryAction: "cancel"` | **YES — byte-identical** |
| R2-03: ABLATION — a terminal host phase (`resumable`) yields `host/resumable` and NOT `Cancel` | (n/a — the LIVE had no terminal host phase) | **YES — proves the projection is correct given a correct host phase** |
| R2-04: ABLATION — a BOUND shadow stamp yields `shadow/completed` | (n/a — the LIVE binding was UNBOUND) | **YES — proves the LIVE `legacy/streaming` outcome was NOT caused by a broken selector** |

**Conclusion:** the projection seams faithfully render the host state. The defect is
UPSTREAM of them.

### `aborted` vs explicit user cancellation (brief §5, last paragraph)

R1-06 proves the discriminator exists in the runtime event but NOT in the coordinator:

- `done(reason:"error")` → the coordinator writes `error` (via `wasErrorSeen()`).
- `done(reason:"aborted")` → the coordinator writes NOTHING on the BCB-hold path.

And the LIVE provenance contains NO `controller-cancel-task` writer for task
`1792958891945_k2wrd` — so this was FRAMEWORK termination, not a user cancellation.
A user cancellation would have written `resumable` FIRST
(`SdkController.cancelTask()` → `SdkController.ts:4297`).
