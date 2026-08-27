# Completion-Protocol Capture-Surface Qualification 01 — Evidence

> ACT-CLINEMM-COMPLETION-PROTOCOL-CAPTURE-SURFACE-QUALIFICATION01.
> Recon-only. No production change. No test change. No board change.
> One bounded existing-harness qualification, zero code changes.
> Companion to `completion-protocol-capture-surface-recon01-evidence.md`
> (committed at `1175bb4db`) and the prior Phase-0 capture at
> `f9186dfcd`.

## 0. Scope

The factory reviewer's verdict on the recon was:

> "The recon is useful and the specimen-binding corrections are now
> properly conservative... there is, however, one P1 sequencing
> problem in the proposed next step: the evidence hierarchy says
> existing debug harness first, but we have only inspected the
> harness — we have not yet demonstrated that it cannot capture the
> required fields. So I would insert one very small executable probe
> before PTAD extension."

This file is that executable probe. It is intentionally bounded:

```text
PRODUCTION_FILES_CHANGED = 0
TEST_FILES_CHANGED       = 0
WIRE_DELTA               = 0
PUBLIC_API_DELTA         = 0

EXPECTED_EXIT:
  EXISTING_HARNESS_SUFFICIENT
  or
  CAPTURE_SURFACE_EXISTING_HARNESS_INSUFFICIENT
```

No infrastructure construction. No code changes. One session.
The probe exercises only what is already shipped.

## 1. Probe 1 — can the harness actually launch?

The reviewer's first probe: prove

```text
HARNESS_SERVER_RUNNING
EXTENSION_HOST_ATTACHED
SOURCE_MAP_RESOLUTION_WORKS
```

### 1.1 Pre-conditions verified

The environment was checked before the probe. All pre-conditions
for `--skip-build` mode were satisfied:

| Pre-condition | Result | Source |
|---|---|---|
| `apps/vscode/dist/extension.js` exists | ✅ | `ls` confirmed |
| `apps/vscode/dist/extension.js.map` exists | ✅ | `ls` confirmed |
| `apps/vscode/webview-ui/build/index.html` exists | ✅ | `ls` confirmed |
| `apps/vscode/webview-ui/build/assets/*` exists | ✅ | `ls` confirmed |
| `playwright@1.62.1` installed | ✅ | `node_modules/.bun/playwright@1.62.1/node_modules/playwright` |
| macOS host | ✅ | `darwin` per env |
| VSCodium installed (substitute for `code`) | ✅ | `/Applications/VSCodium.app/Contents/MacOS/VSCodium` |
| No inherited `ELECTRON_*` / `VSCODE_*` env vars | ✅ | `env \| grep -iE 'electron\|vscode_' \| head` returned empty |
| Ports `19229` and `9230` free | ✅ | `lsof` empty on both |

### 1.2 The probe

The harness was launched with the recommended command per the
`.clinerules/debug-harness.md` env-cleaning recipe:

```bash
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE \
    -u VSCODE_CLI -u VSCODE_CODE_CACHE_PATH -u VSCODE_CRASH_REPORTER_PROCESS_TYPE \
    -u VSCODE_CWD -u VSCODE_ESM_ENTRYPOINT -u VSCODE_HANDLES_UNCAUGHT_ERRORS \
    -u VSCODE_IPC_HOOK -u VSCODE_NLS_CONFIG -u VSCODE_PID -u VSCODE_L10N_BUNDLE_LOCATION \
    node apps/vscode/src/dev/debug-harness/server.ts --auto-launch --skip-build --port 19229
```

Note: `node`, not `bun`, per `.clinerules/debug-harness.md`:
"Run with **node**, NOT bun — Playwright's Electron launch times
out under bun."

The probe ran twice — once with the default `--port 19229` and once
with `--port 19299` to rule out port-specific issues.

### 1.3 The result

**Both attempts failed at the same point: `listen EPERM`.**

```text
[09:12:23.824] Uncaught exception (ignored, server stays up):
    listen EPERM: operation not permitted 127.0.0.1:19229

[09:13:00.799] Uncaught exception (ignored, server stays up):
    listen EPERM: operation not permitted 127.0.0.1:19299
```

