ACT-CLINEMM-TART-P4.1-POSTREVIEW-CORRECTION01 — bounded fix status

**Status:** GREEN on the hermetic test surface. Real-guest smoke
(Phase 2 of the ACT) remains DEFERRED to the operator.

**Bounded fixes (in helper.c, smoke_invoke_bounded + handle_tart_guest_smoke):**

1. **Process-group termination.** The child calls setpgid(0,0);
   the parent mirrors with setpgid(pid,pid) (race-safe). On
   timeout, the helper signals the entire pgrp with
   kill(-pid, SIGKILL). Group identity is verified
   (getpgid(pid) == pid) before signaling; on macOS Background
   sessions that return EPERM, the helper falls back to
   per-process kill of the direct child. The previous
   implementation only signaled the direct child, leaving
   orphaned descendants holding stdout/stderr pipe FDs and
   hanging the helper's poll loop until they were reaped by
   the kernel (could be 60+ seconds for sleep 60).

2. **O_NONBLOCK pipe FDs.** The parent sets the pipe read ends
   to non-blocking so a leftover descendant cannot block the
   poll loop indefinitely. EAGAIN is treated as try again on
   the next poll cycle, not as EOF.

3. **Request-level deadline with fail-fast.** The handler
   enforces SMOKE_REQUEST_DEADLINE_MS = 28s. If the first
   diagnostic (sw_vers) times out, the handler does NOT run
   the second (uname_a); it returns TART_EXEC_TIMEOUT
   immediately with the second diagnostic at the structural
   zero default (exit_code=0, duration_ms=0, empty stdout,
   timeout=false). The previous implementation ran both
   diagnostics sequentially with 30s timeouts each, which
   could not fit within the test 35s socket deadline.

4. **Bounded reap with abandonment.** The reap loop has a
   2s wallclock deadline. If the direct child is not reaped
   within that window, the helper SIGKILLs the child, gives
   it a final 1s to become a zombie, and then abandons the
   reap and returns with the timeout classification already
   set. The previous implementation could hang indefinitely
   on macOS if a process-group-killed child could not be
   reaped (kernel edge case on Background sessions).

**New tests (in tart-guest-smoke.test.ts):**

- **GS-08 (updated):** Per-bun-test timeout bumped to 60s; socket
  wait 40s; asserts TART_EXEC_TIMEOUT, sw_vers.timeout=true,
  uname_a at the zero default (not run), and total wallclock
  under 35s.
- **GS-14 (new):** Descendant cleanup proof. A separate fake-tart
  does exec) sleep 60 ;. After the helper returns
  TART_EXEC_TIMEOUT, the test waits 500ms then uses
  ps -axo pid,ppid,command to verify no sleep 60 process
  is still alive with the helper PID as its parent.

**Test results (over 3 consecutive runs of the full
tart-guest-smoke.test.ts):**

| Run | Pass | Fail | Notes |
| --- | ---- | ---- | ----- |
| 1   | 24   | 1    | GS-10 (pre-existing flaky concurrent --version race) |
| 2   | 24   | 1    | same |
| 3   | 24   | 1    | same |

The two new tests (GS-08 and GS-14) pass on 9/9 runs when
filtered. The 1 fail is always the pre-existing GS-10
two-concurrent-requests test, which has the same flakiness
on main without any of my changes (verified via stash +
rerun). GS-10 flakiness is the helper pre-existing
tbr_invoke_bounded returning kind != 0 on a race
between two concurrent AF_UNIX connection requests; fixing
it is OUT OF SCOPE for the bounded timeout fix and should
be addressed in a follow-up ACT.

**Test isolation improvement:** The test afterEach is
now async and awaits the helper proc.kill() plus a
100ms reaping grace. Without this, the next test helper
could inherit a busy pgrp or a lingering orphan that holds
pipes open.

**Conservation (per ACT §12):**

| Rule | Status |
| ---- | ------ |
| Arbitrary host or guest execution exposed | 0 (closed envelope) |
| Caller-selected VM or executable | 0 (CLINEMM_SMOKE_VM is sealed) |
| Invalid target identity accepted | 0 |
| Native parser bypass | 0 (P0-2 from prior cycle still enforced) |
| Foreign VM mutation | 0 |
| Destructive operation against imported source VM | 0 |
| Launchd mutation from the agent | 0 |
| Seatbelt relaxation | 0 |
| Failed guest command reported successful | 0 (kind=1 -> overall=TART_EXEC_TIMEOUT, ok:false) |
| Unbounded subprocess escape | 0 (process-group kill + bounded reap) |
| Unexpected tracked dirt | 0 (working tree only changes helper.c + the new tests; no shared-file expansion) |
| Artifact identity mismatch | 0 (helper SHA + build_id + source HEAD recorded) |
| New env knob | 0 |
| New protocol field | 0 |

**Status disposition (per the on-call verdict):**

TART_P4.1:
  HALT_ACT_OWNED_TIMEOUT_FAILURE -> PASS_HERMETIC_FIX_PENDING_REAL_GUEST
  REAL_GUEST_NOT_AUTHORIZED
  ACT_OWNED_FLAKY_GS_10_FOLLOWUP

**Next cursor (per the expert verdict):** tart run +
agent-driven tart.guest.smoke + tart stop (Phase 2 of
the ACT) — operator-side, with the installed imported
Sonoma VM. The bounded fix unblocks Phase 2 by ensuring
the helper will return TART_EXEC_TIMEOUT in bounded wallclock
with no orphaned subprocesses.
