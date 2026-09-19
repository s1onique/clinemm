// 45-oracle-disposition-witness.c
//
// Round-8 (HALT_DISPOSITION_WITNESS_CONTRADICTS_CLAIM) executable
// witness. Closes the reviewer-flagged P0 in round-7's 44-witness:
// 44-witness's T5 was passing the test but the printed
// "driver_disposition_for_run_above: exit=0 (PASS)" directly
// contradicted the claimed "exit=5 (REFUTE / MISS)". The bug: the
// witness conflated the test-failure count with the missed_count.
//
// Bounded correction: extract the production disposition function
// into miss-classifier.h (just like miss_classify()). Both the
// production driver (30-) and the witnesses (44-, 45-) compile
// against the SAME oracle_disposition() function. No algorithm fork.
//
// This witness (45-) is the composition test the reviewer asked for:
// it exercises BOTH miss_classify() AND oracle_disposition() on the
// exact T5 scenario (root->child->grandchild, kqueue deliberately
// omits grandchild) and asserts:
//
//   miss_classify(...)    -> missed_count = 1
//   oracle_disposition(...) -> exit 5
//
// plus four cheap precedence checks pinning every branch the
// reviewer listed:
//
//   0 failures  -> 0
//   miss        -> 5
//   write fail  -> 6
//   reader fault-> 7
//   evidence    -> 8

#include <sys/types.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "miss-classifier.h"

static int g_failures = 0;

static void check_disposition(const char *name,
                              int mc, int wf, int rf, int ef,
                              int expected)
{
  int got = oracle_disposition(mc, wf, rf, ef);
  int ok = (got == expected);
  printf("  [%s] %s expected=%d got=%d\n",
         ok ? "PASS" : "FAIL",
         name, expected, got);
  if (!ok) g_failures++;
}

int main(void) {
  printf("=== ORACLE_DISPOSITION_WITNESS (round-8) ===\n");

  // ------------------------------------------------------------------
  // Composition: classifier -> disposition on the T5 scenario.
  // ------------------------------------------------------------------
  // The reviewer asked for exactly this: feed a root->child->grandchild
  // tree into the production classifier with kqueue deliberately
  // omitting the grandchild, then assert the disposition is exit 5.
  printf("\n  composition: classifier -> disposition (T5 scenario)\n");
  gt_record_t gt[] = {
    { .pid = 100, .ppid = 99, .pgid = 99, .start_us = 1000 },
    { .pid = 101, .ppid = 100, .pgid = 100, .start_us = 1100 },
    { .pid = 102, .ppid = 101, .pgid = 100, .start_us = 1200 },  // grandchild
  };
  pid_start_t ps[] = {
    { .pid = 100, .start_us = 1000 },
    { .pid = 101, .start_us = 1100 },
    // grandchild pid=102 deliberately NOT in pid_start
  };
  pid_t tr[] = { 100, 101 };  // grandchild deliberately NOT in tracked

  gt_record_t missed[8];
  int missed_count = miss_classify(gt, 3, ps, 2, tr, 2, missed, 8);

  int disp = oracle_disposition(missed_count, 0, 0, 0);

  int ok_mc   = (missed_count == 1);
  int ok_id   = ok_mc && (missed[0].pid == 102) && (missed[0].start_us == 1200);
  int ok_disp = (disp == ORACLE_EXIT_MISS);

  printf("    miss_classify(...)       -> missed_count=%d %s\n",
         missed_count, ok_mc ? "PASS" : "FAIL");
  printf("    missed[0]=(pid=%d,start_us=%llu) %s\n",
         ok_mc ? missed[0].pid : -1,
         ok_mc ? (unsigned long long)missed[0].start_us : 0,
         ok_id ? "PASS" : "FAIL");
  printf("    oracle_disposition(...)  -> exit=%d %s (expected=%d / EXIT_MISS)\n",
         disp, ok_disp ? "PASS" : "FAIL", ORACLE_EXIT_MISS);

  if (!ok_mc || !ok_id || !ok_disp) g_failures++;

  // ------------------------------------------------------------------
  // Precedence / branch pin: every exit code the driver can return.
  // ------------------------------------------------------------------
  printf("\n  precedence / branch pin (5 cases, production oracle_disposition):\n");
  check_disposition("all zeros    -> 0 (PASS)",
                    0, 0, 0, 0, ORACLE_EXIT_PASS);
  check_disposition("missed=1     -> 5 (REFUTE / MISS)",
                    1, 0, 0, 0, ORACLE_EXIT_MISS);
  check_disposition("write_fail=1 -> 6 (WRITE_FAIL, beats MISS)",
                    1, 1, 0, 0, ORACLE_EXIT_WRITE_FAIL);
  check_disposition("reader_fault=1 -> 7 (READER_FAULT, beats MISS+WF)",
                    1, 1, 1, 0, ORACLE_EXIT_READER_FAULT);
  check_disposition("evidence_fail=1 -> 8 (EVIDENCE_FAIL, beats all)",
                    1, 1, 1, 1, ORACLE_EXIT_EVIDENCE_FAIL);

  printf("\n=== failures=%d VERDICT=%s ===\n",
         g_failures, g_failures == 0 ? "PASS" : "FAIL");

  return g_failures == 0 ? 0 : 1;
}
