# ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01

**Bounded objective recovery (R2).**

Predecessor: `ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01`, including
AMENDMENT-01.

Accepted R1 qualification anchor: `b5bf8d34f89c23e52942cbed9ab8dc4669e0b4ec`.

Mode: BOUNDED_IMPLEMENTATION / AUTONOMOUS_RECOVERY. Risk: R3.

Verdict: `GO_R2_BOUNDED_OBJECTIVE_DOGFOOD`.

---

## 1. What R2 is

R1 injects an **advisory** corrective instruction when a trajectory stalls.
The frozen session `1795612311440_l9mhl` received both R1 instructions at
the actual SDK prompts and remained stalled: 36 model responses, 36 tool
calls, ZERO native edits, ~8m 42s elapsed, ~1.31M cumulative reported input
tokens, 162,338 recorded reasoning characters, no net repository change.

An advisory asks the model to behave differently. It does not change what
the model is asked to do.

R2 is the **second** recovery stage. When the R1 corrective-instruction
allowance is exhausted and the trajectory is STILL unproductive, the runtime:

1. **SELECTS** one bounded, independently verifiable objective derived from
   the parent task, through the SAME authorized provider and model;
2. **VALIDATES** it against the parent's authority;
3. **MAKES** it the current execution target of the next dispatched model
   request;
4. **VERIFIES** it from the observable tool outcomes of the objective's own
   execution;
5. **RETURNS** execution to the parent task automatically.

The parent task remains authoritative throughout.

---

## 2. Bounded production reconnaissance

`Existing capability → production owner → reuse decision`

| Existing capability | Production owner | Reuse decision |
|---|---|---|
| R1 stagnation decision, including the `allowance_exhausted` branch | `AgentRuntime.evaluateExecutionStagnation()` (`sdk/packages/agents/src/agent-runtime.ts`) | **REUSE** — the `allowance_exhausted` branch is the R2 entry point. R1's thresholds and allowance are unchanged. |
| Runtime-owned corrective instruction | `AgentRuntime.addUserReminderMessage()` | **REUSE for R1 only.** R2 must NOT be another advisory on that channel; it uses the privileged request channel instead. |
| Canonical transcript | `AgentRuntime.state.messages` | **REUSE, UNMUTATED.** The R2 objective is a runtime-owned REQUEST projection, so the parent's conversation and the signed reasoning continuity are preserved byte-for-byte. |
| Model invocation | `AgentModel.stream(request)` via `config.model` | **REUSE.** The ONE selection inference uses the same authorized provider and model. No supervisor process, no provider switch, no recursive planner. |
| Usage accounting | `AgentRuntime.updateUsage()` | **REUSE.** The selection inference's `usage` events are folded into the ordinary run accounting. |
| Completion obligation | `completionPolicy.completionGuard`, `submit_and_exit` | **REUSE, UNCHANGED.** R2 never invokes the parent's terminal completion tool. |
| Run-scoped accounting | The runtime instance's own fields | **REUSE.** The R2 accounting is run-scoped exactly like R1's, so compaction cannot replenish it. |
| Task-contract conservation | `sdk/packages/core/src/extensions/context/task-contract.ts` | **REUSE, EXTENDED.** The R2 dispatch is recognised by its EXACT template shape and carried in its OWN runtime-authority section. |
| Structured task decomposition (`team_task`, `spawn_agent`) | `@cline/core` team tools | **DO NOT REUSE.** Multi-agent orchestration is explicitly out of scope, and it would be a second task lifecycle. |
| PCK / acquisition evidence | The adjudication contract | **NOT NEEDED** for objective selection. |
| Verifiable objective | The runtime's own observable round facts plus the host's optional `verifyObjective` hook | **REUSE.** The host owns the workspace and the executable gates; the runtime owns the structural check. |

**The production seam is identified.** R2 rides the existing `AgentRuntime`
iteration boundary. It introduces no second task lifecycle, no parallel
supervisor, and no new infrastructure intended only for deferred features.

---

## 3. The production mechanism

### 3.1 The dispatch channel is what makes R2 different from R1

