# ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 — C1

**C1: GO — evidence acquisition only. No production repair.**

```text
ACT_ID:   ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01
TYPE:     bounded forensic reconciliation (evidence acquisition only)
VERDICT:  FORENSIC_BOUNDARY_ESTABLISHED
HISTORICAL_SUBJECT: 1abfcd629fdccba5557ab15a6b7bec1128d3d660
FROZEN_SESSION:     1795639776267_j3nki
FROZEN_RUN:         run_kR2y9UwW
EVIDENCE_ARCHIVE:   clinemm-terminal-failure.0d3jQd.tar.gz
INTEGRATED_HEAD:    c166d9caf51136e52fc9fdaf866971615423a816
```

The integrated HEAD is the COMPARISON subject, not the historical installed
version. The historical dogfood subject remains `1abfcd629`.

## 0. Frozen observations — independently re-verified

The reviewer independently parsed the archive. This ACT re-parsed the same
archive from the frozen tarball and reproduced every number exactly:

| Observation | Reviewer | This ACT |
|---|---|---|
| SDK request captures | 88 (incl. one R2 selector) | 88 |
| Persisted model responses | 86 | 86 |
| Tool calls | 75 | 75 |
| Native editor calls | 0 | 0 |
| Output-exhausted responses | 18 | 18 (all `outputTokens === 1`) |
| Conciseness reminders | 17 | 17 |
| Recorded reasoning characters | 1,500,523 | 1,500,523 |
| Unsigned reasoning characters | 659,674 | 659,674 |
| Unsigned reasoning blocks | — | 18 |
| Signed reasoning blocks | — | 59 |
| Compaction transitions | 1 | 1 |
| `maxOutputTokens` on non-truncated captures | 8192 | 8192 (58 captures) |
| Selected effort on non-truncated captures | Low | Low |

The last 30 captures are size-truncated; their generation settings are NOT
directly observed and are not claimed.

Session totals are unaffected by the 18 exhausted responses: the session
persisted `tokensOut: 10334` across the whole run.

## 1. Causal matrix

| # | Finding | Verdict | Confidence |
|---|---|---|---|
| 1 | Reasoning usage authority | `REASONING_USAGE_LOSS_REPRODUCED` | SYNTHETIC_REAL_PRODUCTION_SEAM |
| 2 | Reasoning usage loss boundary | `PROVIDER_USAGE_SEMANTICS_PARTIALLY_ESTABLISHED` | SYNTHETIC_REAL_PRODUCTION_SEAM + CAPTURE_INSUFFICIENT |
| 3 | Unsigned reasoning wire retention | `UNSIGNED_REASONING_WIRE_RETENTION: ABSENT` | SYNTHETIC_REAL_PRODUCTION_SEAM |
| 4 | Unsigned reasoning budget contribution | `UNSIGNED_REASONING_BUDGET_CONTRIBUTION: PRESENT` | SYNTHETIC_REAL_PRODUCTION_SEAM |
| 5 | Request-budget wire equivalence | `REQUEST_BUDGET_WIRE_EQUIVALENCE: VIOLATED` | SYNTHETIC_REAL_PRODUCTION_SEAM |
| 6 | Recovery allowance reset rule | `RECOVERY_ALLOWANCE_RESET_ESTABLISHED` | SYNTHETIC_REAL_PRODUCTION_SEAM |
| 7 | Tool-less exhaustion accounting | `TOOLLESS_EXHAUSTION_ACCOUNTING_GAP_REPRODUCED` | SYNTHETIC_REAL_PRODUCTION_SEAM |
| 8 | Recovery-only output override | `RECOVERY_ONLY_OUTPUT_OVERRIDE_FEASIBILITY: FEASIBLE` | SYNTHETIC_REAL_PRODUCTION_SEAM |

### The causal chain

```
provider reports output_tokens: 1  (no reasoning breakdown)
        │
        ▼
AI SDK anthropic convertAnthropicUsage  →  outputTokens.text = undefined
        │
        ▼
production normalizeUsage  →  outputTokens = 1, reasoningTokenCount ABSENT
        │
        ▼
persisted per-message metrics  →  { outputTokens: 1 }
        │
        ▼
session totals  →  the 18 exhausted responses contribute 18 output tokens
```

