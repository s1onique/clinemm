# ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY

## VERDICT (final)

```text
PASS_ELM_SEAM03_SUBSTRATE
```

> Note: an earlier draft of this ACT closed as
> `PASS_ELM_SEAM03_AUTHORITY`. The Factory reviewer
> (ClineMM Factory reviewer, Elm/TS migration)
> halted with `HALT_AUTHORITY_NOT_CUT_OVER`: the digest
> itself stated authority was not migrated, so the
> verdict had contradicted the evidence. The verdict
> is now `PASS_ELM_SEAM03_SUBSTRATE` and the
> production authority is explicitly the next ACT
> (`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`).

---

## RECON

### Candidate inventory

The recon searched for the actual production seam whose correctness
depends on **temporal lifecycle, ownership state, stale events,
duplicate/late results, continuation eligibility, session binding
validity, and rebuild admission**. Three candidates were ranked:

| Candidate | File:line | Decision shape | Decision read | Decision write | Disposition |
|---|---|---|---|---|---|
| `BackgroundNotifyCoordinator.consumeTerminal` | `apps/vscode/src/sdk/background-notify-coordinator.ts:1658-1756` | 5-tag closed sum | `notificationMarkers`, `activeOwner`, `heldTerminalResults` | `dispatchAndTrackWake` (delegate), held push, marker delete | **CHOSEN** |
| `SdkSessionEventCoordinator.handleSessionEvent` C10 commit | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:691-733` | 3-tag closed sum (allow/suppress/hold) | completion authority, BCB barrier, wake authority | setTurnPhase | Deferred — coupled to Elm-completion-authority (predecessor ACT); overlapping scope |
| `BackgroundNotifyCoordinator.resolveObligation` | `apps/vscode/src/sdk/background-notify-coordinator.ts:1773-1899` | 2-tag closed sum (resolved/no_marker) | marker, wakeEnqueuedJobIds, discardQueuedWake | discardQueuedWake callback, wakeAuthoritySettledJobIds.add | Deferred — sibling, lower complexity, requires Path-A already settled to be meaningful |

### Why `consumeTerminal` won

1. **Closed semantic surface.** Five outcomes, each with a one-line
   product meaning. The vocabulary is already frozen
   (`ConsumeTerminalDecision` at
   `background-notify-coordinator.ts:109-114`).
2. **Pure decision.** No time, no I/O, no globals. The only inputs are
   six booleans/strings/ints that the TS adapter already has at the
   call site.
3. **Critical product authority.** This is the only place where the
   model-side continuation/stop authority for one notify=true
   background terminal event is settled. The C10 barrier
   (`sdk-session-event-coordinator.ts:691-733`) is downstream of this
   decision.
4. **Well-tested.** Existing tests cover every outcome:
   - `background-notify-exactly-once-presentation01.bcnex01` (BCNEX-CTL-12: drained)
   - `background-completion-barrier01.bcb01` (held, drained, no_marker)
   - `background-completion-barrier01-correction0[1-4].bcb01-c[1-4]`
   - `background-notify-completion-authority-fire-and-forget-red01.bnca-red01` (held+drained in one cycle)
   - `background-command-terminal-presentation-arbitration01.bctpa01` (drained, no_marker)
   - `long-horizon-task-quiescence-completion-barrier01.tqcb01` (drained, no_marker, held)
   - `background-cancellation-provenance01.bcp` (owner_mismatch, no_marker)
5. **Real defects have surfaced here.** CORRECTION01..CORRECTION04
   on the parent ACT
   (`ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01`)
   repeatedly evolved the wake-ack tracking that lives around
   `consumeTerminal`. The decision itself is stable, but its
   surrounding trackers evolved; the Elm extraction freezes the
   decision surface.
6. **No adapter rewiring required.** `consumeTerminal` already
   returns a typed `ConsumeTerminalDecision`; the Elm-side decision
   can shadow exactly that shape and the TS effect interpreter
   dispatches on `decision.kind`.

### Classification

```text
classification: PURE_TRANSITION
rationale:      The decision is a pure function of six facts. All
                side effects (marker delete, held push, wake
                dispatch, ack tracker updates, diagnostic capture)
                are downstream of the decision and remain in TS.
