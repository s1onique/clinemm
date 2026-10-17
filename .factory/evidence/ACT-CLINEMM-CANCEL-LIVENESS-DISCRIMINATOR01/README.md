# ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01 — evidence

**Status:** RED + discriminator only; no repair authorized (per
ACT §0 and §6). CLOSE is NOT authorized until the operator
freezes the live capture (see ACT §16).

## What this evidence directory proves

A new production-seam diagnostic at
`apps/vscode/src/sdk/cancel-liveness-diagnostic.ts` adds five
bounded counters that pin the load-bearing witnesses for the
H-A vs H-B vs H-C vs Healthy discriminator inside
`SdkTaskControlCoordinator.cancelTask()`. The diagnostic:

- Is `DEFAULT_OFF` in public builds. The dogfood profile is the
  sole gate (mirrors the EHLOOP / CCARD / BJLA / BOCOR / TSWPD /
  THSICAP pattern; no env var, no override matrix, no parser).
- Adds no public API, no protocol field, no webview field, no
  state-semantic delta.
- Captures the live classification of any of {Healthy, H-A,
  H-B, H-C} without changing observable behavior.

The RED test at
`apps/vscode/src/sdk/__tests__/cancel-liveness-diagnostic.red.test.ts`
verifies all four rows of the discrimination matrix
deterministically via a hand-written
`SdkSessionHost`-shape test double (a small injected
dependency at the actual failing boundary per ACT §4 RED
property #8). The test does NOT depend on the live capture; it
is a production-shape reproduction.

## Files in this evidence directory

| File | Purpose |
|---|---|
| `README.md` | This file. |
| `00-discrimination-matrix.md` | The full discrimination matrix (Healthy / H-A / H-B / H-C) with RED-A1, RED-A2, RED-B counters. |
| `01-red-output.txt` | Last RED test output. |
| `SHA256SUMS` | SHA-256 of `01-red-output.txt` and the operator-supplied live capture (when frozen). |

## Operator freeze (out of scope here)

Once the operator runs the dogfood profile in a real session
that exhibits the symptom and the diagnostic captures one of
{H-A, H-B, H-C}, the live capture is frozen to
`operator-live-capture.jsonl` and the SHA-256 is appended to
`SHA256SUMS`. Until then, this ACT remains in the RED +
discriminator state. CLOSE is not authorized.

## Stop rule (per ACT §12)

```text
Author the five-counter diagnostic.
Reproduce RED-A1, RED-A2, RED-B.
Pin the discrimination matrix.
Stop. No repair. No Elm change. No launchd change.
The next ACT decides what to fix, if anything.
```

All four are done. The next ACT is gated on operator-supplied
live evidence.
