# ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01

**Status:** PASS / TA6 false-negative classifier defect REPAIRED /
external lifecycle observer SHIPPED. The classifier no longer falls
through to TA6 NOT_REPRODUCED when external parent-side evidence is
absent or non-affirming. The new external lifecycle observer is the
canonical source of the affirmative negative witness.

**Predecessor:** ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01
(`PASS_TERMINATION_AUTHORITY_INFRASTRUCTURE_SEMANTICALLY_INERT_LIVE_SPECIMEN_AUTHORIZED`)
+ 02 prior specimens that both classified TA6 NOT_REPRODUCED on
insufficient evidence.

---

## 0. Mission

Convert the current ambiguous live result:

```text
Extension Host visibly terminates/restarts
+
in-process termination witness has no terminal evidence
+
analyzer emits TA6 / NOT_REPRODUCED
```

into a trustworthy termination classification.

The ACT answers:

```text
Did the Extension Host actually die during the specimen?

If yes:
  who/what owned that death?
```

This ACT **does not repair the Extension Host failure** and does
**not** yet repair the reactive hot path. It repairs the classifier
+ adds the mandatory external witness.

---

## 1. Frozen entry state

Preserved at entry:

```text
HOST_FAILURE
  REAL / LIVE / historically reproducible

PREARMED_CPU_CAPTURE
  CP5
  ~idle before the failure window
  no stable JS hot leaf
  repair_authorized=false

REACTIVE_VSCODE_CPU_PROFILE
  REAL / LIVE
  acquired after VS Code detected Extension Host unresponsiveness
  38,073 samples
  materially different phase from the pre-armed idle segments
  ClineMM-heavy + GC-heavy
  source-level causality NOT YET PROVEN

TERMINATION_WITNESS
  default-off
  dogfood-only
  safe-list:
    exit
    uncaughtExceptionMonitor
    warning

CURRENT LIVE ANALYZER RESULTS
  specimen A -> TA6 / NOT_REPRODUCED
  specimen B -> TA6 / NOT_REPRODUCED

TA6_TRUST
  REJECTED unless external evidence affirmatively proves
  that the observation window completed without Extension Host death

ROOT_CAUSE
  UNRESOLVED

REPAIR_AUTHORIZED
  FALSE
```

VS Code explicitly monitors Extension Host responsiveness and
attaches a CPU profiler after it becomes unresponsive, so the
reactive `.cpuprofile` represents a later observation phase than our
pre-armed rolling sampler.

Node also recommends an external monitor when reliable detection of
process failure is required; in-process hooks cannot prove every
hard-death mode.

---

## 2. Defect (the false-negative)

The prior `computeTerminationAuthorityVerdict` classifier (in
`apps/vscode/src/sdk/extension-host-termination-authority.ts`) fell
through to TA6 whenever:

```text
host_self_events = 0
parent_lifecycle absent
crash_report absent
    ->
TA6 NOT_REPRODUCED
```

That is **invalid**. Absence of evidence from a process that may
have been killed is NOT evidence that it survived.

The two prior specimens (A and B) both produced this false TA6
because the operator-supplied `parent-lifecycle.json` was absent
(no external witness was running) and no host-self `exit` event
was emitted by the in-process witness (the process died before the
JS event loop could dispatch it).

This ACT **fixes the defect** by making TA6 require an affirmative
external negative witness.


---

## 3. New invariant (the corrected classifier)

TA6 / NOT_REPRODUCED requires an **affirmative external negative
witness**:

```text
parentLifecyclePresent == true
affirmativeNegativeWitness == true
nativeCrashReportPresent == false
```

where `affirmativeNegativeWitness` is true iff `parent-lifecycle.json`
explicitly records:

```text
observation_window_started_at: <ISO timestamp>
observation_window_completed:   true
extension_host_pid:             <number>
extension_host_started_at:      <ISO timestamp>
extension_host_terminated:      false
extension_host_restarted:       false
```

Without these, the fallthrough is **TA5 CAPTURE_INSUFFICIENT**,
never TA6.

---

## 4. Required discriminators (all GREEN)

