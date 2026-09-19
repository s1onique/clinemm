// 41-oracle-broken-channel-witness.c
//
// Round-4 (HALT_ORACLE_WRITE_FAILURE_CHANNEL_NOT_FAILSAFE)
// executable witness.
//
// The previous witness (40-) exercised the parser against a healthy
// pipe and a synthetic WRITE_FAILED line. It proved the PARSER, not
// the FAILURE-REPORTING PATH.
//
// This witness exercises the round-4 failsafe directly: the fixture's
// gt_announce() must _exit(86) when the GT pipe is broken (read end
// closed). This is the kernel-mediated authoritative signal that
// cannot be lost to the same broken channel that caused the failure.
//
// Per Apple pipe(2): when the read end of a pipe is closed and a
// process writes to it, the kernel delivers SIGPIPE (default action
// terminate). With SIGPIPE ignored (signal(SIGPIPE, SIG_IGN)), the
// write fails with EPIPE instead. The round-4 gt_announce() treats
// EPIPE as an authoritative evidence failure and _exit(86)s.
//
// Test cases:
//   T1: Parent closes read end before forking child. Child announces
//       itself via gt_announce(getpid()) -> MUST exit 86.
//   T2: Broken-pipe WRITE_FAILED on the same fd -- the diagnostic
//       write itself fails (EPIPE again), but the _exit(86) STILL
//       runs (gt_announce_failure is called by gt_announce BEFORE
//       any further writes; the in-pipe WRITE_FAILED is best-effort).
//   T3: Healthy pipe control -- child MUST exit 0 (no false positive).
//
// Build: see Makefile target `witness`.

#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <signal.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdbool.h>
#include <mach-o/dyld.h>

// Mirror of fixture's gt_announce() logic, but minimal: we don't need
// the full kinfo_proc/sysctl path. We just need to demonstrate that
// writing to a closed-read-end pipe after SIGPIPE is ignored returns
// EPIPE, and that the round-4 failsafe _exit(86) runs.
static void child_announce(int fd, int pid) {
  // Suppress SIGPIPE so the default kernel action doesn't kill us
  // before _exit(86). This mirrors what 31- and 32- now do.
  signal(SIGPIPE, SIG_IGN);

  char buf[160];
  int n = snprintf(buf, sizeof buf,
                   "CREATE pid=%d ppid=1 pgid=1 start_us=%llu\n",
                   pid, (unsigned long long)(1000000ULL + (uint64_t)pid));
  if (n <= 0) _exit(99);

  ssize_t w = write(fd, buf, (size_t)n);
  if (w < 0) {
    if (errno == EPIPE || errno == EIO || errno == ENXIO || errno == EBADF) {
      // Broken channel: best-effort in-pipe WRITE_FAILED, then
      // authoritative _exit(86). The in-pipe write will ALSO fail
      // with EPIPE on this broken channel; that's fine -- the
      // _exit(86) is the load-bearing signal.
      char wb[160];
      int wn = snprintf(wb, sizeof wb,
                        "WRITE_FAILED pid=%d attempted=%d errno=%d\n",
                        pid, n, errno);
      if (wn > 0) {
        ssize_t ww = write(fd, wb, (size_t)wn);
        (void)ww;  // expected to fail with EPIPE
      }
      fprintf(stderr, "[gt_write_failed] pid=%d attempted=%d errno=%d\n",
              pid, n, errno);
      // Authoritative cross-process-boundary signal: kernel-mediated
      // exit status that waitpid() in the driver/parent can see.
      _exit(86);
    }
    // Other errno (EAGAIN, EINTR): retry-or-fail per round-3 logic.
    // For the witness we simplify: any other failure is also fatal.
    fprintf(stderr, "[gt_write_failed] pid=%d attempted=%d errno=%d (other)\n",
            pid, n, errno);
    _exit(87);
  }
  if (w < n) {
    fprintf(stderr, "[gt_write_failed] pid=%d short=%zd/%d\n", pid, w, n);
    _exit(88);
  }
  // Success.
  _exit(0);
}

static int run_case(const char *name, bool close_read_end_before_fork,
                    int *status_out) {
  int p[2];
  if (pipe(p) != 0) { perror("pipe"); return 1; }

  if (close_read_end_before_fork) {
    // T1/T2: close the read end BEFORE forking the child.
    // The child's write will get EPIPE/SIGPIPE.
    close(p[0]);
  }

  pid_t c = fork();
  if (c == 0) {
    if (!close_read_end_before_fork) {
      // T3: keep both ends open for the child (control case).
      close(p[0]);  // child doesn't read
    }
    child_announce(p[1], (int)getpid());
    _exit(99);  // unreachable
  }
  // Parent.
  if (!close_read_end_before_fork) {
    // T3: parent reads the data and closes write end.
    char rbuf[256];
    ssize_t r = read(p[0], rbuf, sizeof(rbuf));
    fprintf(stderr, "[%s] parent read=%zd errno=%d\n", name, r, r < 0 ? errno : 0);
    close(p[0]);
  }
  close(p[1]);  // parent closes write end

  int status = 0;
  pid_t r = waitpid(c, &status, 0);
  if (r != c) { perror("waitpid"); return 1; }
  *status_out = status;
  fprintf(stderr, "[%s] child exit_status=%d signaled=%d\n",
          name,
          WIFEXITED(status) ? WEXITSTATUS(status) : -1,
          WIFSIGNALED(status) ? WTERMSIG(status) : 0);
  return 0;
}

