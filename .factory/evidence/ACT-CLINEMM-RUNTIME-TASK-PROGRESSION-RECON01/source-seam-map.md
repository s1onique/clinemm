# Source-seam map — ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01

> Status: **PARTIALLY POPULATED** (2 of 8 seams REAL_PRODUCTION_SEAM against current HEAD `15f2adaf6`). Remaining 6 seams still UNVERIFIED — recon phase has not been performed against current source for them.
>
> HEAD_AT_RECON_ENTRY = `a2417ef19909746ed878cdec5ce801a8f2decf81` (entry-freeze; the HEAD the recon phase froze its subject against)
>
> Canonical identity vocabulary (consistent across ACT header, epic ledger row, `.gitignore` comment):
>   LAUNCH_HEAD = `cf40c2b8b07520f9ddc2d798c6dfbb9830df9dea` (the commit that introduced this ACT; binding per `5b0fbd611` "docs(factory): bind runtime-progression launch identity")
>   ENTRY_HEAD  = `a2417ef19909746ed878cdec5ce801a8f2decf81` (alias of `HEAD_AT_RECON_ENTRY`; the pre-ACT subject HEAD)
>   TRIAGE_HEAD = `15f2adaf6c12dfdc79f47327e9ae93c46be52776` (current HEAD at TRIAGE_BIND 2026-08-28)
> HEAD_AT_TRIAGE_BIND  = `15f2adaf6c12dfdc79f47327e9ae93c46be52776` (background-command specimen bound here)
>
> The two REAL_PRODUCTION_SEAM rows below are pinned to current HEAD because the live specimen `cmd_mtcjhkhygpteq8v9` traverses them. They are labelled `REAL_PRODUCTION_SEAM` only for the **callback existence** (the seam symbol is the production code); the **wakeup semantics** (whether the callback also schedules a successor agent turn) is `STRUCTURAL ABSENT` per ACL02.

## Rule

Do **not** assume the production seams remain where prior Task-Control ACTs
found them. Recon each seam against the real production code at
`a2417ef19909746ed878cdec5ce801a8f2decf81`.

If the seam moved between this ACT and any predecessor Task-Control ACT:

```text
HALT_SEAM_MOVED
```

## Required seams

| Seam | Frozen symbol(s) / location at predecessor ACT | Re-found at this HEAD | STATUS |
|---|---|---|---|
| `MODEL_RESPONSE_TERMINAL_SEAM` | (predecessor symbol) | (re-found or moved) | UNVERIFIED |
| `TOOL_RESULT_TERMINAL_SEAM`   | (predecessor symbol) | `apps/vscode/src/sdk/vscode-run-commands-tool.ts:107` (`onBackgroundStateChange` callback fired when the tool returns RUNNING with a jobId, and again when the command reaches a terminal state) — wired into the runtime by `apps/vscode/src/sdk/vscode-runtime-builder.ts:125` and consumed at `apps/vscode/src/sdk/SdkController.ts:987` via `this.updateBackgroundCommandState(running, jobId)` | `REAL_PRODUCTION_SEAM` (labelled `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01` in the source comment) |
| `CONTINUATION_DECISION_SEAM`  | (predecessor symbol) | (re-found or moved) | UNVERIFIED |
| `CONTINUATION_SCHEDULER_SEAM` | (predecessor symbol) | (re-found or moved) | UNVERIFIED |
| `TASK_OWNER_SEAM`             | (predecessor symbol) | `apps/vscode/src/sdk/SdkController.ts:987` — the host's `onBackgroundStateChange` callback flips the projection to a `Waiting` state when RUNNING is returned. The callback is `REAL_PRODUCTION_SEAM`; its paired wakeup semantics (whether the same code path also schedules a successor agent turn) is `STRUCTURAL ABSENT` per ACL02. ACL04 records the same absence at the input-schema level (no `intent` field); ACL06 records the same absence at the tool-description level. **Split, per TRIAGE_BIND correction 2026-08-28**: the callback-existence is LIVE (the screenshot proves the projection flipped); the wakeup-semantics are UNOBSERVED on the bound specimen because its terminal-state chronology is not captured — see `live-failure.json:specimen_identity` and the `UNOBSERVED` labels in `live-failure.json:user_visible_symptom_to_capture.pending_model_request` and `:time_since_last_progress`. | `CALLBACK_EXISTENCE = REAL_PRODUCTION_SEAM`; `WAKEUP_SEMANTICS = STRUCTURAL ABSENT (proven by ACL02) AND UNOBSERVED (on the bound specimen)` |
| `CANCEL_AUTHORITY_SEAM`       | (predecessor symbol) | (re-found or moved) | UNVERIFIED |
| `RESUME_AUTHORITY_SEAM`       | (predecessor symbol) | (re-found or moved) | UNVERIFIED |
| `USER_FOLLOWUP_SEAM`          | (predecessor symbol) | (re-found or moved) | UNVERIFIED |

## Recon sequence

1. Walk `apps/vscode/src/`, `sdk/packages/core/src/`, `sdk/packages/agents/src/`
   starting from the documented Task API / hook surface.
2. For each seam, fix the canonical production symbol + file + line range
   at the exact HEAD `a2417ef19…`.
3. Mark each row:
   - `REAL_PRODUCTION_SEAM` — the symbol actually executes in the live production path;
   - `STRUCTURAL` — found by static walk only (no live call captured);
   - `INFERRED` — reasoned claim, not directly captured;
   - `UNAVAILABLE_FROM_TRACE` — cannot be located from the local trace.

## Production chain (record once recon is filled)

```text
tool/model completion
  → result publication
  → task-state / reducer transition
  → continuation eligibility
  → continuation scheduling
  → next model request
  → presentation
```

(this list is the recon target shape; do NOT promote individual steps to
LIVE until they have a real call-frame or canonical-event reference.)

## Static starting points (observational hints — NOT seam claims)

These are pointers the recon may walk from. They are intentionally not
asserted as seams here; the recon step has to confirm them.

- `sdk/packages/core/src/runtime/host/local-runtime-host.ts` — canonical
  runtime-event subscription surface (per `.clinerules/sdk-transport-integration.md`).
- `apps/vscode/src/core/hooks/__tests__/{taskcancel,taskstart,taskresume,taskcomplete}.test.ts`
  — hook-shaped tests that exercise the same surface; recon may inspect
  for the production call sites they wrap.
- `apps/vscode/src/core/controller/task/{taskFeedback,…}.ts` — gRPC surface
  that the webview drives; recon may inspect the corresponding
  production wiring.
- `apps/vscode/src/shared/proto/cline/task.ts` — generated; do not edit,
  recon-only pointer.

These are stated as recon pointers, not as boundary claims. The recon
ACT must OBSERVE before claiming which boundary (A..H) is violated.
