# 08 — Executable gates (G8)

All commands were run from `sdk/packages/core` with the repository's
verified toolchain (`bun 1.3.14` via `/opt/homebrew/bin/bun`, `vitest`
4.1.10, `tsc` from the workspace `typescript` peer).

## The gates, as specified by the ACT

| # | Command | Exit | Result | Transcript |
|---|---|---|---|---|
| 1 | `bun x vitest run src/extensions/context/compaction.adjudication-output-contract.probe01.test.ts --config vitest.config.ts` | **0** | **55 passed (55)** | `verification/gate1-focused-probe.txt` |
| 2 | `bun x vitest run src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts --config vitest.config.ts` | **0** | **24 passed (24)** | `verification/gate2-historical-discriminator.txt` |
| 3 | `bun x vitest run src/extensions/context/compaction.evidence-fidelity01.test.ts --config vitest.config.ts` | **0** | **39 passed (39)** | `verification/gate3-evidence-fidelity.txt` |
| 4 | `bun x vitest run src/extensions/context/ --config vitest.config.ts` | **0** | **551 passed, 2 skipped (553)**, 29 files passed, 1 skipped | `verification/gate4-context-directory.txt` |
| 5 | `bun tsc -p tsconfig.dev.json --noEmit` | **2** (pre-existing) | **44 diagnostics, IDENTICAL to the entry baseline, 0 ACT-owned** | `verification/gate5-typecheck.txt` |
| 6 | `bun x vitest run --config vitest.red.adjudication-continuity-red01.config.ts` | **1** (EXPECTED) | **5 failed (5)** — the RED is preserved and isolated | `verification/gate6-red-preserved.txt` |
| 7 | `bunx biome check --diagnostic-level=error <both changed files>` | **0** | **clean** | `verification/gate7-biome.txt` |
| 8 | `CORE_LIVE_ADJUDICATION_PROBE=1 bun scripts/adjudication-output-contract.live-probe.ts` | **0** | **REAL_MODEL_RESPONSE: publishedValidCandidate = true**, `decision = narrowed`, `qualificationCodes = [manual_enforcement_only]` | `verification/gate8-live-model-probe.txt` |

## Test counts against the measured baseline

```text
CONTEXT DIRECTORY (prior measured baseline):  496 passed | 2 skipped (498)
CONTEXT DIRECTORY (after this ACT):            551 passed | 2 skipped (553)
DELTA:                                         +55 passed  (the new probe)
                                                  0 skipped added
                                                  0 tests weakened
                                                  0 tests deleted
```

The +55 is exactly the new probe's test count. No pre-existing test was
modified, skipped or deleted.

## Typecheck: identities, not counts

The baseline was captured at ENTRY (`97c2659c8`) and compared by
diagnostic IDENTITY (file, code, message), with the line/column stripped:

```text
bun tsc -p tsconfig.dev.json --noEmit | grep 'error TS' | sed 's/([0-9]*,[0-9]*)//' | sort
```

```text
diff /tmp/typecheck-baseline.txt /tmp/typecheck-after.txt
  -> NO DIFFERENCES
```

```text
TYPECHECK BASELINE: 44 diagnostics
ACT-OWNED DIAGNOSTICS: 0
DIAGNOSTIC IDENTITIES: identical before and after
```

The five `src/extensions/context/` diagnostics in the baseline
(`compaction.latency-span-lifecycle.red01.test.ts` x3,
`compaction.test.ts` x1, `compaction.working-context-ratio.test.ts` x1)
are PRE-EXISTING and are not owned by this ACT.

