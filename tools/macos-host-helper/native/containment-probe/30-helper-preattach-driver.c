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
//   1. Create an independent ground-truth channel:
//      pipe(2) -> write end inherited by the spawned subtree via
//      CLINEMM_GROUND_TRUTH_FD=<write-fd>. Each fixture-created
//      descendant writes "CREATE pid=<pid> ppid=<pid> pgid=<pid>
//      start_us=<value>\n" immediately after its identity becomes
//      valid. This oracle is owned by the fixture tree, NOT the
//      tracker, so MISS = GROUND_TRUTH_CREATED - KQUEUE_TRACKED is
//      independent of the kqueue census.
//   2. Use POSIX_SPAWN_START_SUSPENDED -- the documented Darwin primitive
//      that creates the child with its task SUSPENDED at the kernel
//      boundary, so it cannot execute a single user-space instruction
//      until SIGCONT is delivered (Apple posix_spawnattr_setflags(3)).
//   3. While the root is suspended, register kqueue EVFILT_PROC |
//      NOTE_FORK | NOTE_EXEC | NOTE_EXIT on the root PID.
//   4. Verify the registration succeeded.
//   5. Deliver SIGCONT (NOT performed by the ClineMM agent shell --
//      SIGCONT comes from the human operator's Terminal.app because
//      the VSCodium-Helper-Plugin-sandboxed agent shell returns EPERM
//      on cross-process signal delivery).
//   6. Run the kevent loop: on NOTE_FORK, reconcile via sysctl
//      KERN_PROC to find the new child PIDs (Apple's kevent(2) does
//      not put the child PID in ident/data on all substrates), and
//      register watches on each new child recursively.
//   7. Drain the ground-truth pipe until EOF (or timeout).
//   8. Dump the tracked set + ground-truth set + missed set + counters
//      as JSON. The MISSED count is the authoritative discriminator.
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
// Ground-truth oracle (independent of the tracker):
//   The fixture tree emits CREATE records on a pipe inherited from the
//   driver. The driver's kqueue-based reconciliation builds a separate
//   KQUEUE_TRACKED set keyed on (start_us, pid). The MISSED set is
//   GROUND_TRUTH_CREATED - KQUEUE_TRACKED (by start_us, with pid as a
//   fallback when start_us == 0).
//
//   start_us is the kernel process start time (struct timeval converted
//   to microseconds), read via sysctl(KERN_PROC) for self and for any
//   child whose identity needs to be enriched. This gives stable
//   process identity across the probe duration (PID reuse is not a
//   hazard for the ground-truth oracle within a single run).
//
// WATCH_ESRCH_SHORT_LIVED classification:
//   A watch that fails with ESRCH is NOT a primitive failure if the
//   missing identity has zero ground-truth descendants. The
//   load-bearing condition is "every created descendant identity is
//   accounted for", not "every intermediate gets watched".
//
// Output (JSON line stream):
//   {"event":"spawn","pid":N,"suspended":true}
//   {"event":"watch","pid":N}
//   {"event":"watch_failed","pid":N,"errno":N,"errstr":"...","class":"ESRCH_SHORT_LIVED|FAILED_OTHER"}
//   {"event":"sigcont","pid":N}
//   {"event":"fork","parent_pid":N,"kevent_data":N}
//   {"event":"exec","pid":N}
//   {"event":"exit","pid":N}
//   {"event":"ground_truth","kind":"CREATE","pid":N,"ppid":N,"pgid":N,"start_us":N}
//   {"event":"end","tracked":[...],"ground_truth_created":[...],
//    "watch_esrch":[...],"missed_ground_truth":[...],"missed_ground_truth_count":N,
//    "counters":{...},"duration_ms":N}
//
// Usage:
//   30-helper-preattach-driver <root-binary> [fixture-args...]
//
// Environment:
//   PREATTACH_DURATION_SEC          override loop duration (default 5)
//   CLINEMM_GT_TRACE=1              (cosmetic only; CREATE events always emit)

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
#include <fcntl.h>
#include <poll.h>
#include <mach/mach_time.h>