The corrected classifier is exercised by these new + updated
discriminators in
`apps/vscode/src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts`:

```text
TATRM-VERDICT-01..07       (7 preserved; VERDICT-06 updated to
                            reflect the affirmative-negative-witness
                            contract — TA6 requires the witness)

TALIVE-TA6-NEGATIVE-WITNESS-01   the RED discriminator for the
                                 defect: no host events + no
                                 parent-lifecycle + no crash ->
                                 TA5 (NOT TA6)

TALIVE-TA6-NEGATIVE-WITNESS-02   no host events + parent-lifecycle
                                 present but NOT affirming survival
                                 -> TA5

TALIVE-TA6-AFFIRMATIVE-01        completed external window + no
                                 death + no crash -> TA6 NOT_REPRODUCED

TALIVE-TA6-AFFIRMATIVE-02        completed window + crash report
                                 present -> TA2 (not TA6)

TALIVE-TA5-DEATH-UNRESOLVED-01   external PID disappearance +
                                 restart, no explicit authority ->
                                 TA5 (death observed but
                                 authority unresolved)

TALIVE-TA5-DEATH-UNRESOLVED-02   external death + watchdog -> TA3

TALIVE-TA5-DEATH-UNRESOLVED-03   external death + resource -> TA4

TALIVE-TA2-PID-BINDING-01        crash report PID matches failed
                                 Extension Host -> TA2

TALIVE-TA2-WRONG-PID-01          crash report PID differs -> NOT TA2

TALIVE-TA3-EXPLICIT-01           parent reports watchdog/host kill
                                 -> TA3

TALIVE-TA4-EXPLICIT-01           external death + explicit OOM/resource
                                 evidence -> TA4
```

All 18 of the new + updated discriminators PASS against the
corrected classifier. The 16 pre-existing failures in the focused
vitest suite are the documented pre-existing `z.object` vitest
transform defect (per ACT-TERMINATION-AUTHORITY01 result.json); not
a regression of this ACT.

---

## 5. RED→GREEN proof

The single most important test is:

```text
TALIVE-TA6-NEGATIVE-WITNESS-01
```

```text
input:
  host_self_events=[]
  parent_lifecycle absent
  crash_summary absent

old behavior:
  TA6 NOT_REPRODUCED

required behavior:
  TA5 CAPTURE_INSUFFICIENT
```

The test fails against the pre-fix classifier with:

```
AssertionError: expected 'TA6' to be 'TA5'
Expected: "TA5"
Received: "TA6"
```

(verified by `git stash` round-trip on entry HEAD `80f76a484`).

The test passes against the corrected classifier (verified by
`vitest run -t TALIVE-TA6-NEGATIVE-WITNESS-01` after the fix is
applied).

The single-bit causal chain is therefore:

```text
pre-fix classifier + RED test input  -> TA6
pre-fix classifier + GREEN test input (witness) -> TA6
post-fix classifier + RED test input  -> TA5
post-fix classifier + GREEN test input (witness) -> TA6
```

Mutation-resistant: a future contributor who re-introduces the
fallthrough trips `TALIVE-TA6-NEGATIVE-WITNESS-01` (RED→GREEN
discriminator).


---

## 6. External witness — now mandatory

The ACT §6 mandate is satisfied by a new external observer:

```text
scripts/capture-extension-host-lifecycle.mjs
```

It runs OUTSIDE the Extension Host (Node process, not bound to the
host) and observes the actual Extension Host PID via low-cost
`ps -p <pid> -o pid=,ppid=,pcpu=,command=` polling on macOS / Linux
(250-500 ms cadence; default 400 ms). The key evidence is:

```text
PID existed
  -> PID disappeared
    -> new Extension Host PID appeared (or didn't)
```

That alone proves death/restart even if exact termination authority
remains unknown. The script writes `parent-lifecycle.json` with the
frozen `schema_version=1` shape (the fields enumerated in ACT §5).

### Smoke verification

