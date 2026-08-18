# C2.4-D3 plan — HUB/REMOTE PROVENANCE + EPOCH SAFETY (A/B/C repair selection)

> Reviewer verdict lock (round-17, Cline runtime-architecture +
> distributed-event provenance):
>
> > "D3 is a qualification ACT first and a repair ACT second.
> > The central D3 risk is prematurely choosing B because
> > `session.notice` happens to carry `conversationId`. The
> > decisive test for B is **temporal authority**, not
> > availability: does the proposed signal exist *before the
> > first epoch-sensitive reconstructed mutation, by production
> > contract rather than test ordering*? The A/B feasibility gate
> > should be strict enough that we do not accidentally 'repair'
> > the shadow with guessed epoch semantics."

```text
ACT_ID          = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-D3
ENTRY_HEAD      = 88d0ec391 (C2.4-D2-FIXUP03)
EXIT_HEAD       = <this commit's tip>
PROTECTED_STASH = 141372c52 (FORENSIC, do NOT pop)

C2_4_D3_AUTHORIZED = true

C2_4_D3_VERDICT_PASS iff (
  SEVEN_AXES_CLASSIFIED
  && REPAIR_SELECTION_FROM_REAL_EVIDENCE
  && NO_FABRICATED_IDENTITY
  && D2_DECODER_FROZEN_OR_PRINCIPLED_DELTA
  && REMOTE_PARITY_PROVENANCE_WITNESS
  && D4_AUTHORIZED
)
```

C2.4-D3 PASS does NOT require Hub/Remote to become fully qualified.
C2.4-D3 PASS means the truth of Hub/Remote is KNOWN per axis, not
invented. Valid disposition classes are A, B, or C. C is acceptable.

## 0. Amendment log

```text
PLAN                       = task-state-e5-e6-correction02-c24-d3-provenance-epoch-plan.md
PLAN-AMENDMENT-01          = <this commit> (initial plan; reviewer round-17)
```

## 1. Entry inheritance (read this before mutating anything)

### 1.1 Predecessor authority

```text
D0 FIXUP01                  = CLOSED / PASS_RECON   (7650f1a71)
D1-HUB                      = CLOSED / PASS_REACH   (97e2ba7ee)
D1-REMOTE                   = CLOSED / PASS_REACH   (27d56708d)
D2                          = CLOSED                (3d14ccd5c — original)
D2-CORRECTION01             = CLOSED                (63bc24249 — semantic, R1)
D2-FIXUP02                  = CLOSED                (81a557b2b — portability, R9/R10)
D2-FIXUP03                  = CLOSED                (88d0ec391 — cross-OS, R11)
```

### 1.2 D2 frozen decoder (the negative control for D3)

```text
canonicalAvailable=false:
  translated                    = 8 EXACT
  FALLBACK_APPLY                = 6 EXACT
  SUPPRESS_DUPLICATE            = 2 EXACT
  DIAGNOSTIC_ONLY               = 0
  shadow_mutated                = true

canonicalAvailable=true:
  translated                    = 8 EXACT
  FALLBACK_APPLY                = 0
  DIAGNOSTIC_ONLY               = 8 EXACT
  shadow_mutated                = false
```

These counts are CONTROL observations. D3 must NOT rewrite these
tests to make a repair look successful. If A or B is selected and
the post-repair decoder differs, document the exact before/after
counts and explain every changed edge from run-identity semantics.

### 1.3 D2 epoch finding (single sentence)

Hub `iteration.started` envelope emits `AgentEvent` with only
`{ type: "iteration_start", iteration }` — no `conversationId`,
no run epoch. The translator's `activeRunId` tracker is never
seeded under Hub; both the translator's stranded-terminal gate and
the coordinator's scopedEdgeKey dedup collapse to `runId=undefined`
for both epochs, producing the two SUPPRESS_DUPLICATE collisions.

### 1.4 Portability vocabulary freeze

```text
CHECKOUT_LOCATION_PORTABILITY       = PASS
UNIX_MACOS_RUNTIME_EXECUTION        = PASS_REAL
WINDOWS_PATH_SEMANTICS              = PASS_SIMULATED
WINDOWS_VITEST_RUNTIME_EXECUTION    = NOT_EXECUTED
```

`WINDOWS_PATH_SEMANTICS=PASS_SIMULATED` does NOT mean Windows
runtime is verified. It means the test path construction uses
`path.resolve` (cross-platform API) and assertion construction
uses `path.sep` (cross-platform separator), and that those
constructions produce OS-correct output on a Windows host as
verified via `path.win32` simulation on a POSIX host. Actual
execution on a Windows runner is **not** claimed.

