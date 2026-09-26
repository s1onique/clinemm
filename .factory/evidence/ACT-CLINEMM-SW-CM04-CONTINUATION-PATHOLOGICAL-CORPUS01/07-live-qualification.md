# ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01 — live qualification (bounded correction ROUND 1)

ENTRY_HEAD=4b1f3d6914e78a231c6b292ee8f5fcda904239f4

## Status: NOT_REQUIRED (per ACT §15)

ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01 is a reproduction / behavioral characterization ACT. It introduces NO production code change and NO production wiring change.

The bounded correction ROUND 1 (resolving HALT_PRODUCTION_SEAM_NOT_EXERCISED) added a bridge test file that drives the REAL `LocalRuntimeHost` + REAL `PendingPromptService` via the `@cline-internal/core/...` aliases in `vitest.config.c2-4-c-bridge.ts`. The bridge exercises the SAME production classes the live controller drives; it does NOT exercise the live VS Code UI.

Per ACT §15:
> Only required if: the corpus discovers a mismatch between seam-level tests and live UI, OR production behavior is changed in a successor repair.

The corpus did NOT discover any FALSE_HANDOFF or FALSE_AUTOCONTINUE defect. The 16-pathology corpus (15 PASS_CURRENT + 1 NOT_APPLICABLE for P12 plan->act synthetic continuation, which ClineMM does not implement) demonstrates that the canonical `outstandingAutonomousWork` predicate correctly:
1. HOLDS completion when any autonomous obligation remains (pending prompts, notify-owned markers, dispatched-not-yet-acked wakes).
2. COMMITS completion exactly once when all obligations resolve.

The bridge-test corpus (P3, P5, P6, A, B) additionally proves the REAL `PendingPromptService` + drain + `LocalRuntimeHost.runTurn` re-entry chain correctly:
- FIFO for `delivery:"queue"`; unshift-prepend for `delivery:"steer"`.
- Shift the head entry on drain (steer preempts queue head).
- Re-enter `runTurn` exactly once per drained prompt via `queueMicrotask(drain)`.
- Do NOT dedupe by `jobId`.
- Honor `pendingPrompts.delete({ sessionId, promptId })` BEFORE drain sees the entry.

The live UI behavior of this predicate is already exercised by the predecessor dogfood VSIX:
- VSIX: `dist/dogfood/clinemm-4.1.16-521f23482.vsix`
- SHA-256: `1f1af4ad2eb08f8230dd714b8ee9836f0a7d387bf5d4c49fd6b60f37094d02c7`
- Bytes: 14618266
- Bound to ENTRY_HEAD `521f23482` (post-C10-ROUND-2, pre-corpus)
- Status: CAPTURE_INSUFFICIENT[SYSTEM]_NONBLOCKING (Electron SIGSEGV in agent sandbox — environmental)

## Verification that NO production code changed

`git diff --check` is clean.

`git diff --stat HEAD -- apps/vscode/src` shows ONLY:
- `apps/vscode/src/sdk/__tests__/continuation-pathological-corpus01.swcm04.test.ts` (BASE file, ROUND 0 closure: 976 lines)
- `apps/vscode/src/sdk/__tests__/continuation-pathological-corpus01.swcm04.c24-c-bridge.test.ts` (BRIDGE file, ROUND 1 closure: 657 lines)
- NO changes to `apps/vscode/src/sdk/*.ts` (production source unchanged).
- NO changes to `sdk/packages/core/src/...` (production source unchanged).
- `apps/vscode/vitest.config.ts` — added exclusion entry for the bridge file.
- `apps/vscode/vitest.config.c2-4-c-bridge.ts` — added the bridge file to the include list.

`tsc --noEmit`: clean.
`check-types:c2-4-c-bridge` (frozen baseline): OK — 0 diagnostic(s) match.
`biome lint`: clean (no errors on either test file).

## Verdict

Live qualification is NOT REQUIRED for this ACT. The seam-level corpus (base file) classifies current completion-barrier behavior across the entire user-attention handoff boundary. The bridge-test corpus (c24-c-bridge) classifies current queue-mechanics behavior across the entire continuation chain. No live-UI discrepancy was discovered. No production change was made.
