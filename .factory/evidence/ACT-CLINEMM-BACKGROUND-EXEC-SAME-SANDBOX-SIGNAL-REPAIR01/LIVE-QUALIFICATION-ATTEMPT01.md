# Live Qualification Attempt — 2026-11-05 (verdict `CAPTURE_INSUFFICIENT`)

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01`

**Authority:** the Factory review of `df48090f0`, verdict `C1: GO`, which
authorised execution of the live qualification procedure.

**Production source:** UNCHANGED. No production file was touched by this
qualification.

**Verdict:** `CAPTURE_INSUFFICIENT` — required kernel/identity observations
were unavailable. The live measurement could not be completed because the
dogfood extension host was running the **pre-repair** build.

`PASS_LIVE_PERMANENT_REPAIR` is **NOT** claimed. `FAIL_LIVE_REPAIR` is **NOT**
assigned either: no valid correlated measurement demonstrates a failure of the
permanent repair. The broader orphan-process question remains open.

## Gate-by-gate result

| Phase | Gate | Result |
| --- | --- | --- |
| 0a | process-free anti-controls | **PASS** — 10/10, verdict `PASS_ANTI_CONTROLS` |
| 0a | classifier contract matrix | **PASS** — 7/7, verdict `PASS_CLASSIFIER_CONTRACT` |
| 0 | operator preflight | **PASS** — dogfood main=77086, extension-host=77158, uid == operator uid |
| 1 | installed artifact identity | **FAIL** — installed bundle SHA-256 `7aba56e7…` ≠ required `e35de822…` |
| 1 | **loaded** bundle identity | **FAIL** — the live profile carries `(allow signal (target self))` |
| 1 | observer enabled | **PARTIAL** — observer is live, but its run id is `signal-exact-1793898271`, not `repair01-qualification` |
| 2 | production GREEN through Background Exec | **NOT_REACHABLE** — blocked upstream by the artifact-identity failure |
| 3 | observer correlation | **CAPTURE_INSUFFICIENT** — the mechanism is proven; the permanent profile was never generated |
| 4 | PGID cancellation | **HALT_UNSAFE_FIXTURE** — safe refusal, zero destructive signals |
| 5 | foreign-process denial | **HALT_UNSAFE_FIXTURE** — safe refusal, zero destructive signals; cleanup PASS |
| 6 | Vitest fork-worker teardown | **FAIL** — the teardown message is present; exact worker identity verified gone |

## The blocking defect: the installed artifact is the PRE-REPAIR build

The review required that the installed bundle be *established as the one
actually loaded by the dogfood extension host*, and that finding a matching
on-disk VSIX is **not sufficient by itself**. Both halves of that check were
performed, and both are decisive.

**On-disk artifact — CORRECT.** `dist/clinemm-signal-repair01.vsix`
(`sha256 f638ff5e…`) extracts to `extension/dist/extension.js` with
`sha256 e35de822bec46b697fad7e651206d73124796b2179c2e6a25a083adced6a8a66`,
carries `(allow signal (target same-sandbox))`, and carries **zero** traces of
the retired diagnostic markers.

**Installed artifact — WRONG.** The installed bundle is
`sha256 7aba56e769d322adb420f79f5c161e5bd4abb260761ff25a4ba73ace3e1fd0f9`,
from the extension directory
`s1onique.clinemm-4.1.16-5a1c485cb-1f456b971` — a build that **predates** the
permanent repair commit `d038b1e00` (`git merge-base --is-ancestor 1f456b971
d038b1e00` → true). It still contains:

* `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL` — 2 occurrences (the retired gate);
* `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL_COMMAND` — 1 occurrence;
* `armSeatbeltSignalRuleAuthorization` — 1 occurrence (the retired export);
* the pre-repair selector
  `(e.signalTarget??"self")==="same-sandbox"?"(allow signal (target same-sandbox))":"(allow signal (target self))"`.

**Loaded artifact — WRONG, and proven at the kernel seam.** The Seatbelt
profile is deleted after use, so it was captured LIVE, while a Background Exec
command was in flight, by reading the file at the observer's own
`profilePath`. The captured profile contains:

```text
(allow signal (target self))
```

which is the **pre-repair** rule. The permanent repair requires
`(allow signal (target same-sandbox))`. This was reproduced twice
(`prepareCallId` 447 and 452 in observer run `signal-exact-1793898271`).

**Consequence.** Every live measurement in Phases 2, 4 and 6 was taken against
the pre-repair profile. The production GREEN was therefore not merely
unreachable — it was **meaningless if it had been run**: it would have
measured the pre-repair build and dressed the result up as the permanent
repair. The artifact-identity gate is what prevented that false GREEN.

**Why the install could not be completed here.** `operator-qualification.sh
install` fails: `codium --install-extension` cannot `mkdir` in the dogfood
extensions directory (`EPERM`) nor in the dogfood logs directory (`EPERM`).
Direct `mkdir`, `touch` and `cp` into that tree fail identically. The cause is
the agent substrate's own Seatbelt write roots, which do not include
`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm` — this reproduces the
ceiling already recorded in `raw/substrate-limitation.txt` §4, and
`sandbox-exec` itself is denied (`sandbox_apply: Operation not permitted`,
rc=71), so the substrate cannot even re-enter a sandbox. This is an
environment limit, **not** a code defect.

## Live observations that DID execute

**Phase 4 — PGID cancellation.** Through the real Background Exec seam the
fixture refused safely:

```json
{"halt":"HALT_UNSAFE_FIXTURE",
 "haltReason":"identity-incomplete:argv,startIdentity,uid,pgid",
 "preSignalIdentityCheck":{"groupOwnershipHeld":false,
   "observed":{"liveness":{"state":"alive","errnoCode":"EPERM","delivered":false},"complete":false}},
 "signalAttempt":{"ok":false,"skipped":true,"target":"-1752"},
 "destructiveSignalsIssued":[]}
