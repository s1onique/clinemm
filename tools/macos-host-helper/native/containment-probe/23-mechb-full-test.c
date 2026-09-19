// 23-mechb-full-test.c
//
// Enhanced kqueue lineage probe.
//
// Capabilities:
//   1. accept root_pid + duration_sec on cmdline
//   2. attach kqueue to root_pid
//   3. on NOTE_FORK: enumerate children via sysctl KERN_PROC,
//      identify new ones by diff, recursively attach
//   4. on NOTE_EXEC: refresh the start_us for that PID
//      (a fresh exec invalidates PID+start_time identity)
//   5. on NOTE_EXIT: drop that PID from the tracked set
//   6. on shutdown (SIGTERM/SIGINT/duration): dump the tracked set
//      as JSON, then attempt kill(-1, KILL) on each tracked PID
//
// Output: JSON line stream:
//   {"event":"watch","pid":N}
//   {"event":"fork","parent_pid":N,"new_child":N,"tracked":[...]}
//   {"event":"exec","pid":N}
//   {"event":"exit","pid":N}
//   {"event":"end","tracked":[...],"attempts":[...],"killed":[...]}
//
// This is the production-bound primitive IF it proves to capture
// the setsid()/detached:true escape.

#include <sys/types.h>
#include <sys/event.h>
#include <sys/sysctl.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <stdbool.h>
#include <time.h>

#define MAX_PIDS 4096
static pid_t tracked[MAX_PIDS];
static int ntracked = 0;

static volatile sig_atomic_t g_done = 0;
static void on_sig(int s) { (void)s; g_done = 1; }

static void emit(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  vprintf(fmt, ap); va_end(ap);
  fflush(stdout);
}

static int already_tracked(pid_t p) {
  for (int i = 0; i < ntracked; i++) if (tracked[i] == p) return 1;
  return 0;
}
static void add_tracked(pid_t p) {
  if (already_tracked(p)) return;
  if (ntracked < MAX_PIDS) tracked[ntracked++] = p;
}

static int kq = -1;
static void watch(pid_t p) {
  if (already_tracked(p)) return;
  struct kevent ev = { 0 };
  ev.ident = (uintptr_t)p;
  ev.filter = EVFILT_PROC;
  ev.flags = EV_ADD | EV_ENABLE | EV_CLEAR;
  ev.fflags = NOTE_FORK | NOTE_EXEC | NOTE_EXIT;
  int r = kevent(kq, &ev, 1, NULL, 0, NULL);
  if (r == 0) {
    add_tracked(p);
    emit("{\"event\":\"watch\",\"pid\":%d}\n", p);
  } else {
    emit("{\"event\":\"watch_failed\",\"pid\":%d,\"errno\":%d,\"errstr\":\"%s\"}\n",
         p, errno, strerror(errno));
  }
}

// Enumerate all processes whose ppid == parent. Returns count.
static int list_children(pid_t parent, pid_t *out, int max) {
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0 };
  struct kinfo_proc *procs = NULL;
  size_t len = 0;
  if (sysctl(mib, 3, NULL, &len, NULL, 0) < 0) return 0;
  procs = (struct kinfo_proc*)malloc(len);
  if (sysctl(mib, 3, procs, &len, NULL, 0) < 0) { free(procs); return 0; }
  int n = len / sizeof(struct kinfo_proc);
  int cnt = 0;
  for (int i = 0; i < n; i++) {
    if (procs[i].kp_eproc.e_ppid == parent && cnt < max) {
      out[cnt++] = procs[i].kp_proc.p_pid;
    }
  }
  free(procs);
  return cnt;
}

// On a fork event for `parent_pid`, find any children of parent_pid
// that we haven't yet tracked and add them.
static void reconcile_after_fork(pid_t parent_pid) {
  pid_t buf[256];
  int n = list_children(parent_pid, buf, 256);
  for (int i = 0; i < n; i++) {
    if (!already_tracked(buf[i])) {
      watch(buf[i]);
    }
  }
}

static void dump_tracked(void) {
  printf("\"tracked\":[");
  for (int i = 0; i < ntracked; i++) printf("%s%d", i ? "," : "", tracked[i]);
  printf("]");
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <root_pid> [duration_sec]\n", argv[0]);
    return 2;
  }
  pid_t root = (pid_t)atoi(argv[1]);
  int dur = argc >= 3 ? atoi(argv[2]) : 5;

  signal(SIGTERM, on_sig);
  signal(SIGINT, on_sig);
  signal(SIGPIPE, SIG_IGN);

  kq = kqueue();
  if (kq < 0) { perror("kqueue"); return 1; }
  watch(root);

  struct timespec pollt = { .tv_sec = 0, .tv_nsec = 100 * 1000000L };
  struct kevent events[32];
  time_t start = time(NULL);
  while (!g_done) {
    if (time(NULL) - start >= dur) break;
    int nev = kevent(kq, NULL, 0, events, 32, &pollt);
    if (nev < 0) { if (errno == EINTR) continue; perror("kevent"); break; }
    for (int i = 0; i < nev; i++) {
      pid_t ident = (pid_t)events[i].ident;
      uint32_t fflags = events[i].fflags;
      if (fflags & NOTE_FORK) {
        emit("{\"event\":\"fork\",\"parent_pid\":%d,\"kevent_data\":%lld}\n",
             ident, (long long)events[i].data);
        reconcile_after_fork(ident);
      }
      if (fflags & NOTE_EXEC) emit("{\"event\":\"exec\",\"pid\":%d}\n", ident);
      if (fflags & NOTE_EXIT) emit("{\"event\":\"exit\",\"pid\":%d}\n", ident);
    }
  }

  // Termination phase: attempt to kill every tracked pid.
  // We send SIGTERM first, then escalate.
  int killed[MAX_PIDS] = { 0 };
  int eperm[MAX_PIDS] = { 0 };
  int already_dead[MAX_PIDS] = { 0 };
  int nkill = 0;
  for (int i = 0; i < ntracked; i++) {
    pid_t p = tracked[i];
    if (kill(p, 0) < 0 && errno == ESRCH) { already_dead[nkill++] = p; continue; }
    if (kill(p, SIGKILL) == 0) killed[nkill++] = p;
    else eperm[nkill++] = p;
  }
  printf("{\"event\":\"end\",");
  dump_tracked();
  printf(",\"killed\":[");
  for (int i = 0; i < ntracked; i++) if (killed[i]) printf("%s%d", i ? "," : "", tracked[i]);
  printf("],\"eperm\":[");
  for (int i = 0; i < ntracked; i++) if (eperm[i]) printf("%s%d", i ? "," : "", tracked[i]);
  printf("],\"already_dead\":[");
  for (int i = 0; i < ntracked; i++) if (already_dead[i]) printf("%s%d", i ? "," : "", tracked[i]);
  printf("]}\n");
  return 0;
}