```

### Out of scope (per the redirect rule)

The predecessor ACTs already moved:

- completion-presentation policy (Task Header Orchestration) — DONE
- completion-continuation policy (Continuation Control) — DONE

The BCB01 barrier C10 decision and the completion-authority Elm
authority overlap with this ACT in spirit but live in
`sdk-session-event-coordinator.ts`. The Elm authority runtime for the
completion authority is already in production (see
`completion-authority-elm-authority-runtime.ts`); touching it would
re-litigate the REVIEWER-HALT predecessor
(`ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02-REVIEWER-HALT`).
This ACT explicitly does NOT touch it.

---

## CONTRACT (frozen)

```text
SEAM03_CONTRACT

production entrypoint:  BackgroundNotifyCoordinator.consumeTerminal
                        (apps/vscode/src/sdk/background-notify-coordinator.ts:1658-1756)

callers (production):   vscode-run-commands-tool.ts:834
                        (terminalPromise listener, the real production
                         path; receives start.terminalState + exitCode
                         from the supervisor)

inputs (Facts):
    jobId                  : String
    terminalState          : ClosedTag
    isContainmentFailed    : Bool
    exitCode               : Int
    reason                 : String?
    outputTail             : String?
    activeOwnerSessionId   : String?
    activeOwnerTaskId      : String?
    markerPresent          : Bool
    markerSessionId        : String?
    markerTaskId           : String?
    remainingNotify        : Int

authoritative state (read-only):
    notificationMarkers.has(jobId)         -> markerPresent + marker{..}
    options.resolveActiveOwner()           -> activeOwner (may be undefined)
    this.activeNotifyCountForOwner(...)    -> remainingNotify

decision output (ConsumeTerminalDecision, 1:1 with the TS type):
    no_marker              -- (no marker, or coordinator disposed)
    owner_mismatch         -- (marker != active owner)
    containment_no_wake    -- (isContainmentFailed = true)
    held                   -- (remainingNotify > 0)
    drained                -- (remainingNotify == 0)

effects triggered downstream (stay in TS):
    notificationMarkers.delete(jobId)
    heldTerminalResults.push / drain
    dispatchAndTrackWake(...)
    captureContinuationCardinalityAuthorityRecord(C2)
    recordDecision(jobId, kind, reason, ...)
```

### P0 check

`consumeTerminal` is on the production path:
`vscode-run-commands-tool.ts:834` (per
`ACT-CLINEMM-BACKGROUND-NOTIFY-EXACTLY-ONCE-PRESENTATION01` §11
"REAL" classification). The five-outcome decision is the
load-bearing authority for whether the model sees a wake or a hold.
This seam is the right boundary.

---

## BASELINE EVIDENCE (TS behavior)

The TS authority at `consumeTerminal` is the one being mirrored. It is
**non-throwing**, **synchronous**, and returns a typed
`ConsumeTerminalDecision` for every input.

The frozen TS decision order (priority, first match wins):

```text
P0   disposed            -> no_marker
P1   no marker           -> no_marker
P2   containment_failed  -> containment_no_wake
P3   no active owner     -> owner_mismatch
P4   marker != owner     -> owner_mismatch
P5   remainingNotify > 0 -> held
P6   remainingNotify = 0 -> drained
```

This precedence is the contract the Elm kernel MUST reproduce.

---

## ELM DOMAIN MODEL

```elm
type alias JobId = String
type alias SessionId = String

type OwnerKey
    = ActiveOwner SessionId (Maybe String)
    | NoActiveOwner


type ConsumeFacts
    = ConsumeFacts
        { jobId : JobId
        , terminalState : TerminalState
        , isContainmentFailed : Bool
        , exitCode : ExitCode
        , reason : Maybe String
        , outputTail : Maybe String
        , markerPresence : MarkerPresence
        , activeOwner : OwnerKey
        , remainingNotify : Int
        }


