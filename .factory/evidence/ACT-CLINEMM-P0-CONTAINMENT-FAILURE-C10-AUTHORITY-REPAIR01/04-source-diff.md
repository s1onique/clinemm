# 04 — THE SOURCE DIFF (the repair)

Single production file changed:
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (+284 / -22).

## R2 — the ONE shared classifier

A new private, PURE method:

```typescript
private unresolvedContainmentFailuresForOwner(
    jobStates: Record<string, string> | undefined,
    jobOwners: Record<string, string | undefined> | undefined,
    activeSessionId: string,
): string[]
```

It is the SINGLE computation of the containment fact. It mutates nothing
and produces no diagnostic side effect. Its semantics are Q5's semantics
verbatim (see `02-conservation-matrix.md` for the full table).

The Q5 path's INLINE copy was DELETED and replaced with a call to it, so
the predicate is no longer triplicated. The absence of the state map
(`jobStates === undefined`) returns `[]` (no entry to classify); the absence
of the OWNER map (`jobOwners === undefined`) while a `containment_failed`
entry EXISTS retains the entry (fail closed). The two are distinct.

## R3 — Site A (the immediate C10 barrier)

The barrier block in `handleSessionEvent` gained a fifth conjunct:

```typescript
const unresolvedContainmentFailuresForC10 = this.unresolvedContainmentFailuresForOwner(
    this.options.getBackgroundCommandJobStates?.(),
    this.options.getBackgroundCommandJobOwners?.(),
    activeSession.sessionId,
)

if (
    outstandingAutonomousWork ||
    ownerStillRunningForC10 ||
    heldObligationForC10 ||
    suppressOriginatingCompletion ||
    unresolvedContainmentFailuresForC10.length > 0
) {
```

The hold routes into the EXISTING BCB HOLD branch, so it inherits the
existing behaviour exactly:

- the `DeferredCompletionBarrier` marker is registered with the existing
  `(sessionId, taskId, epoch)` triple;
- the existing BCB marker identity and `reason` preservation are UNCHANGED;
- the existing `suppressOriginatingCompletion` suppression behaviour is
  UNCHANGED (the new conjunct is checked AFTER it in the log ternary, so
  the BNCA message still wins when both hold);
- NO `setTurnPhase("completed", …)`;
- NO `task_completion_committed` capture;
- NO `promoteCompletionAuthorityMarker()`.

Only the diagnostic message gained a branch for the new conjunct.

## R3 — Site B (the deferred C10 re-evaluation)

`reevaluateDeferredCompletionBarrier()` gained a hold BEFORE the marker is
cleared and BEFORE the Elm consult:

```typescript
const unresolvedContainmentFailuresForDeferredC10 = this.unresolvedContainmentFailuresForOwner(...)
if (unresolvedContainmentFailuresForDeferredC10.length > 0) {
    Logger.warn(...)
    return
}
```

The deferred marker is **PRESERVED** (not cleared), exactly like the
existing `heldObligation` / `outstandingAutonomousWork` holds, so a later
re-evaluation can release the completion if the containment failure is ever
resolved. The existing session / task / epoch identity checks are UNCHANGED
and still run first.

## R3 — Site C (the Q5 deferred-handoff path)


## R4 — the asynchronous admission boundary

`checkElmCompletionAuthority()` awaits `flushElmAuthorityForSession`
before it reads the Elm decision. That await is a real time-of-check /
time-of-use interval between the barrier's containment read and the final
phase write. A new private helper re-reads the SAME classifier at the
ACTUAL commit boundary:

```typescript
private unresolvedContainmentFailuresAtCommitBoundary(sessionId: string): string[] {
    return this.unresolvedContainmentFailuresForOwner(
        this.options.getBackgroundCommandJobStates?.(),
        this.options.getBackgroundCommandJobOwners?.(),
        sessionId,
    )
}
```

It is applied on BOTH commit boundaries — the immediate path (after the Elm
AUTHORIZE, before `setTurnPhase("completed", …)`) and the deferred path
(after the Elm AUTHORIZE, before the marker clear + phase write). On a hit
the deferred marker is re-registered (identical to the Elm-HOLD branch), so
the completion can be released later.

**No repeated provider calls.** The helper performs NO second Elm consult
and NO second BCB read — it re-reads only the already-wired per-job
projection maps, which the host mutates synchronously when a job
terminalizes. The M4-C witness pins `elmDecisionCount() === 1`.

The existing session / task / epoch identity checks are PRESERVED and are
NOT replaced by this revalidation — the revalidation only ADDS the
containment fact to the set of facts that must hold at the commit boundary.

## The R4 finding — WAS the interval exploitable?

**YES, and it is now closed.** The M4-A witness drives the exact sequence
the ACT specified:

1. initially no containment failure exists;
2. the C10 barrier passes;
3. the asynchronous Elm flush is HELD by an injected promise;
4. a containment failure is published for the SAME owner;
5. the flush is resolved with Elm AUTHORIZE;
6. **BEFORE the repair:** the `completed` phase commits — the late failure
   is ignored because the earlier read was clean.

**AFTER the repair:** the commit is refused and the deferred marker is
registered.

The Elm gate and the lifecycle scheduler were NOT redesigned. The Elm
decision still owns the commit; the containment fact is simply re-read at
the moment the effect is about to be applied.

## What was NOT changed (scope compliance)

| Restriction | Compliance |
|---|---|
| No Elm kernel changes | Only the TS host was touched. `apps/vscode/elm/**` is untouched. |
| No React/webview reducer changes | `webview-ui/**` is untouched. |
| No new public API or protocol fields | The new methods are `private`. No proto change. |
| No changes to compact terminal receipts | The receipt channel is untouched. |
| No changes to background-job termination machinery | `command-job-manager.ts` is untouched. |
| No new continuation-control design | The existing BCB marker shape and continuation path are reused. |
| No new generalized lifecycle instrumentation | No new capture module, no new counter. |
| No descendant-safety claims beyond the owned-primary-PGID contract | No such claim is made. |
| No worktrees or unrelated Git changes | Only the files listed in the artifact manifest changed. |

The duplicated inline computation was replaced with the shared helper call.
The observable behaviour is UNCHANGED:

- the same `Logger.warn` message text (`unresolved containment failure
  (jobs=…)`);
- the same writer identity
  (`session-event-turn-complete-containment-failed-resumable`);
- the same recovery phase (`resumable`);
- the same `deferredContinuation = undefined` clearing;
- foreign-owner failures remain EXCLUDED.

Verified by `premature-handoff-containment-failure01.phcf01.test.ts`
(10/10 PASS) and by the M5-C source-identity assertion.
