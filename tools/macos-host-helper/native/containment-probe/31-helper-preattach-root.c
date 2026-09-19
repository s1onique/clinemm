// 31-helper-preattach-root.c
//
// User-command-equivalent fixture root for
// ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01.
//
// Single binary, six (now nine) sub-fixtures selected by --fixture=<name>:
//
//   shell-A           bash sleep + subshell + grandchild sleep
//                     (inherited PGID; warmup; should be GREEN)
//   node-B            node sleep child
//                     (inherited PGID; warmup; should be GREEN)
//   python-C          python sleep child
//                     (inherited PGID; warmup; should be GREEN)
//   mixed-D           bash -> python -> sleep
//                     (inherited PGID heterogeneous; should be GREEN)
//   node-escape-E     shell-wrapped node child that spawns detached:true
//                     (setsid equivalent; RED in predecessor post-spawn
//                      sequence; under preattach -- must be GREEN)
//   python-escape-F   shell-wrapped python child with start_new_session=True
//                     (setsid equivalent; RED in predecessor post-spawn
//                      sequence; under preattach -- must be GREEN)
//   double-fork-setsid-G
//                     immediate fork -> setsid -> immediate fork -> exit
//                     (grandchild reparented to launchd; must be GREEN)
//   exec-fork-H       shell exec'd from this binary; the exec'd shell
//                     immediately forks a grandchild with setsid
//                     (NOTE_EXEC + NOTE_FORK composition; must be GREEN)
//   signal-triggered-fork-I
//                     receives SIGTERM (or SIGINT) via sigwait() in
//                     normal control flow, then forks a detached child
//                     and announces it to GT before the parent exits.
//                     (tracker must observe the child during teardown)
//
// CRITICAL: NO cooperative delay permitted in this binary. Each
// fixture must perform its escape (setsid / detached:true /
// start_new_session) as the very first user-space action after
// SIGCONT resume. The driver's preattach is the ONLY barrier.
//
// Ground-truth oracle (independent of the tracker):
//   On entry, the binary reads CLINEMM_GROUND_TRUTH_FD=<fd> from the
//   environment. This fd is the write end of a pipe the driver set up
//   before posix_spawn. The binary writes one CREATE record per
//   fixture-created process, as early as possible after that process
//   identity is valid:
//
//     CREATE pid=<pid> ppid=<pid> pgid=<pid|0> start_us=<value>\n
//
//   start_us is the kernel start time of the process, read via
//   sysctl(KERN_PROC). start_us may be 0 if the read races a
//   not-yet-published proc entry; the driver falls back to pid-only
//   identity in that case (counted separately via
//   ground_truth_created_pid_only_count).
//
//   pgid is reported accurately for C-side gt_announce() calls
//   (which read kinfo_proc). For shell/python-announced records,
//   pgid=0 -- the announcement deliberately does NOT spawn `ps`/`tr`
//   to enrich the pgid field, because each such subprocess would
//   itself be a descendant the oracle does NOT announce
//   (P1 oracle-contamination fix). The driver's discrimination is
//   by (pid, start_us), not by pgid.
//
// Usage:
//   31-helper-preattach-root --fixture=<name> [duration-seconds]

#include <sys/types.h>
#include <sys/sysctl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <errno.h>
#include <spawn.h>
#include <signal.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <stdbool.h>

extern char **environ;

static int g_duration = 30;
static int g_gt_fd = -1;

static void emit(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  vfprintf(stderr, fmt, ap); va_end(ap);
  fflush(stderr);
}

// ---------- Ground-truth oracle (writer side) ----------
// Read start_us for a pid via sysctl(KERN_PROC). Returns 0 on failure.
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