The `outputTokens: 1` is NOT a truncation artefact in the persisted value: it
is the provider's own reported count, forwarded faithfully. What is missing is
the REASONING count that the response actually generated.

## 2. Priority 1 — Reasoning usage authority

**Question.** Why do all 18 output-exhausted responses persist exactly one
output token despite containing substantial generated reasoning?

**Chain traced (the real production chain).**

```
provider SSE `message_start` usage + `message_delta` usage
  → @ai-sdk/anthropic  convertAnthropicUsage()          (SDK 4.0.94)
  → normalizeUsage()                                     (llms/providers/ai-sdk.ts:1268)
  → gateway `usage` event
  → compat.ts → ApiStreamChunk                          (llms/providers/compat.ts:674)
  → apihandler-agent-model-adapter.ts → AgentModelEvent  (core/services/llms)
  → AgentRuntime.updateUsage() → usageDelta()            (agents/agent-runtime.ts:884)
  → per-message metrics → session totals
```

**The two decisive production facts.**

1. `REASONING_TOKEN_PATHS` (`ai-sdk.ts:1168`) recognises the reasoning
   breakdown under the OpenAI-family names
   (`output_tokens_details.reasoning_tokens`, `completion_tokens_details.reasoning_tokens`,
   `reasoningTokens`, `reasoning_tokens`) and the AI SDK's nested
   `outputTokens.reasoning`. It does **NOT** include Anthropic's own name
   `output_tokens_details.thinking_tokens`.

2. The Anthropic Messages contract — and therefore the `@ai-sdk/anthropic`
   provider — names the breakdown `thinking_tokens`
   (`anthropicReasoningMetadataSchema` / `convertAnthropicUsage`:
   `usage.output_tokens_details?.thinking_tokens`). The AI SDK maps it to its
   own nested `outputTokens.reasoning`, which the production normalizer DOES
   read — so the breakdown survives only while the provider uses Anthropic's
   name *and* the AI SDK is the one interpreting it.

**Executable receipt** —
`sdk/packages/llms/src/providers/routing/output-exhaustion-reasoning-usage-forensics01.test.ts`
(5/5 passing). Real gateway + real `@ai-sdk/anthropic` + injected fetch:

| Arm | Provider usage | Emitted `outputTokens` | Emitted `reasoningTokenCount` |
|---|---|---|---|
| A | `output_tokens: 1`, no breakdown | `1` | ABSENT |
| B | `output_tokens: 900`, `reasoning_tokens: 800` | `1900` | `800` |
| C | `output_tokens: 8192`, `thinking_tokens: 7000` | `8192` | **ABSENT — LOST** |

**Dispositions.**

- `REASONING_USAGE_AUTHORITY`: the persisted `outputTokens` is the provider's
  own reported total, forwarded faithfully. It is NOT an estimate and NOT
  derived from characters.
- `REASONING_USAGE_LOSS_BOUNDARY`: the loss occurs at the provider boundary,
  not in the runtime. The Anthropic-named breakdown (`thinking_tokens`) is
  present in the AI SDK's nested `outputTokens.reasoning` only when the
  provider used Anthropic's name; a provider using OpenAI's name is read by
  `normalizeUsage`'s explicit `reasoning_tokens` path. **A provider that
  reports NEITHER name yields NO reasoning metric at all**, and the runtime
  then persists the provider's total output with the reasoning absent.
- `PROVIDER_USAGE_SEMANTICS_PARTIALLY_ESTABLISHED`: the historical provider's
  RAW usage was NOT captured. The archive's 88 captures are REQUEST captures
  (`captureStage: "ai_sdk_prompt"`); they contain no response usage. The
  `output_tokens: 1` values found in `messages.json` are source-code
  excerpts inside tool results, not provider diagnostics. The historical
  provider boundary is therefore **CAPTURE_INSUFFICIENT**, and the
  normalization behaviour above is reproduced with the existing synthetic
  MiniMax provider fixtures.

**No reasoning token count is inferred from characters anywhere in this ACT.**

## 3. Priority 2 — Unsigned reasoning projection

**Questions.** Does the unsigned exhausted reasoning retained in the canonical
history reach the serialized HTTP body? Does the request-budget estimator
count it?