R1 appends an advisory message to the conversation. The conversation's own
objective is unchanged, and the model may ignore the suggestion.

R2 projects the selected objective onto the **dispatched request's
privileged channel** (`request.systemPrompt`) — the same channel the host's
trusted runtime-control continuation uses. The next request the provider
sees is a request FOR THE OBJECTIVE.

Three production facts constrained this choice and were honoured:

- `AgentMessage.role: "system"` is **not** usable for the transcript: the
  AI SDK v7 transport rejects `role:"system"` entries in `messages[]`. The
  established production pattern (`session-runtime-orchestrator.ts`) persists
  runtime control as `role: "user"` and composes the privileged content
  onto the top-level instructions channel at model-request build time.
  R2 follows that pattern exactly.
- The objective is therefore NOT a transcript mutation. The canonical
  conversation, the parent's messages, and the signed reasoning continuity
  are untouched.
- The compaction summary is a LOSSY PROJECTION of the transcript, so the
  objective's IDENTITY is carried forward by the task-contract conservation
  path in its own runtime-authority section, recognised by the EXACT
  template shape its producer renders.

### 3.2 The pure contract

`sdk/packages/shared/src/agents/bounded-objective.ts` defines:

- `BoundedObjective` — a FLAT shape: parent task identity, one objective,
  obligation references, one first step, one mutation scope, one observable
  verification condition, evidence references, and explicit success and
  failure conditions. There is no nesting, no dependency edge and no
  sequence of sub-steps: a "workflow schema" would let one objective expand
  into many dependent steps, and this contract deliberately cannot express
  that.
- `BoundedObjectivePolicy` — the OPT-IN policy, with the experimental
  bounds (2 activations, 8 rounds per objective, 1 selection inference per
  activation) and the host's optional `verifyObjective` hook.
- `validateBoundedObjective()` — the R2 authorisation boundary.
- `renderBoundedObjectiveInstruction()` / `parseBoundedObjectiveInstruction()`
  — the dispatch template and its structural recogniser.

### 3.3 The validator is the authorisation boundary

A candidate is REJECTED when it is malformed (a missing, empty or unbounded
field), names a DIFFERENT parent, proposes a mutation scope OUTSIDE the
parent's authorised paths, contradicts an applicable parent constraint,
cites evidence that was never established, or claims that an outstanding
obligation is already satisfied.

A rejection **never** starts another selection attempt: the activation's
selection-inference allowance is already spent. There is no unbounded
selection retry loop.

The scope check is structural: it is a PATH CONTAINMENT test against the
paths the USER named in the parent task. It never inspects command text and
never guesses at intent.

### 3.4 The selection inference receives the minimum sufficient information

The ONE inference carries: the original user-authorized objective, the
applicable parent constraints, the outstanding acceptance obligations, the
established observations with their evidence references, the recent failed
execution strategy, the actual available tools, and the remaining recovery
allowance.

It carries **no** provider-owned thinking text and **no** opaque reasoning
signature. The runtime reads only TEXT parts of USER-AUTHORED messages; the
runtime's own reminders are excluded by the runtime's own provenance stamp
(`userRunSpan: 0` plus a `displayRole` / `runtimeAuthority`), not by a text
guess.

The inference request carries **no tools**: the selection cannot mutate
anything and cannot execute anything.

### 3.5 Verification is observable, not asserted

A model statement that the objective is complete is NOT sufficient.

The host MAY supply a more precise judgement through the optional
`verifyObjective` hook — the host owns the workspace and the executable
gates. When the host declines, the runtime applies its OWN structural
check: the objective's own rounds must contain a **successfully executed
command**.

A successful native edit is deliberately **not** sufficient: an edit only
shows that a file changed, never that the change is correct. For a
regression objective the expected discriminator is the test that fails
before the edit and passes after it; for a repair objective it is the
relevant focused verification. Both are executable commands, and an
inspection never satisfies either.

### 3.6 The return is automatic

After the objective verifies, the runtime records its actual outcome and
evidence, clears the active objective, and returns execution to the parent
task. The parent's outstanding obligations are preserved, the parent's
terminal completion tool is never invoked on the objective's behalf, and the
operator is never asked to approve routine continuation.

