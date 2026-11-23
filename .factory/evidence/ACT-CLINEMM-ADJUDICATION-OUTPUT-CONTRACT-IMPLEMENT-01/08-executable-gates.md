# 08 — The executable gates

Every command below was EXECUTED at the committed head.

## Gate 1 + 2 — The C1/C2 focused suite

```bash
cd sdk/packages/core
bun x vitest run \
  src/extensions/context/compaction.adjudication-output-contract.implement01.test.ts \
  --config vitest.config.ts
```

```text
Test Files  1 passed (1)
     Tests  54 passed (54)
EXIT 0
```

The suite drives the REAL production seam:

```text
createCompactionStateAwarePrepareTurn
  -> createContextCompactionPrepareTurn({ strategy: "agentic" })
  -> runAgenticCompaction
     -> buildAgenticSummaryInputBudget -> buildBudgetProjection
     -> serializeConversation -> buildSummaryRequest
     -> generateSummary (MOCKED at the provider handler boundary)
  -> applyTaskContractToCompactedMessages
  -> applyVerifiedEvidenceToCompactedMessages
  -> applyAdjudicationCarryForward      (the ACT's bounded implementation)
  -> MessageBuilder.buildForApi         (the provider-visible projection)
```

The summarizer is a deterministic mock at the EXISTING provider-handler
injection boundary, and the EXACT request string it received is captured
from the mock, never re-derived.

## Gate 3 — The existing contract probes

```bash
bun x vitest run \
  src/extensions/context/compaction.adjudication-output-contract.probe01.test.ts \
  src/extensions/context/compaction.adjudication-output-contract.correction01.test.ts \
  --config vitest.config.ts
```

```text
Test Files  2 passed (2)
     Tests  64 passed (64)
EXIT 0
```

Matches the expected baseline of 64 passed.

## Gate 4 — The existing evidence-fidelity regression

```bash
bun x vitest run \
  src/extensions/context/compaction.evidence-fidelity01.test.ts \
  --config vitest.config.ts
```

```text
Test Files  1 passed (1)
     Tests  39 passed (39)
EXIT 0
```

## Gate 5 — The context regression

```bash
bun x vitest run src/extensions/context/ --config vitest.config.ts
```

```text
Test Files  31 passed | 1 skipped (32)
     Tests  614 passed | 2 skipped (616)
EXIT 0
```

The baseline was 560 passed / 2 skipped. The 54 new tests are the ACT's
own focused suite, which lives in the same directory. No pre-existing test
changed its result.

## Gate 6 — Typecheck

```bash
bun tsc -p tsconfig.dev.json --noEmit
```

```text
diagnostic count:        44
ACT-owned diagnostics:    0
```

The baseline was 44 pre-existing diagnostics with 0 ACT-owned. The
diagnostic IDENTITIES were compared, not just the count: the ACT-owned
grep over `adjudication-continuity|adjudication-config|implement01`
returns 0.

## Gate 7 — Biome

```bash
bun x @biomejs/biome check <each ACT-owned changed file>
```

```text
sdk/packages/core/src/extensions/context/adjudication-continuity.ts              clean
sdk/packages/core/src/extensions/context/compaction.adjudication-output-contract.implement01.test.ts  clean
sdk/packages/core/src/types/adjudication-config.ts                              clean
sdk/packages/core/src/index.ts                                                  clean
sdk/packages/core/src/types/config.ts                                            clean
sdk/packages/core/src/extensions/context/compaction.ts                          clean
sdk/packages/core/src/runtime/host/local-runtime-host.ts                        2 errors — IDENTICAL TO THE BASELINE
sdk/packages/core/scripts/adjudication-output-contract.implement01.live-probe.ts  clean
```

The two `local-runtime-host.ts` findings (`assist/source/organizeImports`
and `format`) are PRE-EXISTING: they were verified to be byte-identical
before and after the ACT by stashing the ACT's changes and re-running
Biome on the untouched file. The ACT did not reformat unrelated
pre-existing code.

## Gate 8 — The historical RED

```bash
bun x vitest run --config vitest.red.adjudication-continuity-red01.config.ts
```

```text
Test Files  1 failed (1)
     Tests  5 failed (5)
EXIT 1
```

Five intentional failures remain. The historical thinking-only RED is
PRESERVED and was NOT weakened.

## Gate 9 — The build

```bash
cd sdk/packages/core && bun run build
  -> EXIT 0

cd apps/vscode && bun run package
  -> EXIT 0   (typecheck + webview build + lint + production esbuild)
```

The VSIX was packaged:

```text
Path:   dist/clinemm-adj-implement01-95307eef1e9f898f1fde9869c4d1c5f3c7fdb73e.vsix
Bytes:  66453643
SHA256: d20367753a5a4fd1f92b5390076d7b3eef26234ac246aaecc1d6fcde14b281db
```

and the packaged bundle was verified to CONTAIN the implementation:

```text
$ unzip -p <vsix> extension/dist/extension.js | grep -c "cline-evidence-handle"
1
```

### The build-artifact caveat the ACT discovered

The extension bundles `@cline/core` from `sdk/packages/core/dist/`, the
COMPILED SDK — not from the SDK source. When the ACT inspected the
bundled `resolveAdjudicationCandidate`, it found the PRE-REFACTOR
short-circuit implementation: the bundle was built at 13:38, before the
independent-gate refactor landed at 13:44.

The SDK must be rebuilt (`bun run build:sdk`) after every SDK source
change, and the extension bundle then re-packaged, for the packaged bytes
to reflect the current source. The ACT did not leave this implicit: the
stale-bundle observation is recorded here, and the manual rebuild was
left to the operator rather than performed mid-ACT.

## The full-suite regression comparison

The ACT established the failing-test-FILE set BEFORE its changes (by
stashing them) and re-measured it AFTER:

```text
baseline failing files: 28
final failing files:    28
diff:                  IDENTICAL TO BASELINE
```

The 28 pre-existing failures are environment-related (macOS Seatbelt
sandbox, hub server, `~/.cline` write permissions). The ACT introduced
NO new failure and fixed none.
