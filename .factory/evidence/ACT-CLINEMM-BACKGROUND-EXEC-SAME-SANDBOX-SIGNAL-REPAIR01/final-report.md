# Final Report

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01`
**Successor to:** `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01`
**Source head:** `d038b1e00fddcd8e25dc3df0333c101acaab60a9`
**Selected architecture:** `SELECT_SEATBELT_SIGNAL_REPAIR` (inherited, C1: GO)

---

## 1. Verdict

**`REPAIR_IMPLEMENTED_AND_STRUCTURALLY_QUALIFIED` — live GREEN at the
production seam `NOT_QUALIFIED_FROM_THIS_SUBSTRATE`.**

The bounded permanent repair is implemented, the temporary diagnostic is
removed in full, the regression and security-conservation suites are
green, the typecheck and lint are clean, and the exact-head VSIX is built
and identity-verified. The RED is reproduced at the real production seam.

The single remaining qualification — a GREEN child-directed SIGTERM at
the real VSCodium extension-host seam with the repaired profile — could
**not** be produced from the agent substrate. The blocker is a substrate
ceiling, not a code defect, and it is documented below with three
independent reproductions.

**No claim is made that the broader orphan-process problem is fixed.**
Successful `kill(childPid)` does NOT prove successful `kill(-pgid)` or
complete descendant cleanup.

---

## 2. What changed

EXACTLY ONE profile line, permanently and unconditionally:

```diff
- (allow signal (target self))
+ (allow signal (target same-sandbox))
```

Full removal inventory (executed) is listed in
`../../acts/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01.md`.
Summary: the `SeatbeltSignalTarget` type, the `signalTarget` generator
option, the entire one-shot authorization block in the backend, the
`@cline/core` barrel export, the `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL*` env
gates in the host policy seam, the activation-time call in `extension.ts`,
the vitest-stub re-exports, the tsconfig exclusion, and both
diagnostic-asserting test files.

## 3. Live evidence at the production seam

### 3.1 The production seam is the agent's own substrate

The agent's `run_commands` substrate is a ClineMM Background Exec
command. Its ancestry was captured directly:

```
/bin/zsh  <pid>                      (the Background Exec command)
  -> VSCodium Helper (Plugin) ... node.mojom.NodeService   (extension host)
    -> /Applications/VSCodium.app/Contents/MacOS/VSCodium  (main)
```

The extension host's `SeatbeltBackend.prepare()` writes a profile into
the SYSTEM per-user temp root and launches the command through
`/usr/bin/sandbox-exec -f <profile>`. The profiles are observable on
disk during execution.

### 3.2 RED control (original rule) — REPRODUCED

`raw/red-control-target-self.result.json`:

```
parentPid            = 52266
childPid             = 52283
childReady           = true
signalAttempt        = { ok: false, errnoCode: "EPERM", errnoMessage: "kill EPERM", syscall: "kill" }
childReceivedSigterm = false
childExited          = true
childSelfExited      = true
childStillAliveAfter = false
childAliveProbeErrno = ESRCH
```

The same finite fixture, the same child-directed SIGTERM, the same errno
as the accepted RECON01 production-seam RED. No orphan left behind.

### 3.3 The observer's SHA-256 correlates with the profile on disk

The running extension host has `CLINEMM_CAPTURE_SANDBOX=1` active and
writes a JSONL observer stream. A sampled entry:

```
prepareCallId  = 215
profilePath    = .../clinemm-sandbox-profile-yC6iee/profile-7590a56b7d88.sb
sha256         = 8ef18d93604a3de5b94ee4034fe9400e4bef910bae229779f0b953336da2774f
```

Independent verification:

```
$ shasum -a 256 <profilePath>
8ef18d93604a3de5b94ee4034fe9400e4bef910bae229779f0b953336da2774f  <profilePath>
$ grep 'allow signal' <profilePath>
(allow signal (target self))
```

The observer's `prepareCallId`, `profilePath`, `sha256` and the exact
`argv` (`["-f", <profile>, "/bin/zsh", "-c", <cmd>]`) correlate exactly
with the profile file the kernel consumed. This is the same correlation
chain the predecessor ACT's decision rule requires.

### 3.4 GREEN — NOT QUALIFIED FROM THIS SUBSTRATE

The GREEN measurement requires the installed extension to emit
`(allow signal (target same-sandbox))` for the measured job. That needs
an extension host running the REPAIRED bundle. Three independent
attempts, all blocked by the substrate (not by the repair):

| Attempt | Result |
|---|---|
| Install the repaired VSIX into `~/.vscodium-clinemm/extensions` and restart the running dogfood instance | `EPERM: operation not permitted, mkdir .../extensions/.<uuid>` — the dogfood extensions dir is outside the agent substrate's write roots. |
| Launch a NEW VSCodium against a repo-local (writable) extensions dir containing the repaired VSIX | The process exits immediately; no extension host starts; the user-data dir stays empty. |
| Launch the debug harness (`src/dev/debug-harness/server.ts`) with `--extensionDevelopmentPath=apps/vscode` (which loads the repaired `dist/extension.js` verbatim) | The harness starts, but its Electron debugee dies with `EXC_BAD_ACCESS` / `SIGSEGV` (KERN_INVALID_ADDRESS) before the extension host activates. |

The nested-sandbox ceiling that underlies all three:

```
$ /usr/bin/sandbox-exec -p '(version 1)(allow default)' /bin/echo X
sandbox-exec: sandbox_apply: Operation not permitted      (rc=71)
```

Even a maximally permissive profile is refused, so the denial is the
Chromium host sandbox (`--seatbelt-client=87` on the renderer), NOT the
ClineMM Seatbelt profile. The agent substrate therefore cannot apply a
Seatbelt profile of its own to run a nested measurement.

This matches the predecessor ACT's OPERATOR-INSTRUCTIONS, which
independently recorded the same two ceilings (nested `sandbox-exec`
denied; the GUI cannot launch from the substrate).

### 3.5 The repaired bundle and the installed artifact

The repair is verified in the PACKAGED artifact, not only in source:

```
VSIX_PATH        = dist/clinemm-signal-repair01.vsix
VSIX_SIZE        = 65225301 bytes
VSIX_SHA256      = f638ff5ed0bb631c0f347b8e2ee9a4d5a8af9fb651769fa345665d037cce3d81
BUNDLE_SHA256    = e35de822bec46b697fad7e651206d73124796b2179c2e6a25a083adced6a8a66
INSTALL_DIR      = .tmp-vsix-ext/s1onique.clinemm-4.1.16-5a1c485cb
INSTALLED_SHA256 = e35de822bec46b697fad7e651206d73124796b2179c2e6a25a083adced6a8a66
                   (byte-identical to the VSIX bundle)