**Executable receipt** —
`sdk/packages/llms/src/providers/output-exhaustion-wire-forensics01.test.ts`
(6/6 passing). Real gateway → real `toAiSdkMessages` → real
`@ai-sdk/anthropic` → injected fetch. Canonical history carries the exact
historical provenance: the SIGNED blocks carry the real
`originAuthority` (`minimax\u0000https://api.minimax.io\u0000/anthropic/v1`),
the UNSIGNED block carries none.

| Property | Result |
|---|---|
| Unsigned exhausted reasoning on the wire | **ABSENT** — not in the body, not in the text |
| Signed reasoning on the wire | **CONSERVED**, both signatures intact |
| Outbound body with vs. without the unsigned block | **BYTE-IDENTICAL** |
| Tool-call / tool-result identity | CONSERVED in both arms |
| Request-budget estimate with vs. without the unsigned block | **DIFFERS** (measured contribution 55 tokens for a 131-character block) |

**The two boundaries that produce the divergence.**

1. The wire drops it: the `@ai-sdk/anthropic` serializer emits a
   `thinking` block ONLY when the part carries `providerOptions.anthropic.signature`
   (or `redactedData`). With neither, the block is dropped with a
   `"unsupported reasoning metadata"` warning. The reasoning TEXT is gated by
   the same branch, so the exhausted reasoning never reaches the provider.
2. The budget counts it: the runtime measures the request budget over the
   SAME provider-visible projection it dispatches
   (`agent-runtime.ts`: the budget check and the dispatch both call
   `toProviderVisibleMessages(request.messages)`), and that projection
   RETAINS the unsigned `thinking` block. The compaction trigger uses the
   same class of projection (`context.apiMessages` =
   `agent.prepareProviderMessagesForApi(messages)` =
   `MessageBuilder.buildForApi`).

**Dispositions.**

- `UNSIGNED_REASONING_WIRE_RETENTION`: **ABSENT**. The unsigned exhausted
  reasoning is retained in canonical history but contributes NOTHING to the
  outbound HTTP body.
- `UNSIGNED_REASONING_BUDGET_CONTRIBUTION`: **PRESENT**. It is measured by
  the request-budget estimator and by the compaction-trigger estimate, at
  the conservative 3-characters-per-token rate.
- `REQUEST_BUDGET_WIRE_EQUIVALENCE`: **VIOLATED**. The request budget
  charges for content the provider never receives.

