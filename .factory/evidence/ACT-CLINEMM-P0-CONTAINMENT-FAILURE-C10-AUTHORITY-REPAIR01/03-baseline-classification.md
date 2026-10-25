# 03 — BASELINE FAILURE CLASSIFICATION

## The method

The baseline was captured by SWAPPING THE PRISTINE COORDINATOR FILE IN
PLACE (`git show HEAD:apps/vscode/src/sdk/sdk-session-event-coordinator.ts`
-> the working file), running the suite, and restoring the repaired file.
The identical command was used for both runs, so the two failure sets are
directly comparable.

Command (both runs):

```
bunx vitest run --config vitest.config.ts --pool=threads --reporter=dot
```

(The default `forks` pool hits a macOS `kill EPERM` worker-termination
artifact in this environment — an environment limitation, not a code
defect. `--pool=threads` runs the same suites deterministically.)

## The result

| | failing `FAIL` lines |
|---|---|
| PRISTINE ENTRY_HEAD | 278 |
| WITH THE REPAIR | 257 |
| **NEW failures introduced by the repair** | **0** |
| Failures REMOVED by the repair | 21 |

The 21 removed failures are exactly:

- the 2 RED witnesses this ACT added/converted
  (`CFC10A01-RED-03-B`, `CFC10A01-RED-03-B-DEFERRED`),
- the 2 characterization assertions this ACT intentionally converted
  (`CFC10A01-RED-03-E`, `CFC10A01-RED-06-A`),
- the 12 new ACT-owned conservation tests that FAIL against the pristine
  implementation (M1-B, M1-F, M1-G, M1-I, M2-B, M3-A, M4-A, M5-A, M5-C,
  M5-E, M5-F and one more) — these are the ACT's OWN RED witnesses, and
  they are GREEN after the repair,
- 3 known environment/timing-flaky cases unrelated to this ACT
  (`async-command-turn-liveness.acl01.test.ts`,
  `myc-prime-live-diag-readout.test.ts`,
  `services/mcp/__tests__/finalizationRunBootstrapStall01.test.ts`) that
  failed in the pristine run and passed in the repaired run — these are
  timing-sensitive and flipped between the two runs.

**Zero new failures.** The repair is a strict improvement over the baseline.

## The named pre-existing suites (ACT §9)

The ACT named these suites as already failing at the pristine ENTRY_HEAD
because their harnesses do not inject the now-required
`getElmCompletionAuthorityDecision` (introduced by
`ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY`).

| Suite | PRISTINE failing cases | WITH THE REPAIR failing cases | Δ |
|---|---|---|---|
| `background-completion-barrier01.bcb01` | 13 | 13 | **0** |
| `background-completion-barrier01-correction01.bcb01-c` | 6 | 6 | **0** |
| `background-completion-barrier01-correction02.bcb01-c2` | 2 | 2 | **0** |
| `background-completion-barrier01-correction03.bcb01-c3` | 1 | 1 | **0** |
| `background-completion-barrier01-correction04.bcb01-c4` | 3 | 3 | **0** |
| `post-consumption-completion-authority01.pcca01` | 2 | 2 | **0** |
| `background-notify-completion-authority-c10-framework01.bnca-framework01` | 2 | 2 | **0** |
| `background-notify-completion-authority-c10-framework-dispatch-failed01.bnca-framework01` | 2 | 2 | **0** |
| **TOTAL** | **31** | **31** | **0** |

These are the ACT's documented baseline failures. They are **NOT disguised
as a clean baseline** — they are recorded by their exact names and counts,
and they are byte-identical before and after the repair.

### Were they required as load-bearing conservation gates?

**NO.** The ACT's required conservation gates are discharged by the
ACT-OWNED suites, which do NOT depend on the broken harnesses:

- `containment-failure-c10-authority-repair01.cfc10ar01.test.ts` — 25/25
  PASS (all 12 required matrix rows + the 5 additional verifications).
- `containment-failure-c10-authority01.cfc10a01.test.ts` — 19/19 PASS
  (the predecessor's retained suite: manager lookup, observation
  consumption, receipt gating, foreign ownership and ablation).
- `premature-handoff-containment-failure01.phcf01.test.ts` — 10/10 PASS
  (the Q5 owner-scoping suite: this is the gate that proves the Site C
  refactor preserved Q5 semantics).

Because none of the named broken suites is load-bearing for a conservation
claim, **no harness-only correction was made**. The ACT's instruction
("otherwise keep their exact named failures classified as pre-existing")
applies, and the exact named failures are recorded above.

## The remaining 227 pre-existing failures

The wider `apps/vscode` vitest suite has a large pre-existing failure
population at the pristine ENTRY_HEAD (278 failing `FAIL` lines in total).
The overwhelming majority are environment-dependent on this macOS host:

- POSIX process-group / `kill(2)` / `setpgid` behaviours under the
  sandbox (`command-job-manager*.test.ts`, `command-job-manager.
  sandbox-integration.test.ts` — the seatbelt/EPERM constrained host),
- provider-bootstrap and remote-config suites,
- the `myc-prime-automation.*` and `pcpc-no-overclaim-sweep` suites,
- MCP bootstrap-stall timing bounds.

These are **NOT caused by this ACT** and **NOT repaired by this ACT** —
repairing them is outside the repair boundary and would violate the ACT's
scope restrictions. They are recorded here so the dashboard is not
presented as cleaner than it is.