```bash
# 1. Live verification (PID still alive) -> TA6 path
node scripts/capture-extension-host-lifecycle.mjs \
  --capture-id test-observer --pid $$ --cadence-ms 200 \
  --duration-ms 1500 --data-dir /tmp/clinemm-test
node scripts/analyze-termination-authority.mjs \
  /tmp/clinemm-test/diagnostics/termination-authority/capture-test-observer
# -> TA6 NOT_REPRODUCED   (affirmative survival witness)
```

```bash
# 2. Synthetic death-restart (PID disappeared + replacement)
# parent-lifecycle.json extension_host_terminated=true +
# extension_host_restarted=true -> TA5 path (death observed but
# authority unresolved).
```

```bash
# 3. Synthetic no-witness (parent-lifecycle.json absent)
# -> TA5 CAPTURE_INSUFFICIENT   (the RED case, now correctly
# classified)
```

All three shapes verified during this ACT.

### Production wiring

The external observer is NOT bound to the in-process witness. It
runs as a separate operator-side command. This is by design: an
in-process observer cannot prove a hard-death (SIGKILL, kernel
panic, OOM kill, watchdog kill, parent kill). The Node.js docs
explicitly recommend an external monitor when reliable detection
of process failure is required.

---

## 7. Crash report PID binding

The analyzer (`scripts/analyze-termination-authority.mjs`) now
**binds** a macOS crash report to the failed Extension Host by:

1. Reading `parent-lifecycle.json` `extension_host_pid`
2. Reading `crash-summary.json` `pid`
3. Reading `parent-lifecycle.json` `observation_window_started_at`
   + `observation_window_completed_at`
4. Reading `crash-summary.json` `parsed_at` / `timestamp`

A crash report only counts toward TA2 when:

```text
report.pid == parent-lifecycle.extension_host_pid
AND
report.parsed_at inside [observation_window_started_at,
                          observation_window_completed_at]
```

Otherwise: `nativeCrashReportPresent=false`, the verdict falls to
TA5, and `derived_from.crash_report_unrelated_reason` records
`pid_mismatch` or `timestamp_outside_window`.

This prevents TA2 from being misclassified on unrelated Electron
crash reports found by `ls ~/Library/Logs/DiagnosticReports/`
(e.g. Code Helper crashes that have nothing to do with the
Extension Host death).

---

## 8. Corrected classifier precedence

| Precedence | Condition | Classification |
|------------|-----------|----------------|
| 1 | `processExitedNormally && processExitObserved && !nativeCrashReportPresent` | TA1 |
| 2 | `nativeCrashReportPresent` (PID + window bound) | TA2 |
| 3 | `externalTerminationReported && !processExitObserved && !nativeCrashReportPresent` | TA3 |
| 4 | `resourceExhaustionReported && !processExitObserved && !nativeCrashReportPresent` | TA4 |
| 5 | `observedEventCount > 0 \|\| processExitObserved \|\| (externalLifecycleProvesDeath && !nativeCrashReportPresent && !externalTerminationReported && !resourceExhaustionReported)` | TA5 |
| 6 | `parentLifecyclePresent && affirmativeNegativeWitness && !nativeCrashReportPresent` | TA6 |
| 7 | fallthrough (no host events + no external authority + no affirmative negative witness) | TA5 |

Rule 7 is the key new gate: TA6 is *only* reachable via rule 6.
Without the affirmative external negative witness, the fallthrough
is TA5 — never TA6.


---

## 9. Reactive CPU profile preservation

`exthost-92df5a.cpuprofile` (38,073 samples, REACTIVE_AFTER_UNRESPONSIVE)
preserved as evidence. Source-level causality between the hot
profile and the death is **not** proven by this ACT.

The desired timeline (still HYPOTHESIS_ONLY):

```text
last pre-armed idle segment
        ↓
first unresponsive indication
        ↓
VS Code reactive CPU profiler starts
        ↓
ClineMM / GC hot phase
        ↓
Extension Host termination
        ↓
restart
```

The next causal ACT (ACT-CLINEMM-EXTENSION-HOST-PREFAILURE-TO-REACTIVE-BRIDGE01)
will bind the timeline to PIDs + timestamps; this ACT does not.

---

## 10. Live specimen (operator-run)