**CMP-09 coordination.** No committed CMP-09 implementation or evidence
exists in either repository (verified by `git log --all`, `git ls-files` and
the source repository's local `main` at `e740e3dd`). The discriminator
therefore REUSES the existing production harness — the real gateway and the
real MiniMax wire fixtures already in this package
(`minimax-m31-wire-reasoning-trace01.test.ts`,
`minimax-low-default-output01.test.ts`) — rather than building a second
equivalent serialization harness. CMP-09 retains ownership of
compaction-trigger causality and of any subsequent budget-authority repair.

**Origin authorization was NOT weakened.** The UNSIGNED block carries no
`originAuthority` in the historical session, so it had no replay authority
in the first place. The discriminator reproduces the historical provenance
exactly and observes the production fail-closed behaviour.

## 4. Priority 3 — Recovery allowance and lifecycle

**Question.** What exact rule allowed 17 conciseness reminders despite the
advertised three-attempt allowance?

**The rule, as implemented** (`sdk/packages/agents/src/agent-runtime.ts`):

- `MAX_TOKENS_RECOVERY_LIMIT = 3` (line 158).
- `recoverFromIncompleteMaxTokensTurn()` (line 4544) increments
  `maxTokensRecoveryCount` and injects the conciseness reminder, up to the
  limit.
- The counter is reset in exactly TWO places:
  - line 4059 — the start of a RUN (`resetRunState`),
  - line 4241 — **`if (toolCalls.length > 0) this.maxTokensRecoveryCount = 0;`**
    — a turn that yields ANY tool call.
- The reset at line 4241 is keyed on the PRESENCE of a tool call. It is NOT
  keyed on the tool call's productivity, and it is NOT keyed on whether the
  tool call represented engineering progress. A mere `read_files` inspection
  replenishes the allowance.

**Why the run never terminated.** The reset at line 4240 is UNREACHABLE for
an output-exhausted turn: the `finishReason === "max-tokens" && toolCalls.length === 0`
branch (line 4221) `continue`s the loop at line 4229, BEFORE line 4241.
So an exhausted turn consumes one allowance unit and cannot itself reset the
counter; only a *different*, tool-calling turn can.

**Executable receipt** —
`sdk/packages/agents/src/agent-runtime.output-exhaustion-recovery-allowance-forensics01.test.ts`
(5/5 passing). Real `AgentRuntime`, scripted model, no provider:

| Arm | Result |
|---|---|
| Four consecutive tool-less exhaustions | run FAILS with `maximum output token limit` after 4 requests (the advertised bound) |
| exhaust → inspect → exhaust → inspect → … (8 pairs) | the run does NOT stop at the fourth consecutive exhaustion; **11 distinct conciseness reminders** were injected into ONE run |
| The inspections produced no edit and no executed command | the allowance was still replenished — the reset is keyed on tool-call PRESENCE, not productivity |
| Four consecutive tool-less exhaustions with R1 enabled | **ZERO** R1 stagnation notices |
| One tool-calling round with R1 enabled | R1 stagnation notice IS injected (an inspection with no edit and no command counts as UNPRODUCTIVE) |

**The frozen session's own trajectory confirms it.** Replaying the frozen
canonical history against the production rule:

- maximum consecutive streak observed = **3** (exactly
  `MAX_TOKENS_RECOVERY_LIMIT`),
- the allowance was **reset 9 times** by tool-calling turns
  (`run_commands` 54, `read_files` 20, `myc__myc_recall` 1),
- total conciseness reminders = **17**.

**Dispositions.**

- `RECOVERY_ALLOWANCE_RESET_ESTABLISHED`: the allowance is a
  PER-CONSECUTIVE-FAILURE allowance whose streak is reset by ANY turn that
  yields a tool call — including a read-only inspection. It is NOT
  run-scoped in the way the R1 instruction allowance is (the R1 allowance
  explicitly survives a streak reset, `foldExecutionRound`). The advertised
  "three-attempt" bound therefore bounds only the CONSECUTIVE streak, not
  the number of reminders in a run.
- `TOOLLESS_EXHAUSTION_ACCOUNTING_GAP_REPRODUCED`: a tool-less
  output-exhausted response contributes NOTHING to the R1 execution-stagnation
  accounting. `evaluateExecutionStagnation()` runs at the iteration boundary
  (line 4320), which the max-tokens branch's `continue` (line 4229) never
  reaches. The stall that the R1 mechanism exists to detect is therefore
  INVISIBLE to it. The R1 accounting is reached only by turns that produce a
  tool call — and an inspection with no edit and no executed command is
  itself classified UNPRODUCTIVE, so it *does* trigger R1 while *also*
  replenishing the max-tokens allowance. The two recovery mechanisms pull in
  opposite directions on the same turn.

- **Terminal exhaustion and R2 eligibility.** The terminal exhaustion (the
  `MAX_TOKENS_INCOMPLETE_TURN_MESSAGE` throw at line 4233) is reached only
  when `recoverFromIncompleteMaxTokensTurn()` returns false, i.e. when the
  consecutive streak reaches 3. R2's entry point is the R1
  `allowance_exhausted` branch, which is reached only from
  `evaluateExecutionStagnation()` — a path a tool-less exhausted turn never
  takes. **A tool-less exhaustion streak that never observes a tool-calling
  round therefore cannot reach R2 at all.** Whether R2 is eligible for the
  terminal exhaustion is therefore NOT established by this ACT's evidence:
  the R2 entry requires an observed unproductive ROUND, and the frozen
  session's exhaustion streaks are tool-less. Label: INFERRED (from the
  production control flow) — not directly exercised.

## 5. Priority 4 — Recovery-only generation headroom

**Question.** Does an existing request-level override permit ONE recovery
inference at 16384 output tokens while preserving the global 8192 default,
the selected LOW effort, the model/provider identity, the tool
authorization and the run's completion obligations?

**The existing contract, traced end to end.**

```
AgentModelRequest.options.maxTokens            (shared/agent.ts:684 — options is Record<string, unknown>)
  → GatewayStreamRequest.maxTokens             (llms/providers/gateway.ts:291-293)
  → maxOutputTokens on the AI SDK request       (llms/providers/ai-sdk.ts:365)
  → the wire's `max_tokens`                     (SDK anthropic provider)
```