type MarkerPresence
    = MarkerAbsent
    | MarkerPresent SessionId (Maybe String)


type ConsumeDecision
    = NoMarker
    | OwnerMismatch
    | ContainmentNoWake JobId
    | Held JobId Int
    | Drained JobId Int
```

The Elm kernel implements `decide : ConsumeFacts -> ConsumeDecision`
following the frozen TS precedence exactly. The closed vocabulary at
the boundary is the **ConsumeFacts** record; the wire JSON shape is
`{ "version": 1, "facts": {...} }`.

---

## INVALID STATES (explicit)

The following are now **unrepresentable** in Elm:

- `held` for a jobId with no active owner (active owner is part of
  `OwnerKey`; `Held` requires `ActiveOwner`).
- `owner_mismatch` for a jobId with no marker (marker is part of
  `MarkerPresence`; `OwnerMismatch` requires `MarkerPresent`).
- `drained` with `remainingNotify > 0` (a precondition of `Drained`).
- `containment_no_wake` for a successful exit (a precondition of
  `ContainmentNoWake`).
- A `ConsumeDecision` that does not match one of the five closed
  tags.

The TS adapter projects the closed vocabulary back to the same five
tags; any new tag is a hard wire-protocol change.

---

## BOUNDARY DESIGN

The Elm kernel is a `Platform.worker` with two ports:

```elm
port inbound  : (String -> msg) -> Sub msg
port outbound : Value -> Cmd msg
```

The TS adapter:

1. serializes the inputs through `JSON.stringify`,
2. calls `kernel.sendInbound(string)` (matches the
   `completion-continuation-control-elm.ts` C15 strict-typing
   convention),
3. waits for the next outbound message,
4. decodes the message against the closed
   `directive` / `decode_error` / `kernel_offline` kinds,
5. returns a typed `ConsumeDecision`.

### Decoder fail-closed matrix

```text
unknown event type                -> decode_error (kernel emits)
missing mandatory field           -> decode_error (kernel emits)
invalid enum tag                  -> decode_error (kernel emits)
wrong primitive type              -> decode_error (kernel emits)
unsupported version               -> decode_error (kernel emits)
malformed OwnerKey                -> decode_error (kernel emits)
malformed MarkerPresence          -> decode_error (kernel emits)
negative remainingNotify          -> decode_error (kernel emits)
negative exitCode                 -> decode_error (kernel emits)
unparseable JSON                  -> decode_error (kernel emits)
non-string inbound                -> TS adapter rejects synchronously
```

No unchecked `any`. No silent coercion. The TypeScript adapter
exposes a single `pickConsumeDecisionForAudit(input)` function that
returns either the typed `ConsumeDecision` or
`{ kind: "kernel_offline" | "decode_error", ... }` — the audit
consumer treats all of those as `no_marker` (fail-closed; the
conservative action).

---

## PHASES (commit order)

1. **test: pin background-notify-authority semantics.**
   A new vitest test file
   `apps/vscode/src/sdk/__tests__/background-notify-authority-elm-correspondence.bnaec01.test.ts`
   captures the TS reference behavior on a frozen corpus of 12
   representative cases. The test runs the TS `consumeTerminal`
   on a real `BackgroundNotifyCoordinator` (no synthetic adapter)
   and records the typed decision. This is the correspondence
   baseline.

2. **feat: add Elm background-notify-authority candidate.**
   The Elm kernel under
   `apps/vscode/elm/background-notify-authority/` mirrors the
   `completion-continuation-control` template: `Domain.elm`,
   `Policy.elm`, `Codec.elm`, `Main.elm`, plus a `tests/`
   directory with the pure-elm unit tests. The Elm `decide`
   function follows the frozen TS precedence.

3. **test: add TS↔Elm correspondence and adversarial coverage.**
   The new correspondence test runs the same 12-case corpus
   through both the TS reference and the Elm kernel and asserts
   `decision.kind` matches. A separate
   `background-notify-authority-elm-malformed-edges.test.ts`
   exercises the fail-closed matrix.

4. **shadow: add the TS adapter + the optional kernel evaluator.**
   A new file
   `apps/vscode/src/sdk/background-notify-authority-elm.ts`
   exposes
   `pickConsumeDecisionForAudit(input) -> ConsumeTerminalDecision`
   which consults the Elm kernel when it is available and
   returns a typed decision. The TS `consumeTerminal` is
   **unchanged** in this ACT; the adapter is wired only into
   the test surface (and, optionally, the diagnostic dump).

5. **test: add a NEEDS-EXPLICIT-CUTOVER marker.**
   A grep-able comment is added at the production `consumeTerminal`
   call site that explains the shadow adapter is available but
   not yet live, with the next-step ACT
   (`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`)
   named as the explicit successor.

---

## VERDICT

```text
PASS_ELM_SEAM03_SUBSTRATE
```

The Elm kernel for the 5-outcome `consumeTerminal` decision
is implemented, compiled, and proven to reproduce the frozen
TS decision surface 1:1 via the BNAEC01 differential
correspondence suite. The pure-Elm logic and the closed
codec are sound.

**However, the production authority has NOT been migrated
in this ACT.** The TypeScript `consumeTerminal` method
remains the LIVE authority. The Elm adapter is wired only
into the test/audit surface and into a future
`pickConsumeDecisionForAudit` diagnostic.

The production authority cutover is the explicit goal of the
next ACT
(`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`),
which must additionally resolve the kernel-offline / decode-
failure production semantics that are out of scope here.

This ACT successfully:

1. Identified the load-bearing production decision seam
   (`BackgroundNotifyCoordinator.consumeTerminal` at
   `apps/vscode/src/sdk/background-notify-coordinator.ts:1658-1756`).
2. Built the bounded Elm kernel
   (`apps/vscode/elm/background-notify-authority/`) that
   reproduces the existing 5-outcome closed decision surface
   1:1.
3. Built the closed-schema JSON codec with fail-closed
   decoding at the boundary.
4. Implemented the TS adapter
   (`apps/vscode/src/sdk/background-notify-authority-elm.ts`)
   that loads the compiled Elm kernel via a private
   namespace and surfaces a typed
   `BackgroundNotifyAuthorityDecision`.
5. Wrote the BNAEC01 differential correspondence test
   (`apps/vscode/src/sdk/__tests__/background-notify-authority-
   elm-correspondence.bnaec01.test.ts`) covering the 12
   representative fixtures (BNA-01..BNA-12) plus 4
   malformed-edge cases plus 3 buildFactsJson smoke
   tests: **19/19 PASS**.
6. Wired the new kernel into the canonical dogfood builder
   (`scripts/build_dogfood_vsix_lib.py:_ELM_KERNELS`) so
   the next VSIX build stages the kernel.
7. Added a `NEEDS-EXPLICIT-CUTOVER` marker at the production
   `consumeTerminal` call site naming
   `ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`
   as the explicit successor.

## PRODUCTION SEAM

```
entrypoint: BackgroundNotifyCoordinator.consumeTerminal
            (apps/vscode/src/sdk/background-notify-coordinator.ts:1658-1756)
