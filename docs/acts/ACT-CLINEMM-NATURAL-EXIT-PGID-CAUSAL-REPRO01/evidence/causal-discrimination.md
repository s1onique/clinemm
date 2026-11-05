# NEPCR01 — Causal Discrimination

## Verdict

**`MULTIPLE_CAUSAL_MECHANISMS`**

The real production natural-exit path DOES reproduce the
`alive → containment_failed` boundary, and TWO distinct mechanisms account
for it. They are not the same defect and they are not interchangeable.

---

## Mechanism 1 — TRANSIENT DESCENDANT SURVIVAL

**Observed sequence (N1, REAL_PROCESS):**

```
natural leader exit
  → supervisor exit promise resolves (stdio already closed)
  → finalize() probes the OWNED PGID -> non-`gone`
  → containment_failure_classified
  → manager publishes containment_failed (substrate_eperm on this host;
     substrate_alive on the LIVE host)
  → the ORIGINAL PGID later becomes gone WITHOUT intervention
  → the manager's historical record is NOT retroactively changed
```

**Discriminator:** the group is observed ALIVE at the finalize boundary
with a positively-identified descendant whose `pgid` equals the ORIGINAL
owned PGID, and the group is observed GONE later, with no intervention.

**Why it is not a reaping artifact:** the group had a LIVE, IDENTIFIED
member (the descendant) at the finalize boundary. A reaping artifact has
no live member.

**Why it is not a false observation:** the `alive` reading was TRUE at
probe time. The classification was correct as an observation; it became
STALE as a later completion blocker.

---

## Mechanism 2 — LEADER / REAPING RACE

**Observed sequence (CONTRAST + REAPING-RACE trials, REAL_PROCESS):**

```
supervisor exit promise resolves
  → the OS has NOT yet reached an observable `gone` postcondition
  → finalize() probes the OWNED PGID -> non-`gone`
  → containment_failed is published
  → the group becomes gone a short, bounded time later
  → NO live member ever occupied the group at the probe
```

**Discriminator:** the production postcondition is non-`gone` for a
command with NO descendant at all (plain foreground `true`), and for a
stdio-inheriting descendant whose own lifetime has already elapsed. In
both cases the group has NO live member, and the group entry disappears
within the observation window with no intervention.

**Direct measurement** (5 trials, real production supervisor, workload
`( sleep 1 & echo DESC=$! ; exit 0 )`):

| trial | postcondition AT the supervisor exit resolution | ~26ms later |
|---|---|---|
| #0 | ESRCH (gone) | ESRCH |
| #1 | ESRCH (gone) | ESRCH |
| #2 | **EPERM (group entry still present)** | ESRCH (gone) |
| #3 | **EPERM (group entry still present)** | ESRCH (gone) |
| #4 | ESRCH (gone) | ESRCH |

The supervisor's exit promise resolved at T+1012..T+1024ms in every
trial, i.e. AFTER the descendant had already exited. The group entry
simply had not been reclaimed yet.

**Why it is not a descendant effect:** there is no live descendant. The
descendant has exited; only the kernel's process-group bookkeeping lags.

---

## Mechanism 3 — PERSISTENT DESCENDANT (safety control, N2)

**Observed sequence (N2, REAL_PROCESS):**

```
natural leader exit
  → finalize() probes the OWNED PGID -> non-`gone`
  → containment_failed published
  → the group is STILL alive at the observation deadline
  → the alive member is a positively-identified process whose pgid
    equals the ORIGINAL owned PGID
```

This is the SAFETY CONTROL. It shows the current hold is doing real
work: the same production code path, with a descendant that genuinely
persists, yields a group that is still demonstrably alive at the
observation deadline. A future repair that made this case terminalize
cleanly would be WRONG.

**N2 is NOT the LIVE incident's mechanism** — but it is the reason the
safety hold cannot be relaxed globally.

---

## What the LIVE incident's three witnesses actually were

The LIVE records give `postcondition = alive` / `substrate_alive` at
finalize. On this host the equivalent production label is `eperm`
(Seatbelt denies group signalling), but the boundary, the terminal state
(`containment_failed`) and the safety hold are IDENTICAL.

The LIVE witness set is therefore reproduced in SHAPE by N1 (and
partly by the CONTRAST/reaping trials). The LIVE evidence does not
include a later PGID observation, so it CANNOT by itself tell Mechanism 1
from Mechanism 2 — which is exactly the gap this ACT was created to
close.

---

## Discrimination table

| Experiment | Workload | Postcondition at finalize | Live member in the ORIGINAL PGID? | Later observation | Mechanism |
|---|---|---|---|---|---|
| N0 | `true` | `gone` | no | gone | none (clean path) |
| N1 | transient descendant, stdio redirected | non-`gone` | **YES** | gone | **1 — transient descendant** |
| N2 | persistent descendant (30s), stdio redirected | non-`gone` | **YES** | **alive** | 3 — persistent (safety control) |
| N3 | shell WAITS for the same child | `gone` | no | gone | none (ABLATION-A) |
| C1 | cancel of a running owned group | `gone` | no | gone | none (ABLATION-B) |
| C2 | deadline on a running owned group | `gone` | no | gone | none |
| CONTRAST | stdio-INHERITING descendant | non-`gone` OR `gone` (flaky) | no (descendant already exited) | gone | **2 — reaping race** |
| REAPING-RACE ×8 | plain `true` ×8 | non-`gone` in some trials | no | gone | **2 — reaping race** |

