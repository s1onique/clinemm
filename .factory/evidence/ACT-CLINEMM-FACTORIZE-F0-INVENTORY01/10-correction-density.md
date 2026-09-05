# 10 — Correction Density

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** count ACTs per topic in `.factory/acts/`, count `*CORRECTION*` rounds per ACT family.
**Evidence label:** STRUCTURAL (filename inventory)

---

## Top correction-density seams

| ACT family | Total ACTs | Correction rounds |
|---|---:|---:|
| `TEMPORARY-EXTERNAL-PATH-AUTHORITY` | 7 | **6** (CORRECTION01–CORRECTION05, CORRECTION07) |
| `RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR` | 6 | **5** (CORRECTION02–CORRECTION06) |
| `TASKHEADER-UNBOUND-SHADOW-AUTHORITY` | 3 | 2 (CORRECTION01 + FIX01) |
| `SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY` | 3 | 2 (CORRECTION01–CORRECTION02) |
| `EDITOR-EFFECTIVE-DESTINATION-APPROVAL` | 1 | 0 (closed qualified; no correction cycle) |
| `COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR` | 1 | 0 (closed) |
| `POST-COMPACTION-W-BAR-REFRESH-RECON` | 1 | 1 (PASS_WITH_BOUNDED_P1) |

(Total factory ACTs scanned: 83. Total `*CORRECTION*` files: 18.)

## Per-cluster totals

| Cluster | Distinct ACT families | ACT count | Correction count |
|---|---:|---:|---:|
| Path authority (workspace / temp-external / realpath) | 4 | 14 | 10 |
| Task-state shadow / task header | 3 | 11 | 7 |
| Compaction (token/header/working-context) | 4 | 5 | 1 |
| Seatbelt / sandbox | 5 | 13 | 2 |
| Approval (general) | 4 | 6 | 1 |
| Settings / provider | 2 | 2 | 0 |
| Editor / apply_patch / destination | 2 | 2 | 0 |
| Process supervision / command job | 3 | 4 | 0 |

## Interpretation per ACT §15

```
high correction density + high ownership ambiguity + high change radius → strong factorization candidate
```

### Strongest candidate signal: `TEMPORARY-EXTERNAL-PATH-AUTHORITY`

- 7 ACTs in the family
- 6 correction rounds — the highest in the entire factory
- Topic: "temporary external canonical roots" — a fork-only security primitive for commands that legitimately need to read outside the workspace
- Touches: `sdk-tool-policies.ts` (host), `command-policy.ts` (core), `path-authority.ts` (core), `sdk-compaction-coordinator.test.ts` (host)
- Per ACT §26 this maps to `TemporaryExternalPathAuthority` (data type) and the `temporaryExternalCanonicalRoots` parameter threading

The reason it needed 6 correction rounds is structural: each correction refined the threading of the canonical-roots set through the command-approval pipeline. The fact that 6 rounds were needed implies the **threading seam itself was architecturally unclear** at the start.

### Second-strongest signal: `RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR`

- 6 ACTs
- 5 correction rounds
- Topic: getting the TaskHeader UI projection to reflect the canonical runtime state without drift
- Touches: `TaskShadowCoordinator`, `task-state-shadow-arbiter-mapper.ts`, `TaskHeaderPresentationProjection`, `working-context-host-capture.ts`

This is the "task-state shadow" cluster (per §4 cluster A). The 5 corrections imply that the projection chain (runtime → shadow → TaskHeader → webview) has too many stages.

### Third: `TASKHEADER-UNBOUND-SHADOW-AUTHORITY` + `POST-COMPACTION-W-BAR-REFRESH`

- 4 ACTs combined
- 3 correction rounds
- All touching the same architectural seam: the carrier/cache for working-context in the host (`WorkingContextHostCapture`)

This is the §6 SHADOW-with-dual-writers diagnosis in microcosm.

## What does NOT have high correction density

- **Compaction** itself has only 5 ACTs and 1 correction. The compaction machinery in `sdk/packages/core/src/extensions/context/` is stable.
- **Provider change** has 0 ACTs (no correction history). The provider-change coordinator is small and stable.
- **MCP** has 1 ACT (`settings-parity`). Stable.
- **Browser, task-control, follow-up, mode-switch, message-rendering**: 0–1 ACTs each. Stable.

## Net assessment

The two **architecturally hottest seams** in Cline-- are:

1. **Temporary external path authority** — 6 corrections on a single thread-the-canonical-roots-through-the-pipeline refactor.
2. **Task-state shadow projection** — 5 corrections on making the host webview projection reflect the canonical runtime state.

Both have:
- High correction density (the strongest predictor that the underlying design was unclear)
- High ownership ambiguity (path authority has 3+ entry points; shadow has 6+ files)
- High change radius (both touch 4–6 files per change)
- A common structural shape: **a single semantic value that flows through multiple stages**, each stage independently mutable.

This is the strongest signal F0 found that points toward a single factorization target.


---

## Correction addendum (C1 closure 2026-09-05)

**Correction-density counts are LOWER BOUND only**.

Reviewer P2: filename-enumeration undercounts. Some correction cycles are
recorded as commits or evidence appended to a parent ACT rather than separate
`.factory/acts/*CORRECTION*.md` files. Concrete example: the
`EDITOR-EFFECTIVE-DESTINATION-APPROVAL` family completed CORRECTION01-03 +
qualification within the same ACT body.

Revised metric semantics:

```
CORRECTION_DENSITY_BY_ACT_FILENAME
  = LOWER BOUND
  = NOT AUTHORITATIVE HISTORY COUNT

Downgrade x2 weighting in any future re-rank.

Robustness check:
  Even if Candidate D's correction count dropped from 4 to 2,
  Candidate A (score 65) would drop to ~61 and still win.
  Selection survives.
```
