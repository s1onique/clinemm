# RECON02 — Operator Instructions

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02`

**Goal:** obtain four real-kernel measurements (A/B/C/D) that RECON01 could not
produce, because every agent-executed command was already inside the IDE sandbox.

**Execution substrate:** an independent, unsandboxed macOS Terminal.app window,
launched **directly from Finder / Spotlight / Launchpad** — NOT from inside
VSCodium, NOT from a VSCodium integrated terminal, NOT via `osascript`.

**This ACT makes NO production change.** It runs four probes and records them.

---

## 0. Before you start

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

**The parent's exit code is not authoritative.** Parse `PROBE_RESULT_JSON` /
`FOREIGN_SIGNAL_RESULT_JSON` and use the `signalAttempt.ok`, `signalErrno`,
`childStillAliveAfter` / `foreignAliveAfter` and the `CHILD_GOT_SIGTERM` /
`FOREIGN_GOT_SIGTERM` markers inside the child output.

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
`SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY`. The harness never selects an
architecture on Terminal-only evidence; it prints
`READY_FOR_OPERATOR_PROBES` and says so.

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
