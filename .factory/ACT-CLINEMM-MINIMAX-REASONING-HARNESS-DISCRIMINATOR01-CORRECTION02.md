# ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01-CORRECTION02

## Identity

```text
ACT              = ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01-CORRECTION02
PRIOR_ACT        = ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01-CORRECTION01
ORIG_VERDICT     = HALT_FALSE_EXPLICIT_NONE_PROVENANCE
                  (P0, OPEN — a new P0 discovered after the authorized correction)
NEW_VERDICT      = PASS_STRUCTURAL_ONLY
```

## Mission

Apply the **one-line** bounded correction the Factory runtime reviewer returned
for the CORRECTION01 subject: stop classifying an **absent** persisted effort
as an **explicit** `None` selection, and add a RED→GREEN witness that
traverses the **actual** persisted-settings conversion and the handler-factory
boundary — the seam the defect actually lives on.

This is a **new P0 discovered after the authorized correction**, so it
qualifies for the Factory exception to the one-cycle rule. No broad redesign
and no additional review round are warranted.

## The P0 — `HALT_FALSE_EXPLICIT_NONE_PROVENANCE`

### What the reviewer established

CORRECTION01 closes the original P0 for genuinely explicit `None` selections,
and the UTF-8 byte-count repair is sound. The committed diff revealed one new
P0 in the persisted-settings path — a correctness defect, not documentary
residue.

In `sdk/packages/core/src/services/llms/provider-settings.ts`:

```ts
const unifiedReasoningLevel = settings.reasoning?.effort || "none";
const reasoningNoneSelected = unifiedReasoningLevel === "none";
```

`unifiedReasoningLevel` **defaults** to `"none"` when no effort is persisted,
so the second expression cannot distinguish a user-selected `none` from a
**missing** effort.

| Persisted settings                      | Expected explicit `None` | Actual |
| --------------------------------------- | ------------------------ | ------ |
| `{ enabled: false, effort: "none" }`    | `true`                   | `true` |
| `{ enabled: false }`                    | `false`                  | `true` |
| `{ enabled: false, effort: undefined }` | `false`                  | `true` |

This false identity propagates through `handler-factory.ts`, which assigns
`disableReason: "none"` when `thinking === false`. The gateway then rejects the
request with `UnsupportedReasoningConfigurationError`, even though the user
did **not** explicitly select `None`.

That violates the correction's **conservation contract**: an anonymous disable
must preserve the model's default behavior. MiniMax confirms that M3.1-Flash
requires reasoning and does not support disabling it.

### Why the existing witnesses missed it

The D2c anonymous-disable witness constructs the model handle **directly** with
`disableReason: "unknown"`. That **bypasses** the real `toProviderConfig()`
mapping that introduces the false `none` identity, so it could not observe the
defect.

## The bounded correction

One expression changes:

```diff
- const reasoningNoneSelected = unifiedReasoningLevel === "none";
+ const reasoningNoneSelected = settings.reasoning?.effort === "none";
```

The flag is now derived from the **PERSISTED** effort — the only evidence of an
explicit user selection — instead of from a normalized default. The
`unifiedReasoningLevel` variable remains in use for `reasoningEffort`, whose
semantics are unchanged.

## The RED→GREEN witness

New file:
`sdk/packages/core/src/services/llms/minimax-persisted-reasoning-none-provenance01.test.ts`

It traverses the **real** chain — no mocks of `@cline/llms`:

```text
persisted settings
  -> toProviderConfig()            (sdk/packages/core, source)
  -> createAgentModelFromConfig()  (sdk/packages/core, source)
  -> gateway stream()               (@cline/llms, real production boundary)
```

and asserts **both** directions:

| Witness | Assertion |
| ------- | --------- |
| `DERIVES the explicit-None flag from the PERSISTED effort, not from a default` | `{ enabled: false }` → `false`; `{ enabled: false, effort: undefined }` → `false`; `{ enabled: false, effort: "none" }` → `true` |
| `PRESERVES the model default for an ANONYMOUS disable (M3.1 mandates reasoning)` | the anonymous disable is **NOT** rejected at the real gateway — the model keeps its own default |
| `REJECTS an EXPLICIT persisted None on a model that mandates reasoning` | the explicit persisted `None` **IS** rejected with the typed `UnsupportedReasoningConfigurationError` |
| `CONSERVES M3's valid disabled-thinking mode for both anonymous and explicit disables` | M3's supported disabled-thinking mode is preserved in **both** cases |