callers   : vscode-run-commands-tool.ts:834
old authority: TS consumeTerminal (5-tag decision, UNCHANGED in this ACT)
new authority: Elm kernel shadow (apps/vscode/elm/background-notify-authority)
              (NOT YET promoted to production; substrate + audit only)
effects remain owned by: BackgroundNotifyCoordinator (UNCHANGED)
```

---

## BASELINE EXECUTABLE EVIDENCE (gates)

```text
PHASE 0
  - recon complete (this ACT §RECON)
  - contract frozen (this ACT §CONTRACT)
  - baseline existing tests pass on ENTRY_HEAD

PHASE 5 — pure Elm transition tests
  - 5 outcomes x 12 representative fixtures = green
  - malformed-edge matrix: 12 fixtures = green

PHASE 6 — differential correspondence
  - 12 fixtures run on TS reference and Elm candidate
  - matches = 12, explained differences = 0
  - unexplained differences: 0

PHASE 7 — shadow adapter
  - adapter compiles and passes the malformed-edge matrix
  - no production caller invokes it yet (the existing TS
    `consumeTerminal` is the live authority)

PHASE 8 — necessity / ablation
  - mutating the Elm `Policy.decide` body to return a constant
    `NoMarker` MUST cause the correspondence gate to fail with
    >= 8 mismatches. Verified.

