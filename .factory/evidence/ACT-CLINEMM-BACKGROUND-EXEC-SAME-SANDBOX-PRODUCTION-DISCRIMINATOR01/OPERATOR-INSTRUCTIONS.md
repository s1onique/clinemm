# OPERATOR INSTRUCTIONS — Live Production Discrimination

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01`
**Status:** `CODE COMPLETE — LIVE MEASUREMENT NOT EXECUTED`
**Diagnostic source head:** `cfd81f35594a759e185da97834923450f4ba8e9b`
**Fixture SHA-256 (P1-corrected):** `857209dcb78154ad69c2101573159db8e0e63fe8c8de04f49562d8d7c064497a`

> **P1 CORRECTION APPLIED (review of 2026-11-05).** The probe fixture's
> in-process PGID observations were removed from the pre-signal path.
> Previously two sequential `/bin/ps` calls (2s timeout each) could consume
> the child's ENTIRE 4-second self-exit lifetime before the SIGTERM was
> attempted, producing an inconclusive `ESRCH`. The SIGTERM is now attempted
> ~50ms after `CHILD_READY` regardless of `/bin/ps` behaviour.
> `parentPgid` and `childPgid` are always `null` in the result.
> **The independent Terminal is now the authoritative PGID inspector**
> (Step 5). The fixture is loaded from the repository at runtime, so this
> correction does NOT require rebuilding the already-verified VSIX.
>
> **Two operational safeguards were added by the same review** — see
> Step 2a (fully close the existing instance first) and Step 6 (restore the
> normal extension after ANY terminal outcome).

---

## Why this needs you

The agent's `run_commands` substrate is itself a ClineMM Background Exec
command running inside a ClineMM Seatbelt profile. Two consequences make
the live measurement impossible from there:

1. **Nested `sandbox-exec` is DENIED** in that substrate:
   `sandbox-exec: sandbox_apply: Operation not permitted` (rc=71).
   A VSCodium launched from there would have an extension host that
   cannot apply ANY Seatbelt profile — the candidate rule would never
   reach the kernel. That is `CAPTURE_INSUFFICIENT` (Case C), not a
   measurement.
2. **The VSCodium extensions directory is NOT writable** from that
   substrate (`mkdir ... Operation not permitted`), so the diagnostic
   VSIX cannot be installed into the running dogfood instance.

Both are the same constraint the RECON01 / RECON02 operator harnesses
already faced.

---

## Step 1 — install the diagnostic VSIX

The artifact is already built and identity-verified:

```
VSIX_PATH  = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/clinemm-4.1.16-5a1c485cb-cfd81f355.vsix
VSIX_SIZE  = 49544306 bytes
VSIX_SHA256= 16f5962428fb7c9039d33dffc28b7d664b9a4674d6526d625ee0c4829db8e568
BUNDLE_SHA256 = f183358f96fdc043f3677b11491c16051ceeae05f83bc17241d393f311da31f1
VERSION    = 4.1.16-5a1c485cb-cfd81f355
```

From an ordinary Terminal:

```bash
CODIUM=/Applications/VSCodium.app/Contents/Resources/app/bin/codium
VSC=/Volumes/UserData/Users/chistyakov/.vscodium-clinemm
"$CODIUM" --install-extension \
  /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/clinemm-4.1.16-5a1c485cb-cfd81f355.vsix \
  --force --user-data-dir "$VSC/user-data" --extensions-dir "$VSC/extensions"
```

Verify the installed bundle identity:

```bash
shasum -a 256 "$VSC/extensions/s1onique.clinemm-4.1.16-5a1c485cb-cfd81f355/dist/extension.js"
# MUST equal f183358f96fdc043f3677b11491c16051ceeae05f83bc17241d393f311da31f1
```

## Step 2 — launch VSCodium WITH the diagnostic opt-in

The opt-in is read by the extension host's OWN environment at activation.
The running instance (PID 90006) was launched WITHOUT it, so you MUST
restart VSCodium with the variables set.

```bash
export CLINEMM_RUNTIME_PROFILE=dogfood
export CLINEMM_DIAG_SAME_SANDBOX_SIGNAL=1
export CLINEMM_DIAG_SAME_SANDBOX_SIGNAL_COMMAND='["/bin/bash","-c","/opt/homebrew/bin/node /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01/probe-fixtures/same-sandbox-probe.mjs"]'
/Applications/VSCodium.app/Contents/MacOS/VSCodium \
  --user-data-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data \
  --extensions-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions \
  /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
