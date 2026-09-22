# ACT-CLINEMM-BACKGROUND-NOTIFY-EXACTLY-ONCE-PRESENTATION01

## 0. Mission

**Primary epistemic purpose: causal discriminator → bounded exactly-once repair.**

For one managed background command with `notifyOnCompletion=true`, establish
the cardinality of the complete production chain:

```text
CommandJob terminal commit
    ↓
BackgroundNotifyCoordinator terminal consumption
    ↓
terminal wake creation
    ↓
PendingPrompts enqueue
    ↓
pending prompt consumption
    ↓
agent continuation
    ↓
assistant completion presentation
```

Required invariant:

```text
ONE logical terminal event
→ AT MOST ONE autonomous wake
→ AT MOST ONE continuation turn
→ AT MOST ONE completion presentation
```

This ACT does **not** attempt to suppress legitimate notifications from
two different jobs.

---

## 1. Frozen predecessor state

Entry facts:

```text
LONG_HORIZON_OPERATOR_AUTHORITY   = LIVE_GREEN
PENDING_PROMPT_AUTHORITY          = CLOSED_CLEAN  (transport-neutral, correction03)
NOTIFY_ON_TERMINAL                = LIVE_GREEN  (BCNT01 closure, correction03)
TERMINAL_CARD_PROJECTION          = LIVE_GREEN  (BCTCP01 closure)
MULTI_JOB_PROJECTION              = LIVE_GREEN  (BTCONT01 closure)

DUPLICATE_COMPLETION_PRESENTATION = LIVE_OBSERVED
ROOT_CAUSE                        = UNRESOLVED
```

Preserve:

```text
RuntimeHost/ClineCore service architecture
Q5 outstanding-autonomous-work predicate
PendingPromptCountRead availability semantics
Hub/Remote ordering proof
CommandJob lifecycle state machine
PWAOR
BTCONT
terminal-card projection
```

Do not re-litigate them.

---

# 2. Exact question

For a **single `jobId`**, where does:

```text
cardinality = 1
```

first become:

```text
cardinality = 2
```

That boundary is the repair seam.

---

# 3. Recon before design

Map one production chain end-to-end.

Produce:

```text
03-cardinality-authority-map.md
```

Inventory these exact seams.

### A. Command lifecycle

Find:

```text
CommandJobManager terminal commit
command_job_terminal_committed
terminalPromise resolution
onCommandJobLifecycle
```

Determine whether terminality for one `jobId` can be published more than once.

### B. Notification coordinator

Inspect:

```text
BackgroundNotifyCoordinator.register...
consumeTerminal(...)
notificationMarkers
heldTerminalResults
marker deletion
exactly-once behavior
```

Determine whether multiple subscribers can consume the same terminal event.

### C. Tool runner

Inspect every location where the terminal promise is observed:

```text
terminalPromise.then(...)
onBackgroundStateChange(...)
notify coordinator consumer attachment
```

Look specifically for duplicated subscribers created by:

```text
RUNNING path
fast-terminal path
retry/reconstruction
host/session rebuild
```

### D. Pending prompt service

Map:

```text
enqueue
pending_prompts event
queue drain
steerFirst
runTurn({delivery:"queue"})
```

Determine whether one logical wake can be enqueued twice or consumed twice.

### E. Agent/session continuation

Map:

```text
pending prompt submitted
runTurn
agent_event done
next autonomous turn
```

### F. Presentation

Finally map:

```text
assistant response
clineMessages / translated messages
chat rows
completion notification/system message
```

This last layer matters only if upstream cardinality is still 1.

Label every edge:

```text
REAL_PRODUCTION_SEAM
STRUCTURAL
LIVE
SYNTHETIC_REAL
INFERRED
```

---

# 4. Do not assume what the two messages mean

First freeze a LIVE specimen.

Use a **single job**, not multi-job:

```sh
sh -c 'echo STARTED; sleep 30; echo FINISHED'
```

Instruction:

```text
Start exactly one managed background command with completion notification.

When it finishes, inspect the result and tell me once that it completed.
Do not start any other background command.
```

Capture:

```text
taskId
sessionId
jobId
timestamps of both visible completion messages
exact message text if distinguishable
```

If only one message appears:

```text
NOT_REPRODUCED
```

Do not invent a duplicate repair.

Repeat up to three times if necessary.

---

# 5. Cardinality trace

For the reproduced specimen, construct:

```text
04-live-cardinality-trace.md
```

For the same `jobId`, count:

```text
C1 terminal lifecycle commits
C2 notify coordinator consumeTerminal calls
C3 notification-marker consumptions
C4 generated terminal wake prompts
C5 PendingPrompts enqueue operations
C6 pending_prompts queue entries
C7 pending prompt submissions / drains
C8 autonomous runTurn invocations
C9 resulting model turns
C10 visible completion messages
```