### RED (against `c23de04ef`, the reviewed HEAD)

```text
× DERIVES the explicit-None flag from the PERSISTED effort, not from a default 4ms
× PRESERVES the model default for an ANONYMOUS disable (M3.1 mandates reasoning) 78ms
✓ REJECTS an EXPLICIT persisted `None` on a model that mandates reasoning 1ms
✓ CONSERVES M3's valid disabled-thinking mode for both anonymous and explicit disables 17ms

Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
```

The RED failure is the reviewer's false-positive provenance, reproduced
verbatim at the real production boundary:

```text
UnsupportedReasoningConfigurationError: Model "minimax-m3.1-flash" requires
reasoning and does not support disabling it. ...
 ❯ src/services/llms/minimax-persisted-reasoning-none-provenance01.test.ts:140:30
```

and the identity failure:

```text
AssertionError: expected true to be false // Object.is equality
- Expected
+ Received
- false
+ true
```

### GREEN (after the one-line correction)

```text
✓ src/services/llms/minimax-persisted-reasoning-none-provenance01.test.ts (4 tests) 107ms

Test Files  6 passed (6)
      Tests  79 passed (79)
```

### Mutation control (the witness is discriminating, not vacuously passing)

Reverting **only** the one corrected expression reproduces exactly the same
**2 RED** failures while the **2 control** assertions stay green:

```text
× DERIVES the explicit-None flag from the PERSISTED effort, not from a default 4ms
× PRESERVES the model default for an ANONYMOUS disable (M3.1 mandates reasoning) 78ms
✓ REJECTS an EXPLICIT persisted `None` on a model that mandates reasoning 1ms
✓ CONSERVES M3's valid disabled-thinking mode for both anonymous and explicit disables 17ms

Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
```

## Gates

| Gate | Result |
| ---- | ------ |
| New witness (`sdk/packages/core`) | **4/4 GREEN**; **2/4 RED** at the reviewed HEAD and under the mutation control |
| `sdk/packages/core` — `src/services/llms/` | **6 files / 79 passed / 0 failed** |
| `sdk/packages/llms` — the focused MiniMax + gateway suites | **7 files / 222 passed / 0 failed** (including the 9 unchanged D2c conservation witnesses) |
| `sdk/packages/llms` — **full package** | **47 files / 778 passed / 4 skipped / 0 failed** — **identical** to the CORRECTION01 baseline (778 passed) |
| `apps/vscode` — `cline-session-factory.test.ts` (app stale-`None` witnesses) | **78 passed / 0 failed** |
| `sdk/packages/core` typecheck | diagnostic set **IDENTICAL** to the stashed baseline (13 files / 29 pre-existing diagnostics, **0 added, 0 removed**, **0** in `services/llms`) |
| `apps/vscode` typecheck | **PASS** (exit 0) |
| SDK build (`bun run build:sdk`) | **PASS** |
| Biome lint + format | **PASS** on both touched files |

## Preservation

- The `unifiedReasoningLevel` default is **retained** for `reasoningEffort`; only
  the explicit-`None` flag's provenance changed.
- The typed `UnsupportedReasoningConfigurationError` contract is **unchanged**:
  a genuinely explicit persisted `None` is still rejected on a model that
  mandates reasoning.
- M3's valid disabled-thinking mode is preserved for **both** anonymous and
  explicit disables.
- M3.1's low/max wire configurations, the UTF-8 byte accounting, the live wire
  probe, the H03–H06 lanes and the MYC lane are all **untouched**.
- No live wire probe was re-run: the reviewer confirmed the four reported
  probes as valid live descriptive evidence, and this correction changes only
  the **persisted-settings provenance**, not the wire format.

## Verdict

`PASS_STRUCTURAL_ONLY` — the P0 `HALT_FALSE_EXPLICIT_NONE_PROVENANCE` is
corrected with a one-line change and witnessed RED→GREEN at the real
production boundary, and the conservation contract is unchanged.

**Next bounded step:** exact-head VSIX packaging against the committed
subject, then the deferred Step 6 editing fixture. H03–H06 and MYC remain
untouched.
