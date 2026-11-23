# 03 — Producer probe (G3, PROBE-1/2/4/8)

Executable source:
`sdk/packages/core/src/extensions/context/compaction.adjudication-output-contract.probe01.test.ts`

```text
EXECUTION CLASS: SYNTHETIC_REAL
  (a synthetic canonical fixture, driven through the REAL production
   adapters and the REAL canonical codecs)
```

## PROBE-1 — assistant-text publication

**Result: PASS.**

A structured candidate CAN be emitted in an assistant `text` block and is
represented by the canonical model.

```text
assistant.text  =  {"kind":"adjudication_candidate", ... }
canonical block =  { type: "text", text: <the same string> }
parse           =  ok
  finding_id            = S1
  decision              = narrowed
  qualification_codes   = ["manual_enforcement_only"]
```

The second PROBE-1 assertion proves the same for the agent-message codec:
canonical -> agent messages -> canonical preserves the carrier.

## PROBE-2 — continued execution

**Result: PASS.**

- A `text` carrier and a `tool_use` carrier COEXIST in the same canonical
  assistant turn. The probe asserts the turn's block-type list contains
  BOTH `text` and `tool_use`.
- Publication does NOT terminate the task: with three trailing tool-use
  turns, later `tool_use` blocks are still present AFTER the publishing
  turn.

## PROBE-3 — canonical persistence

**Result: PASS.**

See `04-canonical-persistence.md`.

## PROBE-4 — no thinking dependency

**Result: PASS.**

The synthetic fixture places an unrelated, synthetic private-reasoning
block in a SEPARATE `thinking` block of the SAME assistant turn that
carries the published envelope.

- The strict parser is handed ONLY the `text` carrier and succeeds. The
  thinking block's presence is irrelevant to the outcome.
- The same parser, handed the THINKING carrier, REJECTS it
  (`malformed_json`). A naive verdict-word scrape over that block WOULD
  have found something ("S1", "probably fine", "60% confident"); the
  strict parser finds nothing, because the thinking body is not a JSON
  envelope.

This is the direct, executable refutation of the predecessor's failure
mode: **the contract does not need to read private reasoning to work.**

## PROBE-8 — no artifact

**Result: PASS.**

| Fixture | Expected | Observed |
|---|---|---|
| Turn with ONLY thinking + tool_use | `NO_PUBLISHED_ADJUDICATION` | 0 candidates collected |
| Envelope present ONLY in the thinking block | never recovered | 0 candidates collected |
| Envelope present ONLY in a tool result | never recovered | 0 candidates collected |

The collector reads assistant `text` blocks and nothing else. It never
inspects `thinking` blocks, tool results, or user messages.

## The one-pass live-model confirmation of PROBE-2

The live probe (`06-adversarial-controls.md`) independently observed that
the publishing turn ALSO carried a tool call in every successful run
(`publishedTurnAlsoCarriedToolUse: true`). That is a REAL model emitting a
`text` envelope and a `tool_use` in the SAME assistant turn — the live
analogue of PROBE-2.
