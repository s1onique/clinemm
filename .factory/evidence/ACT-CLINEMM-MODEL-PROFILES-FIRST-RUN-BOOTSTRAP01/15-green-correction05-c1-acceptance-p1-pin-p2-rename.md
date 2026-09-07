# 15-green-correction05-c1-acceptance-p1-pin-p2-rename

## What this evidence file proves

This file documents the bounded actions taken in response to the C1
reviewer verdict on CORRECTION05 (PASS_WITH_ONE_BOUNDED_P1, GO BACK
TO LIVE DOGFOOD). Three things happened, none of which change the
load-bearing empty-canonicalize behavior:

1. P1 PARTIALLY_MALFORMED_HEADERS_POLICY was frozen as current
   observed asymmetry (not endorsed). Freeze #6 added to the
   file-level header of
   `apps/vscode/src/sdk/profile-store/bootstrap.ts`.

2. Two new pinning witnesses added to the CORRECTION05 test file.
   They are GREEN now (current asymmetric behavior is preserved) and
   are designed to go RED -> GREEN when CORRECTION06 eventually lands
   post-dogfood.

3. P2 RUNTIME_PARITY evidence label was tightened. Test ID renamed
   from `MPFRB01_C05_RUNTIME_PARITY` to
   `MPFRB01_C05_BOOTSTRAP_PERSISTED_SHAPE_PARITY`. File header now
   labels the persisted-shape proof as EXECUTED and the outbound-HTTP
   equivalence as STRUCTURALLY_CORROBORATED (upstream evidence).

## Bun test results (after all three changes)

```
$ cd apps/vscode && TMPDIR=/tmp bun test \
    src/sdk/__tests__/bootstrap-empty-headers-as-absent.mpfrb01-correction05.test.ts

✓ MPFRB01_C05_H1_UNDEFINED
✓ MPFRB01_C05_H2_EMPTY_PLAIN_OBJECT
✓ MPFRB01_C05_H3_EMPTY_JSON_STRING
✓ MPFRB01_C05_H4_NONEMPTY_OBJECT
✓ MPFRB01_C05_H5_NONEMPTY_JSON_STRING
✓ MPFRB01_C05_H6_INVALID_JSON
✓ MPFRB01_C05_H7_NONEMPTY_OBJECT_NO_STRING_ENTRIES
✓ MPFRB01_C05_LEGACY_MIGRATION
✓ MPFRB01_C05_BOOTSTRAP_PERSISTED_SHAPE_PARITY        (renamed)
✓ MPFRB01_C05_P1_PARTIALLY_MALFORMED_ASYMMETRY_PLAIN_OBJECT   (new)
✓ MPFRB01_C05_P1_PARTIALLY_MALFORMED_ASYMMETRY_JSON_STRING    (new)

11 pass / 0 fail
Ran 11 tests across 1 file. [1.55s]
```

## Full bootstrap-suite regression

```
$ cd apps/vscode && TMPDIR=/tmp bun test \
    src/sdk/__tests__/bootstrap-*.mpfrb01.test.ts \
    src/sdk/__tests__/bootstrap-empty-headers-as-absent.mpfrb01-correction05.test.ts

25 pass / 0 fail
Ran 25 tests across 5 files. [1303.00ms]
```

## Foundation conservation

```
$ cd apps/vscode && bun run test:unit
Files: 79   Pass: 1118   Fail: 0   Time: 48.8s
All unit test files passed.
```

Was 1116 -> 1118 (+2 from the new P1 pinning witnesses).

## Typecheck

```
$ cd apps/vscode && bun x tsc --noEmit; echo exit=$?
exit=0
```

## Files changed in this evidence-window

Modified:
- `apps/vscode/src/sdk/profile-store/bootstrap.ts`
  + freeze #6 PARTIALLY_MALFORMED_HEADERS_POLICY_OBSERVED_ASYMMETRY
- `apps/vscode/src/sdk/__tests__/bootstrap-empty-headers-as-absent.mpfrb01-correction05.test.ts`
  + 2 new pinning witnesses (P1)
  + test ID rename RUNTIME_PARITY -> BOOTSTRAP_PERSISTED_SHAPE_PARITY
  + file header EVIDENCE-PRECISION NOTES section
- `.factory/acts/ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01.md`
  + CORRECTION05 REVIEWER C1 ACCEPTANCE section
  + 2 new lessons (#25, #26)
- `.factory/epic-board.md`
  + C1 acceptance entry on the next-state-of-the-run line

No production code logic changed.

## P-class verdict (final, post C1 acceptance)

P0:
  HALT_BOOTSTRAP_EMPTY_HEADERS_REJECTED                = CLOSED
  HALT_BOOTSTRAP_EMPTY_HEADERS_REPRESENTATION_REJECTED = CLOSED

P1:
  PARTIALLY_MALFORMED_HEADERS_POLICY                   = OPEN, NON-BLOCKING
    freeze #6 added; pinning witnesses added; deferred to
    post-dogfood (likely CORRECTION06).

P2:
  BLANK_AT_EOF_DIAGNOSTICS                             = OPEN, NON-BLOCKING
  RUNTIME_PARITY evidence label                         = CORRECTED

CORRECTION05 = PASS (C1: GO TO LIVE DOGFOOD).
