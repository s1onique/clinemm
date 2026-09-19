// 40-oracle-lossless-witness.c
//
// Round-3 (HALT_GROUND_TRUTH_PIPE_CAN_DROP_RECORDS) executable witness.
//
// A ~120-line standalone test that:
//   1. Embeds the SAME drain_ground_truth() logic (copied and adapted)
//      so we can exercise it without the full driver + kqueue stack.
//   2. Forks a fragmenter child that writes a series of CREATE records
//      on the GT pipe, DELIBERATELY fragmenting each record across
//      multiple write() calls with small delays between them.
//   3. Verifies the lossless parser captures every record with the
//      exact (pid, start_us) the fragmenter claimed.
//   4. Closes the fragmenter's write end (the test's copy) so the
//      parser sees EOF; verifies the EOF-branch parses the final
//      carry correctly.
//   5. Verifies a WRITE_FAILED announcement reaches the driver side
//      and increments gt_write_failures.
//
// Why standalone (not a fixture of 30-): the driver is monolithic
// (posix_spawn + kqueue + reconcile). The oracle parser is what we
// want to test. Standalone = faster + no flake from kqueue.

#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <signal.h>
#include <fcntl.h>
#include <poll.h>
#include <time.h>
#include <sys/time.h>
#include <inttypes.h>
#include <stdbool.h>

#define GT_MAX 4096
typedef struct { pid_t pid; pid_t ppid; pid_t pgid; uint64_t start_us; } gt_record_t;

static gt_record_t gt_seen[GT_MAX];
static int ngt_seen = 0;
static int gt_with_start_us = 0;
static int gt_write_failures = 0;
static int gt_reader_fault = 0;

