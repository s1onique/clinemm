# 00 — Identity and source parity

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01` (CPR01)

Predecessor: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01` (OPPOR01) at `159d92dcb`.

## 00.1 Source HEAD

```
159d92dcb test(clinemm): ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01 — PASS_CAUSAL_PROOF
e0e30879f docs(clinemm): ACT-CLINEMM-WORKING-AFTER-COMPLETION-DISCRIMINATOR01 — CAPTURE_INSUFFICIENT
b1ad2a0de fix(roundc-harness): ACT-CLINEMM-ROUND-C-HARNESS-03 — accept the JSON-encoded array-of-objects shape for run_commands
```

## 00.2 What this ACT changed

Production (2 files):

| File | Change |
| --- | --- |
| `apps/vscode/src/sdk/sdk-session-lifecycle.ts` | new OPTIONAL `onCanonicalRuntimeRebind?: (sessionId: string) => void` option; `replaceActiveSession` invokes it AFTER the replacement session is installed, with the replacement's session id |
| `apps/vscode/src/sdk/SdkController.ts` | wires the option to the EXISTING `attachCanonicalRuntimeEventSubscription`, with the SAME identity fence the follow-up-resume rebind uses |

Test / config (no production behavior):

| File | Change |
| --- | --- |
| `apps/vscode/src/sdk/__tests__/elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts` | NEW — the production-seam discriminator (7 tests) |
| `apps/vscode/vitest.config.c2-4-c-bridge.ts` | registers the new bridge test |
| `apps/vscode/tsconfig.c2-4-c-bridge.json` | registers the new bridge test for the bridge typecheck |
| `apps/vscode/vitest.config.ts` | EXCLUDES the new bridge test from the base stream (it needs the `@cline-internal/core/...` aliases) |
| `apps/vscode/tsconfig.json` | EXCLUDES the new bridge test from the base typecheck (same reason) |

No change was made to:

- the Elm completion policy (`elm/completion-authority/**`),
- `canonical-event-subscription.ts` (the producer's join is CORRECT; it was starved),
- `completion-authority-elm-replay.ts` / `completion-authority-elm-authority-runtime.ts`
  (the adapter refuses to manufacture identity — that is correct),
- C9/C10, BCB, session-ownership, queueing or presentation code.

## 00.3 The Elm kernel used

`apps/vscode/elm/completion-authority/vendor/completion-authority.js` — the SAME compiled
artifact the shipped extension loads. It was NOT rebuilt by this ACT.
