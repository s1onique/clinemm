# ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01
## C1-CORRECTION01 -- corrected recon after reviewer halt

### Reviewer halt (verbatim)

> HALT_PER_COMMAND_RED_NOT_BOUND_TO_REAL_EXECUTION_PLAN
>
> The current C1 test proves the already-known fact that a tool-call-scoped
> capability fans out uniformly to every manager.start() call. What it does
> NOT prove is the new load-bearing seam you want to repair:
> CommandExecutionPlan.commands[i] -> exact spawned command i. The test
> explicitly inserts a __hypothetical_per_command_plan into
> AgentToolContext.metadata; production does not put the plan there, and
> the executor never reads it.

### What was wrong with the prior C1 recon

The prior C1 RED test:
- inserted a synthetic CommandExecutionPlan into AgentToolContext.metadata
  via `__hypothetical_per_command_plan`.
- The metadata bag is partially untrusted (per metadata-provenance.md).
- The shell-tool executor NEVER reads this metadata bag for authority.
- The injected plan was therefore inert; it did not causally participate
  in the test.
- The observed RED (uniform tool-call capability across all manager.start
  calls) was the SAME RED as the C2-P1 multi-command discriminator,
  regardless of the synthetic plan.

This proved the **already-known** uniform-fanout property, not the
new per-command-plan seam.

### Corrected identity analysis (REJECT, REJECT, candidate pending proof)

The reviewer correctly identified that:

1. **REJECT `matchedRuleSource` as identity.**
   `matchedRuleSource` is a useful **authority attribute** but NOT an
   identity anchor. Two entries can legitimately have the same source:

   ```text
   command[0] -> host_safe_git_status
   command[1] -> host_safe_git_status
   ```

   A filter keyed on `matchedRuleSource` would falsely match both
   entries for both starts.

2. **REJECT `hardenedCommand` text as identity.**
   Duplicate commands are valid:

   ```text
   commands = ["git status", "git status"]
   ```

   A text key has no unique correspondence to plan entries.

3. **CANDIDATE: `commandIndex` is the only safe anchor.**
   `CommandExecutionPlanEntry.commandIndex` is the positional
   reference that survives across:
   - duplicate text (Case 2 below)
   - distinct ordinary strings (Case 1 below)
   - mixed authority (Case 3 below)

   But **HEREDOC COALESCING** breaks the index correspondence:
   the plan is built with `normalizeRunCommandsInput` (no
   coalescing), so plan.commands.length === normalized input
   length; the executor runs `coalesceAdjacentStringHeredocs` AFTER
   normalization, which can REDUCE the command count. For these
   shapes, `commandIndex` correlation is BROKEN.

### Identity discriminators (Section 2 of the test file)

| Case | Shape | commandIndex works? | RED observed |
|------|-------|---------------------|--------------|
| 1 | `["/usr/bin/mktemp", "printf harmless\n"]` (distinct) | YES | start[0] correlates to entry[0], start[1] correlates to entry[1] |
| 2 | `["git status", "git status"]` (duplicate text) | YES (by POSITION, not text) | start[0] is the first call; start[1] is the second; both have the same text but distinct positions |
| 3 | `["cmd-A", "cmd-none", "cmd-C"]` (mixed authority) | YES | 3 starts with positional order matching entries |
| 4 | `["cat <<EOF", "line1", "EOF"]` (heredoc coalescing) | NO (cardinality drift) | plan has 3 entries; executor produces 1 merged command. **FAIL-CLOSED boundary**: per-command authority MUST be refused when `executionPlan.commands.length !== manager.start call count` |

### Real upstream authorization seam RED (Section 1)

Section 1 of the new test file drives the **real** upstream
authorization seam:

```text
AgentRuntime (real)
  -> requestToolApproval (real callback returning real
     ToolApprovalResult with executionPlan)
  -> prepareToolExecution (real)
  -> tool.execute(input, ctx) (real createShellTool via
     createVscodeRunCommandsTool)
  -> executeShellCommands (real)
  -> createVscodeShellExecutor (real)
  -> CommandJobManager.start (real)
```

The host callback returns a real `ToolApprovalResult` with:

```text
{
  approved: true,
  decision: { kind: "allow", ... },
  executionPlan: {
    transformedInput: { commands: ["/usr/bin/mktemp", "printf harmless\n"] },
    commands: [
      { commandIndex: 0, hardenedCommand: "/usr/bin/mktemp",
        matchedRuleSource: "darwin_mktemp_create_only" },
      { commandIndex: 1, hardenedCommand: "printf harmless\n" },
    ],
  },
  executionCapability: { kind: "factory-binding-probe",
                         correlationId: "tool-call-c1-correction01" },
}
```

