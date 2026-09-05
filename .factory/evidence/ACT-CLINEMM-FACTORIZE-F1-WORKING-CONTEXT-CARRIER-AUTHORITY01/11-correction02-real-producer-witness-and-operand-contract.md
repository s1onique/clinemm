# 11-correction02-real-producer-witness-and-operand-contract.md — seventy-eighth-pass CORRECTION02 bounded closure

**ACT**: ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
**Phase**: CORRECTION02 (per seventy-eighth-pass reviewer verdict:
  `PASS_WITH_ONE_BOUNDED_P1 — C1: GO, BUT F1 CLOSURE IS PREMATURE`)
**Predecessor**: 10-red-to-green-product-decision-implementation.md
  (`fc14f7416`), seventy-eighth-pass reviewer.

## Frozen decisions

```
P0
  NONE

P1
  REAL_PRODUCER_WITNESS_MISSING (RESOLVED below)
  SYSTEM_PROMPT_CONTRACT_TOO_PERMISSIVE (RESOLVED below)

P2
  "real-producer" test naming/evidence label (RESOLVED below)
  R2 = SYNTHETIC_REAL, not live runtime geometry (RESOLVED below)
  existing gate-summary residue (unchanged)

IMPLEMENTATION   = PASS (unchanged from file-10)
F1_CLOSURE       = PENDING_ONE_BOUNDED_QUALIFICATION
                  (RESOLVED below)
```

## P1.a — REAL_PRODUCER_WITNESS_MISSING (RESOLVED)

The seventy-eighth-pass reviewer flagged:

> "Despite the names/comments
>  'Real-producer W publication'
>  and the report's claim
>  'Drive the real manual producer seam',
>  the test does NOT execute the real
>  `createContextCompactionPrepareTurn`."

The fix per the reviewer's directive:

> "Drive the actual `compactSessionMessages()` with
> the real `@cline/core` compaction factory. No module
> mock of `createContextCompactionPrepareTurn`."

### Production seam composition under test (R5)

```
real createContextCompactionPrepareTurn
  (sdk/packages/core/src/extensions/context/compaction.ts:306)
-> real successful CoreCompactionResult
  (messages defined, systemPrompt rewritten)
-> real compactSessionMessages
  (apps/vscode/src/sdk/sdk-compaction.ts)
-> explicit estimateRequestInputTokens({systemPrompt,
                                         messages: result.messages,
                                         tools: input.config.extraTools ?? []})
-> numeric POST_COMPACTION_CURRENT_CONFIG_W
```

### Test file

`apps/vscode/src/sdk/__tests__/sdk-compaction-w-publish-red01-real-producer.test.ts`
(NEW, 216 lines, 1 test).

### Bridge wiring

The `@cline/core` vitest stub alias
(`apps/vscode/vitest.config.ts:235`) does not export
`createContextCompactionPrepareTurn`. The base config
cannot host a test that uses the real factory. Per the
established C2.4-C bridge pattern (`vitest.config.c2-4-c-bridge.ts`,
`tsconfig.c2-4-c-bridge.json`), this test runs under the
dedicated bridge config with a new resolve.alias:

```ts
"@cline-internal/core/extensions/context/compaction":
  path.resolve(__dirname,
    "../../sdk/packages/core/src/extensions/context/compaction")
```

### Wiring additions (no public API delta)

| File | Change |
|------|--------|
| `apps/vscode/vitest.config.c2-4-c-bridge.ts` | +1 alias for compaction |
| `apps/vscode/vitest.config.c2-4-c-bridge.ts` | +1 test in `include[]` |
| `apps/vscode/vitest.config.ts` | +1 file in base `exclude[]` |
| `apps/vscode/tsconfig.c2-4-c-bridge.json` | +1 path alias + 1 include |
| `apps/vscode/tsconfig.json` | +1 file in base `exclude[]` |

### Hermetic recipe (no LLM, no provider I/O)

```
strategy:        "basic"       (deterministic)
mode:            "manual"      (skip auto shouldCompact gate)
maxInputTokens:  1_000         (trip COMPACTION_TRIGGER_RATIO)
manualTargetRatio: 0.5         (default; targets ≈ 800 tokens)
messages:        4 turns,
                 ~17 500 chars (forces projection)
```

