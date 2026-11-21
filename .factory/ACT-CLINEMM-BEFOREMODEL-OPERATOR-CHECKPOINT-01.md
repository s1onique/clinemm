# ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01

**Type:** Implementation
**Scope:** ClineMM settings UI, host configuration/persistence, existing `beforeModel` hook
composition, tests, VSIX packaging.
**Default:** OFF. No model-visible or execution-semantic change when disabled.

## A. Confirmed production seam

The seam was inspected before editing, and it is exactly the one the ACT names:

```
FeatureSettingsSection → UpdateSettingsRequest → StateManager → SdkSessionConfigBuilder
  → buildAgentHooks → beforeModel → final request budget check → provider dispatch
```

* `apps/vscode/src/sdk/hooks-adapter.ts` — `buildAgentHooks` already installs a `beforeModel`
  hook that injects the MYC prime on the FIRST model request of a run (iteration gate +
  per-session dedupe map + live diagnostics).
* `apps/vscode/src/sdk/sdk-session-config-builder.ts` — calls `buildAgentHooks(...)` **once per
  session build**, which is the natural freeze point for a per-session configuration.
* `sdk/packages/agents/src/agent-runtime.ts` —
  * `prepareModelRequest` runs every `beforeModel` hook and then applies the FINAL request
    budget guard (`assertProviderRequestWithinBudget`) at lines ~2894-2901.
  * The runtime emits `turn-finished` with `toolCallCount: toolCalls.length` at line ~2094 —
    **after** the assistant turn's tool results have been delivered — and with
    `toolCallCount: 0` for every turn that produced no tool call.
  * `AgentRuntimeHooks.onEvent` receives EVERY runtime event, so the hook bag can observe
    `turn-finished` without a new hook framework.

The MYC prime body was **extracted verbatim** into a `runPrimeBeforeModel` closure so the
checkpoint can compose with it. The extraction was verified mechanically: the normalized
(comment-stripped, whitespace-collapsed) prime body is **byte-identical** to the pre-ACT body
(4716 == 4716 characters, `EQUAL: True`).

## B. Settings contract

New persisted settings (`apps/vscode/src/shared/storage/state-keys.ts`, `USER_SETTINGS_FIELDS`):

| Key | Type | Default |
|---|---|---|
| `beforeModelCheckpointEnabled` | `boolean` | `false` |
| `beforeModelCheckpointText` | `string` | `""` |
| `beforeModelCheckpointInterval` | `number` | `4` |

The shared contract lives in `apps/vscode/src/shared/storage/beforeModelCheckpoint.ts` and is the
single source of truth for the defaults, the validation rules and the effective-configuration
resolver. It has no VS Code / SDK imports, so the host and the webview consume it without a cycle.

**Effective configuration** (`resolveEffectiveBeforeModelCheckpoint`) requires ALL of:

1. the parent Hooks feature enabled (`getHooksEnabledSafe` semantics: absent = enabled),
2. the checkpoint toggle enabled,
3. non-empty prompt text,
4. a valid positive integer interval.

Anything else → `undefined` → the hook contributes **no** modification to the provider request.
A malformed or over-length persisted value therefore degrades to "not effective" (fail closed).

**Validation.** The prompt text is bounded at **4096** characters and the interval at **1000**.
Invalid values are **rejected with a typed error** in `updateSettings.ts` — never truncated, never
silently coerced. Every rejection happens BEFORE any write, so an invalid request leaves the
persisted settings untouched (no partial mutation).

**Persistence.** The three fields are independent. Persisting `beforeModelCheckpointEnabled: false`
**never** deletes the saved prompt text or the interval.

**Wire format.** `proto/cline/state.proto` gains:

* `Settings`: `before_model_checkpoint_enabled = 194`, `before_model_checkpoint_text = 195`,
  `before_model_checkpoint_interval = 196`.