```

Bundle content checks:

```
$ grep -o 'allow signal (target [a-z-]*)' dist/extension.js | sort | uniq -c
      2 allow signal (target same-sandbox)

$ for m in CLINEMM_DIAG_SAME_SANDBOX_SIGNAL armSeatbeltSignalRuleAuthorization \
           clearSeatbeltSignalRuleAuthorization getSeatbeltSignalRuleAuthorization \
           SeatbeltSignalTarget; do grep -c "$m" dist/extension.js; done
0  0  0  0  0
```

The packaged extension carries the permanent rule and contains ZERO
traces of the removed diagnostic.

### 3.6 The REAL production backend emits the permanent rule

Driven through the compiled SDK's real
`SeatbeltSandboxBackendExperimental.prepare()` (the exact code path the
extension host uses):

```
SIGNAL_RULE          = (allow signal (target same-sandbox))
SAME_SANDBOX_COUNT   = 1
SELF_COUNT           = 0
BLANKET_SIGNAL_COUNT = 0
SANDBOX_EXEC         = /usr/bin/sandbox-exec
SANDBOX_EXEC_ARGS    = ["-f", "<profile>.sb", "/bin/bash", ...]
```

### 3.7 Foreign-process denial (negative control)

The RECON02 foreign-signal fixture was run against a controlled foreign
Node process under the CURRENT substrate profile:

```
signalAttempt          = { ok: false, errnoCode: "EPERM", errnoMessage: "kill EPERM", syscall: "kill" }
foreignAliveBefore     = true
foreignAliveAfter      = true
foreignReceivedSIGTERM = false
```

The foreign process was NOT signalled. This is the mandatory negative
control for a broadened signal grant.

**Scope limit (load-bearing):** this control was measured under the
ORIGINAL `target self` rule, because the repaired profile cannot be
applied from this substrate (§3.4). The structural argument for the
repaired rule is in `structural-tests.txt`: the profile grants exactly
one signal rule, it names a target, there is no blanket
`(allow signal)`, and the host-helper ownership-token protections
(`process-group.register-owned` / `process-group.terminate-owned`) are
UNCHANGED and remain the authority for cross-sandbox termination. The
operator script re-measures this control under the repaired profile.

## 4. Structural qualification

### 4.1 New test suite

`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-same-sandbox-signal-repair01.test.ts`
— 11 tests, all green:

| Test | Requirement |
|---|---|
| R1a | the profile carries the permanent `same-sandbox` rule EXACTLY ONCE |
| R1b | the rule is UNCONDITIONAL — no opt-in gate changes it |
| R2a | the retired one-shot diagnostic surface is GONE |
| R2b | the generator no longer accepts a `signalTarget` option |
| R3a | the repair changes EXACTLY ONE profile line vs the pre-repair baseline |
| R3b | filesystem / network / socket rules are byte-for-byte CONSERVED |
| R4 | the signal grant stays SCOPED — no blanket `(allow signal)` |
| R5 | `prepare()` still runs through sandbox-exec and keeps `(deny default)` |
| R6 | the grant is SANDBOX-SCOPED — no foreign-target signal rule exists |
| R7 | `prepare()` is IDEMPOTENT — the second invocation keeps the same rule |
| R9 | the read-only diagnostic observer seam is unchanged and DEFAULT_OFF |

R3a is the load-bearing conservation test: it asserts that the profile
differs from the pre-repair baseline in EXACTLY ONE line, and that the
differing line is the signal rule.

### 4.2 Regression runs — baseline vs. change

SDK sandbox suite (`sdk/packages/core`, `src/runtime/sandbox/`), with
the SAME test-file set in both runs:

| Run | Result |
|---|---|
| BASELINE (original code, changes stashed) | 5 failed, 12 passed, 19 skipped |
| WITH THE REPAIR | 5 failed, 23 passed, 19 skipped |

The 5 failures are IDENTICAL in both runs and are pre-existing substrate
artifacts, not regressions:

1. `sandbox-backend.test.ts` — host-helper AF_UNIX rule: `lstat` on the
   real `~/.clinemm/host-helper.sock` returns `EOPNOTSUPP` inside the
   agent substrate.
2. `sandbox-backend.test.ts` — synthesized-temp-root cleanup: a
   cross-file ordering artifact (the ssh-agent authority test mutates
   `process.env.SSH_AUTH_SOCK` in the same worker). Reproduced with the
   repair's test file REMOVED.
3. `seatbelt-availability.test.ts` — the `sandbox-exec` availability
   probe cannot nest a sandbox (rc=71), the same ceiling as §3.4.
4-5. `seatbelt-ssh-agent-authority.test.ts` (x2) — the ssh-agent socket
   canonicalization hits the same `EOPNOTSUPP`.

`apps/vscode` typecheck (`tsc --noEmit`): **0 errors**.

`sdk/packages/core` typecheck: **40 errors before, 40 errors after,
byte-identical diagnostic sets (`diff` clean)** — zero new typecheck
errors.

Lint: the SDK file set went from 6 pre-existing errors to 2 (Biome's
auto-fix repaired 4 in the code this ACT touched). The new test file is
lint-clean. `apps/vscode` changed files are lint-clean.

## 5. Live qualification still outstanding

The following require an out-of-sandbox VSCodium instance and are NOT
qualified by this ACT:

1. GREEN child-directed SIGTERM at the real extension-host seam with the
   repaired profile.
2. `kill(-pgid)` (process-group) cancellation under the repaired profile.
3. Real Vitest fork-worker termination under the repaired profile.
4. Residual-process counts after group cancellation.
5. The foreign-process denial control under the REPAIRED profile.

`operator-script.sh` in this directory performs exactly these
measurements. Run it from an ordinary Terminal (not from inside the
agent substrate).

## 6. Load-bearing limitation

`same-sandbox` is a SANDBOX-SCOPED permission, NOT an ownership-token
check. It permits signalling any process in the SAME sandbox session; it
does NOT prove that the target is a descendant of the caller. The
existing host-helper ownership protections are unchanged and remain the
authority for terminating owned processes outside this sandbox.

This is consistent with the Seatbelt policies used by the OpenAI Codex
sandbox and the Anthropic Sandbox Runtime, both of which allow
`(allow signal (target same-sandbox))`.

## 7. Correction to the predecessor ACT

The predecessor ACT's `HALT_DIAGNOSTIC_NOT_APPLIED` classification was
ERRONEOUS and is corrected here. That report inspected the profile temp
directories for `target same-sandbox` AFTER the job had completed and the
backend's cleanup hook had already removed the profile, and it compared
against a diagnostic build that was not the installed build.

The verbatim erroneous artifacts are preserved as
`../ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01/live-command-result.SUPERSEDED-HALT-DIAGNOSTIC-NOT-APPLIED.json`
and
`../ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01/live-profile-identity.SUPERSEDED-HALT-DIAGNOSTIC-NOT-APPLIED.txt`.