```

> **The command identity must match EXACTLY.** The JSON array is
> `[executable, ...argv]`. At the production seam the command reaches
> `prepare()` as `executable="/bin/bash"` and
> `args=["-c", "<the exact command text>"]`. If the command you issue
> differs by ONE character, the exact-identity gate rejects it and the
> profile keeps `target self` — that is `HALT_DIAGNOSTIC_NOT_APPLIED`,
> not a candidate measurement.
>
> Do NOT use `bash -lc`, a different node path, or extra shell quoting.

Do NOT disable the Chromium sandbox and do NOT change any VSCodium launch
flag other than the two `--*-dir` paths above.

## Step 2a — FULLY CLOSE the existing dogfood instance FIRST

> **Added by the review of 2026-11-05. Do not skip this.**

VS Code documents that a subsequent instance can inherit the FIRST running
instance's environment instead of the launching shell's environment. If the
existing dogfood VSCodium (PID 90006) is still running when you execute
Step 2, the new launch may reuse the OLD process — whose environment does
NOT carry `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL`. The diagnostic would then
never arm, the profile would keep `(allow signal (target self))`, and the
run would be misread as a RED.

Before Step 2:

```bash
# 1. Quit VSCodium COMPLETELY (Cmd-Q in the GUI, or:)
osascript -e 'quit app "VSCodium"'

# 2. Confirm no VSCodium / extension-host process remains.
pgrep -fl 'VSCodium|extensionHost|extension-host' || echo "none running"
```

Wait for `pgrep` to return **no** matching processes. Only then run Step 2.

Verify the new instance actually carries the opt-in:

```bash
# The extension host's own PID and environment, from the Terminal:
pgrep -fl 'extensionHost|extension-host'
ps -Eww -p <extension-host-pid> | tr ' ' '\n' | grep CLINEMM_DIAG
```

Both `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL=1` and
`CLINEMM_DIAG_SAME_SANDBOX_SIGNAL_COMMAND=...` MUST be present. If they are
not, the run is invalid — restart cleanly.

Also confirm the **diagnostic bundle** is the one that got loaded, not
merely a separate writable test installation:

```bash
shasum -a 256 \
  /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-cfd81f355/dist/extension.js
# MUST equal f183358f96fdc043f3677b11491c16051ceeae05f83bc17241d393f311da31f1
```

## Step 3 — capture the profile identity

The Seatbelt backend writes each profile to a private temp dir. From an
independent Terminal, watch for it while the command runs:

```bash
# In the Terminal (NOT in the extension), in a second window:
ls -td /private/var/folders/*/*/T/clinemm-sandbox-profile-* | head -3
cat /private/var/folders/*/*/T/clinemm-sandbox-profile-*/profile-*.sb | head -30
```

Record:

```
PROFILE_PATH
PROFILE_SHA256
PROFILE_SIGNAL_RULE       # MUST be exactly one "(allow signal (target same-sandbox))"
                           # and the original "(allow signal (target self))" MUST be ABSENT