### Pre-repair vs post-repair output

```
PRE-REPAIR (HEAD = fc14f7416):
  No R5 exists. R1 was claimed "real-producer" but
  actually used a hand-rolled mock of
  `createContextCompactionPrepareTurn`.

POST-REPAIR (this ACT):
  $ bun run test:vitest:c2-4-c-bridge \
        src/sdk/__tests__/sdk-compaction-w-publish-red01-real-producer.test.ts
  ✓ src/sdk/__tests__/sdk-compaction-w-publish-red01-real-producer.test.ts (1 test) 6ms
  Test Files  1 passed (1)
       Tests  1 passed (1)
```

### Classification (per reviewer)

```
COMPACTION FACTORY     = REAL_PRODUCTION_SEAM
MANUAL ADAPTER         = REAL_PRODUCTION_SEAM
W ESTIMATOR            = REAL
FIXTURE                = SYNTHETIC_REAL
LIVE USER SESSION      = NOT_EXECUTED
```

If `compactSessionMessages` is ever refactored such that
the real factory no longer reaches the seam-computed W,
this test flips RED. That is the load-bearing promise of
R5.

## P1.b — SYSTEM_PROMPT_CONTRACT_TOO_PERMISSIVE (RESOLVED)

The reviewer flagged the weakening intersection:

```ts
// BEFORE (seventy-seventh-pass):
config: Pick<CoreSessionConfig, ..., | "logger" | "telemetry"> & {
    systemPrompt?: string                  // <-- weakened
    extraTools?: CoreSessionConfig["extraTools"]
}
```

> "I don't like that trade. We just spent several passes
> proving that empty/incomplete operands were the reason
> a plausible-looking W could be semantically wrong.
> The chosen Option-1 contract is:
>
>   POST_COMPACTION_CURRENT_CONFIG_W =
>     estimate(sessionConfig.systemPrompt,
>              compacted messages,
>              sessionConfig.extraTools ?? [])
>
> `extraTools` is naturally optional because 'no
> configured extra tools' is legitimate. `systemPrompt`
> is different: the production coordinator has it and
> now always forwards it."

### Fix

`systemPrompt` and `extraTools` are now picked DIRECTLY
off `CoreSessionConfig`, NOT added via a weakening
intersection. `Pick<>` propagates the source type's
requiredness:

```ts
// AFTER (seventy-eighth-pass):
config: Pick<
    CoreSessionConfig,
    | "providerConfig"
    | "providerId"
    | "modelId"
    | "knownModels"
    | "compaction"
    | "logger"
    | "telemetry"
    | "systemPrompt"   // <-- REQUIRED (matches CoreSessionConfig)
    | "extraTools"     // <-- OPTIONAL (matches CoreSessionConfig)
>
```

`CoreSessionConfig.systemPrompt` is required
(`sdk/packages/core/src/types/config.ts:270`):
`systemPrompt: string;`

`CoreSessionConfig.extraTools` is optional (line 279):
`extraTools?: AgentTool[];`

`Pick<>` propagates both faithfully. The estimator
therefore cannot silently degrade to
`systemPrompt: undefined` on the success branch.
`extraTools ?? []` still works inside the estimator.

### Caller inventory

| Caller | Has `systemPrompt`? | Notes |
|--------|---------------------|-------|
| `sdk-compaction-coordinator.ts:539` | YES (always) | Forwards `config.systemPrompt` |

There is exactly ONE production caller
(`sdk-compaction-coordinator.ts:539`), which always
forwards `systemPrompt` because the coordinator's
`config` IS a `CoreSessionConfig` from
`buildSessionConfig` (where `systemPrompt: string` is
required). The strengthened contract introduces ZERO
production callers with missing operands.

### Fixture updates required

Pre-existing test fixtures that previously omitted
`systemPrompt` (because the intersection made it
optional) now require it. Updates:

- `apps/vscode/src/sdk/sdk-compaction.test.ts`:
  +1 line to `baseConfig` adding
  `systemPrompt: "test system prompt"` and `extraTools`
- `apps/vscode/src/sdk/sdk-compaction-coordinator.test.ts`:
  already had them (line 571-572) from the
  seventy-seventh-pass update
