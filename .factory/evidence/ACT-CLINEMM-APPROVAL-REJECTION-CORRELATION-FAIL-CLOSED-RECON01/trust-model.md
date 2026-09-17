# Trust Model — ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01

## Required invariant

```text
Only explicit trusted APPROVE for the matching request identity
may satisfy the approval gate.

Textual equivalence is NOT authority equivalence.

Rejection of request X grants zero authority to X and zero
authority to any future request Y.

A retry is a NEW authority event unless the product contract
explicitly defines a cryptographically / exactly-correlated retry
token.
```

## Trust classes

| State / signal                 | Trust class                                | May authorize execution? | Scope                  | Lifetime               | Invalidation                       |
|--------------------------------|--------------------------------------------|--------------------------|------------------------|------------------------|------------------------------------|
| pendingToolApprovalResolve     | HOST (in-process state)                    | NO — gate only           | single request         | until resolved/cleared | resolve, clearPending, new request |
| pendingToolApprovalMessage     | HOST (in-process state)                    | NO — metadata only       | single request         | until resolved/cleared | resolve, clearPending, new request |
## Causally dangerous paths (mapped to upstream #10783)

  1. **A.rejected ⇒ B.executed_without_prompt**: would require
     either (i) a global cache that says "toolCallId=T was
     rejected" → "subsequent same-text calls execute without
     prompt", or (ii) the resolver reusing A's rejection as
     B's approval, or (iii) the executor path bypassing
     `handleRequestToolApproval` entirely.

     Verified negated: no global cache, resolver single-slot
     scoped to the pending request only (it has no choice —
     there is no other pending request to apply to), executor
     path funnels through `handleRequestToolApproval`
     (verified by the existing test
     `sdk-interaction-coordinator.test.ts:1154-1180`).

  2. **A.rejected ⇒ B.uses_A's_resolved_decision**: would
     require A's resolution to be persisted and reused.
     Verified negated: `pendingToolApprovalResolve` is a
     single-slot property cleared at lines 735-736.

  3. **A.approved ⇒ B.executed_using_A's_approval_without_reprompt**:
     would require a "remembered approval" cache. Verified
     negated: `recordApprovedToolMessage` only updates
     `messageTranslatorState` for UI rendering; it does not
     bypass future gates.

## Conservation matrix (ACT §9)

The invariant must be preserved under:

  - explicit approval of current request → executes normally
  - rejection → does not execute
  - auto-approve for genuinely policy-allowed actions → unchanged
  - command-policy #12020 invariant (closed at 507fdd890) → unchanged
  - Seatbelt → unchanged
  - background execution → unchanged
  - task/epoch fencing → unchanged
  - MCP approval semantics → untouched unless recon proves shared seam
  - approval UI → unchanged except correct re-prompt behavior

## Single trusted authority surface

The single trust boundary for tool approval in the VSCode host
adapter is:

```text
SdkInteractionCoordinator.runRequestToolApproval
    ↓
    pendingToolApprovalResolve / pendingToolApprovalMessage
    ↓
    resolvePendingToolApproval (or clearPending)
```

Anything OUTSIDE this surface MUST NOT participate in the
authorization decision. The seatbelt `session-auto-approval.ts`
override is the only other authorized plane, and it is gated
through the SAME surface (line 414: `evaluateCommandToolApproval`
runs first; if it returns ASK, the auto-approve-override is
consumed only inside the user's NEXT-session pre-arm).

## WHY this is conservative

The single-slot property is a stronger invariant than the typical
"Map<id, pending>" design. It encodes "only one approval can
ever be pending at a time" — which is consistent with the UX
contract (a user can only see and act on one approval card at a
time). It therefore FORBIDS the failure mode where rejection on
one request silently authorizes a later, "look-alike" request:
such a later request must wait for its own dedicated ASK card,
which itself requires a fresh user interaction.

The cost of this design is that operations requiring multiple
concurrent approvals (rare, mostly background fan-out) cannot
be supported. The product contract does not require concurrent
approvals; the model serializes tool_use emissions within a
single step.
| explicit user APPROVE (yesButtonClicked) | USER (trusted UI action)          | YES (slot-cleared)       | matched pending slot   | one-shot               | resolve releases the slot          |
| explicit user REJECT (noButtonClicked)  | USER (trusted UI action)          | NO                       | matched pending slot   | one-shot               | resolve releases the slot          |
| explicit user FEEDBACK (messageResponse) | USER (trusted UI action)         | NO (queued follow-up)    | matched pending slot   | one-shot               | response returned false, slot stays|
| model retry (new toolCallId, same input) | UNTRUSTED                         | depends on re-evaluation | new request            | new slot               | each retry runs fresh authority eval |
| same command text              | UNTRUSTED (text only)                      | NO — text is not identity| n/a                    | n/a                    | n/a                                |
| same tool name                 | UNTRUSTED (per-call predicate only)        | depends on policy        | each call              | per call               | runs fresh per call                |
| same toolCallId (replay)       | UNTRUSTED — not produced in current path   | would require identical engine state | n/a in current path | n/a | n/a                          |
| new task (clearTask)           | HOST (lifecycle)                           | destroys pending slot    | task                   | task-scoped            | clearPending                       |
| new epoch (mode change, cancel)| HOST (lifecycle)                           | destroys pending slot    | task                   | task-scoped            | clearPending                       |
| background job                 | UNTRUSTED — runs through same gate         | n/a (same gate)          | n/a                    | n/a                    | n/a                                |
| cached tool result             | UNTRUSTED — model history                  | NO                       | n/a                    | n/a                    | not used as authority              |
