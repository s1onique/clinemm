
# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
# Post-P3-GREEN state (nineteenth-pass, 2026-09-03)
#
# Reviewer on a04387552:
#   HALT_RED_NOT_BOUND_TO_PROJECTION_SEAM.
#   P0_1: RED manufactured `{}` as ExtensionState (no
#     causal edge to the runtime-event delivery).
#   P0_2: intentionally failing *.test.ts committed
#     under default discovery.
#   C1:  GO_P3 (real GREEN in this cycle).
#
# This file documents the GREEN state (no elaborate
# historical section per reviewer's "no multi-hundred-
# line historical section" directive).
#
# ---
#
# State (post-GREEN, this commit only):
#
#   W producer                = CLOSED
#   W cadence                 = CLOSED
#   runtime state             = CLOSED
#   runtime publication       = CLOSED
#   durable transition tests  = CLOSED
#   HOST_PUBLICATION          = COMPOSED PROOF / ACCEPTED
#   Boundary 3 host capture   = CLOSED (this commit)
#   Boundary 3 -> 4 transport = CLOSED (this commit)
#   Boundary 4 webview state  = CLOSED (this commit)
#   Boundary 5 header         = OPEN  (next bounded cycle)
#   NO_INDEPENDENT_W_SCALAR   = TRUE
#
# ---
#
# Production code (this commit, 4 files):
#
#   NEW:
#     apps/vscode/src/sdk/working-context-host-capture.ts
#       WorkingContextHostCapture class.
#       Assignment semantics on observe() — UNDEFINED_W_
#       STALE_REUSE = FORBIDDEN is enforced at this layer
#       (no conditional skip).
#       Transport-only — no estimator imports.
#
#     apps/vscode/src/core/controller/state/
#     working-context-state-projection.ts
#       Pure projection helper extracted from
#       getStateToPostToWebview so the W transport can
#       be unit-tested without an extension-host
#       bootstrap. The bigger function delegates to it
#       (single source of truth for the transport
#       contract).
#
#   MODIFIED:
#     apps/vscode/src/shared/ExtensionMessage.ts
#       ExtensionState.currentWorkingContextEstimate
#       added (typed carrier into the webview).
#
#     apps/vscode/src/core/controller/state/
#     getStateToPostToWebview.ts
#       Reads controller.workingContextHostCapture
#       via the pure helper above. Transport-only.
#
#     apps/vscode/src/sdk/SdkController.ts
#       Owns a WorkingContextHostCapture instance.
#       attachCanonicalRuntimeEventSubscription wraps
#       the existing TaskShadow wiring so that the
#       canonical event stream populates the carrier
#       BEFORE forwarding to the shadow wiring (the
#       wiring itself is unchanged; the wrap is
#       Boundary-3-local).
#       getStateToPostToWebview threads the carrier
#       to the production helper.
#
# ---
#
# Tests (1 file, 7 tests):
#
#   apps/vscode/src/sdk/__tests__/
#   working-context-webview-state-projection.test.ts:
#     1. GREEN: W=271337 drives capture; pure helper
#        emits W=271337.
#     2. GREEN: W=undefined clears the carrier
#        (fail-closed; UNDEFINED_W_STALE_REUSE =
#        FORBIDDEN).
#     3. GREEN: a no-W-first event leaves the carrier
#        at undefined (no FAKE preservation).
#     4. GREEN: non-W runtime events do NOT mutate the
#        carrier (fast-skip).
#     5. GREEN: 0 / undefined / missing carrier all
#        pass through the projection unchanged (no
#        coercion, no estimation).
#     6. GREEN: W sequence (100, undefined, 200) is
#        mirrored verbatim through capture + projection.
#     7. CONSERVATION: zero estimator imports in
#        apps/vscode/src production code (permanent
#        gate).
#
# Run:
#   $ bunx vitest run --config vitest.config.ts \
#       src/sdk/__tests__/working-context-webview-state-
#       projection.test.ts
#   Tests  7 passed (7)
#
# ---
#
# Boundary map (revised for post-GREEN state):
#
#   AgentRuntime
#     snapshot.currentWorkingContextEstimate = W
#     working-context-state-changed
#           |
#           v
#   LocalRuntimeHost.subscribeRuntimeEvents fanout
#      |- legacy adapter (-> runtime-event-adapter
#      |   .ts:302-321) -> legacy chat events
#      |   (W intentionally omitted — legacy side
#      |    branch, NOT on the W transport path)
#      |
#      '- host runtime-event subscriber
#           (apps/vscode/src/sdk/SdkController
#            .attachCanonicalRuntimeEventSubscription)
#              |
#              |  wraps the existing TaskShadow
#              |  wiring so:
#              |   1. capture.observe(event)
#              |      -> workingContextHostCapture
#              |         .currentWorkingContextEstimate
#              |         assignment semantics (includes
#              |         undefined for fail-closed)
#              |   2. wiring.observeCanonicalRuntime
#              |      Event(input) (unchanged shadow
#              |      wiring)
#              v
#   Boundary 3 -> 4 carrier:
#   projectWorkingContextStateFromCarrier(capture)
#   (apps/vscode/src/core/controller/state/
#    working-context-state-projection.ts — PURE)
#              |
#              v
#   getStateToPostToWebview (delegates to helper)
#              |
#              v
#   ExtensionState.currentWorkingContextEstimate
#              |
#              v
#   Boundary 5 (ChatView/TaskHeader) — OPEN
#     numer currently = P (provider sum); the next
#     bounded cycle swaps to W with the
#     UNDEFINED_W_FALLBACK decision still PENDING
#     (deferred per reviewer).
#
# ---
#
# Evidence labels:
#
#   Boundary 3 -> 4 carrier (this commit) =
#     SYNTHETIC_REAL /
#     PASS (real production capture + real
#           pure-projection helper + synthetic
#           AgentRuntimeEvent with synthetic W)
#
#   proxy seam sanity (retained from prior pass) =
#     SYNTHETIC_REAL / PASS
#
#   APPs_VSCODE_W_ABSENCE (recon witness) =
#     SUPERSEDED — Boundary 3 capture now exists in
#     apps/vscode/src. The recon witness is retired;
#     the conservation probe (test #7) replaces it.
#
# ---
#
# Conservation (verbatim from reviewer):
#
#   apps/vscode MUST NOT import / use:
#     estimateRequestInputTokens
#     estimateMessageTokens
#   for this projection. The carrier is transport only;
#   the pure projection helper is transport only; the
#   producer delegates to the helper. The test #7
#   above keeps this gate enforced permanently.
#
#   UNDEFINED_W_STALE_REUSE = FORBIDDEN:
#     the carrier uses unconditional assignment on
#     observe(); a no-W event sets the slot to
#     undefined, NOT preserved as the prior W.
#     Verified by test #2 above.
#
#   P remains available for provider / request
#     metrics (untouched).
#   H_b / H_a remain compaction telemetry
#     (untouched).
#   getApiMetrics Strategy-D stays untouched
#     (untouched — getLastApiReqContextInputTokens
#     continues to drive provider-activity contexts;
#     Boundary 5 may swap the WebView bar's numerator
#     when the next cycle decides the fallback).
#
# ---
#
# Disposition:
#
#   BOUNDARY_RECON            = PASS / USEFUL
#                               (calibrated: legacy
#                                adapter is a side
#                                branch, not on W
#                                path)
#   BOUNDARY_3_CAPTURE        = SYNTHETIC_REAL / PASS
#   BOUNDARY_3_TO_4_TRANSPORT = SYNTHETIC_REAL / PASS
#   HOST_PUBLICATION          = COMPOSED PROOF /
#                               ACCEPTED
#   NO_INDEPENDENT_W_SCALAR   = TRUE
#   UNDEFINED_W_STALE_REUSE   = FORBIDDEN (enforced
#                                 via assignment
#                                 semantics in the
#                                 carrier)
#   RED                      =
#     NOT_REPRODUCED_AT_HEAD
#     (replaced with real production-seam GREEN
#      in this commit; intentionally failing test
#      removed from default discovery)
#   NEW_REVIEW_ROUND          = NO
#   C1                        = GO_P3_B5 / next
#
# ---
#
# Next bounded cycle:
#
#   Boundary 5: ChatView / TaskHeader uses W
#     for the numerator (when present) instead
#     of P (lastApiReqContextInputTokens). The
#     UNDEFINED_W_FALLBACK (A=fall back to P;
#     B=unavailable/unknown) is the single
#     remaining design decision. The decision is
#     deferred to the next cycle: read the
#     existing ContextWindow.tsx component
#     contract (line 167: returns null when
#     tokenData is falsy) and decide based on
#     that observable behavior.
#
