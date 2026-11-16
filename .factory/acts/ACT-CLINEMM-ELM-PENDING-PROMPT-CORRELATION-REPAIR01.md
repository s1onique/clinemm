# ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01

Status: `PASS_CORRELATION_REPAIR_PROVEN`

Predecessor: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01` (OPPOR01) — `PASS_CAUSAL_PROOF`,
reviewed as `HALT_CORRELATION_IDENTITY_UNPROVEN`.

## 1. The reviewer's P0 and what this ACT did about it

OPPOR01 proved, at the Elm state-machine level, that a continuation prompt stays
`PromptScheduled` forever unless a `ContinuationStarted promptRef runRef` transition
arrives. Its counterfactual paired BOTH incident prompts with `run_rCw8nsup` — a run
that had already finished before either prompt was scheduled — so the prompt↔run
ASSOCIATION was synthetic. The review therefore halted the repair.

This ACT executed the review's mandated FIRST GATE: a production-seam discriminator
that exercises the ACTUAL `LocalRuntimeHost`, the REAL canonical subscription and the
REAL Elm kernel, with **NO fabricated `run-started` delivery**, over **two consecutive
continuation turns**.

## 2. Root cause (PROVEN at the production seam)

`LocalRuntimeHost.subscribeRuntimeEvents` is POINT_IN_TIME: it walks the host's session
map and attaches the listener to the `SessionRuntime` that is live AT CALL TIME
(`local-runtime-host.ts:2352-2373`). The production lifecycle REPLACES the
`SessionRuntime` under the SAME session id
(`local-runtime-host.ts:1363` — `this.sessions.set(sessionId, active)`).

A subscription attached before the replacement keeps observing the DISPOSED runtime.
Consequence: the canonical `run-started` of every subsequent turn is lost, the
`continuation_started(promptId, runId)` join never fires, the continuation prompt stays
`PromptScheduled` in the Elm completion authority, and the completion is withheld on
`pending_prompt` forever.

Discriminators at the production boundary:

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| (a) event not emitted | **REFUTED** | the REAL `AgentRuntime.execute()` allocated a runId and the host-side `agent_turn_done` capture carries it |
| (b) listener not attached | **CONFIRMED** | the stale subscription observed ZERO canonical events after the replacement |
| (c) wrong session identity | **REFUTED** | the sessionId is byte-identical across the replacement; the `agent_turn_done` capture is keyed by that same sessionId |
| (d) event lost during lifecycle replacement | **CONFIRMED** | the replacement installs a NEW `SessionRuntime`; the old listener stays bound to the disposed one |

## 3. Correlation identity (the P0 the review left open)

PROVEN with REAL producer output, not a synthetic pairing:

- each continuation turn gets a **FRESH** runId allocated by the REAL
  `AgentRuntime.execute()` (`agent-runtime.ts:1788`);
- the `continuation_started(promptId, runId)` record carries the runId of THE run that
  ACTUALLY executed that continuation turn — never an earlier run;
- the `agent_turn_done` capture (which reads the SAME retained runId map) agrees.

## 4. The production repair (smallest sufficient)

Two files, one optional hook:

- `apps/vscode/src/sdk/sdk-session-lifecycle.ts`
  - new optional `onCanonicalRuntimeRebind?: (sessionId: string) => void` option;
  - `replaceActiveSession` invokes it AFTER the replacement session is installed, with
    the replacement's session id.
- `apps/vscode/src/sdk/SdkController.ts`
  - wires the hook to the EXISTING `attachCanonicalRuntimeEventSubscription`, using the
    SAME identity fence the follow-up-resume rebind uses (re-attach only if the
    replaced session is STILL active at call time).

`replaceActiveSession` is the SINGLE chokepoint for all five session-replacing paths
(mode switch, terminal-execution-mode, provider change, MCP/auto-approval config
change, auto-approval). Before this repair, only the follow-up-resume path re-bound the
canonical subscription; the other five replaced the `SessionRuntime` with a STALE
listener — exactly the incident shape (ONE `run_turn_started` for FIVE
`agent_turn_done` records in ONE session).

## 5. Do NOT

Do not repair the Elm completion policy. Do not suppress `PendingPrompt`. Do not force
completion from TypeScript counters. Do not fabricate a run id. Do not weaken C9/C10,
BCB or session ownership. Do not create a second completion authority. Do not weaken the
`OPPOR01-REPLAY` historical witness — it must continue to PASS (it replays a FIXED
historical fixture; a subscription repair does not change that input).

## 6. Evidence

`.factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01/`
