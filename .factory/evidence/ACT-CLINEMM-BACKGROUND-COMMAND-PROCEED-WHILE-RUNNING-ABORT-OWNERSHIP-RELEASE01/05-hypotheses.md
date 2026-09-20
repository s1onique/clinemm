# 05 — Hypotheses

## H1 (PRIMARY) — Retained caller AbortSignal ownership across handoff

```text
caller context.signal attached during start
→ job enters managed active map (running)
→ foreground tool performs Proceed While Running handoff
→ foreground tool returns RUNNING
→ original AbortSignal listener remains attached
→ later caller signal aborts
→ detached job CANCELLED  (defect)
```

### Required RED

```text
real handoff completed
AND
abort original caller signal
AND
job becomes cancelled (requestOrigin = caller_abort_signal)
```

### Required GREEN (ablation)

```text
real handoff completed
AND
release caller AbortSignal listener from that job BEFORE the signal aborts
AND
abort original caller signal
AND
job remains running
```

### Discriminator

The RED and GREEN must differ only in:

```text
caller AbortSignal ownership after handoff
```

NOT in:
- different manager
- different fake supervisor
- different timeout
- different handoff
- different shell command
- different status implementation

Preferred: same test fixture, same command, same supervisor, same manager, same caller signal, same handoff path. One variable.

## H2 — Handoff never actually completed

Maybe the LIVE `Backgrounded` presentation occurred before the actual release seam. Then the caller AbortSignal may legitimately still own the command.

Classification: `CASE_H2_HANDOFF_NOT_COMPLETED`.

RED test design MUST verify that `start.state === "running"` from the real producer (NOT synthesized) and that the tool function actually returned the RUNNING envelope before the abort is issued. This rules out H2.

## H3 — Some other component re-attaches caller ownership

Release occurs correctly, but a later seam attaches the same signal again.

RED test design inspects the job record's `abortSignal`/`abortListener` fields after handoff to verify whether ANY listener is attached. If the listener is still attached at handoff, H3 is already ruled out at the structural level (no later seam can re-attach if we never released).

Classification: `CASE_H3_ABORT_OWNERSHIP_REATTACHED` — RULED OUT at the structural level.

## H4 — Cancellation listener ownership is intentionally retained

If the repository contract differs from upstream and intentionally defines:

```text
background job remains owned by caller AbortSignal
```

then this is a product-contract disagreement, not an implementation bug.

`HALT_PRODUCT_CONTRACT_REQUIRED`.

The predecessor ACT established:
- BJLA dump confirms the cancellation arrives from `caller_abort_signal` — not from any of the explicit cancel seams.
- The TaskHeader / projection system already handles long-running jobs (the Backgrounded card exists and the operator can hit Cancel).
- The LIVE result is `Your turn` — i.e. the model loses the turn even though the user explicitly chose "Proceed While Running" (or the 300 s auto-proceed fired).

The product intent is clearly that "Proceed While Running" leaves the command alive AFTER the foreground tool returns. The current code violates this contract. Not H4.

## Stop taxonomy

| Outcome | Classification |
|---------|----------------|
| RED reproduces + ablation GREEN | `RED_REPRODUCED`, then `ROOT_CAUSE_NECESSITY_ESTABLISHED` → production repair authorized |
| RED does NOT reproduce | `HALT_RED_NOT_REPRODUCED` → STOP |
| RED reproduces but ablation does NOT turn GREEN | `HALT_ROOT_CAUSE_NOT_NECESSARY` → STOP (the listener retention is not the necessary cause; some other mechanism is responsible) |
| RED cannot exercise real handoff | `CAPTURE_INSUFFICIENT` → STOP (must use real seam) |
| Handoff itself aborts/terminates job | `CASE_HANDOFF_BOUNDARY_DEFECT` → STOP and reclassify |

This ACT executes only H1. H2 is ruled out by the RED test design (asserting `start.state === "running"` from the real producer). H3 is ruled out by the structural recon. H4 is ruled out by the product-contract recon. The successor ACT (if RED→GREEN) is the bounded repair.