The ACT spec §13 specifies a single live specimen:

```bash
unset CLINEMM_DIAG_ALLOCATION_PROFILE
unset CLINEMM_DIAG_CPU_PROFILE
export CLINEMM_DIAG_TERMINATION_AUTHORITY=1

# Start the external lifecycle observer FIRST (captures the
# pre-armed PID + records death/restart transitions):
node scripts/capture-extension-host-lifecycle.mjs \
  --capture-id <id> \
  --duration-ms 60000 \
  --cadence-ms 400 \
  --data-dir ~/.cline/data \
  --pid <observed Extension Host PID> &

# Then run the failing workload:
sh -c 'echo STARTED; sleep 30; echo FINISHED'
```

The expected post-run pipeline:

```bash
# 1. Re-classify with parent-lifecycle + crash-report context:
node scripts/analyze-termination-authority.mjs \
  ~/.cline/data/diagnostics/termination-authority/capture-<id>

# 2. Inspect ~/Library/Logs/DiagnosticReports/ for any
# matching crash report (PID == observed Extension Host PID,
# timestamp inside the observation window) and run:
node -e '
  const { writeCrashReportSummary } = require("./apps/vscode/src/sdk/extension-host-termination-authority-runtime")
  writeCrashReportSummary("<id>", "<path>")
'
```

The verdict is then one of:

```text
TA1 PASS_TERMINATION_AUTHORITY_EXPLICIT_PROCESS_EXIT
TA2 PASS_TERMINATION_AUTHORITY_NATIVE_CRASH
TA3 PASS_TERMINATION_AUTHORITY_EXTERNAL_OR_WATCHDOG
TA4 PASS_TERMINATION_AUTHORITY_RESOURCE
TA5 CAPTURE_INSUFFICIENT
TA6 NOT_REPRODUCED   (requires affirmative negative witness)
```

If the specimen proves only "PID disappeared → replacement PID
appeared" while no explicit kill/crash/OOM authority is available,
the correct closure is **TA5 / CAPTURE_INSUFFICIENT** — NOT another
speculative repair.

This ACT does NOT execute the live specimen itself (the prior
specimen evidence remains the live substrate; this ACT repairs the
classifier + adds the external witness so the next specimen
classifies truthfully). The live specimen is operator-run on the
dogfood VSCodium + notify-enabled background workload per ACT §13.

---

## 11. Conservation gates

All gates PASS:

```text
focused classifier tests
  TALIVE-TA6-NEGATIVE-WITNESS-01..02: PASS
  TALIVE-TA6-AFFIRMATIVE-01..02: PASS
  TALIVE-TA5-DEATH-UNRESOLVED-01..03: PASS
  TALIVE-TA2-PID-BINDING-01, TALIVE-TA2-WRONG-PID-01: PASS
  TALIVE-TA3-EXPLICIT-01, TALIVE-TA4-EXPLICIT-01: PASS
  TATRM-VERDICT-01..07: PASS

termination witness conservation tests
  TATRM-CONSERVE-*: PASS for the new discriminators;
  16 pre-existing failures documented (pre-existing z.object
  vitest transform defect — out of scope per operator directive)

CPUCAP conservation
  1168/1168 PASS via bun scripts/run-bun-unit-tests.ts
  Zero regression vs pre-fix HEAD

ALLOCAUTH conservation
  covered by the same 1168/1168 PASS

TQCB / BTCONT / CCARD / SLAC conservation
  covered by the same 1168/1168 PASS

tsc --noEmit
  EXIT=0 (verified post-fix)

biome check (changed files)
  0 errors / 0 warnings (verified post-fix)

git diff --check
  clean (verified post-fix)

analyzer end-to-end smoke (3 shapes: affirmative-survival /
death-restart / no-witness)
  TA6 / TA5 / TA5 respectively — all correct
```

No new permanent public API/proto/webview/workspace setting.

---

## 12. Evidence labels

Used strictly (per ACT §21):

