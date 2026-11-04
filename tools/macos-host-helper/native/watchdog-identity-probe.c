// =============================================================================
// watchdog-identity-probe.c
//
// ACT-CLINEMM-HOST-HELPER-BOUNDED-REQUEST-LIFECYCLE01
//
// TEST FIXTURE (NOT production code). Two independent jobs:
//
// (1) IDENTITY: print the kernel-recorded start time of a PID, using the
//     SAME kernel seam the C helper uses for its PID-reuse resistance
//     (`sysctl(KERN_PROC_PID)` -> `kinfo_proc` ->
//     `p_un.__p_starttime`).
//
//     Why a C fixture instead of spawning /bin/ps from the test process:
//
//       The Background Exec Seatbelt profile blocks
//       `posix_spawn("/bin/ps")` (EPERM). A watchdog whose identity
//       check silently degrades to "unknown" would violate the ACT's
//       explicit requirement to "verify the helper's PID/start identity
//       before any escalation". This fixture keeps the identity check
//       load-bearing on every substrate.
//
// (2) RAW FRAME CLIENT: send one newline-terminated frame over AF_UNIX
//     and print the response.
//
//     Why a raw client: Node/Bun's `socket.end()` on macOS AF_UNIX does
//     not deliver a pending write followed by a FIN the way the POSIX
//     syscall sequence does. A half-close case therefore CANNOT be
//     observed through the Node socket API on this platform, and using
//     it would produce a FALSE NEGATIVE that looks like a framing
//     regression. The raw client performs the exact syscall sequence
//     (write(2) then optional shutdown(SHUT_WR)) the framing contract
//     is about.
//
// Usage:
//   watchdog-identity-probe <pid>
//       -> "<pid> <start_sec>.<start_usec>"   exit 0  (process exists)
//       -> "<pid> GONE"                        exit 3  (no such process)
//       -> "<pid> ERROR"                       exit 4  (sysctl failed)
//
//   watchdog-identity-probe --frame <socket_path> [--shutdown]
//       -> prints the response frame (or "<NO_RESPONSE>")
// =============================================================================

#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/sysctl.h>
#include <sys/types.h>
#include <stdint.h>

static int cmd_identity(pid_t pid) {
  struct kinfo_proc info;
  size_t len = sizeof(info);
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, (int)pid };
  if (sysctl(mib, 4, &info, &len, NULL, 0) < 0) {
    // ESRCH means "no such process"; anything else is a real error.
    if (errno == ESRCH) {
      printf("%d GONE\n", (int)pid);
      return 3;
    }
    printf("%d ERROR\n", (int)pid);
    return 4;
  }
  if (len == 0) {
    printf("%d GONE\n", (int)pid);
    return 3;
  }
  struct timeval tv = info.kp_proc.p_un.__p_starttime;
  printf("%d %llu.%06llu\n", (int)pid,
         (unsigned long long)tv.tv_sec,
         (unsigned long long)tv.tv_usec);
  return 0;
}

static int cmd_frame(const char *path, int do_shutdown, int partial) {
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) { perror("socket"); return 2; }
  struct sockaddr_un a;
  memset(&a, 0, sizeof(a));
  a.sun_family = AF_UNIX;
  strncpy(a.sun_path, path, sizeof(a.sun_path) - 1);
  if (connect(fd, (struct sockaddr *)&a, sizeof(a)) < 0) {
    perror("connect");
    close(fd);
    return 2;
  }
  const char *frame =
      "{\"version\":1,\"request_id\":\"raw-frame-client\",\"method\":\"health\"}\n";
  size_t flen = strlen(frame);
  if (partial) {
    // Send a PARTIAL frame with NO terminating newline, then half-close
    // so the peer observes EOF before the frame is complete.
    flen = strlen(frame) - 1;
  }
  size_t off = 0;
  while (off < flen) {
    ssize_t w = write(fd, frame + off, flen - off);
    if (w < 0) {
      if (errno == EINTR) continue;
      perror("write");
      close(fd);
      return 3;
    }
    off += (size_t)w;
  }
  if (do_shutdown) shutdown(fd, SHUT_WR);
  char buf[4096];
  ssize_t n = read(fd, buf, sizeof(buf) - 1);
  if (n > 0) {
    buf[n] = 0;
    printf("%s", buf);
    close(fd);
    return 0;
  }
  printf("<NO_RESPONSE>\n");
  close(fd);
  return 4;
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "--frame") == 0) {
    if (argc < 3) {
      fprintf(stderr, "usage: %s --frame <socket_path> [--shutdown] [--partial]\n", argv[0]);
      return 2;
    }
    int do_shutdown = 0;
    int partial = 0;
    for (int i = 3; i < argc; i++) {
      if (strcmp(argv[i], "--shutdown") == 0) do_shutdown = 1;
      if (strcmp(argv[i], "--partial") == 0) partial = 1;
    }
    return cmd_frame(argv[2], do_shutdown, partial);
  }
  if (argc != 2) {
    fprintf(stderr, "usage: %s <pid>\n", argv[0]);
    return 2;
  }
  pid_t pid = (pid_t)strtol(argv[1], NULL, 10);
  if (pid <= 0) {
    printf("%s ERROR\n", argv[1]);
    return 4;
  }
  return cmd_identity(pid);
}

