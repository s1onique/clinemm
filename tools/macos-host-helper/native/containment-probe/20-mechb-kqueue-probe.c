// 20-mechb-kqueue-probe.c
//
// CANDIDATE B — kqueue EVFILT_PROC / NOTE_FORK event-time lineage.
//
// Hypothesis (intentionally REFUTABLE):
//   register kqueue on root process
//   on NOTE_FORK, capture child PID from kevent.ident/data
//   recursively add child watches
//   at cleanup, terminate all tracked identities
//   does the tracker capture setsid()/detached:true escape descendants?
//
// Reference: kevent(2) -- Apple Developer Documentation,
//   EVFILT_PROC attaches to a specific process ID.
//   NOTE_FORK: "The process whose PID is given as the filter's ident
//   has called fork(). The kevent's data is the child PID."
//
// This probe:
//   1. accepts root_pid on the command line
//   2. opens kqueue
//   3. registers EVFILT_PROC | NOTE_FORK | NOTE_EXEC | NOTE_EXIT on root_pid
//   4. loops on kevents, recording every child PID we see
//   5. auto-registers watches on every new child (recursive)
//   6. on SIGTERM/SIGINT, dumps the tracked-pid set as JSON to stdout
//   7. then attempts kill(-1, sig) on tracked pids via kill(pid, sig)
//
// The output is the durable evidence: did we capture the detached
// grandchild that performed setsid()/detached:true?
//
// Output: each kevent written as a JSON line, terminated by
// {"event":"end","tracked":[...]}.
//
// Build: cc -O2 -Wall -o 20-mechb-kqueue-probe 20-mechb-kqueue-probe.c

#include <sys/types.h>
#include <sys/event.h>
#include <sys/wait.h>
#include <sys/time.h>
#include <signal.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <poll.h>
#include <stdbool.h>

static volatile sig_atomic_t g_done = 0;
static void on_sigterm(int s) { (void)s; g_done = 1; }

static void emit_event(const char *kind, pid_t pid, uint32_t fflags, int64_t data) {
  printf("{\"event\":\"%s\",\"pid\":%d,\"fflags\":%u,\"data\":%lld}\n",
         kind, (int)pid, (unsigned)fflags, (long long)data);
  fflush(stdout);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <root_pid> [duration_sec]\n", argv[0]);
    return 2;
  }
  pid_t root_pid = (pid_t)atoi(argv[1]);
  int duration = argc >= 3 ? atoi(argv[2]) : 5;

  signal(SIGTERM, on_sigterm);
  signal(SIGINT,  on_sigterm);
  signal(SIGPIPE, SIG_IGN);

  int kq = kqueue();
  if (kq < 0) { perror("kqueue"); return 1; }

  // Register NOTE_FORK | NOTE_EXEC | NOTE_EXIT on root.
  struct kevent ev = { 0 };
  ev.ident  = (uintptr_t)root_pid;
  ev.filter = EVFILT_PROC;
  ev.flags  = EV_ADD | EV_ENABLE | EV_CLEAR;
  ev.fflags = NOTE_FORK | NOTE_EXEC | NOTE_EXIT;
  ev.data   = 0;
  ev.udata  = 0;
  if (kevent(kq, &ev, 1, NULL, 0, NULL) < 0) {
    perror("kevent register root");
    return 1;
  }
  emit_event("watch", root_pid, ev.fflags, 0);

  // We track all watched PIDs and the full descendant set we've seen.
  // For the discriminator, we log every NOTE_FORK child and every
  // child we successfully register. The "tracked" set is what we
  // believe is ours; "child_pids_seen" is every fork-event child we
  // ever observed, regardless of whether we registered them.
  pid_t watched[4096];
  int nwatched = 1;
  watched[0] = root_pid;
  pid_t all_seen[8192];
  int nseen = 0;
  bool seen[100000] = { false };

  struct timespec pollt = { .tv_sec = 0, .tv_nsec = 100 * 1000000L }; // 100ms

  struct kevent events[64];
  time_t start = time(NULL);
  while (!g_done) {
    // Bail out after duration if we want a hard timeout.
    if (time(NULL) - start >= duration) break;

    int nev = kevent(kq, NULL, 0, events, 64, &pollt);
    if (nev < 0) {
      if (errno == EINTR) continue;
      perror("kevent wait");
      break;
    }
    for (int i = 0; i < nev; i++) {
      pid_t ident = (pid_t)events[i].ident;
      int64_t data = events[i].data;
      uint32_t fflags = events[i].fflags;

      if (events[i].filter != EVFILT_PROC) continue;

      if (fflags & NOTE_FORK) {
        // kevent(2): "The data field is the child PID."
        // On macOS the child PID is also accessible as the returned
        // ident of the new kqueue event registered by EV_ADD.
        emit_event("fork", ident, fflags, data);
        // Record BOTH: the child-pid-as-data (if nonzero) and the
        // ident (in case some kernels swap them).
        pid_t child = data > 0 ? (pid_t)data : 0;
        if (child > 0 && !seen[child] && child < 100000) {
          seen[child] = true;
          all_seen[nseen++] = child;
          // Register watch on the new child.
          if (nwatched < (int)(sizeof(watched)/sizeof(watched[0]))) {
            struct kevent cev = { 0 };
            cev.ident  = (uintptr_t)child;
            cev.filter = EVFILT_PROC;
            cev.flags  = EV_ADD | EV_ENABLE | EV_CLEAR;
            cev.fflags = NOTE_FORK | NOTE_EXEC | NOTE_EXIT;
            int r = kevent(kq, &cev, 1, NULL, 0, NULL);
            emit_event(r == 0 ? "watch" : "watch_failed",
                       child, cev.fflags, r);
            if (r == 0) watched[nwatched++] = child;
          }
        }
      } else if (fflags & NOTE_EXEC) {
        emit_event("exec", ident, fflags, data);
      } else if (fflags & NOTE_EXIT) {
        emit_event("exit", ident, fflags, data);
      } else {
        emit_event("other", ident, fflags, data);
      }
    }
  }

  // Emit the summary.
  printf("{\"event\":\"end\",\"watched_count\":%d,\"seen_count\":%d,\"watched\":[",
         nwatched, nseen);
  for (int i = 0; i < nwatched; i++) printf("%s%d", i ? "," : "", watched[i]);
  printf("],\"all_seen\":[");
  for (int i = 0; i < nseen; i++) printf("%s%d", i ? "," : "", all_seen[i]);
  printf("]}\n");
  fflush(stdout);
  close(kq);
  return 0;
}