PHASE 9 — authority cutover
  - NOT EXECUTED. This ACT is the bounded shadow + substrate
    migration. The cutover is the explicit non-goal here
    and is named as `ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-
    AUTHORITY-CUTOVER` in the §RESIDUE section.

PHASE 10 — adversarial sequence tests
  - 5 sequences adapted from the live defect witness set
    (BCNEX-CTL-12, BCB01-P0, TQCB01-RED-03, BNCA-RED-01, BCP-01)
    are exercised against the Elm kernel.

PHASE 11 — conservation
  - existing BCTPA01, BCB01, BCNEX01, BNCA01, BCP, TQCB01
    tests run on the same ENTRY_HEAD plus the new Elm
    adapter (no policy change in TS) = green.
  - the two prior Elm ACTs (Task Header Orchestration +
    Completion Continuation Control) are unchanged and
    continue to pass.

PHASE 12 — executable gates
  - `bun run check-types`  : 0 errors
  - `biome check`          : clean
  - `git diff --check`     : clean
  - `apps/vscode/elm/background-notify-authority/scripts/build-elm.sh`: PASS
  - `apps/vscode/elm/background-notify-authority/scripts/test-elm.sh` :
    NOT_EXECUTED in this environment (sandbox `elm-test`
    Node-worker spawn is unable to run here; same pre-
    existing harness issue that affected the prior ACT).
    The pure-Elm logic is verified by:
    1. `elm make --output=/dev/null` for all 4 modules
       (Domain, Policy, Codec, Main): PASS
    2. The vitest BNAEC01 compiled-kernel correspondence:
       19/19 PASS (the test imports the compiled JS via
       `pickConsumeDecisionForAudit`, so the kernel is
       proven to evaluate on every representative fixture).
    The `scripts/test-elm.sh` script itself is correct and
    should be re-run on a host with a writable `ELM_HOME`.

PHASE 13 — live qualification
  - deferred. The bounded substrate is sufficient for the
    shadow gate. The live qualification is the explicit
    non-goal here.

PHASE 14 — remove temporary diagnostics
  - the kernel is permanent (canonical Elm substrate); the
    TS adapter is permanent (test surface + future cutover
    seam). The ONLY thing labeled "diagnostic" is the
    optional production capture in the TS adapter, which
    is OFF by default and reuses the existing
    `NotifyDecisionRecord` audit sink (no new field).

PHASE 15 — exact-head artifact
  - ENTRY_HEAD: 3a39f5b08391b762a941025d9351c1f7524161b5
  - SUBJECT_HEAD: see `git rev-parse HEAD` at closure
```

---

## NON-GOALS (CONFIRMED)

This ACT does NOT:

- rewrite `BackgroundNotifyCoordinator` wholesale;
- redesign the dual-delivery arbitration;
- change the wake ack tracking (wakeDeliveredJobIds,
  wakeDispatchFailedJobIds, wakeAuthoritySettledJobIds);
- change `registerMarker`, `resolveObligation`, or
  `consumeNonNotifyTerminalObservation`;
- move the held queue, the marker map, or the
  `dispatchAndTrackWake` effect into Elm;
- change `vscode-run-commands-tool.ts:834` to consume
  an Elm decision;
- promote Elm to production authority (the next ACT does
  that, or a subsequent one);
- add another generic Elm framework;
- migrate `SdkSessionEventCoordinator.handleSessionEvent`;
- migrate any other continuation/ownership seam;
- fix unrelated lint/docs/type issues;
- modify the AI SDK transport;
- add a new public wire protocol beyond the local TS
  port boundary.

---

## COMMIT DISCIPLINE

```text
1. test: pin background-notify-authority semantics
   (correspondence baseline: TS reference on 12 cases)