This vocabulary does NOT block D3.

### 1.5 Known worktree exception

The long-standing untracked file
`.clinerules/sdk-transport-integration.md` is KNOWN and exempt
from the "no unexpected dirty work" rule.

## 2. The seven provenance axes (D3-P1..D3-P7)

```text
D3-P1  SESSION_ID_PROVENANCE
D3-P2  RUN_ID / CONVERSATION_ID_PROVENANCE
D3-P3  FIRST_ITERATION_START_IDENTITY
D3-P4  STALE_OLD_RUN_TERMINAL_SUPPRESSION
D3-P5  CONTINUATION_BEFORE_NEXT_RUN_START
D3-P6  TASK_RESET / NEW_TASK_EPOCH_BOUNDARY
D3-P7  RECOVERY_WITH_MISSING_RUN_PROVENANCE
```

Classification vocabulary:

```text
QUALIFIED
PARTIALLY_QUALIFIED
NOT_YET_QUALIFIED
```

Per backend:

```text
                    LOCAL     HUB       REMOTE
  D3-P1             frozen    ?         ?
  D3-P2             frozen    ?         ?
  D3-P3             frozen    ?         ?
  D3-P4             frozen    ?         ?
  D3-P5             frozen    ?         ?
  D3-P6             frozen    ?         ?
  D3-P7             frozen    ?         ?
```

LOCAL is inherited from C2.4-C/C2.3 evidence and is a control;
not relitigated here unless D3 production edits touch common
translation logic.

## 3. Selection classes (A / B / C)

### 3.1 Candidate A — restore authoritative run identity at the Hub source

```text
A = restore authoritative run identity at the Hub source /
    CoreSessionEvent boundary early enough that the EXISTING
    TaskShadowReverseTranslator iteration_start seeding path
    is correct.
```

**Selectable ONLY if all proven:**

```text
A1  The identifier exists at the producer/Hub protocol boundary
    at the relevant moment.
A2  It represents the same semantic run epoch as Local
    AgentRuntimeStateSnapshot.runId.
A3  It can be preserved through HubRuntimeHost without inventing,
    hashing, guessing, synthesizing, or reusing an unrelated id.
A4  It reaches iteration_start BEFORE that reconstructed
    run-started observation is handed to coordinator.observe.
A5  It works for BOTH HubRuntimeHost and RemoteRuntimeHost.
```

If the Hub protocol does not actually contain this information,
A = REJECT_NO_SOURCE_PROVENANCE.

**Forbidden fabrication sources** (no manner of "infer it from"):

```text
- iteration number
- sessionId
- timestamps
- random UUID
- tool id
- task id
- event count
```

### 3.2 Candidate B — restore authoritative run identity at the observation/translation boundary

```text
B = restore authoritative run identity at the observation /
    translation boundary from another production event, but
    ONLY if that event is proven to arrive early enough and
    unambiguously enough to establish the epoch before any
    state mutation whose correctness depends on that epoch.
```

**Selectable ONLY if all proven:**

```text
B1  Source event carries an authoritative conversation/run id.
B2  The source event arrives BEFORE every epoch-sensitive
    mutation that relies on the identity.
B3  Ordering is a production invariant, not merely the
    scripted D1/D2 test order.
B4  A stale notice/event from run A cannot seed run B.
B5  Same-session multi-run flow is distinguishable.
B6  task_reset/new-task cannot inherit the old run id.
B7  continuation-before-next-run-start cannot accept an old
    terminal because of a stale tracker.
B8  recovery events with no run provenance remain explicitly
    classified rather than accidentally borrowing stale identity.
```

**Critical temporal pre-condition** (the decisive test for B):

> "session.notice sometimes contains conversationId" is NOT
> enough to select B. If notice arrives AFTER iteration_start,
> explicitly determine whether that means B cannot repair
> FIRST_ITERATION_START_IDENTITY.

B may be **QUALIFIED_FOR_SUBSET_ONLY** without being selectable
as the full D3 repair.

### 3.3 Candidate C — no safe repair in this cycle

```text
C = no safe repair is proven in this cycle:
    HUB/REMOTE remain NOT_YET_QUALIFIED on the affected axes
    and D4 must freeze E7_INITIAL_BACKEND_SCOPE accordingly
    (LOCAL_ONLY is an acceptable result).
```

C is NOT a failure of the ACT. C means:

```text
HUB_RUN_EPOCH_PROVENANCE       = NOT_YET_QUALIFIED
REMOTE_RUN_EPOCH_PROVENANCE    = NOT_YET_QUALIFIED
```

and D4 decides the E7 backend set.

## 4. Decision rule

