# C2.4-C REAL Local transport reachability qualification evidence

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-C

## Predecessor authority (C2.4-B closure frozen at `b24c8c459` and refined at `48c6a3c4d`)

```text
C2.4-A SOURCE RECON                  PASS_RECON    (e1f02bb01)
C2.4-B PRE_FIX witness               FAIL_OPEN     (0b2f6265c; 8/8 B rows)
C2.4-B POST_FIX engineering          PASS_CLOSED   (adbb5e2d5; 9/9 B rows)
C2.4-B closure normalization        PASS          (b24c8c459)
C2.4-B R6/R7 prose correction       PASS          (48c6a3c4d)
```

C2.4-B's narrowly-placed production guard at
`apps/vscode/src/sdk/task-state-shadow-host-wiring.ts:393` is the
authoritative binding invariant C2.4-C consumes. C2.4-C does NOT
modify the production source.

## C2.4-C scope and freeze

C2.4-C's single question is:

> **What can the REAL Local transport topology actually deliver to the
>  C2.4-B authority boundary, and at which lifecycle boundaries?**

C2.4-C is the **transport-reachability** half; C2.4-D will own the
**Hub/Remote fallback** topology. C2.5 will own real C04. E7 will
own consumer cutover. None of these reopen C2.4-B or C2.3.

## History and re-evaluation

C2.4-C was first frozen at `da3fb414d` with two files:

- **File 1** (real `LocalRuntimeHost` topology qualification) — accepted.
- **File 2** (hand-rolled `LocalRuntimeHostShim` + production wiring)
  — accepted as a labeled component test, but the earlier evidence
  wording overreached by claiming it was a "REAL-host composition
  proof."

The runtime-integration reviewer (post-`da3fb414d`) correctly noted
that the actual seam between the real `LocalRuntimeHost` and the
real `TaskShadowHostWiring` was never exercised end-to-end.
Specifically:

- File 1's `LocalRuntimeHost` is the real class, but its target is a
  test local listener (not the production wiring).
- File 2's host is a hand-rolled shim, not the real class, even
  though the wiring is the real production factory.
- **No single test executed the full chain**
  `real LocalRuntimeHost` → `real subscribeCanonicalRuntimeEventsToShadow`
  → `real TaskShadowHostWiring`.

C2.4-C-CORRECTION01 closes that gap.

## Final test layout (C2.4-C-CORRECTION01 freeze)

C2.4-C is now closed by THREE files, not two:

```text
File 1:
  sdk/packages/core/src/runtime/host/local-runtime-host.c24-c-transport.test.ts
    REAL LocalRuntimeHost.subscribeRuntimeEvents topology qualification
    (L1..L12 acceptance core)
    PASSES 7/7

File 2 (COMPONENT TEST — labeled control):
  apps/vscode/src/sdk/__tests__/task-state-shadow-real-local-no-active-session.c24-c.test.ts
    Hand-rolled LocalRuntimeHost-shape host + production wiring
    (C-NAS-1..4 acceptance core)
    PASSES 4/4
    PROOF: wiring-side classification under Local-shape host
           simulation, NOT a real-host composition proof

File 3 (REAL bridge — closes C2.4-C):
  apps/vscode/src/sdk/__tests__/real-local-to-shadow-bridge.c24-c-correction01.test.ts
    REAL LocalRuntimeHost + REAL subscribeCanonicalRuntimeEventsToShadow
    + REAL TaskShadowHostWiring
    (C-REAL-1..5 acceptance core)
    PASSES 5/5
    PROOF: end-to-end real chain (real host -> real helper -> real
           wiring). The single test that closes C2.4-C.
```

The two non-evidence artifacts that make the bridge possible:

```text
apps/vscode/vitest.config.c2-4-c-bridge.ts
  Companion vitest config that adds the resolve.alias for
  @cline-internal/core/... (bypasses the @cline/core bundle
  minifier name-collision) and the server.fs.allow for the SDK
  source path. Loaded only via
  `bun run vitest --config vitest.config.c2-4-c-bridge.ts`.

android/vscode/src/sdk/__tests__/real-local-to-shadow-bridge.c24-c-correction01.test.ts
  Excluded from the base vitest config (lacks the alias) and
  from the base tsconfig.json (lacks the alias paths).
```

## L-rows (File 1) — 7/7 PASS

```
L1   real LocalRuntimeHost.startSession creates a session
L2   run-started on session-A reaches the host listener
L3   execution-state-changed reaches the host listener
L4   tool-started reaches the host listener
L5   tool-finished reaches the host listener
L6   recovery-state-changed reaches the host listener
L7   run-finished reaches the host listener
L8   run-failed reaches the host listener
L9   replacing the host listener disposes the previous fan-out
L10  each agent emit produces exactly one host-listener delivery
L11  two simultaneous subscribers each receive all events
L12  POINT_IN_TIME: subscribing to an empty host is a no-op
```

## C-NAS rows (File 2, COMPONENT TEST) — 4/4 PASS

```
C-NAS-1  pre-session canonical event through the Local-shape
          topology: ZERO host deliveries, ZERO shadow observations.
C-NAS-2  a legitimate 5-event run sequence produces EXACTLY 5
          shadow observations and 0 suppressions.
C-NAS-3  session-replace: the second POINT_IN_TIME subscribe
          walks the snapshot {A, B}; the new wrapper attaches to
          BOTH sets; the helper's sessionId guard filters the
          late A event; only the session-B delivery is admitted.
C-NAS-4  restore-like recovery (runId === undefined, B8 analogue)
          with a matching active session: EXACTLY 1 shadow
          observation. (NOT a no-active-session guard proof; that
          is File 3's C-REAL-4.)
```