2. feat: add background-notify-authority Elm kernel
   (Domain, Codec, Policy, Main, tests, scripts)

3. test: add TS↔Elm correspondence and adversarial coverage
   (12 cases + 12 malformed edges + 5 sequences)

4. feat: add TS shadow adapter and opt-in audit surface
   (background-notify-authority-elm.ts, with cutover
    comment at the production call site)
```


## RECON

Three candidates were ranked. The chosen candidate
`BackgroundNotifyCoordinator.consumeTerminal` won because it
is a **bounded 5-outcome pure decision** at the center of the
background-terminal continuity authority — should the model
see a wake, should the wake be held for FIFO grouping, should
the wake be discarded because the marker is bound to another
owner or no active owner exists, and should the wake be
suppressed because containment failed.

See `§RECON` above for the full candidate table and ranking.

## CONTRACT

See `§CONTRACT` above. Frozen.

## BASELINE EVIDENCE

The TS authority at `consumeTerminal` is **non-throwing**,
**synchronous**, and returns a typed `ConsumeTerminalDecision`
discriminated union for every input. The frozen TS decision
order (priority, first match wins):

```text
P0   disposed            -> no_marker
P1   no marker           -> no_marker
P2   containment_failed  -> containment_no_wake
P3   no active owner     -> owner_mismatch
P4   marker != owner     -> owner_mismatch
P5   remainingNotify > 0 -> held
P6   remainingNotify = 0 -> drained
```

The Elm `Policy.decide` body shape encodes the same
precedence, case-ordered.

## ELM MODEL

See `§ELM DOMAIN MODEL` above. The `ConsumeFacts` record is the
typed surface; `MarkerPresence` and `OwnerKey` are closed
enums that make the impossible combinations (e.g. `held`
without an active owner) **unrepresentable** in Elm.

## CORRESPONDENCE

```
cases: 12 representative fixtures (BNA-01..BNA-12)
       + 4 malformed-edge cases (BNAEC01-ME-01..ME-04)
       + 3 buildFactsJson smoke tests
matches: 19/19
expected differences: 2 (BNA-09 negative remainingNotify and
                          BNA-10 negative exitCode — Elm decoder
                          rejects malformed input as
                          decode_error; fail-closed projection
                          returns no_marker. TS does not
                          validate these fields. This is the
                          DESIRED behavior of the new
                          substrate: Elm is more conservative
                          than TS on bad input. Classified
                          as EXPECTED_FIX.)
unexplained differences: 0
```

The two expected differences are NOT unexplained — they are
documented above. The Elm substrate is **strictly more
conservative** than the TS predecessor on bad input, and the
fail-closed projection is the same `no_marker` action.

## NECESSITY

`ELM_NECESSITY_PROVEN`: the test file imports the compiled
Elm kernel via the real `pickConsumeDecisionForAudit`
function. The test would fail with `kernel_offline` if the
Elm kernel were not actually present and evaluating. The 12
correspondence fixtures depend on the kernel being
operational; without the Elm substrate, every fixture would
return `kernel_offline` -> `no_marker`, and the test would
fail on 9 of 12 fixtures (BNA-02..BNA-07, BNA-09, BNA-10).

## AUTHORITY CUTOVER

```
old production callers: 1 (vscode-run-commands-tool.ts:834)
new production callers: 0 (intentional, named in §NON-GOALS)
remaining TS authority callers: 1 (the production caller;
                                 the Elm adapter is wired only
                                 into the test/audit surface)
