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

apps/vscode/src/sdk/__tests__/real-local-to-shadow-bridge.c24-c-correction01.test.ts
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
apps/vscode check-types:c2-4-c-bridge          = exit 0
                                              (machine-enforced baseline wrapper;
                                              observed 1 diagnostic matching the
                                              frozen baseline file
                                              apps/vscode/baselines/c2-4-c-bridge-ts-baseline.json)
                                              BRIDGE_TEST_TS_ERRORS             = 0
                                              BRIDGE_TYPECHECK_COMMAND_EXIT     = 0
                                              BRIDGE_TYPECHECK                  = PASS
sdk/packages/core typecheck (tsconfig.dev)     = 2 errors (baseline at 48c6a3c4d;
                                              ZERO new errors from C2.4-C File 1)
PROTECTED_STASHES_INTACT                       = true
   stash@{1} = FORENSIC ACT-ELM-02C2 (5 files,
              pre-F0-recon-digest:141372c52
              RECOVERED from dropped commit)
```

## History and re-evaluation

### C2.4-C frozen at `da3fb414d`

Two-file split with REAL `LocalRuntimeHost` topology + hand-rolled
LocalRuntimeHost shim. The reviewer correctly identified that the
seam between real LocalRuntimeHost and real TaskShadowHostWiring was
never exercised end-to-end.

### C2.4-C-CORRECTION01 frozen at `ef00f7ec2`

Three-file split. File 3 is the real LocalRuntimeHost -> REAL wiring
bridge (C-REAL-1..5). Closes the architecture.

### C2.4-C-CORRECTION02 frozen at `5e0ebf428` (test infra)

- Adds `apps/vscode/tsconfig.c2-4-c-bridge.json` (dedicated typecheck
  project for the bridge test, with `@cline-internal/core/...` paths
  and the SDK source `rootDir: "../.."`).
- Adds `apps/vscode/package.json` scripts:
  - `test:vitest:c2-4-c-bridge` — runs the bridge vitest config.
  - `test:vitest:c2-4-c-bridge:watch` — same, watch mode.
  - `check-types:c2-4-c-bridge` — runs the dedicated bridge typecheck.
  - `ci:check-all` now includes `check-types:c2-4-c-bridge` and
    `test:vitest:c2-4-c-bridge` alongside the existing base sweeps.
- Documents R5 (L9 wording: session replacement -> subscription
  replacement) and R6 (event-count wording normalization).
- Fixes R3 (stale "base config untouched" prose in the bridge
  vitest config) and R4 (`android/vscode` -> `apps/vscode` path
  typo in this evidence doc).

The reviewer (test-infrastructure / runtime integration / CI)
flagged that `check-types:c2-4-c-bridge` exited non-zero and the
`ci:check-all` gate therefore was not provably green. C2.4-C's
qualification required either fixing the production error or
introducing a machine-enforced baseline wrapper.

### C2.4-C-CORRECTION03 frozen at `<this commit>` (gate closure)

- Adds `apps/vscode/scripts/check-types-bridge-with-baseline.ts`
  (the wrapper): runs `tsc -p tsconfig.c2-4-c-bridge.json
  --noEmit`, parses the output into (file, line, col, code,
  message) tuples, canonicalizes them, and compares against the
  frozen baseline in
  `apps/vscode/baselines/c2-4-c-bridge-ts-baseline.json`.
  Exits 0 on exact match; exits 1 with ADDED/REMOVED reports
  on any drift.
- Adds `apps/vscode/baselines/c2-4-c-bridge-ts-baseline.json`
  (the frozen baseline): one transitive production error in
  `task-state-shadow.ts(169)` (cannot find `TaskModel`).
- Replaces the raw `tsc` invocation in
  `check-types:c2-4-c-bridge` with the wrapper, so the canonical
  gate is now genuinely green (exit 0).
- Adds `check-types:c2-4-c-bridge:refresh-baseline` for
  intentional baseline updates: runs the wrapper with
  `BRIDGE_BASELINE_UPDATE=1` to rewrite the baseline file.
- Reverts the unrelated em-dash (`\u2014` -> `—`) churn in
  `package.json`'s top-level `description` (R6 hygiene).
- Fixes malformed Markdown fence (R3): the CORRECTION01
  acceptance block's trailing fence is now closed before the
  CORRECTION03 heading begins.
- Updates `.clinerules/sdk-transport-integration.md` to reflect
  Option B (baseline wrapper is the correct pattern) — but the
  rules document remains untracked per user policy.

Production semantic delta: 0. No production source touched.

```
BRIDGE_TYPECHECK_COMMAND_EXIT   = 0
BRIDGE_TEST_CANONICAL_GATE      = PASS
  test:vitest:c2-4-c-bridge     = 5/5 PASS, exit 0
  check-types:c2-4-c-bridge     = exit 0
                                  (wrapper matches frozen baseline)
  ci:check-all invokes both     = yes