extern char **environ;

// ---------- Tracked / seen pid tables ----------
#define MAX_PIDS 4096
static pid_t tracked[MAX_PIDS];
static int ntracked = 0;
static pid_t seen_pids[8192];
static int nseen = 0;
static bool seen_set[100000] = { false };

// ---------- Watch-result classification (ESRCH_SHORT_LIVED vs OTHER) ----------
static pid_t watch_esrch_list[MAX_PIDS];
static int nwatch_esrch = 0;
static pid_t watch_failed_other_list[MAX_PIDS];
static int nwatch_failed_other = 0;
static int watch_attempts = 0;
static int watch_success = 0;
static int watch_esrch_total = 0;
static int watch_failed_other_total = 0;

// ---------- Ground-truth oracle (independent channel) ----------
typedef struct {
  pid_t pid;
  pid_t ppid;
  pid_t pgid;
  uint64_t start_us;  // 0 if the writer could not read kinfo_proc
} gt_record_t;

#define MAX_GT 4096
static gt_record_t gt_created[MAX_GT];
static int ngt_created = 0;

// pid -> start_us mapping (populated when we discover start_us for a tracked pid).
typedef struct {
  pid_t pid;
  uint64_t start_us;
} pid_start_t;
#define MAX_PID_START 4096
static pid_start_t pid_start[MAX_PID_START];
static int npid_start = 0;

// fork_events is incremented on every NOTE_FORK we observe.
static int fork_events = 0;

// ground_truth_created_with_start_us_count
//   number of CREATE records that arrived with a non-zero start_us.
//   These are the strong-evidence cases; tracked_has requires EXACT
//   (pid, start_us) match for them.
// ground_truth_created_pid_only_count
//   number of CREATE records that arrived with start_us == 0 (we read
//   kinfo_proc before the proc entry was published). These fall back
//   to pid-only identity in tracked_has; they are explicitly weaker.
static int gt_with_start_us = 0;
static int gt_pid_only = 0;
// Round-3 (HALT_GROUND_TRUTH_PIPE_CAN_DROP_RECORDS): count WRITE_FAILED
// announcements from the fixture side. Non-zero => HALT, never PASS.
static int gt_write_failures = 0;
// Round-3: oracle reader fault latches (carry overflow, malformed).
static int gt_reader_fault = 0;
// Round-4 (HALT_ORACLE_WRITE_FAILURE_CHANNEL_NOT_FAILSAFE):
// latched when the spawned root fixture exits with status 86
// (GT_EXIT_EVIDENCE_FAIL). This is the authoritative cross-process
// signal that the oracle write side failed irrecoverably -- the
// in-pipe WRITE_FAILED line might have been lost to the same broken
// channel, but the kernel-mediated exit status cannot be lost.
static int gt_oracle_evidence_fail = 0;
// The exit status the fixture tree contracted on for a normal run.
// The signal-triggered-fork fixture in SIGTERM mode exits via signal
// (negative status) and that's not a failure; only 86 is.
#define GT_EXPECTED_OK_STATUS 0
#define GT_EVIDENCE_FAIL_STATUS 86

// Ground-truth pipe read end (set in main before posix_spawn).
static int gt_read_fd = -1;
// Ground-truth pipe write end kept by the driver ONLY to close-on-exec
// (we never write from the driver side; the fixture root writes via
// the inherited fd, serializing every descendant's CREATE itself --
// see descendant pipe below).
static int gt_write_fd = -1;

// Round-5 (HALT_ORACLE_DESCENDANT_FAILURE_NOT_PROPAGATED):
// Descendant-report pipe. Only the spawned root reads from this; every
// descendant (forked child, exec'd shell/node/python) inherits the
// write end and posts a small report line. Root's reader thread
// serializes each report as a CREATE on the GT pipe.
//
// This makes root the SOLE authoritative writer to the GT pipe. A
// descendant's _exit(86) is no longer load-bearing for the GT channel
// (the in-pipe WRITE_FAILED line is unreliable on a broken channel);
// instead, any descendant that cannot durably emit its report triggers
// root's reader thread to _exit(86), which the driver observes via
// waitpid(root).
static int desc_read_fd = -1;   // driver-owned (closed after spawn)
static int desc_write_fd = -1;  // inherited by descendants (closed by driver after spawn)

