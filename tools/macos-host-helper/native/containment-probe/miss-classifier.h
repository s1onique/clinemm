// miss-classifier.h
//
// Shared miss-classifier + driver-disposition for the production
// driver (30-) and the executable witnesses (44- and 45-).
//
// The driver computes:
//
//     MISSED = GROUND_TRUTH_CREATED - KQUEUE_TRACKED
//
// where KQUEUE_TRACKED has two layers of evidence:
//
//   pid_start[]  : (pid, start_us) bindings for strong identity
//   tracked[]    : pid-only set for weak identity fallback
//
// The classifier rules (preserved verbatim from
// 30-helper-preattach-driver.c:tracked_has + compute_missed):
//
//   if r->start_us != 0:
//     require EXACT (pid, start_us) match in pid_start[]
//     // start_us known but no exact match => MISS (fail closed)
//   else:
//     // start_us unknown => pid-only fallback in tracked[]
//     return tracked[].contains(r->pid)
//
// Both classifier and disposition are intentionally pure: they read
// only from caller-owned arrays / values and never mutate them. This
// lets a witness inject a synthetic (GROUND_TRUTH_CREATED,
// KQUEUE_TRACKED) pair + oracle counters and assert the exact
// missed-set AND the resulting driver exit code without touching
// kqueue, posix_spawn, or any cross-process machinery.

#ifndef MISS_CLASSIFIER_H
#define MISS_CLASSIFIER_H

#include <sys/types.h>
#include <stdint.h>

typedef struct {
  pid_t pid;
  pid_t ppid;
  pid_t pgid;
  uint64_t start_us;  // 0 if the writer could not read kinfo_proc
} gt_record_t;

typedef struct {
  pid_t pid;
  uint64_t start_us;
} pid_start_t;

#define MISS_MAX_GT       4096
#define MISS_MAX_PID_START 4096

// Driver exit codes (round-4 semantics, preserved verbatim from
// 30-helper-preattach-driver.c:return ... in main()).
//
//   0 = PASS  (no missed GT, no write failures, no evidence fail)
//   5 = MISS  (missed_ground_truth_count > 0)
//   6 = ORACLE_WRITE_FAIL   (ground_truth_write_failures > 0)
//   7 = ORACLE_READER_FAULT (ground_truth_reader_fault > 0)
//   8 = ORACLE_EVIDENCE_FAIL (ground_truth_oracle_evidence_fail > 0)
//       root exited 86 -- kernel-mediated oracle write-side failure
//
// Precedence: evidence_fail > reader_fault > write_failures > miss.
// This matches the production driver exactly.
#define ORACLE_EXIT_PASS              0
#define ORACLE_EXIT_MISS              5
#define ORACLE_EXIT_WRITE_FAIL        6
#define ORACLE_EXIT_READER_FAULT      7
#define ORACLE_EXIT_EVIDENCE_FAIL     8

// Direct, allocation-free classifier. Caller owns all arrays.
// Returns the number of GT records not matched by KQUEUE_TRACKED.
// If `missed_out` is non-NULL, fills up to `max_missed` of them.
//
// Faithful port of 30-helper-preattach-driver.c:tracked_has +
// compute_missed. Two evidence layers:
//   * strong: exact (pid, start_us) match against pid_start[] when
//             r->start_us != 0 (start_us is a stable cross-rename
//             identity; pid alone is not)
//   * weak:   pid-only fallback against tracked[] when r->start_us==0
//             (the writer could not enrich from kinfo_proc)
static inline int miss_classify(
    const gt_record_t *gt_created, int ngt,
    const pid_start_t *pid_start, int npid_start,
    const pid_t       *tracked,   int ntracked,
    gt_record_t *missed_out, int max_missed)
{
  int n = 0;
  for (int i = 0; i < ngt; i++) {
    const gt_record_t *r = &gt_created[i];
    int matched = 0;
    if (r->start_us != 0) {
      // Strong path: exact (pid, start_us) match.
      for (int j = 0; j < npid_start; j++) {
        if (pid_start[j].pid != 0 &&
            pid_start[j].pid == r->pid &&
            pid_start[j].start_us == r->start_us) {
          matched = 1; break;
        }
      }
      // start_us known but no exact match => MISS (fail closed).
    } else {
      // Weak path: pid-only fallback.
      for (int j = 0; j < ntracked; j++) {
        if (tracked[j] == r->pid) { matched = 1; break; }
      }
    }
    if (!matched) {
      if (missed_out && n < max_missed) missed_out[n] = *r;
      n++;
    }
  }
  return n;
}

// Driver disposition: maps the oracle counters to a single exit code.
// Faithful port of 30-helper-preattach-driver.c:main() tail:
//   if (gt_oracle_evidence_fail) return 8;
//   if (gt_reader_fault)         return 7;
//   if (gt_write_failures > 0)   return 6;
//   return missed_count > 0 ? 5 : 0;
//
// Any single oracle fault => REFUTE. Only exit 0 is PASS.
// Input convention: counters are >=0 ints. Non-zero means the fault
// was observed at least once.
static inline int oracle_disposition(
    int missed_count,
    int write_failures,
    int reader_fault,
    int evidence_fail)
{
  if (evidence_fail)            return ORACLE_EXIT_EVIDENCE_FAIL;
  if (reader_fault)             return ORACLE_EXIT_READER_FAULT;
  if (write_failures > 0)       return ORACLE_EXIT_WRITE_FAIL;
  if (missed_count > 0)         return ORACLE_EXIT_MISS;
  return ORACLE_EXIT_PASS;
}

#endif // MISS_CLASSIFIER_H