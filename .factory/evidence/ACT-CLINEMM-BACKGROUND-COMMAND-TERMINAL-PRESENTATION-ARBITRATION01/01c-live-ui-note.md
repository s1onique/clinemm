# LIVE UI Screenshot — placeholder

The live UI screenshot (`01c-live-ui.png`) is **PENDING** in this ACT
context. The cloud-agent lacks:

1. An LLM provider credential (no ANTHROPIC_API_KEY / CLINE_API_KEY /
   OPENROUTER_API_KEY env var set)
2. The dogfood VSIX install + sideload infrastructure required to drive
   a real chat session against a production-shaped background command

The prior ACT-CLINEMM-BACKGROUND-NOTIFY-EXACTLY-ONCE-PRESENTATION01
recorded the same `POST-FIX_LIVE = PENDING` condition and was accepted as
the canonical pattern.

## Expected UI shape (per ACT §0 frozen specimen)

```text
[ chat row 1: agent text "I'll start the command in the background and notify you when it's done" ]
[ chat row 2: terminal card "Running: sh -c 'echo STARTED; sleep 30; echo FINISHED'" ]
[ chat row 3: completion box "I've started the command in the background. It will take about 30 seconds." ← PRESENTATION A (RED; suppressed in GREEN) ]
[ chat row 4: terminal card "Completed (exit 0)" ]
[ chat row 5: completion box "The command completed. Output: STARTED\nFINISHED" ← PRESENTATION B (preserved in GREEN) ]
```

## Reproduction in tests

The BCTPA-RED-01 / BCTPA-ABLATION-01 / BCTPA-GREEN-01 suite drives the
EXACT production chain end-to-end and counts the visible
`say:"completion_result"` messages emitted via `appendAndEmit`. The
GREEN assertion is:

```text
appendAndEmit.callCount(rows where say === "completion_result") === 1
```

This count is the load-bearing identity (not text, not prompt, not
timestamp, not array index, not render count) — see ACT §13.