* `UpdateSettingsRequest`: `before_model_checkpoint_enabled = 52`,
  `before_model_checkpoint_text = 53`, `before_model_checkpoint_interval = 54`.

Every pre-existing field number is preserved verbatim — the diff against the pristine HEAD proto
is **purely additive** (25 added lines, 0 removed, 0 modified).

The generated TypeScript bindings were regenerated with the repository's existing tooling
(`bun run protos` → `node scripts/build-proto.mjs`; exit 0). The wire tags were verified in the
generated encoder/decoder:

| Field | Number | Encoder tag | Decoder case |
|---|---|---|---|
| `Settings.before_model_checkpoint_enabled` | 194 | `uint32(1552)` | `case 194:` |
| `Settings.before_model_checkpoint_text` | 195 | `uint32(1562)` | `case 195:` |
| `Settings.before_model_checkpoint_interval` | 196 | `uint32(1568)` | `case 196:` |
| `UpdateSettingsRequest.before_model_checkpoint_enabled` | 52 | `uint32(416)` | `case 52:` |
| `UpdateSettingsRequest.before_model_checkpoint_text` | 53 | `uint32(426)` | `case 53:` |
| `UpdateSettingsRequest.before_model_checkpoint_interval` | 54 | `uint32(432)` | `case 54:` |

### Finding: `scripts/generate-state-proto.mjs` is not safely idempotent

The state-proto generator is **not** a safe idempotent rewriter of `state.proto`, and this ACT hit
that directly. Running it against the pristine HEAD proto:

* it **drops the hand-maintained comment blocks** (e.g. the
  `ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01` comments and the
  `auto_approve_all_toggled = 174` field, which the legacy migration at
  `src/hosts/vscode/vscode-to-file-migration.ts:289` still reads);
* it emits a **malformed** `Settings` block — a stray `}.` terminator followed by a duplicated
  trailing field set — which **does not compile**:

  ```
  cline/state.proto:370:2: Expected top-level statement (e.g. "message").
  cline/state.proto:377:3: Expected top-level statement (e.g. "message").
  cline/state.proto:378:3: Expected top-level statement (e.g. "message").
  cline/state.proto:379:1: Unmatched "}".
  ```

Because the generator's malformed output and a hand-added field block can collide, the proto
fields for this ACT were **hand-added to the pristine HEAD proto** (so the hand-maintained content
survives and the file stays well-formed) and the TypeScript bindings were regenerated from that
well-formed proto with `bun run protos`.

**Consequence for the pre-commit hook.** The repository's pre-commit hook runs
`node scripts/generate-state-proto.mjs` on `src/shared/storage/state-keys.ts`. Running that hook
over this ACT's hand-edited proto produced the malformed file described above, which **did not
compile** — the defect was caught by the proto build before it could ship, and the committed proto
is now the well-formed, purely-additive version.

**This is a pre-existing repository defect, not introduced by this ACT, and it is recorded here as
an outstanding Factory item rather than fixed inside this ACT** — fixing the generator would
change the wire shape of unrelated `Settings` fields and is out of this ACT's scope. See §G.

**State projection.** `getStateToPostToWebview.ts` projects the three values into the
authoritative extension-to-webview state; `ExtensionMessage.ts` declares them; the webview
`ExtensionStateContext.tsx` seeds the defaults (`false` / `""` / `4`).

**Freeze.** The effective configuration is resolved and captured **at hook-bag construction
time**, which happens once per SDK session (`SdkSessionConfigBuilder.build`). Edits made during
an active task therefore apply to the NEXT new task, not halfway through an existing one.
Nothing is persisted inside model profiles or task transcripts.

## C. `beforeModel` implementation

The implementation lives in `apps/vscode/src/sdk/before-model-checkpoint.ts` and is composed into
the existing `beforeModel` hook in `hooks-adapter.ts`. No new hook framework was introduced, the
SDK hook API was not changed, and the injection was not moved to `PostToolUse`.