The reasoning (effort) travels on an INDEPENDENT field
(`GatewayStreamRequest.reasoning`), so a per-request output override cannot
change it.

**Executable receipt** —
`sdk/packages/llms/src/providers/routing/output-exhaustion-recovery-headroom-forensics01.test.ts`
(3/3 passing) plus the EXISTING, already-passing
`minimax-low-default-output01.test.ts` (10/10, arm D2):

| Arm | `max_tokens` | `output_config` |
|---|---|---|
| No override (the global default) | `8192` | `{ effort: "low" }` |
| One request with `maxTokens: 16384` | `16384` | `{ effort: "low" }` |
| A SUBSEQUENT request with no override | `8192` | `{ effort: "low" }` |

**Disposition.** `RECOVERY_ONLY_OUTPUT_OVERRIDE_FEASIBILITY: **FEASIBLE**`.

A single 16384-token recovery request is reachable through the EXISTING
request-level contract without changing the global 8192 default, without
changing the selected LOW effort, and without changing the model/provider
identity. The override is per-request: the default is unchanged for every
other request in the run.

**Boundaries the design must respect (established, not yet exercised):**

- The request-budget ceiling is enforced over the provider-visible
  projection, so a larger output allowance does not by itself change the
  INPUT budget. The model output cap (524288 for M3.1 Flash) still clamps.
- The remaining-context clamp still applies: when the configured context
  window leaves less room than the requested allowance, the clamp wins
  (existing arm D9).
- The override must be scoped to the RECOVERY turn only. Nothing in the
  evidence authorises changing the default for ordinary turns.

**The controlled behavioural discriminator this ACT's evidence supports (NOT
executed).** One run, one model, `MiniMax-M3.1-Flash`, effort LOW, the
global default left at 8192, and a SINGLE recovery request carrying
`options.maxTokens = 16384`. The observable is whether that one request
produces a tool call that the 8192-budget trajectory did not. Two arms:

- Arm A: the current production behaviour (8192 on every request),
- Arm B: the identical run with exactly ONE recovery request at 16384.

The discriminator distinguishes INSUFFICIENT GENERATION HEADROOM (Arm B
produces the tool call) from EXECUTION INERTIA (Arm B does not). No paid
inference is executed in this ACT.

## 6. Smallest next repair (RECOMMENDATION ONLY — NOT IMPLEMENTED)

The evidence supports FOUR independent boundaries. They are separable; the
smallest repair that the evidence actually supports is stated first.

### R-A (SMALLEST, HIGHEST CONFIDENCE) — make the request-budget measure the
### WIRE

**Boundary.** The request-budget estimator and the compaction-trigger estimate
measure the provider-visible projection, which RETAINS the unsigned exhausted
reasoning; the Anthropic wire DROPS it. The request budget therefore charges
for content the provider never receives, and the charge compounds with every
output-exhausted turn.

**Why this is the smallest.** It is a MEASUREMENT-CONSERVATION correction at
one already-existing seam: the estimator's input must be the same
representation the provider receives. It changes no policy, no allowance, no
model identity and no authorization.

**Evidence.** `REQUEST_BUDGET_WIRE_EQUIVALENCE: VIOLATED` — the outbound
body is byte-identical with and without the unsigned block, while the
measured estimate differs by 55 tokens for a 131-character block.

**Owner.** CMP-09 (compaction-trigger causality and budget authority).

### R-B — widen the reasoning-breakdown vocabulary at `normalizeUsage`

**Boundary.** `REASONING_TOKEN_PATHS` does not include Anthropic's own
`output_tokens_details.thinking_tokens`. A provider that reports the
Anthropic-named breakdown and is NOT interpreted by the AI SDK's Anthropic
provider loses the count entirely, and the persisted output then contains the
provider's total with the reasoning absent.

**Evidence.** `REASONING_USAGE_LOSS_REPRODUCED` — arm C loses 7000 reasoning
tokens.

**Owner.** The provider-usage accounting boundary.

### R-C — bound the max-tokens recovery allowance by RUN, not by streak

**Boundary.** `maxTokensRecoveryCount` is reset by ANY tool-calling turn, so
a read-only inspection replenishes the allowance and the advertised
three-attempt bound does not bound the reminders in a run. The R1
instruction allowance already demonstrates the run-scoped pattern
(`foldExecutionRound` preserves `instructionsInjected` across a streak
reset).

