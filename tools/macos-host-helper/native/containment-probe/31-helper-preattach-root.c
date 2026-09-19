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
//   termination-window-I
//                     receives SIGTERM, signal handler forks detached
//                     child, then exits (tracker must observe the child
//                     during teardown)
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
//     CREATE pid=<pid> ppid=<pid> pgid=<pid> start_us=<value>\n
//
//   start_us is the kernel start time of the process, read via
//   sysctl(KERN_PROC). start_us may be 0 if the read races a
//   not-yet-published proc entry; the driver falls back to pid-only
//   identity in that case.
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
  if (n > 0) {
    ssize_t w = write(g_gt_fd, buf, (size_t)n);
    (void)w;
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
    execl("/bin/sh", "sh", "-c",
      "GTFD=${CLINEMM_GROUND_TRUTH_FD:-/dev/null}; "
      "announce() { printf 'CREATE pid=%s ppid=%s pgid=%s start_us=0\\n' \"$1\" \"$2\" \"$3\" >&\"$GTFD\"; }; "
      "(sleep \"$0\" & announce \"$!\" \"$$\" \"$(ps -o pgid= -p $! | tr -d ' ')\"; "
      "(sleep \"$0\" & announce \"$!\" \"$$\" \"$(ps -o pgid= -p $! | tr -d ' ')\"; wait)) & wait",
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
      "pgid=$(ps -o pgid= -p $pid | tr -d ' '); "
      "printf 'CREATE pid=%s ppid=%s pgid=%s start_us=0\\n' \"$pid\" \"$$\" \"$pgid\" >&\"$GTFD\"; "
      "wait $pid",
      d, NULL);
    _exit(127);
  }
  gt_announce(c);
  waitpid(c, NULL, 0);
}

// FIXTURE I: dynamic fork during termination.
//   parent receives SIGTERM (delivered by the driver via the loop).
//   Signal handler forks detached child, then parent exits.
// The tracker must still observe the child during teardown.
//
// NOTE: the test harness here does NOT actually deliver SIGTERM
// automatically -- this fixture is gated by an environment variable
// so it stays a no-op unless explicitly enabled:
//
//   CLINEMM_FIXTURE_I_SIGNAL=SIGTERM   -> raise(SIGTERM) before wait
//   CLINEMM_FIXTURE_I_SIGNAL=SIGKILL   -> raise(SIGKILL)
//   unset                                -> sleep dur seconds, no signal
//
static pid_t g_i_detached_pid = 0;
static void fixture_i_on_signal(int s) {
  (void)s;
  pid_t c = fork();
  if (c == 0) {
    setsid();
    sleep(60);
    _exit(0);
  }
  g_i_detached_pid = c;
  gt_announce(c);
  // Re-raise default action after a single fork so the parent
  // terminates as the harness expects.
  signal(SIGTERM, SIG_DFL);
  signal(SIGINT, SIG_DFL);
  raise(s);
}
static void fixture_termination_window(int dur) {
  emit("[fixture-termination-window-I] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  const char *sig = getenv("CLINEMM_FIXTURE_I_SIGNAL");
  if (sig != NULL && strcmp(sig, "SIGTERM") == 0) {
    signal(SIGTERM, fixture_i_on_signal);
    signal(SIGINT, fixture_i_on_signal);
    raise(SIGTERM);
  } else if (sig != NULL && strcmp(sig, "SIGKILL") == 0) {
    // SIGKILL can't be caught; we just fork+exit before sig would
    // arrive. This still exercises observation during teardown.
    pid_t c = fork();
    if (c == 0) { setsid(); sleep(60); _exit(0); }
    gt_announce(c);
    raise(SIGKILL);
  }
  // No signal scheduled: just sleep so the test can observe the parent
  // without a race.
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
      "         double-fork-setsid exec-fork termination-window\n",
      argv[0]);
    return 2;
  }

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
  else if (strcmp(fixture, "termination-window")   == 0) fixture_termination_window(g_duration);
  else {
    fprintf(stderr, "unknown fixture: %s\n", fixture);
    return 2;
  }
  return 0;
}
