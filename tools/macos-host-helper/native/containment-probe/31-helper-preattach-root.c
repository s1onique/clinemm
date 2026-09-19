// 31-helper-preattach-root.c
//
// User-command-equivalent fixture root for
// ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01.
//
// Single binary, six sub-fixtures selected by --fixture=<name>:
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
//
// CRITICAL: NO cooperative delay permitted in this binary. Each
// fixture must perform its escape (setsid / detached:true /
// start_new_session) as the very first user-space action after
// SIGCONT resume. The driver's preattach is the ONLY barrier.
//
// Usage:
//   31-helper-preattach-root --fixture=<name> [duration-seconds]

#include <sys/types.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <errno.h>
#include <spawn.h>
#include <sys/wait.h>

extern char **environ;

static int g_duration = 30;

static void emit(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  vfprintf(stderr, fmt, ap); va_end(ap);
  fflush(stderr);
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
  return pid;
}

// Warmup: bash tree (inherited PGID).
static void fixture_shell_a(int dur) {
  emit("[fixture-shell-A] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char buf[32]; snprintf(buf, sizeof buf, "%d", dur);
  pid_t c = fork();
  if (c == 0) {
    char *argv[] = { "sh", "-c",
      "(sleep 300 & echo [fixture-shell-A] child pid=$! pgid=$(ps -o pgid= -p $! | tr -d ' ') >&2; "
      "(sleep 300 & echo [fixture-shell-A] grandchild pid=$! >&2; wait)) & wait",
      NULL };
    (void)argv;
    execl("/bin/sh", "sh", "-c",
      "(sleep 300 & echo [fixture-shell-A] child pid=$! pgid=$(ps -o pgid= -p $! | tr -d ' ') >&2; "
      "(sleep 300 & echo [fixture-shell-A] grandchild pid=$! >&2; wait)) & wait",
      NULL);
    _exit(127);
  }
  (void)buf;
  waitpid(c, NULL, 0);
}

// Warmup: node sleep child (inherited PGID).
static void fixture_node_b(int dur) {
  emit("[fixture-node-B] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  pid_t c = spawn_inherit("/bin/sh", (char *const[]){
    "sh", "-c",
    "exec /opt/homebrew/bin/node -e \"require('child_process').spawn('sleep', process.argv[1], { stdio: 'ignore' }).on('exit', () => {}); setInterval(()=>{}, 1<<30);\"",
    d, NULL });
  if (c > 0) waitpid(c, NULL, 0);
}

// Warmup: python sleep child (inherited PGID).
static void fixture_python_c(int dur) {
  emit("[fixture-python-C] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  pid_t c = spawn_inherit("/bin/sh", (char *const[]){
    "sh", "-c",
    "exec /usr/bin/python3 -c \"import subprocess; p = subprocess.Popen(['sleep', '$0']); p.wait()\"",
    d, NULL });
  if (c > 0) waitpid(c, NULL, 0);
}

// Warmup: bash -> python -> sleep (mixed, inherited PGID).
static void fixture_mixed_d(int dur) {
  emit("[fixture-mixed-D] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  pid_t c = spawn_inherit("/bin/sh", (char *const[]){
    "sh", "-c",
    "exec /usr/bin/python3 -c \"import subprocess; p = subprocess.Popen(['sleep', '$0']); p.wait()\"",
    d, NULL });
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
    "exec /opt/homebrew/bin/node -e \"const c = require('child_process').spawn('sleep', process.argv[1], { detached: true, stdio: 'ignore' }); c.unref(); console.error('[node-escape-inner] detached sleep pid=' + c.pid + ' pgid=' + c.pid); setInterval(() => {}, 1 << 30);\"",
    d, NULL });
  if (c > 0) waitpid(c, NULL, 0);
}

// ESCAPE F: python start_new_session=True (setsid equivalent).
static void fixture_python_escape(int dur) {
  emit("[fixture-python-escape-F] parent pid=%d pgid=%d ppid=%d\n",
       getpid(), getpgid(0), getppid());
  char d[32]; snprintf(d, sizeof d, "%d", dur);
  // Spawn a python child that immediately performs start_new_session=True.
  pid_t c = spawn_inherit("/bin/sh", (char *const[]){
    "sh", "-c",
    "exec /usr/bin/python3 -c \"import subprocess; c = subprocess.Popen(['sleep', '$0'], start_new_session=True); print('[python-escape-inner] detached sleep pid=' + str(c.pid), file=__import__('sys').stderr); c.wait()\"",
    d, NULL });
  if (c > 0) waitpid(c, NULL, 0);
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
      "  names: shell-A node-B python-C mixed-D node-escape python-escape\n",
      argv[0]);
    return 2;
  }

  if      (strcmp(fixture, "shell-A")       == 0) fixture_shell_a(g_duration);
  else if (strcmp(fixture, "node-B")        == 0) fixture_node_b(g_duration);
  else if (strcmp(fixture, "python-C")      == 0) fixture_python_c(g_duration);
  else if (strcmp(fixture, "mixed-D")       == 0) fixture_mixed_d(g_duration);
  else if (strcmp(fixture, "node-escape")   == 0) fixture_node_escape(g_duration);
  else if (strcmp(fixture, "python-escape") == 0) fixture_python_escape(g_duration);
  else {
    fprintf(stderr, "unknown fixture: %s\n", fixture);
    return 2;
  }
  return 0;
}