```text
SELECT A iff A1..A5 all PASS.
ELSE SELECT B iff B1..B8 all PASS.
ELSE SELECT C.
```

No "A seems cleaner" or "B likely easiest" decision is allowed.
The chosen class MUST follow from the frozen gates.

## 5. HALT conditions

D3 MUST HALT rather than PASS if:

```text
- an unexplained state mutation remains,
- a supposed A/B fix depends on fabricated identity,
- stale old-run terminal can mutate current task/run,
- cross-task event can mutate new task,
- evidence is based on a hand-rolled Hub substitute,
- production wiring seam is bypassed,
- D2 polarity regresses,
- reducer semantics changed,
- protected stash changed,
- tests are weakened after observing a failure.
```

If evidence demonstrates a defect outside the permitted D3
surface (reducer change, protocol change, public API change,
new global state, adding Hub subscribeRuntimeEvents), the
qualification is `QUALIFICATION_FOUND_DEFECT` and a narrower
correction ACT must be opened.

## 6. Soft production budget

```text
D3_PRODUCTION_SOFT_TARGET <= 200 net LOC
If >200: explain why.
If >350: HALT and open a narrower repair ACT.
REDUCER_SEMANTIC_DELTA = 0 (default)
PUBLIC_API_DELTA       = 0 (default)
PROTOCOL_SCHEMA_DELTA  = 0 unless evidence proves the change
                          is purely preservation of already-present
                          authoritative data and current ACT
                          authority explicitly covers that surface.
```

Test/doc LOC are not included in the production LOC budget.

## 7. Companion artifacts

Production-witness test file (preferred):

```text
apps/vscode/src/sdk/__tests__/
hub-runtime-host.provenance-epoch.c24-d3.test.ts
```

Preferred: extend the existing `vitest.config.c2-4-d-hub.ts`
include list rather than proliferation:

```text
// pseudocode
// existing config file: apps/vscode/vitest.config.c2-4-d-hub.ts
// add a new include entry pointing at the D3 test file
include: [
  "src/sdk/__tests__/hub-runtime-host.fallback-composition.c24-d.test.ts",
  "src/sdk/__tests__/hub-runtime-host.provenance-epoch.c24-d3.test.ts",
]
```

Do not add a separate tsconfig/baseline unless the existing
companion has a real failure mode that requires isolation.

## 8. Test seam requirements (mirror D2)

Per the D2/FIXUP03 seam:

```text
REAL HubRuntimeHost                                       (D1)
production NodeHubClient mock seam already qualified      (D1/D2)
REAL createTaskShadowHostWiring                           (D2)
REAL observeLegacyEvent                                    (D2)
REAL TaskShadowReverseTranslator                          (D2)
REAL coordinator authority path                           (D2)
```

No direct calls to:

```text
translator.translate(...)
coordinator.observe(...)
comparator.update(...)
TaskStateShadow.observe(...)
recorder.record(...)
```

except in explicitly labeled unit-level causal probes that are
NOT used as production-composition evidence.

## 9. Pre-repair adversarial witness matrix (Phase 3)

Required pre-repair cases (D3-W1..D3-W8):

```text
D3-W1 CURRENT RUN
  epoch A runs through run.started, iteration.started,
  optional identity-bearing event, tool edges, run.completed.
  Prove current normal flow exactly.

D3-W2 TWO RUNS SAME SESSION
  A complete, B starts, B completes.
  Record reconstructed runId at every translated edge,
  FALLBACK_APPLY count, SUPPRESS_DUPLICATE count, final lifecycle.
  FREEZE the current broken/control behavior before repair.

D3-W3 OLD TERMINAL AFTER NEW RUN HAS STARTED
  A starts, B becomes current, late run.completed(A) or
  late run.failed(A).
  Required: can the reconstructed path distinguish it?
  Pre-repair expected: likely NO — observe.

D3-W4 CONTINUATION WINDOW
  A, same_task_continued boundary, late terminal A,
  before next epoch identity becomes authoritative,
  then B starts.
  Mirrors Local C7/C8/C9 hazards through Hub.

D3-W5 NEW TASK RESET WINDOW
  task A, task_reset, task_requested B, late terminal A,
  then B epoch begins.
  Required: no old A event may terminate B in a fully-qualified
  result.

D3-W6 CROSS-SESSION
  session A run, active switches to session B, late A event.
  Expected: session guard already refuses it.
  Control proving D3 is isolating RUN provenance rather than
  conflating with session provenance.

D3-W7 RECOVERY MISSING RUN ID
  Drive REAL Hub/Remote recovery-producing source shape.
  Record: source provenance, CoreSessionEvent provenance,
  reconstructed snapshot.runId, authority decision, mutation,
  final recovery state. Do not fabricate runId to make it green.

D3-W8 REMOTE PARITY
  Repeat the decisive provenance subset on REAL RemoteRuntimeHost.
  Remote inherits but D3 closure needs at least one production-object
  parity witness for the selected repair/disposition.
```

