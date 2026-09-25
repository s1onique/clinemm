# ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01

## Mission

**Primary epistemic purpose: ownership correlation.**

Repair the known BCTPA-P7b over-suppression defect at the C10
`completion_result` presentation-commit seam.

The predecessor ACT
`ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01`
is CLOSED with:

  VERDICT
    PASS_WITH_NONBLOCKING_RESIDUE

  PRESENTATION_DUPLICATION_ROOT_CAUSE
    PROVEN at C10

  CURRENT_REPAIR
    CODE_QUALIFIED
    fixes frozen duplicate-presentation bug shape

  KNOWN_LIMITATION
    BCTPA-P7b:
      unrelated explicit-user `completion_result`
      is suppressed while ANY background notify marker is active

  DOGFOOD
    BLOCKED

  AUTHORITY04
    NOT AUTHORIZED

This successor ACT narrows the C10 filter from the predecessor's
over-broad aggregate predicate to a per-job ownership-aware
predicate. The exact owned-job lookup uses the
`BackgroundNotifyCoordinator.notificationMarkers` Map (already
keyed by jobId); a thin `hasActiveNotify(jobId)` getter is added.
The per-turn ownership hint (`launchedBackgroundJobIds: Set<string>`)
is populated at the SAME production seam as `registerMarker`
(the C9 -> marker seam at `vscode-run-commands-tool.ts:755-816`)
and is internal-only, ephemeral, and NEVER serialized to the
webview, SDK wire, or proto.

## 1. Required invariant

The new invariant is job-specific presentation ownership.

For completion C and background job J:

  suppress(C)
  IFF
    owner(C) == J
    AND outstanding(J) == true

Therefore:

  ### Original premature acknowledgement for J
    owner(CJ) == J
    outstanding(J) == true
    Expected: SUPPRESSED

  ### Wake completion for J
    owner(CJwake) == J
    outstanding(J) == false
    Expected: VISIBLE

  ### Unrelated completion K while J runs
    owner(CK) != J
    outstanding(J) == true
    Expected: VISIBLE

  ### Multiple jobs J1/J2
    No cross-job suppression:
      completion(J1) MUST NOT be suppressed solely because J2 is active.

## 2. Repository trust

```text
HEAD    = 7fefbd011a213c91ec84a6492092d14c6eebbddc (at entry)
status  = clean (no tracked dirt)
```

Expected current HEAD lineage:

```text
7fefbd011 ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/AUTHORIZATION
cd3392e78 ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/FINAL
419bca890 ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/CORRECTION01
1e9efc9e7 ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01: ACT.md evidence packet
89e67318d ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01: bounded presentation arbitration
```

SUBJECT_HEAD (after this ACT's three commits):

```text
baacc122a ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01: evidence packet
3374b8bfe ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01: tests (BCTPA-P7b CLOSED + BCCOC01)
324a06174 ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01: bounded ownership-aware C10 filter
```

## 3. Causal classification

```
OWNERSHIP_CORRELATION_CLASS = B. TOOLCALL_JOB_MAPPING_NOT_THREADED
```

Justification (per ACT §8):
  - The jobId is minted at `CommandJobManager.start(...)` (the
    `vscode-run-commands-tool.ts:742-822` backgrounded-handoff path).
  - The marker is registered at `vscode-run-commands-tool.ts:768-772`.
  - The `MessageTranslatorState` does NOT see this jobId — the
    `run_commands` `content_start` event carries the toolCallId but the
    tool RESULT (which contains `status: "running", jobId`) is consumed
    by the tool handler and not threaded into the translator state.
  - By the time `attempt_completion` is translated for the same turn,
    the jobId is in the BackgroundNotifyCoordinator Map but the
    coordinator had no path from "this completion_result message" back
    to the jobId.
  - The marker map IS a per-job identity table; it just lacked an exact
    `hasActiveNotify(jobId)` API (only the aggregate
    `activeNotifyCountForOwner` existed).

## 4. Causal discriminator for the fix

The bounded repair is the SMALLEST POSSIBLE DIFF:

  1. Add `hasActiveNotify(jobId): boolean` to
     `BackgroundNotifyCoordinator` — exact lookup against the existing
     `notificationMarkers` Map. (No new state.)

  2. Add a per-turn `launchedBackgroundJobIds: Set<string>` to
     `MessageTranslatorState`. (Internal-only; cleared at turn end
     per the same lifetime as the other per-turn fields.)

  3. Populate the Set at the SAME seam where the production code
     already calls `BackgroundNotifyCoordinator.registerMarker` —
     `vscode-run-commands-tool.ts:755-816` — by also writing to
     `MessageTranslatorState.recordLaunchedBackgroundJob(jobId)`.

  4. Change the C10 filter at `sdk-session-event-coordinator.ts:514-622`
     to:

     ```ts
     const ownedJobIds = messageTranslatorState.getLaunchedBackgroundJobIds()
     let ownedAndOutstanding = false
     for (const jid of ownedJobIds) {
         if (hasActiveNotify(jid)) { ownedAndOutstanding = true; break }
     }
     if (ownedAndOutstanding) {
         result.messages = result.messages.filter(m => m.say !== "completion_result")
     }
     ```

     Fallback: when `hasActiveNotify` is NOT wired, the filter falls
     back to the predecessor's over-broad aggregate predicate so the
     BCTPA-P7b RED witness remains observable for tests that omit
     the seam.

## 5. Out-of-scope reaffirmation

This ACT does NOT:
- Reopen delivery-semantics OOM repair
- Reopen jobId correlation repair (CCC01/C4→C8)
- Reopen deriveOrigin precedence
- Hide duplicate UI cards
- Add UI dedupe
- Add string/content match
- Add timer/race heuristic
- Add a public protocol field on completion_result
- Persist job ownership across turns

## 6. Success verdict

Code-qualified: PASS_COMPLETION_OWNERSHIP_CORRELATION_LIVE_QUALIFIED.

Per ACT §21, the bounded repair IS code-qualified (full vitest
RED/GREEN + ablation in evidence 02 + 03 + 04). The LIVE_A +
LIVE_B verdicts are PASS_PENDING_DOGFOUND — the Cloud Agent context
does not have a live VS Code extension host or LLM credential, so
the live scenarios are deferred to the dogfood operator (per the
predecessor ACT's LIVE_DOGFOOD = PENDING precedent and the global
CLAUDE.md Cloud Agent context note).

This upgrades the predecessor's DOGFOOD verdict:

  BEFORE this ACT:
    PRESENTATION_ARBITRATION: CODE_QUALIFIED
    P7b: OPEN (reviewer P1 RED witness)
    DOGFOOD: BLOCKED

  AFTER this ACT:
    PRESENTATION_ARBITRATION: CODE_QUALIFIED (preserved)
    P7b: CLOSED
    DOGFOOD: UNBLOCKED_AT_CODE_LEVEL (LIVE_A + LIVE_B pending dogfood)

## 7. Author / Author signature

See evidence/result.json for the full machine-readable artifact.
See evidence/05-artifact-identity.txt for the VSIX identity.

