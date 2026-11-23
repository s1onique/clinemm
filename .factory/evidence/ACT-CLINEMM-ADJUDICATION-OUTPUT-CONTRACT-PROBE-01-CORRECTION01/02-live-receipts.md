# 02 — The reconciled live receipts

## What was re-executed

The predecessor's committed transcript contained ONE live observation
while its reports claimed ten. This ACT re-executed the live probe with
the **corrected** harness and committed **one distinct sanitized receipt
per run**.

```bash
cd sdk/packages/core
CORE_LIVE_ADJUDICATION_PROBE=1 \
CORE_LIVE_ADJUDICATION_PROVIDER_KEY=minimax \
CORE_LIVE_ADJUDICATION_RUNS=10 \
bun scripts/adjudication-output-contract.live-probe.ts
```

Transcript: `verification/gate8-live-model-probe-correction01.txt`
(10 runs, each emitted as its own observation).

```text
EXECUTION CLASS:  REAL_MODEL_RESPONSE
MODEL / PROVIDER: minimax / MiniMax-M3
OBSERVATIONS:     10  (one distinct receipt per run)
```

## The ten receipts

Every column is derived from the committed transcript and can be
re-derived from it by anyone reading the file.

| # | schema_valid | canonical_refs_resolved | source_revision_bound | candidate_accepted | publishedTurnIndex | publishedCarrierIndex | same-turn tool use | after tool result | turns |
|---|--------------|------------------------|----------------------|--------------------|--------------------|----------------------|--------------------|-------------------|-------|
| 1 | true  | false | false | **false** | 3 | 1 | **false** | true | 4 |
| 2 | false | false | false | **false** | —   | —   | —      | —    | 2 |
| 3 | true  | false | false | **false** | 2 | 1 | **false** | true | 3 |
| 4 | true  | **true** | false | **false** | 1 | 1 | **false** | true | 2 |
| 5 | true  | false | false | **false** | 2 | 1 | **false** | true | 3 |
| 6 | true  | false | false | **false** | 2 | 0 | **false** | true | 3 |
| 7 | true  | false | false | **false** | 1 | 1 | **false** | true | 2 |
| 8 | true  | false | false | **false** | 2 | 1 | **false** | true | 3 |
| 9 | true  | false | false | **false** | 2 | 1 | **false** | true | 3 |
| 10 | true  | false | false | **false** | 1 | 1 | **false** | true | 2 |

## The reconciled statistics

Every figure below is computed from the ten receipts above.

```text
RUNS MEASURED:                       10
SCHEMA-VALID PUBLICATIONS:            9  (run 2 did not publish)
CANONICAL REFS RESOLVED:             1  (run 4 only)
SOURCE REVISION BOUND:                0  (structurally impossible)
CANDIDATES ACCEPTED:                 0

PUBLISHING TURN ALSO CARRIED TOOL USE: 0 of 9
PUBLISHED AFTER A TOOL RESULT:         9 of 9
```

## What this corrects

### The publication rate survives; the acceptance rate was never measured

The predecessor's `9 of 10 published` figure is **confirmed** by the
corrected receipts: 9 of 10 runs published a schema-valid candidate. The
publication rate was the one number that held up.

But the predecessor conflated *publication* with *acceptance*. The
corrected measurement is unambiguous:

```text
9 of 10 runs published a SCHEMA-VALID envelope.
0 of 10 runs produced an ACCEPTED adjudication.
```

The gap is not noise. It is structural, and it is described in
`03-acceptance-gates.md`.

### The universal same-turn claim is REFUTED

The predecessor's `06-adversarial-controls.md` asserted:

> "The publishing turn ALSO carried a tool call in every successful run."

and `09-exit-report.md` repeated it as "In every published run:
`publishedTurnAlsoCarriedToolUse = true`".

The corrected receipts say otherwise:

```text
publishedTurnAlsoCarriedToolUse = true   in 0 of 9 schema-valid runs
```

**Every** publishing turn was a text-only turn. The predecessor's single
committed observation already recorded `false`; the corrected measurement
confirms it at scale, and shows the predecessor's universal claim was
inverted.

### The turn index and the carrier index diverged in most runs

```text
DIVERGED (publishedTurnIndex != publishedCarrierIndex):  6 of 9
```

This is the direct evidence that the P0-2 positional defect was live in
the real provider stream, not merely a latent code smell.

### The "after tool result" property survives

```text
publishedAfterToolResult = true   in 9 of 9 schema-valid runs
```

This one holds under the corrected, chronology-based definition: the
publishing turn did begin after a tool result had been appended. The
predecessor's *reasoning* for it was wrong, but the *conclusion* for
these runs is right — for a different reason, and now for a reason that
is tied to the adjudication carrier itself.

## The distinct acceptance-failure reasons

```text
run 1:  unresolvable_tool_reference:read_files_synthetic-pool-config.yaml
run 3:  unresolvable_tool_reference:call_1
run 4:  unbound_source_revision          <-- PASSED gate 2, failed gate 3
run 5:  unresolvable_tool_reference:call_1
run 6:  unresolvable_tool_reference:call_1
run 7:  unresolvable_tool_reference:call_1
run 8:  unresolvable_tool_reference:call_1
run 9:  unresolvable_tool_reference:call_1
run 10: unresolvable_tool_reference:call_1
run 2:  (no publication — parse rejection: malformed_json)
```

**Run 4 is the decisive receipt.** It is the only run whose evidence
references resolved to canonical tool calls — and it STILL was not
accepted, because it failed the source-revision gate. This proves the
four gates are genuinely independent and that no aggregate of "published"
can stand in for "accepted".

## The negative finding is CONFIRMED and hardened

The predecessor recorded that the model's `evidence_tool_use_ids` were
not canonical ids. The corrected receipts reproduce this:

```text
observed cited ids across the 10 runs:
  call_1 / call_2                         (invented)
  read_files_1                            (the tool NAME, suffixed)
  read_files_synthetic-pool-config.yaml   (a synthetic LABEL)
  (empty)                                 (run 4 — nothing cited)
```

None of these is the canonical tool-call id of the session. Under the
contract every one of them is REJECTED as
`unresolvable_tool_reference:<id>`.

This is correct behaviour, and it is the operational content of
constraint **C1** — see `04-constraints-and-verdict.md`.

## The categories are still kept distinct

```text
SYNTHETIC CANONICAL FIXTURE  ->  the probe test file (test-local)
MOCKED PROVIDER RESPONSE      ->  the compaction consumer probe
REAL MODEL RESPONSE           ->  THIS DOCUMENT (the ten receipts)
LIVE INSTALLED RUN            ->  NOT CLAIMED
```

No category was promoted to another. In particular, this remains a
**REAL MODEL RESPONSE**, not a LIVE INSTALLED RUN: the installed runtime
was not exercised end-to-end.