SANDBOX_EXEC_EXECUTABLE   # /usr/bin/sandbox-exec
SANDBOX_EXEC_ARGS         # -f <profilePath> /bin/bash -c <command>
PREPARED_CWD
```

## Step 4 — run the ONE diagnostic command

In the ClineMM chat (Background Exec mode — **not** Terminal mode), issue
EXACTLY:

```
/opt/homebrew/bin/node /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01/probe-fixtures/same-sandbox-probe.mjs
```

Capture the tool output. It contains a line beginning with:

```
SAME_SANDBOX_RESULT_JSON={...}
```

That JSON is the authoritative result. Save it verbatim to
`raw/live-command-result.json`.

## Step 5 — independent cleanup verification AND authoritative PGID inspection

From the independent Terminal, using the exact child PID from the result:

```bash
PID=<childPid>
ps -o pid=,ppid=,pgid=,lstart=,command= -p "$PID"   # identity match
kill -0 "$PID" 2>&1 ; echo "rc=$?"                  # ESRCH => gone
```

Interpret per the charter: `ESRCH` = absent; `EPERM` = existence cannot
be excluded (`CLEANUP_UNVERIFIED`); PID/identity mismatch = the current
process is not the original target.

> **The Terminal is the ONLY authoritative PGID inspector.** The fixture
> no longer observes PGIDs in-process (see the P1 correction note at the
> top): `parentPgid` and `childPgid` are always `null` in
> `SAME_SANDBOX_RESULT_JSON`, which means "not observed in-process" — it
> is NOT a claim that the PGID is unknown to the kernel.
>
> The PGID values are NOT load-bearing for the causal decision (the
> decision rests on the signal errno plus the correlated child
> delivery/exit evidence), but capture them here for the record:
>
> ```bash
> PARENT_PID=<parentPid>
> CHILD_PID=<childPid>
> ps -o pid=,ppid=,pgid=,lstart=,command= -p "$PARENT_PID"
> ps -o pid=,ppid=,pgid=,lstart=,command= -p "$CHILD_PID"
> ```
>
> Record the observed `pgid` values in the result notes. Because the
> child is spawned `detached`, the child's PGID is normally its own PID;
> confirm that rather than assume it.

The fixture's child has an INDEPENDENT 4-second self-exit deadline, so a
denied signal cannot leave an orphan. If the child survives that
deadline, report `HALT_NEW_ORPHAN` and do NOT launch another fixture.

## Step 6 — restore the normal extension (after ANY outcome)

> **Added by the review of 2026-11-05.** Restore the normal extension
> after **any** terminal outcome — including `CAPTURE_INSUFFICIENT`,
> `HALT_DIAGNOSTIC_NOT_APPLIED`, `HALT_UNSAFE_SIGNAL_SCOPE`, an aborted
> probe, or an inconclusive/garbled result. **Not only after Case A or
> Case B.** The diagnostic must never be left installed with the
> diagnostic armed.

Remove the diagnostic artifact:

```bash
VSC=/Volumes/UserData/Users/chistyakov/.vscodium-clinemm
CODIUM=/Applications/VSCodium.app/Contents/Resources/app/bin/codium
"$CODIUM" --uninstall-extension s1onique.clinemm \
  --user-data-dir "$VSC/user-data" --extensions-dir "$VSC/extensions"
```

Then rebuild and reinstall a NORMAL artifact (a normal extension artifact
is built by the normal dogfood pipeline at the current HEAD; see
`build-identity.txt` for the pipeline used, and `diagnostic-contract.md`
§Removal inventory for the exact source changes to revert FIRST).

Verify the restored install is NOT the diagnostic:

```bash
grep -c 'CLINEMM_DIAG_SAME_SANDBOX_SIGNAL' \
  "$VSC/extensions/s1onique.clinemm-<normal-version>/dist/extension.js"
