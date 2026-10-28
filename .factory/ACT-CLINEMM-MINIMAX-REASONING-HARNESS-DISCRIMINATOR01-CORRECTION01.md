# ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01-CORRECTION01

## Identity

```text
ACT              = ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01-CORRECTION01
PRIOR_ACT        = ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01
ORIG_VERDICT     = C1 — GO, with one bounded telemetry correction
                  (HALT_UNSUPPORTED_REASONING_OFF_CONTRACT = P0, OPEN)
NEW_VERDICT      = PASS_STRUCTURAL_ONLY
```

## Mission

Apply the bounded correction the Factory runtime reviewer returned for the
MiniMax reasoning repair: close the **P0**
`HALT_UNSUPPORTED_REASONING_OFF_CONTRACT` and the **P1** byte-accounting
defect, without re-running the live wire probes (the reviewer confirmed them
as valid live descriptive evidence) and without touching the deferred
full M3/M3.1 editing fixture (Step 6) or the H03–H06 / MYC lanes.

## The P0 — `HALT_UNSUPPORTED_REASONING_OFF_CONTRACT`

### What the reviewer established

The reported repair establishes a credible, well-isolated root cause:
uncatalogued M3.1 models lost their reasoning capabilities and controls
during model resolution, so the requested effort disappeared before
transport. The chosen repair is architecturally sound: provider-declared
metadata fills the catalog gap without a MiniMax-specific branch in the
generic registry. The reviewer independently confirmed the wire contract
against MiniMax's official API documentation — M3.1-Flash always reasons,
thinking cannot be disabled, the supported efforts are
`low`/`medium`/`high`/`xhigh`/`max`, the Anthropic-compatible transport uses
`output_config.effort`, and omitting effort defaults to `max`.

### The defect

The D2 witnesses established that the UI **can** select `None` for M3.1 and
that the session **can** translate it to `thinking: false`. But the
normalization boundary handled the unsupported disablement by returning:

```ts
{ ...request, reasoning: undefined }
```

The request then proceeded using the model's **mandatory reasoning default**.
That is a valid wire configuration, but the user's explicit `None` selection
had been **silently discarded**. This contradicts the reported claim that no
reasoning policy is silently changed.

### The bounded correction

The reviewer required the unsupported disablement to become **explicit at the
production boundary** — either by preventing the invalid selection or by
returning a **visible, typed unsupported-configuration result** — and required
a **persisted stale `None`** to be handled as well, while preserving M3's
valid disabled mode and M3.1's working effort routes.

This ACT takes the **typed unsupported-configuration result** route, and
implements it at the **gateway's `stream()`** — the production boundary, the
last point at which both the resolved model's advertised controls and the
caller's request are known, and the point **before** the provider is created
and before any transport happens.

#### 1. A typed error

`sdk/packages/llms/src/providers/errors.ts` gains
`UnsupportedReasoningConfigurationError` (plus the
`isUnsupportedReasoningConfigurationError` guard and the
`UnsupportedReasoningConfigurationDetails` shape). It carries
`providerId`, `modelId`, the supported `efforts`, and `supportsToggle`, and
its message names the supported alternatives so the user can act. It is
exported from `@cline/llms`.

#### 2. A "model mandates reasoning" fact

`sdk/packages/llms/src/providers/model-facts.ts` gains
`modelMandatesReasoning(model)`. A model **mandates** reasoning when it
advertises reasoning controls AND offers no "off" affordance — no `toggle`
option and no `"none"` value among its advertised efforts.

A model whose controls are **unknown** (`options === undefined` — an
uncatalogued model the provider does not declare) or **explicitly empty**
(`options.length === 0` — a reasoning model with no advertised user-facing
control) does **not** mandate reasoning. Treating an unknown model as
mandatory would reject requests for every model the catalog has not
published yet, so the rule is deliberately scoped to *known* controls.

#### 3. Distinguishing an explicit `None` from a derived disable

`thinking: false` alone cannot say whether the disable was an explicit user
`None` selection or a derived disable. The distinction is carried explicitly
end-to-end:

