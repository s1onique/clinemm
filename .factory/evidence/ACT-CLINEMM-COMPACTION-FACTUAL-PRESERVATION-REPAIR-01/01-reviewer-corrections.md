# 01 — The bounded reviewer corrections

ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01

The reviewer required three bounded corrections. They are completed in THIS
ACT, not in a separate correction ACT.

## C2.1 — The source-boundary witness

### The defect

The predecessor's post-boundary negative control passed the CONTAMINATED
collection as the supposedly-frozen prefix:

```ts
const syntheticPostBoundary = buildSyntheticPostBoundaryMessages();
const contaminatedPrefix = [...prefix, ...syntheticPostBoundary];
const contaminatedCarried = await carryForwardAndAssemble(
    a0Replay.compactedMessages,
    contaminatedPrefix,
);
```

and `carryForwardAndAssemble()` passed `sourceMessageCount: frozenPrefix.length`
— so the boundary MOVED to include the synthetic messages. The output being
identical demonstrated only that the synthetic observation did not influence
that particular carry-forward output; it did NOT demonstrate that the
observation was inaccessible.

### The repair

`sdk/packages/core/src/extensions/context/bounded-evidence-contract/boundary-witness.ts`

The witness is rebuilt around the ORIGINAL canonical history:

1. The synthetic observation is appended to the ORIGINAL canonical history —
   the history that was ALREADY carrying post-boundary messages.
2. The prefix is RE-DERIVED from that history using the UNCHANGED historical
   boundary. The synthetic message is therefore outside the boundary, by
   construction.
3. The SAME production continuation-assembly path is exercised over that
   prefix:
   `applyTaskContractToCompactedMessages()` →
   `applyVerifiedEvidenceToCompactedMessages()` →
   `createSessionCompactionState()` → `projectSessionCompactionState()`.
4. The identity of the re-derived prefix is compared with the identity of the
   original prefix: the boundary AND the prefix hash must both match.

### The POSITIVE control

Without it, "the output did not change" would be consistent with a
carry-forward that ignores its source entirely. The positive control advances
the boundary DELIBERATELY and shows that the observation then BECOMES VISIBLE.

The advanced boundary is the length of the CONTAMINATED history, not the
original boundary plus the synthetic count: the synthetic observation occupies
the LAST positions of the contaminated history, so a boundary computed from
the original boundary would leave it outside whenever the original history
already carried post-boundary messages of its own.

The synthetic observation was also strengthened so that the positive control
exercises the REAL read path: it now carries a matching `tool_use` block and
an affirmative `success: true` payload, so the production verified-outcome
ledger recognises it.

### The primary invariant

The contaminated history has MORE messages after the boundary, so the RETAINED
TAIL legitimately differs — the tail is `canonical.slice(boundary)`. That
difference is the tail doing its job, not a contamination of the prefix.

The primary invariant is therefore `prefixDerivedIdentical`: the summary and
the carried sections, which are the ONLY things derived from the boundary,
must be byte-identical. The full-output equality is reported as
`outputsIdentical` for completeness.

### The witnesses

`boundary-witness.test.ts` — 6 witnesses:

| Witness | Establishes |
|---|---|
| NEGATIVE — the re-derived prefix identity is preserved | the boundary and the hash are unchanged |
| NEGATIVE — the contaminated history really IS contaminated | the contamination window GREW, so the control is not vacuous |
| NEGATIVE — the synthetic observation is INACCESSIBLE | the marker is absent and the prefix-derived content is byte-identical |
| POSITIVE — advancing the boundary DELIBERATELY makes the observation visible | the carry-forward really does read its source |
| the PAIR establishes both directions | inaccessible at the boundary, accessible at an advanced boundary |
| the re-derived prefix never grows with the history | the prefix is a function of the boundary, not of the history |

## C2.2 — The semantic scoring

### The defect

The predecessor scored O7 as `PARTIALLY_PRESERVED` although the BR summary
published `1500 ms` for a subject whose observed value is `1000 ms`:

```
NotificationServiceClient defaults 500 ms / 1500 ms
```

The predecessor's proposition-level pattern `\b(500|1000)\b` matched the
`500`, so the wrong value was credited. A material wrong value must be
`DISTORTED` or `CONTRADICTED`.

### The rule

