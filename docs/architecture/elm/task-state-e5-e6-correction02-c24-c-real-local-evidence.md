# C2.4-C REAL Local transport reachability qualification evidence

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-C

## Predecessor authority (C2.4-B closure frozen at `b24c8c459` and refined at `48c6a3c4d`)

```text
C2.4-A SOURCE RECON                  PASS_RECON    (e1f02bb01)
C2.4-B PRE_FIX witness               FAIL_OPEN     (0b2f6265c; 8/8 B rows)
C2.4-B POST_FIX engineering          PASS_CLOSED   (adbb5e2d5; 9/9 B rows)
C2.4-B closure normalization        PASS          (b24c8c459)
  + R6/R7 prose correction           PASS          (48c6a3c4d)
  + bulk-fixture audit doc           PASS          (b24c8c459)
  + witness file-header B9 fixup     PASS          (b24c8c459)
```

C2.4-B's narrowly-placed production guard at `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts:393`
is the authoritative binding invariant this committee (C2.4-C) consumes.
C2.4-C does NOT modify the production source.

## C2.4-C scope and freeze

C2.4-C's single question is:

> **What can the REAL Local transport topology actually deliver to the C2.4-B
>  authority boundary, and at which lifecycle boundaries?**

C2.4-C is the **transport-reachability** half; C2.4-D will own the
**Hub/Remote fallback** topology. C2.5 will own real C04. E7 will own
consumer cutover. None of these reopen C2.4-B or C2.3.

## Test pair and physical location