The probe initially introduced 16 diagnostics of its own (TypeScript does

## Conservation controls

| Control | Required | Observed |
|---|---|---|
| `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED` | `false` | `false` (asserted in the probe's G8 block) |
| `MAX_CARRIED_OUTCOMES` | `12` | `12` (asserted in the probe's G8 block) |
| `dropThinkingBlocks` for `agentic_summary` | `true` | `true` (asserted; the serialized conversation contains no `[Bot thinking]`) |
| Canonical history outside controlled fixtures | unchanged | unchanged — the probe only constructs synthetic histories |
| Task-contract behaviour | unchanged | unchanged — no production file was modified |
| Existing provider tool schemas | unchanged | unchanged — no production file was modified |
| Sidecar schema | unchanged | unchanged — no production file was modified |
| New default-on diagnostics | none | none — the probe adds no production diagnostic |
| Cross-session state | none | none — the probe is a single-file, single-process test |
| Additional model call in normal preparation | none | none — the live probe is a separate opt-in script (`CORE_LIVE_ADJUDICATION_PROBE=1`) |
| React updater semantics | unaffected | unaffected — no React file was touched |
| Stable-prefix behaviour in unmodified paths | unchanged | unchanged — no production file was modified |
| Previous RED | isolated and unchanged | isolated (still excluded from `vitest.config.ts`) and byte-identical to `d69cfb9be` |

```text
PRODUCTION DELTA vs ENTRY_HEAD: ZERO
```

Verified mechanically: the only paths this ACT adds are a `*.test.ts`
probe, a `scripts/` probe harness, and the `.factory/evidence/` package.
No `src/` production module was added, changed or removed.

## The RED is preserved, not weakened

```text
git diff --stat d69cfb9be -- \
  sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.red01.test.ts \
  sdk/packages/core/vitest.red.adjudication-continuity-red01.config.ts
  -> EMPTY (byte-identical)

bun x vitest run --config vitest.red.adjudication-continuity-red01.config.ts
  -> 5 failed (5)   EXIT=1   <- EXPECTED
```

The RED remains a live historical failure witness and is still excluded
from the default suite, so no intentionally failing test remains in the
default suite.

## No intentionally failing probe remains

The new probe file is named `*.probe01.test.ts` and is INCLUDED by the
default `vitest.config.ts` glob (`src/**/*.test.ts`), and it passes. The
only intentionally failing test in the repository is the predecessor's RED,
which is excluded by configuration.

not narrow a discriminated union through `expect(...).toBe(...)`). All 16
were removed by adding an explicit `rejectionReason(outcome)` narrowing
helper and by not passing out-of-enum literals through the typed override
parameters. The final typecheck is at the entry baseline.

## Full-suite regression check (beyond the ACT's required gates)

The ACT's required gates cover the context directory. As an additional
regression check, the FULL `@cline/core` unit suite was run at the FINAL
HEAD and at the ENTRY commit, in a temporary worktree, to prove that the
ACT introduced no regression outside the context directory.

```text
AT FINAL HEAD (2b4280d2e):
  Test Files  17 failed | 351 passed | 3 skipped (371)
  Tests      113 failed | 5658 passed | 162 skipped (5933)

AT ENTRY HEAD (97c2659c8), the SAME 17 files:
  Test Files  17 failed (17)
  Tests      113 failed | 188 passed | 16 skipped (317)
```

The failing file set and the failing test count are IDENTICAL at both
commits:

```text
src/extensions/composio/composio-tools-extension.test.ts
src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts
src/hooks/checkpoint-hooks.test.ts
src/hub/runtime-host/hub-runtime-host.test.ts
src/hub/server/boundary.test.ts
src/hub/server/cloud-session-service.test.ts
src/hub/server/fetch-wiring.test.ts
src/hub/server/hub-plugins.test.ts
src/hub/server/index.test.ts
src/hub/server/replay-wire.test.ts
src/hub/server/ui-events.test.ts
src/hub/settings.test.ts
src/runtime/command-policy/path-authority.temporary-external.test.ts
src/runtime/sandbox/macos/seatbelt-availability.test.ts
src/runtime/sandbox/sandbox-backend.test.ts
src/session/checkpoint-restore.test.ts
src/session/services/persistence-service.test.ts
```

**These 17 files / 113 tests are PRE-EXISTING failures at the entry
commit.** They are environment-dependent (hub server, sandbox/seatbelt,
macOS path authority, checkpoint restore, persistence service) and are
NOT owned by this ACT. The temporary baseline worktree was removed after
the comparison and the protected worktrees were left untouched.

The delta attributable to this ACT is therefore exactly:

```text
+55 passing tests (the new probe)
 0 new failures
 0 modified, skipped or deleted pre-existing tests
```

The same 5 typecheck diagnostics in `src/extensions/context/` are also
pre-existing at the entry commit and were left unchanged.
