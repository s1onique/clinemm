# ACT-CLINEMM-FACTORIZE-F0-INVENTORY01

**VERDICT = PASS_FACTORIZE_F0_INVENTORY**

---

## Identity

| Field | Value |
|---|---|
| ENTRY_HEAD | `a523f9471325f4b39488d4f9744d82a0b02cffce` |
| ENTRY_TREE | `f3875422d887da92d3c38b831bd40f0d20f14c97` |
| FINAL_HEAD | `a523f9471325f4b39488d4f9744d82a0b02cffce` |
| WORKTREE | clean |

## Continuity

| Field | Value |
|---|---|
| PREVIOUS_PAUSE | none — F0 had not previously been run |
| RESUME_STATUS | not applicable |
| F0_RESUME | YES |

## Repository

| Field | Value |
|---|---|
| PACKAGES | 31 walkable packages (20 SDK, 1 VS Code host, 10 misc) |
| APPS | 5 (vscode, cli, cline-hub, examples/desktop-app, plus nested webview-ui, testing-platform, examples) |
| PRODUCTION_LOC | 1,839,451 (total walkable) |
| TEST_LOC | 778,340 (total walkable) |
| FORK_PRODUCTION_DELTA | +185,923 / −923 LOC across 583 files |
| UPSTREAM_BASE | `upstream/main` (`48d63852745460ff0fa3dfcc0457bbe2493841de`) — equals merge base |
| FORK_COMMITS_AHEAD | 1,112 |

## Dependency graph

| Metric | Value |
|---|---:|
| Edges | 37 |
| CYCLES | **0** |
| SUSPICIOUS_EDGES | 0 (host→host: 1 = `@cline/cli → @cline/cline-hub`, classified INTENTIONAL) |
| BOUNDARY_CANDIDATES | 3 (host→@cline/agents direct, sandbox split, settings-keys mirror) |

## Fork delta

| Metric | Value |
|---|---|
| MODIFIED_PRODUCTION_FILES | 145 |
| ADDED_PRODUCTION_FILES | 1,182 |
| DELETED_PRODUCTION_FILES | 0 |
| FORK_PRODUCTION_LOC_DELTA | +185,923 / −923 |
| TOP_DELTA_AREAS | `apps/vscode/src/sdk/` (250 files); `sdk/packages/core/src/runtime/command-policy/` (12 large files); `apps/vscode/src/sdk/task-state-shadow-*` (7 files) |

## Coordinators

| Metric | Value |
|---|---:|
| COUNT | 16 host-side coordinator-named files |
| LIFECYCLE_OWNER | 0 (the only LIFECYCLE_OWNER in the host is `CommandJobManager`) |
| POLICY_COMPOSER | 2 (`SdkModeCoordinator`, `SdkSessionAutoApprovalCoordinator`) |
| TRANSPORT_ADAPTER | 11 |
| STATE_PROJECTION | 3 (`SdkForegroundCommandCoordinator`, `SdkMessageCoordinator`, `TaskShadowCoordinator`) |
| COMPATIBILITY_BRIDGE | 0 |
| UNKNOWN | 0 |

## State authorities

| Metric | Value |
|---|---:|
| SEMANTICS_MAPPED | 11 (working-context, session override, auto-approval, provider/model config, workspace identity, command policy/path authority, TaskState, session identity, sandbox, provider-change ledger, ...) |
| MULTI_AUTHORITY_CANDIDATES | **1** (WorkingContextHostCapture: SHADOW with dual writers) |
| SHADOWS | 3 (WorkingContextHostCapture — dual-writer; TaskStateShadow — intentional; `turnState` legacy field — partial migration) |
| BRIDGES | 6 (RuntimeEventSubscription, statePostDebouncer, grpcBridge, RemoteConfigRefreshCoordinator, WorkingContextHostCapture canonical path, ProviderConfigStore subscription) |
| CACHES | 4 (WorkingContextHostCapture, ProviderConfigStore in-memory, sessionAutoApprovalRebuild, SessionConfigBuilder) |

## Compatibility

| Metric | Value |
|---|---|
| PERMANENT_ADAPTERS | 4 (ProviderMigration, task-state-shadow cluster, host-ownership-capture, post-terminal-authority-diagnostic) |
| ACTIVE_MIGRATIONS | 3 (`cline-session-factory.ts`, `model-catalog/effective-config.ts`, `legacy-state-reader.ts`) |
| DELETABLE_NOW | 1 (`turnState` field for non-thinking consumers — partial migration already underway) |
| UNKNOWN_DELETE_PREDICATES | 0 (every ACTIVE_MIGRATION has an implicit predicate: "when all legacy data has migrated") |

## Duplication

| Metric | Value |
|---|---|
| TRUE_DUPLICATIONS | 0 |
| DOMAIN_VARIANTS | 4 (path authority lexical vs realpath; auto-approval typed envelope vs boolean; tool policy host vs core; settings keys host vs core) |

## Change radius

