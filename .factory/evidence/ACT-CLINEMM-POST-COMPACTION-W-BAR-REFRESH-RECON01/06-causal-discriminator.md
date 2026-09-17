# 06-causal-discriminator.md

CLASS = A
EVIDENCE = source-level reproduction at the M6 boundary
REASON = the producer computes W_post correctly inside
         createContextCompactionPrepareTurn's return, but
         compactSessionMessages does not return it, so the
         host-side carrier never observes it for manual
         compaction completion.

PARALLEL CHECKS that all RULE OUT alternative classes:

A. NO_POST_COMPACTION_PUBLICATION
   * CONFIRMED at M6 (compactSessionMessages return)
   * The producer (compaction.ts:824..838) computes W_post.
   * The consumer (carrier.observe) has no caller for manual compaction.

B. WRONG_PUBLICATION_VALUE
   * REFUTED. The producer publishes correctly when its return flows
     through AgentRuntime.prepareTurnForModelRequest. In MANUAL mode,
     compactSessionMessages bypasses that runtime seam entirely.

C. STALE_OVERWRITE
   * REFUTED. There is no race — W_post never even reaches the carrier.

D. HOST_STATE_NOT_UPDATED
   * REFUTED. The host state is reachable; the postStateToWebview at
     M7 is exercised; the controller reads the carrier and projects
     ExtensionState. The carrier is the false authority.

E. WEBVIEW_STATE_NOT_REFRESHED
   * REFUTED. The postStateToWebview at M7 covers the W field.

F. SELECTOR_MEMOIZATION_STALE
   * REFUTED. ContextWindow's useMemo for tokenData depends on
     currentWorkingContextEstimate, lastApiReqContextInputTokens, and
     contextWindow (ContextWindow.tsx:242..246). When the ExtensionState
     updates, the prop updates, the memo recomputes.

G. WRONG_UI_AUTHORITY
   * REFUTED. ContextWindow's numerator precedence is W (number) > P
     (lastApiReqContextInputTokens) > UNAVAILABLE. The bar is
     correctly wired.

H. DUAL_ESTIMATOR_EXPECTED
   * REFUTED. The divider uses SDK status-notice tokens; the bar
     uses the canonical W. They would converge on the SAME value if
     the W were published.

I. RESTORE/SESSION_IDENTITY_MISMATCH
   * REFUTED. The sessionId is fixed across the manual-compaction
     lifecycle; the active session is preserved through restorePhase()
     and never changes during compaction completion.

J. RACE_WITH_IN_FLIGHT_ESTIMATE
   * REFUTED. No in-flight estimate; manual compaction synchronously
     publishes (or drops) W.

K. NOT_REPRODUCED
   * REFUTED. Source code reproduces the defect.

FIRST_BAD_BOUNDARY = M6 (compactSessionMessages return discards W).

PRIMARY PRINCIPAL RED (RESEARCH RECON, not yet formal RED at the
production seam test layer):

  After a successful manual compaction:
    - compactSessionMessages returns { compacted, messages, compactionState }
    - last observed working-context-state-changed event timestamp
      does NOT change during the compaction
    - workingContextHostCapture._latest remains the pre-compaction value
    - ExtensionState.currentWorkingContextEstimate is the pre-compaction value
    - Top bar renders the pre-compaction value

The bounded production-seam RED will be the post-repair GREEN above
the existing c25/fifteenth-pass tests, with one ADDITIONAL TEST:
`apps/vscode/src/sdk/__tests__/sdk-compaction-w-publish-recon01.test.ts`
asserting:
  - given a synthesized pre-compaction W (e.g. 412_700)
  - when compactSessionMessages succeeds with W_post defined
  - then WorkingContextHostCapture.observe receives the new W
  - so ExtensionState.currentWorkingContextEstimate equals W_post
    after the next postStateToWebview.

This RED verifies the new W-publication path. (To be written as
part of GREEN; recon01 freeze = pre-repair source state confirmed.)
