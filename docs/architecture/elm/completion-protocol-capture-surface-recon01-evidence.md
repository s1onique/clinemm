# Completion-Protocol Capture-Surface Recon 01 — Phase-0 Evidence

> Recon-only. No production change. No test change. No board change.
> Companion to `completion-protocol-liveness02-phase0-capture01.md`
> (committed at `f9186dfcd`). This file documents the result of the
> factory reviewer-authorized Option **B** (CAPTURE_SURFACE_RECON),
> with the strict contract:
>
> ```text
> PRODUCTION_SEMANTICS_DELTA = 0
> DEFAULT_OFF                = required
> PUBLIC_API_DELTA           = 0
> WIRE_PROTOCOL_DELTA        = 0 unless separately authorized
> ```
>
> Evidence hierarchy used: **existing debug harness** (preferred)
> → dev-only diagnostic adapter → temporary DEFAULT_OFF instrumentation
> → never permanent application telemetry.

## 0. Scope

The Phase-0 capture at `f9186dfcd` surfaced a real infrastructure
gap: four discriminator-critical fields (`attemptCompletionSeen`,
`terminalResponseCommittedThisTurn`, `turnState.phase`,
`visibleLastMessage.type/subtype`) are not externally observable
from outside the VSCodium extension host in the current capture
environment. The factory reviewer authorized Option **B**
(CAPTURE_SURFACE_RECON) to investigate whether the existing
diagnostic infrastructure can be used or extended to close this gap
*without* a production semantic delta.

This file is the Phase-0 recon of the existing capture surface.

## 1. Existing capture surface — what is there

### 1.1 The debug harness server

`apps/vscode/src/dev/debug-harness/server.ts` (1621 lines) is an
**opt-in HTTP-controlled debug server** for the Cline VSCode
extension. It is started via:

```bash
node src/dev/debug-harness/server.ts [--auto-launch|--launch] [--port 19229]
```

The server provides:

| Method | Surface | Reach |
|---|---|---|
| `ext.evaluate` | CDP `Runtime.evaluate` in the extension host global scope | Extension host ESM globals; does **not** reach internal classes held by `SdkController` (e.g. `MessageTranslatorState`) unless those classes are exposed on `globalThis` |
| `web.evaluate` | Webview frame `evaluate` (Playwright) | Webview React app global scope |
| `ext.set_breakpoint` | CDP breakpoint by source file (sourcemap-resolved) | Pause on a specific line in extension-host code, then `ext.evaluate` with `callFrameId` to inspect locals |
| `ext.call_stack` / `ext.step_*` | CDP stepping | Read locals at pause |
| `web.set_breakpoint` / `web.step_*` | Webview CDP | Same for webview |
| `ui.*` | Playwright UI automation | Click, type, screenshot, sidebar, command-palette |
| `oauth.*` | OAuth capture/simulation | Browser URL capture + URI callback delivery via `globalThis.__clineHandleUri` |

### 1.2 The `__clineHandleUri` precedent for DEFAULT_OFF production gating

`apps/vscode/src/extension.ts:190-197` shows the **established
production-default-off pattern** for diagnostic affordances:

```typescript
// Debug-harness affordance: VSCode only delivers real vscode:// URIs to the
// registered handler above, which the harness can't synthesize. When running
// under browser-capture (debug harness) mode, expose the same handler on
// globalThis so the harness can deliver simulated OAuth callbacks via
// `ext.evaluate`. Gated on CLINE_CAPTURE_BROWSER so it never ships in prod.
if (process.env.CLINE_CAPTURE_BROWSER === "1" || process.env.CLINE_CAPTURE_BROWSER === "true") {
    ;(globalThis as Record<string, unknown>).__clineHandleUri = (url: string) => SharedUriHandler.handleUri(url)
}
```

This is the exact precedent for any extension-host-side diagnostic we
might add for completion-protocol capture.

### 1.3 The Post-Terminal-Authority Diagnostic (PTAD) — bounded, opt-in, default-off

