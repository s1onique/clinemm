# ACT-CLINEMM-FINALIZATION-TOOL-SURFACE-LIVE01 — STUB

**Status:** STUB OPENED 2026-09-28 by ACT-CLINEMM-PENDING-PROMPT-DRAIN-AFTER-COMPLETING-RUN01 closure follow-up.

**Primary purpose:** Trace one real BCB finalization continuation from installed-artifact identity (`VSIX_SHA256`) through the `runtime-builder` inputs to the actual provider-visible tool names, and explain why `command_status` is absent on the dispatched finalization turn despite the prior "consumer-availability" fix (which widened `if (options.commandJobManager)` regardless of `executionMode`).

**Live witness:** session `1790545638594_95udl` with seven held `cmd_mukd*` jobIds. `0/8` observations consumed (the 8th, `cmd_mukefcxdv2esxcmo`, was spawned by this agent's own `find` call and is itself proof of the same defect) because the runtime's tool surface available to this agent does NOT include `command_status`.

**Static-recon status (committed at `82c3a6c91`):** Hypotheses A–E all REFUTED by the static chain (see `01-static-recon.md`). Only B6 (`TOOL_AVAILABILITY_CLAIM_CONTRADICTED`) remains — requires operator live capture.

**Scope:** DIAGNOSE only. No production-side edits in this ACT. Repair is gated on the named HALT classification.

## Hypotheses to discriminate

| ID | Hypothesis | Discriminator |
|----|-----------|---------------|
| A | `STALE_DOGFOOD_ARTIFACT` — the running extension build lacks the consumer-availability fix | `VSIX_SHA256` vs current `SOURCE_HEAD` artifact sha |
| B | `COMMAND_JOB_MANAGER_MISSING` — `options.commandJobManager=undefined` at this finalization continuation's runtime-builder seam | `commandJobManager_present` direct trace |
| C | `DIFFERENT_RUNTIME_BUILDER` — finalization continuation constructs AgentRuntime via a different code path than the foreground path that was patched | diff of `runtime_builder_tool_names` between foreground and finalization-turn builder calls |
| D | `TOOL_POLICY_FILTER` — `command_status` is built but later filtered/disabled by tool policy | `command_status_created = true` ∧ `command_status_policy_enabled = false` |
| E | `TOOL_LOST_IN_AGENT_RUNTIME` — tool exists internally but is dropped during AgentRuntime construction | `command_status_created = true` ∧ `command_status_provider_visible = false` ∧ `provider_bound_tool_names ∌ command_status` |

## Required captures

```
SOURCE_HEAD
DOGFOOD_SOURCE_HEAD
VSIX_SHA256
INSTALLED_VERSION

sessionId
finalization promptId

executionMode
commandJobManager_present

runtime_builder_tool_names      (set<string>)
agent_runtime_tool_names        (set<string>)
provider_bound_tool_names       (set<string>)

command_status_created          (boolean)
command_status_policy_enabled   (boolean)
command_status_provider_visible (boolean)
```

## Decisive invariant

```
finalization prompt mentions "command_status"
⇒
"command_status" ∈ provider_bound_tool_names
```

## Stop conditions (HALT-based, no early closure)

| HALT | Meaning | Repair scope |
|------|---------|--------------|
| `HALT_STALE_DOGFOOD_ARTIFACT` | Installed VSIX sha256 ≠ current SOURCE_HEAD build artifact | rebuild + reinstall only |
| `HALT_FINALIZATION_COMMAND_JOB_MANAGER_MISSING` | `options.commandJobManager=undefined` at the runtime-builder seam | repair in runtime assembly |
| `HALT_FINALIZATION_TOOL_POLICY_FILTER` | Created + policy-disabled | remove policy filter for this tool |
| `HALT_TOOL_AVAILABILITY_CLAIM_CONTRADICTED` | Tool present in provider-bound set; model still claims unavailable | investigate tool-schema/name mapping |

## Conservation

- No production-source edits permitted during diagnostic capture.
- The fix lands in a successor ACT scoped to the named HALT.

## Falsifiability

If, after a clean install and full restart, the finalization continuation reports `provider_bound_tool_names` = `{command_status, ...}` AND the agent still claims `command_status` is unavailable, the invariant is falsified and the diagnosis shifts to `HALT_TOOL_AVAILABILITY_CLAIM_CONTRADICTED` (model/tool-schema mapping, not tool registration).

## Evidence location

`.factory/evidence/ACT-CLINEMM-FINALIZATION-TOOL-SURFACE-LIVE01/00-entry.txt`, `01-artifact-identity.{txt,md}`, `02-builder-inputs.{txt,md}`, `03-tool-policy.{txt,md}`, `04-stitched-trace.{txt,md}`, `05-verdict.md`, `result.json`.

## Disposition

Awaits operator run; diagnostics are observable from this cloud-agent shell only if the substrate provides the captures listed above. From the cloud-agent substrate, the `command_status` tool is unavailable to the agent model itself (PPRD01 live witness), so the captures require either (a) an operator-driven diagnostic run in a substrate where the tool is exposed, or (b) a static-only inspection of the installed artifact vs the source tree to discriminate hypothesis A (`STALE_DOGFOOD_ARTIFACT`) without running a finalization turn.
