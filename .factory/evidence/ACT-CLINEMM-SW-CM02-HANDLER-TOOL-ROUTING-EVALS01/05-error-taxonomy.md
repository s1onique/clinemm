# 05-error-taxonomy.md — ACT-CLINEMM-SW-CM02-HANDLER-TOOL-ROUTING-EVALS01

## Production outcome shape

`ToolRuntimeOutcome` (sdk/packages/shared/src/agents/recovery/types.ts:205):

```ts
type ToolRuntimeOutcome =
  | { kind: "success"; toolName; toolCallId }
  | { kind: "failure"; toolName; toolCallId;
      failureClass: ToolFailureClass;
      stableCode: StableFailureCode;
      familyConfidence: "structured" | "fallback";
      familyEligible: boolean;
      error?: unknown; }
  | { kind: "control_plane"; outcome: ControlPlaneOutcome;
      toolName?; toolCallId?; };
```

`ToolFailureClass` (L23-28):
- `"tool_not_found"`
- `"tool_input_invalid"`
- `"tool_execution_error"`
- `"tool_result_invalid"`
- `"tool_protocol_error"`

`ControlPlaneOutcome` (L30-46):
- `"user_rejected"`
- `"host_policy_denied"`
- `"approval_pending"`
- `"provider_rate_limit"`
- `"provider_transport_error"`
- `"context_length_exceeded"`
- `"task_cancelled"`
- `"runtime_aborted"`
- `"runtime_skipped"` (prepare-tool short-circuit: policy-disabled, hook-skip, etc.)

## SW-CM02 classification projection

SW-CM02 tests assert a flattened "classification" string derived from the
outcome kind:

| Outcome | SW-CM02 classification |
|---|---|
| `kind="success"` | `"tool_execution_succeeded"` |
| `kind="failure"` | `outcome.failureClass` (verbatim) |
| `kind="control_plane"` | `outcome.outcome` (verbatim) |

## Cases asserted (S21 + E1-E3 + A2)

| ID | Invocation | Outcome kind | failureClass / outcome | SW-CM02 classification |
|---|---|---|---|---|
| E1-unknown | `no_such_tool` | `failure` | `tool_not_found` | `tool_not_found` |
| E2-enoent | `always_errors` (throws ENOENT) | `failure` | `tool_execution_error` | `tool_execution_error` |
| E3-opaque | `opaque_failure` (throws opaque Error) | `failure` | `tool_execution_error` | `tool_execution_error` |
| A2-disabled-tool-dispatch | `run_commands` (filtered out) | `failure` | `tool_not_found` | `tool_not_found` |
| B5-unknown | `no_such_tool_xyz` | `failure` | `tool_not_found` | `tool_not_found` |
| S10-adversarial (×8) | `read` / `read-files` / `READ_FILES` / `read_files_` / `/read_files` / ` read_files` / `read_files ` / `\tread_files\n` | `failure` | `tool_not_found` | `tool_not_found` |
| S11 (9 of 11) | alias names (use_skill, attempt_completion, bash, execute_command, list_code_definition_names, list_files, replace_in_file, apply_diff, write_to_file) | `failure` | `tool_not_found` | `tool_not_found` |
| B8-handler-error | `always_errors` (throws ENOENT) | `failure` | `tool_execution_error` | `tool_execution_error` |

## Child-runtime classification (NEW for halt C1 round 2)

Section B4-B7 of the registration file do not project ToolRuntimeOutcome.
They assert on the **child tool list** captured from the production
`createConfiguredAgentTools` → `createDelegatedAgent({ tools })` →
`new SessionRuntime(config)` chain via the mocked orchestrator.

Failure modes that are observable:
- `B4-child-canonical`: if `filterToolsForConfiguredAgent` failed to
  canonicalize `bash` → `run_commands`, the child would receive `bash`
  as a literal alias. We assert `expect(childNames).not.toContain("bash")`
  and `expect(childNames).toContain("run_commands")`.
- `B5-child-skills-with-executor`: if the skills executor was NOT
  injected for the configured-agent with `skills: review`, the child
  would not see `skills`. We assert
  `expect(childNames).toContain("skills")`.
- `B6-child-no-tools`: if the configured-agent filter returned an empty
  list when no `tools:` line is declared (instead of returning the
  input list unchanged), the child would be empty. We assert
  `expect(childNames).toContain("read_files")` and 4 others.
- `B7-child-policy-disable`: if the parent-level `toolPolicies` filter
  did NOT compose with the configured-agent filter (e.g. if the
  configured-agent filter ran on the unfiltered builtin list), the
  child would receive `run_commands`. We assert
  `expect(childNames).not.toContain("run_commands")` and
  `expect(childNames).toEqual([])`.

All four child-runtime cases produce the EXPECTED production behavior.
No defect reproduced.

## Cases NOT covered by SW-CM02

These are SCOPE-DEFERRED:

- `tool_input_invalid`: the runtime parses the streamed `tool-call-delta`
  text into JSON. Malformed JSON would surface here. Not asserted by
  SW-CM02 (no malformed-input cases).
- `tool_result_invalid`: the tool returned a value that violates the
  declared schema. Not asserted.
- `tool_protocol_error`: dispatch flow error (e.g. prepare-tool
  short-circuit not via `runtime_skipped`). Not asserted.
- Control-plane outcomes (`user_rejected`, `host_policy_denied`, etc.)
  are NOT asserted — they live on the host side, not the runtime's
  dispatch boundary. The S16-approval test only asserts that the
  handler runs (it does, after the synthetic `approved: true`), not
  the specific control-plane outcome path.

## Discriminator coverage summary

- D1 (registry omission via filter) → S21 E1, B5, S10, S11-miss, A2.
- D3 (policy misapplication)        → A2 (filtered tool registry-misses).
- D5 (executor dispatch)            → E1, B5, S10, S11.
- D8 (result correlation)           → E2, E3 (handler DID fire).
- D2 (alias canonicalization in child) → B4 (real production seam).
- D4 (configured-agent filter)      → B1-B7 (parent + child, real seam).
