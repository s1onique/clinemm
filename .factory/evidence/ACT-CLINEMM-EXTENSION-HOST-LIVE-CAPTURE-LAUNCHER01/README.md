# ACT-CLINEMM-EXTENSION-HOST-LIVE-CAPTURE-LAUNCHER01 — Evidence

This directory contains the evidence trail for the helper at
`cmd/clinemm-live-capture/`, including five correction rounds:

- **v2 (CORRECTION01)** resolved `HALT_EXTENSION_HOST_DISCOVERY_SEAM_NOT_LIVE_PROVEN`
  by widening the predicate to match both the legacy
  `--type=extensionHost` fork shape and the desktop VSCodium
  1.126 `--type=utility --utility-sub-type=node.mojom.NodeService`
  UtilityProcess shape.
- **v3 (CORRECTION02)** resolved `HALT_EXTENSION_HOST_IDENTITY_HEURISTIC_UNPROVEN`
  by replacing chronology-as-identity (v2's "bind lowest PID +
  warn") with authoritative identity binding via VSCodium's own
  per-session log (`<logDir>/<session>/window1/exthost/exthost.log`).
- **v4 (CORRECTION03)** resolved `HALT_LOG_IDENTITY_SOURCE_NOT_BOUND_TO_LAUNCH`
  by binding the chosen log session to THIS launch (not just
  picking the newest session): the helper now
  (a) renames `--log` → `--logs-path` (the actual upstream
      argv option; `--log` is a log-LEVEL flag, not a path),
  (b) INJECTS `--logsPath <dir>` into the launched editor's
      argv so the session directory is causally attributable
      to this launch,
  (c) snapshots pre-existing session directories before the
      launch and computes `newSessions = sessionsNow - sessionsBefore`,
  (d) refuses to bind unless exactly one new session appeared,
  (e) tolerates the log/write race as a transient.
- **v5 (CORRECTION04)** resolved `HALT_LOGSPATH_CONTRACT_SHAPE_MISMATCH`:
  the v4 launch->session binding layer was internally inconsistent
  with the very main.js evidence v4 cited. When the operator passes
  `--logsPath <dir>` explicitly, VSCodium 1.126 uses `<dir>` DIRECTLY
  as logsHome (the `<session>/` synthesis is BYPASSED). v5 removes
  the session-enumeration machinery entirely and makes the
  operator-supplied logsPath ITSELF the causal namespace.
- **v6 (CORRECTION05)** resolved `HALT_LAUNCHER_INSTANCE_REUSE_BREAKS_CAUSAL_BINDING`:
  VS Code / VSCodium is intentionally single-instance by default.
  Without an isolated `--user-data-dir`, a CLI invocation forwards
  the workspace-open request to an already-running VSCodium main
  process and inherits its environment + state. v6 requires the
  operator to supply a PRISTINE `--user-data-dir` (in addition to
  the v5 PRISTINE `--logs-path`) and INJECTS both into the
  launched editor's argv.

## Why CORRECTION05 was needed

The round-5 reviewer (the same panel as v2/v3/v4/v5) blocked v5
under `HALT_LAUNCHER_INSTANCE_REUSE_BREAKS_CAUSAL_BINDING`. The
reviewer quoted upstream `CodeMain` and VS Code docs verbatim:

> Upstream `CodeMain` explicitly says a second invocation
> tries to communicate with an existing instance to prevent
> two normal instances from running simultaneously.

> When the invocation is not the first VS Code instance,
> environment variables are inherited from the already-running
> instance, not from the shell that launched the new CLI
> command.

The reviewer recommended:

> "So the launcher should own two fresh namespaces:
>   userDataDir = unique specimen-specific directory
>   logsPath    = unique specimen-specific directory
> Then launch:
>   codium --user-data-dir <unique-user-data-dir>
>          --logsPath <unique-logs-path>
>          <workspace>"

v6 follows this recommendation. The whole helper is the same
plus one more required CLI flag (`--user-data-dir`) and one
more pre-launch invariant (`ensurePristineUserDataDir`).

## Files

| File | Purpose |
|------|---------|
| `unit-test-run.log`        | `go test -v ./...` output, 36/36 PASS (v6) |
| `gate-transcript.log`      | go test + go vet + gofmt + git diff --check + git status --short (post-CORRECTION05) |
| `live-process-recon.log`   | Empirical `ps axww` reconnaissance of the local VSCodium 1.126 production seam |
| `smoke-synthetic.log`      | Synthetic smoke runs of v6 binary: --help, --user-data-dir-missing, empty-dir, non-empty-dir-HALT, hidden-file-HALT, non-existent-dir-create, --logs-path-dirty-cross-check -- exit codes 3/2/7/7/2/7 (v6) |

## v6 filesystem shape (CORRECTION05)

The helper now requires TWO PRISTINE namespaces:

```text
<userDataDir>/...                       -- v6: distinct VSCodium instance
<logsPath>/window1/exthost/exthost.log  -- v5: authoritative extension-host PID
```

The injection in `startClineMM` is:

```text
codium \
  --user-data-dir <userDataDir> \
  --logsPath <logsPath> \
  <operator's args...>
```

Per upstream VS Code docs, `--user-data-dir` is the supported
mechanism for opening a distinct instance and isolating
environment variables.

## ClineMM dogfood extension concern

A pristine `--user-data-dir` means the ClineMM dogfood extension
is NOT installed in that isolated instance by default. The
operator must EITHER:

- point `--extensions-dir` at the existing dogfood extensions
  install (recommended; preserves the existing ClineMM install),
  OR
- pre-install the ClineMM extension into the pristine
  `--user-data-dir` (e.g. `codium --install-extension
  cline-cline-...vsix --user-data-dir <dir>`).

The helper does NOT auto-install the ClineMM dogfood extension
into the isolated instance (the helper's scope is the launch
seam, not extension management).

## Test catalog (36/36 PASS, v6)

### Pre-CORRECTION05 (kept, signatures updated)

| Test | Discriminator |
|------|---------------|
| TestWaitForNewExtensionHost_BindSingleNewPID | LAUNCH-01 |
| TestParser_ExactMarkerOnly | LAUNCH-04 |
| TestParser_LiveObservedShape | v2 RED/GREEN |
| TestParser_PluginExclusion | v2 RED/GREEN |
| TestFilteredEnv_RemovesBothProfileFlags | LAUNCH-05 |
| TestObserverArgv_ExactOrder | LAUNCH-06 |
| TestWaitForNewExtensionHost_Timeout | LAUNCH-03 |
| TestParser_LeadingWhitespace | (extra) |
| TestWaitForNewExtensionHost_AuthoritativeBind | LAUNCH-ID-01 (v3) |
| TestWaitForNewExtensionHost_AuthoritativeUnobservable_NoLog | LAUNCH-ID-02 (v3) |
| TestWaitForNewExtensionHost_AuthoritativeNonMatch | LAUNCH-ID-04 (v3) |
| TestParser_AuthoritativeLog_ParsesExthostLog | LAUNCH-ID-05 (v3) |
| TestParser_AuthoritativeLog_RejectsBadFormat | LAUNCH-ID-06 (v3) |
| TestErrIdentityUnobservable_Is | LAUNCH-ID-09 (v3) |
| TestWaitForNewExtensionHost_BoundPIDMatchesAuthoritative | LAUNCH-ID-10 (v3) |
| TestErrExthostLogRace_Is | LAUNCH-SESSION-08 (v4→v5) |
| TestStartClineMM_LogsPathInjection | LAUNCH-SESSION-09 (v4→v5, EXTENDED in v6) |
| TestWaitForNewExtensionHost_AuthoritativeUnobservable_NoExthostLog | LAUNCH-LOGROOT-03 (v5) |
| TestWaitForNewExtensionHost_LogRoot_HappyPath | LAUNCH-LOGROOT-01 (v5) |
| TestWaitForNewExtensionHost_LogRoot_FaultInjectionV4Layout | v5 reviewer's ask |
| TestEnsurePristineLogsPath_NotPristine_Halt | LAUNCH-LOGROOT-02 (v5) |
| TestEnsurePristineLogsPath_NonExistent_Creates | (v5 positive side) |
| TestEnsurePristineLogsPath_ExistingEmpty_OK | (v5 positive side) |
| TestEnsurePristineLogsPath_PathIsFile_Halt | (v5 negative side) |
| TestWaitForNewExtensionHost_LogRoot_LogWriteRace | LAUNCH-LOGROOT-03 (v5) |
| TestWaitForNewExtensionHost_LogRoot_MalformedFirstLine | LAUNCH-LOGROOT-04 (v5) |
| TestEnsurePristineLogsPath_ThenLogRoot_HappyPath | v5 integration |
| TestErrLogPathNotPristine_Is | v5 sentinel dispatch |

### v6 NEW tests (CORRECTION05)

| Test | Discriminator |
|------|---------------|
| TestParseConfig_UserDataDir_Required | LAUNCH-INSTANCE-01 |
| TestEnsurePristineUserDataDir_NotPristine_Halt | LAUNCH-INSTANCE-02 |
| TestEnsurePristineUserDataDir_NonExistent_Creates | (pristine check positive side) |
| TestEnsurePristineUserDataDir_ExistingEmpty_OK | (pristine check positive side) |
| TestEnsurePristineUserDataDir_PathIsFile_Halt | (pristine check negative side) |
| TestErrUserDataDirNotPristine_Is | LAUNCH-INSTANCE-03 (sentinel dispatch) |
| TestEnsurePristineUserDataDir_ThenLogRoot_HappyPath | LAUNCH-INSTANCE-04 (integration) |
| TestEnsurePristineUserDataDir_HiddenFile_Still_Halt | LAUNCH-INSTANCE-05 (hidden file contamination) |

## Upstream argv verification

```text
$ cat src/vs/platform/environment/node/argv.ts (upstream main)
...
'userDataDir'?: string;     // --user-data-dir is the distinct-instance option
'log'?: string[];            // --log is log LEVEL (string[])
'logsPath'?: string;         // --logsPath is log DIR (string)
```

```text
$ grep -oE '.{0,80}args\.logsPath.{0,80}' /Applications/VSCodium.app/.../main.js
get logsHome(){if(!this.args.logsPath){const t=ID(new Date).replace(/-|:|\.\d+Z$/g,"");
  this.args.logsPath=W(this.userDataPath,"logs",t)}
  return D.file(this.args.logsPath)}

execArgv:i,args:["--logsPath",this._environmentMainService.logsHome.with({scheme:F.file}).fsPath],
```

`userDataDir` is upstream-documented as the mechanism for opening
a distinct instance and isolating environment variables; the
helper relies on this contract by injecting `--user-data-dir
<userDataDir>` into the launched editor's argv.
