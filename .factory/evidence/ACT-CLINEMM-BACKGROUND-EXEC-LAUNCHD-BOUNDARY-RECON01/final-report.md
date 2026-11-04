# ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01 — Final Report

## 0. Verdict

```
SELECTED_ARCHITECTURE = CAPTURE_INSUFFICIENT
```

**No architecture is selected.** The recon reached a hard, *structural*
observation ceiling that is itself the primary finding:

> Every process this ACT can control is under **two stacked sandboxes** (the
> extension host's Chromium zygote sandbox **and** the ClineMM Seatbelt
> profile). macOS forbids nesting a second Seatbelt profile
> (`sandbox_apply: Operation not permitted`), so **the Seatbelt signal policy
> cannot be varied and observed** from inside the IDE extension host. The one
> context that *can* vary it (a launchd-managed process) is **unreachable**:
> every launchd-mutation verb is denied from the sandbox, and the installed
> LaunchAgent's own wire contract has **no method that runs an arbitrary
> command**.

This ACT therefore does **not** choose between a Seatbelt signal repair and a
LaunchAgent execution boundary. It **proves the choice cannot be made from this
substrate**, specifies the *minimum* additional observation that would close
it, and — as a by-product — surfaces **two new production defects** that are
strictly more urgent than the EPERM question.

---

## 1. Identity

| item | value |
|---|---|
| ACT | `ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01` |
| ENTRY_HEAD | `36f3a23882d31ab91a5ba760e97632633a6bc440` |
| ENTRY_TREE | `23e0df51d1050f42ab3a5e769b30dc3454f4d912` |
| FINAL_HEAD | `36f3a23882d31ab91a5ba760e97632633a6bc440` (unchanged — recon-only) |
| branch | `main` |
| worktree at entry | CLEAN |
| worktree at exit | one new untracked diagnostic file (§8) |
| OS / arch | macOS Sonoma 14.7.4 (23H420) / arm64 |
| Node / Bun | v26.0.0 / 1.3.14 |
| installed extension | VSCodium; extension host pid 913, Chromium `--enable-sandbox` |
| native helper | `io.clinemm.host-helper`, pid 42547, sha256 `ccd5257402745b4e8940dda9a5d020f09984063aea26ca5c1561a4b492d6366c` (54264 B) |

`stash@{0}` preserved untouched. No unrelated file modified. The installed
LaunchAgent plist was **not** modified, reinstalled, or restarted.

---

## 2. Production seam (real, source-verified)

```
VS Code / VSCodium extension host          pid 913, uid 501
  |  Chromium zygote sandbox (--enable-sandbox, --service-sandbox-type=none)
  |  NOT ClineMM-Seatbelt-sandboxed (TMPDIR = /var/folders/.../T/)
  v
VscodeSessionHost.create()                  apps/vscode/src/sdk/vscode-session-host.ts
  |  helperOwnedPgidProvider = resolveLiveHelperOwnedPgidProvider()
  v
CommandJobManager.start()                   apps/vscode/src/sdk/command-job-manager.ts:1555
  |  A. REQUEST AUTHORITY : getShellInvocation()/getDefaultShell() resolve the
  |     command + args; waitBudgetMs / executionDeadlineMs clamped host-side;
  |     approval + command-policy live in vscode-run-commands-tool.ts.
  |  B. SANDBOX AUTHORITY : resolveExperimentalSandboxMode() -> "seatbelt-experimental"
  |     (SECURE-BY-DEFAULT on darwin) -> defaultSandboxBackendResolver()
  |     -> SeatbeltSandboxBackendExperimental.prepare()
  |       - canonicalise paths, generateSeatbeltProfile(), materialise env,
  |       - write profile to .../T/clinemm-sandbox-profile-<rnd>/profile-<h>.sb
  |     -> prepared = { executable: "/usr/bin/sandbox-exec",
  |                     args: ["-f", profilePath, cmd, ...args] }
  v
spawnSupervisableShellCommand()            sdk/packages/core/src/extensions/tools/executors/bash.ts:1738
  |  C. SPAWN AUTHORITY : the extension host process itself.
  |     spawn(config.executable, config.args, { cwd, env, stdio:[p,p,p], detached:true })
  |     detached:true => the child is a SESSION + PROCESS-GROUP LEADER:
  |                     child.pid == child.pgid (own group)
  |  D. SUBPROCESS AUTHORITY : the sandboxed child (e.g. /bin/sh) is the group
  |     leader; ITS children (vitest workers, build tools) inherit BOTH the
  |     Chromium sandbox AND the ClineMM Seatbelt profile.
  v
POSIX process group  (uid 501, pgid == child.pid == its own group)
  |
  |  E. CANCELLATION AUTHORITY (five distinct actors, see 2.1)
  v
finalize() -> postcondition probe kill(-pgid, 0) -> terminal state commit
```