static volatile sig_atomic_t g_done = 0;
static void on_sig(int s) { (void)s; g_done = 1; }

static void emit(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  vprintf(fmt, ap); va_end(ap);
  fflush(stdout);
}

// ---------- start_us helper ----------
// Lookup start_us for a pid by scanning kinfo_proc. Returns 0 if not found.
static uint64_t lookup_start_us(pid_t p) {
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0 };
  size_t len = 0;
  if (sysctl(mib, 3, NULL, &len, NULL, 0) < 0) return 0;
  struct kinfo_proc *procs = (struct kinfo_proc *)malloc(len);
  if (procs == NULL) return 0;
  if (sysctl(mib, 3, procs, &len, NULL, 0) < 0) { free(procs); return 0; }
  int n = (int)(len / sizeof(struct kinfo_proc));
  uint64_t out = 0;
  for (int i = 0; i < n; i++) {
    if (procs[i].kp_proc.p_pid == p) {
      out = (uint64_t)procs[i].kp_proc.p_starttime.tv_sec * 1000000ULL
          + (uint64_t)procs[i].kp_proc.p_starttime.tv_usec;
      break;
    }
  }
  free(procs);
  return out;
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

// Bind start_us for a tracked pid (best-effort).
static void bind_pid_start(pid_t p, uint64_t start_us) {
  if (p <= 0) return;
  for (int i = 0; i < npid_start; i++) {
    if (pid_start[i].pid == p) { pid_start[i].start_us = start_us; return; }
  }
  if (npid_start < MAX_PID_START) {
    pid_start[npid_start].pid = p;
    pid_start[npid_start].start_us = start_us;
    npid_start++;
  }
}

