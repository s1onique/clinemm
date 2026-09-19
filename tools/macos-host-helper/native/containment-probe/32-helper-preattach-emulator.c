// 32-helper-preattach-emulator.c
//
// Fork-storm emulator for ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01.
//
// Performs a burst of >= 16 immediate fork() calls as its FIRST
// user-space instruction after SIGCONT resume. ZERO sleep/nanosleep/
// usleep between iterations. This is the load-bearing adversarial case
// for the immediate-double-fork and fork-storm matrix rows.
//
// Each forked child sleeps until killed. The driver must reconcile
// every child via sysctl KERN_PROC and recursively attach a watch to
// each. If any child is missed: HALT_HELPER_SUSPENDED_PREATTACH_KQUEUE_RACE.
//
// The first iteration is the immediate-double-fork discriminator: that
// child itself forks again immediately (no sleep). Then subsequent
// iterations fork once and sleep.
//
// Ground-truth oracle (independent of the tracker):
//   Like 31-helper-preattach-root, this binary reads
//   CLINEMM_GROUND_TRUTH_FD=<fd> from the environment and writes
//   CREATE records for every fork() result before the parent or
//   child does anything else.
//
// Usage:
//   32-helper-preattach-emulator <iterations> [lifetime-seconds]
//
// Defaults: iterations=16, lifetime=30.

#include <sys/types.h>
#include <sys/sysctl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <sys/wait.h>
#include <errno.h>

static int g_gt_fd = -1;

static uint64_t gt_start_us_for(pid_t p) {
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0 };
  size_t len = 0;
  if (sysctl(mib, 3, NULL, &len, NULL, 0) < 0) return 0;
  struct kinfo_proc *kp = (struct kinfo_proc *)malloc(len);
  if (kp == NULL) return 0;
  if (sysctl(mib, 3, kp, &len, NULL, 0) < 0) { free(kp); return 0; }
  int n = (int)(len / sizeof(struct kinfo_proc));
  uint64_t out = 0;
  for (int i = 0; i < n; i++) {
    if (kp[i].kp_proc.p_pid == p) {
      out = (uint64_t)kp[i].kp_proc.p_starttime.tv_sec * 1000000ULL
          + (uint64_t)kp[i].kp_proc.p_starttime.tv_usec;
      break;
    }
  }
  free(kp);
  return out;
}

// Round-3 (HALT_GROUND_TRUTH_PIPE_CAN_DROP_RECORDS): write-failure
// must be visible. The fork-storm is the most likely trigger (kernel
// pipe buffer pressure). Same retry+report semantics as 31-.
static int g_gt_write_failures = 0;

static void gt_announce_failure(pid_t pid, int attempted, int err) {
  char wb[160];
  int wn = snprintf(wb, sizeof wb,
                    "WRITE_FAILED pid=%d attempted=%d errno=%d\n",
                    (int)pid, attempted, err);
  if (wn > 0) { ssize_t ww = write(g_gt_fd, wb, (size_t)wn); (void)ww; }
  fprintf(stderr, "[gt_write_failed] pid=%d attempted=%d errno=%d\n",
          (int)pid, attempted, err);
}

static void gt_announce(pid_t pid) {
  if (g_gt_fd < 0 || pid <= 0) return;
  uint64_t start_us = gt_start_us_for(pid);
  pid_t ppid = -1, pgid = -1;
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0 };
  size_t len = 0;
  if (sysctl(mib, 3, NULL, &len, NULL, 0) == 0) {
    struct kinfo_proc *kp = (struct kinfo_proc *)malloc(len);
    if (kp != NULL) {
      if (sysctl(mib, 3, kp, &len, NULL, 0) == 0) {
        int n = (int)(len / sizeof(struct kinfo_proc));
        for (int i = 0; i < n; i++) {
          if (kp[i].kp_proc.p_pid == pid) {
            ppid = kp[i].kp_eproc.e_ppid;
            pgid = kp[i].kp_eproc.e_pgid;
            break;
          }
        }
      }
      free(kp);
    }
  }
  char buf[160];
  int n = snprintf(buf, sizeof buf,
                   "CREATE pid=%d ppid=%d pgid=%d start_us=%llu\n",
                   (int)pid, (int)ppid, (int)pgid,
                   (unsigned long long)start_us);
  if (n <= 0) return;
  size_t total = (size_t)n;
  size_t off = 0;
  for (int attempt = 0; attempt < 3; attempt++) {
    ssize_t w = write(g_gt_fd, buf + off, total - off);
    if (w < 0) {
      if (errno == EINTR) continue;
      if (errno == EAGAIN) { usleep(1000); continue; }
      gt_announce_failure(pid, (int)total, errno);
      g_gt_write_failures++;
      return;
    }
    off += (size_t)w;
    if (off >= total) return;
    usleep(1000);
  }
  if (off < total) {
    gt_announce_failure(pid, (int)(total - off), EAGAIN);
    g_gt_write_failures++;
  }
}

static void gt_init(void) {
  const char *e = getenv("CLINEMM_GROUND_TRUTH_FD");
  if (e == NULL) return;
  int fd = atoi(e);
  if (fd <= 0) return;
  g_gt_fd = fd;
  gt_announce(getpid());
}

int main(int argc, char **argv) {
  int iterations    = argc >= 2 ? atoi(argv[1]) : 16;
  int lifetime_sec  = argc >= 3 ? atoi(argv[2]) : 30;

  gt_init();

  // No setsid here -- the driver attaches kqueue to THIS process, and
  // a setsid would only test the escape mechanism (covered by the
  // node-escape / python-escape fixtures). The fork storm is a
  // different adversarial class: a burst that the driver's
  // reconciliation has to keep up with.

  fprintf(stderr, "[fork-storm] parent pid=%d pgid=%d ppid=%d iterations=%d\n",
          getpid(), getpgid(0), getppid(), iterations);

  // First child is the immediate-double-fork discriminator: it forks
  // AGAIN immediately (no sleep). The driver must reconcile BOTH.
  pid_t first = fork();
  if (first == 0) {
    fprintf(stderr, "[fork-storm] immediate-double-fork child pid=%d\n", getpid());
    gt_announce(getpid());
    pid_t grand = fork();
    if (grand == 0) {
      fprintf(stderr, "[fork-storm] grandchild pid=%d\n", getpid());
      gt_announce(getpid());
      sleep((unsigned)lifetime_sec);
      _exit(0);
    }
    gt_announce(grand);
    fprintf(stderr, "[fork-storm] immediate-double-fork child %d saw grandchild=%d\n",
            getpid(), grand);
    waitpid(grand, NULL, 0);
    _exit(0);
  }
  gt_announce(first);

  // Remaining iterations: fork once each, child sleeps.
  for (int i = 1; i < iterations; i++) {
    pid_t c = fork();
    if (c == 0) {
      fprintf(stderr, "[fork-storm] iteration=%d child pid=%d\n", i, getpid());
      gt_announce(getpid());
      sleep((unsigned)lifetime_sec);
      _exit(0);
    }
    gt_announce(c);
  }

  // Parent: reap children, exit.
  fprintf(stderr, "[fork-storm] parent waiting for descendants\n");
  while (wait(NULL) > 0) { }
  return 0;
}