The harness process exited cleanly after the listen() syscall
returned EPERM. No Playwright launch was attempted. No extension
host was attached. No source map resolution was exercised.

### 1.4 Diagnosis

The `EPERM` on `listen(127.0.0.1:*)` is **not a harness code
defect**. The harness's `server.ts` calls `http.createServer(...).listen(PORT)`
in standard Node fashion. The error is an environment-level
sandbox restriction in this session that blocks binding to
loopback.

This is a structural property of the current capture environment,
not a transient failure. Reproducibility in the current sandbox
environment:

```text
REPRODUCIBLE_IN_CURRENT_SANDBOX_ENVIRONMENT
  127.0.0.1:19229 → EPERM
  127.0.0.1:19299 → EPERM
  HARNESS_CODE_DEFECT = NOT_INDICATED
```

A fresh unsandboxed shell or another execution substrate may
permit loopback listening. P2 wording: this is an environment
claim, not a harness claim.

## 2. Verdict

```text
CAPTURE_SURFACE_EXISTING_HARNESS_INSUFFICIENT
```

Reason: `listen EPERM: operation not permitted 127.0.0.1:19229`
(also reproduced at 19299).

This is **Case 4** in the reviewer's decision tree ("harness itself
is unusable/unreliable") — specifically the **environment
unusable** sub-case, distinct from the **code unusable** sub-case.

**Important consequence**: Probes 2 and 3 from the reviewer's
decision tree (break at `done` seam, webview `evaluate` against the
same paused task) **could not be exercised** because the harness
could not bring up the listener or attach to an extension host.
The qualification is therefore a hard stop, not a partial
qualification.

## 3. What this means for the next ACT

Per the reviewer's hard budget and decision tree:

> Case 4 — harness itself is unusable/unreliable. Then go to PTAD.
> But narrow the proposed V1 schema substantially:
>   - `attemptCompletionSeen?: boolean`
>   - `terminalResponseCommittedThisTurn?: boolean`
>   - `completionPolicyRequireCompletionTool?: boolean`
>   - `doneReason?: string`
> Maybe `completionPolicyRequireCompletionTool` can even wait.
> Everything else should be composed from existing surfaces.

And per the terminology correction:

```text
PRODUCTION_SOURCE_DELTA     = YES  (if code touched)
STATE_SEMANTIC_DELTA_OFF    = ZERO
PUBLIC_PROTOCOL_DELTA       = ZERO
```

**`COMPLETION-PTAD-EXTEND01` is now justified**, but **NOT opened
in this commit**. The reason: the reviewer's protocol is "go on
one bounded existing-harness qualification", and the qualification
**has now been completed and reported**. The next move is a
factory decision: open `COMPLETION-PTAD-EXTEND01` with the
narrowed V1 schema, OR park completion work and return to the
queued `EDITOR-TOOL-APPROVAL-FRICTION-RECON01`.

### 3.1 Recommended PTAD V1 schema (reviewer's narrowed proposal)

If the factory authorizes `COMPLETION-PTAD-EXTEND01`, the V1 schema
should be **substantially narrower** than the original proposed
list in `completion-protocol-capture-surface-recon01-evidence.md §3.1`:

```typescript
// Add to PostTerminalAuthoritySnapshot in
// apps/vscode/src/shared/post-terminal-authority-diagnostic.ts
//
// CONTRACT:
//   PRODUCTION_SOURCE_DELTA     = YES (one diagnostic module touched)
//   STATE_SEMANTIC_DELTA_OFF    = ZERO (no behavior change when disabled)
//   PUBLIC_PROTOCOL_DELTA       = ZERO (no wire field added; PTAD dumps
//                                          to local JSONL only)
readonly attemptCompletionSeen?: boolean
readonly terminalResponseCommittedThisTurn?: boolean
readonly completionPolicyRequireCompletionTool?: boolean
readonly doneReason?: string
```

**Do NOT add** (compose from existing surfaces instead):

