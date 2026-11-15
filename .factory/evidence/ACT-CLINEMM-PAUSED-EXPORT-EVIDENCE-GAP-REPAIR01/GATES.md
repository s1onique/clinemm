# ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01 — GATES

**Toolchain:** Bun `1.3.13` (`~/.bun/bin/bun`). `bunx` on this host lacks
the execute bit, so `bun x <bin>` was used (equivalent invocation).
Node remains the runtime for the VS Code extension host; nothing here
changes that.

**Working directory for every command below:** `apps/vscode`

## G0 — C0 identity / safety probes

| Command | Exit | Result |
|---|---|---|
| `git rev-parse HEAD` | 0 | `14a979cd1b8fb23dbe8a1348af4495eaf36984b8` |
| `git rev-parse --abbrev-ref HEAD` | 0 | `main` |
| `git status --porcelain=v1` (at entry) | 0 | **empty** — no `HALT_UNEXPECTED_TRACKED_DIRT` |
| `git remote -v` | 0 | `origin git@github.com:s1onique/clinemm.git`, `upstream https://github.com/cline/cline.git` |
| `git stash list` | 0 | `stash@{0}: WIP on main: d46223b51 ...` — **PRESERVED** |
| `git worktree list` | 0 | 5 worktrees — **PRESERVED** |
| `git cat-file -t 14a979cd1b8fb23dbe8a1348af4495eaf36984b8` | 0 | `commit` |
| `git merge-base --is-ancestor 14a979cd1b8fb23dbe8a1348af4495eaf36984b8 HEAD` | 0 | predecessor is **REACHABLE** |

No signal was sent to, and no restart was performed on, the operator's
still-running VSCodium instance. No push, VSIX deployment or release
was performed.

## G1 — the new RED -> GREEN suite

```bash
bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts
```

| Phase | Exit | Diagnostics |
|---|---|---|
| **RED** (before the repair) | **1** | `Tests  6 failed | 8 passed (14)` |
| **GREEN** (after the repair) | **0** | `Tests  14 passed (14)` |

RED failure detail (the six reproductions):

```
R1a  expected [ ] to have a length greater than 0
R1b  expected 'unavailable' to be 'available'
R2a  expected 'unavailable' not to be 'unavailable'
R3a  expected undefined to be truthy          (availabilityReason)
R3b  expected undefined to be truthy          (availabilityReason)
R5b  expected 'available' to be 'unavailable'
```

## G2 — the existing `automatic-incident-*` aice01 suites

```bash
bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/automatic-incident-activation01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-capture-export01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-correction01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-export01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-persistence01.aice01.test.ts
```

**Exit 0 — `Test Files 5 passed (5)`, `Tests 60 passed (60)`.**

## G3 — the reconciliation / containment / phase-authority conservation suites

```bash
bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/transient-containment-reconciliation-repair01.tcrr01.test.ts \
  src/sdk/__tests__/transient-containment-reconciliation-repair01.red-only.tcrr01.test.ts \
  src/sdk/__tests__/paused-containment-evidence01.discriminator.pce01.test.ts \
  src/sdk/__tests__/turn-state-writer-provenance.ctl01.test.ts \
  src/sdk/__tests__/turn-state-writer-provenance.hotpath01.test.ts \
  src/sdk/__tests__/turn-state-writer-provenance.equiv01.test.ts \
  src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts \
  src/sdk/__tests__/bcb-observation-unavailable-capture.bcapt01.test.ts
```

**Exit 1 — `Test Files 1 failed | 6 passed (7)`, `Tests 1 failed | 67 passed (68)`.**

The single failure is `BCAPT-CMD.2.1: registry declares both constants
with the correct id-suffix`.

### G3.1 The pre-existing failure is PROVEN pre-existing

The same failure reproduces at the **clean ENTRY_HEAD** with this ACT's
changes stashed:

```bash
git stash push -u -m 'tmp-aice01-check2'
bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/bcb-observation-unavailable-capture.bcapt01.test.ts
# EXIT 1 — Tests  1 failed | 25 passed (26)
#   × BCAPT-CMD.2.1: registry declares both constants with the correct id-suffix
git stash pop
```

The identical class of pre-existing failure exists in
`turn-state-writer-provenance.wprov.test.ts`
(`CMD02.1: registry declares both constants with the correct id-suffix`):

```bash
bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/turn-state-writer-provenance.wprov.test.ts \
  src/sdk/__tests__/bcb-observation-unavailable-capture.bcapt01.test.ts
# EXIT 1 — Tests  2 failed | 59 passed (61)
```

Both are **registry source-text guards** that assert a literal
`prefix + ".debug...."` expression in a registry source file. Neither
touches the export path, the incident manager, the containment logic or
the phase-authority logic. **Both were reproduced at the clean
ENTRY_HEAD with this ACT's changes stashed**, so they are NOT
regressions of this ACT. They are recorded, not fixed: fixing them is
outside this ACT's bounded scope.

**Consequence for the verdict:** these two failures are the
PRE-EXISTING baseline. Every test that exercises the touched path
passes.

## G4 — TypeScript

```bash
bun x tsc --noEmit -p tsconfig.json
```

**Exit 0 — 0 lines of diagnostics.**

## G5 — Biome lint / format

