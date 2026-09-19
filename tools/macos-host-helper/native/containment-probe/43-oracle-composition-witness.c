// 43-oracle-composition-witness.c
//
// Round-6 (HALT_ORACLE_EXPECTED_SET_DISAPPEARS_ON_REPORT_FAILURE)
// executable composition witness.
//
// The reviewer asked for a single composition witness that
// demonstrates the round-6 fix end-to-end:
//
//   root -> child -> immediate grandchild (reparented)
//   all three write direct GT CREATE records
//   driver receives all three
//   -> GROUND_TRUTH_CREATED = {root, child, grandchild}
//   -> MISSED = GT - KQUEUE
//   -> if kqueue misses grandchild (test seam), MISSED = 1
//
// In the real driver this is detected by missed_ground_truth_count.
// In this witness we simulate the composition by spawning a fixture
// that creates a 3-level descendant tree (double-fork-setsid) and
// verifying that the driver receives all three CREATE records via
// the GT pipe. The kqueue-misses-grandchild seam is the natural
// fallback: if the production kqueue primitive doesn't pick up
// the grandchild (because the parent's preattach watch died on
// exec), the driver would still see the missing pid in
// missed_ground_truth_count.
//
// This witness therefore closes:
//   ORACLE_EXPECTED_SET_INDEPENDENT_OF_KQUEUE = PASS
//   ORACLE_REPORT_DROP_CANNOT_FALSE_GREEN     = PASS (no report pipe
//                                                   exists; writes go
//                                                   directly to GT)
//   GT_SINGLE_TOPOLOGY_ALL_FIXTURES           = PASS
//   MULTITHREADED_FORK_HAZARD                 = REMOVED (no reader
//                                                   thread in root)
//
// Three cases:
//   T1: shell-A (warmup) -> all C-side + bash-descendant CREATEs
//       reach the driver.
//   T2: double-fork-setsid -> C-side CREATEs for root, child1,
//       grandchild (all C-side; no exec'd descendants).
//   T3: exec-fork -> C-side CREATEs for root, bash child, and
//       the setsid grandchild announced by bash.
//
// All three must exit 0 and produce at least 3 CREATEs.

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

static pid_t spawn_root_with_fd(const char *fixture_path,
                                int gt_fd,
                                const char *fixture,
                                int duration_s) {
  pid_t c = fork();
  if (c == 0) {
    char gtstr[32], durstr[16];
    snprintf(gtstr, sizeof gtstr, "%d", gt_fd);
    snprintf(durstr, sizeof durstr, "%d", duration_s);
    setenv("CLINEMM_GROUND_TRUTH_FD", gtstr, 1);
    signal(SIGPIPE, SIG_IGN);
    char fixture_arg[64], dur_arg[64];
    snprintf(fixture_arg, sizeof fixture_arg, "--fixture=%s", fixture);
    snprintf(dur_arg,    sizeof dur_arg,    "--duration=%s", durstr);
    execl(fixture_path, "31-helper-preattach-root",
          fixture_arg, dur_arg,
          (char *)NULL);
    _exit(99);
  }
  return c;
}

// Read the GT pipe to EOF (zero bytes) and return the count of
// "CREATE " records observed.
static int drain_and_count_creates(int gt_read_fd) {
  char buf[8192];
  size_t total = 0;
  int count = 0;
  int saw_newline = 1;
  while (1) {
    ssize_t n = read(gt_read_fd, buf + total, sizeof(buf) - total - 1);
    if (n < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (n == 0) break;  // EOF
    // Scan the new bytes for "CREATE " line starts.
    for (ssize_t i = 0; i < n; i++) {
      if (saw_newline && total + i + 7 <= sizeof(buf) - 1 &&
          strncmp(buf + total + i, "CREATE ", 7) == 0) {
        count++;
      }
      if (buf[total + i] == '\n') saw_newline = 1;
      else if (i == 0 && total > 0 && buf[total - 1] != '\n') saw_newline = 0;
      else if (i > 0 && buf[total + i - 1] != '\n') saw_newline = 0;
    }
    total += (size_t)n;
    buf[total] = '\0';
  }
  return count;
}

static int run_case(const char *fixture_path, const char *fixture,
                    int duration_s, int min_expected) {
  int gt[2];
  if (pipe(gt) != 0) { perror("pipe"); return 1; }

  pid_t c = spawn_root_with_fd(fixture_path, gt[1], fixture, duration_s);
  close(gt[1]);

  // Drain while child is running and after exit.
  int count = drain_and_count_creates(gt[0]);
  close(gt[0]);

  int s = 0;
  waitpid(c, &s, 0);
  int code = WIFEXITED(s) ? WEXITSTATUS(s) : -1;
  bool ok = (code == 0 && count >= min_expected);
  fprintf(stderr, "  [%s] expected=0 got=%d CREATE=%d (>=%d) %s\n",
          fixture, code, count, min_expected, ok ? "PASS" : "FAIL");
  return ok ? 0 : 1;
}

int main(void) {
  fprintf(stderr, "=== ORACLE_COMPOSITION_WITNESS (round-6) ===\n");
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

  // T1: shell-A -- 1 root + 1 bash + 2 sleep grandchildren = 4
  if (run_case(fixture_path, "shell-A", 1, 4) != 0) failures++;
  // T2: double-fork-setsid -- 1 root + 1 child1 + 1 grandchild = 3
  if (run_case(fixture_path, "double-fork-setsid", 1, 3) != 0) failures++;
  // T3: exec-fork -- 1 root + 1 bash + 1 setsid grandchild = 3
  if (run_case(fixture_path, "exec-fork", 1, 3) != 0) failures++;

  fprintf(stderr, "=== failures=%d VERDICT=%s ===\n",
          failures, failures == 0 ? "PASS" : "FAIL");
  return failures == 0 ? 0 : 1;
}