**Major finding**: there is already an existing bounded diagnostic
infrastructure for the post-terminal-authority split. It is
implemented at:

- `apps/vscode/src/shared/post-terminal-authority-diagnostic.ts`
  (696 lines) — the schema and ring buffer
- `apps/vscode/src/sdk/post-terminal-authority-diagnostic-runtime.ts`
  (135 lines) — the extension-host runtime, dump-to-file, webview flush-back

PTAD is **already wired** end-to-end:

- **Default off**: `context.workspaceState.get("ptadEnabled")` is
  `undefined` for any installation that has never toggled the
  command, so the diagnostic stays a complete no-op (production
  path-semantics unchanged in the default build).
- **Opt-in toggle**: command `cline.debug.togglePostTerminalAuthorityDiagnostic`
  flips the flag.
- **Dump action**: command `cline.debug.dumpPostTerminalAuthorityDiagnostic`
  serializes the extension-side ring buffer to
  `~/.cline/data/post-terminal-authority-diagnostic-extension.jsonl`,
  posts a `clinemm.dumpPostTerminalAuthorityDiagnostic` message to
  the webview asking it to flush, and the webview appends its records
  to `~/.cline/data/post-terminal-authority-diagnostic-webview.jsonl`
  via the `clinemm.appendPostTerminalAuthorityDiagnostic` postMessage
  type.
- **Bounded**: ring buffer of 64 records (default), expandable via
  `setPostTerminalAuthorityDiagnosticBufferSize(n)`.
- **Privacy-safe**: no prompt content, no model output, no tool args.
- **Test-visible**: `get()`, `getLatest()`, `clear()` are exported.
- **Push-correlated**: `_ptadPushId` field correlates extension-side
  and webview-side records for the same `ExtensionState` push.

PTAD already records (the `PostTerminalAuthoritySnapshot` shape):

```typescript
readonly captureKind: PostTerminalAuthorityCaptureKind
readonly capturedAt: number
readonly origin: "extension" | "webview"
readonly _ptadPushId?: number

// Identity
readonly sessionId?: string
readonly taskId?: string
readonly epoch?: number

// Runtime snapshot (the truth upstream of the trackers)
readonly runtimeStatus?: string
readonly runtimeModelStreaming?: boolean
readonly runtimeAwaitingApproval?: boolean
readonly runtimePendingToolCount?: number

// Shadow / ArbiterSnapshot fragments
readonly shadowStatus?: string
readonly shadowRecoveryState?: string
readonly shadowModelStreaming?: boolean
readonly shadowTooling?: boolean
readonly shadowAwaitingApproval?: boolean
readonly shadowPendingToolCount?: number

// Legacy turnStateTracker (the legacy authority)
readonly legacyPhase?: TurnPhase        // = turnState.phase
readonly legacySeq?: number
readonly legacyAnchorTs?: number
```

### 1.4 What PTAD already captures vs. the discriminator tuple

The Phase-0 capture at `f9186dfcd` listed the minimum viable capture:

| Field | PTAD already captures? |
|---|---|
| `sessionId` | ✅ YES (`sessionId` field) |
| `turnState.phase` | ✅ YES (`legacyPhase` field — `TurnPhase` is the legacy turnStateTracker) |
| `lastVisibleMessage.{type,say/ask,partial,isAuthoritativelyCompletedResult}` | ⚠️ PARTIAL — `captureKind` covers some capture sites but the discriminator tuple has explicit fields for the visible-message shape that PTAD does NOT record today |
| `attemptCompletionSeen` | ❌ NO — not currently recorded |
| `terminalResponseCommittedThisTurn` | ❌ NO — not currently recorded |
| `completionPolicy.requireCompletionTool` | ❌ NO — not currently recorded |
| `doneReason` | ❌ NO — not currently recorded |
| `modelFinishReason` | ❌ NO — not currently recorded |
| `lastToolRequested` | ⚠️ PARTIAL — `runtimePendingToolCount` covers count but not name |

