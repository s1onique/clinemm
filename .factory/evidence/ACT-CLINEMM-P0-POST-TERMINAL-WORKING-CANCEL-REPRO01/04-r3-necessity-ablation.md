# R3 — Necessity / ablation

**Method: one condition varied at a time.** Existing diagnostic controls only; no new
tracing framework was added.

## The ablation matrix (brief §6)

| Condition | Varying it | Outcome | Test |
|-----------|-----------|---------|------|
| **BCB obligation remains** | hold present | The stale `streaming` phase SURVIVES. No terminal phase is ever produced. The deferred marker is registered and PRESERVED. | R3-02, R3-03 |
| **BCB obligation removed** | hold absent | The terminal event DOES produce a terminal projection (`completed` via the Elm authority → C10). The stale phase does not survive *as a hold artifact* — but the unguarded pending-prompt writer STILL clobbers the terminal phase afterwards. | R3-01, R1-04 |
| **Deferred marker missing** | marker absent | Not the LIVE condition: the LIVE marker EXISTS (R1-03). Ablated via R1-04 (no hold → no marker → the C10 path commits directly). The marker is therefore NOT the cause of the surviving phase. | R1-04 |
| **Deferred marker exists but reevaluation does not run** | reevaluation suppressed | R3-03 runs the REAL `reevaluateDeferredCompletionBarrier()` and the phase is STILL `streaming`. The reevaluation is correctly conservative AND writes no phase on the hold path — so suppressing it would not change the outcome. **Not the cause.** | R3-03 |
| **Phase changes but host projection remains stale** | projection not refreshed | R2-01/R2-03/R2-04: the projection is a pure function of the host facts and is CORRECT for both terminal and active host phases. **Not the cause.** | R2-01, R2-03, R2-04 |
| **Host projection changes but webview rejects it** | webview seq fence | The LIVE capture shows the extension push and the webview commit MATCH at state version 132749 (`appliedLegacyPhase: "streaming"`, `appliedLegacySeq: 132499`). The webview ACCEPTED the push. **Not the cause.** | LIVE `post-terminal-authority-diagnostic-webview.jsonl` |
| **Selector chooses legacy despite a valid authoritative shadow binding** | binding shape | The LIVE binding is `UNBOUND` — the standing classification for every shadow publication (`activity-publication-v1.ts:148`). R2-04 proves a BOUND stamp yields `shadow/completed`. The `legacy` choice is CORRECT for an UNBOUND shadow against an ACTIVE legacy phase (`Orchestration.elm` `unbound_demote` guard). **Not the cause — and the fix must NOT try to force the shadow to win.** | R2-01, R2-04 |

## The TWO load-bearing conditions

### Condition 1 (load-bearing): the BCB hold path writes NO terminal phase

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3781-3787` — the hold branch
registers `deferredCompletionBarrier` and RETURNS. No `setTurnPhase` call.

R3-02 proves it: with the hold present, the phase-write log contains NO member of
`{completed, error, resumable, awaiting_followup}`.

Because the runtime is DEAD (`done(reason:"aborted")` already fired), **no later event
can ever supply the missing terminal phase**. The LIVE provenance confirms this: the
final `agent_turn_done` (seq 2147, 1792961475479) produced no phase write either.

### Condition 2 (load-bearing): `pending_prompt_submitted` writes `streaming` unconditionally

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3279` — the writer consults
nothing: not the runtime liveness, not the BCB marker, not the deferred continuation.

R3-01 proves it: with the hold REMOVED and the phase correctly `completed` (C10
committed), the subsequent `pending_prompt_submitted` event STILL clobbers the phase
back to `streaming`. The last writer in the LIVE run was this writer.

### Interaction (why the LIVE symptom is stable)

Condition 2 alone would be transient — a later `done` would repair it. But Condition 1
removes the terminal phase, AND the runtime is dead so no repair can arrive. The two
conditions compose into a PERMANENT false-`Working`.

The repair must therefore address BOTH:
- the hold path must publish a TRUTHFUL NON-RUNNING phase (not `completed` — the
  completion is still legitimately held); and
- the `pending_prompt_submitted` writer must not re-assert `streaming` over a
  terminal host phase.

## Necessary NON-causes (proved, so the repair ACT does not chase them)

- **Not the Elm authority.** The LIVE counters (`authorize: 0`, `hold: 5`,
  `failure: 4`) and R1-05 prove the Elm gate is doing its job.
- **Not the projection seams.** R2-01..R2-04.
- **Not the webview reducer.** The LIVE push/commit match at state version 132749.
- **Not a stale epoch/session notification.** R3-05.
- **Not the BCB HOLD itself.** The hold is CORRECT — the obligation is real and named.
  The defect is the ABSENCE of a truthful projection alongside the hold, not the hold.