The classification depends on the **first count > 1**.

---

# 6. Diagnostic policy

Prefer existing diagnostics/logging.

We already have enough observability that another permanent subsystem
would be suspicious.

Add instrumentation only if the current seams cannot distinguish cardinality.

If needed, one dogfood-only bounded record:

```ts
type BackgroundNotifyCardinalityRecord = {
  seq: number
  timestamp: string

  sessionId?: string
  taskId?: string
  jobId: string

  stage:
    | "terminal_committed"
    | "notify_consumed"
    | "wake_formatted"
    | "wake_enqueued"
    | "wake_dequeued"
    | "turn_started"
    | "turn_completed"
    | "presentation_committed"

  correlationId?: string
}
```

But **do not add this** if existing BJLA / coordinator / pending-prompt events
already provide the proof.

Temporary diagnostic must be:

```text
dogfood only
bounded FIFO
no semantic mutation
no public protocol
remove after cause isolated
```

---

# 7. Classification

Mechanically select exactly one primary class.

```text
DX1_TERMINAL_DUPLICATED
    One CommandJob reaches terminal authority more than once.

DX2_NOTIFY_SUBSCRIBER_DUPLICATED
    One terminal event reaches BackgroundNotifyCoordinator more than once,
    usually because the consumer/subscription was attached twice.

DX3_NOTIFY_CONSUMER_NOT_IDEMPOTENT
    One coordinator receives duplicate terminal input and generates
    multiple wakes for the same job.

DX4_WAKE_ENQUEUE_DUPLICATED
    Exactly one terminal consumption generates >1 PendingPrompts enqueue.

DX5_QUEUE_DELIVERY_DUPLICATED
    Exactly one queue entry is submitted/consumed more than once.

DX6_AUTONOMOUS_TURN_DUPLICATED
    Exactly one prompt causes >1 session/model continuation.

DX7_PRESENTATION_DUPLICATED
    One completed agent turn is rendered/notified twice.

DX8_TWO_DISTINCT_LOGICAL_NOTIFICATIONS
    The two observed messages correspond to different jobs/events
    and are semantically legitimate.

DX9_OTHER
```

No production repair before classification.

---

# 8. Load-bearing RED

The core RED should be cardinality-based, not text-based.

Example:

```text
BCNEX-RED-01

given:
  one session
  one task
  one job
  notifyOnCompletion=true

when:
  job reaches one terminal state

expect:
  terminal_committed == 1
  wake_enqueued == 1
  autonomous_continuation == 1
  completion_presentation == 1
```

Pre-fix:

```text
some stage N == 2
```

Post-fix:

```text
all stages == 1
```

The exact load-bearing assertion must be at the first duplicated seam.

---

# 9. Required ablation

Once the duplicated seam is found, prove necessity.

Example if DX2:

```text
consumer subscription count = 2
→ duplicate reproduced

single subscription
→ duplicate absent
```

Example if DX4:

```text
same terminal token allowed through enqueue twice
→ duplicate

dedupe by terminal identity
→ one enqueue
```

If the ablation does not eliminate the duplicate:

```text
HALT_CAUSE_NOT_ESTABLISHED
```

Do not patch a leading hypothesis.

---

# 10. Correlation identity

Prefer the narrowest stable identity already present:

```text
sessionId
taskId
jobId
```

For terminal notification semantics, `jobId` should normally be the
primary exactly-once identity.

Do **not** introduce:

```text
random dedupe UUID
```

if the authoritative job already supplies stable identity.

If a job can legitimately produce generations, retries, or multiple
semantic terminal notifications, prove that before extending the key.

---

# 11. Likely repair shapes

Only authorize the branch matching evidence.

## If DX1 — lifecycle duplicate

Repair terminal lifecycle authority.

Desired:

```text
running → one terminal state
terminal → terminal again = ignored
```

Do not patch downstream notification code to hide a lifecycle-authority bug.

---

## If DX2 — duplicate subscription

Repair subscription ownership.

Likely invariant:

```text
one notification marker
→ one terminal observer
→ observer disposed on marker consumption / session teardown
```

Check particularly whether consumer attachment happens both in:

```text
tool RUNNING path
and
some coordinator/host lifecycle path
```

---

## If DX3 — consumer idempotence

Make terminal consumption first-writer-wins:

```ts
if (!marker) {
  return
}

markers.delete(jobId)
consume(marker)
```

The destructive read must occur before side effects.

---

## If DX4 — enqueue duplication

Put exactly-once authority **before** `PendingPromptsController.enqueue`.

Do not globally dedupe arbitrary user prompts.

