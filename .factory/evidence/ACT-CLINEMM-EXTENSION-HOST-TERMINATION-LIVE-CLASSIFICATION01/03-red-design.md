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

## CORRECTION01 — P0 false-TA6 on initial-dead PID

### The new defect identified by the runtime-forensics reviewer

The external lifecycle observer (introduced in this ACT) samples the
requested PID once on entry, then unconditionally writes
`extension_host_started_at = samples[0]?.at` if any sample was
recorded. When the requested PID is stale/already-dead when
observation begins:

```text
samples[0].at exists (because a sample was recorded)
samples[0].alive == false
lastAlive = false
loop iterations never re-arm lastAlive to true
extension_host_started_at = samples[0].at   # despite sample being dead
extension_host_terminated = false
extension_host_restarted = false
observation_window_completed = true
```

The classifier then sees an apparently valid affirmative negative
witness and returns **TA6 NOT_REPRODUCED** even though the observer
**never saw the Extension Host alive at all**. This recreates the
exact epistemic failure this ACT was intended to remove.

### The CORRECTION01 RED discriminator

```text
TALIVE-OBSERVER-INITIAL-DEAD-01

given:
  parent-lifecycle recorded with N samples
  all samples for the bound PID have alive == false
  extension_host_started_at = null (post-fix observer)
  extension_host_observed_alive = false (post-fix observer)

expected (post-fix):
  parentLifecycleObservedAlive = false
  affirmativeNegativeWitness = false
  verdict = TA5 CAPTURE_INSUFFICIENT
```

### Pre-fix RED proof (verified via git stash)

```
$ git stash push apps/vscode/src/sdk/extension-host-termination-authority.ts
Saved working directory and index state WIP on main: a0fc3d16a ...

$ PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/vitest run \
    --config vitest.config.ts \
    src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts \
    -t "__RED_PROOF_TALIVE_OBSERVER_INITIAL_DEAD_01"

 FAIL  src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts >
        ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 / verdict classifier >
        __RED_PROOF_TALIVE_OBSERVER_INITIAL_DEAD_01:
        should fail pre-CORRECTION01
 AssertionError: expected 'TA6' to be 'TA5' // Object.is equality
 Expected: "TA5"
 Received: "TA6"

 Test Files  1 failed (1)
 Tests  1 failed | 42 skipped (43)
```

### Post-fix GREEN proof (verified)

```
$ git stash pop
Dropped refs/stash@{0} (...)

$ PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/vitest run \
    --config vitest.config.ts \
    src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts \
    -t "TALIVE-OBSERVER"

 Tests  3 passed | 42 skipped (45)
```

### Companion CORRECTION01 discriminator

```text
TALIVE-OBSERVER-SEEN-ALIVE-01

given:
  at least one sample with alive == true for the bound PID
  completed window
  no death/restart

expected:
  parentLifecycleObservedAlive = true
  affirmativeNegativeWitness = true
  verdict = TA6 NOT_REPRODUCED
```

This is a positive regression guard against an over-correction that
would deny TA6 even when the observer genuinely saw the Extension
Host alive.

### Backward-compat discriminator (CORRECTION01 must not break legacy callers)

```text
TALIVE-OBSERVER-INITIAL-DEAD-02

given:
  parentLifecyclePresent = true
  affirmativeNegativeWitness = true
  parentLifecycleObservedAlive = omitted (legacy caller)

expected:
  default parentLifecycleObservedAlive = true
  verdict = TA6 NOT_REPRODUCED  (unchanged)
```

### End-to-end analyzer-side GREEN proof (synthetic-stale-pid-initial-dead)

The synthetic bundle
`.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01/synthetic-stale-pid-initial-dead/`
contains a real capture from
`node scripts/capture-extension-host-lifecycle.mjs --pid 99999999`
(stale PID; the observer correctly records 6 samples with
`alive: false`, `extension_host_started_at: null`,
`extension_host_observed_alive: false`).

```
$ PATH="/opt/homebrew/bin:$PATH" node scripts/analyze-termination-authority.mjs \
    .factory/evidence/ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01/synthetic-stale-pid-initial-dead

TA5    CAPTURE_INSUFFICIENT    no host-self events observed AND external parent-side witness absent or non-affirming -- absence of evidence is NOT evidence of absence; capture is insufficient to claim NOT_REPRODUCED
```

The verdict.json's `derived_from.parent_lifecycle_observed_alive` is
explicitly `false`, recording WHY TA6 was rejected.

### P1 fix (folded into CORRECTION01)

Restart detection previously ran ONLY on the first dead sample. After
that, `lastAlive = false` so subsequent iterations never re-checked
for a replacement PID. If the replacement Extension Host appeared
~600 ms after the death sample, the observer recorded
`terminated=true, restarted=false` for the rest of the window even
though a restart did occur. The CORRECTION01 patch moves the
replacement-PID search into a per-iteration loop while
`terminated && !restarted`.