### 3.7 Recovery accounting

- At most ONE selection inference per R2 activation.
- At most TWO R2 activations per parent run.
- At most EIGHT execution rounds per bounded objective.
- The activation is consumed at the point it is ATTEMPTED: a failed
  selection, a failed execution and a failed verification all consume the
  corresponding attempted recovery allowance.
- The accounting is RUN-SCOPED: a new run starts from a clean allowance, and
  compaction never replenishes it.
- R2 does NOT reactivate recursively from within its own bounded objective.
- An unsuccessful R2 recovery produces an EXPLICIT internal recovery
  outcome (`kind: "failed"` with a machine-readable reason) suitable for a
  future R3 consumer. Success is never manufactured, and no new
  user-waiting state is introduced.

---

## 4. The principal deterministic witness

`sdk/packages/agents/src/agent-runtime.bounded-objective-recovery02.test.ts`,
driven through the REAL `AgentRuntime` with a scripted model and a
DISPOSABLE WORKSPACE on disk.

Evidence class: `SYNTHETIC_REAL_PRODUCTION_SEAM`.

### Phase A — stagnation

Nine unproductive inspection rounds. The R1 corrective instructions ARE
delivered into the dispatched requests, and they do NOT change the model's
behaviour: the model keeps inspecting.

### Phase B — R2 execution

R1's allowance is exhausted, so R2 activates AUTOMATICALLY. The scripted
model chooses the implementation action ONLY AFTER it observes the active
R2 objective in the dispatched request — the step inspects the request and
returns an inspection tool call when the objective is absent.

The real tool path changes a disposable file ON DISK
(`export const VALUE = 1` → `export const VALUE = 2`), and the real
executable check reads the file back and reports `PASS` only when the
repaired value is really there.

### Phase C — parent continuation

The objective completes and the runtime returns to the parent AUTOMATICALLY.
A SECOND outstanding parent obligation remains incomplete. The model's
premature finish attempt is REJECTED by the EXISTING completion contract:
the completion guard's obligation is re-injected into the next dispatched
request and the run continues. After the outstanding obligation is
satisfied, the terminal completion tool completes the run.

NO operator intervention occurs at any point.

---

## 5. The required conservation controls