**Evidence.** `RECOVERY_ALLOWANCE_RESET_ESTABLISHED` — 11 reminders in one
run; 17 in the frozen session; maximum consecutive streak exactly 3.

**Caveat.** This changes an advertised recovery policy and is therefore NOT
a forensic repair. It needs its own ACT.

### R-D — make tool-less exhaustion observable to R1

**Boundary.** `evaluateExecutionStagnation()` is unreachable for a tool-less
exhausted turn, so the stall the R1 mechanism exists to detect is invisible
to it, and such a streak can never reach R2's `allowance_exhausted` entry.

**Evidence.** `TOOLLESS_EXHAUSTION_ACCOUNTING_GAP_REPRODUCED` — four
consecutive tool-less exhaustions with R1 enabled produce ZERO stagnation
notices.

**Owner.** The R1/R2 recovery workstream.

### NOT RECOMMENDED YET

The recovery-only 16384-token override is FEASIBLE
(`RECOVERY_ONLY_OUTPUT_OVERRIDE_FEASIBILITY: FEASIBLE`) but the evidence does
NOT yet establish that generation headroom is the binding constraint. The
frozen session's exhausted responses generated 659,674 unsigned reasoning
characters across 18 responses — roughly 36,649 characters each, about 12,216
tokens each of reasoning. That is SUBSTANTIAL reasoning against an 8192
output allowance, which is consistent with the model spending its allowance
on reasoning rather than on the tool call it never produced. It is NOT
evidence that a larger allowance would have produced the tool call, and no
character-to-token conversion is used here to claim it.

The controlled discriminator in §5 would settle it. It is NOT executed in
this ACT.

## 7. Integration record

```text
DESTINATION_ROOT:    /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-second
DESTINATION_ENTRY_HEAD: 1f4d87da241e619f01366d4710ea29d7580c0b85
SOURCE_ROOT:         /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
SOURCE_HEAD:         e740e3dd92e9091cf9c6d5d54627abb11c72fbbd
MERGE_BASE:          1d45a8d845eca27bce311949a08fca7868f211cd
CONFLICTS_RESOLVED:  .factory/epic-board.md (documentary; both sides preserved verbatim)
INTEGRATED_HEAD:     c166d9caf51136e52fc9fdaf866971615423a816
BOTH_ANCESTORIES_PRESERVED: YES (rev-list --parents shows both parents)
SOURCE_REPOSITORY_UNCHANGED: YES (HEAD, worktree and stash inventories unchanged)
CMP09_EVIDENCE_AVAILABILITY: NONE
TRACKED_DIRT:        none beyond this ACT's own files
```

Integration gates: SDK rebuild PASS; typecheck shared/llms/agents PASS;
typecheck core unchanged (45 pre-existing test-file errors, byte-identical to
the pre-merge baseline minus one the merge FIXED — zero merge-introduced
errors); focused suites agents 160 / core 74 / shared 67 PASS; llms
`ai-sdk-reasoning.test.ts` 15 failures IDENTICAL to the pre-merge baseline
(pre-existing, merge introduced none); Biome CLEAN on all six merged
production files.

## 8. Closure

```text
REASONING_USAGE_AUTHORITY:        provider-reported total, forwarded faithfully
REASONING_USAGE_LOSS_BOUNDARY:    provider boundary (reasoning breakdown name / absence)
UNSIGNED_REASONING_WIRE_RETENTION: ABSENT
UNSIGNED_REASONING_BUDGET_CONTRIBUTION: PRESENT
RECOVERY_ALLOWANCE_RESET_RULE:    any tool-calling turn resets the consecutive streak
TOOLLESS_EXHAUSTION_STAGNATION_ACCOUNTING: GAP REPRODUCED (R1 never sees it)
RECOVERY_ONLY_OUTPUT_OVERRIDE_FEASIBILITY: FEASIBLE (existing per-request contract)
SMALLEST_NEXT_REPAIR:             R-A — make the request-budget measure the WIRE
FINAL_HEAD:                       (this commit)
TRACKED_DIRT:                     none beyond this ACT's own files
```

No production repair. No new diagnostics framework. No R3 implementation. No
paid inference. No VSIX packaging. No Factory documentation campaign. The
frozen archive was read only and is unchanged.
