# Production Seam — Authority Map

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01`
**Classification:** `STRUCTURAL` (source inspection at ENTRY_HEAD) + `REAL_PRODUCTION_SEAM` (accepted E1/E2)

---

## The chain under test

```
VSCodium (Electron)
  └── Extension Host (Chromium zygote sandbox inherited, --enable-sandbox)
       └── apps/vscode/src/extension.ts  activate()
            └── VscodeSessionHost / SdkController
                 └── VscodeRunCommandsTool  (executionMode === "backgroundExec")
                      └── CommandJobManager.start({ command })
                           └── defaultSandboxBackendResolver()          [sandbox-policy.ts]
                                └── SeatbeltSandboxBackendExperimental.prepare()
                                     └── generateSeatbeltProfile()       [seatbelt-profile.ts:684]
                                     └── writeFileSync(profilePath)      [seatbelt-backend.ts:678]
                                     └── prepared.args = ["-f", profilePath, ...]
                                └── spawnFactory(...)                    [command-job-manager.ts:2257]
                                     └── spawnSupervisableShellCommand() [bash.ts:1007]
                                          └── spawn(executable, args, { detached: true })
                                               └── /usr/bin/sandbox-exec -f <profile> /bin/bash -c <cmd>
                                                    └── Node parent
                                                         └── Node child
                                                              ↑ SIGTERM
```

## Authority map (all eight required answers)

| # | Question | Answer (file:line at ENTRY_HEAD) |
|---|---|---|
| 1 | Who controls the diagnostic opt-in? | Trusted extension-host code: `apps/vscode/src/sdk/sandbox-policy.ts` → `resolveSameSandboxDiagnosticOptIn(env)` / `armSameSandboxDiagnosticIfOptedIn(env)`, invoked once from `apps/vscode/src/extension.ts` `activate()` (earliest seam). The gate reads the extension host's OWN process env — never command text/args/stdout and never the `run_commands` env. |
| 2 | How is the one diagnostic command identified? | By an EXACT canonical command identity: `executable` + the FULL argv array, declared by the operator as JSON in `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL_COMMAND`. At the production seam this is `["/bin/bash", "-c", "<exact command text>"]` (`getShellInvocation("/bin/bash", cmd)` → `args: ["-c", cmd]`, `sdk/packages/shared/src/parse/shell.ts:418`). |
| 3 | Which function selects the signal rule? | `generateSeatbeltProfile()` in `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:698` — the `signalTarget` option selects the rule line. DEFAULT `"self"`. The selector value is resolved by `resolveSignalTargetForInvocation(cmd)` in `seatbelt-backend.ts:299`. |
| 4 | Which function writes the final profile bytes? | `SeatbeltSandboxBackendExperimental.prepare()` → `writeFileSync(profilePath, profile, { mode: 0o600 })` at `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:678` (post-change line numbers). |
| 5 | Which process calls `spawn()`? | `spawnSupervisableShellCommand()` in `sdk/packages/core/src/extensions/tools/executors/bash.ts:1007` → `spawn(config.executable, config.args, { cwd, env, stdio, detached: !isWindows })`. Reached from `CommandJobManager.start()` via `this.spawnFactory(...)` (`apps/vscode/src/sdk/command-job-manager.ts:2257`). |
| 6 | Which profile path reaches `/usr/bin/sandbox-exec`? | `prepared.args[1]`, where `prepared = { executable: "/usr/bin/sandbox-exec", args: ["-f", profilePath, cmd.executable, ...cmd.args] }` (`seatbelt-backend.ts:746`). The SAME `profilePath` is the file written in step 4. |
| 7 | How does command output reach the SDK job result? | `spawnSupervisableShellCommand` collects stdout/stderr into rolling collectors; `CommandJobManager` exposes them via `StartCommandJobResult.stdout` / `.stderr` / `.state` / `.exitCode` / `.signal`; `VscodeRunCommandsTool` renders them into the tool result. |
| 8 | Where is process cleanup expected to occur? | `prepared.cleanup` (removes the profile temp dir + the synthesized temp root, `seatbelt-backend.ts:758`) is attached to the job and invoked on the job's terminal transition; process-tree termination lives in `spawnSupervisableShellCommand`'s `killProcessTree()` and in `CommandJobManager.cancel()`. The host helper's `process-group.register-owned` / `process-group.terminate-owned` primitive backs the EPERM fallback (`command-job-manager.ts:2301`). |

---

## Source-level confirmation of the RECON01 anchors

| Anchor | Verified at ENTRY_HEAD | Result |
|---|---|---|
| `seatbelt-profile.ts` `generateSeatbeltProfile()` ≈ line 684 | line 684 | CONFIRMED |
| `seatbelt-profile.ts` signal rule ≈ line 700 | line 700 — `(allow signal (target self))` | CONFIRMED |
| `seatbelt-backend.ts` `prepare()` invokes the generator and creates a temp `.sb` profile | lines 642 (generator), 661 (`mkdtempSync`), 672–678 (`.sb` path + write) | CONFIRMED |
| `seatbelt-backend.ts` existing `onProfileWritten` / `onInvocationPrepared` observers | lines 697 / 777 (read-only, `safeInvokeObserver`) | CONFIRMED |
| `command-job-manager.ts` `backend.prepare()` invocation + prepared-command binding | lines 2184 (prepare), 2229–2245 (binding of executable/args/cwd/env/envSemantics/cleanup) | CONFIRMED |
| `bash.ts` `spawnSupervisableShellCommand()` uses `spawn()` with `detached: !isWindows` | `bash.ts:1007` + `1011` | CONFIRMED |

## Existing process-free test inventory (regression surface)

| Area | File | Count |
|---|---|---|
| Profile generation | `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.test.ts` | 40 tests |
| Profile preparation / backend | `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.test.ts` | 25 tests (19 platform-skipped) |
| Invocation binding / env materialization | `apps/vscode/src/sdk/command-job-manager.sandbox-integration.test.ts`, `apps/vscode/src/sdk/sandbox-policy-production-composition.test.ts` | present |
| Diagnostic observer (read-only) | `apps/vscode/src/sdk/__tests__/seatbelt-network-live-downstream-recon01.c1-observer.test.ts` | present |
| **NEW (this ACT)** | `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-same-sandbox-discriminator01.test.ts` | 11 tests |
| **NEW (this ACT)** | `apps/vscode/src/sdk/__tests__/same-sandbox-production-discriminator01.policy.test.ts` | 10 tests |

## Inherited Chromium sandbox evidence

The extension host is launched as:

```
/Applications/VSCodium.app/Contents/MacOS/VSCodium
  --user-data-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data
  --extensions-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions
```

with `CLINEMM_RUNTIME_PROFILE=dogfood` and `CLINE_DATA_DIR=/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data` in the launch environment, and the utility (extension-host) child carries `--service-sandbox-type=none --enable-sandbox` (the Chromium zygote sandbox IS active on the extension host).

The extension host's `TMPDIR` is the SYSTEM per-user temp root
(`/var/folders/.../T/`), NOT a `clinemm-sandbox-temp-*` directory — proving the
extension host is NOT itself inside a ClineMM Seatbelt profile, i.e. it
inherits the Chromium authority without the ClineMM authority.

**INFERRED** (not measured by this ACT): the composition of the Chromium
zygote sandbox with the ClineMM Seatbelt profile is what the live
experiment measures.