## C-REAL rows (File 3, BRIDGE — closes C2.4-C) — 5/5 PASS

```
C-REAL-1  pre-session subscribe -> start session afterward ->
          emit canonical event -> old POINT_IN_TIME subscribe
          still receives zero events; fresh subscribe sees them.
C-REAL-2  fresh subscribe after the session has started -> run
          canonical sequence -> host delivery count == shadow
          observation count exactly.
C-REAL-3  dispose (real uninstall) -> later emit -> shadow delta
          is zero.
C-REAL-4  lifecycle reports no active session -> real host
          delivers canonical event -> wiring boundary drops it
          (BOUNDARY_FAIL_CLOSED end-to-end).
C-REAL-5  package_pin: the `LocalRuntimeHost` constructor used
          here is the production class; the wiring side is the
          production `createTaskShadowHostWiring`. The bridge
          is end-to-end real on both sides.
```

## Production semantic delta

```
ACTUAL_PRODUCTION_SEMANTIC_DELTA   = 0  (no production change)
PERMITTED_PRODUCTION_SEMANTIC_DELTA = N/A
REDUCER_SEMANTIC_DELTA             = 0
PRODUCTION_KEYS_TOUCHED            = 0
```

## Verification

```
git diff --check                                = PASS
sdk/packages/core vitest sweep                 = 170 files, 2103 tests PASS (no regression)
apps/vscode/src/sdk vitest sweep (base config)  = 18 files, 218 tests PASS (no regression)
apps/vscode/src/sdk vitest bridge config (C-REAL) = 5 tests PASS
apps/vscode check-types                        = 22 errors (baseline at 48c6a3c4d;
                                              ZERO new errors from C2.4-C File 3)
sdk/packages/core typecheck (tsconfig.dev)     = 2 errors (baseline at 48c6a3c4d;
                                              ZERO new errors from C2.4-C File 1)
PROTECTED_STASHES_INTACT                       = true
   stash@{1} = FORENSIC ACT-ELM-02C2 (5 files,
              pre-F0-recon-digest:141372c52
              RECOVERED from dropped commit)
```

## Acceptance gate (C2.4-C-CORRECTION01, after review)

```text
REAL_LOCAL_RUNTIME_HOST_OBJECT                = PASS
REAL_LOCAL_TO_SHADOW_CONNECTED_PATH           = PASS
TEST_LOCAL_RUNTIME_STANDIN_ON_CONNECTED_PATH  = false
SUBSCRIBE_BEFORE_SESSION                      = PASS
FUTURE_SESSION_NOT_AUTO_ATTACHED              = PASS
REFRESH_AFTER_SESSION_START                   = PASS
UNSUBSCRIBE                                   = PASS
REAL_HOST_DELIVERY_COUNT == SHADOW_OBSERVATION_COUNT = PASS
TRANSPORT_REACHABILITY_WITH_NO_ACTIVE_SESSION = PASS
BOUNDARY_FAIL_CLOSED                          = PASS
REDUCER_SEMANTIC_DELTA                        = 0
PRODUCTION_SEMANTIC_DELTA                     = 0
```

## Board

```text
C2.3                              ✅ CLOSED
C2.4-A                            ✅ CLOSED / PASS_RECON
C2.4-B                            ✅ CLOSED

C2.4-C
  real LocalRuntimeHost object    ✅ (File 1)
  labeled component test         ✅ (File 2, C-NAS-1..4)
  real-local-to-REAL-wiring      ✅ (File 3, C-REAL-1..5)
  overall                         ✅ CLOSED

C2.4-D HUB/REMOTE                ⛔ NEXT
C2.5 REAL C04 CAPTURE            ⛔
E7 CONSUMER CUTOVER              ⛔
```

## Out-of-scope (next ACTs)

```text
C2.4-D  HUB/REMOTE fallback provenance
        Same C-REAL pattern, applied to the HubTopology shim.
        Plus the regression row for
        `getCanonicalRuntimeAvailable() = false` -> the
        reconstructed-only path that takes the C2.4-B authority
        boundary via `FALLBACK_APPLY` instead of
        `RUNTIME_CANONICAL`.

C2.5    real C04 capture
        The C04 telemetry capture point; not a transport
        question.

E7      consumer cutover qualification
        Out-of-scope of C; the wiring remains observation-only
        (REDUCER_SEMANTIC_DELTA = 0 invariant continues to hold).
```

## Reviewer note (incorporated)

> "I would not close C2.4-C yet. File 1 is valuable and proves a real
>  `LocalRuntimeHost` transport property. The problem is that File 2
>  is explicitly a hand-rolled LocalRuntimeHost shim, so the claimed
>  'real Local transport → production VS Code authority boundary'
>  composition is never actually exercised end-to-end."

Resolved by C2.4-C-CORRECTION01 (File 3, C-REAL-1..5):

```text
REAL_LOCAL_TO_SHADOW_CONNECTED_PATH = PASS
  (real LocalRuntimeHost
   -> real LocalRuntimeHost.subscribeRuntimeEvents
   -> subscribeCanonicalRuntimeEventsToShadow
   -> real TaskShadowHostWiring)
```

C2.4-D is now authorized to start.
