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
// Usage:
//   32-helper-preattach-emulator <iterations> [lifetime-seconds]
//
// Defaults: iterations=16, lifetime=30.

#include <sys/types.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>

int main(int argc, char **argv) {
  int iterations    = argc >= 2 ? atoi(argv[1]) : 16;
  int lifetime_sec  = argc >= 3 ? atoi(argv[2]) : 30;

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
    pid_t grand = fork();
    if (grand == 0) {
      fprintf(stderr, "[fork-storm] grandchild pid=%d\n", getpid());
      sleep((unsigned)lifetime_sec);
      _exit(0);
    }
    fprintf(stderr, "[fork-storm] immediate-double-fork child %d saw grandchild=%d\n",
            getpid(), grand);
    waitpid(grand, NULL, 0);
    _exit(0);
  }

  // Remaining iterations: fork once each, child sleeps.
  for (int i = 1; i < iterations; i++) {
    pid_t c = fork();
    if (c == 0) {
      fprintf(stderr, "[fork-storm] iteration=%d child pid=%d\n", i, getpid());
      sleep((unsigned)lifetime_sec);
      _exit(0);
    }
  }

  // Parent: reap children, exit.
  fprintf(stderr, "[fork-storm] parent waiting for descendants\n");
  while (wait(NULL) > 0) { }
  return 0;
}