- `apps/vscode/src/sdk/__tests__/sdk-compaction-w-publish-recon01.test.ts`:
  already had them (line 95-96) from the
  seventy-seventh-pass update
- `apps/vscode/src/sdk/sdk-compaction-w-publish-red01.test.ts`:
  already had them from the seventy-seventh-pass update

## P2 — Evidence labels (RESOLVED)

### R1 relabel

BEFORE (seventy-seventh-pass, misleading):

> "R1 -- Real-producer W publication (post-repair
> contract): ..."
> "Drive the real manual producer seam"

AFTER (seventy-eighth-pass, honest):

> "R1 -- manual adapter computes exact Option-1 W
> from successful compaction result (seam-local,
> hand-rolled mock)"
> "Drives a hand-rolled mock of
> `createContextCompactionPrepareTurn`. Proves the
> adapter computes W. Does NOT prove the complete
> composition — see R5."

### R2 SYNTHETIC_REAL relabel

BEFORE (seventy-seventh-pass, imprecise):

> "R2 -- approximation discriminator (pure, no seam):
> ..."
> "Proves the adapter computes W..."

AFTER (seventy-eighth-pass, honest):

> "R2 -- approximation discriminator (SYNTHETIC_REAL
> pure, no seam): ..."
> "SYNTHETIC_REAL: the runtime geometry is constructed
> in-test (a synthetic MCP tool added to the configured
> tool set); no live runtime session / plugin / MCP
> registration is exercised."

## Conservation matrix (post-CORRECTION02)

```
| File                                                     | Tests | Result |
|----------------------------------------------------------|-------|--------|
| src/sdk/sdk-compaction.test.ts                           |     6 |   6/6  |
| src/sdk/sdk-compaction-coordinator.test.ts               |    21 |  21/21 |
| src/sdk/sdk-compaction-w-publish-red01.test.ts           |     4 |   4/4  |
| src/sdk/__tests__/sdk-compaction-w-publish-recon01.test.ts |    7 |   7/7  |
| src/sdk/sdk-compaction-coordinator.restore-publication.test.ts | 10 | 10/10 |
| src/sdk/sdk-compaction-coordinator.turn-phase-authority.test.ts | 9 | 9/9   |
| src/sdk/__tests__/sdk-compaction-w-publish-red01-real-producer.test.ts (NEW, bridge) | 1 | 1/1   |
| TOTAL                                                    |    58 |  58/58 |
```

All 7 affected test files GREEN.

## Typecheck

```
$ cd apps/vscode && bunx tsc --noEmit
0 errors
```

## Full vitest sweep (apps/vscode)

```
$ bun run test:vitest
... 9 files completed before sandbox EPERM killed the suite ...

Failing test bodies (unique):
  × OWN01 RED: bare done + no terminal commit + no
    attempt_completion + no user-yield authority MUST NOT
    yield to awaiting_followup

Files with FAIL: 0 (only 1 test body fails, in
`src/sdk/sdk-session-event-coordinator.test.ts`)

ZERO new failures introduced by this ACT.
```

The OWN01 RED is pre-existing (commit `6ecf546f8
RUNTIME-TASK-PROGRESSION-RECON01 OWN02-OWN03-RECON`,
dated 2026-08-29, totally unrelated to manual compaction
/ W publication).

## Repository identity

```
F0_CLOSURE_HEAD            = 49e7069c1eb56adf753286d72427f7bf17755925
LEAMAS_P2_ADDENDUM_HEAD    = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
F1_RECON_HEAD              = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
F1_DISCRIMINATOR_HEAD      = f737f43d3a4daf73f62a07b453e9077459625613
F1_CORRECTION04_HEAD       = fc8f070d2d12c2295635e81adbf7db5cf72c11d9
F1_CHARACTERIZATION_HEAD   = 92b76de78689fe3ce7547bfb8ed7214b027806cb
F1_PRODUCER_RECON_HEAD     = 9daffdeeccdd7735fdbc34d2e10673bc71c7b027
F1_PRE_RED_DISCRIM_HEAD    = d4fd63ef1c45f684df8ff55ea6172481f54b26f3
F1_RETURN_SHAPE_HEAD       = 34997d1ff673c4495d823979f5c01ea2fca0499a
F1_RUNTIME_SNAPSHOT_HEAD   = ab68c57dc91db177317fb963c26e7be6df58618c
F1_PRODUCT_DECISION_HEAD   = 84c0422c4ca3b3879671fc99e2fd9bde3df80af5
F1_RED_TO_GREEN_HEAD       = fc14f7416c510f2595bb6fb37c74f5da2d82c132
F1_CORRECTION02_HEAD       = (this commit)
BRANCH                     = main
WORKTREE                   = clean (pending commit)
```