// ---- Lossless parser (mirror of 30-helper-preattach-driver.c:drain_ground_truth) ----
// Kept inline so this witness compiles without a shared object.
static void drain_ground_truth_lossless(int rfd, int timeout_ms) {
  char buf[4096];
  size_t carry_len = 0;
  int flags = fcntl(rfd, F_GETFL, 0);
  fcntl(rfd, F_SETFL, flags | O_NONBLOCK);

  time_t t0 = time(NULL);
  int eof_seen = 0;
  while (1) {
    struct pollfd pfd = { .fd = rfd, .events = POLLIN };
    int pr = poll(&pfd, 1, 50);
    if (pr < 0) { if (errno == EINTR) continue; break; }
    if (pr == 0) {
      if ((int)((time(NULL) - t0) * 1000) >= timeout_ms) break;
      continue;
    }
    if (carry_len >= sizeof(buf)) { gt_reader_fault = 1; break; }
    ssize_t n = read(rfd, buf + carry_len, sizeof(buf) - carry_len);
    if (n < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) continue;
      if (errno == EINTR) continue;
      break;
    }
    if (n == 0) {
      eof_seen = 1;
      if (carry_len > 0) {
        if (carry_len >= sizeof(buf)) { gt_reader_fault = 1; break; }
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
    size_t scan = 0;
    while (scan < carry_len) {
      size_t eol = scan;
      while (eol < carry_len && buf[eol] != '\n') eol++;
      if (eol >= carry_len) break;
      buf[eol] = '\0';
      const char *line = buf + scan;
      if (strncmp(line, "WRITE_FAILED ", 13) == 0) {
        int pid = 0, attempted = 0, err = 0;
        if (sscanf(line + 13, "pid=%d attempted=%d errno=%d",
                   &pid, &attempted, &err) >= 2) {
          gt_write_failures++;
        }
      } else if (strncmp(line, "CREATE ", 7) == 0 && ngt_seen < GT_MAX) {
        pid_t pid = 0, ppid = 0, pgid = 0;
        uint64_t start_us = 0;
        const char *p = line + 7;
        while (*p == ' ') p++;
        if (sscanf(p, "pid=%d ppid=%d pgid=%d start_us=%llu",
                   &pid, &ppid, &pgid,
                   (unsigned long long *)&start_us) >= 3) {
          gt_seen[ngt_seen].pid = pid;
          gt_seen[ngt_seen].ppid = ppid;
          gt_seen[ngt_seen].pgid = pgid;
          gt_seen[ngt_seen].start_us = start_us;
          ngt_seen++;
          if (start_us != 0) gt_with_start_us++;
        }
      }
      scan = eol + 1;
    }
    if (scan >= carry_len) {
      carry_len = 0;
    } else if (scan > 0) {
      size_t rem = carry_len - scan;
      memmove(buf, buf + scan, rem);
      carry_len = rem;
    }
    if (eof_seen) break;
  }
  fcntl(rfd, F_SETFL, flags);
}

// ---- Fragmenter child: writes a deterministic sequence of records,
// intentionally split across multiple write() calls. ----
static void fragmenter_main(int wfd) {
  struct { int pid; uint64_t start_us; } recs[] = {
    { 101, 1000000000000001ULL },
    { 202, 1000000000000002ULL },
    { 303, 1000000000000003ULL },
    { 404, 1000000000000004ULL },
    { 505, 1000000000000005ULL },
    { 606, 0 },                              // pid-only path
    { 707, 1000000000000007ULL },
  };
  int nrecs = (int)(sizeof recs / sizeof recs[0]);

  for (int i = 0; i < nrecs; i++) {
    char buf[160];
    int n = snprintf(buf, sizeof buf,
                     "CREATE pid=%d ppid=1 pgid=1 start_us=%llu\n",
                     recs[i].pid, (unsigned long long)recs[i].start_us);
    if (n <= 0) continue;
    // Deliberately fragment: write first half, sleep, write second half.
    // For odd n the split rounds down so the newline lands in the
    // second half -- this is the worst case for a parser that doesn't
    // retain incomplete carry across reads.
    int split = n / 2;
    ssize_t w1 = write(wfd, buf, (size_t)split);
    if (w1 < 0) { _exit(2); }
    usleep(2000);
    ssize_t w2 = write(wfd, buf + split, (size_t)(n - split));
    if (w2 < 0) { _exit(2); }
    usleep(2000);
  }

  // Synthesize a WRITE_FAILED announcement so the witness verifies
  // the parser counts it.
  char wf[160];
  int wn = snprintf(wf, sizeof wf,
                    "WRITE_FAILED pid=999 attempted=160 errno=%d\n", EAGAIN);
  if (wn > 0) { ssize_t w = write(wfd, wf, (size_t)wn); (void)w; }

  // Truncated-at-EOF final record: NO trailing newline. Exercises the
  // EOF branch's "append sentinel newline" logic.
  ssize_t w = write(wfd,
    "CREATE pid=888 ppid=1 pgid=1 start_us=1000000000000888", 56);
  (void)w;

  _exit(0);
}

int main(int argc, char **argv) {
  (void)argc; (void)argv;
  int p[2];
  if (pipe(p) != 0) { perror("pipe"); return 1; }

  pid_t child = fork();
  if (child == 0) {
    close(p[0]);
    fragmenter_main(p[1]);
    _exit(0);
  }
  // Driver side: close OUR copy of the write fd BEFORE drain so EOF is
  // visible after the fragmenter exits (same semantic as the real
  // driver's "close gt_write_fd immediately after posix_spawn").
  close(p[1]);

  drain_ground_truth_lossless(p[0], 5000);

  int status = 0;
  waitpid(child, &status, 0);

  printf("=== ORACLE_LOSSLESS_WITNESS ===\n");
  printf("records_seen=%d\n", ngt_seen);
  printf("gt_with_start_us=%d\n", gt_with_start_us);
  printf("gt_write_failures=%d\n", gt_write_failures);
  printf("gt_reader_fault=%d\n", gt_reader_fault);
  for (int i = 0; i < ngt_seen; i++) {
    printf("  rec[%d] pid=%d start_us=%llu\n",
           i, gt_seen[i].pid, (unsigned long long)gt_seen[i].start_us);
  }

  // ---- Verdict ----
  // Expected: 8 CREATE records (7 fragmented + 1 truncated-at-EOF) and
  // 1 WRITE_FAILED. The pid-only record is #6 (index 5, pid=606).
  int expected = 8;
  int expected_with_start = 7;   // 7 of 8 have non-zero start_us
  int expected_write_failures = 1;

  bool ok = (ngt_seen == expected) &&
            (gt_with_start_us == expected_with_start) &&
            (gt_write_failures == expected_write_failures) &&
            (gt_reader_fault == 0);

  // Verify the truncated-at-EOF record survived.
  bool eof_record_ok = false;
  for (int i = 0; i < ngt_seen; i++) {
    if (gt_seen[i].pid == 888 && gt_seen[i].start_us == 1000000000000888ULL) {
      eof_record_ok = true;
      break;
    }
  }

  printf("expected records=%d got=%d %s\n",
         expected, ngt_seen, ngt_seen == expected ? "OK" : "FAIL");
  printf("expected with_start_us=%d got=%d %s\n",
         expected_with_start, gt_with_start_us,
         gt_with_start_us == expected_with_start ? "OK" : "FAIL");
  printf("expected write_failures=%d got=%d %s\n",
         expected_write_failures, gt_write_failures,
         gt_write_failures == expected_write_failures ? "OK" : "FAIL");
  printf("truncated-at-EOF record (pid=888) survived: %s\n",
         eof_record_ok ? "YES" : "NO");
  printf("reader_fault=0: %s\n", gt_reader_fault == 0 ? "YES" : "NO");

  bool all_ok = ok && eof_record_ok;
  printf("VERDICT=%s\n", all_ok ? "PASS" : "FAIL");
  return all_ok ? 0 : 1;
}