```text
External PID disappearance/restart
  REAL / LIVE / EXTERNAL

host-self exit
  REAL / LIVE / IN_PROCESS

matching macOS crash report
  REAL / LIVE / NATIVE

VS Code reactive cpuprofile
  REAL / LIVE / REACTIVE_AFTER_UNRESPONSIVE

causal relation between hot profile and death
  INFERRED until bridge ACT proves it
```

Never promoted:

```text
absence of self events -> no crash
reactive CPU hotness -> cause of termination
memory growth -> OOM
process exit event -> self-initiated exit
```

---

## 13. Completion verdict

`PASS_TERMINATION_AUTHORITY_CLASSIFIER_REPAIRED_LIVE_WITNESS_INSTALLED`

The TA6 false-negative defect is mechanically classified and
repaired. The external lifecycle observer is shipped. The crash
report PID binding is enforced. The next live specimen will
classify truthfully.

No `REPAIRED` verdict on the **Extension Host failure** itself
(this ACT does not address the hot path). No `REPAIRED` verdict on
the reactive CPU profile. Both remain pending the bridge ACT.

---

## 14. Production delta

### New files

- `apps/vscode/src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts` — extended (+11 discriminators, header updated)
- `scripts/capture-extension-host-lifecycle.mjs` — new (433 LOC external lifecycle observer)

### Modified files

- `apps/vscode/src/sdk/extension-host-termination-authority.ts` — pure classifier signature + body: 3 new optional input fields (`parentLifecyclePresent`, `affirmativeNegativeWitness`, `externalLifecycleProvesDeath`); new TA5 fallthrough (rule 7); TA6 now requires affirmative negative witness
- `scripts/analyze-termination-authority.mjs` — extractor accepts the 3 new fields; PID-binding for TA2 crash reports; window-binding for TA2; new `derived_from.crash_report_unrelated_reason` provenance

### Documentary alignment (P2)

- The prior TERMINATION-AUTHORITY01 entry on the epic board (`TERMINATION-AUTHORITY01  infrastructure CLOSED  classifier TA6 semantics found defective`) is now annotated: defect REPAIRED in this ACT.

### Test count

- Pre-fix: 31 cases in focused vitest suite + 1168 cases in default bun suite
- Post-fix: 42 cases in focused vitest suite (11 new discriminators) + 1168 cases in default bun suite (zero regression)
- RED→GREEN proof: `TALIVE-TA6-NEGATIVE-WITNESS-01` fails against pre-fix classifier; passes against post-fix classifier

---

# CORRECTION01 — HALT_EXTERNAL_LIFECYCLE_FALSE_SURVIVAL_ON_INITIAL_MISS

## C0. Why this correction exists

The runtime-forensics reviewer identified a new P0 in the exact
evidence path that authorizes TA6 — the external lifecycle observer
delivered in iteration 01.

The observer sampled the requested PID once on entry and wrote
`extension_host_started_at = samples[0]?.at` if any sample was
recorded. When the requested PID is stale/already-dead when
observation begins:

```text
samples[0].at exists (a sample was recorded)
samples[0].alive == false (the PID was never alive during the window)
lastAlive stays false throughout
extension_host_started_at = samples[0].at   # despite sample being dead
extension_host_terminated = false
extension_host_restarted = false
observation_window_completed = true
```

The classifier then sees an apparently valid affirmative negative
witness and returns **TA6 NOT_REPRODUCED** even though the observer
**never saw the Extension Host alive at all**. This recreates the
exact epistemic failure this ACT was intended to remove.

A P1 was folded into the same correction: restart detection
previously ran ONLY on the first dead sample. After that,
`lastAlive = false`, so subsequent iterations never re-checked for
a replacement PID. If the replacement Extension Host appeared
~600 ms after the death sample, the observer recorded
`terminated=true, restarted=false` for the rest of the window even
though a restart did occur.

## C1. Bounded corrections (no architecture review)

### Observer fix (P0)

```js
// Before (LIVE-CLASSIFICATION01 / 01):
extension_host_started_at: samples[0]?.at ?? null,

// After (CORRECTION01):
let firstAliveSampleAt = null
// ... in the sampling loop:
if (sample.alive) {
    lastAlive = true
    if (firstAliveSampleAt === null) {
        firstAliveSampleAt = nowIso
    }
}
// ...
extension_host_started_at: firstAliveSampleAt,
extension_host_observed_alive: firstAliveSampleAt !== null,
```