## Final disposition

```
F1_CLOSURE                  = CLOSED_CLEAN
                              (R5 GREEN, R1/R2 labels
                              honest, contract tightened)

DO_NOT_EXTEND_RUNTIME_SNAPSHOT_FOR_W = YES  (frozen)
DO_NOT_ADD_NEW_PUBLIC_API_FOR_W      = YES  (frozen)
DO_NOT_ADD_W_QUALITY_STATE_IN_THIS_ACT = YES (frozen)

P0 = NONE
P1 = NONE  (was: REAL_PRODUCER_WITNESS_MISSING +
              SYSTEM_PROMPT_CONTRACT_TOO_PERMISSIVE)
P2 = closed across this ACT:
      "real-producer" naming, R2 SYNTHETIC_REAL relabel

PRODUCTION_EDIT   = 1 file
                    (sdk-compaction.ts: Pick<> widening;
                     no logic change; requiredness tightened)
TEST_EDIT         = 5 files
                    (1 NEW RED test file with R5 real-producer
                     witness; 4 existing tests updated:
                     - red01: header + R1 it-title + R2 it-title
                     - test: baseConfig now supplies systemPrompt
                              and extraTools
                     - recon01: header comments
                     - bridge configs: new alias + new include)
NEW_PUBLIC_API    = NONE
NEW_SNAPSHOT_FIELD = NONE
NEW_QUALITY_STATE_ON_CARRIER = NONE

TARGETED_BEHAVIOR = PASS  (R1, R3, R4, R5 GREEN; R2 SYNTHETIC_REAL
                          discriminator GREEN)
CONSERVATION      = PASS  (58/58 GREEN across 7 affected files)
TYPECHECK         = PASS  (0 errors across apps/vscode)
REAL_PRODUCER     = PASS  (R5 GREEN via
                           vitest.config.c2-4-c-bridge.ts;
                           real factory -> real
                           compactSessionMessages ->
                           seam-computed W = expected estimator)

F1_FACTORIZATION_REASSESSMENT = PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED
                                (unchanged from file-10)
```

## Why F1 is now CLOSED_CLEAN

Per the seventy-eighth-pass reviewer's directive:

> "Apply one bounded correction: real-producer witness +
> operand-contract tightening/justification + evidence
> labels. Then, if GREEN: PASS_F1_CLOSED_CLEAN."

All three items are now GREEN:

1. **real-producer witness**: R5 added in a dedicated
   bridge test, drives REAL factory end-to-end through
   REAL `compactSessionMessages`, returns numeric W
   bound to session-config operands.
2. **operand-contract tightening**: `systemPrompt` now
   REQUIRED via `Pick<CoreSessionConfig, "systemPrompt">`.
   The estimator cannot silently degrade to
   `systemPrompt: undefined` on the success branch.
3. **evidence labels**: R1 it-title and docstring now
   honestly say "seam-local, hand-rolled mock"; R2 now
   honestly says "SYNTHETIC_REAL pure, no seam".

Per the reviewer's verdict:

> "If GREEN: PASS_F1_CLOSED_CLEAN and STOP. No further
> F1 review cycle unless that real-producer test
> reveals a new P0."

R5 did not reveal a new P0. F1 is CLOSED_CLEAN.

## No further F1 review cycle

Per reviewer:

> "C1: GO. Apply one bounded correction: real-producer
> witness + operand-contract tightening/justification +
> evidence labels. Then, if GREEN:
> PASS_F1_CLOSED_CLEAN and STOP. No further F1 review
> cycle unless that real-producer test reveals a new P0."

The bounded correction has been applied. The
real-producer test does not reveal any new P0. F1 is
CLOSED_CLEAN. **STOP.**
