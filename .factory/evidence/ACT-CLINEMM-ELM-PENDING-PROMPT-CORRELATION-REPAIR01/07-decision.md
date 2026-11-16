# 07 — Decision

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01` (CPR01)
Incident session (unchanged): `1794840293250_5ugld`

---

## 07.1 The question asked

> Close the correlation-identity gap the OPPOR01 review identified, and — only if the
> real-host RED reproduces — implement the causally necessary repair.

## 07.2 The answer

**PROVEN. The real-host RED reproduced; the correlation identity is now
source-backed; the causally necessary repair is implemented and verified.**

## 07.3 Closure classification

# `PASS_CORRELATION_REPAIR_PROVEN`

The two propositions the review left open are now closed:

### 07.3.1 Production continuation-to-run identity — PROVEN

The REAL producer emits `continuation_started(promptId, runId)` whose `runId` is the run
that ACTUALLY executed that continuation turn. Established from REAL producer output
(CPR01-01, CPR01-03), not from a synthetic pairing:

- the REAL `AgentRuntime.execute()` allocates a FRESH runId per run;
- the `continuation_started` record carries that fresh runId;
- the `agent_turn_done` capture (the SAME retained runId map) agrees;
- the correlation is NEVER the previous turn's run.

The OPPOR01 counterfactual's synthetic pairing (`run_rCw8nsup` for two prompts
scheduled AFTER that run finished) is therefore **not needed** and **not relied upon**.
It is retained unchanged as the historical witness.

### 07.3.2 Why the canonical `run-started` was missing — PROVEN

`LocalRuntimeHost.subscribeRuntimeEvents` is POINT_IN_TIME. The production lifecycle
REPLACES the `SessionRuntime` under the SAME session id
(`local-runtime-host.ts:1363`). A subscription attached before the replacement keeps
observing the DISPOSED runtime, so the canonical `run-started` of every subsequent turn
is lost.

Of the four hypotheses the review listed:

- (a) event not emitted — **REFUTED** (the REAL runtime allocated a runId; the
  `agent_turn_done` capture carries it);
- (c) wrong session identity — **REFUTED** (the sessionId is byte-identical);
- (b) listener not attached — **CONFIRMED**;
- (d) event lost during lifecycle replacement — **CONFIRMED**.

### 07.3.3 Subscription reattachment IS the necessary repair — PROVEN

The single causal intervention (re-attach after the replacement) restores the
observation, restores the correlation with a fresh runId, and flips the REAL Elm
kernel from `hold / [pending_prompt, scheduled_continuation]` to `authorize` with zero
hold reasons.

### 07.3.4 The production gap that let this happen — CLOSED

The rebind existed on the follow-up-resume path only. The five
`SdkSessionLifecycle.replaceActiveSession` callers (mode switch, terminal execution
mode, provider change, MCP/config change, auto-approval) replaced the
`SessionRuntime` with a stale listener. The repair rebinds at that single
chokepoint, with the same identity fence the follow-up-resume rebind uses.

## 07.4 What is NOT claimed

- The installed extension was NOT qualified or declared fixed. No live install was
  performed and no installed behavior was verified.
- The incident bundle remains globally truncated (`evidenceLoss: true`); this ACT did
  not add diagnostic instrumentation to the bundle.
- The OPPOR01 synthetic counterfactual was NOT rewritten. It remains a historical
  witness and still PASSES.
- 19 bridge-stream and N base-stream test failures remain, all PRE-EXISTING and
  unrelated (see `04-verification-and-regression.md` and
  `05-base-stream-regression.md`). This ACT introduced ZERO new failures.
- No Elm completion policy was weakened. No run id was fabricated. C9/C10, BCB and
  session-ownership were not touched.

## 07.5 Successor

`ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01-INSTALL-QUAL01` — bind the built
artifact to the exact source HEAD and qualify the INSTALLED behavior separately (a
live session that performs a mode / provider switch and then observes a continuation
turn reaching the Elm completion authority with a matching
`continuation_started(promptId, runId)`).
