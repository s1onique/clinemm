ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01
===========================================================
EXECUTION-SEAM INVENTORY (C1 recon)
===========================================================

This is the load-bearing production path the ACT must wire through.
Confirmed by grep across apps/vscode and sdk/packages/core (excluding
dist, generated, and node_modules).

═══════════════════════════════════════════════════════════════════════
THE ONE BACKGROUND COMMAND PATH (in scope)
═══════════════════════════════════════════════════════════════════════

Entry:    `run_commands` tool
          apps/vscode/src/sdk/vscode-run-commands-tool.ts:560
            createShellTool(createVscodeShellExecutor(...))

Dispatch: createVscodeShellExecutor
          apps/vscode/src/sdk/vscode-run-commands-tool.ts:577
            if (executionMode === "backgroundExec") { ... }

Owner:    CommandJobManager
          apps/vscode/src/sdk/command-job-manager.ts:411

Spawn:    CommandJobManager.start()
          apps/vscode/src/sdk/command-job-manager.ts:441
            spawnSupervisableShellCommand(
              { executable, args, cwd, env, input },  // config
              { maxOutputChars, combineOutput },       // options
            )

Supervisor:
          spawnSupervisableShellCommand
          sdk/packages/core/src/extensions/tools/executors/bash.ts:679

          Inside it -> buildShellProcess (bash.ts:203):
            spawn(config.executable, config.args, {
              cwd: config.cwd,
              env: { ...process.env, ...config.env },   <-- LOAD-BEARING MERGE
              stdio: ["pipe","pipe","pipe"],
              detached: !isWindows,
              windowsHide: true,
            })

Cancellation:
          CommandJobManager.terminate() (command-job-manager.ts:~570)
            -> SupervisableShellProcess.terminateTree({graceMs,signal})
            -> killProcessTree(child.pid, ...)
          Plus deadlineTimer and context.signal abort listener.

stdout/stderr:
          SupervisableShellProcess.stdoutSnapshot/stderrSnapshot
          Aggregated by CommandJobManager.snapshot().

═══════════════════════════════════════════════════════════════════════
FOREGROUND (out of scope)
═══════════════════════════════════════════════════════════════════════

Foreground mode uses VscodeTerminalManager (the user's VS Code
terminal). The user controls it directly via shell integration; it
has a different trust/UX boundary. This ACT explicitly does NOT
touch it.

Documented boundary (will be repeated in C2/C3 evidence):

  background managed command path:  IN SCOPE
  foreground user's VSCodium terminal: OUT OF SCOPE

═══════════════════════════════════════════════════════════════════════
SECOND BACKGROUND PATH CHECK (HALT_EXECUTION_SEAM_FRAGMENTED)
═══════════════════════════════════════════════════════════════════════

Searched for ALL spawnSupervisableShellCommand call sites in
apps/vscode + sdk/packages/core (excluding dist/, generated/):

  apps/vscode/src/sdk/command-job-manager.ts:441      <-- the only one in VSCode production
  apps/vscode/src/test/cline-core-vitest-stub.ts       <-- test stub only
  sdk/packages/core/src/extensions/tools/executors/bash.ts:679  <-- the definition
  sdk/packages/core/src/extensions/tools/executors/bash.supervised.test.ts   <-- 9 test cases
  sdk/packages/core/src/extensions/tools/executors/index.ts   <-- barrel export
  sdk/packages/core/src/extensions/tools/index.ts             <-- barrel export
  sdk/packages/core/src/index.ts                              <-- barrel export

Result: EXACTLY ONE production background command path in ClineMM.
No fragmentation. No halt.

The CommandJobManager also has 20 it() tests in
command-job-manager.test.ts. These exercise the real production seam
via spawnSupervisableShellCommand, so they remain the load-bearing
test substrate for C2.

═══════════════════════════════════════════════════════════════════════
LOAD-BEARING ENV-MERGE SITES
═══════════════════════════════════════════════════════════════════════

There are TWO `env: { ...process.env, ...config.env }` literals in
the SDK bash executor:

  1. bash.ts:217   inside buildShellProcess
                   used by spawnSupervisableShellCommand
                   <-- IN SCOPE for this ACT

  2. bash.ts:458   inside spawnAndCollect
                   used by createShellExecutor (the foreground tool
                   surface in SDK, called from CLI / agents not VSCode
                   backgroundExec)
                   <-- NOT touched in this ACT; documented separately
                       in deferred scope.

For #1 (this ACT's integration target), the supervisor must learn
to honor a typed envSemantics metadata. The change is intentionally
minimal: thread an optional envSemantics parameter through:

  spawnSupervisableShellCommand(config, options) -> SupervisableShellProcess
      \-> buildShellProcess(config, ...) -> spawn(...)

Backward-compatibility: envSemantics defaults to "overlay" (legacy
behavior). Existing callers (9 SDK bash.supervised tests, 20
CommandJobManager tests, the production CommandJobManager.start call)
continue to spread process.env underneath unless they explicitly opt in.

═══════════════════════════════════════════════════════════════════════
CAPABILITY-DERIVATION POLICY (read-only Wave-1)
═══════════════════════════════════════════════════════════════════════

The current abstraction supports:
  - readonlyRoots:   explicit write-deny regions (load-bearing)
  - writableRoots:   explicit write grants (positive allowlist)
  - denyReadSubpaths: read-confidentiality boundary (load-bearing)
  - network:         allow | deny
  - environment:     mode (inherit|sanitized) + allow list

For the integration ACT we need a bounded capability builder that
yields an APPROPRIATE Wave-1 capability for read-only dogfood. We do
NOT enumerate every command class (deferred to dogfood). The Wave-1
shape, derived from the recon's actual production conditions:

  - cwd: current canonical cwd (per-invocation)
  - readonlyRoots: [workspace root, ...]  // write-deny regions
  - writableRoots: []                    // no writes in Wave-1
  - denyReadSubpaths: []                 // no read deny in Wave-1
                                           (broad read allow + workspace
                                           being inside read allow = OK
                                           for read-only commands; read
                                           confidentiality is a later
                                           concern if user data is outside
                                           the workspace.)
  - network: "deny"                      // explicit deny for Wave-1
  - environment.mode: "sanitized"        // CORRECTION01-P1 contract
  - environment.allow: SAFE_ENVIRONMENT_BASELINE
                                         // precomputed allowlist

This is the MINIMUM capability needed to validate the production
seam. We do NOT enumerate denyReadSubpaths in this ACT; the
dogfood ACT will discover which subpaths the policy needs to deny.

═══════════════════════════════════════════════════════════════════════
SCOPE VERIFICATION (HALT conditions not triggered)
═══════════════════════════════════════════════════════════════════════

  HALT_UNEXPECTED_TRACKED_DIRT         NOT TRIGGERED (entry-freeze clean)
  HALT_EXECUTION_SEAM_FRAGMENTED      NOT TRIGGERED (exactly one bg path)

Conclusion: proceed to RED characterization.
