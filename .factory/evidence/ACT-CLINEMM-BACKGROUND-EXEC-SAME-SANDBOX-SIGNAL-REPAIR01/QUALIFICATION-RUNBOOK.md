# ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01 — Bounded Qualification Runbook

**Status:** `HALT_UNSAFE_OPERATOR_QUALIFICATION` correction prepared; bounded P0
signal-target safety correction applied 2026-11-05 (see
`P0-SIGNAL-TARGET-SAFETY-CORRECTION.md`).
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
* Every signal is preceded by PID + argv + UID + process start-identity
  verification, performed IMMEDIATELY before the signaling attempt through the
  shared fail-closed gate in `probe-fixtures/target-identity.mjs`.
* A group-directed signal additionally requires the target's OBSERVED process
  group id to still equal the group id captured at spawn time.
* Every process-table observation (`ps`) has a FINITE timeout (`PS_TIMEOUT_MS`,
  2 seconds) so a slow observation cannot consume a fixture's whole lifetime.
* `kill(pid, 0)` returning `EPERM` means **exists but unverifiable**, never gone.
  It also BLOCKS a destructive signal attempt: the target is present but not
  verifiable for destructive purposes.
* Only a kernel `ESRCH` establishes absence. A FAILED process-table
  observation never promotes anything to absence.
* A missing, unreadable, or changed identity field emits `HALT_UNSAFE_FIXTURE`
  and signals NOTHING.
* No process-count heuristic, global `pkill`, application-wide quit, or
  indiscriminate PID kill is permitted.

## Phase 0a — process-free anti-controls (Terminal)

```bash
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01
/opt/homebrew/bin/node probe-fixtures/anti-control-runner.mjs
/opt/homebrew/bin/node probe-fixtures/classify-process-state.mjs --contract
```

Both commands are **process-free**: they exercise the real fixture code paths
against a synthetic process table and never observe or signal a real process.
The anti-controls prove that a stale PID, a missing identity, an expired
target, a changed argv, a changed start identity, a changed uid, a changed
process group, an unreadable process metadata, and an `EPERM` target each
produce `HALT_UNSAFE_FIXTURE` with **zero** destructive signals issued. A
`healthy` control scenario proves the anti-controls are not vacuous by
requiring exactly one recorded signal.

The classifier contract proves that only `ESRCH` yields `GONE`, that `EPERM`
yields `UNVERIFIABLE` whether or not the process table can be read, and that
a failed process-table observation never overrides `EPERM`.

Both must pass before any destructive measurement is issued.

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

**Pre-signal identity gate (added by the bounded P0 correction).** Before the
group-directed `SIGTERM`, the fixture re-verifies the child's PID, process
group id, argv, UID and process start identity and requires the OBSERVED
process group id to still equal the group id captured at spawn time. If any
field is missing, unreadable, or changed, the fixture emits:

```text
HALT_UNSAFE_FIXTURE
```

and signals NOTHING — including no group-directed signal and no cleanup
signal. A `halt` field of `HALT_UNSAFE_FIXTURE` in `raw/pgid.result.json` is
a FAILURE of the measurement, never a pass. `preSignalIdentityCheck` records
the observed identity and `groupOwnershipHeld`.

## Phase 5 — foreign-process denial (separate Background Exec measurement)

Start the finite foreign target from the Terminal:

```bash
bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-qualification.sh foreign-start
```

Read `raw/foreign-target.pid`. Immediately, in the dogfood ClineMM chat in
**Background Exec** mode, issue exactly:

```text
/opt/homebrew/bin/node /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/probe-fixtures/foreign-signal-attempt.mjs <FOREIGN_PID> /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/raw/foreign-target.log /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/raw/foreign-target.argv $(cat /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/raw/foreign-target.uid) /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/raw/foreign-target.lstart
```

Substitute only the recorded decimal PID and the recorded UID. The argv and
the process start identity are passed as FILE paths so the expectation is
anchored to exactly what `foreign-start` observed, with no shell-quoting
ambiguity. Save the tool output containing `FOREIGN_SIGNAL_RESULT_JSON=...` to
`raw/foreign.result.json`.

The foreign-denial gate has TWO mutually exclusive acceptable shapes. Exactly
one of them must hold, and the reported shape must match what actually
happened.

**Shape (a) — an ATTEMPTED delivery was denied.** The SIGTERM really was
issued and really returned `EPERM`:

* `signalAttempt.ok == false`;
* `signalAttempt.skipped == false`;
* `signalAttempt.errnoCode == "EPERM"`; and
* `authorizationDenial` is absent.

**Shape (b) — a NON-DELIVERY authorization denial.** The preliminary
signal-zero probe (`kill(pid, 0)`) was denied with `EPERM`, so the fixture
**refused to attempt SIGTERM at all** and signalled nothing:

* `authorizationDenial.outcome == "AUTHORIZATION_DENIED_EPERM"`;
* `authorizationDenial.deliversSignal == false`;
* `authorizationDenial.signalAttempted == false`;
* `authorizationDenial.errnoCode == "EPERM"`;
* `signalAttempt.ok == false` with `signalAttempt.skipped == true` and
  `signalAttempt.errnoCode` absent; and
* `destructiveSignalsIssued` is EMPTY.

Shape (b) is the SAFE behaviour and is the expected result whenever the
signal-zero probe is denied before the attempt. It must NOT be reported as
shape (a): there is no "attempted SIGTERM that returned `EPERM`" in that case.
Reporting shape (b) as shape (a) is a misrepresentation and is a FAILURE.

In BOTH shapes, independently verified target identity and survival are
required:

* the target identity was verified (argv, UID, process start identity) and
  matched;
* `foreignAliveAfter == true`; and
* `foreignReceivedSIGTERM == false`.

The anti-control runner machine-checks shape (b) for the `eperm-target`
scenario, so a qualification run cannot satisfy this gate by misreporting the
outcome.

**Signal-time identity gate (added by the bounded P0 correction).** The
fixture REQUIRES the expected target identity (argv, uid, process start
identity) and re-verifies it IMMEDIATELY before the signaling attempt
through the shared fail-closed gate. It performs a non-mutating signal-zero
authorization check first (`kill(pid, 0)`, labelled `authorizationCheck` with
`deliversSignal: false`). If any identity field is missing, unreadable, or
changed, the fixture emits:

```text
HALT_UNSAFE_FIXTURE
```

and signals NOTHING. A `halt` field of `HALT_UNSAFE_FIXTURE` in
`raw/foreign.result.json` is a FAILURE of the measurement, never a pass.

Then stop and verify the target from the Terminal:

```bash
bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-qualification.sh foreign-stop
```

The cleanup stage re-checks PID, argv, UID, and start identity before
signaling and requires a verified `GONE` state. `EPERM` is never accepted as
cleanup.

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