## 10. Post-repair real-host qualification (Phase 6)

If A or B selected:

```text
- Re-run the SAME pre-repair D3-W1..W8 tests against production.
- Do NOT create separate "green" fixtures with a nicer event order.
- Original adversarial orderings remain authoritative.
- Re-run D2:
    bun run test:vitest:c2-4-d-hub
    bun run check-types:c2-4-d-hub
- The 6/2 pre-repair decoder MAY change after a valid A/B repair.
  Document exact before/after counts and explain every changed edge.
```

If A selected, hard requirement:

```text
scopedEdgeKey(A, run-started) != scopedEdgeKey(B, run-started)
scopedEdgeKey(A, run-finished) != scopedEdgeKey(B, run-finished)
```

If B selected, required state-machine proof:

```text
UNSEEDED
  -> authoritative epoch signal A
  -> A

A
  -> authoritative transition to B
  -> B

FORBIDDEN:
  stale A event after B becoming authoritative -> A

REQUIRED RESET:
  task reset: A -> UNSEEDED

REQUIRED CONTINUATION:
  continuation fence: A -> AWAITING_NEXT_EPOCH
  old A terminal -> suppressed
  authoritative B signal -> B

REQUIRED RECOVERY:
  event with missing epoch id cannot silently overwrite tracker.
```

Hard gates (post-repair):

```text
D10_UNKNOWN                    = 0
invariantViolations            = 0
observerErrors                 = 0
evidenceGaps                   = 0
stale_old_run_mutations        = 0
cross_session_mutations        = 0
cross_task_old_epoch_mutations = 0
duplicate_same_epoch_edges     = 0 unless explicitly expected
cross_epoch_false_dedup        = 0
```

## 11. Necessity / causal probes (Phase 7)

A/B repair cannot pass from green tests alone.

```text
If A:
  remove/disable only the new identity preservation.
  Required: at least one of W2/W3/W4/W5 fails
  and pre-repair 6/2-type collision reappears.

If B:
  remove/disable only the new tracker seeding / epoch transition.
  Required: at least one decisive epoch-safety witness fails.

Restore production code.
Run tests again.
Record: REPAIR_NECESSITY_PROVEN = true
Do not commit the deliberately broken probe.
```

## 12. Regression sweep (Phase 9)

```text
sdk/packages/core:
  D1-HUB reachability
  D1-REMOTE reachability
  hub-runtime-host existing tests
  full unit suite if practical

apps/vscode:
  D2 dedicated suite
  D3 dedicated suite
  C2.4-C bridge
  C2.4-B / no-active-session witnesses
  C2.3 stateful workload matrix / critical correction witnesses
  recorder/coordinator/observer tests
```

Then:

```text
check-types base
check-types:c2-4-c-bridge
check-types:c2-4-d-hub
git diff --check
bundle/build gate required by current branch closure protocol
```

No new TS errors. Baseline wrappers remain machine-enforced.

## 13. Final provenance matrix (Phase 10)

| Axis | Local | Hub | Remote | Evidence |
|------|-------|-----|--------|----------|
| sessionId provenance |          |     |         |          |
| conversationId provenance |    |     |         |          |
| runId epoch provenance |       |     |         |          |
| first iteration identity |     |     |         |          |
| current-run terminal |         |     |         |          |
| stale old-run terminal |       |     |         |          |
| continuation pre-start |       |     |         |          |
| task reset / new-task |        |     |         |          |
| recovery missing id |          |     |         |          |
| reconstructed dedup |          |     |         |          |
| canonicalAvailable polarity |  |     |         |          |

Derived backend status:

```text
HUB_TOTAL_PROVENANCE =
  QUALIFIED iff every E7-required axis is QUALIFIED
  else PARTIALLY_QUALIFIED iff at least one useful axis is
  proven and none of the matrix prose disguises an active defect
  else NOT_YET_QUALIFIED

REMOTE_TOTAL_PROVENANCE = same
```

An active unsafe epoch mutation on an E7-required axis means
NOT_YET_QUALIFIED for that axis (no "basically qualified").

## 14. Evidence document (Phase 11)

After disposition, create:

```text
docs/architecture/elm/
task-state-e5-e6-correction02-c24-d3-provenance-epoch-evidence.md
```

Must contain:

```text
1.  Identity / predecessor SHAs
2.  D2 frozen pre-repair decoder
3.  Candidate A/B/C evaluation
4.  Selected repair class
5.  Pre-repair adversarial results
6.  Production delta, if any
7.  Post-repair results, if A/B
8.  Necessity probe
9.  Hub matrix
10. Remote matrix
11. Local frozen control
12. Typecheck/test/build results
13. Protected-stash verification
14. Exact D3 verdict
15. D4 authorization status
16. Explicit statement that E7 is NOT authorized by D3
```

Use non-cyclic commit reference convention:

```text
SUBJECT_HEAD = resolve with git rev-parse HEAD at review time
```

DO NOT write impossible self-referential SHAs.

## 15. Commit discipline (Phase 13)

```text
D3-C1
  docs(elm): freeze C2.4-D3 provenance/epoch qualification contract

D3-C2
  test(elm): add pre-repair Hub/Remote epoch provenance witnesses

D3-C3
  docs(elm): select D3 repair class A/B/C from evidence

IF A/B:

D3-C4
  fix(elm): repair Hub reconstructed run provenance
  [narrow production change]

D3-C5
  test(elm): qualify repaired Hub/Remote epoch safety

D3-C6
  test(elm): prove D3 repair necessity and D2 regression conservation
  (committed tests only; broken probe remains uncommitted)

IF C:
  no production commit; proceed directly to evidence.

D3-C7
  docs(elm): record C2.4-D3 provenance matrix and D4 authorization
```

Do NOT squash away:

```text
- pre-repair evidence,
- repair-selection decision,
- a real defect witness.
```

## 16. Verdict rule (Phase 12)

D3 PASS means PROVENANCE TRUTH IS KNOWN. It does NOT require
Hub/Remote to become fully qualified.

Valid PASS forms:

```text
A)
  D3_REPAIR_CLASS = A
  HUB axes qualified per evidence
  REMOTE axes qualified per evidence
  D4_AUTHORIZED = true

B)
  D3_REPAIR_CLASS = B
  HUB axes qualified per evidence
  REMOTE axes qualified per evidence
  D4_AUTHORIZED = true

C)
  D3_REPAIR_CLASS = C
  HUB/REMOTE retain PARTIAL/NOT_YET statuses honestly
  D4_AUTHORIZED = true
```

Invalid:

```text
"D3 failed because LOCAL_ONLY may be required."
```

LOCAL_ONLY is a D4 disposition, not a D3 failure.

D4 owns the E7 scope freeze. D3 does NOT authorize E7.

## 17. Final board (Phase 15)

Expected shape after successful D3:

```text
C2.3                                         ✅ CLOSED
C2.4-A                                       ✅ CLOSED
C2.4-B                                       ✅ CLOSED
C2.4-C                                       ✅ CLOSED
C2.4-D0                                      ✅ CLOSED
C2.4-D1 HUB/REMOTE                           ✅ CLOSED
C2.4-D2                                      ✅ CLOSED

C2.4-D3 PROVENANCE/EPOCH
  pre-repair witness matrix                  ✅
  repair selection A|B|C                     ✅
  repair implementation (if A/B)             ✅ | N/A
  post-repair D2 rerun (if A/B)              ✅ | N/A
  necessity probe                            ✅ | N/A for C
  Hub provenance matrix                      ✅
  Remote provenance matrix                   ✅
  D3 verdict                                 ✅ PASS_...

C2.4-D4 E7 SCOPE FREEZE                      🟢 NEXT / AUTHORIZED

C2.5                                         ⛔
E7                                           ⛔

D3 DOES NOT AUTHORIZE E7.
```

## 18. Final response format

```text
ENTRY:
  HEAD
  TREE
  WORKTREE
  protected stashes

COMMITS:
  ordered list

REPAIR_SELECTION:
  A | B | C
  exact evidence for rejecting other two

PRE_REPAIR:
  D2 8/6/2 frozen
  W1..W8 outcomes

POST_REPAIR:
  exact counts if A/B
  N/A if C

PROVENANCE_MATRIX:
  Local / Hub / Remote × all axes

TESTS:
  focused
  full
  typechecks
  build
  diff-check

DELTA:
  production LOC
  reducer delta
  public API delta
  protocol delta
  test/config delta

VERDICT:
  PASS_PROVENANCE_EPOCH_C2_4_D3
  or
  QUALIFICATION_FOUND_DEFECT_...

D4_AUTHORIZED:
  true | false

E7_AUTHORIZED:
  false

NEXT:
  C2.4-D4 E7 SCOPE FREEZE
  (only when D4_AUTHORIZED=true)
```