```
WRONG_SUBJECT       != PARTIAL
WRONG_VALUE         != PARTIAL
WRONG_UNIT          != PARTIAL
WRONG_POLARITY      != PARTIAL
MISSING_QUALIFIER   == PARTIAL
```

### The repair

`sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/factual-preservation.ts`

The predecessor's matcher is a POSITIVE matcher: it asks "does the context
contain a phrase that expresses this proposition?". It has no way to ask
"does the context assert something that CONTRADICTS this proposition?",
because a contradiction is frequently phrased with the SAME keywords as the
proposition — only the value differs.

So the correction is a separate layer. Each oracle item declares the ATOMIC
FACTS it asserts, and each fact names:

- the SUBJECT it is about;
- the RELATION that carries the value;
- the OBSERVED value and unit;
- the polarity, and — for a negative fact — the OPPOSITE assertion.

A contradiction is then a value asserted for the SAME subject and relation
that is not the observed one. Two surface forms needed explicit handling:

- the PAIRED LIST: "connect/socket timeouts ... 500 ms / 1500 ms" states two
  relations and two values in two parallel lists, PAIRED BY POSITION. The
  socket timeout is the SECOND value;
- the REPEATED relation: "socket timeout is 1000 ms, though the socket timeout
  is 1500 ms" states the relation twice, and every value asserted after any
  of its mentions belongs to it. A context that states the observed value AND
  then contradicts it must not be scored as if the contradicting clause were
  absent.

The subject anchor also had to match the CAMEL-CASE class name
(`NotificationServiceClient`), not only the kebab/spaced forms — the first
implementation silently matched nothing.

### The witnesses

`factual-preservation.test.ts` — 13 witnesses:

| Witness | Establishes |
|---|---|
| the RED fixture — the historical BR mistranscription | `DISTORTED`, not `PARTIALLY_PRESERVED` |
| the RED fixture — the corrected score | the predecessor's `PARTIALLY_PRESERVED` becomes `DISTORTED` |
| the RED fixture — the contradiction's kind | `WRONG_VALUE` is reported |
| the RED fixture — a correct value is not contradicted | the layer does not fire on a faithful summary |
| the RED fixture — an unrelated subsystem's value | the Kafka send timeout does not contradict the socket timeout |
| correct subject, wrong value | `DISTORTED` |
| correct value, wrong subject | not preserved |
| correct number, wrong unit | `DISTORTED` |
| reversed success/failure polarity | `CONTRADICTED` |
| missing qualification | remains `PARTIALLY_PRESERVED` — the ONE partial case |
| explicit contradiction alongside a correct statement | `DISTORTED`; the correct keyword does not conceal it |
| a CONSISTENT verdict leaves every score unchanged | the layer never promotes |
| an OMISSED item stays OMITTED | the layer cannot fabricate |

The RED fixture is the ACTUAL historical sentence, preserved verbatim. A new
live summarization need not reproduce the identical stochastic error to
establish the validity of the recorded counterexample.

## C2.3 — The evidence identity

`sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/evidence-identity.ts`

The predecessor measured FOUR different things under overlapping names. They
are not the same mechanism, they do not have the same cost, and they do not
have the same failure modes.

| Mechanism | Who writes the bytes | Can distort facts | Extra inference requests | Cost grows with the transcript | Idempotent |
|---|---|---|---|---|---|
| `TARGETED_ORIGINAL_EVIDENCE_RESTORATION` | none (original) | no | 0 | yes | no |
| `MINIMAL_BOUNDED_RESTORATION` | none (original) | no | 0 | yes | no |
| `EVIDENCE_ENHANCED_SUMMARIZATION` | THE MODEL | **yes** | 0 | no | yes |
| `DETERMINISTIC_EVIDENCE_CARRY_FORWARD` | none (original) | no | 0 | no | yes |

The decisive column is the second one. Three of the four preserve the
ORIGINAL bytes; one asks the model to REGENERATE them, and only that one can
introduce a factual substitution.

"Targeted restoration improved O4 and O7" is TRUE of
`TARGETED_ORIGINAL_EVIDENCE_RESTORATION` and is NOT a statement about
`EVIDENCE_ENHANCED_SUMMARIZATION`, which did NOT flip either item. The
vocabulary makes that distinction unmissable: `isSameEvidenceMechanism()`,
`preservesOriginalBytes()`, `canDistortFacts()` and
`additionalInferenceRequests()` are named functions rather than string
comparisons at each call site.