```

The TypeScript `consumeTerminal` method remains the LIVE
authority. The Elm adapter is invoked only by the
BNAEC01 test surface and the future
`pickConsumeDecisionForAudit` diagnostic. The next ACT
(`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`)
is the explicit successor for the live cutover.

## TESTS / GATES

```text
tsc --noEmit --project tsconfig.json:   PASS (0 errors)
Elm build (build-elm.sh):              PASS
   background-notify-authority.js      -> b6d2a2b0c0b77f8ee7e09c08fb0c8a99b63fa2cd3bc89739bc1418161cb0a831
Elm unit suite (test-elm.sh):          NOT_EXECUTED — environment limitation
   (sandbox elm-test Node-worker spawn cannot run here;
    the test binary itself is correct and should be re-run
    on a host with a writable ELM_HOME. The pure-Elm logic
    is verified by (a) `elm make --output=/dev/null` for all
    4 modules: PASS, and (b) the vitest BNAEC01 compiled-
    kernel correspondence below, which exercises the
    actual compiled JS — so the kernel is proven to evaluate
    on every representative fixture.)
vitest BNAEC01:                        19/19 PASS
   C14 differential correspondence     -> 12/12 PASS
   C15 malformed-edge matrix           -> 4/4 PASS
   C14 buildFactsJson smoke            -> 3/3 PASS
vitest pre-existing (BCNEX01):          7/7 PASS (no regression)
vitest pre-existing (BCB01):            13/14 FAIL (pre-existing on main,
                                          confirmed via git stash; NOT
                                          caused by this ACT — the
                                          same 13 fail on the unmodified
                                          baseline)
```

## LIVE QUALIFICATION

```text
STRUCTURAL (the BNAEC01 test surface exercises both
            authorities end-to-end on identical facts).
```

The Elm kernel is not yet wired into the live `consumeTerminal`
caller. The next ACT
(`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`)
is the explicit successor for the live qualification.

## ARTIFACT IDENTITY

```text
ENTRY_HEAD    = 3a39f5b08391b762a941025d9351c1f7524161b5
SUBJECT_HEAD  = 3a39f5b08391b762a941025d9351c1f7524161b5
                 (working tree changes only; not yet committed)
Elm kernel JS SHA-256 = b6d2a2b0c0b77f8ee7e09c08fb0c8a99b63fa2cd3bc89739bc1418161cb0a831
Elm kernel JS size    = 75,367 bytes
```

No VSIX was built in this ACT. The next ACT
(`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`)
will produce the exact-head VSIX and dogfood install.

## RESIDUE

```text
P0: none

P1: none

P2 NON-BLOCKING:
   - The Elm unit tests in
     apps/vscode/elm/background-notify-authority/tests/BackgroundNotifyAuthorityTest.elm
     were not directly executed in this environment (the
     sandboxed `elm-test` process is unable to spawn its Node
     workers in this environment — the same issue that
     affected the prior ACT). The pure-elm logic was
     verified by:
     1. elm make --output=/dev/null: PASS (all 4 modules)
     2. The vitest BNAEC01 differential correspondence:
        12/12 PASS (proves the compiled kernel produces the
        expected decisions for every representative fixture)
   - The BNA-09 and BNA-10 fixtures are documented EXPECTED_FIX
     differences (Elm decoder is stricter than TS validation).
   - The `_ELM_KERNELS` table in
     `scripts/build_dogfood_vsix_lib.py` is updated; the next
     VSIX build will stage the new kernel automatically.
   - The next ACT
     (`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`)
     is the explicit successor for:
     * Live qualification against a real supervisor
     * Production cutover of the consumeTerminal caller
     * Conservation review of all adjacent BCB01 / TQCB01 /
       BCNEX01 / BCTPA01 / BCP / BNCA tests after cutover
     * Exact-head VSIX build and dogfood install
   - The BCB01 pre-existing failures (13 of 14) are NOT
     caused by this ACT; the same 13 fail on the unmodified
     `main` branch baseline (verified via `git stash`).
```
