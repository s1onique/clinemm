# R0 — Ownership map / entry baseline

## Entry baseline (R0)

```text
ENTRY_HEAD:   674bdd43bdb391f36f069c75476ce491d370cf79
BRANCH:       main
WORKTREE:     CLEAN (git status --short => empty) for the ACT-owned paths
PREDECESSOR:  ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01 (PASS_P0_RED_REPRODUCED)
```

NOTE ON THE WORKTREE: the repository working tree was NOT globally clean at
entry — `.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md`
was already modified and a set of `clinemm-outside-*` sandbox directories were
already present. Both are UNRELATED to this ACT (they belong to the seatbelt
workstream) and were NOT touched. Every path this ACT owns was clean at entry
(`git status --short -- <act-owned paths>` => empty), and the ACT's diff is
restricted to those paths.

The predecessor ACT committed the 15-test production-seam RED suite
(`apps/vscode/src/sdk/__tests__/post-terminal-working-cancel-repro01.ptwcr01.test.ts`)
and proved the defect reproduces at the REAL coordinator + REAL `TurnStateTracker`.

## Ownership map

| Concern | Owner | File |
|---|---|---|
| Host turn-phase authority (the defect) | `SdkSessionEventCoordinator` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` |
| BCB hold (C10 withheld) | same file, BCB decision block (~L3742-3787) | same |
| Unguarded pending-prompt `streaming` writer | same file, `pending_prompt_submitted` branch (~L3266-3280) | same |
| Elm completion authority | `checkElmCompletionAuthority` | same file (~L1432-1524) |
| Writer-identity closed union | `TurnStateWriterId` | `apps/vscode/src/shared/turn-state-writer-provenance.ts` |
| Phase enum | `TurnPhase` | `apps/vscode/src/shared/ExtensionMessage.ts` |
| Projection seams (NOT the defect) | TaskHeader selector / button selector | `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` |
| Runtime abort event source | `completeAbortedInteractiveTurn` | `sdk/packages/core/src/runtime/host/local-runtime-host.ts` (~L2308-2357) |
| Pending-prompt drain / submitted emission | `PendingPromptService.drain` | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` (~L524-669) |

## LIVE chronology (re-verified for this ACT)

From the frozen LIVE capture root
`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/`:

| at (ms) | source | fact |
|---|---|---|
| 1792961416077 | `post-terminal-authority-diagnostic-extension.jsonl` | `runtimeStatus=aborted`, `legacyPhase=streaming` (seq 132080), `shadowStatus=aborted`, `runtimeModelStreaming=false`, `runtimePendingToolCount=0` |
| 1792961423166 | `continuation-cardinality-authority.jsonl` seq 2138 | `submit_and_exit_seen` (C9) — 1st |
| 1792961423170 | `bcb-observation-unavailable-capture.jsonl` | BCB hold: `unconsumedOwnedTerminalResultsForC10=4`, `heldObligationForC10=true`, 4 named jobIds, `writerId=session-event-bcb-eligible-no-bcb-writer` |
| 1792961423220 | CCAA seq 2139 | `pending_prompt_enqueued` |
| 1792961423227 | CCAA seq 2140 | `agent_turn_done` (pending_prompt_drain) |
| 1792961423228 | CCAA seq 2141 | `pending_prompt_dequeued` |
| 1792961423228 | `turn-state-writer-provenance.jsonl` | **LAST phase write**: `session-event-pending-prompt-submitted` -> `streaming` (committed seq 132499) |
| 1792961423471 | PTAD extension | `runtimeStatus=aborted`, `legacyPhase=streaming` (seq 132499) |
| ... 1792961475436 | PTAD extension (LAST) | still `aborted` / `streaming` — never repaired |

**LOAD-BEARING CONCLUSION (new in this ACT):** the BCB hold (`1792961423170`) PRECEDES
the final `pending_prompt_submitted` phase write (`1792961423228`, seq 132499) by ~58 ms.
Therefore BOTH boundaries are required:

1. the BCB hold path publishes NO terminal phase at all, and
2. the `pending_prompt_submitted` writer re-asserts `streaming` unconditionally.

Fixing only (1) would leave the LIVE seq-132499 write as the last writer.
Fixing only (2) would leave the phase at `streaming` (the BCB hold writes nothing).
