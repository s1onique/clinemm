// 30-helper-preattach-driver.c
//
// Orchestrator for ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01.
//
// Hypothesis (intentionally REFUTABLE):
//   If we install the kqueue+EVFILT_PROC watch BEFORE the spawned root
//   executes a single user-space instruction, does the primitive
//   capture complete lineage through every escape class catalogued by
//   the predecessor ACT (setsid, detached:true, immediate double-fork,
//   fork storm)?
//
// Method:
//   1. Use POSIX_SPAWN_START_SUSPENDED -- the documented Darwin primitive
//      that creates the child with its task SUSPENDED at the kernel
//      boundary, so it cannot execute a single user-space instruction
//      until SIGCONT is delivered (Apple posix_spawnattr_setflags(3)).
//   2. While the root is suspended, register kqueue EVFILT_PROC |
//      NOTE_FORK | NOTE_EXEC | NOTE_EXIT on the root PID.
//   3. Verify the registration succeeded.
//   4. Deliver SIGCONT.
//   5. Run the kevent loop: on NOTE_FORK, reconcile via sysctl
//      KERN_PROC to find the new child PIDs (Apple's kevent(2) does
//      not put the child PID in ident/data on all substrates), and
//      register watches on each new child recursively.
//   6. Dump the tracked set + a per-fixture result as JSON.
//
// CRITICAL: NO cooperative fixture delay. The fixture root may fork,
// exec, setsid, double-fork, fork-storm immediately after SIGCONT.
// The race is between kqueue registration (which finishes while the
// process is KERNEL-SUSPENDED, deterministically) and the fixture's
// first user-space instruction (which cannot happen until SIGCONT).
//
// Driver-identity note:
//   This driver runs as the user (same UID as fixture root). It does
//   NOT exercise kill(2) authority on the spawned subtree; the SIGCONT
//   resume is delivered to a process the driver itself owns (it spawned
//   it), which is allowed regardless of LaunchAgent signal-authority
//   boundary. The actual production kill chain is inherited from the
//   helper evidence chain and is NOT re-falsified here.
//
// Output (JSON line stream):
//   {"event":"spawn","pid":N,"suspended":true}
//   {"event":"watch","pid":N}
//   {"event":"sigcont","pid":N}
//   {"event":"fork","parent_pid":N,"child_pid":N}
//   {"event":"exec","pid":N}
//   {"event":"exit","pid":N}
//   {"event":"end","tracked":[...],"seen":[...],"missed_descendants":[...],
//    "missed_descendants_count":N,"duration_ms":N}
//
// Usage:
//   30-helper-preattach-driver <root-binary> [fixture-args...]

#include <sys/types.h>
#include <sys/event.h>
#include <sys/sysctl.h>
#include <sys/wait.h>
#include <sys/time.h>
#include <signal.h>
#include <spawn.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <stdbool.h>
#include <time.h>
#include <mach/mach_time.h>

extern char **environ;

#define MAX_PIDS 4096
static pid_t tracked[MAX_PIDS];
static int ntracked = 0;
static pid_t seen_pids[8192];
static int nseen = 0;
static bool seen_set[100000] = { false };

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
static void add_seen(pid_t p) {
  if (p <= 0 || p >= 100000) return;
  if (seen_set[p]) return;
  seen_set[p] = true;
  if (nseen < (int)(sizeof(seen_pids)/sizeof(seen_pids[0]))) seen_pids[nseen++] = p;
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
    add_seen(p);
    emit("{\"event\":\"watch\",\"pid\":%d}\n", p);
  } else {
    emit("{\"event\":\"watch_failed\",\"pid\":%d,\"errno\":%d,\"errstr\":\"%s\"}\n",
         p, errno, strerror(errno));
  }
}

static int list_children(pid_t parent, pid_t *out, int max) {
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0 };
  struct kinfo_proc *procs = NULL;
  size_t len = 0;
  if (sysctl(mib, 3, NULL, &len, NULL, 0) < 0) return 0;
  procs = (struct kinfo_proc*)malloc(len);
  if (procs == NULL) return 0;
  if (sysctl(mib, 3, procs, &len, NULL, 0) < 0) { free(procs); return 0; }
  int n = (int)(len / sizeof(struct kinfo_proc));
  int cnt = 0;
  for (int i = 0; i < n; i++) {
    if (procs[i].kp_eproc.e_ppid == parent && cnt < max) {
      out[cnt++] = procs[i].kp_proc.p_pid;
    }
  }
  free(procs);
  return cnt;
}

static void reconcile_after_fork(pid_t parent_pid) {
  pid_t buf[256];
  int n = list_children(parent_pid, buf, 256);
  for (int i = 0; i < n; i++) {
    if (!already_tracked(buf[i])) {
      watch(buf[i]);
    }
  }
}

