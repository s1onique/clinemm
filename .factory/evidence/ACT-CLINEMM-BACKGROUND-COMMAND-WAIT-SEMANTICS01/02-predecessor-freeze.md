# 02 — Predecessor freeze (AGCONT01 correction cycle 2)

Predecessor: `ACT-CLINEMM-BACKGROUND-COMMAND-AGENT-CONTINUATION01`
Final verdict: `HALT_PRODUCT_CONTRACT_REQUIRED`
Frozen commit: `3a201b49c0c2de5a1a7f224e9633d07046400df9`

## What the predecessor ACT proved (closed unless new contradictory evidence)

```text
PWAOR_ABORT_OWNERSHIP =
  LIVE GREEN

BACKGROUND_TERMINAL_CONTINUATION =
  LIVE GREEN

CURRENT_TURN_ENDED_ON_AGENT_DONE =
  PROVEN

TERMINAL_TO_AGENT_REENTRY =
  ABSENT_STRUCTURAL

BTCONT_TERMINAL_TO_AWAITING_FOLLOWUP =
  PASS

WAIT_UNTIL_FINISHED_PRODUCT_CONTRACT =
  UNRESOLVED

AGCONT01_PRODUCTION_REPAIR =
  NOT_AUTHORIZED
```

## What the predecessor ACT did NOT establish

```text
- The structural absence of a terminal->AgentRuntime consumer is NOT
  equivalent to "the runtime promises not to wake the agent".

- F4 doctrine (run_commands tool description) tells the MODEL to
  background + tmp-file + poll. It does not categorically forbid
  the runtime from introducing a notify-on-terminal mechanism, and
  it does not categorically require it either.

- The user's "wait until finished" intent is conveyed only via
  natural-language prose. The runtime has no flag to disambiguate
  "wait until finished" from "fire-and-forget" from "tell me when
  done".

- Whether the existing structural choice (no re-entry seam) is
  CORRECT PRODUCT SEMANTICS is a product-surface decision, not a
  runtime defect. It is out of scope for AGCONT01 and inherited by
  this ACT.
```

## Successor authorization (verbatim from predecessor result.json)

```text
successor_act: ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01
purpose:       select between model polling, opt-in notify-on-terminal,
               explicit await-terminal, or explicit multi-mode semantics
```

## Why this ACT must not skip the recon

The predecessor's verdict is `HALT_PRODUCT_CONTRACT_REQUIRED`. This ACT
exists to resolve that halt. Skipping recon would freeze a contract
without evidence that:

- the existing tool surface can carry the distinction,
- the existing async seams can be reused or are deliberately bypassed,
- upstream patterns are correctly mapped (not mis-mapped),
- the `done` semantics actually support the candidate chosen.

The recon below freezes the runtime's structural state as of HEAD.
