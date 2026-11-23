# 04 — C2: the deterministic continuity

## The defect

A summarizer is a LOSSY PROJECTION of the canonical history. It can omit
a published candidate entirely, and the candidate then disappears from
the persisted sidecar and from the provider-visible continuation.

## The mechanism

The accepted candidates are projected into the compaction summary as an
INDEPENDENT, DETERMINISTIC section. The summarizer's choice of wording
is irrelevant to it.

```text
## Adjudication candidates (model-derived, provisional)
<!-- cline-adjudication:begin -->
S1: decision=narrowed qualification=manual_enforcement_only remaining_question=S1.automated_enforcement evidence=cline-ev-e6aa9c86e8e4e711 source_revision=9ca5309aa18e:clean:3b1f0c9a7d2e
<!-- cline-adjudication:end -->
```

The section is attached to the EXISTING `compaction_summary` message. No
second summary message is created, no provider tool call is added, and
every other projected message is preserved unchanged. The provider-visible
`content` AND `metadata.summary` are updated together, exactly as the
task-contract carry-forward does — a repair that changed only one of the
two would be incorrect.

## The projection point

The section is applied inside `createCompactionStateAwarePrepareTurn()`,
in the SAME enrichment chain as the task contract and the verified
outcomes:

```text
applyTaskContractToCompactedMessages
  -> applyVerifiedEvidenceToCompactedMessages
  -> applyAdjudicationCarryForward   <-- the ACT's bounded projection
  -> createSessionCompactionState   (the persisted sidecar)
  -> MessageBuilder.buildForApi      (the provider-visible projection)
```

It is applied at ALL THREE sites: the first compaction of a session, the
re-compaction of an existing sidecar, and the provider-visible restoration
of a historical sidecar.

## The authority source

The carried candidates are derived from the CANONICAL history and from
nothing else. They are NOT derived from:

```text
raw thinking              never read
tool-result contents      never read as a candidate
unvalidated JSON          never carried
summarizer prose          never an authority source
historical model assertions  never an authority source
```

A previous summary is never an authority source — the section is STRIPPED
and REPLACED on every compaction, exactly as the task contract does.

## The representation bounds

The carried representation is CLOSED:

- a heading and a marked block;
- one bounded line per candidate (`MAX_CARRIED_ADJUDICATION_CHARS = 320`);
- at most `MAX_CARRIED_ADJUDICATIONS = 8` candidates;
- only vocabulary-validated values and opaque, runtime-validated
  references.

It carries NO raw source excerpt, NO arbitrary prose, NO private
reasoning and NO unrestricted command output. Two negative controls
assert this: the provider-visible request must not contain the source
content (`maxWorkers`, `documentedBudget`) and must not contain an
absolute path (`/Volumes/`, `/home/`).

## The security invariant

> A finite denylist does not establish confidentiality for arbitrary
> content.

The safety claim rests on the CLOSED REPRESENTATION with runtime-validated
field values, NOT on detection of known secret patterns. Every field the
model controls is checked against a host-supplied closed vocabulary before
it can reach the section, and the evidence reference is an opaque handle
the runtime validated, not a string the model chose freely.

## The idempotence

```text
project(project(messages)) == project(messages)
```

for unchanged source state and an equivalent provider projection. There
is no duplicate accumulation, no text-order churn, no regenerated random
handles and no embedded timestamp in the stable section.

A defect this ACT FOUND AND FIXED: the first implementation stripped only
the marked block and left the HEADING behind, so a second compaction
appended a second section under the first heading. The strip now removes
the heading together with the block, and the projection is byte-stable.

## The second compaction

Two consecutive compactions are exercised. The second derives the
candidate identity from the CANONICAL record, never from the first
summary. The assertion is EXACTLY ONE qualified candidate in the
continuing context, with no duplication.

## The conflict and supersession rules

| Situation | Rule |
|---|---|
| A later accepted candidate for the SAME finding | SUPERSEDES the earlier one. The model published a newer adjudication for the same finding, so the newer one is the current position. This is what keeps the section free of duplicates. |
| An INCOMPLETE newer candidate | REJECTED, so the earlier accepted candidate SURVIVES. A weaker or malformed successor never erases a valid predecessor. |
| An EARLIER summary | Never an authority source, so it cannot resurrect a rejected candidate. |
| A MISSING source evidence | Abstention, not invented continuity. |
| A changed source revision | The stale binding is invalidated and the new identity is bound. |
| Two candidates with CONFLICTING decisions for one finding | The later accepted one wins by the supersession rule; the conflict is never presented as a settled truth. |

## The G4 exit witness

The same controlled omission fixture passes through the whole production
seam:

```text
real compaction production seam
  -> persisted sidecar
  -> session restoration
  -> MessageBuilder.buildForApi()
  -> provider-visible continuation
```

The LIVE measurement repeats this with the REAL agentic summarizer and
the REAL provider credentials: in all four accepted runs of the final
16-run sample, the persisted sidecar carried the section, the
provider-visible request carried it, it named the finding, it named the
opaque handle, and there was EXACTLY ONE section.
