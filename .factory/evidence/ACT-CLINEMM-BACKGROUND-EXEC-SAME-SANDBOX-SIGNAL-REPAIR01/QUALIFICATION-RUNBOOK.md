# ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01 — Bounded Qualification Runbook

**Status:** `HALT_UNSAFE_OPERATOR_QUALIFICATION` correction prepared.
**Production source:** unchanged; preserve commits `d038b1e00` and `487a80ef7`.
**Old procedure:** `operator-script.sh` is quarantined and exits 127. Do not run it.

## Why this procedure exists

The permanent production change remains:

```diff
- (allow signal (target self))
+ (allow signal (target same-sandbox))
```

The review accepted the production repair but rejected the old all-in-one
operator script because it:

1. ran the claimed production GREEN directly from an ordinary Terminal;
2. quit VSCodium application-wide, risking unrelated instances;
3. launched unbounded / foreign fixtures without the repaired sandbox;
4. killed a recorded PID without a fresh identity check; and
5. continued after prerequisite failures.

This runbook replaces that procedure with a staged, fail-closed measurement.
It does **not** claim `PASS_LIVE_PERMANENT_REPAIR` until the installed
permanent build completes the production GREEN and the observer correlation.

## Safety invariants

* Target only the dogfood instance whose argv contains
  `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data`.
  Never use `osascript -e 'quit app "VSCodium"'`; never quit the application.
* Identify the extension host as the child of that instance's main PID whose
  argv is `VSCodium Helper (Plugin)` with `node.mojom.NodeService`. Do not use
  `pgrep -f 'extensionHost|extension-host'`.
* Every production measurement is issued from the installed ClineMM
  **Background Exec** path. The Terminal is used only for artifact identity,
  bounded fixture orchestration, and observation.
* Every fixture has an independent finite lifetime. No infinite-loop child.
* Every signal is preceded by PID + argv + process start-identity verification.
* `kill(pid, 0)` returning `EPERM` means **exists but unverifiable**, never gone.
* No process-count heuristic, global `pkill`, application-wide quit, or
  indiscriminate PID kill is permitted.

## Phase 0 — preflight (Terminal)

```bash
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-qualification.sh preflight
```

This proves the dogfood instance and its Plugin extension host exist and that
the extension host belongs to the operator. It writes
`raw/dogfood-instance-identity.txt`. Any failure aborts before a fixture starts.

If the dogfood instance was not launched with the observer knobs, restart only
that instance with these environment variables (no other instance changes):

```bash
CLINEMM_RUNTIME_PROFILE=dogfood \
CLINEMM_CAPTURE_SANDBOX=1 \
CLINEMM_CAPTURE_SANDBOX_RUN_ID=repair01-qualification \
/Applications/VSCodium.app/Contents/MacOS/VSCodium \
  --user-data-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data \
  --extensions-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions \
  /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
```

## Phase 1 — install the exact permanent VSIX

```bash
bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-qualification.sh install
```

The script installs only into the dogfood extensions directory and requires the
installed bundle SHA-256 to equal:

```text
e35de822bec46b697fad7e651206d73124796b2179c2e6a25a083adced6a8a66
```

It also requires the permanent `same-sandbox` rule and zero retired diagnostic
markers. A mismatch aborts before any fixture is launched.

Reload only the dogfood VSCodium window so the installed bundle is active, then
run:

```bash
bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-qualification.sh identity
```

This proves the active dogfood extension host has the observer enabled with run
id `repair01-qualification`.

## Phase 2 — production GREEN through Background Exec

In the dogfood ClineMM chat, select **Background Exec** mode (not Terminal
mode), then issue exactly:

```text
/opt/homebrew/bin/node /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01/probe-fixtures/same-sandbox-probe.mjs
```

Save the tool output containing `SAME_SANDBOX_RESULT_JSON=...` verbatim to
`raw/production-green.result.json` and the complete tool output to
`raw/production-green.stdout`.

The GREEN gate is:

* `signalAttempt.ok == true`;
* `childReceivedSigterm == true`;
* `childExited == true`;
* `childStillAliveAfter == false`; and
* `childAliveProbeErrno == "ESRCH"`.

The fixture child has an independent four-second self-exit deadline, so a
denied signal cannot leave an orphan.

## Phase 3 — correlate the observer JSONL

```bash
bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-qualification.sh collect
```

