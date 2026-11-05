# RECON02 — Causal Decision

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02`
**Class:** RECON + LIVE CAUSAL DISCRIMINATION
**Production changes authorized:** NONE

---

## Status

**`READY_FOR_OPERATOR_PROBES`**

The four real-kernel measurements (A / B / C / D) have **not** been executed.
They cannot be executed by the agent: the agent's command substrate is itself
a ClineMM Background Exec command running inside the ClineMM Seatbelt profile
*and* inheriting the VSCodium extension host's Chromium zygote sandbox. A
nested `sandbox-exec` there is denied (`sandbox_apply: Operation not
permitted`, rc=71), and every `launchctl` mutation verb plus `osascript
Terminal` is denied as well. The ACT charter explicitly forbids the agent
from circumventing its own sandbox to obtain these measurements.

What this ACT *has* done is complete everything that can be completed without
the independent Terminal:

1. Frozen and verified the entry identity, worktree and stash state.
2. Verified the RECON01 profiles and fixtures are byte-identical to the
   frozen artefacts (candidate SHA-256 matches exactly; the profile diff is
   signal-rule-only).
3. Audited the fixtures for safety defects (none found; both fixtures have
   independent lifetime bounds).
4. Located and evaluated the inherited-host evidence (E3) that RECON01 could
   not check, including its caveats.
5. Built a bounded, self-cleaning operator harness that runs A/B/C/D with
   per-probe cleanup verification and aborts on any safety-gate failure.
6. Built the one bounded fixture that did not exist (the D2 negative-control
   initiator) and validated its JSON emission and alive-detection logic
   against a benign self-owned target, with zero process leakage.
7. Completed the §11 source reconnaissance: the exact profile-generation
   authority, the exact spawn boundary, where the inherited restriction
   enters, the existing opt-in production-seam test facility, and the existing
   narrow, ownership-gated host-side primitive that a successor can reuse
   without expanding privileged RPC authority.

---

## What is already known (no live probe required)

### The current profile denies the controlled child signal in the production seam

RECON01 measured this **LIVE** at the real production seam
(`CommandJobManager.start()` → `SeatbeltBackend.prepare()` → `sandbox-exec` →
Node parent → Node child → `kill()`):

```
signalAttempt.ok = false
signalErrno      = EPERM
```

with the profile-generated signature `self allowed, everything else EPERM`:
`kill(0,0)` = OK, `kill(childPid)` = EPERM, `kill(-childPgid,0)` = EPERM,
`kill(ppid,0)` = EPERM, `kill(1,0)` = EPERM.

That is `REAL_PRODUCTION_SEAM / LIVE`. It is not re-measured here.

### The inherited VSCodium/Chromium sandbox independently denies signals

This is E3. It is now **located and evaluated** rather than merely cited.

| Source | Discriminator | Result |
|---|---|---|
| `ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01` (2026-09-16) | T1: host → **plain unsandboxed** Node child, **no ClineMM profile applied** | `KILL_PGID_SIGTERM=ERR_EPERM`; child output stayed `READY\nALIVE\nALIVE\n…` |
| same | T2: child → **its own grandchild** | `CHILD_KILL=ERR_EPERM` → denial is inherited by descendants |
| **this ACT** (2026-11-05) | D2 fixture → benign plain-`node` sibling, agent substrate | `signalErrno=EPERM`, `foreignAliveAfter=true`, `foreignReceivedSIGTERM=false` |
| `ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01` | extension host vs trusted host helper | `EXTENSION_HOST_KILL=EPERM`, `HOST_HELPER_KILL=EPERM` — the helper did **not** escape the restriction either |

**Caveat (recorded, not hidden).** The 2026-09-16 T1/T2 runs executed from
inside the VSCodium extension-host substrate, where the inherited Chromium
layer and any ClineMM layer were stacked. The "no additional profile" claim
rests on the T1 fixture being a plain `node -e` child with no `sandbox-exec`
invocation, corroborated by the contemporaneous finding that `sandbox-exec`
could not apply in that substrate at all. Per the ACT charter, this is
therefore treated as **strong supporting evidence, not uncontested causal
proof**.

### Why the four probes are still required

Because the production substrate stacks **both** authorities, the observed
`self-allowed / everything-else-EPERM` signature is consistent with:

* H2 alone (the ClineMM `target self` rule denies the child signal), **or**
* H1 alone (the inherited Chromium sandbox denies it), **or**
* H3 (both contribute).

Only A/B/C/D from an independent Terminal separates them, because it removes
the inherited layer while leaving the ClineMM layer as the single variable.

---

## The decisive experiment (awaiting operator execution)

| Probe | Context | Child SIGTERM | Foreign SIGTERM | Cleanup |
|---|---|---|---|---|
| A | Independent Terminal, no Seatbelt | *pending* | — | *pending* |
| B | Independent Terminal, current profile | *pending* | — | *pending* |
| C | Independent Terminal, candidate profile | *pending* | — | *pending* |
| D | Candidate profile vs controlled foreign target | — | *pending* | *pending* |

### Decision map (CORRECTED — P0 HARNESS CORRECTION, rule R6)

**R6 — a Terminal-only matrix QUALIFIES the candidate Seatbelt signal rule;
it does NOT select an architecture.**

The A/B/C/D matrix is measured in an independent Terminal. That Terminal has
**no inherited VSCodium/Chromium authority**, so a Terminal result cannot
observe whether the production execution path benefits from the candidate
rule. Selecting `SELECT_SEATBELT_SIGNAL_REPAIR`,
`SELECT_COMPOSED_BOUNDARY_REPAIR` or `SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY`
from Terminal-only measurements would be an inference-to-proof promotion.

Therefore the decision table has **two gates**:

**Gate 1 — Terminal qualification** (no production-context evidence):

| A | B | C | D | Verdict |
|---|---|---|---|---|
| Success | EPERM | Success | denied (EPERM) | `READY_FOR_OPERATOR_PROBES` — the candidate rule is **QUALIFIED standalone**; the production context is still unobserved |
| Success | EPERM | EPERM | denied (EPERM) | `READY_FOR_OPERATOR_PROBES` — the candidate rule is **INSUFFICIENT standalone** |
| Success | Success | Success | denied (EPERM) | `READY_FOR_OPERATOR_PROBES` — the current rule did not reproduce the denial here |
| EPERM / ESRCH / invalid | any | any | any | `HALT_BASELINE_INVALID` |
| Success | any | any | **signal allowed** | `HALT_UNSAFE_SIGNAL_SCOPE` |
| Success | any | any | ESRCH / missing evidence / unexpected errno | `CAPTURE_INSUFFICIENT` |

**Gate 2 — architecture selection** (ONLY with production-context evidence
that the same candidate rule was exercised at the real production seam):

| A | B | C | D | Verdict |
|---|---|---|---|---|
| Success | EPERM | Success | denied (EPERM) | `SELECT_SEATBELT_SIGNAL_REPAIR` |
| Success | EPERM | EPERM | denied (EPERM) | `SELECT_COMPOSED_BOUNDARY_REPAIR` |
| Success | Success | Success | denied (EPERM) | `SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY` |
| EPERM / ESRCH / invalid | any | any | any | `HALT_BASELINE_INVALID` |
| Success | any | any | **signal allowed** | `HALT_UNSAFE_SIGNAL_SCOPE` |
| Success | any | any | ESRCH / missing evidence / unexpected errno | `CAPTURE_INSUFFICIENT` |

The implementation of this table is `classify_decision()` in
`harness-lib.sh`; it is asserted exhaustively by
`harness-regression-test.sh` (the R6 invariant test proves that with
`production_context_evidence = NO` **no** architecture token is ever
produced across all 32 input combinations).

`operator-probes.sh` sets `PRODUCTION_CONTEXT_EVIDENCE=NO` by default and
only honours an operator-supplied `RECON02_PRODUCTION_CONTEXT_EVIDENCE=YES`
when a separate production-seam observation for the same candidate rule has
been recorded.

---

## Security conservation (already established, re-verified this ACT)

The candidate profile differs from the current production profile by
**exactly one line**, verified by byte-level diff:

```diff
-(allow signal (target self))
+(allow signal (target same-sandbox))
```

| Boundary | Status | Basis |
|---|---|---|
| Filesystem write grants | **CONSERVED** | `(allow file-write* …)` block byte-identical |
| Read authority | **CONSERVED** | `(allow file-read*)` + deny carve-outs byte-identical |
| Network | **CONSERVED** | `(deny network*)` byte-identical |
| Process execution | **CONSERVED** | `(allow process-exec)`, `(allow process-fork)` byte-identical |
| Process signalling | **TARGET OF THE CHANGE** | `target self` → `target same-sandbox`; scope must be validated by probe D |
| Host helper | **UNCHANGED** | no helper source, binary, socket or plist change; not signalled, not restarted |
| LaunchAgent | **UNCHANGED** | no bootstrap / bootout / kickstart / submit |
| User credentials | **UNCHANGED** | no `denyReadSubpaths` change |
| Shell execution | **UNCHANGED** | no new unsandboxed execution method introduced |
| Process ownership | **PENDING probe D** | must be denied |

`C` succeeding in the Terminal is **not** `C` succeeding under VSCodium.
The inherited Chromium sandbox is a separate authority and is demonstrated to
deny the same operation independently.

---

## Remaining unobservables

1. Whether the current `target self` rule is **independently** sufficient to
   cause the production EPERM (probe B answers this).
2. Whether `(allow signal (target same-sandbox))` is accepted by Sonoma
   14.7.4 and actually widens the scope to owned descendants (probe C).
3. Whether the widened scope is safely confined — i.e. whether it still
   denies a same-UID foreign process (probe D, the mandatory gate).
4. Whether the inherited VSCodium sandbox would *still* deny the operation
   after the profile is corrected. **This cannot be answered from an
   independent Terminal**; it requires the corrected execution path to be
   exercised at the production seam.

---

## Next ACT (not implemented here)

The successor is selected **only** from the A/B/C/D outcome. The three
admissible successors, and the smallest discriminator each implies:

* **`SELECT_SEATBELT_SIGNAL_REPAIR`** → a bounded production profile
  correction in `seatbelt-profile.ts:700`, then the actual installed
  Background Exec path exercised RED → GREEN. No new execution service.
* **`SELECT_COMPOSED_BOUNDARY_REPAIR`** → a minimal, default-off execution-
  boundary prototype that tests the independent launch context **and** the
  validated Seatbelt signal rule together, reusing the existing
  `process-group.register-owned` / `process-group.terminate-owned` primitive
  in the host helper. **No unrestricted `execute(command,cwd,env)` method.**
  The prototype must first establish the smallest real host-side launch
  experiment that can prove the composition.
* **`SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY`** → only if separate live
  evidence proves host-side launch isolation is necessary and a narrowly
  scoped helper-side experiment can test it safely.

In all three cases the successor must begin with a **small discriminator**,
not a new service framework, and must reuse the existing bounded host-helper
signalling primitive rather than widening it.