## 2. Why this is important

The four discriminator-critical fields that were UNOBSERVED in the
Phase-0 capture break down as follows:

| Field | Where it lives in production | Observability gap cause |
|---|---|---|
| `attemptCompletionSeen` | `MessageTranslatorState` (`apps/vscode/src/sdk/message-translator.ts:341-353`) | In-process class field held by `SdkController`. Not on `globalThis`. Extension host is ESM + minified. |
| `terminalResponseCommittedThisTurn` | Same `MessageTranslatorState` (`message-translator.ts:374-378`) | Same. |
| `turnState.phase` | `TurnStateTracker` (legacy) — but **already on the wire** as `ExtensionState.turnState.phase` | PTAD already records this (`legacyPhase`). Wire-routable to webview. |
| `lastVisibleMessage.{type,say/ask,partial,isAuthoritativelyCompletedResult}` | Last entry of `ClineMessage[]` — **already on the wire** in `ExtensionState.clineMessages` | Not recorded by PTAD today. Wire-routable to webview. |

So **two of the four gaps are real, and two are wire-routable
already** if a dump path exists. The wire-routable fields
(`turnState.phase`, `lastVisibleMessage`) can be captured **purely
on the webview side**, with no extension-host semantic delta.

The two real gaps (`attemptCompletionSeen`,
`terminalResponseCommittedThisTurn`) are held inside
`MessageTranslatorState`. To make them externally observable, ONE of
the following must happen:

1. **Expose a read-only accessor** under the existing PTAD
   default-off toggle (extend PTAD with new optional fields populated
   from `MessageTranslatorState`).
2. **Add a `globalThis.__clineReadCaptureSurface()` function** under
   `CLINE_CAPTURE_BROWSER` (same gating pattern as `__clineHandleUri`).
3. **Set a CDP breakpoint** at the completion tool's `content_end`
   site (`message-translator.ts:1640-1655`) and read locals at pause.

Option (3) is purely external — no production change. The harness
already supports `ext.set_breakpoint` with sourcemap resolution.

## 3. Recommended bounded next ACT

The reviewer's evidence hierarchy (existing debug harness → dev-only
diagnostic adapter → temporary DEFAULT_OFF instrumentation → never
permanent application telemetry) maps cleanly to these options:

### 3.1 Recommended: extend PTAD with three new optional fields

PTAD already records `sessionId`, `turnState.phase` (via
`legacyPhase`), and is bounded, default-off, opt-in, privacy-safe,
and dumpable to JSONL. Adding three new optional fields:

```typescript
// New optional PTAD fields, populated when the PTAD ring buffer
// is enabled. No semantic delta when PTAD is disabled.
readonly attemptCompletionSeen?: boolean
readonly terminalResponseCommittedThisTurn?: boolean
readonly lastVisibleMessageKind?: "text" | "completion_result" | "command" | "tool" | ...
readonly lastVisibleMessagePartial?: boolean
readonly lastVisibleMessageIsAuthoritativelyCompletedResult?: boolean
readonly completionPolicyRequireCompletionTool?: boolean
readonly completionPolicyHasCompletionGuard?: boolean
readonly lastToolRequestedName?: string
readonly doneReason?: "completed" | "error" | "aborted" | ...
```

**Contract**:
- `PRODUCTION_SEMANTICS_DELTA = 0`: when `ptadEnabled` is false, no
  code paths change; the new fields are simply never populated.
- `DEFAULT_OFF = required`: PTAD is already default-off; the new
  fields inherit the same toggle.
- `PUBLIC_API_DELTA = 0`: only the internal `PostTerminalAuthoritySnapshot`
  interface gains optional fields; no exported function signature
  changes.
- `WIRE_PROTOCOL_DELTA = 0`: PTAD dumps to local JSONL only. There
  is NO new `ExtensionMessage` wire field. (`_ptadEnabled` is the
  existing wire bit and is unchanged.)

