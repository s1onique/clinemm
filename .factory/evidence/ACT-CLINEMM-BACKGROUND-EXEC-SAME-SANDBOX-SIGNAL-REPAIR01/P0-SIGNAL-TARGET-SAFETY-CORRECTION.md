# Bounded P0 Signal-Target Safety Correction — 2026-11-05

**Scope:** ONE bounded correction inside the existing qualification ACT. No new
ACT, no architecture revisit, no production source change.

**Authority:** the Factory review of correction `c0e5fb3ea`, verdict
`PASS_WITH_BOUNDED_P0_REMAINDER`, with
`HALT_UNSAFE_SIGNAL_TARGET` for the foreign and PGID measurements.

**Production source:** UNCHANGED. Commits `d038b1e00` and `487a80ef7` are
preserved verbatim.

---

## The three defects that were corrected

### P0-1 — Foreign-process PID was not revalidated before SIGTERM

**Before:** `foreign-signal-attempt.mjs` accepted a bare numeric PID and
immediately called `process.kill(foreignPid, "SIGTERM")`. The foreign target
has a 12-second lifetime, so it could expire between the operator recording
the PID and the fixture running, and the recorded PID could then have been
reused by an unrelated process.

**After:**

1. The expected target identity — **argv, UID, process start identity** — is
   now a REQUIRED input. Missing identity is a hard block, not a default.
2. The identity is **re-verified immediately before** the signaling attempt
   through the shared fail-closed gate in `probe-fixtures/target-identity.mjs`.
3. A **non-mutating signal-zero authorization check** (`kill(pid, 0)`) runs
   first. Signal zero delivers no signal; it only reports whether signaling
   would be permitted. It is recorded under `authorizationCheck` with
   `deliversSignal: false` so it can never be misread as a delivery attempt.
4. Any missing, unreadable, or changed field emits `HALT_UNSAFE_FIXTURE` and
   signals NOTHING.

### P0-2 — PGID identity was verified only during cleanup

**Before:** `pgid-cancellation-fixture.mjs` captured the child's start identity
and argv at spawn time, then called `process.kill(-pgid, "SIGTERM")` WITHOUT
re-verifying that the recorded child still owned that process group.

**After:**

1. The child's PID, **process-group id**, argv, UID and process start identity
   are re-verified IMMEDIATELY before the group-directed signal, through the
   same shared gate.
2. The OBSERVED process group id must still equal the group id captured at
   spawn time. A detached spawn on macOS gives the child its own group
   (`pgid == pid`); if that relationship no longer holds, the group id may
   have been reused and the group-directed signal is refused.
3. Any missing, unreadable, or changed field emits `HALT_UNSAFE_FIXTURE` and
   signals NOTHING — including no cleanup signal.
4. The identity-checked direct cleanup signal now routes through the same
   shared gate.
5. **Every** `ps` observation has a FINITE timeout (`PS_TIMEOUT_MS = 2000`),
   so a slow or blocked process-table read cannot consume the child's whole
   finite lifetime before the measurement.

### P0-3 — Cleanup classification promoted `EPERM` to absence

**Before:** `operator-qualification.sh` classified a process by string-matching
the text of `kill -0` output and fell back to "the `ps` lookup returned
nothing, therefore the process is GONE". That fallback is unsound:

* `kill -0` failing with `EPERM` means **the process EXISTS but we may not
  signal it**. Promoting that to `GONE` loses a live process.
* If the `ps` lookup itself FAILED (tool missing, timeout, unreadable process
  table) the lookup returns EMPTY, and the old code promoted that empty result
  to `GONE` — reporting absence from a FAILED observation.

**After:** classification uses the **actual errno** from the Node runtime via
`probe-fixtures/classify-process-state.mjs`:

| errno / observation | classification |
| --- | --- |
| `rc = 0` | `ALIVE` |
| `ESRCH` | `GONE` — the ONLY thing that establishes absence |
| `EPERM` | `UNVERIFIABLE` — never absence, whether or not the process table can be read |
| any other errno | `UNVERIFIABLE` |
| any errno + FAILED process-table observation | `UNVERIFIABLE` |

