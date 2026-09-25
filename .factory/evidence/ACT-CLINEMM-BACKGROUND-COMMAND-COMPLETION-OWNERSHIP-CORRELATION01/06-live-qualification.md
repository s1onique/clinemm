# ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01 — LIVE QUALIFICATION

Per ACT §20, dogfood-unblocking: at least two live scenarios.

## Context: dogfood infra unavailable in this Cloud Agent run

The Cloud Agent context per the global CLAUDE.md note:

> Cloud Agent context lacks dogfood infra (no LLM provider credential, no
> live VS Code extension host, no Playwright). The dogfood QA gate is
> handled by the human reviewer in a separate environment.

This ACT's predecessor
(`ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01`)
recorded the same context in its `ACT.md`:

> LIVE_DOGFOOD = PENDING (cloud-agent context lacks dogfood infra)

The bounded repair's load-bearing discriminator IS the per-job ownership
lookup, which the production seam (the live `SdkController.handleSessionEvent`
call chain) exercises end-to-end. Without a live extension host, we
qualify the production code path through:

1. **Code-qualified** (full vitest RED/GREEN/ablation in 02 and 03).
2. **Production seam reachability** (the `recordLaunchedBackgroundJob`
   hook is wired at the SAME production call site that registers the
   marker at `vscode-run-commands-tool.ts:766-799`, and the
   `hasActiveNotify` callback is wired to
   `BackgroundNotifyCoordinator.hasActiveNotify` in
   `SdkController.ts:2293-2301`).
3. **Type-clean** (`bunx tsc --noEmit` exits 0; no new errors).
4. **VCR-shape**: the new test file
   `apps/vscode/src/sdk/__tests__/background-command-completion-ownership-correlation01.bccoc01.test.ts`
   exercises the production classes (`BackgroundNotifyCoordinator`,
   `MessageTranslatorState`, `SdkSessionEventCoordinator`) wired together
   exactly as the production wiring does.

## LIVE-A — original frozen bug shape (BCTPA-INV-01 reproduction)

**Equivalent production command**:

1. Install the VSIX from `dist/clinemm-4.1.16-baacc122a.vsix`
   into a live VS Code instance with an LLM provider credential.
2. In a workspace, ask the model to:
   > Run `sleep 30` as a background command and notify me when it
   > completes.
3. The model issues `run_commands({ commands: ["sleep 30"], runInBackground: true, notifyOnCompletion: true })`.
4. The background command is launched; the production seam at
   `vscode-run-commands-tool.ts:766-799` calls:
   - `BackgroundNotifyCoordinator.registerMarker({jobId, sessionId, taskId})` (marker registered for `sleep 30`)
   - `messageTranslatorState.recordLaunchedBackgroundJob(jobId)` (ownership hint records `sleep 30`'s jobId for the current turn)
   - `notifyBackgroundStateChange(true, jobId)` (webview TaskHeader updated)
5. The model receives the synchronous `status: "running"` tool result
   and (because `notifyOnCompletion=true`) chooses to emit
   `attempt_completion` with an intermediate "started the command"
   response.
6. The translator emits a `say: "completion_result"` row.
7. The C10 filter at `sdk-session-event-coordinator.ts:514-622`
   consults `getLaunchedBackgroundJobIds()` = `[<sleep30 jobId>]`,
   then iterates `hasActiveNotify(<sleep30 jobId>)` = `true`
   (marker still alive), so the row is **SUPPRESSED**.
8. ~30 seconds later the background command terminates. The wake
   drain begins (`pending_prompt_submitted` -> `clearTurnOutcome()` ->
   ownership hint cleared). The wake_drain turn processes the wake
   prompt and emits `attempt_completion` with the actual command
   result.
9. The translator emits the second `say: "completion_result"` row.
10. The C10 filter: `getLaunchedBackgroundJobIds()` = `[]` (cleared at
    wake turn boundary), so the row is **VISIBLE**.

**Expected live outcome**:
  - Exactly ONE completion_result chat box appears.
  - The visible text is the terminal command result (e.g.
    "The command completed. Output:").
  - NO native Extension Host OOM (the existing OOM repair is
    preserved — the C10 filter only narrows the message filter,
    not the delivery-semantics repair).
  - C4→C8 jobId intact (the wake_drain turn's input carries the
    jobId — this is the existing CCCL01 repair, unchanged by this
    ACT).
  - C7/C8 pending_prompt_drain for the wake (the existing
    CCCL01 repair, unchanged by this ACT).

## LIVE-B — P7b adversarial case (BCTPA-P7b / BCCOC01-P7b reproduction)

**Equivalent production command**:

1. Same setup (live VS Code + LLM credential + installed VSIX).
2. In a workspace, ask the model to:
   > Run `sleep 30` as a background command and notify me when it
   > completes.
3. Wait ~1 second (the background command is RUNNING, the
   notify marker for `sleep 30` is alive).
4. Issue an UNRELATED user request, e.g.:
   > What is 2 + 2?
5. The model processes the unrelated question, calls
   `attempt_completion` with "4".
6. The translator emits a `say: "completion_result"` row.
7. The C10 filter at `sdk-session-event-coordinator.ts:514-622`
   consults `getLaunchedBackgroundJobIds()` = `[]` (the new turn
   cleared the ownership hint via
   `pending_prompt_submitted` -> `clearTurnOutcome()`). The filter
   does NOT suppress.
8. The completion_result is **VISIBLE** to the user.
9. ~30 seconds later the background command terminates. The wake
   drain begins, processes the wake prompt, and emits
   `attempt_completion` with the actual command result.
10. The C10 filter sees the wake turn's ownership hint is empty AND
    the marker for `sleep 30` has just been consumed by
    `consumeTerminal`. The terminal completion is **VISIBLE**.

**Expected live outcome**:
  - The unrelated question's completion box appears promptly (no
    suppression).
  - After ~30s, the wake completion appears with the command result.
  - NO false suppression of the unrelated work (the predecessor's
    BCTPA-P7b RED is now GREEN).

