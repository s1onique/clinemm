# Source map — the `run_commands` tool-call normalization seam

Entry HEAD: `48800ea1142dc18379fcc25ce0101cab540f41ff` (branch `main`).
Production source is **unchanged** by this ACT.

## The five boundaries (they are distinct, and the ACT requires them to be kept apart)

| # | Boundary | Production site | Failure surface |
|---|---|---|---|
| B1 | **Provider-side schema enforcement** | `sdk/packages/llms/src/providers/vendors/openai-compatible.ts` → `providerOptions.openaiCompatible.strictJsonSchema` | the provider rejects the request / the tool call never arrives |
| B2 | **Application-side decoding** | `sdk/packages/agents/src/agent-runtime.ts` `parseToolArguments` (6641) and `sdk/packages/llms/src/providers/ai-sdk.ts` `repairMalformedToolCall` (924) | `Tool call arguments could not be parsed as JSON` / `Tool call arguments must be encoded as a JSON object or array` |
| B3 | **Normalization** | `sdk/packages/core/src/extensions/tools/helpers.ts` `normalizeRunCommandsToolInput` (420) — the tool-scoped canonicalizer — plus the generic schema-driven `normalizeJsonLikeStringsForSchema` (`sdk/packages/shared/src/parse/json.ts` 203), which runs **first** | the canonicalizer returns the input UNCHANGED for any shape it does not recognize |
| B4 | **Validation** | `sdk/packages/core/src/extensions/tools/schemas.ts` `RunCommandsInputSchema` (161) + `createTool`'s auto-generated `validateInput`; invoked from `agent-runtime.ts` (~5231) | `Invalid input for tool run_commands: …` |
| B5 | **Execution + result delivery** | `sdk/packages/core/src/extensions/tools/definitions.ts` `createShellTool` (810) → `executeShellCommands`; boundaries reported by `agent-runtime.ts` `observeToolResultDelivered` (4519) | `tool_execution` / `tool_result_delivered` |

Ordering inside `agent-runtime.ts` is load-bearing and was read directly from the
source (not assumed):

```
parseToolArguments                 (B2)  →  malformed JSON fails here
normalizeJsonLikeStringsForSchema  (B3a, generic, schema-driven)
tool.normalizeInput                (B3b, run_commands canonicalizer)
tool.validateInput                 (B4)  →  strict schema; sets skipReason
beforeTool hooks / policy / approval
execute                            (B5)
```

A failure at B3b or B4 sets `skipReason`, which means the call **never reaches
approval and never reaches the executor**. A throwing canonicalizer is treated as
a validation failure (`agent-runtime.ts` ~5197).

## The model-facing schema (what the provider is told)

`RunCommandsInputSchema` is a strict Zod object (`.strict()` ⇒
`additionalProperties: false`). Its JSON Schema was produced with the REAL
production converter (`zodToJsonSchema` from `@cline/shared`) and independently
observed on the wire in the live provider-request captures:

```json
{"type":"object",
 "properties":{
   "commands":{"type":"array","minItems":1,"items":{"type":"string"},
               "description":"Array of complete shell command strings to execute."},
   "notifyOnCompletion":{"type":"boolean","description":"…"}},
 "required":["commands"],
 "additionalProperties":false}
```

All 622 live provider-request captures carry a byte-identical
`run_commands` schema (exactly ONE distinct schema hash across the whole
capture set).

**B1 is NOT enforced at the provider.** The schema was ADVERTISED but not
provider-enforced. **CORRECTION01 precision:** the pre-correction wording
("`strictJsonSchema = false` in every captured request") was an OVERCLAIM. The
corrected analyzer inspects EVERY capture and finds the field **ABSENT in 496
of 622** captures (all 496 belong to session `1794524499963_op3ld`), so the
corpus-wide strictness finding is **MIXED** (`FALSE` + `UNKNOWN`). The claim
this ACT actually relies on is narrower and holds: **both Flint sessions record
`strictJsonSchema = false` in every one of their 23 captures** (witness check
C4b). The schema was not provider-enforced in the sessions that produced the
observed failures — which is exactly why a malformed argument shape could reach
the application at all.