When no alive sample is ever recorded, both `extension_host_started_at`
and `extension_host_observed_alive` are null/false. The analyzer's
predicate fails the `parentLifecycleObservedAlive` gate and TA6 is
unreachable.

### Observer fix (P1)

```js
// Before: replacement-PID search only ran once on first dead sample
// After: every iteration while terminated && !restarted
if (observedTerminated && !observedRestarted) {
    const replacement = await locateExtensionHostPid()
    if (replacement && replacement.pid !== originalPid) {
        seenReplacementPid.value = replacement.pid
        observedRestarted = true
        restartPid = replacement.pid
        restartAt = new Date().toISOString()
    }
}
```

### Classifier fix (P0)

```ts
// New optional input field on computeTerminationAuthorityVerdict
readonly parentLifecycleObservedAlive?: boolean

// TA6 branch now requires ALL THREE:
if (parentLifecyclePresent && affirmativeNegativeWitness && parentLifecycleObservedAlive && !nativeCrashReportPresent) {
    return { classification: "TA6", ... }
}
```

The field defaults to TRUE for backward compatibility with legacy
callers (the in-process exit-listener verdict flush).

### Analyzer fix (P0)

```js
const parentLifecycleObservedAlive =
    parentLifecycle !== null &&
    (parentLifecycle.extension_host_observed_alive === true ||
     (typeof parentLifecycle.extension_host_started_at === "string" &&
      typeof parentLifecycle.extension_host_pid === "number" &&
      Array.isArray(parentLifecycle.samples) &&
      parentLifecycle.samples.some(
          s => s && s.pid === parentLifecycle.extension_host_pid && s.alive === true)))
```

Adds `derived_from.parent_lifecycle_observed_alive` provenance
field for forensics.

## C2. Required discriminators

```text
TALIVE-OBSERVER-INITIAL-DEAD-01

given:
  parent-lifecycle recorded with N samples
  all samples for the bound PID have alive == false
  extension_host_started_at = null (post-fix observer)
  extension_host_observed_alive = false (post-fix observer)

expected:
  parentLifecycleObservedAlive = false
  affirmativeNegativeWitness = false
  verdict = TA5 CAPTURE_INSUFFICIENT
```

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

```text
TALIVE-OBSERVER-INITIAL-DEAD-02 (backward-compat guard)

given:
  parentLifecyclePresent = true
  affirmativeNegativeWitness = true
  parentLifecycleObservedAlive = omitted (legacy caller)

expected:
  default parentLifecycleObservedAlive = true
  verdict = TA6 NOT_REPRODUCED  (unchanged)
```

## C3. RED→GREEN proof (verified by git stash round-trip)

Pre-fix:

```
$ git stash push apps/vscode/src/sdk/extension-host-termination-authority.ts
Saved working directory and index state WIP on main: a0fc3d16a ...

$ vitest run -t "__RED_PROOF_TALIVE_OBSERVER_INITIAL_DEAD_01"

 FAIL  src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts >
        __RED_PROOF_TALIVE_OBSERVER_INITIAL_DEAD_01:
        should fail pre-CORRECTION01
 AssertionError: expected 'TA6' to be 'TA5' // Object.is equality
 Expected: "TA5"
 Received: "TA6"
```

Post-fix:

```
$ git stash pop
Dropped refs/stash@{0} (...)

$ vitest run -t "TALIVE-OBSERVER"
 Tests  3 passed | 42 skipped (45)
```

## C4. End-to-end analyzer proof (synthetic-stale-pid-initial-dead)

The synthetic bundle
`.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01/synthetic-stale-pid-initial-dead/`
contains a real observer capture with `--pid 99999999` (a stale
PID; the observer correctly records 6 samples with
`alive: false`, `extension_host_started_at: null`,
`extension_host_observed_alive: false`).

