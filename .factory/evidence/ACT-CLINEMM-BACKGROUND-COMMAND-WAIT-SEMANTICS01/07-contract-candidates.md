# 07 — Candidate evaluation

Four candidates, evaluated against the recon in §3-§6 and the
ACT rubric D1-D10.

## 7.1 Candidate A — `WS-A_MODEL_POLLING_ONLY`

```text
Semantics:
  Proceed While Running
  → runtime manages process only
  → model retains responsibility for polling
  → model must not emit done until requested wait completes
  → if model emits done, user regains control
  → terminal event never wakes model
```

**Advantages**:
- Minimal runtime complexity (current canonical contract).
- Matches today's `run_commands` schema (no schema change).
- No asynchronous model resurrection.
- No new wire/tool fields.

**Risks**:
- Model may abandon long waits (the LIVE specimen is exactly this).
- Wastes model turns/tokens on polling.
- "Let me keep waiting" may not survive provider/model behavior.
- Cannot guarantee user's wait obligation (no enforcement).
- Poor fit for 8-minute / 30-minute operations.

**Rubric check**:

| # | Requirement                                   | Verdict | Note |
|---|-----------------------------------------------|---------|------|
| D1 | Literal "wait until finished" predictable    | **NO**  | The LIVE specimen shows the model's "let me wait" was not honored. |
| D2 | Fire-and-forget never resurrects agent       | YES     | No wake seam at all. |
| D3 | Runtime does not parse NL to infer intent    | YES     | No inference attempted. |
| D4 | Long waits do not require tight polling      | **NO**  | Polling-only is the only way to honor "wait". |
| D5 | Failure/cancel/deadline behavior defined     | PARTIAL | Failure → tool error already works; deadline/cancel are tool-side, not wait-side. |
| D6 | Newer-turn/concurrent-work behavior defined  | YES     | No wake; no surprise. |
| D7 | Session identity + exactly-once possible     | YES     | Not exercised (no wake). |
| D8 | Product wording matches runtime               | **NO**  | F4 says "run them in background, redirect to tmp file" — does NOT promise wait semantics. |
| D9 | Implementable on existing seams               | YES     | It IS the current implementation. |
| D10| No dependence on stale card                   | YES     | Card stays as-is. |

**Candidate A fails D1, D4, D8.** That is three of the ten rubric
items. It is a contract that says "the runtime promises nothing
about wait", but the user reads "wait until finished" as a
promise. The mismatch is observable in the LIVE specimen.

## 7.2 Candidate B — `WS-B_EXPLICIT_NOTIFY_ON_TERMINAL`

```text
Semantics:
  background handoff
  + explicit terminal-notification intent
  → agent may end current turn
  → command continues
  → terminal event sends bounded stimulus to owning session
  → agent gets one continuation opportunity

Fire-and-forget:
  notify = false
  → no agent resurrection
```

This resembles upstream `notifyParent` but is not bound to copy
its prompt-based mechanism (the upstream emits steer_message with
a formatted text prompt; we can emit a typed prompt instead).

**Advantages**:
- Explicit semantics (the user/model must opt in).
- No continuous polling.
- Preserves fire-and-forget (notify=false).
- Works for long durations (no time cap on the wait).
- Failure/deadline are reportable (the terminal event covers all
  exit reasons).
- Reuses `PendingPromptsController.enqueue` and the identity
  conservation rules.

**Risks**:
- Requires durable intent representation (a new schema field OR a
  new CommandJob internal flag).
- Requires generation/session safety (already provided by existing
  identity rules; need to reuse).
- May consume additional model call asynchronously (cost).
- Needs UX/tool-surface decision (where does the user/model set
  `notify=true`? new `run_commands` field, or new tool variant?).
- Requires exactly-once semantics (enforceable via the identity
  rules + single-wake consumption).

**Rubric check (post-CORRECTION02, honest v1 scope)**:

| # | Requirement                                   | Verdict | Note |
|---|-----------------------------------------------|---------|------|
| D1a| strict WAIT predictable                       | NO / OUT_OF_V1 | strict WAIT ("no Your turn before final answer") is deferred to a future cycle requiring Candidate C architecture. |
| D1b| v1 WAIT(v1)→NOTIFY mapping predictable        | YES     | The v1 contract collapses WAIT to NOTIFY (see §8.1, §14.1); the wake is one bounded stimulus delivered via PendingPromptsController.enqueue. |
| D2 | Fire-and-forget never resurrects agent       | YES     | notify=false (the default if not opted-in) is exactly fire-and-forget. |
| D3 | Runtime does not parse NL to infer intent    | YES     | Intent is structured (the schema field). |
| D4 | Long waits do not require tight polling      | YES     | Notification replaces polling. |
| D5 | Failure/cancel/deadline behavior defined     | YES     | The terminal event covers all three; one bounded stimulus. |
| D6 | Newer-turn/concurrent-work behavior defined  | YES     | delivery:"queue" (see §10.3, §10.8). |
| D7 | Session identity + exactly-once possible     | YES     | Existing identity rules enforce this; wake consumer reuses (sessionId, taskId) per §10.8 lifetime invariant. |
| D8 | Product wording matches runtime               | YES     | Schema field + description = explicit promise (the v1 NOTIFY collapse is stated honestly). |
| D9 | Implementable on existing seams               | YES     | Reuses PendingPromptsController + per-job CommandJobManager.onCommandJobLifecycle event + identity-correlating machinery at coordinator seam. |
| D10| No dependence on stale card                   | YES     | Card projection unchanged. |

**Summary (post-CORRECTION02)**: B is the bounded v1 NOTIFY
contract. Strict WAIT (STRICT_WAIT) is deferred to a future cycle
requiring the suspended-tool state machine (Candidate C). B passes
the rubric when D1 is read as "D1a strict WAIT = NO/OUT_OF_V1;
D1b v1 WAIT(v1)→NOTIFY mapping = YES" — not "B honors literal
WAIT". The previous scoring ("D1 Literal 'wait until finished'
predictable = YES") is retracted. The selection basis is: **B is
the bounded v1 NOTIFY contract**, not "B fully implements literal
WAIT".

The remaining decision work is product-shaped: where does the
opt-in live, what is the default, what does the wake prompt
contain, and what are the deadline / cancel / multi-job /
extension-restart rules.

## 7.3 Candidate C — `WS-C_EXPLICIT_AWAIT_TERMINAL`

```text
Semantics:
  user/model marks command as awaited
  → agent task remains semantically incomplete
  → foreground model iteration may suspend
  → terminal process event resumes same obligation
  → final answer produced before user gets Your turn
```

This is stronger than notification. Conceptually: a tool call
suspends, the process terminal event resumes the same logical task.

**Advantages**:
- Best match for literal "wait until finished" (the model turn
  never yields until the command is terminal).
- Strong task semantics (no separate "wake up" prompt).
- No polling.
- Final answer is produced before user sees "Your turn".

**Risks**:
- Largest architectural change (requires suspended tool/turn ownership).
- Must survive restarts/session lifecycle (the suspension outlives
  process restarts, extension reloads, possibly machine suspend).
- May require a new persisted state machine (turn owns a suspended
  obligation that is projectable across restarts).
- Danger of turning temporary diagnostics into architecture
  (every async tool could eventually want this treatment).

**Rubric check**:

| # | Requirement                                   | Verdict | Note |
|---|-----------------------------------------------|---------|------|
| D1 | Literal "wait until finished" predictable    | YES     | The strongest match for the user phrasing. |
| D2 | Fire-and-forget never resurrects agent       | YES     | await=false is fire-and-forget. |
| D3 | Runtime does not parse NL to infer intent    | YES     | Intent is structured (the schema field). |
| D4 | Long waits do not require tight polling      | YES     | Suspension replaces polling. |
| D5 | Failure/cancel/deadline behavior defined     | YES     | Terminal event drives resumption. |
| D6 | Newer-turn/concurrent-work behavior defined  | PARTIAL | The suspension is per-tool-call; what if a NEW user turn arrives during the suspension? Needs explicit rule. |
| D7 | Session identity + exactly-once possible     | YES     | Existing identity rules; suspension bound to tool call id. |
| D8 | Product wording matches runtime               | YES     | Schema field + description = explicit promise. |
| D9 | Implementable on existing seams               | **NO**  | No current seam for suspended tool/turn ownership. Requires new state machine + restart-survival. |
| D10| No dependence on stale card                   | YES     | Card projection unchanged. |

