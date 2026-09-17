# ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01

## C2 FINAL ASSESSMENT (post-C2-P1 fix + C2-P2 hygiene)

### EPISODE SUMMARY

C2 has been closed CLEAN with all reviewer-specified stop-point
proofs GREEN. The bounded wiring is complete: the sandbox
abstraction now governs the production command-execution seam
behind the explicit `CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt` opt-in,
with full fail-closed semantics on substrate unavailability and
prepare failure, and ALL six prepared-invocation fields
(executable, argv, cwd, env, envSemantics, input, cleanup) reach
the production `node:child_process.spawn` call.

### C2-P1 FIX (reviewer-identified bounded contract defect)

Symptom: `prepared.cwd` reached the production executor but was
ignored at the supervisor call site; `options.cwd` reached spawn()
instead. Node's spawn({ cwd }) is the actual working directory
of the spawned child, not metadata. For Seatbelt, where the
backend canonicalizes cwd in prepare() (e.g. /tmp/... ->
/private/tmp/...), this would silently drop the canonicalization.

Fix (apps/vscode/src/sdk/command-job-manager.ts):
  let spawnCwd: string = options.cwd
  ...
  if (sandboxMode !== undefined) {
    ...
    spawnCwd = prepared.cwd
    ...
  }
  ...
  spawnSupervisableShellCommand({ ..., cwd: spawnCwd, ... })

Real production seam proof (new describe block):
  "real production seam: prepared cwd reaches the spawned child"
  Test 1: pwd reports backend's cwd (NOT caller's) when stub
    backend returns a different prepared.cwd. Proves end-to-end
    through real supervisor + real spawn().
  Test 2 (DEFAULT_OFF conservation): pwd reports caller's cwd
    when no opt-in is set, proving the legacy path is unchanged.

Proof the test catches the defect: I reverted the C2-P1 fix
momentarily and the new test failed with `pwd` reporting the
caller's cwd. Restored, test passes.

### C2-P2 HYGIENE FIX (non-blocking but bundled here)

Symptom: `sandboxCleanup` was attached to the job only after
`spawnSupervisableShellCommand()` returned. If the supervisor
threw synchronously after a successful prepare(), the cleanup
hook could be lost (profile temp dir leak).

Fix: wrapped spawnSupervisableShellCommand in try/catch:
  let childProcess
  try { childProcess = spawnSupervisableShellCommand(...) }
  catch (err) {
    if (sandboxCleanup) void sandboxCleanup().catch(() => {})
    throw err
  }

### EVIDENCE-LABEL CORRECTION

Renamed the "structural spawn binding (DI seam)" describe block
to "backend prepared invocation reaches the supervisor (structural)"
to make explicit that the DI captures what the SUPERVISOR was
given (the prepared invocation forwarded by CommandJobManager),
not what `node:child_process.spawn` was given downstream. The
runtime `pwd` cwd tests are now in a clearly-labeled "real
production seam" describe block.

### FILES

MODIFIED:
  apps/vscode/src/sdk/command-job-manager.ts
    + spawnCwd variable + prepared.cwd assignment
    + try/catch around spawnSupervisableShellCommand (C2-P2 hygiene)

  apps/vscode/src/sdk/command-job-manager.sandbox-integration.test.ts
    + 2 new tests in "real production seam" describe block
    + label correction on the structural describe block
    + 14 tests total (was 12)

No new files in this round; all changes are inside the
existing C2 surface.

### STOP-POINT CHECKLIST (per reviewer spec)

  prepared executable       honored
  prepared argv             honored
  prepared cwd              honored     [C2-P1 fix]
  prepared env              honored
  prepared envSemantics     honored
  prepared input            honored
  prepared cleanup          wired       [C2-P2 hygiene]

  envSemantics production consumption      GREEN
  actual sandbox-exec route                GREEN
  unavailable backend                      FAIL-CLOSED
  prepare failure                          FAIL-CLOSED
  no unsandboxed retry                     PROVEN
  kernel write defense                     DEFERRED to dogfood/C3
  DEFAULT_OFF                              IDENTICAL
  supervision                              CONSERVED
  command policy                           UNCHANGED
  parser helper                            UNCHANGED

### TEST COVERAGE (14 / 14 PASS)

describe("DEFAULT_OFF conservation (C2 invariance)"):
  ✓ no sandbox opt-in: seeded parent env var reaches the child (7ms)
  ✓ invalid opt-in value: still DEFAULT_OFF (5ms)

describe("env proof: experimental opt-in honors envSemantics=complete end-to-end"):
  ✓ with seatbelt opt-in on darwin, CLINEMM_PRODUCTION_TEST_LEAK_VAR absent in actual child stdout (29ms)
  ✓ with seatbelt opt-in on darwin, AWS_SECRET_ACCESS_KEY absent in actual child stdout (12ms)

describe("backend prepared invocation reaches the supervisor (structural)"):
  ✓ with seatbelt opt-in, the prepared invocation's executable replaces the original (2ms)
  ✓ prepared envSemantics=complete is honored end-to-end (structurally) (2ms)

describe("real production seam: prepared cwd reaches the spawned child"):
  ✓ with seatbelt opt-in + backend returning a different cwd, `pwd` reports the backend's cwd (5ms)
  ✓ DEFAULT_OFF (no opt-in): supervisor uses caller's cwd unchanged (4ms)

describe("fail-closed: substrate unavailable"):
  ✓ resolver returns undefined: command is not executed (spawn_failed) (0ms)
  ✓ real substrate unavailable on non-darwin: command is not executed (0ms)

describe("fail-closed: prepare failure"):
  ✓ backend.prepare throws SandboxError: command is not executed (spawn_failed) (0ms)
  ✓ backend.prepare throws arbitrary Error: still fail-closed (0ms)

describe("wiring sanity"):
  ✓ resolver is invoked exactly once per start() when opt-in is set (2ms)
  ✓ resolver is NOT invoked when opt-in is absent (4ms)

### GATE TESTS

  apps/vscode unit suite:                 1076 / 1076 passed (0 regressions)
  SDK (@cline/core) unit suite:          3039 / 3039 passed (16 skipped)
  CommandJobManager baseline:               20 / 20 passed
  typecheck (apps/vscode):                  0 errors
  git diff --check:                        clean

### VERDICT

  PASS_SANDBOX_PRODUCTION_OPTIN_INTEGRATION
  C2_CLOSED_CLEAN_WITH_P1_FIX_AND_P2_HYGIENE

  C3 may proceed: production-seam kernel write-deny discriminator,
  stdout/stderr/exit + cancellation conservation, exact-head VSIX,
  artifact identity bind, sandbox DEFAULT_OFF.

  NEXT: ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD01 (after C3 packaging)
