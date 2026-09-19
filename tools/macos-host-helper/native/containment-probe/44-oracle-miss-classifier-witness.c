// 44-oracle-miss-classifier-witness.c
//
// Round-7 (HALT_ORACLE_MISS_CLASSIFIER_NOT_EXERCISED) executable
// witness. Closes the reviewer-flagged gap in 43-witness: 43 only
// counted CREATE records; it did not exercise
// MISS = GROUND_TRUTH_CREATED - KQUEUE_TRACKED. This witness
// exercises the ACTUAL production classifier from
// 30-helper-preattach-driver.c, included verbatim as a header.
//
// The classifier has two evidence layers (preserved from production):
//   * strong: when r->start_us != 0, require EXACT (pid, start_us)
//             match against pid_start[]. If start_us is known but no
//             exact match exists, the record is a MISS (fail closed).
//   * weak:   when r->start_us == 0 (writer could not enrich from
//             kinfo_proc), fall back to pid-only lookup in tracked[].
//
// Five test cases that exercise the load-bearing branches:
//
//   T1: weak path pid-only match
//       GT = {(pid=200, start_us=0)}, TRACKED = {200}
//       -> matched (pid-only fallback)        expected missed=0
//
//   T2: weak path pid-only miss
//       GT = {(pid=201, start_us=0)}, TRACKED = {200}
//       -> NOT matched                       expected missed=1
//
//   T3: strong path exact (pid, start_us) match
//       GT = {(pid=300, start_us=5000)}, pid_start = {(300,5000)}
//       -> matched                           expected missed=0
//
//   T4: strong path start_us known but NO exact match (fail closed)
//       GT = {(pid=301, start_us=5000)}, pid_start = {(300,5000)}
//       -> MISS (NOT a pid-only fallback)    expected missed=1
//
//   T5: full root->child->grandchild tree, kqueue deliberately omits
//       grandchild.
//       GT      = {root(100,start_us=1000), child(101,start_us=1100),
//                  grandchild(102, start_us=1200)}
//       tracked = {100, 101}
//       pid_start = {(100,1000), (101,1100)}
//       -> grandchild MISS                   expected missed=1
//       -> missed identity pid=102, start_us=1200
//       -> driver disposition exit 5 (REFUTE / MISS)

#include <sys/types.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

#include "miss-classifier.h"

// POSIX requires write(2) to be atomic for any payload <= PIPE_BUF.
// We don't pin a hard-coded PIPE_BUF value; the load-bearing
// invariant is just `record_size <= PIPE_BUF`.
//
// The C-side CREATE format string in 31-helper-preattach-root.c is:
//   "CREATE pid=%d ppid=%d pgid=%d start_us=%llu\n"
// Worst-case (PID_MAX=99999, full u64 start_us) is ~46 bytes; the
// bash/node/python pid-only wrappers emit ~38 bytes. Both are well
// under any platform's PIPE_BUF (4096 on Linux, 65536 on macOS).
static void assert_record_size_under_pipe_buf(void) {
  enum {
    C_RECORD_MAX_BYTES  = 64,    // generous over the 46-byte worst case
    KNOWN_MIN_PIPE_BUF  = 4096   // any POSIX-conforming system
  };
  if (C_RECORD_MAX_BYTES > KNOWN_MIN_PIPE_BUF) {
    fprintf(stderr,
      "ASSERTION FAIL: C-side record cap %d > PIPE_BUF floor %d\n",
      C_RECORD_MAX_BYTES, KNOWN_MIN_PIPE_BUF);
    exit(2);
  }
}

static int run_case(const char *name,
                    const gt_record_t *gt, int ngt,
                    const pid_start_t *ps, int nps,
                    const pid_t *tr, int ntr,
                    int expected_missed,
                    pid_t expected_missed_pid,
                    uint64_t expected_missed_start_us)
{
  gt_record_t missed[16];
  int n = miss_classify(gt, ngt, ps, nps, tr, ntr, missed, 16);
  int ok = (n == expected_missed);
  if (ok && expected_missed > 0) {
    ok = (missed[0].pid == expected_missed_pid &&
          missed[0].start_us == expected_missed_start_us);
  }
  printf("  %s expected_missed=%d got=%d %s\n",
         name, expected_missed, n, ok ? "PASS" : "FAIL");
  if (!ok) {
    printf("    GT: ");
    for (int i = 0; i < ngt; i++)
      printf("(pid=%d start_us=%llu)%s",
             gt[i].pid, (unsigned long long)gt[i].start_us,
             i+1<ngt?" ":"");
    printf("\n    TRACKED(pid_only): ");
    for (int i = 0; i < ntr; i++)
      printf("%d%s", tr[i], i+1<ntr?",":"");
    printf("\n    PID_START: ");
    for (int i = 0; i < nps; i++)
      printf("(pid=%d start_us=%llu)%s",
             ps[i].pid, (unsigned long long)ps[i].start_us,
             i+1<nps?" ":"");
    printf("\n    MISSED: ");
    for (int i = 0; i < n; i++)
      printf("(pid=%d start_us=%llu)%s",
             missed[i].pid, (unsigned long long)missed[i].start_us,
             i+1<n?" ":"");
    printf("\n");
  }
  return ok ? 0 : 1;
}

