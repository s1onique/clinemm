// 22-mechb-self-fork-test.c
//
// Self-test for kqueue EVFILT_PROC NOTE_FORK.
// The kqueue filter MUST be registered by a process that is related
// to the target (typically the parent). On macOS, EVFILT_PROC is
// restricted in this way for non-root callers.
//
// This test:
//   1. forks a child
//   2. registers kqueue on the child from the parent
//   3. child does its own fork+exec+setsid dance
//   4. parent observes NOTE_FORK events
//
// Output: JSON lines, then {"event":"end",...}.

#include <sys/types.h>
#include <sys/event.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

static volatile sig_atomic_t g_done = 0;
static void on_sig(int s) { (void)s; g_done = 1; }

int main(void) {
  signal(SIGTERM, on_sig);
  signal(SIGINT,  on_sig);

  pid_t pid = fork();
  if (pid == 0) {
    // Child: do a small dance with setsid + exec.
    setsid();
    setpgid(0, 0);
    pid_t grand = fork();
    if (grand == 0) {
      // grandchild: long sleep.
      sleep(8);
      _exit(0);
    }
    // child: report grandchild pid and exit quickly.
    printf("CHILD_PID=%d\n", getpid());
    printf("GRANDCHILD_PID=%d\n", grand);
    fflush(stdout);
    _exit(0);
  }

  // Parent: register kqueue on child, listen for NOTE_FORK.
  int kq = kqueue();
  struct kevent ev = { 0 };
  ev.ident = (uintptr_t)pid;
  ev.filter = EVFILT_PROC;
  ev.flags = EV_ADD | EV_ENABLE | EV_CLEAR;
  ev.fflags = NOTE_FORK | NOTE_EXEC | NOTE_EXIT;
  if (kevent(kq, &ev, 1, NULL, 0, NULL) < 0) {
    perror("kevent register");
    return 1;
  }
  printf("{\"event\":\"watch\",\"pid\":%d}\n", pid);
  fflush(stdout);

  struct kevent events[16];
  struct timespec pollt = { .tv_sec = 0, .tv_nsec = 100 * 1000000L };
  int forksSeen = 0;
  int exitsSeen = 0;
  int maxLoops = 100;
  while (!g_done && maxLoops-- > 0) {
    int nev = kevent(kq, NULL, 0, events, 16, &pollt);
    if (nev < 0) { if (errno == EINTR) continue; perror("kevent"); break; }
    for (int i = 0; i < nev; i++) {
      pid_t ident = (pid_t)events[i].ident;
      int64_t data = events[i].data;
      uint32_t fflags = events[i].fflags;
      if (fflags & NOTE_FORK) {
        forksSeen++;
        printf("{\"event\":\"fork\",\"parent_pid\":%d,\"child_pid\":%lld}\n",
               ident, (long long)data);
      }
      if (fflags & NOTE_EXEC) printf("{\"event\":\"exec\",\"pid\":%d}\n", ident);
      if (fflags & NOTE_EXIT) {
        exitsSeen++;
        printf("{\"event\":\"exit\",\"pid\":%d}\n", ident);
      }
    }
    fflush(stdout);
  }
  int status = 0;
  waitpid(pid, &status, 0);
  printf("{\"event\":\"end\",\"forksSeen\":%d,\"exitsSeen\":%d}\n", forksSeen, exitsSeen);
  return 0;
}