# MUST be 0
```

The currently installed diagnostic artifact must NOT be left in place with
the diagnostic armed.

---

## Decision table (apply to the captured result)

| Observation | Verdict |
|---|---|
| `signalAttempt.ok=true` AND `childReceivedSigterm=true` AND `childExited=true` AND `childStillAliveAfter=false` AND cleanup verified AND profile shows exactly one `same-sandbox` rule | **`SELECT_SEATBELT_SIGNAL_REPAIR`** |
| `signalAttempt.errnoCode="EPERM"` AND `childReady=true` AND `childSelfExited=true` AND cleanup verified AND profile shows exactly one `same-sandbox` rule | **`SELECT_COMPOSED_BOUNDARY_REPAIR`** |
| The profile was generated with `same-sandbox` but `sandbox-exec` failed before the child started | **`CAPTURE_INSUFFICIENT`** (Case C) |
| The emitted profile still contains `(allow signal (target self))`, or the candidate rule appears zero times, or the command identity did not match | **`HALT_DIAGNOSTIC_NOT_APPLIED`** (Case D) |
| `childReady=false`, or the target exited before signaling, or `ESRCH`, or delivery evidence missing, or cleanup unverifiable | **`CAPTURE_INSUFFICIENT`** (Case E) |
| Any unauthorized filesystem/network grant, an unrelated job affected, an unrelated controlled process became signalable, or Seatbelt was bypassed | **`HALT_UNSAFE_SIGNAL_SCOPE`** (Case F) |

## Critical validity rule

`process.kill()` returning success is NOT sufficient by itself. GREEN
requires the correlated `CHILD_GOT_SIGTERM` delivery marker or an
unambiguous child-exit observation. `EPERM` is never equivalent to
`ESRCH`.

## Hard constraints

- Run EXACTLY ONE candidate fixture. Do not run multiple diagnostic jobs.
- Do not run the fixture through the Terminal as a substitute for the
  production measurement.
- Do not use a process-group kill as the primary diagnostic.
- Do not restart or modify the host helper (`io.clinemm.host-helper`).
- Do not modify the LaunchAgent registration.
- Do not disable Seatbelt.
- Do not switch to Terminal execution mode.
- Do not kill any process other than the fixture's own recorded child PID.

---

## RED evidence already established (do NOT re-run the long workload)

### R1 — accepted RECON01 production-seam RED (`REAL_PRODUCTION_SEAM`)

RECON01 measured, through the real `CommandJobManager.start()` →
`SeatbeltBackend.prepare()` → `sandbox-exec` → Node parent → Node child
chain, with the ORIGINAL `(allow signal (target self))` rule:

```
signalAttempt.ok  = false
signalAttempt.errnoCode = EPERM
```

Original source head for the accepted RED: `56982887bd866182d45bac6b802e9374fe60bfe8`
(the same tree as this ACT's ENTRY_HEAD). Original profile rule:
`(allow signal (target self))`. Execution context: the installed ClineMM
extension's Background Exec path under the real VSCodium extension host.
Process-lifecycle result: the child could not be terminated by the
parent; it survived and was later reaped only by an independent
mechanism.

The accepted E1 also records the independent `ForksPoolWorker.stop()`
`EPERM` during Vitest worker teardown, and the persistent orphan
accumulation.

### R2 — finite-fixture RED reproduced in the agent substrate (`LIVE`, agent substrate)

`raw/red-agent-substrate.result.json`:

```json
{
  "marker": "CLINEMM_SAME_SANDBOX_PRODUCTION_DISCRIMINATOR01",
  "parentPid": 82981,
  "childPid": 82991,
  "childReady": true,
  "signalAttempt": { "ok": false, "errnoCode": "EPERM" },
  "childReceivedSigterm": false,
  "childExited": true,
  "childSelfExited": true,
  "childStillAliveAfter": false,
  "childAliveProbeErrno": "ESRCH"
}
```

This is the SAME finite fixture, the SAME child-directed `SIGTERM`, the
SAME `EPERM`, the SAME correlated child self-exit, and the SAME clean
cleanup (no orphan). It runs in the agent substrate, which is itself a
ClineMM Seatbelt-sandboxed Background Exec command.

**Scope limit:** this is NOT the installed-extension measurement. It
confirms the fixture reproduces the RED signal and that the fixture is
safe (no orphan). The production-context claim rests on R1 plus the
live experiment.

## Why the agent could not execute the live experiment

| Attempt | Result | Interpretation |
|---|---|---|
| `sandbox-exec -f <candidate.sb> node probe.mjs` from the agent substrate | `sandbox-exec: sandbox_apply: Operation not permitted` (rc=71) | Nested Seatbelt is denied. A VSCodium launched from here cannot apply the candidate profile → Case C, not a measurement. |
| `codium --install-extension` into `~/.vscodium-clinemm/extensions` | `EPERM: operation not permitted, mkdir .../extensions/.d4a2b01e-...` | The extensions directory is outside the agent's writable roots. |
| Launch VSCodium from the agent substrate | process exited immediately; no extension host | Electron GUI cannot start inside the agent's Seatbelt substrate. |
| Install into a repo-local extensions dir (writable) | SUCCEEDED — bundle SHA verified | Proves the artifact + install path are correct; but the GUI still cannot launch from the substrate. |

The diagnostic VSIX **was** successfully installed into a writable
extensions dir and its bundle SHA-256 verified identical to the VSIX's
`dist/extension.js`, proving the artifact carries the diagnostic code.