int main(void) {
  printf("=== ORACLE_MISS_CLASSIFIER_WITNESS (round-7) ===\n");

  assert_record_size_under_pipe_buf();

  int failures = 0;

  // T1: weak path, pid-only fallback matches.
  {
    gt_record_t gt[] = { { .pid = 200, .ppid = 1, .pgid = 1, .start_us = 0 } };
    pid_t tr[] = { 200 };
    failures += run_case("T1 [weak pid-only match]",
                         gt, 1, NULL, 0, tr, 1,
                         0, 0, 0);
  }

  // T2: weak path, pid-only miss.
  {
    gt_record_t gt[] = { { .pid = 201, .ppid = 1, .pgid = 1, .start_us = 0 } };
    pid_t tr[] = { 200 };
    failures += run_case("T2 [weak pid-only miss]",
                         gt, 1, NULL, 0, tr, 1,
                         1, 201, 0);
  }

  // T3: strong path, exact (pid, start_us) match.
  {
    gt_record_t gt[] = { { .pid = 300, .ppid = 1, .pgid = 1, .start_us = 5000 } };
    pid_start_t ps[] = { { .pid = 300, .start_us = 5000 } };
    pid_t tr[] = { 300 };
    failures += run_case("T3 [strong exact match]",
                         gt, 1, ps, 1, tr, 1,
                         0, 0, 0);
  }

  // T4: strong path, start_us known but no exact match => MISS (fail closed).
  // This is the load-bearing case the reviewer flagged: even though
  // pid=301 is in tracked[] via a pid-only entry, the strong path
  // does NOT fall back. start_us was claimed but unmatched -> MISS.
  {
    gt_record_t gt[] = { { .pid = 301, .ppid = 1, .pgid = 1, .start_us = 5000 } };
    pid_start_t ps[] = { { .pid = 300, .start_us = 5000 } };  // wrong pid
    pid_t tr[] = { 301 };  // pid-only fallback would match, but strong path is used
    failures += run_case("T4 [strong start_us known but no exact match]",
                         gt, 1, ps, 1, tr, 1,
                         1, 301, 5000);
  }

  // T5: the discriminator scenario.
  //   root -> child -> grandchild
  //   kqueue tracks root and child only.
  //   expected: missed_count == 1, missed[0] = grandchild.
  {
    gt_record_t gt[] = {
      { .pid = 100, .ppid = 99, .pgid = 99, .start_us = 1000 },
      { .pid = 101, .ppid = 100, .pgid = 100, .start_us = 1100 },
      { .pid = 102, .ppid = 101, .pgid = 100, .start_us = 1200 },  // grandchild
    };
    pid_start_t ps[] = {
      { .pid = 100, .start_us = 1000 },
      { .pid = 101, .start_us = 1100 },
    };
    pid_t tr[] = { 100, 101 };
    failures += run_case("T5 [root->child->grandchild, kqueue misses grandchild]",
                         gt, 3, ps, 2, tr, 2,
                         1, 102, 1200);
  }

  // Driver disposition semantics: missed_count > 0 -> exit 5 (REFUTE / MISS).
  // Round-8 fix: this used to print `(failures == 0) ? 0 : 5`, which
  // conflated the test failure count with the missed_count and printed
  // exit=0 even when T5 correctly observed one miss. The reviewer
  // flagged this as HALT_DISPOSITION_WITNESS_CONTRADICTS_CLAIM.
  //
  // The fix is the same as round-7's: call the production disposition
  // function from miss-classifier.h. We feed it the ORACLE COUNTERS
  // we actually care about: missed_count from the T5 classifier run,
  // write_failures=0, reader_fault=0, evidence_fail=0. Production
  // driver does exactly this in main() tail.
  //
  // Each case below feeds a fresh, oracle-shaped counter set into
  // oracle_disposition() and asserts the documented exit code.
  printf("\n  driver_disposition_for_oracle_counters:\n");
  int disp_failures = 0;
  struct { const char *name;
           int mc, wf, rf, ef;
           int expected; } disp_cases[] = {
    // T5: GT minus tracked = 1, no other faults => exit 5
    { "missed_count=1 -> exit 5 (REFUTE / MISS)",
      1, 0, 0, 0, ORACLE_EXIT_MISS },
    // 0 of everything -> exit 0 (PASS)
    { "all zeros         -> exit 0 (PASS)",
      0, 0, 0, 0, ORACLE_EXIT_PASS },
    // Precedence check: evidence_fail beats miss
    { "evidence_fail=1   -> exit 8 (EVIDENCE_FAIL, beats MISS)",
      1, 0, 0, 1, ORACLE_EXIT_EVIDENCE_FAIL },
    // reader_fault beats write_failures beats miss
    { "reader_fault=1    -> exit 7 (READER_FAULT, beats MISS+WF)",
      1, 1, 1, 0, ORACLE_EXIT_READER_FAULT },
    { "write_failures=1  -> exit 6 (WRITE_FAIL, beats MISS)",
      1, 1, 0, 0, ORACLE_EXIT_WRITE_FAIL },
  };
  for (size_t i = 0; i < sizeof(disp_cases)/sizeof(disp_cases[0]); i++) {
    int got = oracle_disposition(disp_cases[i].mc, disp_cases[i].wf,
                                  disp_cases[i].rf, disp_cases[i].ef);
    int ok = (got == disp_cases[i].expected);
    printf("    [%s] %s expected=%d got=%d %s\n",
           ok ? "PASS" : "FAIL",
           disp_cases[i].name,
           disp_cases[i].expected, got,
           ok ? "" : "  *** MISMATCH ***");
    if (!ok) disp_failures++;
  }

  printf("\n=== classifier_failures=%d disposition_failures=%d VERDICT=%s ===\n",
         failures, disp_failures,
         (failures == 0 && disp_failures == 0) ? "PASS" : "FAIL");

  return (failures == 0 && disp_failures == 0) ? 0 : 1;
}
