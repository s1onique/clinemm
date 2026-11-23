# 05 — The model publication integration

## G5.1 — The minimal instruction contract

Where an authorized task-scoped adjudication contract exists, the model is
told HOW to publish a candidate. The instruction is applied at the
existing system-prompt assembly seam (`LocalRuntimeHost`, the
`agentConfig.systemPrompt` literal), so it reaches the model on the
privileged instructions channel and nowhere else.

### The instruction is DERIVED FROM THE AUTHORIZED VOCABULARY

It names ONLY the values the runtime is willing to accept:

```text
Authorized finding ids:
  - S1

Authorized decisions:
  - supported
  - narrowed
  - refuted
  - unresolved

Authorized qualification codes:
  - manual_enforcement_only

Authorized remaining-question ids:
  - S1.automated_enforcement

Permitted decisions, per finding:
  S1: narrowed, unresolved

Required qualification codes, per finding:
  S1: manual_enforcement_only
```

So the instruction and the validator CANNOT disagree: a value the
instruction never mentions is rejected by the parser, and a value the
parser accepts is one the instruction named.

The PER-FINDING rules are named explicitly, because a decision that is
authorized IN GENERAL can still be forbidden FOR A FINDING. This was
added after the first live run: the model chose `supported` for S1, which
the vocabulary permits in general but NOT for S1, and the candidate was
correctly rejected with `decision_not_permitted_for_finding`. Naming the
per-finding rule fixed the model's choice; the live sample afterwards
showed `narrowed` in every accepted run.

### What the instruction does NOT do

- It does NOT require disclosure of private reasoning. It says explicitly
  "NOT inside your reasoning".
- It does NOT promise that publishing guarantees anything. It says
  "Publishing is OPTIONAL. If you are not confident, do not publish. A
  missing candidate is a normal outcome."
- It is NOT applied unconditionally to unrelated tasks. It is applied ONLY
  when the host enabled the adjudication contract.

## G5.2 — Missing publication

```text
no candidate published
    ->
no accepted candidate
    ->
no adjudication section added
    ->
ordinary task execution continues
```

No false success. No forced termination. No speculative synthesis from
thinking. The live sample shows this in the runs where `schema_valid` was
false: the run simply produced no candidate and the task continued.

## G5.3 — Rejected publication

An invalid envelope never enters continuity state: it is rejected at
parse, or at one of the acceptance gates, and the derivation returns no
accepted candidate. The agent may continue ordinary investigation.

There is NO automatic retry loop because a candidate is missing or
rejected. The live probe shows this directly: the model failed to publish
in 10 of 16 runs, and each of those runs terminated normally with no
retry and no forced completion.

## The measured publication rate

```text
schema_valid              6 / 16
nonempty_evidence_refs    6 / 16
canonical_refs_resolved   6 / 16
source_revision_bound     4 / 16
candidate_accepted        4 / 16
semantic_support_verified 0 / 16
```

Publication is reliable but NOT guaranteed, exactly as the predecessor's
constraint C3 stated. The load-bearing live success is at least ONE
`candidate_accepted=true` with a genuine, NONEMPTY, bound reference — and
there were FOUR such runs.

## The comparison with the predecessor

```text
                              predecessor      this ACT
schema_valid                       9 / 10         6 / 16
nonempty canonical refs bound       0 / 10         6 / 16
source_revision_bound               0 / 10         4 / 16
candidate_accepted                  0 / 10         4 / 16
```

The publication rate is comparable (the predecessor's probe requested
publication in a bare prompt; this ACT's instruction is longer and states
the per-finding rules). The ACCEPTANCE rate is the load-bearing change:
from 0 to a nonzero figure with a genuine bound reference.