**Counting the right event.** The hook bag now installs an `onEvent` observer. It advances the
counter ONLY on the runtime's `turn-finished` event with `toolCallCount > 0`:

* a turn that issued three tool calls counts as **ONE** completed tool-using turn;
* a turn with zero tool calls does **not** advance the counter;
* provider attempts and React UI updates are not counted.

For interval 4 the milestones are 4, 8, 12, 16 — turns 1-3 produce no checkpoint; the checkpoint
lands in the request that follows the fourth completed tool-using turn.

**Per-session state.** The counter, the delivered milestone and the delivering iteration are
owned by the hook INSTANCE (`createBeforeModelCheckpointState()`), created inside
`buildAgentHooks`. There is **no** module-global counter, and the state is not touched from a
React functional updater. A fresh session builds a fresh hook bag → the counter resets.

**Injection.** The contribution is ONE synthetic user-role text message appended to the
provider-bound `request.messages` through the typed `beforeModel` return contract:

* the original messages and their ordering are preserved (the checkpoint is appended last);
* the system prompt, tool definitions, model options and metadata are untouched — the hook
  returns only `messages` (and the prime's `options` verbatim when the prime injected);
* the persistent conversation history is never mutated — the runtime replaces the request's
  message list with the returned projection;
* the checkpoint never lands inside a tool-call/tool-result pair: it is appended after the
  tool results of the completed turn, exactly like the runtime's own `<hook_context>` reminders;
* `submit_and_exit` availability is untouched, completion is never forced, further tool calls are
  never blocked;
* the existing final request-budget guard stays authoritative — it runs AFTER every `beforeModel`
  hook and fails closed on an over-budget request.

**Composition with the MYC prime.** The prime result is computed first and the checkpoint is
appended to whichever message list the prime produced. Neither message can be lost.

**Retry / overflow-recovery semantics.** The runtime re-issues an already-prepared request
(`issuePreparedRequest`) without re-running `beforeModel`, so a provider retry reuses the prepared
projection and cannot duplicate the checkpoint. The ordinary provider-error retry and the
overflow recovery RE-PREPARE the request (rebuilt from the persistent history, which never carries
the checkpoint), so the checkpoint MUST be re-applied there. Both requirements are satisfied by
two independent guards:

* a **milestone watermark** (`deliveredMilestone`) prevents the checkpoint from re-firing at a
  later iteration that sits at the same milestone (a turn with no tool calls does not advance the
  counter, and the milestone must not repeat);
* a **same-iteration re-preparation allowance** (`deliveredIteration`) re-applies the checkpoint
  when the runtime rebuilds the request inside the iteration that delivered it, so an eligible
  checkpoint is never silently discarded by the overflow recovery;
* a **content idempotency check** (the deterministic message id
  `before-model-checkpoint-<session>-<milestone>`) guarantees that a request that already carries
  the checkpoint is never given a second copy.

**Disabled.** With the feature disabled the resolver returns `undefined`, the checkpoint
contributes nothing, and the prime result is returned **unchanged** — the provider request is
conserved byte-for-byte.

**Not touched.** Strata, compaction policies, authorization, completion semantics and the public
SDK hook APIs are unchanged.

## D. UI implementation

`apps/vscode/webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`, under
**Advanced** and beneath **Hooks** (no new Settings tab):

* **Before Model Hook** — enabled toggle,
* **Every N completed tool-using turns** — numeric field,
* **Checkpoint prompt** — multiline text editor,
* an explicit **Save** action with validation feedback,
* the explanation "Applies to new tasks only — an active task keeps the configuration it started
  with. Requires the Hooks feature above."

The new controls are **subordinate** to the Hooks feature: switching Hooks off makes the feature
ineffective without deleting the saved text. The existing settings design components
(`Switch`, `VSCodeTextField`, `Label`, `Button`), the existing `updateSetting` RPC update path and
the persisted state projection are used.

## E. Executable evidence — RED → GREEN

### Runtime and hook tests

`apps/vscode/src/sdk/__tests__/before-model-operator-checkpoint.bmoc01.test.ts` (13 tests) drives
the REAL `SdkSessionConfigBuilder.build` → REAL `buildAgentHooks` → REAL `beforeModel`
composition. `apps/vscode/src/sdk/__tests__/before-model-operator-checkpoint.runtime.bmoc01.test.ts`
(3 tests) drives the REAL `AgentRuntime` provider-ready path with a scripted model that captures
EVERY provider request.

| # | Requirement | Test | Result |
|---|---|---|---|
| 1 | Disabled feature: provider request unchanged | R1 / RT2 | PASS |
| 2 | Interval 4: no checkpoint before the 4th completed tool-using turn | R2 | PASS |
| 3 | 4th completed tool-using turn: exact text in the next request | R3 / RT1 | PASS |
| 4 | Multiple tools in one turn count as one turn | R4 | PASS |
| 5 | Eligible checkpoint appears once in a prepared request | R5 / RT1 | PASS |
| 6 | Provider retry does not duplicate the checkpoint | R6 | PASS |
| 7 | Zero-tool-call turns do not advance the counter | R7 | PASS |
| 8 | Fresh session resets the counter | R8 | PASS |
| 9 | MYC prime still appears on the first request when eligible | R9/R10 | PASS |
| 10 | MYC prime and operator checkpoint compose without losing either | R9/R10 | PASS |
| 11 | Tool schema, authorization and system prompt remain unchanged | R11 | PASS |
| 12 | A malformed or over-length setting cannot modify a provider request | R12 | PASS |
| 13 | Final request-budget guard still rejects over-budget requests | RT3 | PASS |

### UI and persistence tests

`apps/vscode/webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx` (6 new
tests) and `apps/vscode/src/core/controller/state/updateSettings.test.ts` (6 new tests):

| # | Requirement | Result |
|---|---|---|
| 1 | Controls appear under Features → Advanced | PASS |
| 2 | Toggle defaults OFF | PASS |
| 3 | Prompt and interval round-trip through RPC, storage and reload | PASS |
| 4 | Invalid values are rejected without corrupting persisted settings | PASS |
| 5 | Existing Hooks setting disables effective injection | PASS (R13) |
| 6 | Active sessions preserve their frozen configuration | PASS (R14) |
| 7 | Older settings files migrate to the disabled default | PASS |

### RED witness

`01-red-tests.txt` (7 failed / 6 passed of 13) and `02-red-runtime-tests.txt` (1 failed / 2
passed of 3) were captured against the pre-ACT production code by reverting only
`src/sdk/hooks-adapter.ts` and removing `src/sdk/before-model-checkpoint.ts`, keeping the test
files in place. The RED is **reproducible**.

The 6 RED-passing assertions are the **conservation** assertions (R1, R2, R4, R7, R12, R13): they
pass before the feature exists because they assert that nothing happens.

### GREEN witness

`03-green-tests.txt` / `04-green-runtime-tests.txt`: **30/30 focused tests pass** (13 + 3 + 14),
exit code 0.

### Gates

* `bunx tsc --noEmit` in `apps/vscode`: **0 diagnostics**.
* `bunx tsc --noEmit` in `apps/vscode/webview-ui`: **0 diagnostics**.
* `bun run build:webview`: **success** (8937 modules transformed).
* `bun esbuild.mjs --production`: **success**; the checkpoint code is present in the bundle
  (`grep -c "before-model-checkpoint" dist/extension.js` → 1,
  `grep -c "beforeModelCheckpointEnabled" dist/extension.js` → 5).

## F. Installed qualification

See `.factory/evidence/ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01/06-installed-qualification.md`.

## G. Exit

See the board entry at the end of `.factory/epic-board.md`.