In the collected observer stream, find the `prepareCallId` whose
`onInvocationPrepared.argv` contains the exact Phase 2 command. For that same
`prepareCallId`, record:

* `onPrepareInput.commandExecutable` (`/bin/zsh` at the production seam);
* `onProfileWritten.profilePath` and `sha256`;
* `onInvocationPrepared.executable` (`/usr/bin/sandbox-exec`); and
* `onInvocationPrepared.argv` (`-f`, profile path, shell, `-c`, exact command).

The observer's profile path must equal `profilePathFromArgv`. The profile must
contain `(allow signal (target same-sandbox))` and must not contain
`(allow signal (target self))` as the active signal rule. If the profile temp
file has already been removed, the observer SHA-256 is the durable profile
identity; preserve the observer lines rather than guessing from a directory
listing.

## Phase 4 — PGID cancellation (separate Background Exec measurement)

Issue exactly this in Background Exec mode:

```text
/opt/homebrew/bin/node /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/probe-fixtures/pgid-cancellation-fixture.mjs
```

Save the `PGID_RESULT_JSON=...` line to `raw/pgid.result.json`.

The PGID gate is:

* `signalAttempt.ok == true`;
* `groupStateBefore.state == "alive"`;
* `groupStateAfter.state == "gone"` (only `ESRCH` means gone; `EPERM` means
  alive); and
* the final group state is `gone`.

The child self-exits after six seconds. If the group survives, the fixture
performs an identity-checked direct SIGKILL; it never signals a reused PID.

## Phase 5 — foreign-process denial (separate Background Exec measurement)

Start the finite foreign target from the Terminal:

```bash
bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-qualification.sh foreign-start
```

Read `raw/foreign-target.pid`. Immediately, in the dogfood ClineMM chat in
**Background Exec** mode, issue exactly:

```text
/opt/homebrew/bin/node /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/probe-fixtures/foreign-signal-attempt.mjs <FOREIGN_PID> /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/raw/foreign-target.log
```

Substitute only the recorded decimal PID. Save the tool output containing
`FOREIGN_SIGNAL_RESULT_JSON=...` to `raw/foreign.result.json`.

The foreign-denial gate is:

* `signalAttempt.ok == false` with errno `EPERM`;
* `foreignAliveAfter == true`; and
* `foreignReceivedSIGTERM == false`.

Then stop and verify the target from the Terminal:

```bash
bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-qualification.sh foreign-stop
```

The cleanup stage re-checks PID, argv, and start identity before signaling and
requires a verified `GONE` state. `EPERM` is never accepted as cleanup.

## Phase 6 — Vitest worker teardown (separate bounded measurement)

From the dogfood ClineMM chat in **Background Exec** mode, issue exactly:

```text
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core && /opt/homebrew/bin/node node_modules/.bin/vitest run --config vitest.config.ts src/runtime/sandbox/macos/seatbelt-same-sandbox-signal-repair01.test.ts
```

Save the output to `raw/vitest.stdout`. The gate is exit code 0, the focused
suite passes, and the output does not contain `Failed to terminate forks worker`.
Do not use a global Node process-count comparison as a cleanup proof; instead
record the exact worker identities from the output and verify each exact PID
is gone by PID + argv + start identity.

The previously observed broad-suite delta (six baseline failures versus seven
with the repair) must be classified separately during bounded qualification.
It is not evidence against the one-line repair and does not reopen the
architecture review.

## Phase 7 — adjudication

Create `raw/qualification-summary.json` containing the exact bundle SHA-256,
dogfood main/extension-host PIDs, observer `prepareCallId`, profile SHA-256,
and the four gate outcomes. The only success verdict is:

```text
PASS_LIVE_PERMANENT_REPAIR
```

Do not publish that verdict if any production measurement was executed from an
ordinary Terminal, if observer correlation is missing, if cleanup was not
identity-checked, or if any prerequisite failed before its fixture launch.

## Rollback / cleanup

* Never quit all of VSCodium. Close only the dogfood window if necessary.
* Run `foreign-stop` after Phase 5, including after a failed measurement.
* The production fixtures have independent finite lifetimes; wait for their
  deadline before declaring a residual process.
* Preserve the rejected `operator-script.sh` as a quarantine tombstone. Do not
  delete or rewrite it as though the rejected run never happened.
