ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01 — RED Discriminator Design

## The defect

ACT-TERMINATION-AUTHORITY01 / CORRECTION02's
computeTerminationAuthorityVerdict fell through to TA6 whenever:

```text
host_self_events = []
parent_lifecycle absent
crash_summary   absent
    ->
TA6 NOT_REPRODUCED
```

This is invalid. The Node.js docs explicitly recommend an external
monitor for reliable process-failure detection — in-process hooks
cannot prove SIGKILL / kernel panic / OOM kill / watchdog kill /
parent kill. The two prior specimens (A and B) both hit this
fallthrough because no external witness was running and the JS
event loop did not dispatch an exit event before the process died.

## The RED discriminator (single load-bearing test)

TALIVE-TA6-NEGATIVE-WITNESS-01

```text
input:
  host_self_events=[]
  parent_lifecycle absent
  crash_summary   absent

old behavior:
  TA6 NOT_REPRODUCED

required behavior (post-fix):
  TA5 CAPTURE_INSUFFICIENT
```

## Pre-fix run (verified)

```
$ git stash push apps/vscode/src/sdk/extension-host-termination-authority.ts
Saved working directory and index state WIP on main: 80f76a484 ...

$ PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/vitest run \
    --config vitest.config.ts \
    src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts \
    -t "TALIVE-TA6-NEGATIVE-WITNESS-01"

 FAIL  src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts >
       ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 / verdict classifier >
       TALIVE-TA6-NEGATIVE-WITNESS-01:
       no host events + no parent-lifecycle + no crash report -> TA5 (NOT TA6)
 AssertionError: expected 'TA6' to be 'TA5'
 Expected: "TA5"
 Received: "TA6"

 Test Files  1 failed (1)
 Tests  1 failed | 41 skipped (42)
```

## Post-fix run (verified)

```
$ git stash pop
Dropped refs/stash@{0} (...)

$ PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/vitest run \
    --config vitest.config.ts \
    src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts \
    -t "TALIVE-TA6-NEGATIVE-WITNESS-01"

 Tests  1 passed | 41 skipped (42)
```

## Causal chain (single-bit, mutation-resistant)

```text
pre-fix classifier + RED test input             -> TA6  (FAIL test)
post-fix classifier + RED test input            -> TA5  (PASS test)
pre-fix classifier + GREEN test input (witness) -> TA6  (PASS test)
post-fix classifier + GREEN test input (witness)-> TA6  (PASS test)
```

The TALIVE-TA6-NEGATIVE-WITNESS-01 discriminator is mutation-resistant:
any future regression that re-introduces the unconditional TA6
fallthrough trips this test.

## Companion discriminators (also RED-failing pre-fix)

```text
TALIVE-TA6-NEGATIVE-WITNESS-02   parent-lifecycle present but NOT affirming survival
                                 pre-fix: TA6
                                 post-fix: TA5

TALIVE-TA5-DEATH-UNRESOLVED-01   external PID disappearance + restart, no authority
                                 pre-fix: TA6 (no event captured)
                                 post-fix: TA5

TALIVE-TA5-DEATH-UNRESOLVED-02   external death + watchdog attribution
                                 pre-fix: TA6 (no event captured, no
                                            external termination in TA-D5)
                                 post-fix: TA3 (external termination wins)

TALIVE-TA5-DEATH-UNRESOLVED-03   external death + resource attribution
                                 pre-fix: TA6 (same reasoning)
                                 post-fix: TA4 (resource exhaustion wins)
```

These three are derived from the same single defect (TA6 as
unconditional fallthrough) and exercise different shapes of the
new TA-D5 / TA-D7 boundary.

## Positive discriminators (GREEN both pre- and post-fix; regression guard)

```text
TALIVE-TA6-AFFIRMATIVE-01        completed window + no death + no crash -> TA6
TALIVE-TA6-AFFIRMATIVE-02        completed window + crash report present -> TA2
TALIVE-TA2-PID-BINDING-01        crash report PID matches -> TA2
TALIVE-TA2-WRONG-PID-01          crash report PID differs -> NOT TA2
TALIVE-TA3-EXPLICIT-01           watchdog/host kill -> TA3
TALIVE-TA4-EXPLICIT-01           OOM/resource evidence -> TA4
```

These existed in the prior classifier and continue to classify
correctly. They are retained as regression guards.
