// 22-mechb-cross-process-test.c
//
// Cross-process kqueue EVFILT_PROC attachment test.
//
// Question: can process A register kqueue on process B when A is
// NOT the parent of B? Apple docs say "If a process can normally
// see another process, it can attach an event to it."
//
// This test:
//   1. parent forks child
//   2. child execs into a long sleep
//   3. parent IMMEDIATELY returns
//   4. a third process (this one) tries to attach kqueue to the
//      child's PID after the parent has died
//   5. if the attachment works, fork events fire (the child does
//      its own fork+setsid+sleep dance)
//
// Output: JSON lines indicating whether the attachment succeeded.

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

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <child_pid>\n", argv[0]);
    return 2;
  }
  pid_t target = (pid_t)atoi(argv[1]);

  int kq = kqueue();
  struct kevent ev = { 0 };
  ev.ident = (uintptr_t)target;
  ev.filter = EVFILT_PROC;
  ev.flags = EV_ADD | EV_ENABLE | EV_CLEAR;
  ev.fflags = NOTE_FORK | NOTE_EXEC | NOTE_EXIT;
  int r = kevent(kq, &ev, 1, NULL, 0, NULL);
  if (r < 0) {
    printf("{\"event\":\"attach_failed\",\"target\":%d,\"errno\":%d,\"errstr\":\"%s\"}\n",
           target, errno, strerror(errno));
    fflush(stdout);
    return 1;
  }
  printf("{\"event\":\"attached\",\"target\":%d}\n", target);
  fflush(stdout);

  struct kevent events[16];
  struct timespec pollt = { .tv_sec = 0, .tv_nsec = 200 * 1000000L };
  int loops = 30; // 6 seconds
  int forks = 0, execs = 0, exits = 0;
  while (loops-- > 0) {
    int nev = kevent(kq, NULL, 0, events, 16, &pollt);
    if (nev < 0) { if (errno == EINTR) continue; perror("kevent"); break; }
    for (int i = 0; i < nev; i++) {
      pid_t ident = (pid_t)events[i].ident;
      int64_t data = events[i].data;
      uint32_t fflags = events[i].fflags;
      if (fflags & NOTE_FORK) {
        forks++;
        printf("{\"event\":\"fork\",\"parent_pid\":%d,\"kevent_data\":%lld}\n",
               ident, (long long)data);
      }
      if (fflags & NOTE_EXEC) { execs++; printf("{\"event\":\"exec\",\"pid\":%d}\n", ident); }
      if (fflags & NOTE_EXIT) { exits++; printf("{\"event\":\"exit\",\"pid\":%d}\n", ident); }
    }
    fflush(stdout);
  }
  printf("{\"event\":\"end\",\"forks\":%d,\"execs\":%d,\"exits\":%d}\n", forks, execs, exits);
  return 0;
}
