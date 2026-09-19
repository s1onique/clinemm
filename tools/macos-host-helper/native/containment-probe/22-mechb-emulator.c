// 22-mechb-emulator.c
//
// Emulates the Node-detached-sleep fixture pattern.
// v2: delays the inner fork so a cross-process probe can attach
// BEFORE the fork happens. This isolates the registration latency
// question from the existing-events question.

#include <sys/types.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <time.h>

int main(int argc, char **argv) {
  int delay_s = argc >= 2 ? atoi(argv[1]) : 5;
  int lifetime_s = argc >= 3 ? atoi(argv[2]) : 30;

  if (setsid() < 0) perror("setsid");
  setpgid(0, 0);

  printf("EMULATOR_PID=%d\n", getpid());
  printf("EMULATOR_PGID=%d\n", getpgid(0));
  fflush(stdout);

  // Sleep BEFORE forking so the probe has time to attach.
  if (delay_s > 0) sleep(delay_s);

  pid_t grand = fork();
  if (grand == 0) {
    // Grandchild: sleep.
    sleep(lifetime_s);
    _exit(0);
  }
  printf("GRANDCHILD_PID=%d\n", grand);
  fflush(stdout);

  // Parent: also fork a second grandchild later to test repeatability.
  if (delay_s > 0) sleep(delay_s);
  pid_t grand2 = fork();
  if (grand2 == 0) {
    sleep(lifetime_s);
    _exit(0);
  }
  printf("GRANDCHILD2_PID=%d\n", grand2);
  fflush(stdout);

  sleep(lifetime_s);
  return 0;
}