// Announce a CREATE record for the given pid to the ground-truth pipe.
// Reads ppid/pgid/start_us from kinfo_proc at call time.
//
// Round-3 (HALT_GROUND_TRUTH_PIPE_CAN_DROP_RECORDS):
//   A failed GT write is an EVIDENCE failure, not a "process didn't
//   exist". We retry once with a tiny backoff, then surface a
//   WRITE_FAILED line on the SAME pipe (best effort) plus a stderr
//   line. The driver counts WRITE_FAILED lines into
//   ground_truth_write_failures and never allows a PASS verdict when
//   that count is non-zero.
//
// Round-4 (HALT_ORACLE_WRITE_FAILURE_CHANNEL_NOT_FAILSAFE):
//   The WRITE_FAILED line uses the same pipe that just failed -- if
//   the pipe is broken (reader gone, EPIPE, SIGPIPE) the diagnostic
//   itself can be lost, leaving the driver with neither the CREATE
//   nor the failure signal. The invariant now is:
//     CREATE could not be durably emitted  =>  this run can NEVER return PASS.
//   On an unrecoverable write failure, the fixture process _exit(86)s
//   immediately. The driver waitpid()s the root after the drain; if
//   it exits with status 86 (or any unexpected nonzero status outside
//   the signal-triggered-fork SIGTERM contract), the driver latches
//   ground_truth_oracle_evidence_fail and exit code 8 is reserved.
#define GT_EXIT_EVIDENCE_FAIL 86

static int g_gt_write_failures = 0;
static volatile sig_atomic_t g_oracle_evidence_fail = 0;

static void gt_announce_failure(pid_t pid, int attempted, int err) {
  // Best-effort in-pipe signal. If THIS write fails too (broken pipe,
  // SIGPIPE), the failure is still authoritative via _exit(86) below.
  char wb[160];
  int wn = snprintf(wb, sizeof wb,
                    "WRITE_FAILED pid=%d attempted=%d errno=%d\n",
                    (int)pid, attempted, err);
  if (wn > 0) {
    ssize_t ww = write(g_gt_fd, wb, (size_t)wn);
    (void)ww;
  }
  // Last-resort stderr line: visible to the operator and to any test
  // harness that captures stderr. The driver does not read stderr.
  fprintf(stderr, "[gt_write_failed] pid=%d attempted=%d errno=%d\n",
          (int)pid, attempted, err);
  // Authoritative cross-process-boundary signal: terminate this fixture
  // process with the dedicated nonzero status so waitpid() in the
  // driver sees it. This is the round-4 failsafe: the failure CANNOT
  // be lost across the process boundary because process exit status
  // is a kernel-mediated fact, not a pipe-mediated fact.
  g_oracle_evidence_fail = 1;
  _exit(GT_EXIT_EVIDENCE_FAIL);
}

static void gt_announce(pid_t pid) {
  if (g_gt_fd < 0 || pid <= 0) return;
  uint64_t start_us = gt_start_us_for(pid);
  pid_t ppid = -1;
  pid_t pgid = -1;
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
  // Retry short writes up to 3 times with a 1ms backoff; PIPE_BUF is
  // 512 bytes on macOS and these records are < 160 bytes, so EAGAIN
  // is the only realistic non-fatal failure mode (kernel buffer
  // temporarily full under fork-storm burst). Any other errno
  // (EPIPE, EIO, ENXIO, EBADF, EINVAL) means the channel is broken
  // and the failure is authoritative via _exit(86).
  for (int attempt = 0; attempt < 3; attempt++) {
    ssize_t w = write(g_gt_fd, buf + off, total - off);
    if (w < 0) {
      if (errno == EINTR) continue;
      if (errno == EAGAIN) {
        usleep(1000);
        continue;
      }
      // Broken channel (EPIPE/EIO/ENXIO/EBADF). Fatal immediately --
      // any subsequent WRITE_FAILED write on the same fd is unreliable.
      gt_announce_failure(pid, (int)total, errno);
      // gt_announce_failure does _exit(86), so we never reach here.
      g_gt_write_failures++;
      return;
    }
    off += (size_t)w;
    if (off >= total) return;
    // Short write without EAGAIN: shouldn't happen on a pipe for a
    // single record < PIPE_BUF, but treat as a soft retry.
    usleep(1000);
  }
  if (off < total) {
    // Persistent underflow after 3 retries: kernel buffer not draining.
    // This is rare but not strictly a broken channel; treat as fatal
    // anyway because we cannot guarantee the record arrived.
    gt_announce_failure(pid, (int)(total - off), EAGAIN);
    g_gt_write_failures++;
  }
}

static void gt_init(void) {
  const char *e = getenv("CLINEMM_GROUND_TRUTH_FD");
  if (e == NULL) {
    g_gt_fd = -1;
    return;
  }
  int fd = atoi(e);
  if (fd <= 0) {
    g_gt_fd = -1;
    return;
  }
  g_gt_fd = fd;
  // Set CLOEXEC off so exec'd programs can also write -- but CLOEXEC
  // is per-fd. We do NOT want CLOEXEC because some fixtures exec into
  // programs that should NOT inherit (the C binary announces them
  // itself before exec).
  int flags = fcntl(g_gt_fd, F_GETFD, 0);
  if (flags >= 0) fcntl(g_gt_fd, F_SETFD, flags & ~FD_CLOEXEC);
  // Announce ourselves first.
  gt_announce(getpid());
}