---

## Process-free anti-controls

The review required process-free anti-controls proving that no destructive
signal is invoked for an unsafe target. They are implemented in
`probe-fixtures/anti-control-scenarios.mjs` and executed by
`probe-fixtures/anti-control-runner.mjs`.

Every scenario drives the **real fixture code paths** in their `--anti-control`
mode against a SYNTHETIC process table. The identity observation is injected
and the signal sink is a recorder, so no real process is ever observed or
signalled.

| scenario | expected outcome | destructive signals |
| --- | --- | --- |
| `stale-pid` | `HALT_UNSAFE_FIXTURE` (`identity-mismatch`) | 0 |
| `missing-identity` | `HALT_UNSAFE_FIXTURE` (`identity-incomplete`) | 0 |
| `expired-target` | `HALT_UNSAFE_FIXTURE` (`target-absent:ESRCH`) | 0 |
| `changed-argv` | `HALT_UNSAFE_FIXTURE` (`argv:changed`) | 0 |
| `unreadable-metadata` | `HALT_UNSAFE_FIXTURE` (`identity-incomplete`) | 0 |
| `changed-start-identity` | `HALT_UNSAFE_FIXTURE` (`startIdentity:changed`) | 0 |
| `changed-uid` | `HALT_UNSAFE_FIXTURE` (`uid:changed`) | 0 |
| `changed-pgid` | `HALT_UNSAFE_FIXTURE` (`pgid:changed`) | 0 |
| `eperm-target` | `HALT_UNSAFE_FIXTURE` (`target-unsignalable:EPERM`) | 0 |
| `healthy` (CONTROL) | no halt | exactly 1 |

The `healthy` control is load-bearing: it proves the anti-controls are not
vacuous. The runner asserts, for every scenario, the recorded signal count,
the halt marker, the `skipped` flag, and the refusal reason.

### A defect the anti-controls FOUND

The `eperm-target` anti-control initially FAILED: the gate permitted a
destructive signal when the target existed but was not signalable (`EPERM`).
That was a real remaining defect — `EPERM` must block a destructive attempt,
because the resulting errno could not be distinguished from a genuine
authorization denial. The gate now refuses with `target-unsignalable:EPERM`.

### Classifier contract matrix

`probe-fixtures/classify-process-state.mjs --contract` proves the P0-3
classification table above against every errno/observation combination,
including the two cases the old code got wrong (`EPERM` + failed lookup, and
`EPERM` + empty lookup). A real `EPERM` requires a process owned by another
user, which cannot be manufactured portably, so the decision is exposed as a
pure function and the matrix is the machine-checkable statement of the
contract.

---

## Files changed (evidence directory only)

| File | Change |
| --- | --- |
| `probe-fixtures/target-identity.mjs` | NEW — shared fail-closed identity gate, finite `ps` timeouts, signal-zero probe. |
| `probe-fixtures/classify-process-state.mjs` | NEW — errno-based fail-closed state classifier + contract matrix. |
| `probe-fixtures/anti-control-scenarios.mjs` | NEW — synthetic process-table scenarios. |
| `probe-fixtures/anti-control-runner.mjs` | NEW — process-free anti-control runner. |
| `probe-fixtures/foreign-signal-attempt.mjs` | Required identity + signal-time re-verification + non-mutating signal-zero authorization check + `HALT_UNSAFE_FIXTURE`. |
| `probe-fixtures/pgid-cancellation-fixture.mjs` | Pre-signal PID/PGID/argv/UID/start-identity verification + finite `ps` timeouts + `HALT_UNSAFE_FIXTURE`. |
| `operator-qualification.sh` | `process_state()` now uses the errno-based classifier; `foreign-start`/`foreign-stop` capture and verify UID. |
| `QUALIFICATION-RUNBOOK.md` | Phase 0a anti-controls; new Phase 4 / Phase 5 signal-time gates. |
| `raw/anti-controls.jsonl` | NEW — anti-control run output. |
| `raw/classifier-contract.jsonl` | NEW — classifier contract output. |