## The normalizer's accepted shapes (production source, `helpers.ts` 420–582)

| Shape | Normalizer result | Boundary reached |
|---|---|---|
| `{commands: ["a","b"]}` | unchanged (canonical) | B4 passes |
| `{commands: [{command:"a"}]}` | `{commands:["a"]}` (object-entry branch) | B4 passes |
| `{commands: "[{\"command\":\"a\"}]"}` | `{commands:["a"]}` (HARNESS-03 encoded object-array branch) | B4 passes |
| `{commands: "[\"a\",\"b\"]"}` | `{commands:["a","b"]}` | B4 passes |
| `{command: "[\"a\"]"}` | `{commands:["a"]}` (Flint JSON-array branch) | B4 passes |
| `{commands: "ls -la"}` / `{command: "ls -la"}` | `{commands:["ls -la"]}` | B4 passes |
| `{commands: "[…shell-quoted…]"}` (not valid JSON) | shell-quoted branch → members | B4 passes |
| anything else (ambiguous siblings, empty, mixed, malformed) | **UNCHANGED** | B4 rejects |

Two invariants are explicit in the source and were checked:

- **Single-key rule.** Every branch requires the input object to have EXACTLY
  ONE key (`command` or `commands`). A payload with any sibling key — even a
  DECLARED one such as `notifyOnCompletion` — is left unchanged and rejected.
  (Probed directly; see the qualification report.)
- **Anti-shell invariant.** The serialized JSON text is never forwarded as a
  command; the parsed members ARE the commands. A JSON OBJECT value is never
  treated as shell text.

## Existing HARNESS-03 inventory (before this ACT added anything)

| Suite | File | Tests | Role |
|---|---|---:|---|
| HARNESS-03 | `sdk/packages/core/src/extensions/tools/roundc-toolcall-json-object-array.test.ts` | 28 | the JSON-encoded array-of-objects shape: GREEN, fail-closed, no-collateral, and the REAL runtime seam (normalize → validate → approve → execute) |
| HARNESS-02 | `sdk/packages/core/src/extensions/tools/roundc-toolcall-normalization.boundary.test.ts` | 9 | the object-entry sibling-key boundary |
| HARNESS-01 | `sdk/packages/core/src/extensions/tools/roundc-toolcall-normalization.test.ts` | 30 | the Round C shapes against the LIVE fixtures |
| HARNESS-01 | `sdk/packages/core/src/extensions/tools/roundc-toolcall-runtime.test.ts` | 13 | the REAL runtime seam driven with the LIVE Round C fixtures |
| FLINT-RED-01 | `sdk/packages/core/src/extensions/tools/flint-toolcall-red01.test.ts` | 20 | the Flint shapes + the rejection matrix |
| FLINT-CORR-01 | `sdk/packages/core/src/extensions/tools/flint-toolcall-red01-correction01.test.ts` | 35 | the two remaining single-string Flint shapes |
| FLINT-WITNESS | `sdk/packages/core/src/extensions/tools/flint-toolcall-red01-witness.test.ts` | 4 | byte-level fidelity of the Flint fixtures against the LIVE transcript |

`flint-toolcall-red01-witness.test.ts` is `describe.skipIf(!transcriptPath)`:
on a machine WITHOUT the live transcript it skips; on this machine the live
transcript IS present, so it **executed** (4 passed, 0 skipped) and is a hard
gate here.

## Production diagnostics already present (no new ones added by this ACT)

- `schema_validation` boundary (`agent-runtime.ts` 4481) reports only the tool
  name, the validity boolean and the input SIZE — never the input itself.
- `tool_execution` / `tool_result_delivered` boundaries carry the tool-call id,
  the tool name and the result size.