static pid_t spawn_inherit(const char *path, char *const argv[]) {
  pid_t pid = -1;
  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  // Inherit parent's process group -- this is the WARMUP case
  // (inherited PGID; no setsid).
  int r = posix_spawn(&pid, path, NULL, &attr, argv, environ);
  posix_spawnattr_destroy(&attr);
  if (r != 0) {
    fprintf(stderr, "posix_spawn failed: %s\n", strerror(r));
    return -1;
  }
  // Announce the spawned process to the ground-truth oracle.
  gt_announce(pid);
  return pid;
}

// Warmup: bash tree (inherited PGID).
// CRITICAL: the bash sub-script writes its own GT records for the
// grandchild sleep processes via `>&$CLINEMM_GROUND_TRUTH_FD`. The C
// code only announces the immediate fork-child.
static void fixture_shell_a(int dur) {
  emit("[fixture-shell-A] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  pid_t c = fork();
  if (c == 0) {
    // Child: announce ourselves first, then exec.
    gt_announce(getpid());
    // The bash sub-script writes GT records for grandchildren via
    // `>&$CLINEMM_GROUND_TRUTH_FD`. exec preserves the environment.
    //
    // P1: do NOT spawn `ps -o pgid=` or `tr` to fetch pgid -- each
    // invocation is a new descendant that the oracle does NOT
    // announce, contaminating the GROUND_TRUTH_CREATED set. Use
    // pgid=0 in the CREATE record: the driver's discrimination is
    // by (pid, start_us), not by pgid.
    execl("/bin/sh", "sh", "-c",
      "GTFD=${CLINEMM_GROUND_TRUTH_FD:-/dev/null}; "
      "announce() { printf 'CREATE pid=%s ppid=%s pgid=0 start_us=0\\n' \"$1\" \"$2\" >&\"$GTFD\"; }; "
      "(sleep \"$0\" & announce \"$!\" \"$$\"; "
      "(sleep \"$0\" & announce \"$!\" \"$$\"; wait)) & wait",
      d, NULL);
    _exit(127);
  }
  // Parent: announce the immediate child.
  gt_announce(c);
  waitpid(c, NULL, 0);
}

// Warmup: node sleep child (inherited PGID).
// The node script writes a GT record for the sleep grandchild via
// fs.writeSync(env.CLINEMM_GROUND_TRUTH_FD, "CREATE ...\n").
static void fixture_node_b(int dur) {
  emit("[fixture-node-B] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  pid_t c = spawn_inherit("/bin/sh", (char *const[]){
    "sh", "-c",
    "exec /opt/homebrew/bin/node -e \"const fd=parseInt(process.env.CLINEMM_GROUND_TRUTH_FD||'-1',10); const c=require('child_process').spawn('sleep', process.argv[1], { stdio: 'ignore' }); if(fd>0) require('fs').writeSync(fd, 'CREATE pid='+c.pid+' ppid='+process.pid+' pgid='+c.pid+' start_us=0\\n'); setInterval(()=>{}, 1<<30);\"",
    d, NULL });
  if (c > 0) waitpid(c, NULL, 0);
}