```

The cause was measured directly: inside the pre-repair sandbox, **every**
process-table observation of a child returns `EPERM` and `kill(child, 0)`
returns `EPERM`. The identity therefore cannot be established and **no**
group-directed signal is attempted. Zero destructive signals were issued.

**Phase 5 — foreign-process denial.** Also a safe refusal:

```json
{"halt":"HALT_UNSAFE_FIXTURE",
 "haltReason":"identity-incomplete:argv,startIdentity,uid,pgid",
 "authorizationCheck":{"method":"kill(pid, 0) — non-delivery authorization probe",
   "deliversSignal":false,"state":"alive","errnoCode":"EPERM"},
 "signalAttempt":{"ok":false,"skipped":true},
 "destructiveSignalsIssued":[],
 "foreignAliveBefore":true}
```

The foreign target received **no** signal. This result took the
`identity-incomplete` branch (the process-table observation failed), so
`authorizationDenial` is null; the P1 two-shape contract governs the
`target-unsignalable:EPERM` branch, which the `eperm-target` anti-control
exercises and machine-checks.

**Cleanup — PASS.** `foreign-stop` first reported `UNVERIFIABLE` while the
target was still inside its 12-second lifetime. That is correct fail-closed
behaviour: `EPERM` is never accepted as cleanup. After the target self-exited,
`foreign-stop` reported `PASS: pid=4728 is gone` (verified by `ESRCH`), and
the orphan check reported **NO ORPHANS**.

**Phase 6 — Vitest fork-worker teardown.** The focused suite passed **11/11**
with exit code 0, but the output contains one occurrence of
`Failed to terminate forks worker … Error: kill EPERM`. The exact worker
identity was observed live and then verified gone, per the runbook:

| Field | Value |
| --- | --- |
| worker PID | `8859` |
| start identity | `Thu Nov  5 23:42:02 2026` |
| argv | `<node> …/vitest/dist/workers/forks.js` |
| alive after the run | **false** |
| orphans left by this run | **0** |

The runbook's literal gate ("the output does not contain `Failed to terminate
forks worker`") is therefore **not** satisfied — but the message is attributable
to the pre-repair bundle denying the teardown `SIGTERM`, not to the permanent
repair. This gate must be re-measured after the permanent bundle is installed.

**Host context.** 27 orphaned forks workers already existed on this host,
every one of them started **before** this qualification run (latest start
20:33; this run was 23:41–23:42). They are pre-existing substrate state, not
produced by this qualification.

## Operator action required to complete the qualification

From an ordinary, unsandboxed Terminal on this host:

1. `bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-qualification.sh install`
   — installs `dist/clinemm-signal-repair01.vsix` into the dogfood extensions
   directory only, and aborts unless the installed bundle SHA-256 equals
   `e35de822bec46b697fad7e651206d73124796b2179c2e6a25a083adced6a8a66`.
2. Reload **only** the dogfood VSCodium window. Never quit the application.
3. Re-run the live phases in the runbook order: production GREEN with observer
   correlation → PGID cancellation → Vitest teardown → foreign-process denial
   (with the two-shape P1 contract) → adjudication.
4. Restart the dogfood instance with
   `CLINEMM_CAPTURE_SANDBOX_RUN_ID=repair01-qualification` so the runbook's
   `identity` stage succeeds, or amend the expected run id to the one actually
   in use.

## Artifacts

| File | Content |
| --- | --- |
| `raw/qualification-summary.json` | the adjudicated gate-by-gate result and the verdict |
| `raw/installed-bundle-identity.txt` | the installed vs. required bundle SHA-256 comparison |
| `raw/live-profile-rule-observation.txt` | the live `(allow signal (target self))` observation |
| `raw/pgid.result.json` | the Phase 4 live result |
| `raw/foreign.result.json` | the Phase 5 live result |
| `raw/vitest.stdout` | the Phase 6 vitest output |
| `raw/vitest-teardown-identity.txt` | the exact worker identity and its post-run state |
| `raw/dogfood-instance-identity.txt` | the preflight identity of the dogfood instance |

## What is NOT claimed

* The permanent repair is **NOT** qualified at the live production seam.
* The broader orphan-process problem is **NOT** solved. The PGID and Vitest
  teardown measurements were taken against the pre-repair profile and must be
  re-measured.
* No production source change was made by this qualification.