### 3.2 Alternative: harness-side read accessor via `globalThis`

Following the `__clineHandleUri` precedent (`extension.ts:194-197`):

```typescript
// In extension.ts, after the existing __clineHandleUri gate:
if (process.env.CLINE_CAPTURE_BROWSER === "1") {
    ;(globalThis as Record<string, unknown>).__clineReadCaptureSurface = () => ({
        attemptCompletionSeen: sdkController?.messageTranslatorState?.wasAttemptCompletionSeen() ?? null,
        terminalResponseCommittedThisTurn:
            sdkController?.messageTranslatorState?.wasTerminalResponseCommittedThisTurn() ?? null,
        turnStatePhase: sdkController?.getCurrentTurnStatePhase?.() ?? null,
        lastVisibleMessage: sdkController?.getLastVisibleMessage?.() ?? null,
        completionPolicy: sdkController?.getCompletionPolicy?.() ?? null,
    })
}
```

Then harness can `curl` `ext.evaluate` with expression
`globalThis.__clineReadCaptureSurface?.()` to pull the discriminator
tuple live.

**Contract**:
- `PRODUCTION_SEMANTICS_DELTA = 0`: the function is only installed
  when `CLINE_CAPTURE_BROWSER=1` (debug harness mode), never in

### 3.3 Alternative: pure CDP breakpoint inspection

No production change. The harness sets a breakpoint at
`apps/vscode/src/sdk/message-translator.ts:1640` (the canonical
completion publication seam), waits for the next completion-tool
`content_end`, then `ext.evaluate` with `callFrameId` reads locals
to confirm `attemptCompletionSeen === true` and
`terminalResponseCommittedThisTurn === true`.

**Contract**:
- `PRODUCTION_SEMANTICS_DELTA = 0`: pure read.
- `DEFAULT_OFF = required`: only the harness does this.
- `PUBLIC_API_DELTA = 0`: none.
- `WIRE_PROTOCOL_DELTA = 0`: none.

**Limitation**: this only proves the values at the completion-tool
`content_end` moment. It does NOT prove the values at the
`done`-event moment (the actual point of failure for the upstream
YOLO reports). To capture `done`-event values, use Option 3.1 or
3.2.
  production builds.
- `DEFAULT_OFF = required`: `CLINE_CAPTURE_BROWSER` is already a
  debug-only env flag; the harness sets it for the debugee (see
  `debug-harness/server.ts:425`).
- `PUBLIC_API_DELTA = 0`: `globalThis` pollution under one env flag
  is internal to the extension host; no exported API gains a new
  field.
- `WIRE_PROTOCOL_DELTA = 0`: nothing changes on the
  extension-host ↔ webview wire.

## 4. Recommendation

The reviewer's evidence hierarchy prefers the **existing debug
harness** approach. Of the three options:

| Option | Production delta | Wire delta | Bounded | Default off | Reach | Recommended? |
|---|---|---|---|---|---|---|
| 3.1 Extend PTAD schema | 0 (gated on `ptadEnabled`) | 0 | YES (64-record ring) | YES (existing toggle) | Both sides (extension + webview) | ✅ **FIRST** |
| 3.2 `globalThis.__clineReadCaptureSurface` | 0 (gated on `CLINE_CAPTURE_BROWSER`) | 0 | N/A (one-shot read) | YES (debug-only env) | Extension host only | ⚠️ SECOND if 3.1 hits a wall |
| 3.3 CDP breakpoint | 0 | 0 | N/A | YES (debug-only) | One-shot at one seam | ⚠️ THIRD (narrow reach) |

**Recommended next ACT**: `ACT-CLINEMM-COMPLETION-PTAD-EXTEND01`
(extend PTAD schema with the missing completion-protocol fields,
populate them from `MessageTranslatorState` and `ClineMessage[]`
under the existing `ptadEnabled` toggle, and add the wiring tests
for the new fields).

**Stop condition** for the next ACT:

```text
CAPTURE_SURFACE_EXISTING_HARNESS_INSUFFICIENT

trigger: PTAD extension is rejected by review, OR wiring tests
         fail, OR the dump-to-file path proves impractical for
         the discriminator tuple (e.g. ring buffer too small to
         capture the moment of failure).

action:  stop the extension ACT, report, and propose Option 3.2
         as a follow-up. Do NOT escalate to Option C
         (production diagnostic patch).
```

This stop condition is per the reviewer's disposition: "If it
starts becoming infrastructure construction, stop."

## 5. Why NOT Option C (production diagnostic patch)

Option C is the reviewer's "premature" choice. The reason it's
premature at this point:

1. The existing PTAD infrastructure already covers most of what
   we need (`sessionId`, `turnState.phase`, bounded ring buffer,
   default-off, dump-to-JSONL, webview flush-back, push
   correlation).
2. Extending PTAD is the smallest delta that closes the
   observability gap.
3. A separate production diagnostic patch would create a second
   diagnostic with overlapping concerns, split the on-disk dump
   path, and require its own wiring tests.

Option C is reserved as a **contingency** if PTAD cannot
accommodate the completion-protocol fields without violating the
PTAD contract (privacy-safe / bounded / push-correlated).

## 6. Status

- **No production change.**
- **No test change.**
- **No board change.**
- **No ACT opened.** Recon-only output. The next ACT
  (`ACT-CLINEMM-COMPLETION-PTAD-EXTEND01`) is **proposed** but
  not opened in this commit.
- **Committed as durable recon knowledge** — this file preserves
  the capture-surface inventory and the recommended path so the
  next bounded ACT does not have to re-derive the recon.

## 7. NEXT (factory decision required)

```text
NOW (this ACT)
  ACT-CLINEMM-COMPLETION-PROTOCOL-CAPTURE-SURFACE-RECON01
  Verdict: PASS_RECON_COMPLETE
  Output: this evidence doc
  Action: NONE (no production/test/board change)

NEXT (proposed, not opened)
  ACT-CLINEMM-COMPLETION-PTAD-EXTEND01
  Primary purpose: extend PTAD schema + wire completion-protocol
    capture under existing ptadEnabled toggle.
  Contract: PRODUCTION_SEMANTICS_DELTA = 0, DEFAULT_OFF = required,
    PUBLIC_API_DELTA = 0, WIRE_PROTOCOL_DELTA = 0.
  Stop condition: CAPTURE_SURFACE_EXISTING_HARNESS_INSUFFICIENT.

LIVENESS02
  remains DEFERRED until a bound specimen satisfies its trigger.
  The CAPTURE-SURFACE-RECON01 + COMPLETION-PTAD-EXTEND01 sequence
  is the path to making a future bound specimen capture-grade.

EDITOR-TOOL-APPROVAL-FRICTION-RECON01
  remains queued behind COMPLETION-PTAD-EXTEND01.
```

## 8. Committed as durable recon knowledge

This file is intentionally committed even though it does not open
a new ACT. It records:

1. The existing debug harness has `ext.evaluate` / `web.evaluate`
   via CDP and Playwright.
2. The PTAD is already a production-ready, default-off, bounded
   diagnostic infrastructure for the post-terminal-authority split,
   and it already records most of what we need.
3. The `__clineHandleUri` precedent at `extension.ts:194-197`
   shows the established default-off production gating pattern.
4. The four discriminator-critical fields break into two categories:
   (a) two are already wire-routable (`turnState.phase`,
   `lastVisibleMessage`); (b) two require a new read-only
   accessor (`attemptCompletionSeen`, `terminalResponseCommittedThisTurn`).
5. The recommended smallest bounded ACT is PTAD schema extension
   with new optional fields, under the existing `ptadEnabled`
   toggle.

Without (1)-(5) the next bounded ACT for capture-surface work
would risk either silently introducing a production semantic
delta (false-pass), re-deriving the existing diagnostic inventory
(wasted effort), or building parallel infrastructure (false-start).