**Candidate C fails D9.** It requires a new state machine that
does not exist and is not on the ClineMM roadmap as a near-term
item. This is the most architecturally invasive of the four
candidates.

## 7.4 Candidate D — `WS-D_EXPLICIT_MULTI_MODE`

```text
completion_behavior =
  poll
  notify
  detach
```

(or equivalent internal semantics)

| Intent | Model may end current turn? | Terminal wakes agent? | User receives immediate turn? |
| ------ | --------------------------- | --------------------- | ----------------------------- |
| wait   | maybe suspended, not complete | yes                | no                            |
| notify | yes                          | yes, later           | yes                           |
| detach | yes                          | no                   | yes                           |

The "wait" semantic here collapses to Candidate C. The "notify"
semantic collapses to Candidate B. The "detach" semantic
collapses to "current behavior". This is the most expressive but
also the largest product surface.

**Advantages**:
- All three intents are first-class.
- No intent is forced into the wrong semantic.
- Strong match for "ClineMM should let the user decide".

**Risks**:
- Largest product surface (three modes).
- Requires all of Candidate B's implementation plus Candidate C's.
- Requires structured schema (likely a `completionBehavior` enum).
- Default choice matters more (the user/model that doesn't
  choose has to pick from a default).

**Rubric check**:

| # | Requirement                                   | Verdict | Note |
|---|-----------------------------------------------|---------|------|
| D1 | Literal "wait until finished" predictable    | YES     | "wait" mode is Candidate C; honors the user intent. |
| D2 | Fire-and-forget never resurrects agent       | YES     | "detach" mode is fire-and-forget. |
| D3 | Runtime does not parse NL to infer intent    | YES     | All modes structured. |
| D4 | Long waits do not require tight polling      | YES     | "wait" suspends; "notify" replaces polling. |
| D5 | Failure/cancel/deadline behavior defined     | YES     | Per-mode. |
| D6 | Newer-turn/concurrent-work behavior defined  | PARTIAL | Per-mode; needs explicit rules. |
| D7 | Session identity + exactly-once possible     | YES     | Existing rules. |
| D8 | Product wording matches runtime               | YES     | All three modes explicit. |
| D9 | Implementable on existing seams               | **NO**  | Inherits Candidate C's implementation gap for the "wait" mode. |
| D10| No dependence on stale card                   | YES     | Card projection unchanged. |

**Candidate D fails D9 (inherited from C).** It is the union of B
and C; without C's architecture, it collapses to B with three
mode labels.

## 7.5 What the rubric says (post-CORRECTION02, honest v1 scope)

```text
A: fails D1, D4, D8 — current implementation, observable mismatch.
B: passes all ten rubric items WHEN D1 is read as
   "D1a strict WAIT = OUT_OF_V1; D1b v1 WAIT(v1)→NOTIFY mapping = YES".
   B is the bounded v1 NOTIFY contract; strict WAIT (STRICT_WAIT)
   is deferred to a future cycle. Smallest scope change that reuses
   existing seams.
C: fails D9 — requires new suspended-tool state machine.
   (C is the architecture that WOULD enable STRICT_WAIT.)
D: fails D9 (inherited) — superset of B + C.

The contract decision therefore favors B for v1 (NOTIFY contract),
with the option to evolve to D in a later cycle IF C's architecture
is funded (which would enable STRICT_WAIT as a future cycle).
```

## 7.6 What this ACT does NOT do

This ACT does not implement any candidate. The implementation
ACT will be a bounded successor (see §41 of the ACT body and
§18-successor-authorization.md in this evidence set).