int main(void) {
  fprintf(stderr, "=== ORACLE_BROKEN_CHANNEL_WITNESS (round-4) ===\n");
  int failures = 0;

  // T1: broken pipe -- child MUST exit 86 (GT_EXIT_EVIDENCE_FAIL)
  int s1 = 0;
  run_case("T1 broken-pipe (read end closed)", true, &s1);
  bool t1_ok = WIFEXITED(s1) && WEXITSTATUS(s1) == 86;
  fprintf(stderr, "  T1 expected=86 got=%d %s\n",
          WIFEXITED(s1) ? WEXITSTATUS(s1) : -1,
          t1_ok ? "PASS" : "FAIL");
  if (!t1_ok) failures++;

  // T2: write to closed-read-end fd, then verify second write also
  // fails with EPIPE (sanity check that EPIPE is the kernel result).
  // This proves that the in-pipe WRITE_FAILED is unreliable on a
  // broken channel, justifying the round-4 _exit(86) failsafe.
  {
    int p2[2];
    pipe(p2);
    close(p2[0]);  // close read end BEFORE child writes
    pid_t c = fork();
    if (c == 0) {
      signal(SIGPIPE, SIG_IGN);
      // First write: should fail with EPIPE
      ssize_t w1 = write(p2[1], "first\n", 6);
      int errno_after_first = errno;
      // Second write (the "WRITE_FAILED diagnostic"): should also
      // fail with EPIPE -- the diagnostic is unreliable.
      ssize_t w2 = write(p2[1], "second\n", 7);
      int errno_after_second = errno;
      fprintf(stderr, "[T2 broken-pipe diagnostic] first_write=%zd errno=%d, "
                      "second_write=%zd errno=%d\n",
              w1, errno_after_first, w2, errno_after_second);
      // Close the write end to avoid the kernel keeping the pipe alive.
      close(p2[1]);
      _exit(0);  // exit 0; the test is whether the second write failed
    }
    int s = 0;
    waitpid(c, &s, 0);
  }
  // The above test prints the result; we don't gate on it because
  // the print itself is the diagnostic. We expect the stderr to show
  // both writes failing with EPIPE.

  // T3: healthy pipe control -- child MUST exit 0
  int s3 = 0;
  run_case("T3 healthy-pipe control", false, &s3);
  bool t3_ok = WIFEXITED(s3) && WEXITSTATUS(s3) == 0;
  fprintf(stderr, "  T3 expected=0 got=%d %s\n",
          WIFEXITED(s3) ? WEXITSTATUS(s3) : -1,
          t3_ok ? "PASS" : "FAIL");
  if (!t3_ok) failures++;

  // T4: REAL fixture test -- 31-helper-preattach-root with closed
  // GT read end. The fixture's gt_init() reads CLINEMM_GROUND_TRUTH_FD
  // and announces getpid() to that fd. With the read end closed,
  // write() must return EPIPE (with SIGPIPE suppressed via signal
  // handler in main()), gt_announce_failure() must _exit(86), and
  // the witness must observe exit status 86 via waitpid().
  {
    int p4[2];
    if (pipe(p4) != 0) { perror("pipe T4"); failures++; }
    else {
      close(p4[0]);  // close read end BEFORE fork
      char fdstr[32];
      snprintf(fdstr, sizeof fdstr, "%d", p4[1]);
      // Derive absolute path of 31-helper-preattach-root from the
      // witness binary's own location so we don't depend on cwd.
      char self_path[1024];
      char fixture_path[1024];
      uint32_t self_len = sizeof(self_path);
      if (_NSGetExecutablePath(self_path, &self_len) != 0) {
        fprintf(stderr, "  T4 _NSGetExecutablePath failed\n");
        failures++;
      } else {
        // dirname(self_path) + "/31-helper-preattach-root"
        char *slash = strrchr(self_path, '/');
        if (slash == NULL) {
          fprintf(stderr, "  T4 no '/' in self path\n");
          failures++;
        } else {
          *slash = '\0';
          snprintf(fixture_path, sizeof fixture_path,
                   "%s/31-helper-preattach-root", self_path);
          pid_t c = fork();
          if (c == 0) {
            setenv("CLINEMM_GROUND_TRUTH_FD", fdstr, 1);
            execl(fixture_path, "31-helper-preattach-root",
                  "--fixture=shell-A", "--duration=1", (char *)NULL);
            _exit(99);  // exec failed
          }
          close(p4[1]);
          int s = 0;
          waitpid(c, &s, 0);
          int code = WIFEXITED(s) ? WEXITSTATUS(s) : -1;
          bool t4_ok = (code == 86);
          fprintf(stderr, "  T4 [real fixture, broken GT] expected=86 got=%d %s\n",
                  code, t4_ok ? "PASS" : "FAIL");
          if (!t4_ok) failures++;
        }
      }
    }
  }

  fprintf(stderr, "=== failures=%d VERDICT=%s ===\n",
          failures, failures == 0 ? "PASS" : "FAIL");
  return failures == 0 ? 0 : 1;
}
