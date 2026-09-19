// 42-oracle-descendant-failure-witness.c
//
// Round-5 (HALT_ORACLE_DESCENDANT_FAILURE_NOT_PROPAGATED)
// executable witness.
//
// Round-4 (41-) proved the GT-write failsafe: when the GT pipe
// breaks, the writer _exit(86)s so the parent can see the failure
// via waitpid().
//
// Round-5 introduces a TWO-PIPE TOPOLOGY: a GT pipe (root-only
// writer) and a descendant-report pipe (root reads, descendants
// write). The key round-5 invariant is:
//
//   "CREATE could not be durably emitted" -> root _exit(86)
//    (via reader-thread's GT-write failsafe)
//
// In particular: a DESCENDANT pipe write failure must NOT cause the
// root to _exit(86). It is acceptable for the report to be MISSED
// (the reader thread just doesn't see it). The driver can detect
// missed reports by comparing the CREATEs received against the
// expected descendant set.
//
// This witness exercises the two-pipe topology end-to-end and
// verifies the round-5 invariant precisely:
//
//   T1: GT pipe read end closed AFTER root starts but BEFORE any
//       report arrives. Root's reader thread tries to serialize,
//       write fails with EPIPE, _exit(86). Witness MUST observe 86.
//
//   T2: Descendant pipe write end closed BEFORE fixture runs. Root's
//       gt_announce() calls return EPIPE (logged to stderr as
//       gt_desc_write_failed). Reports are dropped. Root continues
//       and exits cleanly. Witness MUST observe root exit 0.
//
//   T3: Healthy two-pipe control. Both pipes intact. Fixture
//       announces normally. Witness MUST observe root exit 0.

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
#include <time.h>

static pid_t spawn_root_with_fds(const char *fixture_path,
                                 int gt_fd, int gt_close_after_spawn,
                                 int desc_read_fd, int desc_write_fd,
                                 const char *fixture,
                                 int duration_s) {
  pid_t c = fork();
  if (c == 0) {
    char gtstr[32], drstr[32], dwstr[32], durstr[16];
    snprintf(gtstr, sizeof gtstr, "%d", gt_fd);
    snprintf(drstr, sizeof drstr, "%d", desc_read_fd);
    snprintf(dwstr, sizeof dwstr, "%d", desc_write_fd);
    snprintf(durstr, sizeof durstr, "%d", duration_s);
    setenv("CLINEMM_GROUND_TRUTH_FD",   gtstr,  1);
    setenv("CLINEMM_GT_DESC_READ_FD",   drstr,  1);
    setenv("CLINEMM_DESCENDANT_FD",     dwstr,  1);
    // Suppress SIGPIPE in the fixture (matches what 31- does).
    signal(SIGPIPE, SIG_IGN);
    char fixture_arg[64], dur_arg[64];
    snprintf(fixture_arg, sizeof fixture_arg, "--fixture=%s", fixture);
    snprintf(dur_arg,    sizeof dur_arg,    "--duration=%s", durstr);
    execl(fixture_path, "31-helper-preattach-root",
          fixture_arg, dur_arg,
          (char *)NULL);
    _exit(99);
  }
  if (gt_close_after_spawn > 0) {
    close(gt_close_after_spawn);
  }
  return c;
}

static int run_T1_real_fixture_gt_broken(const char *fixture_path) {
  // T1: close the GT read end IMMEDIATELY before fixture spawns. The
  // reader thread's first serialize_report will fail with EPIPE
  // (after SIGPIPE suppression in the fixture). The fixture's
  // self-announce in gt_init goes via gt_serialize_report too, so
  // it should also fail. Either way, the fixture must _exit(86).
  int gt[2], dp[2];
  if (pipe(gt) != 0 || pipe(dp) != 0) { perror("pipe T1"); return 1; }

  close(gt[0]);  // close GT read end BEFORE spawn. Any GT write
                 // from the fixture will get EPIPE.

  pid_t c = spawn_root_with_fds(fixture_path,
                                gt[1], -1,
                                dp[0], dp[1],
                                "shell-A", 1);
  close(gt[1]); close(dp[1]);

  int s = 0;
  waitpid(c, &s, 0);
  close(dp[0]);
  int code = WIFEXITED(s) ? WEXITSTATUS(s) : -1;
  bool ok = (code == 86);
  fprintf(stderr, "  T1 [real fixture, GT broken pre-spawn] expected=86 got=%d %s\n",
          code, ok ? "PASS" : "FAIL");
  return ok ? 0 : 1;
}

static int run_T2_descendant_pipe_broken(const char *fixture_path) {
  int gt[2], dp[2];
  if (pipe(gt) != 0 || pipe(dp) != 0) { perror("pipe T2"); return 1; }

  close(dp[1]);  // close descendant WRITE end BEFORE spawn.

  pid_t c = spawn_root_with_fds(fixture_path,
                                gt[1], -1,
                                dp[0], -1,
                                "shell-A", 1);
  close(gt[1]); close(dp[0]);

  int s = 0;
  waitpid(c, &s, 0);
  int code = WIFEXITED(s) ? WEXITSTATUS(s) : -1;
  bool ok = (code == 0);
  fprintf(stderr, "  T2 [real fixture, descendant pipe broken pre-spawn] expected=0 got=%d %s\n",
          code, ok ? "PASS" : "FAIL");
  return ok ? 0 : 1;
}

static int run_T3_healthy_control(const char *fixture_path) {
  int gt[2], dp[2];
  if (pipe(gt) != 0 || pipe(dp) != 0) { perror("pipe T3"); return 1; }

  pid_t c = spawn_root_with_fds(fixture_path,
                                gt[1], -1,
                                dp[0], dp[1],
                                "shell-A", 1);
  close(gt[1]); close(dp[1]);

  int s = 0;
  waitpid(c, &s, 0);
  close(gt[0]); close(dp[0]);
  int code = WIFEXITED(s) ? WEXITSTATUS(s) : -1;
  bool ok = (code == 0);
  fprintf(stderr, "  T3 [healthy two-pipe control] expected=0 got=%d %s\n",
          code, ok ? "PASS" : "FAIL");
  return ok ? 0 : 1;
}

int main(void) {
  fprintf(stderr, "=== ORACLE_DESCENDANT_FAILURE_WITNESS (round-5) ===\n");
  int failures = 0;

  char self_path[1024];
  char fixture_path[1024];
  uint32_t self_len = sizeof(self_path);
  if (_NSGetExecutablePath(self_path, &self_len) != 0) {
    fprintf(stderr, "  _NSGetExecutablePath failed\n");
    return 1;
  }
  char *slash = strrchr(self_path, '/');
  if (slash == NULL) {
    fprintf(stderr, "  no '/' in self path\n");
    return 1;
  }
  *slash = '\0';
  snprintf(fixture_path, sizeof fixture_path,
           "%s/31-helper-preattach-root", self_path);

  if (access(fixture_path, X_OK) != 0) {
    fprintf(stderr, "  fixture not executable: %s\n", fixture_path);
    return 1;
  }

  if (run_T1_real_fixture_gt_broken(fixture_path) != 0) failures++;
  if (run_T2_descendant_pipe_broken(fixture_path)  != 0) failures++;
  if (run_T3_healthy_control(fixture_path)         != 0) failures++;

  fprintf(stderr, "=== failures=%d VERDICT=%s ===\n",
          failures, failures == 0 ? "PASS" : "FAIL");
  return failures == 0 ? 0 : 1;
}
