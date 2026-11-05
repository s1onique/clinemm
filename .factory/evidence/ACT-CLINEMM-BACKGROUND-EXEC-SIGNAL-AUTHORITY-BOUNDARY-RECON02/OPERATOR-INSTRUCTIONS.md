# RECON02 — Operator Instructions

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02`

**Goal:** obtain four real-kernel measurements (A/B/C/D) that RECON01 could not
produce, because every agent-executed command was already inside the IDE sandbox.

**Execution substrate:** an independent, unsandboxed macOS Terminal.app window,
launched **directly from Finder / Spotlight / Launchpad** — NOT from inside
VSCodium, NOT from a VSCodium integrated terminal, NOT via `osascript`.

**This ACT makes NO production change.** It runs four probes and records them.

---

## 0. P1 correction — the previous probe D measurement was INVALID

The P0 harness run produced this matrix:

| Probe | Observed | Assessment |
|---|---|---|
| A — no Seatbelt | SIGTERM delivered; child exited | **PASS** |
| B — current `(target self)` | `EPERM`; child self-exited | **PASS** |
| C — candidate `(target same-sandbox)` | SIGTERM delivered; child exited | **PASS** |
| D — foreign-process control | `EPERM`, but the WRONG PID was targeted | **INVALID** |

Probe D signalled PID `7264`, the Python deadline **supervisor**, instead of
PID `7283`, the actual foreign **Node.js** process:

```
FOREIGN_SUPERVISOR_PID=7264
FOREIGN_PID=7264
FOREIGN_READY pid=7283 ppid=7264 marker=CLINEMM_RECON01_FOREIGN_CONTROL
```

The cause was a **greedy** marker parse:

```bash
sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p'     # matches the "pid=" inside "ppid="
```

The `.*` is greedy, so it matched the `pid=` suffix of `ppid=7264`. The
identity check then passed anyway, because the supervisor's own command line
contains the path to `foreign.mjs` as a trailing argument.

`D_CLASSIFICATION=DENIED_EXPECTED` is therefore **not** authoritative evidence
that the intended foreign process was protected. The EPERM was real, but it
described a different process.

**What is established:** Seatbelt policy is an independent cause of `EPERM`
(B fails, C succeeds, differing only in the profile rule), and the candidate
permits controlled child termination. **What is not established:** foreign
process isolation.

**What changed in the harness (R7):**

1. The marker is parsed with an **anchored** expression, so the pid is bound
   to the field that actually carries it.
2. The target must be proven to be the **Node child** of the deadline
   supervisor: it must not be the supervisor itself, and its observed `ppid`
   must equal the supervisor's pid.
3. The argv check must prove that **argv[0] IS the Node executable** running
   the fixture — not a process that merely mentions the fixture path in a
   trailing argument.

**Operator action:** re-run the harness. **A/B/C do not need to be repeated** —
they are valid evidence and repeating them is only a consistency check. The
harness runs all four anyway; the point is that only **D** is a new
measurement. If D again targets the supervisor, the harness now **halts with
`HALT_UNSAFE_FIXTURE`** instead of recording a misleading denial.

---

## 0.1 Before you start

Do **not** run this from ClineMM Background Exec. Do not run it from a
VSCodium integrated terminal. Do not nest `sandbox-exec` inside the IDE
sandbox. Do not use `sudo`. Do not disable SIP, App Sandbox, or Chromium
sandboxing. Do not restart or modify the LaunchAgent or the installed helper.

The harness **verifies all of this itself** during preflight and aborts if the
substrate is wrong. If preflight aborts, stop and report the message.

---

## 1. Run the harness

In the independent Terminal:

```bash
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02/operator-probes.sh
```

It takes roughly 30–45 seconds.

### Exit status

| Code | Meaning |
|---|---|
| `0` | All four probes executed and recorded. **Inspect `raw/summary.txt`** for the verdict — the harness does not choose an architecture for you. |
| `2` | Preflight or safety failure (`HALT_BASELINE_INVALID` / `HALT_UNSAFE_FIXTURE` / `HALT_UNSAFE_SIGNAL_SCOPE`). **Report verbatim and stop.** |
| `3` | A probe could not produce a measurement (substrate failure). **Report verbatim and stop.** |

### What the harness does automatically

* Verifies `node` resolves and is executable.
* Verifies both profiles are readable and the **candidate SHA-256 matches the
  frozen value** `5a718c4c6228596fe7ca2affde833386327f393f98f8c61cbc0f728dc6bba276`.
* Verifies the **only** difference between the two profiles is the signal rule.
* Creates `/private/tmp/clinemm-recon01-tmp` and `/private/tmp/clinemm-recon01-ws`
  with mode `700` and uses the former as `TMPDIR`.
* Verifies `sandbox-exec` can actually apply a profile here (i.e. you are **not**
  already inside a sandbox).
* Runs A, then B, then C, then D, capturing stdout, stderr, exit status and
  timestamps **separately** for each.
* Verifies cleanup after **every** probe and aborts on any residual
  `CLINEMM_RECON0*` process.
* Never uses `pkill`, `killall`, or a process-group sweep. It only ever signals
  a PID it created and, for probe D, verified by `ps`.
* **Before signalling in probe D**, proves the target is the Node child of the
  deadline supervisor (anchored marker parse + observed `ppid` + `argv[0]` is
  the Node executable). If any of those fail it halts with
  `HALT_UNSAFE_FIXTURE` and signals nothing.

### Bounds (no probe can leak)

* The probe child self-exits after **4000 ms** and the parent waits at most
  **6000 ms** for it.
* The foreign control self-exits after **9000 ms**.
* The watchdog only *observes*; it never signals the foreign process.

---

## 2. Read the results

```bash
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02
cat raw/summary.txt
```

`raw/summary.txt` is the compact matrix. The full JSON for each probe is in
`raw/probe-{a,b,c}.result.json` and `raw/probe-d.result.json`; the raw
stdout/stderr are in `raw/probe-*.stdout` / `raw/probe-*.stderr`.

**The harness's own summary is authoritative.** It parses
`PROBE_RESULT_JSON` / `FOREIGN_SIGNAL_RESULT_JSON` and classifies every
probe from the JSON booleans themselves: `signalAttempt.ok` is the primary
signal result, `signalErrno` classifies only a failed attempt, and
`foreignReceivedSIGTERM` is the JSON boolean (not a marker count). A probe
whose fixture exits nonzero is rejected even if it printed a complete-looking
payload. For manual review, the same fields are available in the raw JSON
files together with `childStillAliveAfter` / `foreignAliveAfter` and the
`CHILD_GOT_SIGTERM` / `FOREIGN_GOT_SIGTERM` markers inside the child output.

### 2.1 Probe D MUST be sanity-checked before it is believed

A `DENIED_EXPECTED` classification is only meaningful if the harness
signalled the **intended** process. Check `raw/probe-d.identity.txt`:

```
FOREIGN_PID=<the node pid>
FOREIGN_SUPERVISOR_PID=<the supervisor pid>
FOREIGN_ACTUAL_PPID=<must equal FOREIGN_SUPERVISOR_PID>
FOREIGN_OWNERSHIP=OWNED
FOREIGN_ARGV_CLASS=FIXTURE_NODE
FOREIGN_ARGV=<must begin with the node executable and carry foreign.mjs>
```

All of the following must hold:

* `FOREIGN_PID` != `FOREIGN_SUPERVISOR_PID`;
* `FOREIGN_ACTUAL_PPID` == `FOREIGN_SUPERVISOR_PID`;
* `FOREIGN_OWNERSHIP` == `OWNED`;
* `FOREIGN_ARGV_CLASS` == `FIXTURE_NODE`.

If `FOREIGN_PID` equals `FOREIGN_SUPERVISOR_PID`, the marker parse regressed
to the greedy form and the measurement is **INVALID** regardless of what the
classification says. The harness now refuses to reach that state — it halts
with `HALT_UNSAFE_FIXTURE` before signalling — but the raw identity file is
the authoritative record to inspect.

---

## 3. Map the results to a verdict

Copy the four outcomes into this table:

| Probe | Context | Child SIGTERM | Foreign SIGTERM | Cleanup |
|---|---|---|---|---|
| A | Independent Terminal, no Seatbelt | | — | |
| B | Independent Terminal, current profile | | — | |
| C | Independent Terminal, candidate profile | | — | |
| D | Candidate profile vs controlled foreign target | — | | |

Then apply the ACT's causal table. Note the **two gates** (R6):

**Gate 1 — Terminal qualification** (what the harness prints as `DECISION`):

| A | B | C | D | Verdict |
|---|---|---|---|---|
| Success | EPERM | Success | denied (EPERM) | `READY_FOR_OPERATOR_PROBES` — candidate rule QUALIFIED standalone |
| Success | EPERM | EPERM | denied (EPERM) | `READY_FOR_OPERATOR_PROBES` — candidate rule INSUFFICIENT standalone |
| Success | Success | Success | denied (EPERM) | `READY_FOR_OPERATOR_PROBES` — current rule did not reproduce the denial |
| EPERM / ESRCH / invalid | any | any | any | `HALT_BASELINE_INVALID` |
| Success | any | any | **signal allowed** | `HALT_UNSAFE_SIGNAL_SCOPE` |
| Success | any | any | ESRCH / missing evidence / unexpected errno | `CAPTURE_INSUFFICIENT` |

**Gate 2 — architecture selection** requires a **separate production-seam
observation** for the same candidate rule. Only then may the verdict become
`SELECT_SEATBELT_SIGNAL_REPAIR`, `SELECT_COMPOSED_BOUNDARY_REPAIR` or
`SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY`. This Terminal-only harness hard-codes
`PRODUCTION_CONTEXT_EVIDENCE=NO`; there is no environment override, so it can
never select an architecture. It prints `READY_FOR_OPERATOR_PROBES` and says
so. Architecture selection is performed separately, from real production
evidence.

**Important:** a successful C in the Terminal is **not** a successful C under
VSCodium. The inherited Chromium sandbox is a separate authority. See
`entry-identity.txt` → `INHERITED-HOST EVIDENCE (E3)` for the historical
evidence and its caveats.

---

## 4. Return the raw results

Send back, and commit under the same evidence directory:

* `raw/` in its entirety (raw stdout, stderr, exit codes, timestamps, summary).
* The SHA-256 of every file in `raw/`:

```bash
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02
shasum -a 256 raw/* | tee raw/SHA256SUMS.txt
```

Do **not** edit the raw files. Do not overwrite RECON01's archived evidence.

---

## 5. Cleanup

The harness cleans up after itself and verifies it. After the run:

```bash
ps -Ao pid,ppid,pgid,command | grep -E 'CLINEMM_RECON0[12]' | grep -v grep
```

Expected: **empty**. If anything remains, report it — do **not** sweep it with
a broad `pkill`. The pre-existing orphan residue from earlier ACTs (9 vitest
fork workers, 7 bun vitest workers, stray sandbox-temp shells) is historical,
is recorded in `/tmp/clinemm-recon01-pre-orphans.txt`, and is **not** to be
cleaned up here.