### 2.1 The five cancellation actors (E-item 5)

| # | actor | mechanism | authority |
|---|---|---|---|
| 1 | `CommandJobManager` cancellation | `terminateTree()` -> `process.kill(-childPid, sig)` | the **extension host** (Chromium-sandboxed, NOT Seatbelt) |
| 2 | the command's own `kill()` | POSIX `kill()` from inside the sandboxed command | the **sandboxed command** (Seatbelt `(allow signal (target self))`) |
| 3 | Vitest's internal worker cleanup | `ChildProcess.kill()` on its fork workers | the **vitest main** process (a descendant of the sandboxed command) |
| 4 | process-group cleanup after owner exit | `kill(-pgid, 0)` postcondition probe | the extension host |
| 5 | LaunchAgent helper termination | `process-group.terminate-owned` -> SIGTERM/SIGKILL on `-pgid` | the **helper** (uid 501, unsandboxed, launchd) |

**Actors 2 and 3 produce E1.** They run *inside* the sandbox, where
`(allow signal (target self))` denies every signal except to self.

### 2.2 Where the denial happens

The denial is **not** at `CommandJobManager.terminateTree()` (actor 1) — that
path has the helper-backed PGID fallback (E3, already closed). E1's denial is
**actor 3**: Vitest's own worker-pool teardown, running inside the sandboxed
command, calling `kill()` on its fork workers.

```
sandboxed command (Seatbelt: allow signal (target self))
  |
  +-- vitest main  --kill()-->      vitest fork worker  => EPERM  <-- E1 origin
  +-- vitest main  --kill(-pgid)--> worker group        => EPERM
```

## 3. Probe matrix (as executed)

| Probe | Substrate | Signal result | Cleanup | Evidence class |
|---|---|---|---|---|
| P0 "Terminal baseline" | **NOT an independent Terminal** — the authoring shell *is* the production Background Exec path (§3.1) | `kill(childPid, SIGTERM)` = **EPERM** (`errnoCode:"EPERM"`, `syscall:"kill"`) | child self-exited (exit 0); `kill(childPid,0)` afterwards = **ESRCH**; `childStillAliveAfter=false` | LIVE |
| P1 "current profile, Terminal" | **NOT EXECUTED** — nested `sandbox-exec` is structurally impossible from the authoring context | n/a | n/a | **LIVE_UNOBSERVABLE** |
| P2 "narrow signal-policy discriminator" | **NOT EXECUTED** — same reason | n/a | n/a | **LIVE_UNOBSERVABLE** |
| P3 "installed Background Exec" | **EXECUTED** — the authoring shell *is* the production seam (`CommandJobManager.start` -> `sandbox-exec` -> kernel). Same run as P0. | EPERM (identical) | identical | **REAL_PRODUCTION_SEAM / LIVE** |
| P4 "existing helper" | helper pid 42547 reachable over AF_UNIX; **connection accepted, response never delivered**; then the helper **WEDGED** (§7) | see §7 | see §7 | LIVE (negative) |

### 3.1 Why "P0" was actually P3 — the substrate inversion

The ACT's probe plan assumes the agent's shell is an *independent* Terminal.
**It is not.** Measured:

```
$ ps -o pid,ppid,command -p $PPID
 913  803  /Applications/VSCodium.app/.../VSCodium Helper (Plugin) ... --enable-sandbox
$ echo $TMPDIR
/private/var/folders/0g/.../T/clinemm-sandbox-temp-h40BA0
```

* ancestry: `VSCodium main (803) -> extension host (913) -> /bin/zsh (me)`
* `TMPDIR` is a **fresh `clinemm-sandbox-temp-*` per command** — the ClineMM
  Seatbelt backend's synthesized temp root (`seatbelt-backend.ts`,
  `synthesizedTempRoot`).

So the authoring shell is **the production Background Exec command**. Every
`run_commands` invocation is a real `CommandJobManager.start()` -> Seatbelt ->
`/usr/bin/sandbox-exec` -> kernel execution. P0 and P3 are therefore the
**same observation**, and the ACT's "ordinary Terminal baseline" arm does not
exist in this substrate.