| Control | Witness |
|---|---|
| Disabled R2 preserves existing behaviour | CONTROL 1 (RED) + CONTROL 3 (the R1 instruction bodies are unchanged) |
| Productive ordinary execution does not activate R2 | CONTROL 4 |
| PLAN-mode execution does not activate R2 | Bridge control Q2 (the producer's whole block is ABSENT in PLAN mode) |
| Genuine read-only objectives do not force source edits | CONTROL 11 (the objective verifies on the requested evidence alone) |
| Legitimate running-job waiting remains conserved | CONTROL 5 |
| Invalid or unauthorized decomposition is rejected | CONTROL 6 + the shared pure-contract witnesses P2–P11 |
| Failed objective cannot authorize parent completion | CONTROL 7 |
| Successful objective automatically returns to parent execution | The principal witness (Phase C) |
| Cancellation prevents further recovery dispatch | CONTROL 9 |
| Compaction conserves active objective identity and consumed allowance | `compaction.bounded-objective-delivery02.test.ts` (E1/E3/E4) + the run-scoped allowance reset (CONTROL 10) |
| Signed reasoning and effective provider configuration remain conserved | The objective is a REQUEST projection, not a transcript mutation; the selection inference carries no tools and no reasoning |
| Recovery exhaustion does not create recursive R2 activation | CONTROL 8 |

---

## 6. The frozen-session discriminator

`sdk/packages/shared/src/agents/bounded-objective-replay.test.ts`.

The session transcript `1795612311440_l9mhl` is OPERATOR-LOCAL and PRIVATE
and is NEVER committed; only its aggregate, non-content shape is recorded
in `sdk/packages/shared/src/agents/bounded-objective.fixture.ts`, exactly as
the R1 predecessor did.

The replay is processed PROGRAMMATICALLY, using ONLY the observations
available at each historical decision point:

- **F1 — when R2 would have become eligible.** The first round at which the
  R1 corrective-instruction allowance was exhausted AND the trajectory was
  still unproductive. It is NOT the last round of the trajectory: the
  recovery could have acted while the model was still stuck. No earlier
  round was eligible, and no later observation reclassifies an earlier one.
- **F2 — which established facts were available.** The consecutive
  unproductive streak and the consumed instruction allowance — both facts
  observable at that moment.
- **F3 — which parent obligations remained.** The parent's own completion
  duty and the unimplemented Nim lifecycle: the frozen witness records
  `netRepositoryChanges: false` and `nimLifecycleImplementationStarted:
  false`.
- **F4 — whether an existing structured obligation could supply a bounded
  objective.** NO. The runtime's structured obligations are the
  terminal-completion reminder and the completion guard; both name the
  parent's completion duty, not a bounded step toward it. Every observed
  round was an inspection, so the trajectory carried no already-decomposed
  work item.
- **F5 — what additional selection inference would be required.** Exactly
  ONE bounded inference, receiving the minimum sufficient context. The
  frozen session's established evidence included the successfully installed
  Linux amd64 Nim compiler — a real, usable toolchain fact — and the
  native editor was available throughout.

An illustrative well-formed objective after the Linux compiler was
established is:

> Implement and compile the bounded subprocess-execution utility for
> basaltctl. Establish explicit argument-vector execution, bounded output
> and monotonic deadline handling using a disposable Linux fixture.

It is an EXAMPLE of a well-formed bounded objective against the frozen
evidence. It is **NOT** hardcoded into production code, and it is **NOT** a
claim that the model would select it. The offline replay establishes
ELIGIBILITY and AVAILABLE EVIDENCE, not behavioural recovery.

---

## 7. RED / GREEN

**Principal RED.** With R2 disabled, the same deterministic stalled
trajectory consumes the R1 allowance and does NOT execute the bounded
objective: CONTROL 1 asserts that no selection inference was made, that no
bounded-objective notice was emitted, and that no dispatched request
carried the objective.

**Principal GREEN.** With R2 enabled, the same initial trajectory activates
a bounded objective, performs and verifies the required operation against a
disposable file on disk, and automatically returns to the parent task.

**Necessity.** Disabling only the R2 activation boundary (the
`allowance_exhausted` branch) or the active-objective dispatch projection
(the `projectActiveBoundedObjective` seam) fails the principal witness while
the R1 conservation controls still pass.

**Red/Green separation is also structural.** The witness is a genuine RED/GREEN
pair over the SAME deterministic trajectory: CONTROL 1 (R2 disabled) and
CONTROL 2 (R2 enabled) differ ONLY in the `boundedObjectivePolicy` field.

---

## 8. Production reachability

`apps/vscode/src/sdk/__tests__/autonomous-execution-recovery-r2.production-reachability02.c24-c-bridge.test.ts`.

The REAL chain, end to end:

```
apps/vscode/src/sdk/cline-session-factory.ts
  buildSessionConfig({ mode })            <-- THE PRODUCER
     -> CoreSessionConfig.boundedObjectivePolicy
        -> LocalRuntimeHost.startSession()
           -> the AgentConfig literal    <-- THE FORWARDING SEAM
              -> createAgentRuntimeConfig()
                 -> AgentRuntime         <-- THE ACTUAL RUNTIME
```

- **Q1** ACT mode activates the INTENDED R2 policy (2 activations, 8 rounds,
  1 selection inference, enabled).
- **Q2** PLAN mode does NOT activate it — the whole block is ABSENT, not
  merely disabled. In PLAN mode the agent is forbidden to edit, so an
  "unproductive" round is the requested behaviour, not a stall.
- **Q3** the policy REACHES THE ACTUAL RUNTIME through the host's
  forwarding seam.
- **Q4** the R1 allowance exhaustion activates R2 and the NEXT dispatched
  request carries the ACTIVE bounded objective.

There is no settings UI, no new persistence and no new user-facing surface.
The policy is OPT-IN: with it absent the runtime behaves byte-identically to
before.

---

## 9. Verification

| Gate | Result |
|---|---|
| `@cline/shared` typecheck | clean |
| `@cline/agents` typecheck | clean |
| `@cline/core` typecheck | ZERO new diagnostics against the baseline (45 observed = 45 baseline) |
| `apps/vscode` typecheck | clean |
| `apps/vscode` bridge typecheck | ZERO new diagnostics against the baseline (5 observed = 5 baseline; the 5 are pre-existing from concurrent work) |
| `@cline/shared` focused agents suites | 36 passed (13 R2 pure-contract + 6 R2 frozen-session + 17 R1) |
| `@cline/agents` focused suites | 29 passed (12 R2 + 11 R1 + 6 R1 progress controls) |
| `@cline/agents` full suite | 43 failed / 615 passed versus a 43 failed / 603 passed baseline — zero new failures, +12 net passed |
| `@cline/core` affected context/tools suites | 4 failed / 1836 passed; the 4 failures are the IDENTICAL pre-existing environment artifacts (skill-trigger eval ordering, bash startup env) |
| `apps/vscode` bridge suites | 8 passed (4 R1 + 4 R2) |
| Biome | clean on every changed file |

NO paid inference. NO VSIX build. NO ordinary/full-suite reruns beyond the
affected packages' own suites. NO Factory documentation campaign.

---

## 10. Scope

R2 only. NOT implemented and NOT anticipated beyond the extension point:

- R3 fresh execution episodes (the explicit internal recovery outcome is
  the extension point).
- Provider or model escalation.
- Multi-agent orchestration framework.
- New persistent task database.
- Generic DAG scheduler.
- Semantic progress evaluator.
- General-purpose planning framework.
- PCK redesign.
- Overflow-recovery compaction repair.
- Provider cancellation propagation.
- Global token-budget redesign.
- Changes to R1 thresholds.
- Additional static prompt tuning.

The R1 architecture is unchanged. R2's policy is scoped to ACT mode, like
R1's. The experimental limits are experimental bounds for this
implementation, not permanent production defaults.

---

## 11. Exit dispositions

| Disposition | Value |
|---|---|
| `ENTRY_HEAD` | `b5bf8d34f89c23e52942cbed9ab8dc4669e0b4ec` |
| `R2_PRODUCTION_OWNER` | `AgentRuntime` (`sdk/packages/agents/src/agent-runtime.ts`), at the existing R1 `allowance_exhausted` branch of `evaluateExecutionStagnation()` |
| `EXISTING_TASK_INFRASTRUCTURE_REUSED` | The canonical transcript, the model invocation seam, the usage accounting, the completion obligation, the run-scoped accounting, and the task-contract conservation path. The multi-agent team tools were deliberately NOT reused: they are a second task lifecycle and are out of scope. |
| `R2_TRIGGER_AUTHORITY` | The runtime's own R1 `allowance_exhausted` decision — the run-scoped corrective-instruction allowance is spent AND the trajectory is still unproductive. |
| `OBJECTIVE_SELECTION_AUTHORITY` | The runtime, through ONE bounded inference on the SAME authorized provider and model, with the candidate then validated against the parent's authority by `validateBoundedObjective()`. |
| `BOUNDED_OBJECTIVE_DISPATCH` | The dispatched request's privileged channel (`request.systemPrompt`), via `projectActiveBoundedObjective()` — a runtime-owned REQUEST projection, not a transcript mutation and not another advisory. |
| `ACTUAL_WORKSPACE_PROGRESS` | ESTABLISHED — a disposable file on disk was really changed (`VALUE = 1` → `VALUE = 2`). |
| `OBJECTIVE_VERIFICATION` | ESTABLISHED — the relevant executable check really ran and really reported the required outcome; a successful edit alone is deliberately insufficient. |
| `AUTOMATIC_PARENT_CONTINUATION` | ESTABLISHED — the runtime returned to the parent with no operator intervention. |
| `PARENT_COMPLETION_AUTHORITY` | CONSERVED — the premature parent completion was rejected by the EXISTING completion contract; the parent's terminal completion tool is never invoked on the objective's behalf. |
| `RECOVERY_ALLOWANCE_CONSERVATION` | ESTABLISHED — the activation, selection-inference and objective-round allowances are run-scoped; a failed selection, execution or verification consumes the attempted allowance; a new run starts clean. |
| `COMPACTION_CONSERVATION` | ESTABLISHED — the active objective's identity survives compaction in its own runtime-authority section; the consumed allowance is not replenished. |
| `CANCELLATION_CONSERVATION` | ESTABLISHED — a cancelled run dispatches no further recovery. |
| `FROZEN_SESSION_FIRST_ELIGIBILITY` | The first round at which the R1 allowance was exhausted AND the trajectory was still unproductive — established by a programmatic replay using only the observations available at each decision point. |
| `R3_EXTENSION_POINT` | The explicit internal recovery outcome (`kind: "completed" | "failed"` with a machine-readable reason) the runtime emits at the end of every R2 activation. R3 itself is NOT implemented. |
| `ACT_OWNED_DIAGNOSTICS` | NONE — zero new typecheck diagnostics in `@cline/core` and in the `apps/vscode` bridge against their baselines; Biome clean on every changed file. |
| `FINAL_HEAD` | See the commit that carries this ACT. |
| `TRACKED_DIRT` | NONE. |

**Verdict: `GO_R2_BOUNDED_OBJECTIVE_DOGFOOD`.**

The GO verdict requires actual production-path activation, bounded objective
execution, executable verification and automatic parent continuation. All
four are established by the principal witness and the production-reachability
bridge.

**What the verdict does NOT claim.** A synthetic witness does not establish
live behavioural effectiveness: it does not prove that a live model WOULD
select a useful objective for the frozen session, nor that the frozen
failure recovers behaviourally. The offline replay establishes eligibility
and available evidence, not behavioural recovery. The live behavioural claim
remains open, exactly as it did for R1.

---

# AMENDMENT-01 — HALT_R2_OBJECTIVE_AUTHORITY_NOT_CONSERVED

Predecessor: `4c7d54c2230b8edf17cd098d4319fb7d86046bce`.

The R2 architecture is accepted. This amendment repairs only the OBJECTIVE
AUTHORIZATION, the OBJECTIVE VERIFICATION, and the directly related
production delivery witnesses. No redesign.

## A1. The halt

The reviewer independently executed the PRODUCTION validator and reproduced
these invalid acceptances, given parent mutation scope `/workspace/project/src`
and constraint `Do not modify tests.`:

| # | Case | Predecessor |
|---|------|-------------|
| 1 | `/workspace/project/src/../tests/a.ts` | ACCEPTED |
| 2 | `tests/a.ts` | ACCEPTED |
| 3 | prose scope `the entire repository` | ACCEPTED |
| 4 | allowed mutationScope + a firstStep that rewrites tests | ACCEPTED |
| 5 | a multiline firstStep instructing the model to ignore parent constraints | ACCEPTED |
| 6 | a multiline objective validates but cannot survive render/parse round trip | ACCEPTED |

And separately: the objective VERIFICATION accepted an UNRELATED successful
command as proof that the objective's own verification condition had been
met.

## A2. The authorization repair

A model-selected objective is an UNTRUSTED PROPOSAL, not an authorization
grant. The repair reuses the existing production workspace, sandbox,
tool-policy and parent-task authority mechanisms. It does NOT implement a
general natural-language authorization engine.

- **Structural scope validation uses the existing canonical path authority**
  rather than lexical prefix matching: `canonicalizeScopePath` resolves `.`
  and `..` segments and collapses duplicate separators; the canonical result
  must be the authorised root itself or live inside it, on a segment
  boundary.
- **An unresolved mutation scope never becomes an implicitly unrestricted
  scope.** A relative path has no canonical meaning and is refused; a prose
  scope that names no path is refused.
- **Model-generated prose cannot expand parent authorization.** A candidate
  that asserts the negation of a parent constraint is refused, including
  through a shared artefact-class vocabulary; a candidate that issues an
  instruction overriding the parent's authority is refused outright.
- **Model-generated objective fields are not promoted into independently
  authoritative system instructions.** The objective remains a runtime-owned
  request projection on the privileged channel; the canonical transcript is
  not mutated.
- **Actual tool execution remains subject to the original parent
  authorization and any enforceable narrower objective scope.** While an
  objective is active, a tool call that would mutate a path outside the
  objective's authorised scope is refused before approval and before the
  executor runs.
- **A read-only objective does not authorize mutation.**

**Where the existing system cannot establish a narrower enforceable mutation
scope, the limitation is represented honestly.** The scope gate applies to
tool calls carrying an EXPLICIT path; the runtime never parses command text
(the command-policy layer and the sandbox remain the authority for command
contents); and an objective whose scope did not resolve has NO narrower scope
to enforce — the parent's own authorization remains the only authority in that
case. No claim is made that arbitrary natural-language constraints have been
mechanically validated.

**Unsafe or unresolvable selection is rejected without asking the operator to
intervene.** The attempted recovery allowance is consumed and a truthful
failed recovery outcome is returned
(`bounded objective recovery outcome: failed (selection_rejected:<reason>)`).

## A3. The verification repair

The discriminator — an objective requiring a specific executable regression,
followed by an UNRELATED successful command — now asserts that the objective
is NOT reported verified. The suite also covers: the required command
executed but failed; a successful edit without verification; host
verification unavailable or throwing; and the actual required executable
gate succeeding.

**The fallback that treated any successful command as objective verification
is removed.** The runtime now records STRUCTURED EXECUTION RECEIPTS (tool
name, command identity, outcome) and correlates them with the host-declared
verification gate. If the required verification cannot be established, the
objective is reported as UNVERIFIED. A model assertion, a command count or a
successful unrelated operation is not verification evidence. A completed
objective does not automatically satisfy parent obligations.

## A4. The production witness

The principal witness is strengthened once: real `AgentRuntime`, the actual
production tool execution boundary, a disposable workspace, an actual
executable regression with observable RED and GREEN outcomes, and scripted
model responses only at the model boundary. It asserts the sequence R1
exhausted → R2 selected → objective authorized → relevant mutation → exact
verification gate passes → objective completed → parent continuation, and it
adds an adversarial trajectory in which the model attempts an unauthorized
mutation and an unrelated successful verification command. Neither may
establish objective success. No paid inference.

## A5. The compaction conservation

No canonical transcript objective carrier was manufactured. The active
runtime-owned objective is exercised through the actual
request-preparation/compaction transition. The same active objective remains
effective after compaction; the recovery allowance is not replenished; parent
authorization remains intact; after objective completion, subsequent requests
no longer carry it as active authority; and a later compaction cannot
resurrect a completed objective. The existing runtime-owned state is reused
and no second persistent task lifecycle is introduced.

## A6. The small accounting controls

The selection-inference allowance is checked against the specified
per-activation contract (one inference per activation; a failed selection
consumes it and is never retried). Cancellation during selection and during
active objective execution is exercised. No general cancellation or
provider-transport work was added.

**R2 remains EXPLICITLY EXPERIMENTAL.** It is not enabled for ordinary
production sessions: the whole `boundedObjectivePolicy` key is absent unless
the dogfood configuration is deliberately selected
(`CLINE_BOUNDED_OBJECTIVE_DOGFOOD=1`).

## A7. Verification

| Check | Result |
|-------|--------|
| Focused authorization regressions | RED 7/8 against the predecessor's validator; GREEN 23/23 |
| Focused objective-verification regressions | RED 5/6 against the predecessor's runtime; GREEN 6/6 |
| Principal runtime witness | GREEN 24/24 across 5 R2 files |
| R1 conservation controls | GREEN 17/17 |
| Actual compaction-delivery controls | GREEN 44/44 |
| Affected typecheck | `@cline/shared` clean; `@cline/agents` clean; `@cline/core` delta ZERO against the baseline diagnostic set (45 = 45, deduped) |
| Biome | clean on every changed file |