---

## Verified results

```
$ node probe-fixtures/anti-control-runner.mjs
[anti-control] PASS stale-pid — foreign=HALT_UNSAFE_FIXTURE pgid=HALT_UNSAFE_FIXTURE
[anti-control] PASS missing-identity — foreign=HALT_UNSAFE_FIXTURE pgid=HALT_UNSAFE_FIXTURE
[anti-control] PASS expired-target — foreign=HALT_UNSAFE_FIXTURE pgid=HALT_UNSAFE_FIXTURE
[anti-control] PASS changed-argv — foreign=HALT_UNSAFE_FIXTURE pgid=HALT_UNSAFE_FIXTURE
[anti-control] PASS unreadable-metadata — foreign=HALT_UNSAFE_FIXTURE pgid=HALT_UNSAFE_FIXTURE
[anti-control] PASS changed-start-identity — foreign=HALT_UNSAFE_FIXTURE pgid=HALT_UNSAFE_FIXTURE
[anti-control] PASS changed-uid — foreign=HALT_UNSAFE_FIXTURE pgid=HALT_UNSAFE_FIXTURE
[anti-control] PASS changed-pgid — foreign=HALT_UNSAFE_FIXTURE pgid=HALT_UNSAFE_FIXTURE
[anti-control] PASS eperm-target — foreign=HALT_UNSAFE_FIXTURE pgid=HALT_UNSAFE_FIXTURE
[anti-control] PASS healthy — foreign=none pgid=none
verdict: PASS_ANTI_CONTROLS   (10/10)

$ node probe-fixtures/classify-process-state.mjs --contract
[classifier-contract] PASS signal-zero succeeds — expected=ALIVE actual=ALIVE
[classifier-contract] PASS ESRCH — the ONLY thing that establishes absence — expected=GONE actual=GONE
[classifier-contract] PASS EPERM with the process visible in the process table — expected=UNVERIFIABLE actual=UNVERIFIABLE
[classifier-contract] PASS EPERM with a FAILED process-table observation must not become GONE — expected=UNVERIFIABLE actual=UNVERIFIABLE
[classifier-contract] PASS EPERM with a successful but EMPTY process-table observation must not become GONE — expected=UNVERIFIABLE actual=UNVERIFIABLE
[classifier-contract] PASS an unknown errno with a FAILED process-table observation — expected=UNVERIFIABLE actual=UNVERIFIABLE
[classifier-contract] PASS an unknown errno with an empty process-table observation — expected=UNVERIFIABLE actual=UNVERIFIABLE
verdict: PASS_CLASSIFIER_CONTRACT   (7/7)
```

---

## What remains OUT OF SCOPE for this bounded correction

* The **production GREEN** through Background Exec, the **installed permanent
  build** live GREEN, the **Vitest worker teardown** measurement, and the
  **wider orphan-process question** are unchanged open live-qualification
  items. The permanent source repair remains accepted.
* The live `PASS_LIVE_PERMANENT_REPAIR` verdict is still NOT claimed. This
  correction only makes the foreign and PGID measurements SAFE TO RUN.

## Substrate note

In the agent substrate used to author this correction, a child spawned by the
fixture is **not observable** by `ps` (`EPERM` on every process-table
observation) and `kill(pid, 0)` also returns `EPERM`. The corrected fixtures
therefore FAIL CLOSED there — they emit `HALT_UNSAFE_FIXTURE` and signal
nothing. That is the correct behaviour and it is why the anti-controls are
PROCESS-FREE: they prove the decision logic without needing a substrate that
can manufacture the unsafe states.

The destructive measurements must be run from the installed dogfood ClineMM
Background Exec path, where the process table is observable.