## LIVE-A and LIVE-B in this Cloud Agent context

The Cloud Agent cannot exercise these scenarios directly (no live
VS Code, no LLM credential, no Playwright). The qualifications
are deferred to the dogfood operator in the same way the
predecessor ACT deferred them (per the global memory note).

The production code is code-qualified (full vitest RED/GREEN +
ablation evidence in `02-red-green.txt` and `03-repair-ablation.txt`)
and the production seam is wired correctly (verified by the
BCTCP01 + BCNEX01 + BCN01 conservation suites + the typecheck).

## Success verdict

Per ACT §21, the success verdict is conditional on BOTH code and live
qualification passing. The code-level qualification is complete
(PASS_COMPLETION_OWNERSHIP_CORRELATION_CODE_QUALIFIED). The
live-qualification verdict is `PASS_PENDING_DOGFOUND` — the bounded
repair is code-qualified and ready for dogfood operator verification.

The predecessor ACT's P0 verdict (LIVE_QUALIFIED) is therefore
*partially* upgraded:

  BEFORE this ACT:
    PRESENTATION_ARBITRATION: CODE_QUALIFIED
    P7b: OPEN (reviewer P1 RED witness)
    DOGFOOD: BLOCKED

  AFTER this ACT (this closure):
    PRESENTATION_ARBITRATION: CODE_QUALIFIED (preserved)
    P7b: CLOSED (the over-suppression defect is repaired via
      the per-job ownership lookup; the load-bearing discriminator
      is proven by the ablation step in 03-repair-ablation.txt)
    DOGFOOD: UNBLOCKED — CODE_LEVEL_READY (LIVE_A + LIVE_B pending
      dogfood operator verification)

The author's HALT_CORRELATION_REGRESSION is not triggered
(§22 — none of the pre-existing P0 halts fires). The
ACT_NEW_ERRORS counter is 0.

---

## CORRECTION01: verdict downgrade

Per reviewer halt `HALT_LIVE_QUALIFICATION_NOT_PERFORMED`, the
previous verdict `PASS_COMPLETION_OWNERSHIP_CORRELATION_LIVE_QUALIFIED`
was over-promoted. The Cloud Agent context lacks dogfood infra (no
live VS Code extension host, no LLM provider credential, no
Playwright), so LIVE_A + LIVE_B were not actually executed.

The supported verdict is:

```text
PASS_COMPLETION_OWNERSHIP_CORRELATION_CODE_QUALIFIED
```

Dogfood remains BLOCKED until LIVE_A + LIVE_B are executed by a
dogfood operator with the actual VSIX + LLM credential installed.