| TOP_HOTSPOTS | Commits |
|---|---:|
| `apps/vscode/src/sdk/SdkController.ts` | 88 |
| `apps/vscode/src/sdk/sdk-tool-policies.ts` | 23 |
| `apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts` | 23 |
| `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` | 22 |
| `apps/vscode/src/sdk/command-job-manager.ts` | 19 |

`apps/vscode/src/sdk/` accounts for **85 %** of host-side change activity.
`sdk/packages/core/src/runtime/` accounts for **69 %** of core-side change activity.

## Correction density

| TOP_CORRECTION_HOTSPOTS | Corrections |
|---|---:|
| `TEMPORARY-EXTERNAL-PATH-AUTHORITY` family | **6** |
| `RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR` | **5** |
| `TASKHEADER-UNBOUND-SHADOW-AUTHORITY` | 2 |

## Upstream friction

| TOP_CONFLICT_SURFACES | Upstream LOC | Fork LOC | Fork commits |
|---|---:|---:|---:|
| `apps/vscode/src/sdk/SdkController.ts` | 2,388 | **4,679** | 160 |
| `apps/vscode/src/sdk/sdk-tool-policies.ts` | 92 | 1,120 | 28 |
| `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` | 291 | 1,125 | 25 |

## SdkController

| Metric | Value |
|---|---:|
| LOC | **4,679** |
| FIELDS (private, typed) | 26 coordinator/bridge fields + 26 glue flags + 41 misc = **93** |
| METHODS (async) | 39 |
| RESPONSIBILITIES (direct) | 31 (composition root + glue) |
| RESPONSIBILITIES (delegated) | 27 |
| RESIDUAL_AUTHORITY_CANDIDATES | 5 (workingContextHostCapture wiring, sessionAutoApproval override plumbing, post-terminal-authority diagnostic, providerConfigStore wiring, taskTelemetry attachment) |

## Top candidates (per §20 scorecard)

### 1. A — Working-context capture: dual-writer → single
- SCORE = **65**
- EVIDENCE = `WorkingContextHostCapture.ts` 131–230; `POST-COMPACTION-W-BAR-REFRESH-RECON01` PASS_WITH_BOUNDED_P1; `setLatest` is documented workaround
- SIZE = S
- BLAST_RADIUS = LOW

### 2. D — Temporary-external-path-authority single-writer
- SCORE = 57
- EVIDENCE = 6 correction rounds (highest in factory); threaded `temporaryExternalCanonicalRoots` parameter
- SIZE = S
- BLAST_RADIUS = LOW

### 3. C — `cline-session-factory.ts` legacy-fallback consolidation
- SCORE = 52
- EVIDENCE = 1,238 LOC; explicit "legacy fallback" comments throughout; Model Profiles precondition
- SIZE = M–L
- BLAST_RADIUS = MEDIUM–HIGH

## Selected successor

```
NEXT_ACT = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
```

| Field | Value |
|---|---|
| WHY | Smallest bounded seam that removes a recently-fixed dual-writer bug and has the highest scorecard weight |
| WHAT_IT_DELETES_OR_SIMPLIFIES | `WorkingContextHostCapture.setLatest()` (and the producer call-site in `sdk-compaction.ts`); ~10 LOC of dual-write wiring in `SdkController.ts` |
| WHAT_AUTHORITY_BECOMES_CANONICAL | `WorkingContextHostCapture` becomes the single host-side carrier for W; classification SHADOW → CACHE |
| WHAT_EXECUTABLE_TESTS_PROTECT_IT | `sdk-compaction-coordinator.legacy-turnstate-coherence.*` (existing); a new RED test for the single-writer invariant |
| WHY_IT_IS_BOUNDED | One class, two methods, one producer seam, four files, < 100 LOC |

## Local invariants (per §16)

Fifteen invariants derived from source/evidence. Strongest:
1. Package dependency graph is acyclic and one-way.
2. Every host coordinator is constructed exactly once in `SdkController.ts`.
3. `CommandJobManager` is the only host-side lifecycle owner of subprocesses.
4. `WorkingContextHostCapture`'s assignment contract (`UNDEFINED_W_STALE_REUSE = FORBIDDEN`) is load-bearing.
5. Path authority has two intentional precision tiers (realpath vs lexical); NOT a duplication.

## Residue

- **P0**: none discovered during F0. (The fork appears to be in a stable closure state after the editor authority and post-compaction W ACTs.)
- **P1**: candidate C (`cline-session-factory.ts`) and candidate E (settings keys consolidation) — both are preconditions for Model Profiles. Either could become a P1 if Model Profiles starts.
- **P2**: candidate B (SdkController residual authority) is a long-term architecture debt; not urgent.

## Git

| Field | Value |
|---|---|
| COMMITS | 0 (recon-only ACT; no production changes) |
| PUSHED | NO |
| FORCE_PUSHED | NO |
| NEW_FILES | 18 evidence files in `.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/` + 2 analysis scripts in `.factory/tmp/factorize-f0/` |
| ANALYSIS_SCRIPTS | `package-inventory.py`, `dep-graph.py` — retained as evidence (used to generate artifacts) |
| WORKTREE | clean (apart from the evidence files) |

