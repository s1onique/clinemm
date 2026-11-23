# 01 — The live-harness correlation correction

## The defect, verbatim

The predecessor harness kept two parallel arrays:

```ts
const turnCarriers: string[] = [];       // ONE ENTRY PER TEXT-BEARING TURN
const turnToolCallCounts: number[] = [];  // ONE ENTRY PER TURN
...
turnToolCallCounts.push(turnToolCalls.length);
if (turnText) {
    turnCarriers.push(turnText);
}
```

and derived the same-turn property by indexing the per-turn array with
the **carrier** index:

```ts
observation.publishedCarrierIndex = index;
observation.publishedTurnAlsoCarriedToolUse =
    (turnToolCallCounts[index] ?? 0) > 0;   // <-- POSITIONAL BUG
```

The carrier index and the turn index are equal only while EVERY preceding
turn carried text. A tool-only turn — an entirely ordinary turn — shifts
the two apart, and the metric then reports the tool-call count of a
**different turn**.

The second defect:

```ts
// A text block emitted AFTER the tool result is the publication
// the contract cares about.
if (turnText) {
    sawTextAfterToolResult = true;
}
```

This sat AFTER the tool-result push but was derived from `turnText` of the
**same** turn — text that the model emitted BEFORE the result was appended.
It was therefore not tied to the adjudication carrier at all: any preamble
text in a tool-calling turn set the flag, whether or not the adjudication
was ever published.

## The correction

The corrected logic lives in a new script-local module:

```text
sdk/packages/core/scripts/adjudication-output-contract.correlation.ts
```

Three changes:

1. **One turn-indexed array.** Turns are recorded as a single
   `TurnObservation[]`, each carrying its `text`, its own `toolCallIds`,
   and the CHRONOLOGY anchor `toolResultsBefore`.

2. **The turn index travels WITH the carrier.** `anchorCarriers()` emits
   an `AnchoredCarrier` per text-bearing turn, each carrying its
   `turnIndex`. A tool-only turn produces no carrier but still advances
   the canonical turn index, so no two arrays can ever be confused again.

3. **Chronology is an explicit counter.** `toolResultsAppended` advances
   ONLY when a tool result is actually appended to the conversation. A
   turn records the counter as it was BEFORE the turn began. The
   "published after tool result" property is now read from that counter,
   not from the presence of text in a tool-calling turn.

The harness itself now calls `anchorCarriers()` / `correlateCarrier()`
instead of indexing parallel arrays.

## The executable counterexamples

The legacy computation is reproduced **verbatim** in the correction test
file as `legacyPositionalCorrelation`, so each counterexample is a proof
that the OLD logic returns the wrong answer for the SAME input — not an
assertion that it might have.

```text
sdk/packages/core/src/extensions/context/
  compaction.adjudication-output-contract.correction01.test.ts
```

The decisive counterexample:

```ts
const turns = [
    { text: "",                             toolCallIds: ["call_tool_only"], toolResultsBefore: 0 },
    { text: '{"kind":"adjudication_candidate"}', toolCallIds: [],            toolResultsBefore: 1 },
];
```

The publishing turn (turn 1) carried **no** tool call. The corrected
logic reports `publishedTurnAlsoCarriedToolUse === false`; the legacy
logic reports `true`, because it read turn 0's count.

```text
CORRECTED:  publishedTurnAlsoCarriedToolUse = false   (the truth)
LEGACY:     publishedTurnAlsoCarriedToolUse = true    (the defect)
```

## The defect was LIVE, not hypothetical

The 10 corrected live runs below (`02-live-receipts.md`) show that the
carrier index and the canonical turn index **diverged in 6 of the 9
schema-valid runs**. The positional bug was therefore not a theoretical
concern: it was exercised by the real provider stream on most runs, and
it misattributed the same-turn metric onto the wrong turn.

```text
run 1:  publishedTurnIndex = 3   publishedCarrierIndex = 1   DIVERGED
run 3:  publishedTurnIndex = 2   publishedCarrierIndex = 1   DIVERGED
run 5:  publishedTurnIndex = 2   publishedCarrierIndex = 1   DIVERGED
run 6:  publishedTurnIndex = 2   publishedCarrierIndex = 0   DIVERGED
run 8:  publishedTurnIndex = 2   publishedCarrierIndex = 1   DIVERGED
run 9:  publishedTurnIndex = 2   publishedCarrierIndex = 1   DIVERGED
```

In every one of those runs the corrected metric reports
`publishedTurnAlsoCarriedToolUse = false` — the publishing turn did not
carry a tool call.

## The test count

```text
CORRECTION01 tests:   9 passed (9)
```

- 6 correlation tests (turn-anchoring, tool-only counterexamples,
  chronology, ordering)
- 3 acceptance-separation tests (schema validity vs. canonical reference
  resolution)

## Confidentiality

The counterexample fixtures are entirely synthetic. No provider payload,
credential or free-form model prose is committed.
