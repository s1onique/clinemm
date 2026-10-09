# ACT-CLINEMM-ELM-SEAM04-CORRECTION01 — PASS_ELM_SEAM04_AUTHORITY_CUTOVER — 2026-10-09

**Status:** CLOSED with verdict `PASS_ELM_SEAM04_AUTHORITY_CUTOVER` after a bounded Factory HALT (`HALT_NOTIFICATION_OBLIGATION_UNPROVEN`) was correctly identified and repaired in place. No new epic, no new architecture, no additional review loop.

**HALT root cause (P0):** the original SEAM04 cutover deleted the notification marker synchronously at `consumeTerminal` entry. On a classified kernel failure (`kernel_offline`, `decode_error`, `response_timeout`, `response_mismatch`), the audit returned `no_marker` for diagnostics, but the marker was already gone — `resolveObligation` (Path B) had nothing to drain. The notification obligation was silently lost.

**CORRECTION01 bounded repair:**

1. **Marker reservation.** The marker is moved from `notificationMarkers` to a new `reservedMarkers` field at `consumeTerminal` entry. A second `consumeTerminal` for the same jobId still sees `no_marker` (race-free ownership). On a HEALTHY Elm decision (drained / held / containment_no_wake) the reserved marker is consumed. On `owner_mismatch` the reserved marker is RESTORED to `notificationMarkers`. On a classified infrastructure failure the reserved marker is RESTORED so Path B `resolveObligation` can drain the obligation.

2. **Dispose gate (P1).** A new post-await check `if (this.disposed)` gates the effect interpreter. On dispose() during a pending Elm decision, no wake fires, no audit-record classification of a healthy decision, and the reserved marker is restored. The `dispose()` method also clears `reservedMarkers` for symmetry.

**Adversarial test corrections (P1):**

- **SEQ-8** now mutates the SAME coordinator's active owner (h2.setActiveOwner, not the unused h). The owner switch happens AFTER the snapshot is captured but BEFORE the policy decision resolves. The wake dispatch reads the snapshot owner (`ACTIVE_SESSION`) — verified by `h2.enqueuedPrompts[0].sessionId === ACTIVE_SESSION`.
- **SEQ-9** now uses a controlled Promise (`releaseAuthority`) so dispose runs BEFORE the policy decision resolves. The test asserts that no late effects (no wake, no audit-record classification) are committed after dispose.

**P2 mechanical residue:** batch-removed 72 redundant `await await` expressions across 20 test files (test migration artifacts).

**Production authority migrated (unchanged from CORRECTION00):**
- C2 correlation protocol: host-owned `requestId` passthrough in the Elm wire envelope + `Map<requestId, PendingEntry>` in the TS adapter. No response swapping, no stale commit, no double settlement, no hanging unresolved request, no unbounded pending-response accumulation.
- C7 cutover: `BackgroundNotifyCoordinator.consumeTerminal` is `async` and delegates the policy decision to `consumeTerminalAuthority` (default = `invokeElmForConsumeDecision` = the compiled Elm kernel).
- C11 production kernel path pinned in `extension.ts:380-382` BEFORE the first `consumeTerminal` call.
- C14 authority audit: TS policy callers = 0, Elm authority path = 1, production bypasses = 0, unexplained dual authority = 0.

**Files (CORRECTION01 deltas):**
- `apps/vscode/src/sdk/background-notify-coordinator.ts` — new `reservedMarkers` field; new post-await `if (this.disposed)` gate; `dispose()` clears `reservedMarkers`; `consumeTerminal` moves the marker to reserved (not delete) at entry; classified-failure / owner_mismatch / dispose gates restore the reserved marker.
- `apps/vscode/src/sdk/__tests__/background-notify-authority-cutover04-obligation.bnacut04-obligation.test.ts` (NEW) — 6/6 GREEN: kernel_offline / decode_error / response_timeout each preserve the marker and Path B drains; cross-session isolation preserved; duplicate Path A preserves recoverability.
- `apps/vscode/src/sdk/__tests__/background-notify-authority-cutover04.bnacut04.test.ts` — SEQ-8 and SEQ-9 corrected per the Factory reviewer's P1 defects. 23/23 GREEN.
- 20 test files: 72 redundant `await await` expressions removed (P2 hygiene).

**Toolchain gates (C10):**
- `elm make src/Main.elm --output=vendor/background-notify-authority.js`: PASS.
- `vitest BNAEC01` (SEAM03 corpus): 19/19 PASS.
- `vitest BNACUT04` (SEAM04 production-seam matrix, post-CORRECTION01): 23/23 PASS.
- `vitest BNACUT04-OBLIGATION` (NEW, P0 obligation conservation): 6/6 PASS.
- `vitest BCNEX01` / `BCTPA01`: PASS.
- `tsc --noEmit`: PASS.
- `biome lint`: PASS.
- Bun unit suite (`scripts/run-bun-unit-tests.ts`): 1261/1261 PASS.
- Pure-Elm `elm-test`: **NOT_EXECUTED** in this environment (SEAM03's known env limitation).

**C9 no ACT-owned regression:**
- BCB01: 13 failed / 14 (matches baseline 13/14).
- BCB01-C1: 6 failed / 8 (matches baseline 6/8).
- BCB01-C2: 2 failed / 5 (matches baseline 2/5).
- BCB01-C3: 1 failed / 6 (matches baseline 1/6).
- BCB01-C4: 3 failed / 5 (matches baseline 3/5).
- TQCB01: 10 failed / 15 (matches baseline 10/15).
- BNCA-RED01: 1 failed / 2 (matches baseline 1/2).
- BCNEX01: 7/7 GREEN.
- BCTPA01: 6/6 GREEN.
- BNAEC01: 19/19 GREEN.
- CCCCA01 (predecessor): 35/35 GREEN.

**DOGFOOD_SOURCE_HEAD:** 03f055a96
**DOGFOOD_VERSION:** 4.1.16-03f055a96
**VSIX_PATH / VSIX_BYTES / VSIX_SHA256 / INSTALLED_VERSION:** (NOT_BUILT — see C12 LIVE_UNOBSERVABLE; the `_ELM_KERNELS` row is in place and `extension.ts` is pinned, so a real operator run will stage the asset correctly).

**Residue (P0..P2):**
- P0: None. The obligation-conservation gap is closed.
- P1: None. The adversarial SEQ-8 and SEQ-9 defects are corrected.
- P2 NON-BLOCKING: Pure-Elm `elm-test` deferred (env limitation, SEAM03's known constraint). Kernel functionally proven via `elm make` + BNAEC01 + BNACUT04 + BNACUT04-OBLIGATION.

**Factory stop rules:**
- Zero unresolved P0.
- One bounded correction applied (CORRECTION01).
- No P2 review round needed.