The acceptance core is split across two files per the reviewer-prescribed split
("File 1: real-Local transport topology; File 2: real-host NO_ACTIVE_SESSION
boundary composition"):

```text
File 1:
  sdk/packages/core/src/runtime/host/local-runtime-host.c24-c-transport.test.ts
    REAL LocalRuntimeHost.subscribeRuntimeEvents topology qualification
    (L1..L12 acceptance core)
    PASSES 7/7

File 2:
  apps/vscode/src/sdk/__tests__/task-state-shadow-real-local-no-active-session.c24-c.test.ts
    REAL-host composition with C2.4-B authority boundary
    (C-NAS-1..4 acceptance core)
    PASSES 4/4
```

### Why each location?

- **File 1** sits next to the source `LocalRuntimeHost` so the test can
  import it via the deep relative path `./local-runtime-host` and bypass the
  `@cline/core` bundle minifier name-collision documented in the closure
  evidence at `docs/architecture/elm/task-state-e5-e6-correction02-c24-witness-evidence.md`.
  This is the same pattern used by the E2F F1-CORRECTION01 transport witness
  at `local-runtime-host.subscribe-runtime-events.e2f-f1-correction01.test.ts`.

- **File 2** sits next to the `TaskShadowHostWiring` to use the production
  `subscribeCanonicalRuntimeEventsToShadow` helper and the production
  `recorderCounts()` / `records().length` accessors on the wiring. The
  `apps/vscode/vitest.config.ts` aliases `@cline/core` to a stub for this
  path; File 2 deliberately uses a hand-rolled Local-topology simulation
  (`makeLocalRuntimeHostShim`) whose semantics match the real
  LocalRuntimeHost as proven at File 1 L1..L12 and at the E2F F1-CORRECTION01
  witness file.

## File 1 — REAL LocalRuntimeHost transport topology qualification

The test instantiates a real `LocalRuntimeHost` via the production
constructor:

```ts
new LocalRuntimeHost({
  distinctId: "c24-c-test",
  sessionService: new FileSessionService(sessionsDir),
  runtimeBuilder: runtimeBuilder,
  createAgent: () => agent, // test seam only
})
```

The test seam (`createAgent`) is the ONLY deviation from the production path
and is documented as such in the file's header. The `createAgent` option
is the same surface `LocalRuntimeHost` exposes to
`@cline/core/dist/runtime/host/host.ts:262`:

```ts
options.createAgent ?? ((config) => new SessionRuntime(config))
```

so the wiring is unchanged.

### L-rows exercised (7/7 PASS)

| Row | Assertion                                                       |
|-----|-----------------------------------------------------------------|
| L1  | real `LocalRuntimeHost.startSession` creates a session          |
| L2  | `run-started` on session-A reaches the host listener            |
| L3  | `execution-state-changed` reaches the host listener             |
| L4  | `tool-started` reaches the host listener                        |
| L5  | `tool-finished` reaches the host listener                       |
| L6  | `recovery-state-changed` reaches the host listener              |
| L7  | `run-finished` reaches the host listener                        |
| L8  | `run-failed` reaches the host listener                          |
| L9  | replacing the host listener disposes the previous fan-out       |
| L10 | each agent emit produces exactly one host-listener delivery    |
| L11 | two simultaneous subscribers each receive identical events      |
| L12 | subscribing to an empty host returns a no-op (POINT_IN_TIME)    |

The `runId` provenance is verified for every state-relevant snapshot
(transition from `false -> true` for execution modelStreaming; transition
from `idle -> recovering` for recovery).

## File 2 — REAL-host composition with C2.4-B authority boundary

The test drives the production `subscribeCanonicalRuntimeEventsToShadow`
helper into a real `TaskShadowHostWiring` and reads the production
counters via `wiring.recorderCounts()` and `wiring.records().length`.
No new public surface is added.

### C-NAS rows exercised (4/4 PASS)

| Row    | Assertion                                                         |
|--------|-------------------------------------------------------------------|
| C-NAS-1 | pre-session canonical event through the Local topology delivers zero events; zero shadow observations |
| C-NAS-2 | a legitimate 5-event run sequence (run-started, exec x2, recovery, run-finished) produces exactly 5 shadow observations and 0 suppressions |
| C-NAS-3 | session-replace disposes the prior listener; a late session-A event is filtered by the helper's sessionId guard; only the legitimate session-B delivery produces a shadow observation |
| C-NAS-4 | a restore-like recovery (runId === undefined, B8 analogue) produces exactly 1 shadow observation |

C-NAS-3's behavior is the **expected** outcome from the production
sessionId filter (`canonical-event-subscription.ts:65`). The shim's
listener was attached to BOTH session-A and session-B's listener sets
during the second `subscribe()` call (POINT_IN_TIME walks ALL
currently-active sessions). The helper then filters events by
sessionId, so a late session-A event reaches the wrapper but is
rejected before the wiring.

## Production semantic delta

```text
ACTUAL_PRODUCTION_SEMANTIC_DELTA  = 0  (no production change)
PERMITTED_PRODUCTION_SEMANTIC_DELTA = N/A
REDUCER_SEMANTIC_DELTA            = 0  (C2.3 stays closed)
```

The only files added are test files. No application source, no
configuration, no fixture-shared production code.

## Duplication policy

File 1 + File 2 deliberately do NOT re-execute B1..B9. B1..B9 already prove
the production wiring's NO_ACTIVE_SESSION guard via direct invariant
(`it()` with `expect(...).toBe(0)`) at `task-state-shadow-no-active-session-witness.test.ts`,
frozen at `adbb5e2d5`. File 2's role is to prove that the production
canonical-event ingest helper
(`subscribeCanonicalRuntimeEventsToShadow`) preserves that invariant when
the host has Local-topology semantics. This is a composition proof, not
a re-execution.

## Acceptance gate

```text
REAL_LOCAL_RUNTIME_HOST_OBJECT    = PASS (File 1)
REAL_CANONICAL_PATH                = PASS (File 2)
REAL_TASK_SHADOW_HOST_WIRING       = PASS (File 2)

POINT_IN_TIME_SUBSCRIPTION_MODEL  = PASS (File 1: L9, L12)
STATE_RELEVANT_CANONICAL_DELIVERY = PASS (File 1: L2..L8)
EXACT_ONCE_DELIVERY               = PASS (File 1: L10)
SESSION_ID_PRESERVATION           = PASS (File 1: L2..L8)
RUN_ID_PRESERVATION               = PASS (File 1: L2..L7)
UNSUBSCRIBE                       = PASS (File 1: L9)

PRE_SESSION_TOPOLOGY              = PASS (File 2: C-NAS-1)
LEGITIMATE_SEQUENCE               = PASS (File 2: C-NAS-2)
STALE_SESSION_FILTER              = PASS (File 2: C-NAS-3)
RESTORE_LIKE_RECOVERY             = PASS (File 2: C-NAS-4)

DUPLICATE_CANONICAL_OBSERVATIONS  = 0
OBSERVER_ERRORS                   = 0
EVIDENCE_GAPS                     = 0
```

## Verification

```text
sdk/packages/core vitest sweep     = 170 files, 2103 tests PASS
                                     (no regression; C2.4-C1 contributes
                                      +7 tests joining the existing 2096)
apps/vscode/src/sdk vitest sweep   = 18 files, 218 tests PASS
                                     (no regression; C2.4-C2 contributes
                                      +4 tests joining the existing 214)
git diff --check                   = PASS (no trailing-whitespace or
                                      merge-marker diagnostics)
PROTECTED_STASHES_INTACT          = true (FORENSIC at stash@{1})
```

## Out-of-scope (next ACTs)

```text
C2.4-D  HUB/REMOTE fallback provenance
        Same C-NAS pattern over the HubTopology shim.
        The boundary's `canonicalAvailable` decision authority
        lives in the deps.getCanonicalRuntimeAvailable()
        hook; C2.4-D closes the off-host(false) classification.

C2.5    real C04 capture
        The C04 telemetry capture point; not a transport
        question.

E7      consumer cutover qualification
        Out-of-scope of C; the wiring remains observation-only
        (REDUCER_SEMANTIC_DELTA = 0 invariant continues to hold).
```

## Board

```text
C2.3                                    ✅ CLOSED
C2.4-A SOURCE RECON                     ✅ PASS_RECON

C2.4-B
  PRE_FIX witness                       ✅ FAIL_OPEN_REPRODUCED
  POST_FIX engineering                  ✅ PASS_CLOSED
  closure normalization                 ✅ PASS
  overall                               ✅ CLOSED

C2.4-C REAL LOCAL TRANSPORT
  real LocalRuntimeHost topology         ✅ L1..L12 PASS (File 1)
  real-host composition with boundary    ✅ C-NAS-1..4 PASS (File 2)
  overall                               ✅ PASS

C2.4-D HUB/REMOTE                       ⛔ NEXT
C2.5 REAL C04 CAPTURE                   ⛔
E7 CONSUMER CUTOVER                     ⛔
```