The runtime stamps `input = approval.executionPlan.transformedInput`
(agent-runtime.ts:2590, CORRECTION04 enforcement). The parallel
`commands[]` array is **DISCARDED** — not propagated into
AgentToolContext.

Observed RED:
- 2 manager.start calls (one per command, preserving order).
- BOTH receive the SAME tool-call capability (uniform fanout).
- The hardened commands are visible (start.options.command), but
  the per-entry `matchedRuleSource` is NOT observable on
  manager.start.
- AgentToolContext has exactly ONE executionCapability slot
  (tool-call scope). No per-command channel exists.

### Halt conditions (frozen, reviewer-canonical)

- RED not reproducible from the real approval callback:
  HALT_RED_NOT_REPRODUCED
- commandIndex cannot correlate at all (no stable mapping):
  HALT_PER_COMMAND_CORRELATION_AMBIGUOUS
- host adapter refuses to attach executionPlan to the approval
  result: HALT_HOST_BINDING_UNSUPPORTED
- cardinality check rejects all calls in the multi-command case:
  HALT_CARDINALITY_DRIFT

### Architecture comparison (unchanged from prior recon)

Two viable architectures:

**Option A (preferred): attach `executionCapability?` to
`CommandExecutionPlanEntry`.**
- Capability travels with the authorization decision that granted it.
- Identity: `execution command i -> plan entry commandIndex=i ->
  capability from that entry`.
- NOT a parallel `perCommandExecutionCapabilities[]` array.
- NOT a text match (`find entry where hardenedCommand === command`).
- Handles duplicate text correctly via POSITION.

**Option B (smaller fallback): uniform-whole-call gate.**
- Host only issues executionCapability when EVERY command in the
  plan qualifies for the SAME capability.
- For `["/usr/bin/mktemp", "printf harmless"]`: no capability (mixed).
- For `["/usr/bin/mktemp", "/usr/bin/mktemp -d"]`: capability OK
  (uniform).
- Smaller delta but caps real authority to uniform calls.

### Reviewer recommendation

> "I recommend Option A. But shape it as:
>
>   interface CommandExecutionPlanEntry {
>     commandIndex: number
>     hardenedCommand: string
>     ...
>     executionCapability?: InternalExecutionCapability
>   }
>
> The capability travels with the decision that granted it.
>
> Then execution should consume the plan entry by its proven
> identity:
>
>   execution command i
>   -> plan entry commandIndex=i
>   -> capability from that entry
>
> Not:
>
>   perCommandExecutionCapabilities[i]
>
> and definitely not:
>
>   find entry where hardenedCommand === command
>
> Option B - uniform-whole-call capability - remains an excellent
> fallback if the real mapping proves messy. For /usr/bin/mktemp, it
> would safely mean:
>
>   [/usr/bin/mktemp]
>   -> capability
>
>   [/usr/bin/mktemp, unrelated command]
>   -> no capability
>
> Less ergonomic, but secure and much smaller."

### Disposition

```text
C1 RED (CORRECTION01):
  TOOL-CALL UNIFORM FANOUT      PROVEN (real upstream seam)
  REAL PER-COMMAND PLAN RED     PROVEN (per-entry provenance DISCARDED at CORRECTION04)
  commandIndex identity          PROVEN for ordinary strings (Cases 1, 2, 3)
  commandIndex identity          BROKEN for heredoc coalescing (Case 4 -- fail-closed boundary)
  matchedRuleSource identity     REJECTED
  hardenedCommand text identity  REJECTED

C1: GO
OPTION A: APPROVED
```

### Next

C2 GREEN: add `executionCapability?: InternalExecutionCapability`
to `CommandExecutionPlanEntry`. Plumb per-entry capability through
the SDK shell tool's fanout:

```text
execution command i
  -> plan entry commandIndex=i
  -> entry.executionCapability (or undefined)
  -> manager.start(command, ..., context with per-command capability)
```

Reviewer-mandated P0 discriminators (to land in C2 GREEN):
1. wrong command cannot receive neighbor capability
2. missing plan entry fails closed
3. shorter capability list cannot shift authority
4. extra command cannot inherit last/first capability
5. denied command never starts
6. model metadata still cannot manufacture capability

After C2 GREEN lands and the 6 P0 discriminators pass:
resume ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
with `createOnlyRoots=[canonical DARWIN_USER_TEMP_ROOT]`.