static int kq = -1;
static void watch(pid_t p) {
  if (already_tracked(p)) return;
  watch_attempts++;
  // Best-effort: bind start_us from kinfo_proc when possible.
  uint64_t su = lookup_start_us(p);
  if (su != 0) bind_pid_start(p, su);

  struct kevent ev = { 0 };
  ev.ident = (uintptr_t)p;
  ev.filter = EVFILT_PROC;
  ev.flags = EV_ADD | EV_ENABLE | EV_CLEAR;
  ev.fflags = NOTE_FORK | NOTE_EXEC | NOTE_EXIT;
  int r = kevent(kq, &ev, 1, NULL, 0, NULL);
  if (r == 0) {
    add_tracked(p);
    add_seen(p);
    watch_success++;
    emit("{\"event\":\"watch\",\"pid\":%d}\n", p);
  } else {
    int e = errno;
    // Classify ESRCH as a short-lived race: the watched identity was
    // already gone before the watch armed. This is NOT a primitive
    // failure unless that identity had ground-truth descendants.
    if (e == ESRCH) {
      watch_esrch_total++;
      if (nwatch_esrch < MAX_PIDS) watch_esrch_list[nwatch_esrch++] = p;
      emit("{\"event\":\"watch_failed\",\"pid\":%d,\"errno\":%d,\"errstr\":\"%s\",\"class\":\"ESRCH_SHORT_LIVED\"}\n",
           p, e, strerror(e));
    } else {
      watch_failed_other_total++;
      if (nwatch_failed_other < MAX_PIDS) watch_failed_other_list[nwatch_failed_other++] = p;
      emit("{\"event\":\"watch_failed\",\"pid\":%d,\"errno\":%d,\"errstr\":\"%s\",\"class\":\"FAILED_OTHER\"}\n",
           p, e, strerror(e));
    }
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

static void dump_gt_records(void) {
  printf("\"ground_truth_created\":[");
  for (int i = 0; i < ngt_created; i++) {
    printf("%s{\"pid\":%d,\"ppid\":%d,\"pgid\":%d,\"start_us\":%llu}",
           i ? "," : "",
           gt_created[i].pid, gt_created[i].ppid, gt_created[i].pgid,
           (unsigned long long)gt_created[i].start_us);
  }
  printf("]");
}

// Drain the ground-truth pipe. Read records until EOF or a timeout.
// Each record: "CREATE pid=<pid> ppid=<pid> pgid=<pid> start_us=<value>\n"
// start_us may be 0 if the writer could not read kinfo_proc.
static void drain_ground_truth(int timeout_ms) {
  if (gt_read_fd < 0) return;

  // Round-3 (HALT_GROUND_TRUTH_PIPE_CAN_DROP_RECORDS):
  //   The reader is a LOSSLESS byte-oriented parser. Per Apple
  //   read(2), partial reads are legal on pipes; we must retain
  //   incomplete records across reads. EOF is detected only when the
  //   driver has closed its own gt_write_fd copy AND every fixture
  //   writer has exited (caller closes gt_write_fd immediately after
  //   posix_spawn succeeds -- see main()).
  //
  //   Overflow is a hard halt, not a silent drop.

  char buf[4096];
  size_t carry_len = 0;

  // Make the read end non-blocking so we can poll.
  int flags = fcntl(gt_read_fd, F_GETFL, 0);
  fcntl(gt_read_fd, F_SETFL, flags | O_NONBLOCK);

  time_t t0 = time(NULL);
  int eof_seen = 0;
  while (1) {
    struct pollfd pfd = { .fd = gt_read_fd, .events = POLLIN };
    int pr = poll(&pfd, 1, 100);
    if (pr < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (pr == 0) {
      // timeout tick
      if ((int)((time(NULL) - t0) * 1000) >= timeout_ms) break;
      continue;
    }

    // Read into the buffer space AFTER the carry. Always allow at least
    // 1 byte of room for the trailing '\n' of an in-progress record.
    if (carry_len >= sizeof(buf)) {
      emit("{\"event\":\"halt\",\"reason\":\"oracle_record_overflow\",\"carry_len\":%zu}\n",
           carry_len);
      gt_reader_fault = 1;
      break;
    }
    ssize_t n = read(gt_read_fd, buf + carry_len, sizeof(buf) - carry_len);
    if (n < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) continue;
      if (errno == EINTR) continue;
      break;
    }
    if (n == 0) {
      // EOF on the read end. Per Apple pipe(2) this only happens when
      // every write descriptor (including the driver's own gt_write_fd)
      // has been closed. Parse the trailing carry as a final record,
      // then exit.
      eof_seen = 1;
      if (carry_len > 0) {
        // Treat whatever is left as a final line for parsing.
        // The driver's contract requires every CREATE record to end in
        // '\n'; a non-empty carry at EOF indicates either truncation
        // (HALT) or a degenerate line we still attempt to parse.
        if (carry_len >= sizeof(buf)) {
          emit("{\"event\":\"halt\",\"reason\":\"oracle_record_overflow_at_eof\",\"carry_len\":%zu}\n",
               carry_len);
          gt_reader_fault = 1;
          break;
        }
        // Append a sentinel newline so the parser can attempt a parse.
        // If the carry was already terminated by '\n' this is a no-op
        // (the parser will treat it as a second empty line which is
        // ignored by the strncmp guard).
        if (buf[carry_len - 1] != '\n' && carry_len + 1 < sizeof(buf)) {
          buf[carry_len] = '\n';
          carry_len++;
        }
      } else {
        break;
      }
    } else {
      carry_len += (size_t)n;
    }

    // Parse complete lines out of [0, carry_len).
    size_t scan = 0;
    while (scan < carry_len) {
      size_t eol = scan;
      while (eol < carry_len && buf[eol] != '\n') eol++;
      if (eol >= carry_len) break;  // no full line yet
      buf[eol] = '\0';
      const char *line = buf + scan;

      // Parse "WRITE_FAILED pid=N attempted=N errno=N" first -- a
      // fixture tree that failed to write its CREATE record is an
      // EVIDENCE failure (round-3). Non-zero count -> HALT.
      if (strncmp(line, "WRITE_FAILED ", 13) == 0) {
        int pid = 0, attempted = 0, err = 0;
        if (sscanf(line + 13, "pid=%d attempted=%d errno=%d",
                   &pid, &attempted, &err) >= 2) {
          gt_write_failures++;
          emit("{\"event\":\"ground_truth\",\"kind\":\"WRITE_FAILED\",\"pid\":%d,\"attempted\":%d,\"errno\":%d}\n",
               pid, attempted, err);
        }
      }
      // Parse "CREATE pid=N ppid=N pgid=N start_us=N"
      else if (strncmp(line, "CREATE ", 7) == 0 && ngt_created < MAX_GT) {
        pid_t pid = 0, ppid = 0, pgid = 0;
        uint64_t start_us = 0;
        const char *p = line + 7;
        while (*p == ' ') p++;
        if (sscanf(p, "pid=%d ppid=%d pgid=%d start_us=%llu",
                   &pid, &ppid, &pgid,
                   (unsigned long long *)&start_us) >= 3) {
          gt_created[ngt_created].pid = pid;
          gt_created[ngt_created].ppid = ppid;
          gt_created[ngt_created].pgid = pgid;
          gt_created[ngt_created].start_us = start_us;
          ngt_created++;
          if (start_us != 0) gt_with_start_us++;
          else               gt_pid_only++;
          emit("{\"event\":\"ground_truth\",\"kind\":\"CREATE\",\"pid\":%d,\"ppid\":%d,\"pgid\":%d,\"start_us\":%llu}\n",
               pid, ppid, pgid, (unsigned long long)start_us);
        }
      }
      scan = eol + 1;
    }

    // LOSSLESS carry compaction:
    //   If scan consumed everything, carry is empty.
    //   If scan consumed some, move the residual to the front of buf.
    //   If scan consumed nothing (no newline found), KEEP all carry
    //   bytes -- they are an in-progress record that the next read
    //   will append to. This is the round-3 fix for the false-green
    //   hazard flagged by HALT_GROUND_TRUTH_PIPE_CAN_DROP_RECORDS.
    if (scan >= carry_len) {
      carry_len = 0;
    } else if (scan > 0) {
      size_t rem = carry_len - scan;
      memmove(buf, buf + scan, rem);
      carry_len = rem;
    }
    // else scan == 0: keep carry_len as-is.

    if (eof_seen) break;
    if (pfd.revents & (POLLERR | POLLHUP | POLLNVAL)) {
      // peer closed; loop one more time so the read() above returns 0
      // and we treat the remaining carry as the final parse attempt.
      // No break here -- we want the next iteration to see EOF.
      continue;
    }
  }
  fcntl(gt_read_fd, F_SETFL, flags);
}

// Returns 1 if (pid, start_us) is in KQUEUE_TRACKED, else 0.
//
// Identity rule (P0-1, fail-closed):
//   If the GT record carries a non-zero start_us, we require EXACT
//   match on BOTH pid AND start_us against a (pid,start_us) entry in
//   pid_start[]. We do NOT fall back to pid-only. This prevents the
//   false-GREEN class where pid-reuse (or an unrelated process with
//   the same pid) could mask a missing identity.
//
//   If the GT record carries start_us == 0 (we read kinfo_proc
//   before the proc entry was published), we fall back to pid-only.
//   This is explicitly weaker evidence and is reported as such via
//   the counters { ground_truth_created_count with start_us and
//   ground_truth_created_pid_only_count } so the operator can
//   quantify how many cases relied on the weaker rule.
//
// Within one probe run, start_us is empirically unique per fork()
// (verified on the substrate: parent=1789807010311285 vs
// child=1789807011033633 -- difference ~700ms matches the gap
// between the parent arriving in kqueue and the child being forked).
// So requiring exact (pid,start_us) match is the right rule.
static int tracked_has(gt_record_t *r) {
  // Strong path: require exact (pid, start_us) match.
  if (r->start_us != 0) {
    for (int i = 0; i < npid_start; i++) {
      if (pid_start[i].pid != 0 &&
          pid_start[i].pid == r->pid &&
          pid_start[i].start_us == r->start_us) {
        return 1;
      }
    }
    // start_us is known but no exact match -- this is a miss, not a
    // pid-only fallback. Fail closed.
    return 0;
  }
  // Weak path: pid-only when start_us is unknown. This is explicitly
  // weaker evidence and is counted separately.
  if (r->pid > 0 && already_tracked(r->pid)) return 1;
  return 0;
}

// Compute MISS = GROUND_TRUTH_CREATED - KQUEUE_TRACKED.
// Returns count; fills `missed_out` (capped at max_missed).
static int compute_missed(gt_record_t *missed_out, int max_missed) {
  int n = 0;
  for (int i = 0; i < ngt_created; i++) {
    if (!tracked_has(&gt_created[i])) {
      if (n < max_missed) missed_out[n] = gt_created[i];
      n++;
    }
  }
  return n;
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

  // ---------- Ground-truth pipe ----------
  // Created BEFORE posix_spawn so the write fd is inherited by every
  // descendant the fixture tree creates. The fixture ROOT writes
  // CREATE records on this fd; the driver reads from gt_read_fd.
  // Only the root writes -- descendants post reports on the
  // descendant pipe (below) which the root serializes.
  int gt_pipe[2];
  if (pipe(gt_pipe) != 0) {
    perror("pipe(gt)");
    return 1;
  }
  gt_read_fd = gt_pipe[0];
  gt_write_fd = gt_pipe[1];

  // ---------- Descendant-report pipe (round-5) ----------
  // Driver reads from this end after closing its own write end. The
  // root inherits the read end; every descendant inherits the write
  // end. Descendants post small "pid=N start_us=N\n" report lines;
  // root's reader thread serializes each as a CREATE on gt_write_fd.
  int desc_pipe[2];
  if (pipe(desc_pipe) != 0) {
    perror("pipe(desc)");
    return 1;
  }
  desc_read_fd = desc_pipe[0];    // driver closes after spawn (drained later)
  desc_write_fd = desc_pipe[1];   // driver closes after spawn (only descendants use)

  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  short flags = POSIX_SPAWN_START_SUSPENDED;
  if (posix_spawnattr_setflags(&attr, flags) != 0) {
    perror("posix_spawnattr_setflags");
    return 1;
  }

  // Build a fresh environment with all FDs exposed.
  // We do NOT modify the caller's environ -- we build a one-shot copy.
  char fd_env[64];
  snprintf(fd_env, sizeof fd_env, "CLINEMM_GROUND_TRUTH_FD=%d", gt_write_fd);
  char desc_env[64];
  snprintf(desc_env, sizeof desc_env, "CLINEMM_DESCENDANT_FD=%d", desc_write_fd);
  char desc_read_env[64];
  snprintf(desc_read_env, sizeof desc_read_env, "CLINEMM_GT_DESC_READ_FD=%d", desc_read_fd);
  size_t env_count = 0;
  while (environ[env_count] != NULL) env_count++;
  char **new_env = (char **)calloc(env_count + 4, sizeof(char *));
  if (new_env == NULL) { perror("calloc env"); return 1; }
  for (size_t i = 0; i < env_count; i++) new_env[i] = environ[i];
  new_env[env_count]     = fd_env;
  new_env[env_count + 1] = desc_env;
  new_env[env_count + 2] = desc_read_env;
  new_env[env_count + 3] = NULL;

  char **root_argv = &argv[1];

  pid_t root = -1;
  int sr = posix_spawn(&root, root_argv[0], NULL, &attr, root_argv, new_env);
  posix_spawnattr_destroy(&attr);
  if (sr != 0) {
    fprintf(stderr, "posix_spawn failed: %s\n", strerror(sr));
    return 1;
  }
  emit("{\"event\":\"spawn\",\"pid\":%d,\"suspended\":true,\"gt_fd\":%d}\n",
       root, gt_write_fd);

  // Round-3 (HALT_GROUND_TRUTH_PIPE_CAN_DROP_RECORDS):
  //   Close the driver's own copy of the GT pipe write end IMMEDIATELY.
  //   Per Apple pipe(2), EOF on the read end is only delivered after
  //   every write descriptor (including this one) has been closed.
  //   The spawned root already inherited a duplicate via
  //   CLINEMM_GROUND_TRUTH_FD=<gt_write_fd>, so this close does NOT
  //   prevent the fixture tree from announcing. It DOES make the
  //   drain_ground_truth() EOF path meaningful: when the last fixture
  //   writer exits, the reader actually sees EOF instead of waiting
  //   for timeout.
  if (gt_write_fd >= 0) {
    close(gt_write_fd);
    gt_write_fd = -1;
  }
  // Round-5: also close our copy of the descendant-report pipe WRITE
  // end. Root inherited the read end; descendants inherited the
  // write end. Closing our copy here doesn't affect descendants but
  // makes the descendant pipe EOF semantics meaningful for root's
  // reader thread (it can detect "no more descendants will report").
  if (desc_write_fd >= 0) {
    close(desc_write_fd);
    desc_write_fd = -1;
  }

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
        fork_events++;
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

  // Drain ground-truth pipe. Give the fixture tree up to (duration+2)
  // seconds to publish all CREATE records before EOF.
  int drain_ms = (duration_sec + 2) * 1000;
  drain_ground_truth(drain_ms);

  // Round-4 (HALT_ORACLE_WRITE_FAILURE_CHANNEL_NOT_FAILSAFE):
  // Reap the spawned root with WNOHANG. If it already exited with
  // status 86 (GT_EXIT_EVIDENCE_FAIL), the oracle write side failed
  // irrecoverably -- the in-pipe WRITE_FAILED signal might have been
  // lost to the same broken channel, but the kernel-mediated exit
  // status cannot be. Latch the evidence-fail flag.
  //
  // Use WNOHANG and a brief retry: for non-signal fixtures, the root
  // is sleeping for the duration; we just SIGTERM it after a short
  // grace and reap. For signal-triggered-fork SIGTERM mode, the root
  // already exited on its own via SIGTERM (negative status, NOT 86,
  // so no false-positive latch).
  {
    int root_status = 0;
    pid_t r;
    int reaped = 0;
    // Give the root up to 2 seconds to exit on its own.
    for (int i = 0; i < 20; i++) {
      r = waitpid(root, &root_status, WNOHANG);
      if (r == root) { reaped = 1; break; }
      if (r < 0) break;
      usleep(100 * 1000);  // 100ms
    }
    if (!reaped) {
      // Root still alive after grace period -- send SIGTERM and wait.
      // This is normal for fixtures that sleep until killed.
      kill(root, SIGTERM);
      // Wait up to 2 more seconds.
      for (int i = 0; i < 20; i++) {
        r = waitpid(root, &root_status, WNOHANG);
        if (r == root) { reaped = 1; break; }
        if (r < 0) break;
        usleep(100 * 1000);
      }
      if (!reaped) {
        // Root is wedged. SIGKILL as last resort.
        kill(root, SIGKILL);
        r = waitpid(root, &root_status, 0);
        reaped = (r == root);
      }
    }
    if (reaped) {
      if (WIFEXITED(root_status)) {
        int code = WEXITSTATUS(root_status);
        emit("{\"event\":\"root_exit\",\"pid\":%d,\"exit_code\":%d,\"signal\":false}\n",
             root, code);
        if (code == GT_EVIDENCE_FAIL_STATUS) {
          gt_oracle_evidence_fail = 1;
        }
      } else if (WIFSIGNALED(root_status)) {
        int sig = WTERMSIG(root_status);
        emit("{\"event\":\"root_exit\",\"pid\":%d,\"signal\":true,\"signal_num\":%d}\n",
             root, sig);
        // signal-triggered-fork SIGTERM mode is the contract for this;
        // we do NOT latch on signal-induced exit unless the fixture
        // explicitly _exit(86)'d. Signal-only termination is NOT
        // evidence of oracle failure.
      }
    } else {
      emit("{\"event\":\"root_exit\",\"pid\":%d,\"reaped\":false}\n", root);
    }
  }

  // Compute the authoritative MISSED set.
  gt_record_t missed_gt[MAX_GT];
  int missed_count = compute_missed(missed_gt, MAX_GT);

  uint64_t t1 = mach_absolute_time();
  uint64_t elapsed = t1 - t0;
  mach_timebase_info_data_t tb = { 0, 0 };
  mach_timebase_info(&tb);
  uint64_t elapsed_ms = (elapsed * tb.numer / tb.denom) / 1000000ULL;

  // ---------- End event (new schema) ----------
  printf("{\"event\":\"end\",");
  dump_pids("tracked", tracked, ntracked);
  printf(",");
  dump_gt_records();
  printf(",");
  dump_pids("watch_esrch", watch_esrch_list, nwatch_esrch);
  printf(",");
  printf("\"watch_failed_other\":[");
  for (int i = 0; i < nwatch_failed_other; i++)
    printf("%s%d", i ? "," : "", watch_failed_other_list[i]);
  printf("]");
  printf(",");
  printf("\"missed_ground_truth\":[");
  for (int i = 0; i < missed_count; i++) {
    printf("%s{\"pid\":%d,\"ppid\":%d,\"pgid\":%d,\"start_us\":%llu}",
           i ? "," : "",
           missed_gt[i].pid, missed_gt[i].ppid, missed_gt[i].pgid,
           (unsigned long long)missed_gt[i].start_us);
  }
  printf("]");
  printf(",\"missed_ground_truth_count\":%d", missed_count);
  printf(",\"duration_ms\":%llu", (unsigned long long)elapsed_ms);
  printf(",\"counters\":{");
  printf("\"fork_events\":%d", fork_events);
  printf(",\"watch_attempts\":%d", watch_attempts);
  printf(",\"watch_success\":%d", watch_success);
  printf(",\"watch_esrch\":%d", watch_esrch_total);
  printf(",\"watch_failed_other\":%d", watch_failed_other_total);
  printf(",\"ground_truth_created_count\":%d", ngt_created);
  printf(",\"ground_truth_created_with_start_us_count\":%d", gt_with_start_us);
  printf(",\"ground_truth_created_pid_only_count\":%d", gt_pid_only);
  printf(",\"ground_truth_write_failures\":%d", gt_write_failures);
  printf(",\"ground_truth_reader_fault\":%d", gt_reader_fault);
  printf(",\"ground_truth_oracle_evidence_fail\":%d", gt_oracle_evidence_fail);
  printf(",\"ground_truth_seen_count\":%d", ngt_created);
  printf(",\"ground_truth_missed_count\":%d", missed_count);
  printf("}}\n");
  fflush(stdout);

  usleep(200 * 1000);
  close(kq);
  if (gt_read_fd >= 0) close(gt_read_fd);
  if (gt_write_fd >= 0) close(gt_write_fd);
  if (desc_read_fd >= 0) close(desc_read_fd);
  if (desc_write_fd >= 0) close(desc_write_fd);
  // Round-4 exit-code semantics:
  //   0 = PASS  (no missed GT, no write failures, no evidence fail)
  //   5 = MISS  (GT records that kqueue did not track)
  //   6 = ORACLE_WRITE_FAIL  (gt_write_failures > 0 -- EVIDENCE failure)
  //   7 = ORACLE_READER_FAULT  (carry overflow etc.)
  //   8 = ORACLE_EVIDENCE_FAIL  (root exited 86 -- kernel-mediated oracle
  //                              write-side failure signal)
  if (gt_oracle_evidence_fail) return 8;
  if (gt_reader_fault) return 7;
  if (gt_write_failures > 0) return 6;
  return missed_count > 0 ? 5 : 0;
}