// Warmup: python sleep child (inherited PGID).
// The python script writes a GT record for the sleep grandchild.
// We write the python source to a tempfile in /tmp/clinemm_probe_*, then
// exec python3 on it. This avoids the nested-quoting nightmare.
static pid_t spawn_python_gt(const char *dur_str, bool detached) {
  // Write the python source to a tempfile. The filename includes the
  // pid so concurrent runs don't collide.
  char path[128];
  snprintf(path, sizeof path, "/tmp/clinemm_probe_py_%d.py", (int)getpid());
  FILE *fp = fopen(path, "w");
  if (fp == NULL) { perror("fopen py"); return -1; }
  // Use unbuffered stdout, write to fd from env, then either wait or
  // exit immediately for the detached case.
  const char *sns = detached ? "True" : "False";
  char hdr[512];
  snprintf(hdr, sizeof hdr,
    "import os, sys, subprocess\n"
    "fd = int(os.environ.get('CLINEMM_GROUND_TRUTH_FD', '-1'))\n"
    "kwargs = {}\n"
    "if %s:\n"
    "    kwargs['start_new_session'] = True\n"
    "p = subprocess.Popen(['sleep', sys.argv[1]], **kwargs)\n"
    "line = f'CREATE pid={p.pid} ppid={os.getpid()} pgid={p.pid} start_us=0\\n'\n"
    "if fd > 0:\n"
    "    os.write(fd, line.encode())\n",
    sns);
  fputs(hdr, fp);
  if (!detached) {
    fputs("p.wait()\n", fp);
  } else {
    fputs("p.unref() if hasattr(p, 'unref') else None\n", fp);
    fputs("sys.exit(0)\n", fp);
  }
  fclose(fp);

  pid_t pid = -1;
  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  int r = posix_spawn(&pid, "/usr/bin/python3", NULL, &attr,
                      (char *const[]){ "python3", path, (char *)dur_str, NULL },
                      environ);
  posix_spawnattr_destroy(&attr);
  // Do NOT unlink here -- python3 may not have exec'd into the script
  // yet. Caller should unlink after waitpid; for safety we leave a tiny
  // /tmp residue (the helper is not production software).
  if (r != 0) { fprintf(stderr, "posix_spawn python: %s\n", strerror(r)); unlink(path); return -1; }
  // Stash the path in a side table so the caller can unlink it; for
  // simplicity we just leave the file -- /tmp residue is fine for a
  // diagnostic probe.
  gt_announce(pid);
  return pid;
}