---

## Necessity / ablation

### ABLATION-A — remove surviving descendants by WAITING (N1 vs N3)

Same child workload (`sleep`), the only difference is whether the shell
waits for it.

| | postcondition | terminal |
|---|---|---|
| N1 (no wait) | non-`gone` | `containment_failed` |
| N3 (wait) | `gone` | `exited` |

**Conclusion:** delaying the root exit until the child has finished
eliminates the observed non-`gone` postcondition. Exit SEQUENCING is a
necessary ingredient for Mechanism 1.

This does NOT select a repair. It only establishes that the root-exit /
descendant-completion ORDER is load-bearing.

### ABLATION-B — remove natural-exit timing via explicit termination (N1 vs C1)

| | path | postcondition | terminal |
|---|---|---|---|
| N1 | natural, no `terminateTree()` | non-`gone` | `containment_failed` |
| C1 | cancel, `terminateTree()` runs first | `gone` | `cancelled` |

**Conclusion:** `terminateTree()` waits for the OWNED PROCESS GROUP to be
gone BEFORE `finalize()` probes it, so the explicit-termination path is
structurally immune to both Mechanism 1 and Mechanism 2. The natural-exit
path has NO such barrier.

### ABLATION-C — remove timing ambiguity (N1 / CONTRAST)

The SAME original PGID is observed at the immediate boundary and at every
later boundary. For N1 the group was alive with an identified member and
later gone; for the CONTRAST it was non-`gone` with NO live member and
later gone. The historical `containment_failed` classification therefore
represents the EARLIER observation and is NOT new liveness evidence
later.

---

## Conservation gates

| Gate | Result | Evidence |
|---|---|---|
| G1 Real `CommandJobManager` | PASS | `runExperiment` constructs the production manager with NO `spawnFactory` override |
| G2 Real production supervisor | PASS | `spawnFactory` unset -> `spawnSupervisableShellCommand`; the vitest `@cline/core` alias re-exports the REAL SDK source |
| G3 Natural-exit target reproduced | PASS | N1: non-`gone` -> `containment_failed` |
| G4 Immediate vs later PGID distinguished | PASS | `immediateObservation` + `laterObservations` |
| G5 Root exit not conflated with group termination | PASS | N2 keeps a live member; the CONTRAST/REAPING trials have none |
| G6 Persistent descendant not silently safe | PASS | N2 asserts `laterLiveness === "alive"` and `residual_observed` |
| G7 Cancel/deadline semantics unchanged | PASS | C1 -> `cancelled`/`gone`; C2 -> `deadline_exceeded`/`gone`; no production file changed |
| G8 Existing clean `gone` path remains valid | PASS | N0 -> `gone` -> `exited`; N3 -> `gone` -> `exited` |
| G9 `EPERM`/unknown remain fail-closed | PASS | the production probe maps EPERM -> `eperm` -> `substrate_eperm` -> `containment_failed`; unchanged |
| G10 No PID/PGID reuse promoted into causal identity | PASS | every observation records `pid/ppid/pgid/stat/lstart/command` per member plus the leader's start identity; the "gone" verdict is only claimed together with the membership evidence |
| G11 No test-owned process leaks | PASS | the G11 test re-probes every owned PGID created by the suite and requires `gone` |
| G12 No production runtime/protocol/completion-policy change | PASS | zero production files changed |

---

## Alternative explanations considered and excluded

1. **"The `alive` observation was simply wrong."** Excluded for N1: the
   descendant was positively identified as a member of the ORIGINAL PGID
   at the probe boundary. The observation was TRUE.
2. **"The postcondition probe is broken / misreports."** Excluded: the
   probe's errno semantics are exact (rc=0 alive, EPERM alive-but-
   unsignalable, ESRCH gone) and the READ-ONLY harness reproduces the
   same discrimination independently.
3. **"A stale historical classification is the whole story."** Excluded:
   RED-03 shows the manager's ORIGINAL record is NOT retroactively
   cleared when the group later disappears — so the historical
   `containment_failed` DOES continue to block completion. That is a
   CONSEQUENCE of the lifecycle defect, not its cause.
4. **"Node's generic `close` semantics equal the supervisor's
   abstraction."** Measured and refuted: the supervisor's `exit` resolves
   on `close` (root exit AND stdio drained), which is why a
   stdio-inheriting descendant delays it by its full lifetime.
5. **"Explicit termination would show the same thing."** Refuted by
   C1/C2: `terminateTree()` waits for group-gone before the probe, so
   those paths are structurally clean.

---

## Successor recommendation

**Exactly one recommendation, per the ACT's decision table:**

> **Mixed mechanisms -> narrow first intervention with conservation of
> the others.**

Concretely, the successor investigation should target **Mechanism 2 (the
leader/reaping race) FIRST**, because it is the one that produces a
non-`gone` postcondition for a group with **no live member at all** —
i.e. the case where the safety hold has nothing to protect. Mechanism 1
(a genuinely live descendant) and Mechanism 3 (a persistent descendant)
must be conserved: the `gone`-only clean-terminal invariant must NOT be
weakened for either.

The successor ACT must still demonstrate necessity and conservation
against BOTH the N1 and N2 witnesses before any production change.