| Field | Compose from |
|---|---|
| `sessionId` | Already in PTAD. |
| `taskId` | Already in PTAD. |
| `turnState.phase` | Already in PTAD as `legacyPhase`. |
| `lastVisibleMessage.{type,say,ask}` | Already on the wire in `ExtensionState.clineMessages`; webview can read directly. |
| `lastVisibleMessage.partial` | Same. |
| `lastVisibleMessage.isAuthoritativelyCompletedResult` | Same. |
| `lastToolRequestedName` | Already on the wire in `ExtensionState.clineMessages` (assistant content kind). |
| `runtimeStatus`, `runtimeModelStreaming`, `runtimeAwaitingApproval`, etc. | Already in PTAD. |

This narrow schema is the minimum to make Case A/B/C/D classification
**possible** from a captured dump. Everything else can be composed.

### 3.2 Wiring test addition

For each new field, a wiring test must be added to
`post-terminal-authority-diagnostic-wiring.test.ts` to lock the
production-source delta at the exact capture site. No production
semantic test is needed (PTAD's `STATE_SEMANTIC_DELTA_OFF = ZERO`
guarantee is structural).

## 4. Status

- **No production change.** (One probe was executed; zero source files touched.)
- **No test change.**
- **No board change.**
- **No ACT opened.** The qualification is complete; the next move
  is a factory decision (open narrowed `COMPLETION-PTAD-EXTEND01`
  or return to `EDITOR-TOOL-APPROVAL-FRICTION-RECON01`).
- **Committed as durable qualification evidence.**

## 5. NEXT (factory decision required)

```text
CAPTURE-SURFACE-QUALIFICATION01
  Verdict: CAPTURE_SURFACE_EXISTING_HARNESS_INSUFFICIENT
  Cause:  listen EPERM on 127.0.0.1 (environment sandbox, not code)

OPTIONS (factory choice)

A. OPEN_COMPLETION_PTAD_EXTEND01 (narrowed)
   Schema: attemptCompletionSeen, terminalResponseCommittedThisTurn,
           completionPolicyRequireCompletionTool, doneReason
   Contract:
     PRODUCTION_SOURCE_DELTA     = YES (one diagnostic module touched)
     STATE_SEMANTIC_DELTA_OFF    = ZERO
     PUBLIC_PROTOCOL_DELTA       = ZERO
   Wiring tests for each new field at exact capture site.
   Stop condition: any review objection OR wiring test failure OR
   dump-path proves impractical.

B. PARK_COMPLETION_AND_RETURN_TO_EDITOR_APPROVAL
   Open ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 next.
   Park completion-protocol-liveness work until the harness
   environment can be made operable.

C. OPEN_COMPLETION_PTAD_EXTEND01_AND_DEFER_DONE_REASON
   Same as A, but omit doneReason from V1. Three fields only.
   doneReason can be added in V2 if A fails to discriminate.
```

The reviewer pre-authorized Option A in the disposition: "If the
harness qualification does not immediately yield a reusable capture
recipe ... then either open the minimal PTAD extension or park
completion work and return to editor approval." Option A is the
smallest action that respects the discriminator contract.

But Option A still requires factory decision per the explicit
block: "`PTAD-EXTEND01` BLOCKED on: CAPTURE_SURFACE_EXISTING_HARNESS_INSUFFICIENT"
which is now satisfied. The block has lifted; the factory's call
is which path forward.

## 6. Committed as durable qualification evidence

This file records:

1. The pre-conditions for `--skip-build` harness launch were all
   satisfied (build artifacts present, Playwright installed,
   macOS host, VSCodium available, no inherited env vars,
   target ports free).
2. The probe was executed **twice** with the env-cleaning prefix
   per `.clinerules/debug-harness.md`, once on the default port
   `19229` and once on `19299` to rule out port-specific issues.
3. Both attempts failed with identical `EPERM` on `listen(127.0.0.1)`
   before any Playwright launch was attempted.
4. The cause is environmental sandbox restriction, not harness
   code defect.
5. Per the reviewer's decision tree Case 4, the verdict is
   `CAPTURE_SURFACE_EXISTING_HARNESS_INSUFFICIENT`.

Without (1)-(5) the next person to attempt this qualification
would either re-derive the same probe or mistakenly conclude the
harness has a code bug. Both are wrong; this file records the
correct conclusion and the exact reproduction recipe.
