#!/usr/bin/env python3
"""
ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02
deadline-supervisor.py — enforces a REAL execution deadline for a child
command without requiring any external signalling permission.

Design (P0 harness correction, R3):
  * The supervisor FORKS the target and supervises it in-process. It does
    NOT exec, and it does NOT call setsid(). This keeps the supervisor in
    the harness's own session so that, in an unsandboxed Terminal, it is
    permitted to signal the target and the target's process group.
  * The deadline is enforced by the SUPERVISOR ITSELF: when the budget
    expires it exits with status 137. The deadline therefore fires even
    in a substrate where signalling is denied — the harness can never hang.
  * On overrun the supervisor attempts a best-effort SIGKILL of the target
    pid and of the target's process group. If those are denied, it records
    the fact on stderr and STILL exits 137. The harness then reports the
    residual honestly rather than claiming cleanup.
  * The target's stdout/stderr are inherited, so the harness captures the
    target's output directly.

Usage:
  deadline-supervisor.py <deadline_seconds> <cmd> [args...]

Exit status:
  0..126, 128+n   the target's own exit status
  137             the deadline expired (target killed, or kill denied)
"""
import os
import sys
import time


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write("usage: deadline-supervisor.py <deadline_seconds> <cmd> [args...]\n")
        return 2

    try:
        deadline = float(sys.argv[1])
    except ValueError:
        sys.stderr.write("deadline-supervisor.py: deadline must be numeric\n")
        return 2

    argv = sys.argv[2:]

    # Resolve the target through PATH ourselves: the supervisor may run with
    # a minimal environment, so a bare command name would otherwise fail to
    # exec with ENOENT.
    if argv and "/" not in os.path.basename(argv[0]):
        from shutil import which
        resolved = which(argv[0])
        if resolved:
            argv = [resolved] + argv[1:]

    pid = os.fork()
    if pid == 0:
        # Child: become the target. Do not setsid() — stay in the
        # supervisor's session so the supervisor may signal it.
        try:
            os.execv(argv[0], argv)
        except Exception as exc:  # pragma: no cover - exec failure path
            sys.stderr.write("deadline-supervisor.py: exec failed: %s\n" % exc)
            os._exit(127)

    started = time.time()
    deadline_at = started + deadline

    while True:
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            wpid = pid
            status = 0
        if wpid == pid:
            elapsed = time.time() - started
            sys.stderr.write(
                "deadline-supervisor.py: TARGET_EXITED pid=%d elapsed=%.3f\n" % (pid, elapsed)
            )
            try:
                return os.waitstatus_to_exitcode(status)
            except AttributeError:  # pragma: no cover - Python < 3.9
                return status >> 8

        if time.time() >= deadline_at:
            elapsed = time.time() - started
            sys.stderr.write(
                "deadline-supervisor.py: DEADLINE_EXCEEDED pid=%d elapsed=%.3f budget=%.3f\n"
                % (pid, elapsed, deadline)
            )
            # Best effort: kill the target, then the target's process group.
            try:
                os.kill(pid, 9)
                sys.stderr.write("deadline-supervisor.py: SIGKILL sent to pid %d\n" % pid)
            except Exception as exc:
                sys.stderr.write("deadline-supervisor.py: SIGKILL pid failed: %s\n" % exc)
            try:
                pgid = os.getpgid(pid)
                if pgid != os.getpgid(0):
                    os.killpg(pgid, 9)
                    sys.stderr.write(
                        "deadline-supervisor.py: SIGKILL sent to process group %d\n" % pgid
                    )
            except Exception as exc:
                sys.stderr.write("deadline-supervisor.py: SIGKILL pgid failed: %s\n" % exc)
            # Reap the target so it does not linger as a zombie, but NEVER
            # block: if the kill was denied, the target may still be alive.
            # We poll with WNOHANG for a short, bounded window and then exit
            # anyway, leaving any surviving target to be reported honestly by
            # the harness (which verifies residual processes by pid).
            reaped = False
            reap_deadline = time.time() + 2.0
            while time.time() < reap_deadline:
                try:
                    wpid, _status = os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    reaped = True
                    break
                except Exception:
                    break
                if wpid == pid:
                    reaped = True
                    break
                time.sleep(0.05)
            if reaped:
                sys.stderr.write("deadline-supervisor.py: target reaped\n")
            else:
                sys.stderr.write(
                    "deadline-supervisor.py: target NOT reaped (kill was denied); "
                    "the harness must report the residual pid %d\n" % pid
                )
            return 137

        time.sleep(0.05)


if __name__ == "__main__":
    sys.exit(main())