| Layer | Mechanism |
| --- | --- |
| `GatewayStreamRequest.reasoning` | new `disableReason?: "none" \| "unknown"` |
| `GatewayModelHandleOptions.reasoning` | new `disableReason?: "none" \| "unknown"` (the model handle's DEFAULT reasoning) |
| `ReasoningConfig` (`@cline/llms`) | new `reasoningNoneSelected?: boolean` |
| `toProviderConfig` | sets `reasoningNoneSelected` from the persisted `effort === "none"` |
| `handler-factory.ts` | forwards the persisted selection as the handle's default `reasoning: { enabled: false, disableReason }` |
| `GatewayModelAdapter.stream()` | recovers the reason from the raw caller options **or** the handle default, and attaches it to the merged request |
| `cline-session-factory.ts` | the stale-field cleanup **keeps** an explicit `none` marker |

A disable **without** an explicit user selection keeps the pre-existing
behavior exactly: the model applies its own default. This is what makes the
correction bounded — only the explicit-`None` case changes.

#### 4. The stale persisted `None`

The persisted `None` was being **erased** by the app layer's stale-field
cleanup: `hasStaleDisabledReasoningFields` fires for
`{ enabled: false, effort: <anything> }` and rewrote the persisted settings
to `{ enabled: false }`. That cleanup exists to stop a disabled state from
carrying an **active** effort — but `none` is not an active effort; it is the
**record of an explicit user selection**, and it is the only thing that
distinguishes "the user chose None" from "reasoning was disabled for some
other reason". The cleanup now keeps `effort: "none"` and still drops an
active effort.

With the marker preserved, a stale persisted `None` reaches the production
boundary as an **explicit** selection and is rejected with the typed error
instead of being silently replaced by the model's mandatory default.

#### 5. The boundary check

`DefaultGateway.stream()` rejects the request when all three hold:

1. `request.reasoning?.enabled === false`,
2. `request.reasoning.disableReason === "none"`, and
3. `modelMandatesReasoning(resolved.model)`.

The request never reaches the provider.

### Conservation — what the correction does NOT change

- **M3's valid disabled-thinking mode is preserved.** M3 advertises a
  thinking toggle, so `controls.supportsOff` is true, M3 does not mandate
  reasoning, and an explicit `None` on M3 is **not** rejected.
- **A derived disable keeps the model's own default.** The pre-existing
  behavior for a disable with no explicit user selection is unchanged.
- **An uncatalogued model with unknown controls is not rejected.** The
  mandate rule is scoped to known controls.
- **M3.1's working effort routes are untouched.** The effort normalization,
  the provider-declared `modelReasoningOptions`, the registry's unregistered
  model resolution, the `minimax-thinking` provider-option encoding, and the
  OpenRouter effort encoding are all unchanged by this correction.
- No provider-specific branch was added to the generic registry. The
  mandate rule is expressed in terms of **advertised controls**, not model
  identity.

## The P1 — `reasoningContentBytes` counted UTF-16 code units

`summarizeReasoningContent()` in `sdk/packages/agents/src/agent-runtime.ts`
used `part.text?.length`, which counts **UTF-16 code units**, while the
field is named `reasoningContentBytes`. For non-ASCII reasoning content the
recorded size disagreed with the provider-request capture's `payloadBytes`
(which is already UTF-8): a CJK character is one code unit but three UTF-8
bytes.

**Correction:** the count is measured with `TextEncoder`, which is the
platform-neutral way to measure UTF-8 bytes in both Node and the browser.
Only the byte COUNT is recorded — no reasoning text is retained — so the
observation's privacy property is unchanged.

**The reviewer asked for this to be fixed once, with a non-ASCII witness.**
The witness is the new D4c test: `"思考"` is two UTF-16 code units but six
UTF-8 bytes.

## Evidence

### RED → GREEN — the P0 contract

`sdk/packages/llms/src/providers/routing/minimax-unsupported-reasoning-off01.test.ts`
— **NEW, 9/9 GREEN**. With the boundary enforcement disabled (the
`disableReason === "none"` guard replaced by `false`), exactly the three
witnesses that pin the new contract fail and the six conservation witnesses
stay green:

| Witness | Without the correction | With the correction |
| --- | --- | --- |
| D2c explicit `None` on M3.1 is REJECTED with a typed error | **RED** | GREEN |
| D2c the typed error names the model and the supported alternatives | **RED** | GREEN |
| D2c a STALE PERSISTED `None` reaches the boundary as an explicit `None` | **RED** | GREEN |
| D2c M3.1 MANDATES reasoning (no off affordance) | GREEN | GREEN |
| D2c a disable WITHOUT an explicit `None` keeps the model's own default | GREEN | GREEN |
| D2c M3's VALID disabled-thinking mode is preserved | GREEN | GREEN |
| D2c a stale persisted DISABLE without a `None` is not rejected | GREEN | GREEN |
| D2c a model with UNKNOWN controls is not treated as mandating reasoning | GREEN | GREEN |
| D2c the provider-declared M3.1 controls are what make it mandating | GREEN | GREEN |

### RED → GREEN — the app-layer stale-`None` preservation

`apps/vscode/src/sdk/__tests__/minimax-reasoning-capability01.test.ts` —
**5/5 GREEN**. With the cleanup reverted to `{ enabled: false }`, exactly
the D2c "KEEPS an explicit `None` selection" witness fails; the
"still drops an ACTIVE effort" witness stays green.

### RED → GREEN — the P1 byte accounting

`sdk/packages/agents/src/agent-runtime.minimax-reasoning-trace01.test.ts` —
**4/4 GREEN**. With `part.text?.length` restored, exactly the new D4c
non-ASCII witness fails (`reasoningContentBytes` was 2, not 6); the ASCII D4
witness, the D4b absence witness, and the D5 continuity witness stay green.

### Focused gates

- `sdk/packages/llms` — **47 test files passed, 778 passed, 4 skipped, 0 failed**.
- `sdk/packages/agents` — **16 failed files | 14 passed**; the 16 failures
  are the **pre-existing** zod interop failures (identical set before and
  after this ACT — measured by `git stash` + re-run). Tests went
  **214 → 218** (the four new witnesses), **0 regressions**.
- `sdk/packages/core` — the **directly-affected conservation sweep** (the
  11 suites that exercise `toProviderConfig`, `handler-factory`, the
  runtime bootstrap, the provider service, and the provider-settings
  manager/migration): **230 total / 230 passed / 0 failed** — measured
  against a stashed baseline of this ACT's own core production paths, the
  failure sets are **IDENTICAL** (0 added, 0 removed). The full
  `sdk/packages/core` suite was also attempted; it **hung** in this
  environment (the log froze with no JSON report), so the focused sweep is
  the reported measurement and the full-suite run is recorded as
  **environment-limited, not passing**.
- `apps/vscode` — the MiniMax reasoning suite **5/5 GREEN**. The full
  package was measured against a **stashed baseline of this ACT's own
  production paths** (the test files were kept, the production files were
  reverted) and compared **BY TEST ID**, never by grep and never from a
  truncated log:

  | | total | passed | failed | pending | suites |
  | --- | --- | --- | --- | --- | --- |
  | baseline | 5,183 | 4,933 | 195 | 55 | 1,825 |
  | after | 5,183 | 4,935 | 193 | 55 | 1,825 |

  ```text
  ADDED failures (regressions): 0
  REMOVED failures (fixed):     2
  IDENTICAL SETS:                False
  ```

  The two removed failures are exactly this ACT's new D2c app witnesses
  (`the stale-field cleanup KEEPS an explicit None selection` and
  `the stale-field cleanup still drops an ACTIVE effort`) — RED at the
  baseline because the production fix was reverted, GREEN after. Two
  independent runs of the **same** tree produced **IDENTICAL** failure sets
  (0 added, 0 removed), so the measurement is deterministic rather than a
  one-off sample.
- SDK build — **PASS** (`bun run build:sdk`).
- `apps/vscode` typecheck — **PASS** (`bun x tsc --noEmit`, exit 0, zero
  diagnostics).
- `@cline/shared`, `@cline/agents`, `@cline/llms` typecheck — **PASS**
  (exit 0, zero diagnostics).
- `@cline/core` typecheck — **pre-existing and FLAKY at baseline; not
  attributable to this ACT.** Two runs of the **SAME baseline tree**
  produced **156** and **157** diagnostics, and the difference was a
  shuffling of diagnostics in files this ACT never touches
  (`command-execution-plan.test.ts`, `parser-helper/runtime.real-binary.test.ts`,
  `parser-provenance.test.ts`, `path-authority.temporary-external.test.ts`,
  `bash.supervised.bash-startup-env.test.ts`,
  `session-runtime.model-behavior-trace.test.ts`). The measurement that
  matters is the one this ACT can be held to: **zero diagnostics in any
  file this ACT touched** (`provider-settings.ts`, `handler-factory.ts`).
- Biome lint + format — **PASS** on every file this ACT touched (zero
  findings). The one remaining `sdk/packages/llms` biome finding
  (`providers/billing.test.ts` formatting) is **pre-existing** — it is
  present at the baseline (134 files → 1 error) and unchanged by this ACT
  (136 files → the same 1 error).

## The environment limitation is recorded, not masked

**The live wire probes were NOT re-run.** The reviewer confirmed the four
reported live wire probes as valid live descriptive evidence, and stated
there is no need to repeat them merely because the unsupported-off contract
needs correction. This ACT is therefore **`PASS_STRUCTURAL_ONLY`**, NOT
`PASS_LIVE`.

**No VSIX was built or installed.** The exact-head packaging and the
deferred full M3/M3.1 editing fixture (Step 6) remain the next bounded
step, unchanged by this ACT.

**The pre-existing zod/Vitest interop failure is preserved as classified.**
Vitest in this repository loses zod v4's named `z` export (only the CJS
`default` is exposed), so every test importing `import { z } from "zod"`
fails with `z.enum is not a function`. This is a **repo-wide** defect that
reproduces with all of this ACT's paths stashed. Per the reviewer's
instruction, the classification is preserved and no infrastructure cleanup
was initiated. The local verification runs used a **scoped, uncommitted**
vitest config (`ssr: { noExternal: ["zod"] }`) which makes Vitest inline
zod's ESM build; that config was **removed** before the commit and is not
part of this ACT.

