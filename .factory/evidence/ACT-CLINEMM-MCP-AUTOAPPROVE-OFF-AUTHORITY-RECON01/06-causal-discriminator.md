# 06-causal-discriminator.md

## Class

**H. NOT_A_DEFECT** — observed behavior matches the current explicit
contract, and no bypass was reproduced.

The current production contract (per source) is:

```
When `autoApprovalSettings.actions.useMcp === false`
  AND `SessionAutoApprovalOverride === "none"`
  → every MCP tool invocation MUST go through user approval
    (i.e. `isToolAutoApproved` returns false)
```

This is implemented in `isToolAutoApproved` at
`apps/vscode/src/sdk/sdk-tool-policies.ts:1096`:

```ts
if (!settings.actions.useMcp) {
    return false
}
```

and is double-gated at the coordinator short-circuit
(`apps/vscode/src/sdk/sdk-interaction-coordinator.ts:521`):

```ts
if (request.policy.autoApprove === true || this.options.shouldAutoApproveTool?.(request) === true) {
    return { approved: true }
}
```

and again at the SDK executor gate
(`sdk/packages/agents/src/agent-runtime.ts:3146` function; C1.2 body at 3278-3282):

```ts
if (approval.approved && toolExists && !inputParseError && !skipReason) {
    toolExecutionInvoked = true;        // set IMMEDIATELY before tool.execute
    await tool.execute(input, context); // ← only path to MCP execution
} else {
    toolExecutionInvoked = false;
    // result.output.error = skipReason
    // content_end.error = skipReason
}
```

## Evidence

1. **Source inspection** of the three layers above (lines and
   symbols cited verbatim in `01-authority-inventory.md`).

2. **Existing production-seam tests** at
   `apps/vscode/src/sdk/sdk-interaction-coordinator.session-autonomy.test.ts`:
   - `figma-desktop/get_metadata + override=none + persisted MCP=false => ASK (regression baseline)` (line 562-583) — load-bearing for R1.
   - `figma-desktop/get_metadata + session ALL + persisted MCP=false => ALLOW, no approval UI` (line 538-560) — load-bearing for R4.
   - `task ends ⇒ persisted MCP behavior restored ⇒ Figma MCP back to ASK` (line 615-638) — load-bearing for the session-override-only-during-task contract.

3. **Existing unit tests** at
   `apps/vscode/src/sdk/sdk-tool-policies.test.ts` (A-G2 + PRODUCTION
   REGRESSION) — assert the `isToolAutoApproved` MCP lattice
   independent of the coordinator.

4. **Existing test of the SDK executor gate** at
   `sdk/packages/agents/src/agent-runtime.outcome-integration.test.ts` —
   pins the C1.2 invariant that `toolExecutionInvoked` is FALSE
   when approval is not approved.

All four MCP-relevant integration tests pass at the current HEAD
(verified by `bunx vitest run` in `05-reproduction.txt` step 2).

## Ablation

**Necessity proof: line 1096 IS load-bearing.**

Ablation test in concept (NOT executed in production code — this is
theoretical necessity analysis per §12):

* **Without** line 1096 (`if (!settings.actions.useMcp) return false`):
  The function would fall through to the per-tool check at line 1099.
  A tool whose `tool.autoApprove === true` AND persisted
  `useMcp === false` would return `true` instead of `false`. This is
  the exact R1 violation we are guarding against.

* **With** line 1096 (current production):
  The function returns `false` unconditionally for `useMcp === false`
  regardless of per-tool state. R1 invariant holds.

The integration test "figma-desktop/get_metadata + override=none +
persisted MCP=false => ASK" implicitly exercises this ablation: it
sets the tool's `autoApprove: false` (and would set it to `true` in
an ablation), then asserts ASK. The current test (with
`autoApprove: false`) already pins the SAFE direction. To explicitly
pin the unsafe direction would require an additional test
(`autoApprove: true` + `useMcp: false` → ASK); this is documented as
a coverage gap in `04-test-inventory.md` §6, not a defect.

**Co-gate necessity proof: line 521 short-circuit.**

The coordinator's short-circuit
`if (request.policy.autoApprove === true || shouldAutoApproveTool?.(request) === true)`
guards against a regression where `request.policy.autoApprove` is
TRUE despite the SDK policy builder setting it to FALSE. If someone
bypassed the policy builder and set `request.policy.autoApprove = true`,
the short-circuit would ALLOW without consulting the host. With the
short-circuit, that bypass is impossible unless BOTH gates are
bypassed.

## Why no production repair is proposed

Per ACT §3.1: "If a repair seems obvious: STOP. Document it as a
candidate. Do not implement it."

The current code matches the explicit contract. There is NO bypass.
The only candidate repair I considered is:

* Candidate: harden `04-test-inventory.md` §6 gap 1 by adding a unit
  test `autoApprove: true` + `useMcp: false` → ASK. This is a TEST
  HARDENING, not a production repair. It is documented here as a
  P2 follow-up candidate, NOT authorized for this ACT.

No other candidate repair exists. The safety invariant holds.
