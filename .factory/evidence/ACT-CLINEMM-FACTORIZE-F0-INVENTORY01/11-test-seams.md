# 11 — Test Seams

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** count test files per cluster; classify testability per ACT §16.
**Evidence label:** STRUCTURAL

---

## Headline counts

| Source root | Test files |
|---|---:|
| `apps/vscode/src/sdk/__tests__/` | 148 |
| `sdk/packages/core/src/runtime/command-policy/*test*` | 31 |
| `apps/vscode/src/sdk/*coordinator.test.ts` | 16 |

The fork has **substantial test infrastructure** at every architectural seam. The 148 host SDK tests alone give every coordinator and shadow component its own test suite.

## Test seam inventory per top candidate

### A. `WorkingContextHostCapture` (the SHADOW with dual writers)

- Direct test: `apps/vscode/src/sdk/__tests__/sdk-compaction-coordinator.legacy-turnstate-coherence.*.test.ts` (multiple variants per ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01)
- Indirect tests: `task-state-shadow-correction02-*.test.ts` (multiple)
- TESTABILITY: **HIGH** — the carrier has explicit `forTest(initial)` seam and the recent ACT closed a real RED through it.

### B. Command-policy / path-authority

- 31 test files in `sdk/packages/core/src/runtime/command-policy/`
- Includes `path-authority.realpath.test.ts`, `path-authority.temporary-external.test.ts`, `structured-command-risk.*.test.ts` (8+ variants)
- TESTABILITY: **HIGH** — the most heavily tested subsystem in the fork.

### C. Task-state shadow

- `task-state-shadow-correction02-*.test.ts` (4 files), `task-state-shadow-host-wiring.*.test.ts`, `task-state-shadow-arbiter-mapper.c25-c5-elm02f.test.ts`, etc.
- TESTABILITY: **HIGH** — extensive but each test is bound to one ACT.

### D. SdkController

- No dedicated `SdkController.test.ts` file. The 148 host-sdk tests cover its surfaces indirectly.
- TESTABILITY: **LOW** — testing `SdkController` directly requires instantiating ~30 collaborators. The factory's strategy has been to test through the coordinators and the shadow cluster instead.
- This is a strong signal that `SdkController` is too central to test in isolation (per §18).

### E. Session auto-approval override (`SessionAutoApprovalStore`)

- No dedicated test file at `apps/vscode/src/sdk/session-auto-approval.test.ts`.
- TESTABILITY: **MEDIUM** — the store is class-based with explicit methods, easy to test in isolation, but no factory test exists. The only coverage is via `sdk-session-auto-approval-coordinator.ts` consumers.

### F. `cline-session-factory.ts` (legacy-fallback bridge)

- No dedicated test file. Heavy internal logic.
- TESTABILITY: **LOW** — 1,238 LOC of provider-by-provider fallback logic with no obvious unit-test boundary.

## Testability scorecard

| Candidate | Testability |
|---|---|
| Working-context capture (SHADOW) | **HIGH** |
| Path authority / command policy | **HIGH** |
| Task-state shadow cluster | **HIGH** |
| Session auto-approval override | MEDIUM |
| SdkController decomposition | **LOW** (would need characterization tests first) |
| Legacy provider fallback (`cline-session-factory.ts`) | **LOW** |

## Net assessment

The fork has very strong test coverage at the **per-coordinator / per-shadow-component** level. The weak points are:
- **`SdkController`** — too central to test, so it is implicitly tested through every other component
- **`cline-session-factory.ts`** — large fallback bridge with no direct tests
- **Session auto-approval** — undertested class

A factorization that splits `SdkController` would need a characterization test suite first.