**The sandbox `EPERM` artifact is recorded, not masked.** The default
forks pool aborts with `kill EPERM` in this environment and the Bun runtime
aborts before the JSON report is written, so the full-suite measurements
were taken with the nix-store Node runtime (v24.19.0) and `--pool=threads`.

## Production changes

- `sdk/packages/llms/src/providers/errors.ts` — the typed
  `UnsupportedReasoningConfigurationError` and its guard.
- `sdk/packages/llms/src/providers/model-facts.ts` — `modelMandatesReasoning`.
- `sdk/packages/llms/src/providers/gateway.ts` — the production-boundary
  check, the `disableReason` merge/normalization, and the handle-default
  consultation.
- `sdk/packages/llms/src/providers/config.ts` — `ReasoningConfig.reasoningNoneSelected`.
- `sdk/packages/llms/src/providers.ts`, `sdk/packages/llms/src/index.ts` —
  the new error's exports.
- `sdk/packages/shared/src/llms/gateway.ts` — `disableReason` on
  `GatewayStreamRequest.reasoning` and `GatewayModelHandleOptions.reasoning`.
- `sdk/packages/core/src/services/llms/provider-settings.ts` —
  `toProviderConfig` sets `reasoningNoneSelected` from the persisted `none`.
- `sdk/packages/core/src/services/llms/handler-factory.ts` — forwards the
  persisted selection as the model handle's default reasoning.
- `apps/vscode/src/sdk/cline-session-factory.ts` — the stale-field cleanup
  keeps an explicit `None` marker.
- `sdk/packages/agents/src/agent-runtime.ts` — the P1 UTF-8 byte count.

No Elm kernel, no protocol, no webview reducer, no schema, no provider
registry branch, no model catalog change.

## Next bounded step

1. Exact-head packaging (VSIX) bound to a **committed** subject — the
   reviewer's "artifact identity" finding: the digest was dirty (19 changed
   files, 3 untracked), so it must be bound to a committed subject before
   final closure. `.factory/gate-summary.json` reports `EVIDENCE_INVALID`
   and must **not** be used as a successful executable gate.
2. The previously deferred full M3/M3.1 editing fixture (Step 6) with
   request correlation and retained-workspace evidence.
3. H03–H06 and the MYC lane are unchanged.

No additional review loop is needed after the exact-head packaging unless
new P0 evidence emerges.