```bash
bun x biome lint --config-path ./biome.jsonc --no-errors-on-unmatched \
  --files-ignore-unknown=true --diagnostic-level=error \
  src/sdk/automatic-incident-export-sources.ts \
  src/sdk/automatic-incident-export-runtime.ts \
  src/sdk/automatic-incident-export.ts \
  src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts
# EXIT 0 — "Checked 4 files. No fixes applied."

bun x biome format --config-path ./biome.jsonc --no-errors-on-unmatched \
  --files-ignore-unknown=true --diagnostic-level=error --semicolons=as-needed \
  src/sdk/automatic-incident-export-sources.ts \
  src/sdk/automatic-incident-export-runtime.ts \
  src/sdk/automatic-incident-export.ts \
  src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts
# EXIT 0 — "Checked 4 files. No fixes applied."
```

## G6 — hygiene

| Item | Status |
|---|---|
| Global env mutated without restoration | **NO** — the suite never writes `process.env`; the only global seams it touches are the module-level diagnostic rings, and each is restored in `afterEach` |
| Global sinks mutated without restoration | **NO** — `setReconciliationDiagnosticCaptureEnabled`, `enable/disableTurnStateWriterProvenanceDiagnostic`, `setContinuationCardinalityAuthorityCaptureEnabled` and `setAutomaticIncidentCaptureEnabled` are all restored in `afterEach`; `clearAutomaticIncidents()` and the ring clears run in both `beforeEach` and `afterEach` |
| Temporary folders isolated and cleaned | **YES** — `mkdtempSync(join(tmpdir(), "aice01-export-gap-"))` per test, `rmSync(..., { recursive: true, force: true })` in `afterEach` |
| Intentionally failing tests in the default suite | **NO** — the new suite is GREEN in the default suite |
| Repository-wide runs | **NOT USED** — every run was scoped to the touched path |

## G7 — NOT EXECUTED

| Qualification | Status | Reason |
|---|---|---|
| Installed-extension qualification of the repaired export | **NOT_EXECUTED** | no VSIX deployment and no install are authorized by this ACT |
| Live VSCodium export against the operator's running instance | **NOT_EXECUTED** | changing / restarting / signalling the live instance is FORBIDDEN by this ACT |
| Historical installed artifact re-verification | **NOT_EXECUTED** | the historical artifact's source binding remains `HISTORICAL_RUNTIME_SOURCE_UNBOUND`; it cannot be re-bound by this ACT |

**No live claim is made.** The repair is verified by TESTS and
STRUCTURAL PROBES only.

---

# CORRECTION01 — GATES

## C-RED (before the correction)

```bash
cd apps/vscode && bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts
```

**EXIT 1 — `Tests  6 failed | 17 passed (23)`**

Failures: `C-1a`, `C-2a`, `C-2b`, `C-3a`, `C-3b`, `C-4a`.

## C-GREEN (after the correction)

```bash
cd apps/vscode && bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts
```

**EXIT 0 — `Tests  24 passed (24)`**

## C-conservation

```bash
cd apps/vscode && bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/automatic-incident-activation01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-capture-export01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-correction01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-export01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-persistence01.aice01.test.ts
```

**EXIT 0 — `Test Files 5 passed (5)`, `Tests 60 passed (60)`.**

```bash
cd apps/vscode && bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/transient-containment-reconciliation-repair01.tcrr01.test.ts \
  src/sdk/__tests__/transient-containment-reconciliation-repair01.red-only.tcrr01.test.ts \
  src/sdk/__tests__/paused-containment-evidence01.discriminator.pce01.test.ts \
  src/sdk/__tests__/turn-state-writer-provenance.ctl01.test.ts \
  src/sdk/__tests__/turn-state-writer-provenance.hotpath01.test.ts \
  src/sdk/__tests__/turn-state-writer-provenance.equiv01.test.ts \
  src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts \
  src/sdk/__tests__/bcb-observation-unavailable-capture.bcapt01.test.ts
```

**EXIT 1 — `Test Files 1 failed | 6 passed (7)`, `Tests 1 failed | 67 passed (68)`.**

The single failure is `BCAPT-CMD.2.1: registry declares both constants
with the correct id-suffix` — the SAME pre-existing registry source-text
guard that was already proven pre-existing at the clean entry head (see
G3.1 above). It is NOT a regression of this correction.

## C-types

```bash
cd apps/vscode && bun x tsc --noEmit -p tsconfig.json
```

**EXIT 0 — 0 lines of diagnostics.**

(The CORRECTION01 test deliberately injects a value that is NOT a
legitimate `TurnPhase`; the cast is explicit and documented, so the type
check stays clean while the runtime validation is still exercised.)

## C-lint / C-format

```bash
cd apps/vscode && bun x biome lint --config-path ./biome.jsonc \
  --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error \
  src/sdk/automatic-incident-export-sources.ts \
  src/sdk/automatic-incident-export-runtime.ts \
  src/sdk/automatic-incident-export.ts \
  src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts
# EXIT 0 — "Checked 4 files. No fixes applied."

cd apps/vscode && bun x biome format --config-path ./biome.jsonc \
  --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error \
  --semicolons=as-needed \
  src/sdk/automatic-incident-export-sources.ts \
  src/sdk/automatic-incident-export-runtime.ts \
  src/sdk/automatic-incident-export.ts \
  src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts
# EXIT 0 — "Checked 4 files. No fixes applied."
```

## C-hygiene

Unchanged from the parent ACT: no global env or sink mutation without
restoration; temporary folders isolated and cleaned; no intentionally
failing test in the default suite; no repository-wide run.

## C-NOT EXECUTED

| Qualification | Status | Reason |
|---|---|---|
| isolated installed-extension qualification (disposable VSCodium profile) | **NOT_EXECUTED** | the correction's bounded scope was the implementation and its verification; the qualification is the NEXT step and is gated on this correction passing |
| live export against the operator's running instance | **NOT_EXECUTED** | changing / restarting / signalling the live instance is FORBIDDEN |

**No live claim is made.**