```
$ node scripts/analyze-termination-authority.mjs \
    .factory/evidence/ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01/synthetic-stale-pid-initial-dead

TA5    CAPTURE_INSUFFICIENT    no host-self events observed AND external parent-side witness absent or non-affirming -- absence of evidence is NOT evidence of absence; capture is insufficient to claim NOT_REPRODUCED
```

The verdict.json's `derived_from.parent_lifecycle_observed_alive`
is explicitly `false`, recording WHY TA6 was rejected.

## C5. Updated test count (post-CORRECTION01)

- Pre-CORRECTION01: 42 cases in focused vitest suite + 1168 cases in default bun suite
- Post-CORRECTION01: 45 cases in focused vitest suite (+3 CORRECTION01 discriminators) + 1168 cases in default bun suite (zero regression)
- RED→GREEN proof: `TALIVE-OBSERVER-INITIAL-DEAD-01` fails against pre-CORRECTION01 classifier; passes against post-CORRECTION01 classifier

## C6. Updated production delta (post-CORRECTION01)

### Modified files

- `apps/vscode/src/sdk/extension-host-termination-authority.ts` — pure classifier signature gains optional `parentLifecycleObservedAlive?` input (defaults to TRUE for backward-compat); TA6 branch now requires ALL of (parentLifecyclePresent, affirmativeNegativeWitness, parentLifecycleObservedAlive)
- `apps/vscode/src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts` — +3 discriminators (TALIVE-OBSERVER-INITIAL-DEAD-01, TALIVE-OBSERVER-INITIAL-DEAD-02, TALIVE-OBSERVER-SEEN-ALIVE-01); verdictFor helper accepts the new input
- `scripts/capture-extension-host-lifecycle.mjs` — extension_host_started_at derived from first alive sample; extension_host_observed_alive explicit flag; replacement-PID search moves from once-on-first-dead-sample to per-iteration while terminated && !restarted; stdout includes observed_alive=N
- `scripts/analyze-termination-authority.mjs` — computes parentLifecycleObservedAlive from samples[]/extension_host_observed_alive; new derived_from.parent_lifecycle_observed_alive provenance

### New evidence files

- `.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01/synthetic-stale-pid-initial-dead/{meta.json,host-self-events.jsonl,parent-lifecycle.json,verdict.json,README.md}` — real observer capture with stale PID + analyzer TA5 verdict

### Updated evidence files

- `02-witness-contract.md` — schema documentation updated with extension_host_observed_alive; TA6 predicate updated with parent_lifecycle_observed_alive gate; CORRECTION01 observer invariants documented
- `03-red-design.md` — CORRECTION01 section added with defect description, RED discriminator, pre/post-fix RED proof, P1 fold-in
- `04-focused-gates.txt` — test count updated to 45; RED proof captured; 4-shape analyzer smoke (incl. CORRECTION01 P0)
- `05-conservation.txt` — 4 input fields on pure classifier; observer CORRECTION01 invariants; test count updated; mutation-resistance section extended
- `result.json` — verdict renamed to PASS_TERMINATION_AUTHORITY_CLASSIFIER_REPAIRED_LIVE_WITNESS_INSTALLED_OBSERVER_INITIAL_DEAD_GUARDED; history extended with CORRECTION01 entry; HALT_EXTERNAL_LIFECYCLE_FALSE_SURVIVAL_ON_INITIAL_MISS added to stop_conditions_checked

## C7. Completion verdict (post-CORRECTION01)

`PASS_TERMINATION_AUTHORITY_CLASSIFIER_REPAIRED_LIVE_WITNESS_INSTALLED_OBSERVER_INITIAL_DEAD_GUARDED`

The CORRECTION01 P0 (false-TA6 on initial-dead PID) is mechanically
classified and repaired. The CORRECTION01 P1 (delayed restart
detection) is folded into the same correction. The 3 new
discriminators all PASS. Zero regression in 1168/1168 bun default
suite. The 16 pre-existing vitest infra failures remain unchanged
and out of scope.

The next live specimen will classify truthfully even when the
requested PID is stale/already-dead when observation begins.

Per the reviewer's directive: C1 GO directly to the live specimen
with no further pre-capture review unless another new P0 appears.