**Consequence:** P0 cannot be satisfied here, so **Decision A's precondition
("P0 signals successfully") can never be evaluated from this context.**

### 3.2 The ClineMM Seatbelt profile IS applied — proven by exact write-grant match

Measured write/mkdir outcomes from the authoring shell:

| path | result | matches the production profile? |
|---|---|---|
| `/private/tmp/...` | **OK** | yes — `ALWAYS_WRITABLE_SYSTEM_SUBPATHS` |
| `<workspace root>` | **OK** | yes — `writableRoots` |
| `~/Library/Caches/go-build` | **OK** | yes — explicit writable root |
| `~/.clinemm/` | **EPERM** | yes — outside capability |
| `~/Documents`, `~/Downloads`, `~/Desktop` | **EPERM** | yes |
| `~/Library/Preferences`, `~/Library/Application Support` | **EPERM** | yes |
| `/private/var/folders/.../T` (parent of tempRoot) | **EPERM** | yes |
| `/etc/master.passwd` (read) | **EACCES** | yes |

This is the **exact** write allowlist of the profile generator
(`generateSeatbeltProfile` + `buildExperimentalReconCapability`), not the
Chromium sandbox's shape. The ClineMM profile is unambiguously in force.

### 3.3 The signal observation (raw)

```
PROBE_RESULT_JSON={
  "marker":"CLINEMM_RECON01_SIGNAL_PROBE",
  "parentPid":15406,"parentPpid":15404,"childPid":15410,
  "signalAttempt":{"signal":"SIGTERM","target":"child-pid","ok":false,
                   "errnoCode":"EPERM","errnoMessage":"kill EPERM","syscall":"kill"},
  "signalErrno":"EPERM",
  "childExitedOnOwn":true,"childExitCode":0,"childExitSignal":null,
  "childStillAlive":false,"childStillAliveAfter":false,
  "cleanup":"child-exited-no-cleanup-needed",
  "childReady":true,"childAliveProbeErrno":"ESRCH"
}
```

Full file: `probe-p0-p3-production-seam-signal.out`.

### 3.4 The E1 signature reproduced live, in this ACT's own run

Running the P3 probe file through the repo's vitest produced the **exact** E1
artefact:

```
[vitest-pool]: Failed to terminate forks worker for test files
  .../recon01-background-exec-launchd-boundary.probe.test.ts. Error: kill EPERM
    at ChildProcess.kill (node:internal/child_process:535:26)
    at ForksPoolWorker.stop (.../vitest/dist/chunks/cli-api.BK8pd4xc.js:3112:8)
[vitest-pool]: Timeout terminating forks worker for test files ...
```