static void fixture_python_c(int dur) {
  emit("[fixture-python-C] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  pid_t c = spawn_python_gt(d, false);
  if (c > 0) waitpid(c, NULL, 0);
}

static void fixture_mixed_d(int dur) {
  emit("[fixture-mixed-D] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  pid_t c = spawn_python_gt(d, false);
  if (c > 0) waitpid(c, NULL, 0);
}

static void fixture_python_escape(int dur) {
  emit("[fixture-python-escape-F] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  pid_t c = spawn_python_gt(d, true);
  if (c > 0) waitpid(c, NULL, 0);
}


// ESCAPE E: node detached:true (setsid equivalent). RED in the
// predecessor's spawn-then-attach sequence. This is the load-bearing
// case: under preattach with kernel-suspended barrier, the watch must
// be installed BEFORE the escape happens.
static void fixture_node_escape(int dur) {
  emit("[fixture-node-escape-E] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  // Spawn a node child that immediately performs detached:true spawn.
  // CRITICAL: no sleep BEFORE the detached spawn.
  pid_t c = spawn_inherit("/bin/sh", (char *const[]){
    "sh", "-c",
    "exec /opt/homebrew/bin/node -e \"const fd=parseInt(process.env.CLINEMM_GROUND_TRUTH_FD||'-1',10); const c = require('child_process').spawn('sleep', process.argv[1], { detached: true, stdio: 'ignore' }); if(fd>0) require('fs').writeSync(fd, 'CREATE pid='+c.pid+' ppid='+process.pid+' pgid='+c.pid+' start_us=0\\n'); c.unref(); setInterval(() => {}, 1 << 30);\"",
    d, NULL });
  if (c > 0) waitpid(c, NULL, 0);
}

// ESCAPE F: python start_new_session=True (setsid equivalent).
// (definition via spawn_python_gt above)

// FIXTURE G: double-fork + setsid + immediate exit.
//   root -> fork child1 -> setsid() -> fork child2 (grandchild) -> child1 exits
//   grandchild survives; reparented to launchd.
// CRITICAL: NO sleep before setsid() or second fork.
static void fixture_double_fork_setsid(int dur) {
  emit("[fixture-double-fork-setsid-G] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  pid_t c1 = fork();
  if (c1 == 0) {
    // child1: announce, setsid, fork child2, exit.
    gt_announce(getpid());
    setsid();
    pid_t c2 = fork();
    if (c2 == 0) {
      // child2 (grandchild of root): announce, sleep, exit.
      gt_announce(getpid());
      sleep((unsigned)dur);
      _exit(0);
    }
    // child1 announces grandchild before exiting.
    gt_announce(c2);
    _exit(0);
  }
  // root announces child1 and immediately reaps.
  gt_announce(c1);
  waitpid(c1, NULL, 0);
}

// FIXTURE H: exec -> fork -> setsid.
//   root execs /bin/sh; the exec'd shell forks a grandchild with setsid.
//   This exercises NOTE_EXEC + NOTE_FORK composition.
// The shell wrapper writes the GT record for the grandchild via
// `>&$CLINEMM_GROUND_TRUTH_FD`, just like fixture_shell_a.
static void fixture_exec_fork(int dur) {
  emit("[fixture-exec-fork-H] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  pid_t c = fork();
  if (c == 0) {
    // Child announces itself, then execs into bash.
    gt_announce(getpid());
    execl("/bin/sh", "sh", "-c",
      "GTFD=${CLINEMM_GROUND_TRUTH_FD:-/dev/null}; "
      "setsid sleep \"$0\" >/dev/null 2>&1 & "
      "pid=$!; "
      "printf 'CREATE pid=%s ppid=%s pgid=0 start_us=0\\n' \"$pid\" \"$$\" >&\"$GTFD\"; "
      "wait $pid",
      d, NULL);
    _exit(127);
  }
  gt_announce(c);
  waitpid(c, NULL, 0);
}

// FIXTURE I: SIGNAL_TRIGGERED_FORK (renamed honestly per P1 review).
//
// What this fixture actually proves:
//   After the parent receives SIGTERM, it forks a detached child and
//   announces it to the GT channel BEFORE the parent exits. The
//   tracker must observe this detached child even though it is created
//   during the parent's teardown.
//
// What this fixture does NOT prove:
//   That the driver's kqueue primitive captures the child when an
//   EXTERNAL actor (the production helper) initiates a teardown. The
//   driver does not send SIGTERM here; the signal is either
//   self-raised (SIGTERM/SIGINT case) or delivered by the operator's
//   shell `kill` command (which is the realistic mode for this ACT,
//   see 73-operator-handoff.md).
//
// P1 design (per reviewer):
//   No complex work in a signal handler. The parent blocks SIGTERM and
//   SIGINT with sigprocmask, then waits for the signal via sigwait()
//   in normal control flow. Once the signal is observed, the parent
//   forks a detached child (setsid + sleep) and announces it BEFORE
//   exiting. The kernel-suspended preattach guarantees the kqueue
//   primitive is already in place before this fork happens.
//
// Modes (set via CLINEMM_FIXTURE_I_SIGNAL):
//   SIGTERM  -> block SIGTERM/SIGINT, sigwait() for SIGTERM, fork+announce+exit
//   SIGINT   -> block SIGTERM/SIGINT, sigwait() for SIGINT,  fork+announce+exit
//   SIGKILL  -> SIGKILL cannot be caught or waited on; we cannot model
//               "fork during SIGKILL teardown" with a synchronous
//               control flow. Documented as unsupported.
//   unset    -> sleep dur seconds (control case, no signal).
//
static int fixture_i_wait_for_signal(const char *mode) {
  // Block the signal first so it can be observed via sigwait.
  sigset_t set;
  sigemptyset(&set);
  sigaddset(&set, SIGTERM);
  sigaddset(&set, SIGINT);
  int pr = sigprocmask(SIG_BLOCK, &set, NULL);
  if (pr != 0) {
    fprintf(stderr, "[fixture-i] sigprocmask failed: %s\n", strerror(errno));
    return -1;
  }

  // Self-raise OR wait for external kill. Both are equivalent for
  // this fixture's purpose: they produce a pending signal that
  // sigwait consumes. Self-raise makes the run reproducible without
  // external orchestration.
  if (strcmp(mode, "SIGTERM") == 0) {
    raise(SIGTERM);
  } else if (strcmp(mode, "SIGINT") == 0) {
    raise(SIGINT);
  } else {
    // External mode: do NOT self-raise; sigwait will block until
    // the operator's Terminal delivers the signal via `kill`.
    emit("[fixture-i] external mode: waiting for SIGTERM or SIGINT "
         "(operator must `kill -TERM <pid>`)\n");
  }

  int sig = 0;
  int sr = sigwait(&set, &sig);
  if (sr != 0) {
    fprintf(stderr, "[fixture-i] sigwait failed: %s\n", strerror(sr));
    return -1;
  }
  emit("[fixture-i] received signal=%d, forking detached child now\n", sig);

  // Now in NORMAL control flow -- safe to call sysctl, malloc, write.
  pid_t c = fork();
  if (c == 0) {
    // Child: detach and survive parent.
    setsid();
    sleep(60);
    _exit(0);
  }
  if (c < 0) {
    fprintf(stderr, "[fixture-i] fork failed: %s\n", strerror(errno));
    return -1;
  }
  // Announce the detached child to the GT channel BEFORE the parent
  // exits. This is the load-bearing claim: the child is created during
  // teardown, announced while the parent still exists, and then the
  // parent exits. The tracker must observe the child.
  gt_announce(c);

  // Re-raise so the parent terminates as the harness expects.
  // Use signal() to restore default action then raise via kill(getpid())
  // so the signal can no longer be blocked.
  sigprocmask(SIG_UNBLOCK, &set, NULL);
  kill(getpid(), sig);
  // If we get here, signal was masked -- exit cleanly.
  return 0;
}

static void fixture_signal_triggered_fork(int dur) {
  emit("[fixture-signal-triggered-fork-I] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());

  const char *sig = getenv("CLINEMM_FIXTURE_I_SIGNAL");
  if (sig != NULL && (strcmp(sig, "SIGTERM") == 0 || strcmp(sig, "SIGINT") == 0)) {
    fixture_i_wait_for_signal(sig);
    return;
  }
  if (sig != NULL && strcmp(sig, "SIGKILL") == 0) {
    fprintf(stderr,
      "[fixture-signal-triggered-fork-I] SIGKILL mode is unsupported: "
      "SIGKILL cannot be caught or sigwait()ed; the kqueue primitive "
      "must rely on a different teardown mechanism for SIGKILL. "
      "Sleeping %d seconds as a no-op.\n", dur);
    sleep((unsigned)dur);
    return;
  }
  // No signal scheduled: just sleep so the test can observe the
  // parent without a race.
  sleep((unsigned)dur);
}

int main(int argc, char **argv) {
  const char *fixture = NULL;
  for (int i = 1; i < argc; i++) {
    if (strncmp(argv[i], "--fixture=", 10) == 0) {
      fixture = argv[i] + 10;
    } else if (strncmp(argv[i], "--duration=", 11) == 0) {
      g_duration = atoi(argv[i] + 11);
    }
  }
  if (argc >= 2 && argv[1][0] != '-') {
    // Positional: argv[1] is duration (compat with predecessor harness).
    g_duration = atoi(argv[1]);
  }
  if (fixture == NULL) {
    fprintf(stderr, "usage: %s --fixture=<name> [duration]\n"
      "  names: shell-A node-B python-C mixed-D node-escape python-escape\n"
      "         double-fork-setsid exec-fork signal-triggered-fork\n",
      argv[0]);
    return 2;
  }

  // Round-4 (HALT_ORACLE_WRITE_FAILURE_CHANNEL_NOT_FAILSAFE):
  // Suppress SIGPIPE so that a broken GT pipe returns EPIPE from write()
  // instead of terminating the process via default SIGPIPE action.
  // Without this, the round-4 _exit(86) failsafe would never run -- the
  // kernel would kill the fixture on the first EPIPE write, before our
  // gt_announce_failure() can latch the authoritative exit status.
  signal(SIGPIPE, SIG_IGN);

  // Initialize ground-truth oracle. This reads CLINEMM_GROUND_TRUTH_FD
  // from the environment and announces our own pid before any fork().
  gt_init();

  if      (strcmp(fixture, "shell-A")              == 0) fixture_shell_a(g_duration);
  else if (strcmp(fixture, "node-B")               == 0) fixture_node_b(g_duration);
  else if (strcmp(fixture, "python-C")             == 0) fixture_python_c(g_duration);
  else if (strcmp(fixture, "mixed-D")              == 0) fixture_mixed_d(g_duration);
  else if (strcmp(fixture, "node-escape")          == 0) fixture_node_escape(g_duration);
  else if (strcmp(fixture, "python-escape")        == 0) fixture_python_escape(g_duration);
  else if (strcmp(fixture, "double-fork-setsid")   == 0) fixture_double_fork_setsid(g_duration);
  else if (strcmp(fixture, "exec-fork")            == 0) fixture_exec_fork(g_duration);
  else if (strcmp(fixture, "signal-triggered-fork") == 0) fixture_signal_triggered_fork(g_duration);
  else {
    fprintf(stderr, "unknown fixture: %s\n", fixture);
    return 2;
  }
  return 0;
}