Deduplicate only generated terminal wake identity.

Conceptually:

```ts
terminalWakeKey = `${sessionId}:${taskId}:${jobId}`
```

with bounded lifetime.

But prefer fixing the producer if it is already wrong.

---

## If DX5 — queue duplicate delivery

Repair the queue's consume semantics.

Required:

```text
one queue entry
→ exactly one submit
```

Do not special-case background notifications inside generic queue
machinery unless the generic invariant itself is broken.

---

## If DX6 — turn duplication

Repair orchestration scheduling ownership:

```text
one consumed autonomous wake
→ one runTurn
```

---

## If DX7 — presentation only

Keep orchestration untouched.

Repair projection/message identity so the same logical completion is
rendered once.

This is the least dangerous branch.

---

# 12. Node/process-event discriminator

Do not forget the subprocess error case.

Node documents that process lifecycle events can overlap in ways that
require duplicate-handler protection; `'close'` follows process
completion and can also follow `'error'`, while Node explicitly warns
consumers to guard against invoking completion logic multiple times
when listening to overlapping terminal/error events.

Upstream's example background-terminal plugin independently emits
notification from both child `"error"` and `"close"` handlers.

So include one negative-path test:

```text
BCNEX-CTL-SPAWN-ERROR

spawn failure
→ at most one terminal wake
→ at most one completion presentation
```

But do not assume this explains the LIVE natural-exit duplicate.

---

# 13. Conservation matrix

At minimum:

```text
BCNEX-CTL-01 notify=false
    → zero terminal wakes

BCNEX-CTL-02 one natural exit
    → exactly one wake

BCNEX-CTL-03 cancellation
    → exactly one wake

BCNEX-CTL-04 deadline
    → exactly one wake

BCNEX-CTL-05 spawn failure
    → exactly one wake or zero according to frozen contract,
      never two

BCNEX-CTL-06 two distinct jobs
    → exactly TWO logical wakes total,
      one per job
    → must NOT be accidentally deduped into one

BCNEX-CTL-07 same job terminal event replay
    → no duplicate wake

BCNEX-CTL-08 session reconstruction
    → no duplicate wake for previously consumed terminal

BCNEX-CTL-09 newer task
    → old wake cannot duplicate/resurrect improperly

BCNEX-CTL-10 operator Cancel
    → exactly-once cancellation result

BCNEX-CTL-11 extension shutdown
    → no late duplicate

BCNEX-CTL-12 PendingPrompts service Local
    → exactly one enqueue / consume

BCNEX-CTL-13 Hub mirror/event replay
    → projection repetition must not create another semantic wake

BCNEX-CTL-14 terminal-card presentation
    → remains one card per command row

BCNEX-CTL-15 long-horizon authority
    → no intermediate Your turn regression
```

---

# 14. Multi-job control

This one is essential because we just fixed multi-job correctness.

Run:

```text
A: sleep 10
B: sleep 20
```

with notify enabled.

Expected:

```text
A terminal → one A wake
B terminal → one B wake

TOTAL logical notifications = 2
not 1
not 4
```

Exactly-once means:

```text
once PER JOB
```

not globally once per task.

---

# 15. Presentation contract

Freeze the user-facing result:

For one job:

```text
one visible completion message
```

For two jobs:

```text
one visible completion message per job
```

If the harness chooses to aggregate multiple terminal notifications
into one model continuation later, that is a separate
batching/product ACT.

Do not add batching here.

---

# 16. Do not conflate two kinds of output

A generated terminal wake may say something like:

```text
Background command X completed...
```

and then the agent itself may answer:

```text
The command completed successfully.
```

Those may be **two different semantic layers**, not a duplicate bug.

Therefore the LIVE trace must distinguish:

```text
INTERNAL_SYNTHETIC_WAKE
vs
MODEL_VISIBLE_FINAL_RESPONSE
```

If the first should be transcript-hidden but is being rendered, classify
that as:

```text
DX7_PRESENTATION_DUPLICATED
```

not duplicate wake.

This is a very plausible possibility.

Upstream itself uses synthetic continuation messages in places such as
mode switching and deliberately filters those synthetic prompts from
transcript presentation.

That provides a useful design precedent if our generated terminal
wake is accidentally becoming user-visible.

---

# 17. Preferred product invariant

The clean separation should be:

```text
terminal event
→ internal continuation stimulus
→ model continues
→ ONE user-visible semantic response
```

Not:

```text
terminal event
→ visible generated wake
AND
→ visible model response
```

unless we explicitly choose that UX.

---

# 18. Production diff constraints

Expected scope should be very small after classification.

Likely areas:

```text
background-notify-coordinator.ts
vscode-run-commands-tool.ts
pending prompt/session delivery seam
message translator / presentation seam
```

