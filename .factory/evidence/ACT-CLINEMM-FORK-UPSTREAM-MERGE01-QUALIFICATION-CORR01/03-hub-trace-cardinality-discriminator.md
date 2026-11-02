# ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01 — C2 Hub Trace-Cardinality Discriminator

## 0. The question, stated exactly

> Does the upstream remote-hook filter change required ClineMM trace
> coverage, event identity, ordering or cardinality?

**Answer: NO.** The upstream optimization is PRESERVED. No remedy was needed
and none was applied. The reasoning below is EXERCISED, not inferred.

## 1. What the upstream change actually is

Upstream commit `94980446c` — *"fix(hub): stop forwarding per-chunk stream
events to remote onEvent hooks (#14120)"* — added a filter inside
`sdk/packages/core/src/hub/server/hub-client-contributions.ts`:

```ts
const STREAMING_EVENT_TYPES = new Set<AgentRuntimeEvent["type"]>([
	"assistant-text-delta",
	"assistant-reasoning-delta",
	"tool-updated",
]);

// inside createHookProxies():
hooks[name] = async (ctx: unknown) => {
	if (
		name === "onEvent" &&
		STREAMING_EVENT_TYPES.has((ctx as AgentRuntimeEvent).type)
	) {
		return undefined;
	}
	const response = await requestCapability(
		sessionId,
		contribution.capabilityName,
		{ context: ctx },
		targetClientId,
	);
	return response?.control;
};
```

A LATER upstream commit, `590785eff` — *"feat(telemetry): report per-run stall
signals (#15228)"* — added `"tool-call-delta"` to the same set, because
tool-argument streaming now emits that progress event.

### 1.1 The filter set in the MERGED tree is FOUR types, not three

This ACT's first executed check found that the ACT brief's framing ("the
three delta types") does not describe the merged tree. In upstream head
`a6507a62` the set is:

```
assistant-text-delta | assistant-reasoning-delta
tool-call-delta      | tool-updated
```

and the merged ClineMM tree's `hub-client-contributions.ts` is
**BYTE-IDENTICAL to upstream head** for that file:

```
$ git show a6507a62:sdk/packages/core/src/hub/server/hub-client-contributions.ts \
    > /tmp/upstream-hub-client-contributions.ts
$ diff /tmp/upstream-hub-client-contributions.ts \
       sdk/packages/core/src/hub/server/hub-client-contributions.ts
IDENTICAL TO UPSTREAM HEAD
```

The file was **not** a merge conflict; it landed clean and unmodified.

### 1.2 The filter commits ARE in the merged tree

```
$ git merge-base --is-ancestor 94980446c HEAD  →  TRUE
$ git merge-base --is-ancestor 590785eff HEAD  →  TRUE
$ git merge-base --is-ancestor 94980446c 265044bf3  →  FALSE  (not in fork baseline)
```

So the upstream optimization is genuinely present at this ACT's HEAD. This
is NOT a "the commit was deferred" situation — it landed, and the
question is whether it harmed the fork.

## 2. The three paths that matter

| Path | What it is | Is it the hub's filtered hook proxy? |
|---|---|---|
| **Portable-trace PRODUCER** — `ModelBehaviorTraceSink` (`apps/vscode/src/sdk/model-behavior-trace-runtime.ts:266`) | The ClineMM recorder's channel interface. Provided to the session as `modelBehaviorTraceSink` (`apps/vscode/src/sdk/vscode-session-host.ts:454`). Invoked INLINE by the agent runtime at each observation boundary (`sdk/packages/agents/src/agent-runtime.ts:3420`, `:3461`, `:3719`) and by the session orchestrator (`:2005`, `:2079`). | **NO** |
| **Hub `onEvent` PROXY** — `createHookProxies` (`sdk/packages/core/src/hub/server/hub-client-contributions.ts:519`) | Turns a *client-contributed* `onEvent` hook into a remote capability round trip carrying the full session snapshot. | **YES — this is the filtered path** |
| **RECORDING CONSUMER** — `ModelBehaviorTraceRecorder` → `model-behavior-trace.jsonl` → `apps/vscode/src/sdk/normalize-agent-trace.ts` (the `agent-trace/0.1` portable normalizer) | Reads the recorder's JSONL. Consumes the sink's records. | **NO** |

The two paths are **structurally disjoint**: `createHookProxies` is the only
place that turns an `onEvent` hook into a remote capability call, and no
`ModelBehaviorTraceSink` channel is ever routed through it. The `onEvent`
fan-out chain (`agent-runtime.ts:5551` → `session-runtime-orchestrator.ts:326`
→ `local-runtime-host.ts:1208`) and the sink fan-out
(`agent-runtime.ts:3420/3461/3719`) never intersect.

## 3. What was EXERCISED

Two new witness files were added by this ACT. They assert from EXECUTION,
never from the diff.

| File | Package | What it drives |
|---|---|---|
| `sdk/packages/core/src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts` | `@cline/core` | The REAL `createHubClientContributionRuntime` hook proxy, with a REAL client-contributed `onEvent` hook, driven with the representative events. |
| `sdk/packages/agents/src/agent-runtime.hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts` | `@cline/agents` | The REAL `AgentRuntime` with a scripted model emitting assistant TEXT deltas, assistant REASONING deltas, a TOOL CALL, and a real TOOL UPDATE from inside the executor. |

### 3.1 D1 — the upstream optimization is real and localized (EXERCISED)

Seven representative events were driven through the real hub hook proxy:

| Event | Upstream-filtered? | Reached the remote hook? |
|---|---|---|
| `assistant-text-delta` | YES | **NO** |
| `assistant-reasoning-delta` | YES | **NO** |
| `tool-call-delta` | YES | **NO** |
| `tool-updated` | YES | **NO** |
| `tool-started` | no | YES |
| `tool-finished` | no | YES |
| `message-added` | no | YES |

Observed: **3 capability calls** (the control group), 0 for the four
filtered types. Every forwarded call carried the `hook.onEvent` capability
name and the `{ context: ctx }` payload, with the event identity intact.

This is the upstream optimization working exactly as upstream intended.

### 3.2 D2 — the recorder does not consume the filtered path (EXERCISED)

- The hub contribution runtime exposes **no** `modelBehaviorTraceSink`
  surface — a client contributing only `onEvent` gains no recorder channel.
- Driving a filtered `assistant-text-delta` through the hub proxy produced
  **0 capability calls**, while the recorder's direct channel still fired.

### 3.3 D3 — coverage, identity, ordering, cardinality (EXERCISED)

The real `AgentRuntime` ran a two-turn task with a tool that emits a real
`tool-updated` progress event from inside its executor. The recorder's
observations were asserted:

**COVERAGE** — every channel the real run crosses fired:
`effective_model_config`, `model_request_start`, `model_request_finish`,
`tool_start`, `tool_finish`.

**CARDINALITY** — exactly one record per boundary:

| Channel | Observed | Expected |
|---|---|---|
| `effective_model_config` | 2 | 2 (one per turn) |
| `model_request_start` | 2 | 2 |
| `model_request_finish` | 2 | 2 |
| `tool_start` | **1** | 1 |
| `tool_finish` | **1** | 1 |

No duplication and no loss. The upstream filter can neither inflate nor
deflate these counts, because it is not on this path.

**ORDERING** — `model_request_start` precedes `tool_start` precedes
`tool_finish`, and the second turn's `model_request_start` follows the
first turn's `model_request_finish`.

**IDENTITY** — every record carries `sessionId = "session-c2"`, a defined
string `runId`, and `iteration >= 1`; the tool records carry the
`toolCallId = "tc-1"` / `toolName = "read_file"` correlation that joins
them.

**EQUIVALENCE** — the same task executed with tracing OFF produced the
identical tool-call sequence, confirming the recorder is pure observation
and the filter changes no control flow.

## 4. Verdict

| Question | Verdict |
|---|---|
| Does the upstream remote-hook filter change required ClineMM trace COVERAGE? | **NO** |
| Does it change event IDENTITY? | **NO** |
| Does it change ORDERING? | **NO** |
| Does it change CARDINALITY? | **NO** |
| Is a protected consumer affected? | **NO** — no `ModelBehaviorTraceSink` channel is routed through `createHookProxies` |
| Was the upstream optimization PRESERVED? | **YES** — byte-identical to upstream head, both filter commits are ancestors of HEAD |

**The upstream optimization is preserved. No remedy was implemented, because
no coverage was lost.**

### 4.1 On the U02 deferral note

U02's triage recorded `94980446c` as DEFERred with the reason *"changes
per-chunk event granularity, which the fork's portable-trace provenance
depends on"*. This discriminator shows that reason was **over-cautious but
not wrong to act on**: the deferral did land in the merge (the file was not
a conflict and upstream's version won cleanly), and the fork's trace
provenance is nevertheless intact because the recorder never consumed the
filtered path.

The discriminator's own first iteration asserted that `tool-call-delta` was
in the CONTROL group. That assertion FAILED against the real code, which
is what surfaced the four-type filter set of §1.1 — the discriminator
corrected the ACT brief's own framing by execution rather than by reading.
This is recorded because it demonstrates the discriminator has teeth: it
failed loudly when its expectation did not match the code.

## 5. Remedy implemented

**None.** Per the ACT's instruction — *"Preserve the upstream optimization
if no protected consumer is affected. If coverage is lost, implement the
smallest remedy at the correct boundary. Do not infer a regression from the
filter alone."* — no protected consumer is affected, so the optimization
stands and no code was changed.

The ONLY production-adjacent change this ACT makes is the ADDITION of the
two witness files above, which are tests and change no runtime behavior.