MANUAL_ONLY_TEST                = false
```

### C2.4-C-TOOLING-HARDENING frozen at `<this commit>` (defensive)

The CI / build / TypeScript-tooling / runtime-integration reviewer
flagged three wrapper defects in `69788593a`:

- R1 — `runTsc()` ignored `result.error`, `result.signal`, and
  `result.status`. An infrastructure failure producing zero
  parseable diagnostics would have rewritten a baseline to `[]`
  and then passed a future identical failure as `[] == []`.
- R2 — the wrapper's comment claimed `tsc --noEmit` exits with
  the count of errors as the exit code; that is incorrect.
- R3 — ADDED / REMOVED reports compared JSON lines, which can
  fragment a single diagnostic across multiple lines.

The current non-empty baseline already fails closed for ordinary
compiler-launch failure (a zero-diagnostic tool failure would
mismatch the one-entry baseline and exit 1), so this is hardening
not evidence. Folded into a separate small commit immediately
before C2.4-D recon so the wrapper is defensible before reuse
as a general pattern.

- `runTsc()` now throws on `result.error`, `result.signal !== null`,
  or `result.status !== 0` with zero parsed diagnostics. The
  wrapper main catches the throw, logs the failure mode, and
  exits `2` (distinct from `0` clean / `1` drift).
- The incorrect exit-code comment is removed.
- ADDED / REMOVED reports compare whole diagnostic tuples via a
  single `JSON.stringify([file, line, col, code, message])` key.
  Diagnostic records are no longer fragmented across lines.

Production semantic delta: 0. No production source touched.

```
BRIDGE_TYPECHECK_WRAPPER_HARDENING = PASS
  spawn failure / signal / non-diagnostic exit
    → exit 2, baseline UNTOUCHED               = verified
  drift detection (ADDED diagnostic)           = exit 1
  happy path                                   = exit 0
EXIT_CODE_DISTINCTION
  0  = clean (observed diagnostics == baseline)
  1  = drift  (observed diagnostics != baseline)
  2  = infrastructure failure (tsc did not run cleanly)
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
SCRIPTED_CANONICAL_EVENT_COUNT == SHADOW_OBSERVATION_COUNT = PASS
  (C-REAL-2 / C-REAL-1 second-half asserts that every scripted
   event was observed by the wiring. There is no separate host
   delivery counter in this test; the only route to the wiring
   is via the real host, so the equality stands as the strongest
   claim the bridge test can make without introducing a second
   real-host subscriber.)
TRANSPORT_REACHABILITY_WITH_NO_ACTIVE_SESSION = PASS
BOUNDARY_FAIL_CLOSED                          = PASS
REDUCER_SEMANTIC_DELTA                        = 0
PRODUCTION_SEMANTIC_DELTA                     = 0
```

## Acceptance gate (C2.4-C-CORRECTION02, after test-infra review)

```text
BRIDGE_RUNTIME_TEST                             = 5/5 PASS
BRIDGE_TEST_TS_ERRORS                           = 0
BRIDGE_TYPECHECK_BASELINE                       = 1 (transitive
                                                  production error)
BRIDGE_TYPECHECK_WRAPPER                        = PASS
  apps/vscode/scripts/check-types-bridge-with-baseline.ts
  runs `tsc -p tsconfig.c2-4-c-bridge.json --noEmit`,
  canonicalizes the diagnostic set, and verifies exact match
  against the frozen baseline in
  apps/vscode/baselines/c2-4-c-bridge-ts-baseline.json.
  Exits 0 when the observed diagnostics equal the baseline;
  exits 1 with ADDED / REMOVED reports on any drift.
BRIDGE_TEST_CANONICAL_GATE                      = PASS
  test:vitest:c2-4-c-bridge                    = 5/5 PASS,
                                                    exit 0
  check-types:c2-4-c-bridge                   = exit 0
  ci:check-all invokes both                    = yes
BRIDGE_TYPECHECK_COMMAND_EXIT                   = 0
C2_4_C_VERDICT                                  = CLOSED
C2_4_D_AUTHORIZED                               = true
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