static void full_reconcile(void) {
  pid_t buf[512];
  for (int i = 0; i < ntracked; i++) {
    int n = list_children(tracked[i], buf, 512);
    for (int j = 0; j < n; j++) {
      if (!already_tracked(buf[j])) {
        watch(buf[j]);
      }
    }
  }
}

static void dump_pids(const char *label, const pid_t *arr, int n) {
  printf("\"%s\":[", label);
  for (int i = 0; i < n; i++) printf("%s%d", i ? "," : "", arr[i]);
  printf("]");
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <root-binary> [fixture-args...]\n", argv[0]);
    return 2;
  }

  signal(SIGTERM, on_sig);
  signal(SIGINT, on_sig);
  signal(SIGPIPE, SIG_IGN);

  kq = kqueue();
  if (kq < 0) { perror("kqueue"); return 1; }

  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  short flags = POSIX_SPAWN_START_SUSPENDED;
  if (posix_spawnattr_setflags(&attr, flags) != 0) {
    perror("posix_spawnattr_setflags");
    return 1;
  }

  char **root_argv = &argv[1];

  pid_t root = -1;
  int sr = posix_spawn(&root, root_argv[0], NULL, &attr, root_argv, environ);
  posix_spawnattr_destroy(&attr);
  if (sr != 0) {
    fprintf(stderr, "posix_spawn failed: %s\n", strerror(sr));
    return 1;
  }
  emit("{\"event\":\"spawn\",\"pid\":%d,\"suspended\":true}\n", root);

  watch(root);

  if (!already_tracked(root)) {
    emit("{\"event\":\"halt\",\"reason\":\"watch_registration_failed\",\"pid\":%d}\n", root);
    kill(root, SIGKILL);
    return 3;
  }

  uint64_t t0 = mach_absolute_time();
  if (kill(root, SIGCONT) != 0) {
    emit("{\"event\":\"halt\",\"reason\":\"sigcont_failed\",\"errno\":%d,\"errstr\":\"%s\"}\n",
         errno, strerror(errno));
    kill(root, SIGKILL);
    return 4;
  }
  emit("{\"event\":\"sigcont\",\"pid\":%d}\n", root);

  struct timespec pollt = { .tv_sec = 0, .tv_nsec = 50 * 1000000L };
  struct kevent events[64];
  int duration_sec = 5;
  char *dur_env = getenv("PREATTACH_DURATION_SEC");
  if (dur_env != NULL) duration_sec = atoi(dur_env);

  time_t start = time(NULL);
  while (!g_done) {
    if (time(NULL) - start >= duration_sec) break;

    int nev = kevent(kq, NULL, 0, events, 64, &pollt);
    if (nev < 0) {
      if (errno == EINTR) continue;
      perror("kevent");
      break;
    }
    for (int i = 0; i < nev; i++) {
      pid_t ident = (pid_t)events[i].ident;
      uint32_t fflags = events[i].fflags;
      int64_t  kdata  = events[i].data;

      if (fflags & NOTE_FORK) {
        emit("{\"event\":\"fork\",\"parent_pid\":%d,\"kevent_data\":%lld}\n",
             ident, (long long)kdata);
        add_seen(ident);
        if (kdata > 0) {
          add_seen((pid_t)kdata);
        }
        reconcile_after_fork(ident);
      }
      if (fflags & NOTE_EXEC) {
        emit("{\"event\":\"exec\",\"pid\":%d}\n", ident);
      }
      if (fflags & NOTE_EXIT) {
        emit("{\"event\":\"exit\",\"pid\":%d}\n", ident);
      }
    }
  }

  full_reconcile();

  pid_t buf[1024];
  int missed_descendants = 0;
  pid_t missed[1024];
  for (int i = 0; i < ntracked; i++) {
    int n = list_children(tracked[i], buf, 1024);
    for (int j = 0; j < n; j++) {
      if (!already_tracked(buf[j]) && buf[j] != 0) {
        if (missed_descendants < 1024) {
          missed[missed_descendants++] = buf[j];
        }
      }
    }
  }

  uint64_t t1 = mach_absolute_time();
  uint64_t elapsed = t1 - t0;
  mach_timebase_info_data_t tb = { 0, 0 };
  mach_timebase_info(&tb);
  uint64_t elapsed_ms = (elapsed * tb.numer / tb.denom) / 1000000ULL;

  printf("{\"event\":\"end\",");
  dump_pids("tracked", tracked, ntracked);
  printf(",");
  dump_pids("seen", seen_pids, nseen);
  printf(",");
  dump_pids("missed_descendants", missed, missed_descendants);
  printf(",\"missed_descendants_count\":%d", missed_descendants);
  printf(",\"duration_ms\":%llu", (unsigned long long)elapsed_ms);
  printf("}\n");
  fflush(stdout);

  usleep(200 * 1000);
  close(kq);
  return missed_descendants > 0 ? 5 : 0;
}