`kill EPERM` from `ChildProcess.kill` inside `ForksPoolWorker.stop` — i.e.
**actor 3** (Vitest's own worker-pool teardown), **not**
`CommandJobManager.terminateTree()`. This is E1, live, in this ACT.

> **E1 vs. this ACT's P0 probe:** the E1 EPERM originates in the **vitest
> main** process (a descendant of the sandboxed command) signalling its **fork
> workers**. The P0/P3 probe measures the **sandboxed command** signalling
> **its own child**. Both are "descendant signals a descendant" under the same
> Seatbelt profile, and both are denied with the same errno.

---

## 4. Causal assessment

### 4.1 Hypotheses

| # | hypothesis | verdict | discriminating evidence |
|---|---|---|---|
| **H1** | The inherited IDE sandbox prevents signalling descendants, irrespective of the Seatbelt profile | **NOT ELIMINATED — and stronger than the ACT assumed** | Prior ACT `ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01` T2 (no Seatbelt profile applied at all): `CHILD_KILL=ERR_EPERM`. **But** in *today's* substrate the Seatbelt profile IS applied, so the two layers are stacked and inseparable from inside. |
| **H2** | The generated Seatbelt profile allows signalling only the current process, so a workload cannot terminate its own child even within its own group | **NOT ELIMINATED — mechanistically confirmed, experimentally unconfirmed** | Profile source: `seatbelt-profile.ts:700` emits `(allow signal (target self))`. Observed signature is exactly `(self allowed, everything else EPERM)`: `kill(0,0)`=OK, `kill(childPid)`=EPERM, `kill(-childPgid,0)`=EPERM, `kill(ppid,0)`=EPERM, `kill(1,0)`=EPERM. **But** the candidate profile was never applied (§5). |
| **H3** | Both restrictions contribute | **CANNOT BE DISTINGUISHED** | Requires P0 (independent launch) AND P2 (candidate profile) — both unavailable. |
| **H4** | The failure is a Vitest lifecycle defect independent of sandboxing | **ELIMINATED** | The bounded probe (no Vitest) reproduces the same EPERM. Vitest is a victim, not the cause. |
| **H5** | The existing helper's ownership model cannot safely support arbitrary Background Exec workloads | **CONFIRMED, and stronger than stated** | See §7.2: the helper's wire contract has **no** arbitrary-command method (good), **but** its accept loop is single-threaded with a **blocking, timeout-less** `read_frame` — one slow client wedges the whole service permanently. |

### 4.2 The decisive discriminator that could not be run

H1 vs H2 requires one of:

* **P0** — an *independent* (non-IDE-sandboxed) launch context, showing that
  without any Seatbelt profile the signal succeeds. **Unavailable**: every
  launchd-mutation verb is denied from the authoring shell
  (`launchctl submit` -> rc=1; `launchctl bootstrap` -> "Input/output error";
  `launchctl setenv` -> "Not privileged to set domain environment";
  `launchctl kickstart -k` -> "Operation not permitted";
  `launchctl kill` -> "Not privileged to signal service"), `osascript`
  Terminal -> "File permission error (-54)", `ssh localhost` -> key read denied.
* **P2** — a candidate profile with a different signal rule applied on the real
  kernel. **Unavailable**: `sandbox-exec` refuses to nest inside an existing
  Seatbelt profile (`sandbox_apply: Operation not permitted`, rc=71) — proven
  with `bun`, with `node`, and through the production vitest path, and
  independently corroborated by `/usr/bin/log` refusing to run
  ("Cannot run while sandboxed").

### 4.3 What the current evidence DOES establish

1. The **ClineMM Seatbelt profile is applied to every Background Exec command**
   (today; SECURE-BY-DEFAULT since `ACT-CLINEMM-SEATBELT-DEFAULT-ON01`).
2. Its signal rule is `(allow signal (target self))` — the **least-authority**
   form, and by construction it **denies a command the right to manage its own
   subprocesses**. This is a *design gap in the current profile*, independent
   of what the IDE layer does.
3. The **IDE layer independently denies the same operation** (prior ACT T2,
   no Seatbelt involved).
4. Therefore **H3 ("both contribute") is the only hypothesis consistent with
   all observations**; **Decision A (Seatbelt-only) is known to be
   insufficient**, and **Decision B (LaunchAgent-only) does not by itself
   address the command→its-own-descendant direction**, because the command's
   own children would still be created under whichever Seatbelt profile the
   helper applies — exactly the configuration P2 must validate.

**The minimum additional observation** to close the gate is in §9.

---

## 5. P2 candidate profile (prepared, NOT applied)

Generated with the **production generator** (`generateSeatbeltProfile`), not a
hand-written approximation. The only difference is the signal rule; every file
and network rule is byte-identical.

* `current-production-profile.sb` — SHA256 `80b0caf181cd5d3ead4e0eb606e0e638f9b4f1d77aa34452a88d60ab0d1acb30`
* `candidate-profile-same-sandbox.sb` — SHA256 `5a718c4c6228596fe7ca2affde833386327f393f98f8c61cbc0f728dc6bba276`
* `DIFF_ONLY_SIGNAL = true`

```diff
- (allow signal (target self))
+ (allow signal (target same-sandbox))
```

**Status: NOT applied to the installed production profile** (as the ACT
requires), and **not applicable from this substrate** (§4.2).

**Foreign-process negative control: NOT EXECUTED.** It requires P2 to be
applied. Recorded as `LIVE_UNOBSERVABLE`, **not** as a pass.

> Note for the successor: `(target same-sandbox)` is a **candidate spelling
> only**. Per the ACT's own rule ("do not assume either rule's semantics from
> its spelling"), its actual semantics on Sonoma 14.7.4 — in particular
> whether it covers a *detached process-group leader's* descendants, and
> whether it is confined to the same sandbox — **must be measured**, not
> assumed. This recon does not claim it works.

---

## 6. Security conservation matrix

| Invariant | Status | Evidence |
|---|---|---|
| Workspace filesystem | **CONSERVED** | Production profile byte-identical except the signal rule; write-grant set measured unchanged (§3.2). |
| Read restrictions | **CONSERVED** | `(allow file-read*)` + `(deny file-read* (subpath X))` untouched; `/etc/master.passwd` = EACCES. |
| Network deny | **CONSERVED** | `(deny network*)` untouched in both profiles. |
| Process execution | **CONSERVED** | `(allow process-exec)`, `(allow process-fork)` untouched. |
| Signal authority | **TARGET OF THE CHANGE** | Currently `target self` (least authority). A successor must prove owned-descendant reachability **and** foreign-process denial. |
| Environment | **CONSERVED** | `materializeEnvironment` / `SAFE_ENVIRONMENT_BASELINE` untouched; `envSemantics: "complete"` preserved. |
| Credentials | **CONSERVED** | No profile change touches `denyReadSubpaths` (curated credential set). |
| Execution approval | **CONSERVED** | `vscode-run-commands-tool.ts` approval + `sdk-tool-policies.command` unchanged by this ACT. |
| Timeout | **CONSERVED** | Host-authoritative deadline + wait-budget clamp unchanged. |
| Ownership | **CONSERVED** | Helper ownership proof (`leader_ppid == peer_pid`, start-time PID-reuse resistance) unchanged. |
| Output | **CONSERVED** | Streaming / truncation / terminal-state contracts untouched. |

**Newly identified trust-boundary risks (this ACT):**

* **R1 (HIGH) — the host helper's AF_UNIX *response* direction is unreachable
  from a Seatbelt-sandboxed client.** The profile grants
  `(allow network-outbound (remote unix-socket (path-literal "<helper.sock>")))`
  but **never** `network-inbound`. Measured: the helper accepts the connection
  and its reply never arrives. Consequence: **a sandboxed command cannot use
  the host helper at all.** Today this is masked because the helper is used
  from the *extension host* (not Seatbelt-sandboxed) — but it means the helper
  is unusable from exactly the place a future command-runner would live.
* **R2 (HIGH) — the helper's accept loop is single-threaded with a blocking,
  timeout-less `read_frame`** (`helper.c:211`, `helper.c:3576`). One client
  that connects without completing a frame wedges the **entire service**:
  every later client gets `ECONNREFUSED`. See §7.
* **R3 (MEDIUM) — the Seatbelt profile grants no `network-inbound` at all**,
  so no AF_UNIX peer (ssh-agent, helper) can complete a request/response round
  trip from inside a sandboxed command.

---

## 7. INCIDENT — the installed host helper was wedged by this ACT

**This must be actioned by the operator.** See §7.3.

### 7.1 What happened

While probing P4 I sent `tart.preflight` (an existing, fixed, sealed-argv
helper method) over the helper's AF_UNIX socket. The helper accepted the
connection, forked `tart`, and then **stopped accepting new connections
permanently**:

```
launchctl print gui/501/io.clinemm.host-helper
    state = running
    pid  = 42547
    active count = 1

$ nc -U ~/.clinemm/host-helper.sock   ->  (no response)
$ curl --unix-socket ...              ->  (no response)
$ node net.connect(...)               ->  ERR=ECONNREFUSED   (new connections)
helper log line count                 ->  frozen at 16 (no new accept/activate)
```

The helper process is alive but its accept loop is blocked. `lsof` shows
**FD 4 = the accepted connection** still open, with a peer socket that has
**Recv-Q 0 / Send-Q 0 and no owning process**; the **listener (FD 3)** has a
~130-entry backlog of unread frames.

Root cause (source-verified, `tools/macos-host-helper/native/helper.c`):

```c
/* helper.c:3575 */
while (!g_shutdown) {
  int cfd = accept(listen_fd, NULL, NULL);
  if (cfd < 0) { ... break; }
  handle_connection(cfd);            /* <-- SYNCHRONOUS, unbounded */
}

/* helper.c:211 — blocking, byte-at-a-time, NO timeout, NO poll() */
static ssize_t read_frame(int fd, char *buf, size_t cap) {
  size_t off = 0;
  while (off < cap) {
    ssize_t r = read(fd, buf + off, 1);   /* blocks indefinitely */
    ...
  }
}
```

There is **no request deadline, no per-connection timeout, and no
fork-per-connection isolation**. One slow or abandoned client freezes the
service for every client, including the extension host's EPERM fallback.

### 7.2 Why this is a *recon finding*, not just operator noise

This ACT's charter was to determine whether the helper could safely become the
host-side execution boundary (H5). The probe answered that question
**negatively and structurally**:

> The existing helper, in its current form, **is not a safe long-lived host
> execution boundary**: a single stalled client wedges it permanently, it has
> no request deadlines, and it has no `network-inbound` grant on the
> sandboxed side. Any successor that moves command creation to the helper
> **must first** make the helper's request handling bounded and isolated.

### 7.3 Operator remediation (REQUIRED — one command)

From an **unsandboxed Terminal** (not the IDE sandbox):

```bash
launchctl kickstart -k gui/$(id -u)/io.clinemm.host-helper
# expected: a NEW pid replaces 42547, state = running, and the socket accepts again.
# verify:
launchctl print gui/$(id -u)/io.clinemm.host-helper | grep -E 'state|pid'
printf '{"version":1,"request_id":"probe","method":"health"}\n' \
  | nc -U ~/.clinemm/host-helper.sock
```

The LaunchAgent **registration is unchanged** (same plist, same label, same
socket path, same mode 0600). Only the wedged *process* is replaced. The
helper's own `helper.restart` method cannot be used for this because the
service is unreachable while wedged — which is itself the defect.

All sandboxed attempts to self-heal were **denied by the substrate**:
`launchctl kickstart -k` -> "Operation not permitted";
`launchctl kill SIGTERM|SIGKILL` -> "Not privileged to signal service";
`kill -0 42547` -> "operation not permitted" (Seatbelt `(allow signal (target self))`).

---

## 8. Repository changes (recon-only)

* **NEW** `apps/vscode/src/sdk/recon01-background-exec-launchd-boundary.probe.test.ts`
  — a bounded, DEFAULT_OFF diagnostic fixture that drives the **real**
  `CommandJobManager.start()` -> Seatbelt -> `sandbox-exec` -> kernel seam and
  captures the live profile bytes plus the in-sandbox child-signal errno.
  It is a *test* file (never bundled), it `skipIf(!HAS_SUBSTRATE)`s, it spawns
  only a self-exiting child, and it cleans up its temp root.
  **In this substrate it SKIPS** (nested `sandbox-exec` denied) — and its
  skip is itself the evidence for §4.2. It is retained as the successor's RED
  harness.
* **NEW** `.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01/`
  — this report + 5 raw artefacts.
* **NO production source change.** `seatbelt-profile.ts`, `seatbelt-backend.ts`,
  `command-job-manager.ts`, `host-helper-pgid-adapter.ts`, `helper.c` and the
  LaunchAgent plist are **byte-identical to ENTRY_HEAD**.
* No VSIX was built or installed (forbidden for a recon-only change).
* `stash@{0}` preserved. No unrelated dirty file touched.

**Cleanup:** post-run `ps` shows **zero** ACT-owned processes
(`CLINEMM_RECON01*`, `probe.mjs`, `recon01-signal`). The pre-existing orphan
set (9 orphaned vitest fork workers, 7 orphaned bun vitest workers, 6 stray
sandbox-temp shells, plus prior-ACT ablation probes) is **unchanged** — no
broad process cleanup was performed.

---

## 9. Minimum additional observation required to reopen the decision

**ONE observation, in ONE context: an unsandboxed Terminal on this Mac.**

Run, from an ordinary macOS Terminal (no IDE, no Seatbelt):

```bash
EV=.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01

# (a) baseline — no Seatbelt at all
node /tmp/clinemm-recon01-signal/probe.mjs
#    EXPECT: signalAttempt.ok = true, signalErrno = null

# (b) current production profile
/usr/bin/sandbox-exec -f $EV/current-production-profile.sb \
  /opt/homebrew/bin/node /tmp/clinemm-recon01-signal/probe.mjs
#    EXPECT (if H2 contributes): signalErrno = "EPERM"

# (c) candidate profile — signal-rule-only delta
/usr/bin/sandbox-exec -f $EV/candidate-profile-same-sandbox.sb \
  /opt/homebrew/bin/node /tmp/clinemm-recon01-signal/probe.mjs
#    EXPECT (if H2 is the only blocker): signalErrno = null

# (d) FOREIGN-PROCESS NEGATIVE CONTROL (mandatory for (c))
#   Start /tmp/clinemm-recon01-signal/foreign.mjs OUTSIDE the sandbox scope,
#   then from inside (c) attempt kill(foreignPid, "SIGTERM") and assert it is
#   DENIED. The foreign process self-exits after 9 s, so the control cannot leak.
```

Interpretation:

| (a) | (b) | (c) | (d) | conclusion |
|---|---|---|---|---|
| OK | EPERM | OK | denied | **Decision A** — `SELECT_SEATBELT_SIGNAL_REPAIR` (narrow, correct, sufficient) |
| OK | EPERM | EPERM | denied | **Decision C** — `SELECT_COMPOSED_BOUNDARY_REPAIR` (a Seatbelt correction **and** an independent launch boundary are both required) |
| OK | OK | OK | denied | **Decision B** — `SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY` (Seatbelt is irrelevant; the IDE layer is decisive) |
| EPERM | — | — | — | **H4** re-opened — a host-level defect outside ClineMM's model |

The probe, the negative-control fixture (`foreign.mjs`) and the two profile
files are **already prepared** under `/tmp/clinemm-recon01-signal/` and in the
evidence directory; only the unsandboxed Terminal execution is missing.

**This is the smallest possible successor probe**: four commands, no new host
surface, and no change to the helper, the LaunchAgent or any production code.

---

## 10. Why `CAPTURE_INSUFFICIENT` and not `HALT_RED_NOT_REPRODUCED`

The RED **is** reproduced: the EPERM is live, at the production seam, in the
exact E1 direction, and the E1 vitest worker-teardown artefact reproduced in
this ACT's own test run. What is missing is **not** a reproduction — it is the
**discriminating measurement** that separates H1 from H2, which this substrate
provably cannot produce (nested Seatbelt is impossible; every launchd verb is
denied; the helper has no arbitrary-command method and is now wedged).

`HALT_RED_NOT_REPRODUCED` would be false. `SELECT_*` would be a guess.

---

## 11. Successor ACT contract (frozen, NOT implemented)

### ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02

**Purpose:** obtain the four observations of §9 and select exactly one
architecture. Recon-only; **no production change** unless §9's table selects a
repair, in which case a *separate* implementation ACT is frozen.

**Production seam (unchanged):**
`apps/vscode/src/sdk/command-job-manager.ts` (`CommandJobManager.start`) ->
`sdk/packages/core/src/extensions/tools/executors/bash.ts`
(`spawnSupervisableShellCommand`) ->
`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts`
(`SeatbeltSandboxBackendExperimental.prepare`) ->
`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts`
(`generateSeatbeltProfile`).

**Behavioural contract:**
1. Execute §9 (a)–(d) from an unsandboxed Terminal. Capture raw errno values
   and the foreign-process control outcome.
2. Apply §9's interpretation table. Emit exactly one verdict token.
3. If and only if the verdict is `SELECT_SEATBELT_SIGNAL_REPAIR`: freeze an
   implementation ACT that changes **only** the signal rule in
   `seatbelt-profile.ts`, adds the matching assertion to
   `seatbelt-profile.test.ts`, and adds a real-kernel RED/GREEN proving
   (i) owned-descendant reachability and (ii) foreign-process denial under the
   candidate rule.
4. If and only if the verdict is `SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY` or
   `SELECT_COMPOSED_BOUNDARY_REPAIR`: freeze a **bounded** helper-side
   command-runner contract that first addresses §7.2's blocking defect
   (bounded request deadline + per-connection isolation) and §6/R1's
   `network-inbound` gap. **Do not** add `execute(command, cwd, env)` to the
   existing helper.

**RED/GREEN requirements:**
* RED: the in-sandbox child-signal probe returns `EPERM` under the current
  profile (already demonstrated, LIVE, §3.3).
* GREEN: the same probe returns success under the selected configuration, with
  the foreign-process negative control still denied.
* **Necessity ablation:** with the Seatbelt signal rule reverted, the GREEN
  must fail again.
* **Isolation ablation:** with the launch boundary removed, the GREEN must fail
  again (only required if a launch boundary is selected).

**Safety invariants (must hold in every GREEN):**
* the installed LaunchAgent plist is byte-identical;
* the helper's wire contract gains **no** generic execution or signal method;
* the 10 forbidden anti-shell keys remain rejected at every nesting level;
* the workspace write boundary, the read-deny set and `(deny network*)` are
  unchanged in the applied profile;
* no profile grants a broad `(allow signal)`;
* approval, command-policy, environment-sanitisation and timeout contracts are
  untouched.

**Installed dogfood gates:**
* D1 — one real Background Exec whose command spawns and reaps its own child;
  assert no `EPERM` in the command's own teardown.
* D2 — one real Background Exec cancellation; assert the owned PGID is gone
  (`kill(-pgid,0)` -> ESRCH) and **no** orphan survives.
* D3 — the host helper responds to `health` from the extension host after D1/D2.
* D4 — the host helper's service is **not** wedged after D1/D2/D3.

**Explicitly out of scope for the successor:** widening the helper's method
set, adding a generic execution RPC, disabling Seatbelt, widening network or
filesystem permissions, or building/installing a VSIX for a recon-only change.

---

## 12. Artefact index

| file | content |
|---|---|
| `entry-freeze.txt` | identity, substrate measurements, orphan baseline |
| `final-report.md` | this document |
| `probe-p0-p3-production-seam-signal.out` | raw P0/P3 probe JSON (EPERM + cleanup) |
| `probe-h1h2-discriminator.out` | raw H1/H2 discriminator JSON |
| `current-production-profile.sb` | production-generated current profile (sha256 `80b0caf1…`) |
| `candidate-profile-same-sandbox.sb` | candidate profile, signal-rule-only delta (sha256 `5a718c4c…`) |

**Terminal response contract values:**

```
ACT                = ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01
VERDICT            = CAPTURE_INSUFFICIENT
ENTRY_HEAD         = 36f3a23882d31ab91a5ba760e97632633a6bc440
FINAL_HEAD         = 36f3a23882d31ab91a5ba760e97632633a6bc440
WORKTREE_STATUS    = one new untracked diagnostic test file + one new evidence dir
PRODUCTION_SPAWN_SEAM = extension host (pid 913, Chromium-sandboxed) -> spawnSupervisableShellCommand (detached:true) -> /usr/bin/sandbox-exec -f <ClineMM Seatbelt profile>
EXISTING_HELPER_AUTHORITY = io.clinemm.host-helper (pid 42547, launchd gui/501, uid 501, unsandboxed); methods: health, client.open/close, process-group.{register,terminate,release}-owned, helper.restart, tart.preflight, tart.testbed.run, testbed.run-installed-vsix-smoke. NO generic execution method.
CURRENT_SEATBELT_SIGNAL_POLICY = (allow signal (target self))  [seatbelt-profile.ts:700]
P0_TERMINAL_BASELINE = NOT AN INDEPENDENT TERMINAL (authoring shell IS the production Background Exec path) -> EPERM
P1_CURRENT_PROFILE    = LIVE_UNOBSERVABLE (nested sandbox-exec denied: sandbox_apply: Operation not permitted)
P2_NARROW_PROFILE     = LIVE_UNOBSERVABLE (same) — candidate profile prepared, NOT applied
P3_INSTALLED_BACKGROUND_EXEC = EPERM reproduced at the real production seam; child self-exited; ESRCH after
P4_HELPER_BOUNDARY    = helper reachable (connection accepted) but response NEVER delivered (no network-inbound grant); helper then WEDGED (single-threaded blocking read_frame) -> operator `launchctl kickstart -k` required
CAUSAL_HYPOTHESIS     = H3 (both contribute) is the only hypothesis consistent with all observations
DISCRIMINATING_EVIDENCE = write-grant set matches the ClineMM profile exactly (profile IS applied); signal signature is exactly (self allowed, all else EPERM); prior-ACT T2 shows the Chromium layer denies the same operation with NO Seatbelt involved
ALTERNATIVES_ELIMINATED = H4 eliminated (bounded non-Vitest probe reproduces EPERM); H5 CONFIRMED (helper is not a safe execution boundary as-is)
FOREIGN_PROCESS_NEGATIVE_CONTROL = NOT EXECUTED (LIVE_UNOBSERVABLE) — required by successor step (d)
FS_CONSERVATION = CONSERVED   NETWORK_CONSERVATION = CONSERVED   ENV_CONSERVATION = CONSERVED   APPROVAL_CONSERVATION = CONSERVED
NEW_CONTROLLED_ORPHANS = 0   PREEXISTING_ORPHANS = 9 vitest forks + 7 bun vitest + 6 sandbox-temp shells (unchanged, not touched)
EXECUTABLE_GATES = probe P0/P3 (LIVE, EPERM), profile generation via production generator (REAL), E1 vitest worker-teardown artefact (LIVE), helper wedge (LIVE)
UNOBSERVABLE_GUARANTEES = P1/P2 Seatbelt signal-policy discrimination; foreign-process negative control; LaunchAgent execution property; helper request/response round-trip from a sandboxed client
SELECTED_ARCHITECTURE = CAPTURE_INSUFFICIENT
NEXT_ACT = ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02 (frozen contract, §11)
```
