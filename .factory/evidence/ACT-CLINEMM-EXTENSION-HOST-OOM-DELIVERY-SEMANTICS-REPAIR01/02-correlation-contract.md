# ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 / 02-correlation-contract

## Status
CORRELATION_NEED_DETERMINED

## Question
What information does CCARD / the diagnostics actually need from
the `drain → send → runTurn` seam, and can that need be satisfied
without re-applying execution-control semantics at the wrong
boundary?

## Required-for-execution

| Field | Reason | Source today |
|-------|--------|--------------|
| `sessionId` | Identifies the session whose agent runs the turn | `deps.send` argument |
| `prompt` | The actual prompt content | `deps.send` argument |
| `mode` | Plan/act | `deps.send` argument |
| `userImages` / `userFiles` | Attachments | `deps.send` argument |
| (no `delivery`) | `delivery` is NOT required for execution when the drain has already shifted the prompt for execution. | Was forwarded; will be dropped. |

**The repair removes only `delivery` from the `deps.send` payload
at the drain boundary.** Everything else is preserved.

## Required-for-correlation

| Field | Reason | Source today | After repair |
|-------|--------|--------------|--------------|
| `jobId` | Background-command correlation token. Lets the CCARD JSONL correlate one logical job across C4 → C5 → C6 → C7 → C8. Set by `BackgroundNotifyCoordinator.enqueueTerminalWake` at the terminal-wake path; undefined for explicit user prompts. | Threaded through `drain → send` | **PRESERVED.** Still threaded through `drain → send`. |
| `delivery` (the entry's, not the payload's) | Historical provenance of the queue position (`queue` vs `steer`). Used at C4 (`onEnqueue`), C5 (`onBeforeDrain`), C6 (`onBeforeDispatch`) — all read from the `PendingPromptEntry`, NOT from the `deps.send` payload. | `next.delivery` (entry) | **PRESERVED.** Still read from `next.delivery` at C4/C5/C6. |

## Required-for-diagnostics

| Field | Reason | Source today | After repair |
|-------|--------|--------------|--------------|
| C7 `run_turn_started` `origin` | Distinguishes drained vs explicit-user vs deferred-continuation at the run-start seam | `deriveOrigin(input.delivery)` at `vscode-session-host.ts:469` | **CHANGED:** `deriveOrigin(input.delivery, input.jobId)`. The new disambiguator is `jobId` presence (drained prompts always carry `jobId`; explicit `runTurn({ delivery: "queue" })` without `jobId` remains `pending_prompt_drain`; explicit `runTurn({ delivery: "steer" })` remains `deferred_continuation`; default `runTurn` is `explicit_user`). |
| C8 `agent_turn_done` `origin` | Same — at run-done seam | `deriveOrigin(resolvedDelivery)` at `vscode-session-host.ts:478` | **CHANGED:** same as C7. |

## Not-required

| Field | Reason |
|-------|--------|
| `delivery` (forwarded from `drain → send`) | **Required-for-execution:** NO — the drain has already decided to execute; re-applying queue/steer semantics is the bounded mechanism. **Required-for-correlation:** NO — entry-level `delivery` already serves C4/C5/C6. **Required-for-diagnostics:** NO — `jobId` (preserved) replaces it at C7/C8. **Drop.** |
| The `__ablateDeliveryPropagation` env var | Was predecessor-only diagnostics; the repair makes the deletion permanent. **Remove.** |
| The `[CLINEMM_OOM_DISC01_ATTEST]` constructor attestation | Was predecessor-only diagnostics; no longer needed. **Remove.** |
| `CLINEMM_OOM_DISC01_SUBJECT_HEAD` esbuild `--define` | Was predecessor-only identity binding. No longer needed. **Remove.** |

## Central design question (per ACT doctrine §4)

> Can `pending_prompt_drain` provenance be carried or derived without
> reusing `delivery` as an execution-control input?

**Yes.** Doctrine options evaluated in order:

1. **derive origin from existing drain/dispatch context + jobId**
   — **CHOSEN.** `jobId` is an existing field, already threaded
   through `drain → send`, already reaching C7/C8 hooks. After
   the repair, `jobId` presence is the load-bearing disambiguator
   between drained-from-controller and explicit-user-call.

2. **reuse an existing internal origin enum / request metadata field**
   — N/A. There is no existing origin enum at the
   `SendSessionInput` boundary. The capture hooks have an
   `origin` field at the C4..C8 stages but it's a CCARD-internal
   type, not an SDK-public type.

3. **add a private/internal origin hint at the host boundary**
   — Not needed; option 1 satisfies the need without expanding the
   surface.

4. **add a new protocol/public field** — Not used; option 1 is
   sufficient.

**Repair direction:** doctrine option 1.

## Repair contract — final

The bounded repair makes two production code changes:

1. **`sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:563-565`**
   — permanently drop the `delivery` spread from the `deps.send`
   payload at the drain boundary. `jobId` remains forwarded.

2. **`apps/vscode/src/sdk/vscode-session-host.ts:422-428`** +
   **all 5 deriveOrigin call sites (lines 433, 445, 459, 469, 478)** —
   extend `deriveOrigin` to take `jobId?: string` and use it as
   the primary disambiguator (before `delivery`).

Both changes are explicit-correspondence, no-public-protocol
expansion, no schema change, no telemetry schema change beyond
the `session.input_sent` `delivery` field which already accepts
`"immediate"` (see `local-runtime-host.ts:1201`).