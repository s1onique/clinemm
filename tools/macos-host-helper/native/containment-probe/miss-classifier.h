// miss-classifier.h
//
// Shared miss-classifier for the production driver (30-) and the
// round-7 executable witness (44-oracle-miss-classifier-witness).
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
// The classifier is intentionally pure: it reads from caller-owned
// arrays and never mutates them. This lets a witness inject a
// synthetic (GROUND_TRUTH_CREATED, KQUEUE_TRACKED) pair and assert
// the exact missed-set without touching kqueue, posix_spawn, or any
// cross-process machinery.

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

#endif // MISS_CLASSIFIER_H