depending on class.

Do not touch:

```text
CommandJobManager unless DX1
Q5 long-horizon predicate
pending-prompt transport authority
terminal-card projection
PWAOR
BTCONT
Hub ordering machinery
```

---

# 19. Focused executable evidence

Required tests:

```text
BCNEX-RED-01
BCNEX-ABLATION-01
BCNEX-CTL-01..15
```

Reuse existing real seams:

```text
CommandJobManager
createVscodeRunCommandsTool
BackgroundNotifyCoordinator
PendingPromptsController / RuntimeHost pendingPrompts service
SdkSessionEventCoordinator
```

Do not build a parallel fake lifecycle stack.

---

# 20. Gates

At minimum:

```text
focused BCNEX suite
BCNT01
LHOWA01
PPAT01
BTCONT01
BCTCP runner/controller tests
PWAOR01

apps/vscode typecheck
sdk typecheck
bun unit suite
lint
git diff --check
```

If known baseline tests still fail, reproduce on the entry head once
and classify them honestly.

---

# 21. LIVE qualification

Use **one** 30-second job first:

```text
Start exactly one managed background command with completion notification:

sh -c 'echo STARTED; sleep 30; echo FINISHED'

When it finishes, inspect the result and continue normally.
Do not start another command.
```

Expected:

```text
one job
one terminal lifecycle
one wake
one continuation
one visible completion statement
```

Then use two jobs:

```text
A: sh -c 'sleep 10; echo A_DONE'
B: sh -c 'sleep 20; echo B_DONE'
```

Expected:

```text
exactly one A completion
exactly one B completion
```

No need for another 480-second run.

---

# 22. STOP rules

Stop immediately if:

```text
duplicate cannot be reproduced
→ NOT_REPRODUCED

first duplicated stage cannot be identified
→ CAPTURE_INSUFFICIENT

ablation does not eliminate duplicate
→ HALT_CAUSE_NOT_ESTABLISHED
```

Do not introduce generic global message deduplication.

That would hide causal bugs.

---

# 23. Evidence packet

Keep this one small:

```text
01-entry-state.txt
02-live-specimen.md
03-cardinality-authority-map.md
04-live-cardinality-trace.md
05-red-output.txt
06-ablation-output.txt
07-conservation.txt
08-live-green.md
result.json
```

One ACT doc, one board entry.

---

# 23.1 P1 correction (review feedback, post-closure)

**Issue:** the first-pass predicate matched `<bounded-output>` OR
`</bounded-output>` alone — too broad. A legitimate user prompt
containing either delimiter (e.g., a user explaining HTML/XML)
would be silently hidden from the transcript.

**Fix:** narrowed the predicate to a conjunctive fingerprint —
the formatter-owned prefix AND both bounded-output delimiters.
The prefix is exported as
`BACKGROUND_TERMINAL_WAKE_PROMPT_PREFIX` from
`apps/vscode/src/sdk/background-notify-coordinator.ts:52-67`
(single-source-of-truth); `formatTerminalWakePrompt` now references
the same constant. The conjunctive form cannot match any user
prompt that does not start with the formatter-owned prefix.

**Conservation tests added:**
- `BCNEX-P1-01`: actual `formatTerminalWakePrompt(...)` IS filtered
- `BCNEX-P1-02`: ordinary user prompt containing BOTH delimiters MUST remain visible
- `BCNEX-P1-03`: ordinary user prompt containing ONLY ONE delimiter MUST remain visible
- `BCNEX-CTL-12`: registerMarker + consumeTerminal produces exactly one queued wake (uses the harness)

**Updated verdict:** PASS_PRESENTATION_EXACTLY_ONCE_REPAIRED_P1_CORRECTED

---

# 24. Verdicts

Allowed:

```text
PASS_NOTIFY_EXACTLY_ONCE_REPAIRED
PASS_PRESENTATION_EXACTLY_ONCE_REPAIRED
PASS_PRESENTATION_EXACTLY_ONCE_REPAIRED_P1_CORRECTED  ← final verdict
PASS_CASE_DX8_DISTINCT_NOTIFICATIONS
NOT_REPRODUCED
CAPTURE_INSUFFICIENT
HALT_CAUSE_NOT_ESTABLISHED
```

## Success condition

The load-bearing invariant is:

```text
for each jobId:

terminal_authority_count == 1
semantic_wake_count      <= 1
continuation_count       <= 1

and

user-visible terminal completion presentation == 1
```

while simultaneously preserving:

```text
two distinct jobIds
→ two legitimate terminal completions
```

The key is **not "dedupe the text."** It is: find where **1 becomes 2**,
fix that authority once, and leave every lower layer alone.