## Stop conditions checked

- HALT_UNEXPECTED_TRACKED_DIRT: not triggered (worktree clean at entry)
- HALT_PREDECESSOR_P0: not triggered (no predecessor P0)
- HALT_SCOPE_VIOLATION: not triggered (no production code touched)
- HALT_FACTORIZE_FOR_P0: not triggered (no P0 discovered)
- CAPTURE_INSUFFICIENT: not triggered (evidence is mechanical and reproducible)

## Acceptance predicate (§40) — answers

1. **Actual package dependency directions?** Shared → llms → agents → core → sdk → hosts. Acyclic. See §02.
2. **Where does the fork differ structurally from upstream?** Two areas: (a) `apps/vscode/src/sdk/` host adapter layer (250 files), (b) `sdk/packages/core/src/runtime/command-policy/` + `runtime/sandbox/macos/` (security primitives). See §03.
3. **Which semantic values have more than one mutable representation?** `currentWorkingContextEstimate` (dual writer), `TaskState` (intentional shadow + canonical), `turnState` (legacy field + ThinkingPresentationProjection partial migration). See §06.
4. **Which coordinators are lifecycle owners?** None. `CommandJobManager` is the only host-side lifecycle owner. See §05.
5. **Which compatibility seams have no deletion predicate?** `cline-session-factory.ts`, `model-catalog/effective-config.ts`, `legacy-state-reader.ts` (all `ACTIVE_MIGRATION` with implicit "when migration completes" predicate). See §07.
6. **Which source areas have highest change radius + correction density?** `SdkController.ts` (88 commits, 4,679 LOC), the `command-policy/` cluster (5 files in top-15), the task-state shadow cluster (6 files in top-20). Highest correction density: `TEMPORARY-EXTERNAL-PATH-AUTHORITY` family (6 corrections). See §09 + §10.
7. **Which fork-specific changes generate the highest upstream merge friction?** `SdkController.ts` (160 fork commits vs 71 upstream commits; doubled in size). See §12.
8. **Top three factorization candidates?** Working-context capture (65), Temp-external-path-authority single-writer (57), `cline-session-factory.ts` consolidation (52). See §15.
9. **Which ONE first?** Working-context capture. Smallest bounded seam, highest score, deletion predicate is explicit. See §17.
10. **What executable tests already exist?** `sdk-compaction-coordinator.legacy-turnstate-coherence.*` (5 variants), `task-state-shadow-*` (4 variants), `working-context-host-capture` direct tests. See §11 + §17.


---

## C4. Closure correction disposition (2026-09-05)

F0 closure review disposition:

```
VERDICT                         = PASS_WITH_ONE_BOUNDED_P1
INVENTORY                       = ACCEPTED
SELECTED SUCCESSOR              = ACCEPTED
  (ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01)
PRESELECTED F1 IMPLEMENTATION   = NOT YET ACCEPTED
F0 CORRECTION CYCLE             = NONE (in-place corrections applied)
NEXT                            = F1 RECON -> CHARACTERIZATION -> BOUNDED FACTORIZATION
                                  (NOT direct refactor)
```

### Corrections applied

| # | Item | Class | Applied to |
|---:|---|---|---|
| 1 | `WorkingContextHostCapture` labeled SHADOW/dual authority over-strong | P1 | `07` addendum |
| 2 | Preselected F1 design is hypothesis, not frozen | P1 | `17` addendum |
| 3 | Correction-density metric is LOWER BOUND | P2 | `10` addendum |
| 4 | LOC metrics include generated/nested walkable source | P2 | `01` addendum |
| 5 | `clinemm -> @cline/agents` is valid upstream pattern | P2 | `04` addendum |
| 6 | Candidate A scoring is a ceiling pending F1 recon | P2 | `15` addendum |

See `19-closure-correction.md` for the full grounded correction map and the
frozen F1 starting question + discriminators + permitted outcomes.

### What F0 leaves durable

```
- The dep graph measurement (acyclic, one-way)
- The fork-delta concentration map
- The SdkController.ts doubling and 160/71 fork/upstream commit ratio
- The 16-coordinator inventory and classification (11/3/2/0)
- The host->host (@cline/cli -> @cline/cline-hub) note
- The three ACTIVE_MIGRATION bridges (~1750 LOC legacy-fallback)
- The correction-density LOWER BOUND ranking
- The Model Profiles precondition
- The selected successor = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
```

### What F1 must do first

```
RECON:
  1. Capture NORMAL TURN chain (AgentRuntime.prepareTurn -> ... -> observe)
  2. Capture MANUAL COMPACTION chain (compactTask -> ... -> setLatest)
  3. Answer SAME_SEMANTIC_STATE / SAME_OWNER / SAME_EVENT_DOMAIN
  4. Resolve to Outcome A / B / C / B-prime
  5. THEN choose delete-setLatest vs unify-to-assignment-primitive vs use-shared-seam
```

No production source touched. No F0 CORRECTION01 ACT opened.
